import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, StoreError } from '../hq/store.js';

const throwsStatus = (fn, status) =>
  assert.throws(fn, (e) => e instanceof StoreError && e.status === status);

test('create trims title, stores open, adds created event', () => {
  const s = new Store();
  const t = s.create({ title: '  Hello  ', body: 'b' });
  assert.equal(t.title, 'Hello');
  assert.equal(t.status, 'open');
  assert.equal(t.body, 'b');
  assert.deepEqual(s.events(t.id).map((e) => e.kind), ['created']);
});

test('create rejects empty and too-long titles', () => {
  const s = new Store();
  throwsStatus(() => s.create({ title: '   ' }), 400);
  throwsStatus(() => s.create({ title: 'x'.repeat(81) }), 400);
  assert.ok(s.create({ title: 'x'.repeat(80) }));
});

test('assign open -> queued; second assign 409; missing 404', () => {
  const s = new Store();
  const t = s.create({ title: 'a' });
  const a = s.assign(t.id);
  assert.equal(a.status, 'queued');
  assert.equal(a.assignee, 'claude');
  assert.ok(s.events(t.id).some((e) => e.kind === 'assigned'));
  throwsStatus(() => s.assign(t.id), 409);
  throwsStatus(() => s.assign(999), 404);
  assert.equal(s.get(999), null);
});

test('retry only from failed', () => {
  const s = new Store();
  const t = s.create({ title: 'a' });
  throwsStatus(() => s.retry(t.id), 409);
  s.assign(t.id);
  s.setStatus(t.id, 'failed', { output: 'boom' });
  const r = s.retry(t.id);
  assert.equal(r.status, 'queued');
  throwsStatus(() => s.retry(t.id), 409);
});

test('setStatus stores fields; list newest first', () => {
  const s = new Store();
  const a = s.create({ title: 'a' });
  const b = s.create({ title: 'b' });
  const d = s.setStatus(a.id, 'done', { output: 'out', note_path: 'p.md' });
  assert.equal(d.output, 'out');
  assert.equal(d.note_path, 'p.md');
  assert.deepEqual(s.list().map((t) => t.id), [b.id, a.id]);
});

test('nextQueued returns oldest queued', () => {
  const s = new Store();
  const a = s.create({ title: 'a' });
  const b = s.create({ title: 'b' });
  assert.equal(s.nextQueued(), null);
  s.assign(b.id);
  s.assign(a.id);
  assert.equal(s.nextQueued().id, a.id);
});

test('resetWorking moves working -> queued with reset event', () => {
  const s = new Store();
  const t = s.create({ title: 'a' });
  s.assign(t.id);
  s.setStatus(t.id, 'working');
  const r = s.resetWorking();
  assert.equal(r.length, 1);
  assert.equal(s.get(t.id).status, 'queued');
  assert.ok(s.events(t.id).some((e) => e.kind === 'reset'));
});

test('onChange gets ticket and event messages', () => {
  const s = new Store();
  const t = s.create({ title: 'a' });
  const msgs = [];
  s.onChange((m) => msgs.push(m));
  s.assign(t.id);
  assert.ok(msgs.some((m) => m.type === 'ticket' && m.ticket.status === 'queued'));
  s.addEvent(t.id, 'step', 'READ');
  assert.ok(msgs.some((m) => m.type === 'event' && m.event.text === 'READ'));
});

test('failed mutation leaves no partial change and emits nothing', () => {
  const s = new Store();
  const t = s.create({ title: 'a' });
  const before = s.events(t.id).length;
  const msgs = [];
  s.onChange((m) => msgs.push(m));
  throwsStatus(() => s.setStatus(t.id, 'bogus', { output: 'x' }), 400);
  assert.equal(s.get(t.id).output, null);
  assert.equal(s.events(t.id).length, before);
  // a mid-transaction failure (output not bindable) rolls back the status too
  assert.throws(() => s.setStatus(t.id, 'done', { output: { a: 1 } }));
  assert.equal(s.get(t.id).status, 'open');
  assert.equal(msgs.length, 0);
  assert.equal(s.assign(t.id).status, 'queued');
});

test('setStatus stores usage', () => {
  const s = new Store();
  const { id } = s.create({ title: 'Cost' });
  const t = s.setStatus(id, 'done', { usage: { cost_usd: 0.41, tokens_in: 52000, tokens_out: 3100, duration_ms: 23000 } });
  assert.equal(t.cost_usd, 0.41);
  assert.equal(t.tokens_in, 52000);
  assert.equal(t.tokens_out, 3100);
  assert.equal(t.duration_ms, 23000);
});

test('an older database gains the usage columns', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-store-')), 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    assignee TEXT, status TEXT NOT NULL DEFAULT 'open', output TEXT, note_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO tickets (title, created_at, updated_at) VALUES ('old', 'x', 'x');`);
  old.close();
  const s = new Store(file);
  assert.equal(s.get(1).cost_usd, null);
  assert.equal(s.setStatus(1, 'done', { usage: { cost_usd: 0.1, tokens_in: 1, tokens_out: 2, duration_ms: 3 } }).tokens_out, 2);
});
