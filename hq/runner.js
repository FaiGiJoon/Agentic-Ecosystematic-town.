import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { stepsFrom } from './activity.js';
import { writeNote as defaultWriteNote } from './vault.js';

export function prompt(ticket, vault) {
  return [
    `Ticket: ${ticket.title}`,
    '',
    ticket.body?.trim() ? ticket.body : '(no details)',
    '',
    `The Obsidian vault at ${vault} is read-only reference: read it if useful, never change it.`,
    'You may only write files in the current folder.',
    'End with your final answer in Markdown.',
  ].join('\n');
}

// The real path, so a symlinked vault cannot slip past the deny rules.
function vaultPath(vault) {
  const abs = path.resolve(vault);
  try { return realpathSync(abs); } catch { return abs; }
}

// Permission rule paths: "./" is the working folder (work/<id>/); an absolute
// filesystem path needs a "//" prefix, a single "/" would be project-relative.
export function claudeArgs(ticket, { vault, maxBudgetUsd }) {
  const abs = vaultPath(vault);
  const rule = (tool) => `${tool}(/${abs}/**)`;
  return [
    '-p', prompt(ticket, abs),
    '--output-format', 'stream-json',
    '--verbose',
    // Ignore user/project/local settings and their plugins, hooks and MCP servers.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--tools', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Write', 'Edit',
    '--allowedTools', 'Read(./**)', rule('Read'), 'WebSearch', 'WebFetch', 'Write(./**)', 'Edit(./**)',
    '--disallowedTools', 'Bash', rule('Write'), rule('Edit'),
    '--add-dir', abs,
    '--permission-mode', 'dontAsk',
    '--max-budget-usd', String(maxBudgetUsd),
  ];
}

function minutes(ms) {
  return Math.max(0.1, Math.round(ms / 6000) / 10);
}

// Cost and token counts from Claude's final result message, or null if it has none.
export function usageFrom(result) {
  if (!result || typeof result !== 'object' || typeof result.total_cost_usd !== 'number') return null;
  const u = result.usage || {};
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    cost_usd: result.total_cost_usd,
    tokens_in: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
    tokens_out: n(u.output_tokens),
    duration_ms: Number.isFinite(result.duration_ms) ? result.duration_ms : null,
  };
}

export class Runner {
  agent = { status: 'idle', ticket: null, step: null };
  #current = null;
  #listeners = [];

  constructor({ store, config, writeNote = defaultWriteNote }) {
    this.store = store;
    this.config = config;
    this.writeNote = writeNote;
  }

  onAgent(fn) {
    this.#listeners.push(fn);
  }

  #setAgent(agent) {
    this.agent = agent;
    for (const fn of this.#listeners) {
      try { fn(agent); } catch (err) { console.error('agent listener failed:', err); }
    }
  }

  kick() {
    if (this.#current) return;
    const ticket = this.store.nextQueued();
    if (!ticket) return;
    // Guard is set synchronously; #run starts on a microtask so listeners that
    // call kick() re-entrantly see #current already set.
    this.#current = Promise.resolve().then(() => this.#run(ticket))
      .catch((err) => console.error('runner crashed:', err))
      .finally(() => {
        this.#current = null;
        this.#setAgent({ status: 'idle', ticket: null, step: null });
        this.kick();
      });
  }

  async idle() {
    this.kick();
    while (this.#current) await this.#current;
  }

  async #run(ticket) {
    const { store, config } = this;
    const id = ticket.id;
    store.setStatus(id, 'working');
    store.addEvent(id, 'started');
    this.#setAgent({ status: 'working', ticket: id, step: null });

    const outcome = await this.#spawn(ticket);
    if (outcome.ok) {
      store.setStatus(id, 'done', { output: outcome.output, usage: outcome.usage });
      store.addEvent(id, 'done');
      try {
        const notePath = await this.writeNote(config.vault, store.get(id));
        store.setStatus(id, 'done', { note_path: notePath });
      } catch (err) {
        store.addEvent(id, 'step', `Could not write vault note: ${err.message}`);
      }
    } else {
      store.setStatus(id, 'failed', { usage: outcome.usage });
      store.addEvent(id, 'failed', outcome.error);
    }
  }

  async #spawn(ticket) {
    const { store, config } = this;
    const id = ticket.id;
    const cwd = path.join(config.workDir, String(id));
    try {
      await fs.mkdir(cwd, { recursive: true });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    return new Promise((resolve) => {
      const child = spawn(config.claudeBin, claudeArgs(ticket, config), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let result = null;
      let stderr = '';
      let timedOut = false;
      let spawnError = null;
      let exitCode = null;
      let pending = 2; // process closed + stdout fully read

      let finished = false;
      let killTimer = null;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
        // Do not rely only on 'close' after a kill.
        killTimer = setTimeout(finish, 2000);
        killTimer.unref();
      }, config.timeoutMs);

      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        const usage = usageFrom(result);
        if (timedOut) return resolve({ ok: false, usage, error: `timed out after ${minutes(config.timeoutMs)} min` });
        if (spawnError) return resolve({ ok: false, usage, error: spawnError.message });
        if (exitCode === 0 && result && result.is_error !== true) {
          return resolve({ ok: true, usage, output: String(result.result ?? '') });
        }
        let tail = stderr.trim().split('\n').slice(-5).join('\n');
        if (!tail && result) {
          const errs = Array.isArray(result.errors) ? result.errors.join('; ') : '';
          tail = [result.subtype, [typeof result.result === 'string' ? result.result : '', errs].filter(Boolean).join(' ')]
            .filter(Boolean).join(': ');
        }
        resolve({ ok: false, usage, error: `exit ${exitCode}: ${tail}` });
      }
      const part = () => { if (--pending === 0) finish(); };

      child.on('error', (err) => {
        spawnError = err;
        pending = 0;
        finish();
      });
      child.on('close', (code) => {
        exitCode = code;
        part();
      });
      child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });

      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        // After a timeout the pipe can outlive the process; late lines are ignored.
        if (finished) return;
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'result') result = msg;
        for (const step of stepsFrom(msg)) {
          store.addEvent(id, 'step', `${step.label} ${step.detail}`.trim());
          this.#setAgent({ status: 'working', ticket: id, step });
        }
      });
      rl.on('close', part);
    });
  }
}
