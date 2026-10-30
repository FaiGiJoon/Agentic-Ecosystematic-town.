import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { slug, noteText, writeNote } from '../hq/vault.js';

const ticket = {
  id: 3,
  title: 'Hello, World!',
  body: 'Say hi',
  assignee: 'claude',
  status: 'done',
  output: 'Hi there.',
  note_path: null,
  created_at: '2026-10-30T10:00:00.000Z',
  updated_at: '2026-10-30T10:05:00.000Z',
};
const date = new Date(2026, 9, 30, 12, 0, 0);

test('slug strips accents and symbols', () => {
  assert.equal(slug('Héllo, Wörld!'), 'hello-world');
});

test('slug falls back to ticket', () => {
  assert.equal(slug('!!!'), 'ticket');
  assert.equal(slug(''), 'ticket');
});

test('slug is at most 40 chars with no trailing dash', () => {
  assert.equal(slug('a'.repeat(100)), 'a'.repeat(40));
  const s = slug('a'.repeat(39) + ' b');
  assert.equal(s, 'a'.repeat(39));
});

test('noteText matches the exact format', () => {
  assert.equal(
    noteText(ticket, date),
    [
      '---',
      'type: note',
      'status: active',
      'tags: [agent-hq]',
      'created: 2026-10-30',
      'updated: 2026-10-30',
      'source: "agent-hq #3"',
      '---',
      '',
      '# Hello, World!',
      '',
      '## Request',
      '',
      'Say hi',
      '',
      '## Result',
      '',
      'Hi there.',
      '',
    ].join('\n'),
  );
});

test('noteText flattens whitespace in the heading', () => {
  assert.match(noteText({ ...ticket, title: 'Line one\n\n  line   two' }, date), /\n# Line one line two\n/);
});

test('noteText uses placeholder for empty body', () => {
  assert.match(noteText({ ...ticket, body: '' }, date), /## Request\n\n\(no details\)\n\n## Result/);
});

test('writeNote writes into 00-inbox and never overwrites', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-vault-'));
  try {
    await fs.mkdir(path.join(vault, '00-inbox'));
    const p1 = await writeNote(vault, ticket, date);
    assert.equal(p1, path.join(vault, '00-inbox', 'agent-hq-3-hello-world.md'));
    assert.equal(await fs.readFile(p1, 'utf8'), noteText(ticket, date));
    const p2 = await writeNote(vault, ticket, date);
    assert.equal(path.basename(p2), 'agent-hq-3-hello-world-2.md');
    const p3 = await writeNote(vault, ticket, date);
    assert.equal(path.basename(p3), 'agent-hq-3-hello-world-3.md');
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
});

test('writeNote rejects when 00-inbox is missing', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-vault-'));
  try {
    await assert.rejects(() => writeNote(vault, ticket, date));
    await assert.rejects(() => fs.stat(path.join(vault, '00-inbox')));
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
});
