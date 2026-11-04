import test from 'node:test';
import assert from 'node:assert/strict';
import { positiveNumber } from '../hq/config.js';

test('positiveNumber uses the default when unset or empty', () => {
  assert.equal(positiveNumber('PORT', undefined, 4317, { integer: true, max: 65535 }), 4317);
  assert.equal(positiveNumber('PORT', '', 4317, { integer: true, max: 65535 }), 4317);
  assert.equal(positiveNumber('GROVE_DAY_USD', '0.5', 1), 0.5);
  assert.equal(positiveNumber('PORT', '65535', 4317, { integer: true, max: 65535 }), 65535);
});

for (const [name, raw, opts] of [
  ['PORT', 'abc', { integer: true, max: 65535 }],
  ['PORT', '0', { integer: true, max: 65535 }],
  ['PORT', '-1', { integer: true, max: 65535 }],
  ['PORT', '80.5', { integer: true, max: 65535 }],
  ['PORT', '65536', { integer: true, max: 65535 }],
  ['GROVE_DAY_USD', 'Infinity', {}],
  ['GROVE_DAY_USD', 'NaN', {}],
  ['GROVE_CALL_USD', '-2', {}],
  ['GROVE_CALL_USD', '2', { max: 1 }],
]) {
  test(`positiveNumber rejects ${name}=${raw}`, () => {
    assert.throws(() => positiveNumber(name, raw, 1, opts), (err) => {
      assert.ok(err.message.includes(name), err.message);
      assert.ok(err.message.includes(raw), err.message);
      return true;
    });
  });
}

test('config refuses a bad setting at startup', async () => {
  const { spawnSync } = await import('node:child_process');
  for (const env of [{ PORT: 'nope' }, { GROVE_DAY_USD: 'lots' }]) {
    const r = spawnSync(process.execPath, ['-e', "import('./hq/config.js')"], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, ...env }, encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(Object.keys(env)[0]));
  }
});

test('config: the koalas default to Haiku, a $0.05 call budget and a $0.50 day', async () => {
  const { default: config } = await import('../hq/config.js');
  assert.equal(config.grove.model, 'claude-haiku-5-5');
  assert.equal(config.grove.callUsd, 0.05);
  assert.equal(config.grove.dayUsd, 0.5);
  assert.equal(config.port, 4317);
});
