import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  // Two koalas on real model calls; GROVE_DAY_USD caps today's real spend.
  grove: {
    model: env.GROVE_MODEL || 'claude-haiku-5-5',
    bin: env.GROVE_BIN || env.CLAUDE_BIN || 'claude',
    callUsd: positiveNumber('GROVE_CALL_USD', env.GROVE_CALL_USD, 0.05, { max: 1 }),
    dayUsd: positiveNumber('GROVE_DAY_USD', env.GROVE_DAY_USD, 0.5),
    // research trips use web search: rarer, and with their own budget
    researchPerDay: positiveNumber('GROVE_RESEARCH_PER_DAY', env.GROVE_RESEARCH_PER_DAY, 16, { integer: true, max: 50 }),
    // reading a book from the library: its own daily count and price
    readsPerDay: positiveNumber('GROVE_READS_PER_DAY', env.GROVE_READS_PER_DAY, 16, { integer: true, max: 100 }),
    readUsd: positiveNumber('GROVE_READ_USD', env.GROVE_READ_USD, 0.03, { max: 1 }),
    researchUsd: positiveNumber('GROVE_RESEARCH_USD', env.GROVE_RESEARCH_USD, 0.1, { max: 1 }),
  },
  root,
  dataDir: path.join(root, 'data'),
  workDir: path.join(root, 'work'),
};
