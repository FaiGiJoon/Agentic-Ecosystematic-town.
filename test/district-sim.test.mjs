import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../public/district/js/sim/world.js';
import { Bus, makeRng } from '../public/district/js/sim/core.js';
import { Market, Ledger, Funds } from '../public/district/js/sim/market.js';
import { Construction, BLUEPRINTS } from '../public/district/js/sim/builders.js';

const run = (world, seconds) => {
  for (let t = 0; t < seconds; t += 0.05) world.step(0.05);
};

test('town runs for two days without errors and builds things', () => {
  const w = createWorld({ seed: 3 });
  const events = { chat: 0, block: 0, transfer: 0, trade: 0 };
  for (const k of Object.keys(events)) w.bus.on(k, () => events[k]++);
  run(w, 400);
  assert.equal(w.day, 3);
  assert.ok(events.block > 100, `blocks placed: ${events.block}`);
  assert.ok(w.construction.completed >= 2, `completed: ${w.construction.completed}`);
  assert.ok(events.chat > 30, `chat lines: ${events.chat}`);
  assert.ok(events.trade > 10, `trades: ${events.trade}`);
  assert.ok(w.board.tickets.some((t) => t.status === 'done' && t.steps.length >= 3));
});

test('token ledger totals equal the sum over agents', () => {
  const w = createWorld({ seed: 5 });
  run(w, 120);
  const sum = w.agents.reduce((s, a) => s + a.tokens.in + a.tokens.out, 0);
  assert.equal(sum, w.tokens.total.in + w.tokens.total.out);
  const cost = w.agents.reduce((s, a) => s + a.tokens.cost, 0);
  assert.ok(Math.abs(cost - w.tokens.total.cost) < 1e-9);
  assert.ok(w.tokens.total.cost > 0);
});

test('prices stay positive and finite', () => {
  const w = createWorld({ seed: 9 });
  run(w, 300);
  for (const c of Object.values(w.market.coins)) assert.ok(Number.isFinite(c.price) && c.price > 0, c.sym);
});

test('peer-to-peer transfers conserve balances and refuse overdrafts', () => {
  const bus = new Bus();
  const m = new Market(makeRng(1), bus);
  const l = new Ledger(bus, m);
  l.open('a', 100, { CASP: 2 });
  l.open('b', 0);
  assert.equal(l.transfer('a', 'b', 'cash', 40), true);
  assert.equal(l.transfer('a', 'b', 'CASP', 3), false);
  assert.equal(l.transfer('a', 'b', 'CASP', 2), true);
  assert.equal(l.get('a').cash + l.get('b').cash, 100);
  assert.equal(l.get('b').holdings.CASP, 2);
});

test('fund invest then withdraw returns the money minus fees when prices are flat', () => {
  const bus = new Bus();
  const m = new Market(makeRng(1), bus);
  const l = new Ledger(bus, m);
  l.open('exchange', 0);
  l.open('agent', 1000, { CASP: 10 });
  l.open('player', 500);
  const f = new Funds(bus, l);
  f.create('agent');
  const navBefore = l.value('agent');
  f.invest('player', 'agent', 500);
  assert.ok(Math.abs(f.position('agent', 'player').value - 500) < 1e-6);
  assert.ok(Math.abs(l.value('agent') - navBefore - 500) < 1e-6);
  const back = f.withdraw('player', 'agent');
  assert.ok(back > 495 && back <= 500.0001, `got ${back}`);
  assert.equal(f.position('agent', 'player').shares, 0);
});

test('every blueprint yields integer voxels and a plot completes', () => {
  const rng = makeRng(2);
  for (const bp of Object.values(BLUEPRINTS)) {
    const { voxels } = bp(rng);
    assert.ok(voxels.length > 10);
  }
  const bus = new Bus();
  const c = new Construction(rng, bus);
  const p = c.openPlot();
  let n = 0;
  while (c.place(p, { id: 'x', name: 'x' })) n++;
  assert.equal(p.status, 'done');
  assert.equal(n + 1, p.voxels.length);
  assert.ok(p.voxels.every((v) => Number.isInteger(v.x) && Number.isInteger(v.z)));
});
