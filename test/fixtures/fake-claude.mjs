#!/usr/bin/env node
// Stand-in for the claude CLI. Behaviour chosen by env FAKE_MODE: ok | error | noise | budget | hang;
// FAKE_DELAY_MS slows the output down.
import fs from 'node:fs';

if (process.env.FAKE_ARGS_FILE) {
  fs.appendFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(2)) + '\n');
}

const mode = process.env.FAKE_MODE || 'ok';
const assistant = JSON.stringify({
  type: 'assistant',
  message: {
    content: [
      { type: 'tool_use', name: 'WebSearch', input: { query: 'goldenrod city' } },
      { type: 'text', text: 'Looking good' },
    ],
  },
});
const usage = { input_tokens: 100, cache_creation_input_tokens: 400, cache_read_input_tokens: 1000, output_tokens: 200 };
const result = JSON.stringify({ type: 'result', is_error: false, result: '# Answer\nfine', total_cost_usd: 0.25, duration_ms: 1200, usage });

// FAKE_DELAY_MS (default 0) waits before each printed line, so demos show the work.
const delay = Number(process.env.FAKE_DELAY_MS) || 0;
async function out(...lines) {
  for (const line of lines) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    process.stdout.write(line);
  }
}

if (mode === 'ok') {
  await out(assistant + '\n', result + '\n');
} else if (mode === 'noise') {
  await out('warming up...\n', assistant + '\n', result);
} else if (mode === 'error') {
  await out(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }) + '\n');
  process.stderr.write('not logged in\n');
  process.exitCode = 1;
} else if (mode === 'budget') {
  await out(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: ['Reached maximum budget ($1)'], total_cost_usd: 1.02, usage }) + '\n');
  process.exitCode = 1;
} else if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'linger') {
  // Hangs; a grandchild shares stdout, so it stays open after this process is
  // killed and keeps printing steps for ~4 s.
  const { spawn } = await import('node:child_process');
  const line = JSON.stringify(assistant);
  spawn(process.execPath, ['-e', `let n = 0; const t = setInterval(() => {
    process.stdout.write(${line} + '\\n'); if (++n >= 16) clearInterval(t); }, 250);`],
  { stdio: ['ignore', 'inherit', 'ignore'] });
  setInterval(() => {}, 1000);
}
