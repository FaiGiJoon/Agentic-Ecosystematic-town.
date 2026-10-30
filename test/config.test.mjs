import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVault, positiveNumber } from '../hq/config.js';

test('checkVault accepts a normal path with spaces', () => {
  assert.equal(checkVault('/Users/me/Documents/Obsidian Vault'), '/Users/me/Documents/Obsidian Vault');
});

for (const ch of ['*', '?', '[', ']', '!', '\\', '#', '(', ')']) {
  test(`checkVault rejects a path with ${ch}`, () => {
    assert.throws(() => checkVault(`/Users/me/vault${ch}x`), (err) => {
      assert.match(err.message, /VAULT/);
      assert.ok(err.message.includes(ch));
      return true;
    });
  });
}

test('positiveNumber uses the default when unset or empty', () => {
  assert.equal(positiveNumber('PORT', undefined, 4317, { integer: true, max: 65535 }), 4317);
  assert.equal(positiveNumber('PORT', '', 4317, { integer: true, max: 65535 }), 4317);
  assert.equal(positiveNumber('MAX_BUDGET_USD', '0.5', 1), 0.5);
  assert.equal(positiveNumber('PORT', '65535', 4317, { integer: true, max: 65535 }), 65535);
});

for (const [name, raw, opts] of [
  ['PORT', 'abc', { integer: true, max: 65535 }],
  ['PORT', '0', { integer: true, max: 65535 }],
  ['PORT', '-1', { integer: true, max: 65535 }],
  ['PORT', '80.5', { integer: true, max: 65535 }],
  ['PORT', '65536', { integer: true, max: 65535 }],
  ['TICKET_TIMEOUT_MS', 'Infinity', {}],
  ['TICKET_TIMEOUT_MS', '0', {}],
  ['MAX_BUDGET_USD', 'NaN', {}],
  ['MAX_BUDGET_USD', '-2', {}],
]) {
  test(`positiveNumber rejects ${name}=${raw}`, () => {
    assert.throws(() => positiveNumber(name, raw, 1, opts), (err) => {
      assert.ok(err.message.includes(name), err.message);
      assert.ok(err.message.includes(raw), err.message);
      return true;
    });
  });
}

test('config refuses a bad PORT at startup', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['-e', "import('./hq/config.js')"], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: 'nope', VAULT: '/tmp/v' }, encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PORT/);
});
