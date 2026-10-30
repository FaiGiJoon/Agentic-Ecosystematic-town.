import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../hq/store.js';
import { Runner, claudeArgs, usageFrom } from '../hq/runner.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');

function setup({ mode = 'ok', config = {}, writeNote } = {}) {
  process.env.FAKE_MODE = mode;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-runner-'));
  const vault = path.join(tmp, 'vault');
  fs.mkdirSync(path.join(vault, '00-inbox'), { recursive: true });
  const store = new Store();
  const cfg = { claudeBin: FAKE, workDir: path.join(tmp, 'work'), vault, timeoutMs: 10000, maxBudgetUsd: 1, ...config };
  const runner = new Runner({ store, config: cfg, ...(writeNote ? { writeNote } : {}) });
  return { store, runner, tmp, vault, cfg };
}

async function runOne(opts) {
  const ctx = setup(opts);
  const t = ctx.store.create({ title: 'Plan trip', body: 'Find trains' });
  ctx.store.assign(t.id);
  ctx.runner.kick();
  await ctx.runner.idle();
  return { ...ctx, id: t.id, ticket: ctx.store.get(t.id), events: ctx.store.events(t.id) };
}

test('claudeArgs is exact', () => {
  const ticket = { title: 'Plan trip', body: 'Find trains' };
  const vault = '/v/my vault';
  const args = claudeArgs(ticket, { vault, maxBudgetUsd: 1 });
  const prompt = args[1];
  assert.deepEqual(args, [
    '-p', prompt, '--output-format', 'stream-json', '--verbose',
    '--setting-sources', '', '--strict-mcp-config',
    '--tools', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Write', 'Edit',
    '--allowedTools', 'Read(./**)', 'Read(//v/my vault/**)', 'WebSearch', 'WebFetch', 'Write(./**)', 'Edit(./**)',
    '--disallowedTools', 'Bash', 'Write(//v/my vault/**)', 'Edit(//v/my vault/**)',
    '--add-dir', vault, '--permission-mode', 'dontAsk', '--max-budget-usd', '1',
  ]);
  assert.match(prompt, /Plan trip/);
  assert.match(prompt, /Find trains/);
  assert.match(prompt, /\/v\/my vault/);
  assert.match(prompt, /read-only/i);
  assert.match(prompt, /Markdown/);
  const tools = args.slice(args.indexOf('--tools') + 1, args.indexOf('--allowedTools'));
  assert.ok(!tools.includes('Bash'));
});

test('claudeArgs resolves a relative vault to an absolute rule path', () => {
  const args = claudeArgs({ title: 't' }, { vault: 'rel/vault', maxBudgetUsd: 1 });
  const abs = path.resolve('rel/vault');
  assert.ok(args.includes(`Write(/${abs}/**)`));
  assert.equal(args[args.indexOf('--add-dir') + 1], abs);
});

test('claudeArgs resolves a symlinked vault to its real path', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-link-')));
  const real = path.join(tmp, 'real vault');
  fs.mkdirSync(real);
  const link = path.join(tmp, 'link');
  fs.symlinkSync(real, link);
  try {
    const args = claudeArgs({ title: 't' }, { vault: link, maxBudgetUsd: 1 });
    assert.equal(args[args.indexOf('--add-dir') + 1], real);
    assert.ok(args.includes(`Write(/${real}/**)`));
    assert.ok(args.includes(`Read(/${real}/**)`));
    assert.ok(!args.some((a) => a.includes(link)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

for (const mode of ['ok', 'noise']) {
  test(`${mode}: ticket finishes done with a note`, async () => {
    const { ticket, events, runner } = await runOne({ mode });
    assert.equal(ticket.status, 'done');
    assert.equal(ticket.output, '# Answer\nfine');
    assert.ok(ticket.note_path && fs.existsSync(ticket.note_path));
    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.includes('started'));
    assert.ok(kinds.includes('done'));
    assert.ok(events.some((e) => e.kind === 'step' && e.text === 'WEB goldenrod city'));
    assert.ok(events.some((e) => e.kind === 'step' && e.text === 'THINK Looking good'));
    assert.deepEqual(runner.agent, { status: 'idle', ticket: null, step: null });
  });
}

test('runs in work dir with the expected args', async () => {
  const argsFile = path.join(os.tmpdir(), `hq-args-${process.pid}.txt`);
  fs.rmSync(argsFile, { force: true });
  process.env.FAKE_ARGS_FILE = argsFile;
  try {
    const { cfg, id } = await runOne({});
    const lines = fs.readFileSync(argsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0], claudeArgs({ title: 'Plan trip', body: 'Find trains' }, cfg));
    assert.ok(fs.statSync(path.join(cfg.workDir, String(id))).isDirectory());
  } finally {
    delete process.env.FAKE_ARGS_FILE;
    fs.rmSync(argsFile, { force: true });
  }
});

test('error: ticket fails with stderr', async () => {
  const { ticket, events } = await runOne({ mode: 'error' });
  assert.equal(ticket.status, 'failed');
  const failed = events.find((e) => e.kind === 'failed');
  assert.match(failed.text, /exit 1/);
  assert.match(failed.text, /not logged in/);
});

test('hang: killed after timeout', async () => {
  const { ticket, events } = await runOne({ mode: 'hang', config: { timeoutMs: 200 } });
  assert.equal(ticket.status, 'failed');
  assert.match(events.find((e) => e.kind === 'failed').text, /timed out/);
});

test('lines printed after the timeout fallback are ignored', async () => {
  const { store, runner, id, ticket } = await runOne({ mode: 'linger', config: { timeoutMs: 200 } });
  assert.equal(ticket.status, 'failed');
  const before = store.events(id).length;
  const states = [];
  runner.onAgent((a) => states.push(a.status));
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(store.events(id).length, before);
  assert.deepEqual(states, []);
  assert.equal(runner.agent.status, 'idle');
});

test('missing binary fails the ticket', async () => {
  const { ticket, events } = await runOne({ config: { claudeBin: '/nonexistent' } });
  assert.equal(ticket.status, 'failed');
  assert.match(events.find((e) => e.kind === 'failed').text, /ENOENT/);
});

test('writeNote rejecting still finishes done', async () => {
  const { ticket, events } = await runOne({ writeNote: async () => { throw new Error('inbox gone'); } });
  assert.equal(ticket.status, 'done');
  assert.equal(ticket.note_path, null);
  assert.ok(events.some((e) => e.kind === 'step' && e.text === 'Could not write vault note: inbox gone'));
  assert.ok(events.some((e) => e.kind === 'done'));
});

test('queue runs one at a time, in id order', async () => {
  const { store, runner } = setup();
  const a = store.create({ title: 'A' });
  const b = store.create({ title: 'B' });
  store.assign(a.id);
  store.assign(b.id);
  const seen = [];
  const maxWorking = [];
  runner.onAgent((agent) => {
    seen.push(agent.ticket);
    maxWorking.push(store.list().filter((t) => t.status === 'working').length);
  });
  runner.kick();
  runner.kick();
  await runner.idle();
  assert.ok(Math.max(...maxWorking) <= 1);
  const order = seen.filter((id, i) => id !== null && seen[i - 1] !== id);
  assert.deepEqual(order, [a.id, b.id]);
  assert.equal(store.get(a.id).status, 'done');
  assert.equal(store.get(b.id).status, 'done');
});

test('empty stderr: failed text carries the result error info', async () => {
  const { ticket, events } = await runOne({ mode: 'budget' });
  assert.equal(ticket.status, 'failed');
  assert.equal(events.find((e) => e.kind === 'failed').text, 'exit 1: error_max_budget_usd: Reached maximum budget ($1)');
});

test('kick() from store and agent listeners never starts two at once', async () => {
  const { store, runner } = setup();
  const a = store.create({ title: 'A' });
  const b = store.create({ title: 'B' });
  store.assign(a.id);
  store.assign(b.id);
  let max = 0;
  const check = () => { max = Math.max(max, store.list().filter((t) => t.status === 'working').length); };
  store.onChange(() => { check(); runner.kick(); });
  runner.onAgent(() => { check(); runner.kick(); });
  runner.kick();
  await runner.idle();
  assert.equal(max, 1);
  assert.equal(store.get(a.id).status, 'done');
  assert.equal(store.get(b.id).status, 'done');
});

test('fake-claude FAKE_DELAY_MS spaces its lines out; output is unchanged', async () => {
  const { execFileSync } = await import('node:child_process');
  const run = (env) => {
    const t0 = Date.now();
    const out = execFileSync(process.execPath, [FAKE], { env: { ...process.env, FAKE_MODE: 'ok', ...env } }).toString();
    return { out, ms: Date.now() - t0 };
  };
  const fast = run({ FAKE_DELAY_MS: '' });
  const slow = run({ FAKE_DELAY_MS: '300' });
  assert.equal(slow.out, fast.out);
  assert.ok(slow.ms - fast.ms >= 250, `only ${slow.ms - fast.ms} ms slower`);
});

test('usageFrom sums input, cache and output tokens', () => {
  assert.deepEqual(usageFrom({
    type: 'result', total_cost_usd: 0.4123, duration_ms: 23000,
    usage: { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 50000, output_tokens: 3100 },
  }), { cost_usd: 0.4123, tokens_in: 52010, tokens_out: 3100, duration_ms: 23000 });
  assert.equal(usageFrom({ type: 'result' }), null);
  assert.equal(usageFrom(null), null);
});

test('a finished ticket records its usage, a failed one too', async () => {
  const ok = await runOne({ mode: 'ok' });
  assert.equal(ok.ticket.cost_usd, 0.25);
  assert.equal(ok.ticket.tokens_in, 1500);
  assert.equal(ok.ticket.tokens_out, 200);
  const bad = await runOne({ mode: 'budget' });
  assert.equal(bad.ticket.status, 'failed');
  assert.equal(bad.ticket.cost_usd, 1.02);
});
