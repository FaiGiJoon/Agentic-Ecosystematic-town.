// A koala's brain: one isolated, tool-less `claude -p` call per decision, on the
// user's existing Claude Code login. Same isolation as the ticket runner, but no
// tools at all, a small model, a per-call budget and schema-checked JSON output.

import { spawn } from 'node:child_process';
import { DECISION_SCHEMA } from './grove-world.js';
import { usageFrom } from './runner.js';

export function koalaArgs({ system, prompt, model, callUsd }) {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--model', model,
    // Replaces Claude Code's own system prompt: the koala needs none of it, and it costs tokens.
    '--system-prompt', system,
    '--json-schema', JSON.stringify(DECISION_SCHEMA),
    '--tools', '',
    // Ignore user/project/local settings and their plugins, hooks, MCP servers and skills.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--max-budget-usd', String(callUsd),
  ];
}

// The result message: all of stdout as one JSON object, or else the last line that is one.
function resultFrom(stdout) {
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && v.type === 'result' ? v : null;
    } catch { return null; }
  };
  return tryParse(stdout.trim()) ?? stdout.trim().split('\n').reverse().map(tryParse).find(Boolean) ?? null;
}

// Resolves { ok, raw, usage, error }; raw is the structured output, or the result text to search.
export function think({ bin, args, cwd, timeoutMs }) {
  // CLAUDE_BIN may point at a Node script (the test fake); run it with this Node.
  const [cmd, pre] = /\.m?js$/.test(bin) ? [process.execPath, [bin]] : [bin, []];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, [...pre, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, raw: null, usage: null, error: err.message });
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const finish = (code, spawnError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const result = resultFrom(stdout);
      const usage = usageFrom(result);
      if (timedOut) return resolve({ ok: false, raw: null, usage, error: `timed out after ${Math.round(timeoutMs / 1000)} s` });
      if (spawnError) return resolve({ ok: false, raw: null, usage, error: spawnError.message });
      const raw = result?.structured_output && typeof result.structured_output === 'object'
        ? result.structured_output
        : typeof result?.result === 'string' && result.result ? result.result : null;
      if (code === 0 && result && result.is_error !== true && raw) return resolve({ ok: true, raw, usage, error: null });
      const errs = Array.isArray(result?.errors) ? result.errors.join('; ') : '';
      const why = stderr.trim().split('\n').slice(-3).join(' ')
        || [result?.subtype, typeof result?.result === 'string' ? result.result : '', errs].filter(Boolean).join(': ')
        || 'no result';
      resolve({ ok: false, raw: null, usage, error: `exit ${code}: ${why}` });
    };
    child.stdout.on('data', (d) => { if (stdout.length < 200000) stdout += d; });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code));
  });
}
