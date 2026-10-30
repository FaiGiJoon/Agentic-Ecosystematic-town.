import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../hq/store.js';
import { createApp } from '../hq/http.js';

const SECRET = 'TOP-SECRET-SENTINEL';
let tmp, server, store, base, port, dir, kicks, agentListeners, runner;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-http-'));
  dir = path.join(tmp, 'public');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(tmp, 'secret.txt'), SECRET);
  await fs.symlink(path.join(tmp, 'secret.txt'), path.join(dir, 'link.txt'));
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>town</h1>');
  await fs.writeFile(path.join(dir, 'app.js'), 'export {}');
  store = new Store();
  kicks = 0;
  agentListeners = [];
  runner = {
    agent: { status: 'idle', ticket: null, step: null },
    kick() { kicks += 1; },
    onAgent(fn) { agentListeners.push(fn); },
  };
  server = createApp({ store, runner, config: {}, publicDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await fs.rm(tmp, { recursive: true, force: true });
});

const post = (url, body, headers = {}) => fetch(base + url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

function rawGet(rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('POST /api/tickets creates a ticket; empty title is 400', async () => {
  const res = await post('/api/tickets', { title: 'Hi' });
  assert.equal(res.status, 201);
  const t = await res.json();
  assert.equal(t.title, 'Hi');
  assert.equal(t.status, 'open');

  const bad = await post('/api/tickets', { title: '' });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).error);

  const malformed = await fetch(base + '/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(malformed.status, 400);
});

test('assign queues and kicks; second assign is 409; retry only on failed', async () => {
  const t = await (await post('/api/tickets', { title: 'Work' })).json();
  const before = kicks;
  const res = await post(`/api/tickets/${t.id}/assign`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'queued');
  assert.equal(kicks, before + 1);

  const again = await post(`/api/tickets/${t.id}/assign`);
  assert.equal(again.status, 409);
  assert.ok((await again.json()).error);

  assert.equal((await post(`/api/tickets/${t.id}/retry`)).status, 409);
  store.setStatus(t.id, 'failed');
  const retried = await post(`/api/tickets/${t.id}/retry`);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).status, 'queued');
  assert.equal(kicks, before + 2);
});

test('GET /api/state and /api/tickets/:id', async () => {
  const t = await (await post('/api/tickets', { title: 'Listed' })).json();
  const state = await (await fetch(base + '/api/state')).json();
  assert.ok(state.tickets.some((x) => x.id === t.id));
  assert.deepEqual(state.agent, runner.agent);

  const one = await (await fetch(`${base}/api/tickets/${t.id}`)).json();
  assert.equal(one.title, 'Listed');
  assert.equal(one.events[0].kind, 'created');

  assert.equal((await fetch(base + '/api/tickets/99999')).status, 404);
  assert.equal((await fetch(base + '/api/tickets/abc')).status, 404);
  assert.equal((await fetch(base + '/api/tickets/1.5')).status, 404);
  const unknown = await fetch(base + '/api/nope');
  assert.equal(unknown.status, 404);
  assert.ok((await unknown.json()).error);
});

test('SSE streams ticket, event and agent frames', async () => {
  const ac = new AbortController();
  const res = await fetch(base + '/api/events', { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const readUntil = async (re) => {
    while (!re.test(buf)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
  };

  const t = await (await post('/api/tickets', { title: 'Streamed' })).json();
  await readUntil(/event: event\n[^\n]*\n\n/);
  assert.match(buf, new RegExp(`event: ticket\\ndata: .*"title":"Streamed".*\\n\\n`));
  assert.match(buf, /event: event\ndata: .*"kind":"created"/);

  const agent = { status: 'working', ticket: t.id, step: 'READ' };
  agentListeners.forEach((fn) => fn(agent));
  await readUntil(/event: agent\n/);
  assert.ok(buf.includes(`event: agent\ndata: ${JSON.stringify(agent)}\n\n`));

  ac.abort();
  await reader.read().catch(() => {});
});

test('foreign Host header is 403 on every route; localhost is allowed', async () => {
  assert.equal((await rawGet('/', { Host: `evil.example:${port}` })).status, 403);
  assert.equal((await rawGet('/api/state', { Host: `evil.example:${port}` })).status, 403);
  assert.equal((await rawGet('/api/state', { Host: '127.0.0.1:1' })).status, 403);
  assert.equal((await rawGet('/api/state', { Host: `localhost:${port}` })).status, 200);
  assert.equal((await rawGet('/', { Host: `127.0.0.1:${port}` })).status, 200);
});

test('static files: index at /, content types, traversal is 404', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /text\/html/);
  assert.equal(await idx.text(), '<h1>town</h1>');

  const js = await fetch(base + '/app.js');
  assert.match(js.headers.get('content-type'), /javascript/);

  assert.equal((await fetch(base + '/missing.png')).status, 404);
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%00', `/${tmp}/secret.txt`, `/${path.join(tmp, 'secret.txt')}`, '/link.txt']) {
    const r = await rawGet(p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes(SECRET), p);
  }
});

test('bodies over 16 KB are 413', async () => {
  const res = await post('/api/tickets', { title: 'x', body: 'a'.repeat(20 * 1024) });
  assert.equal(res.status, 413);
});

test('cross-site API calls are blocked', async () => {
  const count = () => store.list().length;
  const n = count();
  const t = await (await post('/api/tickets', { title: 'Guarded' })).json();
  assert.equal(count(), n + 1);

  const plain = await fetch(base + '/api/tickets', {
    method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://evil.example' }, body: JSON.stringify({ title: 'Evil' }),
  });
  assert.equal(plain.status, 403);
  const plainNoOrigin = await fetch(base + '/api/tickets', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"title":"Evil"}' });
  assert.equal(plainNoOrigin.status, 415);
  const bodyless = await fetch(`${base}/api/tickets/${t.id}/assign`, { method: 'POST' });
  assert.equal(bodyless.status, 415);
  assert.equal(store.get(t.id).status, 'open');
  assert.equal(count(), n + 1);

  const foreign = await post('/api/tickets', { title: 'Evil' }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await post(`/api/tickets/${t.id}/assign`, undefined, { origin: 'null' })).status, 403);
  assert.equal((await fetch(base + '/api/state', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal(store.get(t.id).status, 'open');
  assert.equal(count(), n + 1);

  const same = await post('/api/tickets', { title: 'Fine' }, { origin: base });
  assert.equal(same.status, 201);
  const local = await post(`/api/tickets/${t.id}/assign`, undefined, { origin: `http://localhost:${port}`, 'content-type': 'application/json; charset=utf-8' });
  assert.equal(local.status, 200);
});
