import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../hq/store.js';
import { createApp } from '../hq/http.js';
import { Grove } from '../hq/grove.js';

let tmp, server, base, grove, off, offBase;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-grove-'));
  const runner = { agent: { status: 'idle' }, kick() {}, onAgent() {} };
  grove = new Grove({ think: async () => ({ ok: true, raw: { action: 'sit' }, usage: null }) });
  server = createApp({ store: new Store(), runner, grove, config: {}, publicDir: tmp });
  off = createApp({ store: new Store(), runner, config: {}, publicDir: tmp });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => off.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  offBase = `http://127.0.0.1:${off.address().port}`;
});

after(async () => {
  for (const s of [server, off]) {
    s.closeAllConnections?.();
    await new Promise((r) => s.close(r));
  }
  grove.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const post = (url, body = {}, headers = { 'content-type': 'application/json' }) =>
  fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body) });

test('GET /api/grove returns both koalas, the places and the real usage meter', async () => {
  const s = await (await fetch(base + '/api/grove')).json();
  assert.deepEqual(s.koalas.map((k) => k.id), ['mallee', 'bramble']);
  assert.ok(s.places.pond);
  assert.equal(s.playing, false);
  assert.equal(s.usage.today.cost, 0);
});

test('play, heartbeat and pause need a JSON POST from this origin', async () => {
  assert.equal((await post('/api/grove/play', {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/grove/play', {}, { 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403);
  assert.equal(grove.playing, false);
  assert.equal((await (await post('/api/grove/play')).json()).playing, true);
  assert.equal((await post('/api/grove/heartbeat')).status, 200);
  assert.equal(grove.present, true);
  assert.equal((await (await post('/api/grove/pause')).json()).playing, false);
});

test('act gives, and bad requests get their status', async () => {
  const res = await post('/api/grove/act', { koala: 'mallee', kind: 'give', item: 'pebble' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).koalas[0].inventory, ['pebble']);
  assert.equal((await post('/api/grove/act', { koala: 'mallee', kind: 'give', item: 'gold' })).status, 400);
  assert.equal((await post('/api/grove/act', { koala: 'nobody', kind: 'pet' })).status, 404);
  assert.equal((await post('/api/grove/nope')).status, 404);
});

test('changes stream over /api/events as "grove" frames', { timeout: 5000 }, async () => {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/events', { signal: ctrl.signal });
  const reader = res.body.getReader();
  await reader.read(); // ": connected"
  await post('/api/grove/act', { koala: 'bramble', kind: 'pet' });
  let text = '';
  while (!text.includes('event: grove')) text += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  assert.match(text, /patted Bramble/);
});

test('with GROVE=off the grove routes are 404', async () => {
  const res = await fetch(offBase + '/api/grove');
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /GROVE=off/);
});
