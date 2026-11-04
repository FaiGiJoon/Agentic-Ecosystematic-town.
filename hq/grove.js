// Koala Grove: two koalas whose every move is a real model decision.
// Thinking costs real tokens, so it only happens while the player has pressed
// Play and a grove page keeps checking in, and never past the daily cap. Memory,
// the relationship and every call's real usage are kept in sqlite (data/).

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  KOALAS, ITEMS, BLUEPRINTS, PLOTS, LANDS, placesOf, landOf, newKoala, parseDecision, applyDecision, drift, groveClock, DAY_MS, buildPrompt, systemPrompt, growthOf, carryLimit,
} from './grove-world.js';
import { koalaArgs, think as callClaude } from './grove-brain.js';

export const GROVE_DEFAULTS = {
  model: 'claude-haiku-5-5',
  callUsd: 0.05, // --max-budget-usd for one decision
  dayUsd: 0.5, // no new calls once today's real spend reaches this
  bin: 'claude',
  workDir: null,
  timeoutMs: 60000,
  minMs: 20000, // a koala thinks every 20-60 s on its own...
  maxMs: 60000,
  replyMinMs: 6000, // ...sooner when spoken to or given something
  replyMaxMs: 12000,
  gapMs: 12000, // never two decisions of one koala closer than this
  failMs: 60000,
  presenceMs: 45000, // the page must check in this often
  tickMs: 1000,
  maxFailures: 3,
};

const LOG_ROWS = 80;
// Times of day the visitor can jump to, in minutes after midnight.
const TIMES = { morning: 7 * 60, noon: 12 * 60, evening: 18 * 60 + 30, night: 22 * 60 };

export class GroveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export class Grove {
  #listeners = [];
  #timer = null;
  #inflight = new Set();
  #run = {}; // per koala: nextAt, thinking, lastStart, replyDue
  #heartbeatAt = 0;
  #lastDrift = 0;
  #wasPresent = false;
  #failures = 0;

  constructor({ path = ':memory:', config = {}, think = null, now = () => Date.now(), rng = Math.random } = {}) {
    this.config = { ...GROVE_DEFAULTS, ...config };
    this.now = now;
    this.rng = rng;
    this.brain = think ?? ((req) => this.#callClaude(req));

    const db = (this.db = new DatabaseSync(path));
    db.exec(`
      CREATE TABLE IF NOT EXISTS grove_koalas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grove_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, koala TEXT, kind TEXT NOT NULL,
        text TEXT NOT NULL, action TEXT, target TEXT);
      CREATE TABLE IF NOT EXISTS grove_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, koala TEXT NOT NULL, ok INTEGER NOT NULL,
        cost_usd REAL NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, duration_ms INTEGER);
      CREATE INDEX IF NOT EXISTS grove_usage_ts ON grove_usage(ts);
      CREATE TABLE IF NOT EXISTS grove_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    const p = (sql) => db.prepare(sql);
    this.q = {
      koala: p('SELECT data FROM grove_koalas WHERE id = ?'),
      saveKoala: p('INSERT INTO grove_koalas (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'),
      log: p('INSERT INTO grove_log (ts, koala, kind, text, action, target) VALUES (?, ?, ?, ?, ?, ?)'),
      recentLog: p('SELECT * FROM grove_log ORDER BY id DESC LIMIT ?'),
      usage: p('INSERT INTO grove_usage (ts, koala, ok, cost_usd, tokens_in, tokens_out, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      sums: p(`SELECT koala, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(tokens_in), 0) AS tokens_in,
        COALESCE(SUM(tokens_out), 0) AS tokens_out FROM grove_usage WHERE ts >= ? GROUP BY koala`),
      lastUsage: p('SELECT * FROM grove_usage ORDER BY id DESC LIMIT 1'),
      meta: p('SELECT value FROM grove_meta WHERE key = ?'),
      setMeta: p('INSERT INTO grove_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    };

    // The koalas' world: themselves, and what they have built together.
    this.world = { koalas: {}, builds: [] };
    for (const k of KOALAS) {
      const row = this.q.koala.get(k.id);
      this.world.koalas[k.id] = row ? { ...newKoala(k.id), ...JSON.parse(row.data) } : newKoala(k.id);
      this.#run[k.id] = { nextAt: Infinity, thinking: false, lastStart: 0, replyDue: false };
    }
    this.world.builds = this.#meta('builds', []);
    if (this.#meta('epoch') == null) this.#setMeta('epoch', this.now());
    if (this.playing) this.#schedule();
  }

  // --- persistence helpers -----------------------------------------------------------
  #meta(key, fallback = null) {
    const row = this.q.meta.get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  #setMeta(key, value) {
    this.q.setMeta.run(key, JSON.stringify(value));
  }
  #save(id) {
    this.q.saveKoala.run(id, JSON.stringify(this.world.koalas[id]));
  }
  #log(entry) {
    this.q.log.run(this.now(), entry.koala ?? null, entry.kind, entry.text, entry.action ?? null, entry.target ?? null);
  }

  get playing() {
    return this.#meta('playing', false);
  }
  get present() {
    return this.now() - this.#heartbeatAt < this.config.presenceMs;
  }

  onChange(fn) {
    this.#listeners.push(fn);
  }
  #emit() {
    if (!this.#listeners.length) return;
    const state = this.state();
    for (const fn of this.#listeners) {
      try { fn(state); } catch (err) { console.error('grove listener failed:', err); }
    }
  }

  // --- spend ---------------------------------------------------------------------------
  #sums(since) {
    const out = { total: { calls: 0, cost: 0, tokens_in: 0, tokens_out: 0 } };
    for (const k of KOALAS) out[k.id] = { calls: 0, cost: 0, tokens_in: 0, tokens_out: 0 };
    for (const r of this.q.sums.all(since)) {
      const row = { calls: r.calls, cost: r.cost, tokens_in: r.tokens_in, tokens_out: r.tokens_out };
      out[r.koala] = row;
      for (const key of Object.keys(row)) out.total[key] += row[key];
    }
    return out;
  }
  spentToday() {
    return this.#sums(startOfDay(this.now())).total.cost;
  }
  get capped() {
    return this.spentToday() >= this.config.dayUsd;
  }

  // --- scheduling ----------------------------------------------------------------------
  #between(lo, hi) {
    return lo + (hi - lo) * this.rng();
  }
  #schedule() {
    KOALAS.forEach((k, i) => {
      if (!this.#run[k.id].thinking) this.#run[k.id].nextAt = this.now() + 1000 + i * 2500;
    });
  }
  // Something happened to this koala: let it react soon, but not sooner than the gap allows.
  #nudge(id) {
    const r = this.#run[id];
    if (r.thinking) {
      r.replyDue = true;
      return;
    }
    const soon = Math.max(this.now() + this.#between(this.config.replyMinMs, this.config.replyMaxMs), r.lastStart + this.config.gapMs);
    r.nextAt = Math.min(r.nextAt, soon);
  }

  tick() {
    const now = this.now();
    const present = this.present;
    const active = this.playing && present;
    if (active && this.#lastDrift) {
      const minutes = Math.min(2, (now - this.#lastDrift) / 60000);
      for (const k of KOALAS) {
        drift(this.world.koalas[k.id], minutes);
        this.#save(k.id);
      }
    }
    this.#lastDrift = now;
    if (present !== this.#wasPresent) {
      this.#wasPresent = present;
      this.#emit();
    }
    if (!active || this.capped) return;
    for (const k of KOALAS) {
      const r = this.#run[k.id];
      if (!r.thinking && now >= r.nextAt) this.#decide(k.id);
    }
  }

  #decide(id) {
    const r = this.#run[id];
    r.thinking = true;
    r.replyDue = false;
    r.lastStart = this.now();
    const req = {
      koala: id,
      system: systemPrompt(id),
      prompt: buildPrompt(this.world, id, this.clock()),
    };
    let call;
    try { call = Promise.resolve(this.brain(req)); } catch (err) { call = Promise.reject(err); }
    const job = call
      .catch((err) => ({ ok: false, raw: null, usage: null, error: err.message }))
      .then((out) => this.#finish(id, out))
      .catch((err) => console.error('grove decision failed:', err))
      .finally(() => {
        this.#inflight.delete(job);
        r.thinking = false;
        this.#emit();
      });
    this.#inflight.add(job);
    this.#emit();
  }

  #finish(id, out) {
    const r = this.#run[id];
    const u = out.usage;
    const decision = out.ok ? parseDecision(out.raw, this.world.koalas[id], placesOf(this.world)) : null;
    if (u) this.q.usage.run(this.now(), id, decision ? 1 : 0, u.cost_usd, u.tokens_in, u.tokens_out, u.duration_ms);
    if (!decision) {
      const why = out.ok ? 'Reply was not a decision' : out.error;
      this.#log({ koala: id, kind: 'error', text: `${this.world.koalas[id].name}'s call failed: ${why}` });
      r.nextAt = this.now() + this.config.failMs;
      if (++this.#failures >= this.config.maxFailures && this.playing) {
        this.pause(`Calls failed ${this.#failures} times in a row: ${why}`);
      }
      return;
    }
    this.#failures = 0;
    if (decision.thought) this.#log({ koala: id, kind: 'think', text: decision.thought });
    for (const entry of applyDecision(this.world, id, decision)) this.#log(entry);
    for (const other of KOALAS) this.#save(other.id);
    this.#setMeta('builds', this.world.builds);
    const friend = KOALAS.find((x) => x.id !== id).id;
    if (decision.say || decision.action === 'give' || decision.action === 'approach') this.#nudge(friend);
    let next = this.now() + this.#between(this.config.minMs, this.config.maxMs);
    if (r.replyDue) next = Math.min(next, Math.max(this.now() + this.#between(this.config.replyMinMs, this.config.replyMaxMs), r.lastStart + this.config.gapMs));
    r.nextAt = next;
    r.replyDue = false;
  }

  async idle() {
    while (this.#inflight.size) await Promise.all([...this.#inflight]);
  }

  // --- controls ------------------------------------------------------------------------
  play() {
    this.#setMeta('playing', true);
    this.#setMeta('pausedReason', null);
    this.#failures = 0;
    this.#schedule();
    this.#emit();
    return this.state();
  }

  pause(reason = null) {
    this.#setMeta('playing', false);
    this.#setMeta('pausedReason', reason);
    for (const k of KOALAS) if (!this.#run[k.id].thinking) this.#run[k.id].nextAt = Infinity;
    if (reason) this.#log({ kind: 'system', text: `Paused: ${reason}` });
    this.#emit();
    return this.state();
  }

  // The visitor moves the grove's clock to a time of day. It only ever goes forward, so an
  // earlier time means the next day; both koalas notice the change in the light.
  setTime(to) {
    const at = TIMES[to];
    if (at == null) throw new GroveError(400, `time must be one of: ${Object.keys(TIMES).join(', ')}`);
    const c = this.clock();
    const now = (c.day - 1) * 1440 + c.hour * 60 + c.minute;
    let want = (c.day - 1) * 1440 + at;
    if (want <= now) want += 1440;
    // groveClock starts its first day at 08:00 (480 minutes in).
    this.#setMeta('epoch', this.now() - ((want - 480) / 1440) * DAY_MS);
    for (const k of KOALAS) {
      const koala = this.world.koalas[k.id];
      koala.recent.push(`The light changed all at once: it is ${to} now.`);
      if (koala.recent.length > 10) koala.recent.splice(0, koala.recent.length - 10);
      this.#save(k.id);
    }
    this.#log({ kind: 'system', text: `You turned the grove's clock to ${to}: ${this.clock().label}` });
    this.#emit();
    return this.state();
  }

  heartbeat() {
    this.#heartbeatAt = this.now();
    if (!this.#wasPresent) {
      this.#wasPresent = true;
      this.#emit();
    }
    return { ok: true };
  }

  // The visitor gives an item, says something or gives a pat. Costs no tokens itself.
  act({ koala, kind, item, text } = {}) {
    const k = this.world.koalas[koala];
    if (!k || !Object.hasOwn(this.world.koalas, koala)) throw new GroveError(404, 'no such koala');
    if (kind === 'give') {
      if (!ITEMS.includes(item)) throw new GroveError(400, `item must be one of: ${ITEMS.join(', ')}`);
      if (k.inventory.length >= carryLimit(k.strength)) throw new GroveError(409, `${k.name}'s paws are full`);
      k.inventory.push(item);
      k.recent.push(`The visitor gave you a ${item}.`);
      this.#log({ koala, kind: 'visitor', text: `You gave ${k.name} a ${item}`, action: 'give', target: item });
    } else if (kind === 'say') {
      const t = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
      if (!t || t.length > 140) throw new GroveError(400, 'say 1 to 140 characters');
      k.recent.push(`The visitor said: "${t}"`);
      this.#log({ koala, kind: 'visitor', text: `You to ${k.name}: "${t}"`, action: 'say' });
    } else if (kind === 'pet') {
      k.recent.push('The visitor gave you a gentle pat on the head.');
      this.#log({ koala, kind: 'visitor', text: `You patted ${k.name}`, action: 'pet' });
    } else {
      throw new GroveError(400, 'kind must be give, say or pet');
    }
    if (k.recent.length > 10) k.recent.splice(0, k.recent.length - 10);
    this.#save(koala);
    this.#nudge(koala);
    this.#emit();
    return this.state();
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.tick(), this.config.tickMs);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  close() {
    this.stop();
    this.db.close();
  }

  // The real model call, with the user's Claude Code login.
  async #callClaude({ system, prompt }) {
    const c = this.config;
    if (c.workDir) fs.mkdirSync(c.workDir, { recursive: true });
    return callClaude({ bin: c.bin, args: koalaArgs({ system, prompt, model: c.model, callUsd: c.callUsd }), cwd: c.workDir ?? process.cwd(), timeoutMs: c.timeoutMs });
  }

  // --- reporting -----------------------------------------------------------------------
  clock() {
    return groveClock(this.now() - this.#meta('epoch', this.now()));
  }

  state() {
    const now = this.now();
    const today = this.#sums(startOfDay(now));
    const total = this.#sums(0);
    const last = this.q.lastUsage.get();
    return {
      playing: this.playing,
      pausedReason: this.#meta('pausedReason', null),
      present: this.present,
      capped: today.total.cost >= this.config.dayUsd,
      clock: this.clock(),
      places: placesOf(this.world),
      items: ITEMS,
      builds: this.world.builds,
      blueprints: BLUEPRINTS,
      plots: PLOTS,
      lands: LANDS.map((l) => ({ ...l, risen: landOf(this.world).includes(l) })),
      koalas: KOALAS.map((k) => ({
        ...this.world.koalas[k.id],
        ...growthOf(this.world.koalas[k.id]),
        color: k.color,
        thinking: this.#run[k.id].thinking,
        nextAt: this.#run[k.id].nextAt === Infinity ? null : this.#run[k.id].nextAt,
      })),
      log: this.q.recentLog.all(LOG_ROWS).reverse(),
      usage: {
        model: this.config.model,
        dayUsd: this.config.dayUsd,
        callUsd: this.config.callUsd,
        today: today.total,
        total: total.total,
        byKoala: Object.fromEntries(KOALAS.map((k) => [k.id, { today: today[k.id], total: total[k.id] }])),
        last: last ? { koala: last.koala, ok: !!last.ok, cost: last.cost_usd, tokens_in: last.tokens_in, tokens_out: last.tokens_out, ms: last.duration_ms, ts: last.ts } : null,
      },
      now,
    };
  }
}
