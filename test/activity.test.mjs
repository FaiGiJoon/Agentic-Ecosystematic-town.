import test from 'node:test';
import assert from 'node:assert/strict';
import { stepsFrom, describe } from '../hq/activity.js';

const tool = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

test('Read and Glob map to READ', () => {
  assert.deepEqual(stepsFrom(tool('Read', { file_path: '/a/b/notes.md' })), [{ label: 'READ', detail: 'notes.md' }]);
  assert.deepEqual(stepsFrom(tool('Glob', { pattern: '**/*.md' })), [{ label: 'READ', detail: '**/*.md' }]);
});

test('Grep maps to SEARCH', () => {
  assert.deepEqual(stepsFrom(tool('Grep', { pattern: 'todo' })), [{ label: 'SEARCH', detail: 'todo' }]);
});

test('WebSearch and WebFetch map to WEB', () => {
  assert.deepEqual(stepsFrom(tool('WebSearch', { query: 'gameboy palette' })), [{ label: 'WEB', detail: 'gameboy palette' }]);
  assert.deepEqual(stepsFrom(tool('WebFetch', { url: 'https://example.com' })), [{ label: 'WEB', detail: 'https://example.com' }]);
});

test('Write and Edit map to WRITE', () => {
  assert.deepEqual(stepsFrom(tool('Write', { file_path: '/x/out.md' })), [{ label: 'WRITE', detail: 'out.md' }]);
  assert.deepEqual(stepsFrom(tool('Edit', { file_path: '/x/y/z.js' })), [{ label: 'WRITE', detail: 'z.js' }]);
});

test('unknown tools map to THINK; missing input gives empty detail', () => {
  assert.deepEqual(stepsFrom(tool('TodoWrite', {})), [{ label: 'THINK', detail: '' }]);
  assert.deepEqual(stepsFrom(tool('Read', undefined)), [{ label: 'READ', detail: '' }]);
});

test('detail uses first present of file_path, pattern, query, url', () => {
  assert.equal(stepsFrom(tool('Grep', { query: 'q', url: 'u' }))[0].detail, 'q');
  assert.equal(stepsFrom(tool('Read', { file_path: '/a/f.txt', pattern: 'p' }))[0].detail, 'f.txt');
});

test('detail is truncated to 40 chars', () => {
  const long = 'x'.repeat(100);
  assert.equal(stepsFrom(tool('WebSearch', { query: long }))[0].detail, 'x'.repeat(40));
});

test('text blocks become THINK steps, empty ones are skipped', () => {
  const msg = { type: 'assistant', message: { content: [
    { type: 'text', text: 'Let me look into this ticket for you and then write it up.' },
    { type: 'text', text: '   ' },
    { type: 'tool_use', name: 'Grep', input: { pattern: 'a' } },
  ] } };
  assert.deepEqual(stepsFrom(msg), [
    { label: 'THINK', detail: 'Let me look into this ticket for you and' },
    { label: 'SEARCH', detail: 'a' },
  ]);
});

test('non-assistant and malformed messages give []', () => {
  assert.deepEqual(stepsFrom({ type: 'user', message: { content: [{ type: 'tool_result' }] } }), []);
  assert.deepEqual(stepsFrom({ type: 'result', result: 'done' }), []);
  assert.deepEqual(stepsFrom({ type: 'system', subtype: 'init' }), []);
  assert.deepEqual(stepsFrom({ type: 'assistant' }), []);
  assert.deepEqual(stepsFrom(null), []);
});

test('describe maps labels to ticker words', () => {
  assert.equal(describe({ label: 'WEB' }), 'WEB SEARCH');
  assert.equal(describe({ label: 'READ' }), 'READING');
  assert.equal(describe({ label: 'WRITE' }), 'WRITING');
  assert.equal(describe({ label: 'SEARCH' }), 'SEARCHING');
  assert.equal(describe({ label: 'THINK' }), 'THINKING');
  assert.equal(describe({ label: 'NOPE' }), 'THINKING');
  assert.equal(describe(undefined), 'THINKING');
});
