import test from 'node:test';
import assert from 'node:assert/strict';
import { usageTotals, noteName, SPOTS } from '../public/district/js/hq-bridge.js';
import { DISTRICTS } from '../public/district/js/sim/builders.js';

test('usageTotals sums finished runs and skips tickets without usage', () => {
  const t = usageTotals([
    { cost_usd: 0.41, tokens_in: 52000, tokens_out: 3100, duration_ms: 23000 },
    { cost_usd: null, tokens_in: null },
    { cost_usd: 0.09, tokens_in: 1000, tokens_out: 200, duration_ms: 1000 },
  ]);
  assert.equal(t.runs, 2);
  assert.ok(Math.abs(t.cost - 0.5) < 1e-9);
  assert.equal(t.in, 53000);
  assert.equal(t.out, 3300);
  assert.equal(t.ms, 24000);
  assert.deepEqual(usageTotals(undefined), { runs: 0, cost: 0, in: 0, out: 0, ms: 0 });
});

test('noteName shows only the file name of a vault note', () => {
  assert.equal(noteName('/Users/me/Documents/Obsidian Vault/00-inbox/agent-hq-1-x.md'), 'agent-hq-1-x.md');
  assert.equal(noteName('C:\\vault\\00-inbox\\agent-hq-2-y.md'), 'agent-hq-2-y.md');
  assert.equal(noteName(null), null);
});

test("CLAUDE's spots sit next to their districts, outside the buildings", () => {
  const near = (p, d, lo, hi) => {
    const r = Math.hypot(p.x - d.x, p.z - d.z);
    return r > lo && r < hi;
  };
  assert.ok(near(SPOTS.board, DISTRICTS.board, 1, 4));
  assert.ok(near(SPOTS.desk, DISTRICTS.hub, 5, 8));
  assert.ok(near(SPOTS.home, DISTRICTS.library, 3, 6));
});
