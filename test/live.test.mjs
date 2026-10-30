import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, connect } from '../public/town/live.js';

let calls;
let replies;
const realFetch = globalThis.fetch;
const realES = globalThis.EventSource;

class FakeEventSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.handlers = {};
    FakeEventSource.last = this;
  }
  addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, data) {
    for (const fn of this.handlers[name] || []) fn(data === undefined ? {} : { data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  calls = [];
  replies = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, ...opts });
    const { status = 200, body = {} } = replies.shift() || {};
    return { ok: status < 400, status, json: async () => body };
  };
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.EventSource = realES;
});

test('api.create posts JSON with the JSON content type', async () => {
  replies.push({ status: 201, body: { id: 1, title: 'Hi' } });
  const t = await api.create({ title: 'Hi', body: 'there' });
  assert.deepEqual(t, { id: 1, title: 'Hi' });
  assert.equal(calls[0].url, '/api/tickets');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body), { title: 'Hi', body: 'there' });
});

test('assign and retry send an empty JSON object; ticket GETs', async () => {
  replies.push({}, {}, { body: { id: 3, events: [] } });
  await api.assign(3);
  await api.retry(3);
  const t = await api.ticket(3);
  assert.equal(calls[0].url, '/api/tickets/3/assign');
  assert.equal(calls[0].body, '{}');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[1].url, '/api/tickets/3/retry');
  assert.equal(calls[2].url, '/api/tickets/3');
  assert.equal(calls[2].method, undefined);
  assert.deepEqual(t, { id: 3, events: [] });
});

test('an API error throws the server message', async () => {
  replies.push({ status: 400, body: { error: 'title is required' } });
  await assert.rejects(api.create({ title: '' }), { message: 'title is required' });
  replies.push({ status: 500, body: {} });
  await assert.rejects(api.ticket(9), { message: 'request failed (500)' });
});

test('connect loads the state on open and dispatches named events', async () => {
  const got = [];
  replies.push({ body: { tickets: [{ id: 1 }], agent: { status: 'idle' } } });
  connect({
    onState: (s) => got.push(['state', s]),
    onTicket: (t) => got.push(['ticket', t]),
    onEvent: (e) => got.push(['event', e]),
    onAgent: (a) => got.push(['agent', a]),
  });
  const es = FakeEventSource.last;
  assert.equal(es.url, '/api/events');
  es.emit('open');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls[0].url, '/api/state');
  es.emit('ticket', { id: 1, status: 'queued' });
  es.emit('event', { ticket_id: 1, kind: 'assigned' });
  es.emit('agent', { status: 'working', ticket: 1 });
  assert.deepEqual(got, [
    ['state', { tickets: [{ id: 1 }], agent: { status: 'idle' } }],
    ['ticket', { id: 1, status: 'queued' }],
    ['event', { ticket_id: 1, kind: 'assigned' }],
    ['agent', { status: 'working', ticket: 1 }],
  ]);
});

test('every reconnect reloads the state', async () => {
  const states = [];
  replies.push({ body: { tickets: [], agent: null } }, { body: { tickets: [{ id: 2 }], agent: null } });
  connect({ onState: (s) => states.push(s) });
  const es = FakeEventSource.last;
  es.emit('open');
  await new Promise((r) => setTimeout(r, 0));
  es.emit('open');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.map((c) => c.url), ['/api/state', '/api/state']);
  assert.deepEqual(states.map((s) => s.tickets.length), [0, 1]);
});

test('a dropped stream or failed state load reports offline', async () => {
  let offline = 0;
  replies.push({ status: 500, body: {} });
  connect({ onState: () => {}, onOffline: () => { offline += 1; } });
  const es = FakeEventSource.last;
  es.emit('error');
  assert.equal(offline, 1);
  es.emit('open');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(offline, 2);
});
