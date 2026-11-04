import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { koalaArgs, think } from '../hq/grove-brain.js';
import { DECISION_SCHEMA } from '../hq/grove-world.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-koala.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-brain-'));

function run(mode, extra = {}) {
  process.env.FAKE_MODE = mode;
  return think({ bin: FAKE, args: koalaArgs({ system: 'You are Mallee', prompt: 'hi', model: 'claude-haiku-5-5', callUsd: 0.05 }), cwd: tmp, timeoutMs: 5000, ...extra });
}

test('koalaArgs: isolated, no tools, cheap model, budget, structured JSON', () => {
  assert.deepEqual(koalaArgs({ system: 'SYS', prompt: 'PROMPT', model: 'claude-haiku-5-5', callUsd: 0.05 }), [
    '-p', 'PROMPT',
    '--output-format', 'json',
    '--model', 'claude-haiku-5-5',
    '--system-prompt', 'SYS',
    '--json-schema', JSON.stringify(DECISION_SCHEMA),
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--max-budget-usd', '0.05',
  ]);
});

test('ok: the structured output and real usage come back', async () => {
  const argsFile = path.join(tmp, 'args.jsonl');
  process.env.FAKE_ARGS_FILE = argsFile;
  process.env.FAKE_DECISION = JSON.stringify({ action: 'eat', target: 'big_gum', say: 'Munch' });
  try {
    const r = await run('ok');
    assert.equal(r.ok, true);
    assert.equal(r.raw.action, 'eat');
    assert.equal(r.raw.say, 'Munch');
    assert.deepEqual(r.usage, { cost_usd: 0.0021, tokens_in: 1500, tokens_out: 80, duration_ms: 1500 });
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf8').trim().split('\n').at(-1));
    assert.equal(args[args.indexOf('--model') + 1], 'claude-haiku-5-5');
  } finally {
    delete process.env.FAKE_ARGS_FILE;
    delete process.env.FAKE_DECISION;
  }
});

test('text: a decision only in the result text is still found', async () => {
  const r = await run('text');
  assert.equal(r.ok, true);
  assert.equal(typeof r.raw, 'string');
  assert.match(r.raw, /"action"/);
});

test('error: not ok, with the error text and no decision', async () => {
  const r = await run('error');
  assert.equal(r.ok, false);
  assert.match(r.error, /not logged in/i);
});

test('budget: not ok, but the money spent is still reported', async () => {
  const r = await run('budget');
  assert.equal(r.ok, false);
  assert.equal(r.usage.cost_usd, 0.06);
  assert.match(r.error, /budget/);
});

test('hang: killed after the timeout', async () => {
  const r = await run('hang', { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out/);
});

test('a missing binary is an error, not a crash', async () => {
  const r = await think({ bin: path.join(tmp, 'no-such-claude'), args: [], cwd: tmp, timeoutMs: 2000 });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
