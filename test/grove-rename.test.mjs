import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KOALAS, migrateNames } from '../hq/grove-world.js';
import { Grove } from '../hq/grove.js';

test('the koalas are Crystal (a girl) and Ruby (a boy)', () => {
  assert.deepEqual(KOALAS.map((k) => k.id), ['crystal', 'ruby']);
  const [crystal, ruby] = KOALAS;
  assert.equal(crystal.name, 'Crystal');
  assert.match(crystal.persona, /girl \(she\/her\)/);
  assert.match(ruby.persona, /boy \(he\/him\)/);
  assert.doesNotMatch(crystal.persona + ruby.persona, /Mallee|Bramble/);
});

test('migrateNames swaps the old names for the new ones, whole words only', () => {
  assert.equal(migrateNames('Mallee told Bramble.'), 'Crystal told Ruby.');
  assert.equal(migrateNames('Bramblewood'), 'Bramblewood');
  assert.equal(migrateNames(''), '');
});

test('an old grove with Mallee and Bramble wakes up as Crystal and Ruby', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-rename-'));
  const file = path.join(dir, 'grove.sqlite');
  // A grove as the old code left it.
  const seed = new Grove({ path: file, think: async () => ({ ok: true, raw: { action: 'sit' }, usage: null }) });
  seed.close();
  const db = new DatabaseSync(file);
  db.exec('DELETE FROM grove_koalas');
  const ins = db.prepare('INSERT INTO grove_koalas (id, data) VALUES (?, ?)');
  ins.run('mallee', JSON.stringify({ id: 'mallee', name: 'Mallee', memories: ['Bramble is kind'], recent: ['Bramble said: "hi"'], opinion: '' }));
  ins.run('bramble', JSON.stringify({ id: 'bramble', name: 'Bramble', memories: [], recent: [], opinion: 'Mallee is brave' }));
  db.prepare('INSERT INTO grove_log (ts, koala, kind, text) VALUES (?, ?, ?, ?)').run(1, 'mallee', 'act', 'Mallee went to the pond');
  db.prepare('INSERT INTO grove_usage (ts, koala, ok, cost_usd, tokens_in, tokens_out, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, 'bramble', 1, 0.001, 10, 2, 5);
  db.close();

  const g = new Grove({ path: file, think: async () => ({ ok: true, raw: { action: 'sit' }, usage: null }) });
  const s = g.state();
  assert.deepEqual(s.koalas.map((k) => k.id), ['crystal', 'ruby']);
  const [crystal, ruby] = s.koalas;
  assert.equal(crystal.name, 'Crystal');
  assert.deepEqual(crystal.memories, ['Ruby is kind']);
  assert.deepEqual(crystal.recent, ['Ruby said: "hi"']);
  assert.equal(ruby.opinion, 'Crystal is brave');
  const line = s.log.find((e) => e.text.includes('pond'));
  assert.equal(line.koala, 'crystal');
  assert.equal(line.text, 'Crystal went to the pond');
  assert.equal(s.usage.byKoala.ruby.total.calls, 1);
  g.close();
  const check = new DatabaseSync(file);
  assert.equal(check.prepare("SELECT COUNT(*) AS n FROM grove_koalas WHERE id IN ('mallee', 'bramble')").get().n, 0);
  check.close();
});
