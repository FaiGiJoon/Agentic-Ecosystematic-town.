import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A leading "~" expands to the home directory.
function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// The vault path ends up inside Claude permission rules, where these characters
// have special meaning; refuse them instead of producing a rule that misses.
const SPECIAL = /[*?[\]!\\#()]/;

export function checkVault(p) {
  const bad = p.match(SPECIAL);
  if (bad) {
    throw new Error(`VAULT path must not contain any of * ? [ ] ! \\ # ( ), found "${bad[0]}" in: ${p}`);
  }
  return p;
}

// A numeric env value: unset or empty gives the default; anything else must be a
// finite number above 0 (and an integer up to max when asked), or startup stops.
export function positiveNumber(name, raw, fallback, { integer = false, max = Infinity } = {}) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  const ok = Number.isFinite(n) && n > 0 && n <= max && (!integer || Number.isInteger(n));
  if (!ok) {
    const want = integer ? `a whole number from 1 to ${max}` : 'a number above 0';
    throw new Error(`${name} must be ${want}, got: ${raw}`);
  }
  return n;
}

const env = process.env;

export default {
  port: positiveNumber('PORT', env.PORT, 4317, { integer: true, max: 65535 }),
  vault: checkVault(expandHome(env.VAULT || '~/Documents/Obsidian Vault')),
  claudeBin: env.CLAUDE_BIN || 'claude',
  timeoutMs: positiveNumber('TICKET_TIMEOUT_MS', env.TICKET_TIMEOUT_MS, 600000),
  maxBudgetUsd: positiveNumber('MAX_BUDGET_USD', env.MAX_BUDGET_USD, 1),
  desk: env.DESK === 'off' ? null : {
    pollMs: positiveNumber('DESK_POLL_MS', env.DESK_POLL_MS, 60000, { integer: true }),
    fee: positiveNumber('DESK_FEE', env.DESK_FEE, 0.004, { max: 0.05 }),
    startUsd: positiveNumber('DESK_START_USD', env.DESK_START_USD, 1000),
    maxTradeUsd: positiveNumber('DESK_MAX_TRADE_USD', env.DESK_MAX_TRADE_USD, 250),
    maxDayUsd: positiveNumber('DESK_MAX_DAY_USD', env.DESK_MAX_DAY_USD, 2000),
    maxLossPct: positiveNumber('DESK_MAX_LOSS_PCT', env.DESK_MAX_LOSS_PCT, 25, { max: 100 }),
    approval: env.DESK_APPROVAL === 'on',
  },
  root,
  dataDir: path.join(root, 'data'),
  workDir: path.join(root, 'work'),
};
