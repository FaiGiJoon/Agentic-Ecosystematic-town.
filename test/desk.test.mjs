import test from 'node:test';
import assert from 'node:assert/strict';
import { Desk } from '../hq/desk.js';
import { parseTicker } from '../hq/desk-feed.js';
import { decide, TRADERS } from '../hq/desk-strategies.js';

const quote = (last, spread = 0.001) => ({ bid: last * (1 - spread / 2), ask: last * (1 + spread / 2), last });
const market = (btc, eth = 2000, sol = 100) => ({ BTC: quote(btc), ETH: quote(eth), SOL: quote(sol) });

// A desk on a scripted feed and clock. Each tick takes the next price set.
function makeDesk(config = {}, prices = [market(70000)]) {
  let t = Date.UTC(2026, 9, 31, 12);
  let i = 0;
  const desk = new Desk({
    config: { pollMs: 60000, ...config },
    fetchPrices: async () => prices[Math.min(i++, prices.length - 1)],
    now: () => t,
    rng: () => 0.5, // the degen trader stays quiet unless a test says otherwise
  });
  desk.advance = (ms = 60000) => (t += ms);
  return desk;
}

test('parseTicker reads Kraken quotes and refuses bad ones', () => {
  const k = (b, a, c) => ({ b: [String(b)], a: [String(a)], c: [String(c)] });
  const ok = { error: [], result: { XXBTZUSD: k(100, 101, 100.5), XETHZUSD: k(10, 10.1, 10), SOLUSD: k(1, 1.01, 1) } };
  assert.deepEqual(parseTicker(ok).BTC, { bid: 100, ask: 101, last: 100.5 });
  assert.throws(() => parseTicker({ error: ['EGeneral:Too many requests'] }), /Too many requests/);
  assert.throws(() => parseTicker({ error: [], result: { ...ok.result, SOLUSD: k(2, 1, 1) } }), /bad quote for SOL/);
  assert.throws(() => parseTicker({ error: [], result: {} }), /bad quote/);
});

test('the benchmark buys once at the ask, pays the fee, then never trades', async () => {
  const desk = makeDesk({ fee: 0.004 }, [market(70000), market(77000)]);
  await desk.tick();
  const s1 = desk.state().traders.find((t) => t.benchmark);
  assert.equal(s1.trades, 3);
  assert.ok(Math.abs(s1.fees - 4) < 1e-9); // 0.4% of $1000
  assert.ok(s1.cash < 1e-9);
  desk.advance();
  await desk.tick();
  const s2 = desk.state().traders.find((t) => t.benchmark);
  assert.equal(s2.trades, 3);
  assert.ok(s2.equity > s1.equity, 'BTC went up 10%');
});

test('a feed error trades nothing and is reported', async () => {
  const desk = new Desk({ fetchPrices: async () => { throw new Error('price feed: HTTP 503'); } });
  await desk.tick();
  const s = desk.state();
  assert.equal(s.feedError, 'price feed: HTTP 503');
  assert.equal(s.tick, 0);
  assert.equal(s.traders.reduce((n, t) => n + t.trades, 0), 0);
});

test('orders over the per-trade cap are capped; the daily limit rejects', async () => {
  const desk = makeDesk({ maxTradeUsd: 100, maxDayUsd: 150 });
  await desk.tick();
  const moon = TRADERS.find((t) => t.id === 'moonshot');
  desk.rng = () => 0.01; // Moonshot's "gut feeling": buy with half its cash
  await desk.tick();
  const orders = desk.state().recent.filter((o) => o.trader === moon.id);
  const filled = orders.filter((o) => o.status === 'filled');
  assert.equal(filled[filled.length - 1].usd, 100);
  assert.match(filled[filled.length - 1].why, /capped/);
  desk.advance();
  await desk.tick();
  const rejected = desk.state().recent.filter((o) => o.trader === moon.id && o.status === 'rejected');
  assert.ok(rejected.some((o) => /daily limit/.test(o.reason)));
  const day = desk.state().traders.find((t) => t.id === moon.id).dayUsd;
  assert.ok(day <= 150);
});

test('the kill switch stops all trading and cancels pending orders', async () => {
  const desk = makeDesk({ approval: true });
  desk.rng = () => 0.01;
  await desk.tick();
  assert.ok(desk.state().pending.length > 0);
  desk.halt();
  const s = desk.state();
  assert.equal(s.halted.reason, 'kill switch');
  assert.equal(s.pending.length, 0);
  const before = s.traders.map((t) => t.trades).join();
  desk.advance();
  await desk.tick();
  assert.equal(desk.state().traders.map((t) => t.trades).join(), before);
  desk.resume();
  assert.equal(desk.state().halted, null);
});

test('with approval on, nothing fills until approved; rejecting cancels', async () => {
  const desk = makeDesk({ approval: true });
  desk.rng = () => 0.01;
  await desk.tick();
  const pending = desk.state().pending;
  const moon = pending.find((o) => o.trader === 'moonshot');
  assert.ok(moon);
  const cashBefore = desk.account('moonshot').cash;
  const filled = desk.decideOrder(moon.id, true);
  assert.equal(filled.status, 'filled');
  assert.ok(desk.account('moonshot').cash < cashBefore);
  desk.rng = () => 0.5;
  const other = desk.state().pending[0];
  if (other) assert.equal(desk.decideOrder(other.id, false).status, 'cancelled');
  assert.throws(() => desk.decideOrder(moon.id, true), /order is filled/);
});

test('pending orders expire after five minutes', async () => {
  const desk = makeDesk({ approval: true });
  desk.rng = () => 0.01;
  await desk.tick();
  const id = desk.state().pending[0].id;
  desk.rng = () => 0.5;
  desk.advance(6 * 60000);
  await desk.tick();
  assert.equal(desk.q.getOrder.get(id).status, 'expired');
});

test('a crash past the loss limit halts the desk, and resume halts again while still down', async () => {
  const desk = makeDesk({ maxLossPct: 10, maxTradeUsd: 1000, maxDayUsd: 100000 }, [market(70000)]);
  desk.rng = () => 0.01;
  for (let i = 0; i < 6; i++) {
    desk.advance();
    await desk.tick(); // Moonshot keeps buying half its cash
  }
  desk.rng = () => 0.5;
  desk.fetchPrices = async () => market(7000, 200, 10); // -90%
  desk.advance();
  await desk.tick();
  assert.match(desk.state().halted?.reason ?? '', /loss limit/);
  desk.resume();
  assert.match(desk.state().halted?.reason ?? '', /loss limit/);
});

test('stale prices block orders', async () => {
  const desk = makeDesk({ approval: true });
  desk.rng = () => 0.01;
  await desk.tick();
  const id = desk.state().pending[0].id;
  desk.advance(4 * 60000);
  assert.equal(desk.decideOrder(id, true).reason, 'prices are stale');
});

test('momentum buys on an uptrend and sells on the turn', () => {
  const lou = TRADERS.find((t) => t.strategy === 'momentum');
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const account = { cash: 1000, holdings: { BTC: 0, ETH: 0, SOL: 0 } };
  const flat = Array(30).fill(100);
  const ctx = { account, history: { BTC: up, ETH: flat, SOL: flat }, prices: market(129), syms: ['BTC', 'ETH', 'SOL'], tick: 30, rng: () => 0.5 };
  assert.deepEqual(decide(lou, ctx).map((o) => [o.sym, o.side]), [['BTC', 'buy']]);
  const down = [...up].reverse();
  const held = { cash: 700, holdings: { BTC: 2, ETH: 0, SOL: 0 } };
  assert.deepEqual(decide(lou, { ...ctx, account: held, history: { BTC: down, ETH: flat, SOL: flat } }).map((o) => [o.sym, o.side, o.qty]), [['BTC', 'sell', 2]]);
});
