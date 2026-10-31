import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../hq/store.js';
import { createApp } from '../hq/http.js';
import { Desk } from '../hq/desk.js';

const q = (last) => ({ bid: last * 0.9995, ask: last * 1.0005, last });
let tmp, server, base, desk, off, offBase;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-desk-'));
  const runner = { agent: { status: 'idle' }, kick() {}, onAgent() {} };
  desk = new Desk({ config: { approval: true }, fetchPrices: async () => ({ BTC: q(70000), ETH: q(2000), SOL: q(100) }), rng: () => 0.01 });
  server = createApp({ store: new Store(), runner, desk, config: {}, publicDir: tmp });
  off = createApp({ store: new Store(), runner, config: {}, publicDir: tmp });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => off.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  offBase = `http://127.0.0.1:${off.address().port}`;
  await desk.tick();
});

after(async () => {
  for (const s of [server, off]) {
    s.closeAllConnections?.();
    await new Promise((r) => s.close(r));
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

const post = (url, headers = { 'content-type': 'application/json' }) => fetch(base + url, { method: 'POST', headers, body: '{}' });

test('GET /api/desk returns paper state with prices and all traders', async () => {
  const s = await (await fetch(base + '/api/desk')).json();
  assert.equal(s.mode, 'paper');
  assert.equal(s.traders.length, 6);
  assert.ok(s.prices.BTC.ask > s.prices.BTC.bid);
  assert.ok(s.pending.length > 0);
});

test('approve fills a pending order; approving it again is 409', async () => {
  const id = desk.state().pending.find((o) => o.trader === 'moonshot').id;
  const res = await post(`/api/desk/orders/${id}/approve`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'filled');
  assert.equal((await post(`/api/desk/orders/${id}/approve`)).status, 409);
  assert.equal((await post('/api/desk/orders/99999/reject')).status, 404);
});

test('the kill switch needs a JSON POST from this origin', async () => {
  assert.equal((await post('/api/desk/halt', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/desk/halt', { 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403);
  assert.equal(desk.halted, null);
  const halted = await (await post('/api/desk/halt')).json();
  assert.equal(halted.halted.reason, 'kill switch');
  const resumed = await (await post('/api/desk/resume')).json();
  assert.equal(resumed.halted, null);
});

test('with DESK=off the desk routes are 404', async () => {
  const res = await fetch(offBase + '/api/desk');
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /DESK=off/);
});
