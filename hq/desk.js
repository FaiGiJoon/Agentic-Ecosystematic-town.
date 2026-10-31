// The paper desk: the town's traders trade live market prices with paper money.
// Buys fill at the real ask, sells at the real bid, and every fill pays the
// exchange fee, so results are what these strategies would really have earned.
// Guards (caps, loss limit, kill switch, approvals) sit in front of every order;
// a broker for real money would plug in behind the same guards (see #fill).

import { DatabaseSync } from 'node:sqlite';
import { COINS, fetchPrices as defaultFetchPrices } from './desk-feed.js';
import { TRADERS, decide } from './desk-strategies.js';

const SYMS = COINS.map((c) => c.sym);
const HISTORY = 240;
const PENDING_MS = 5 * 60 * 1000;

export const DESK_DEFAULTS = {
  pollMs: 60000,
  fee: 0.004, // Kraken's taker fee at the lowest volume tier
  startUsd: 1000,
  maxTradeUsd: 250,
  maxDayUsd: 2000,
  maxLossPct: 25,
  approval: false,
  snapshotEvery: 5,
};

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export class Desk {
  #listeners = [];
  #timer = null;

  constructor({ path = ':memory:', config = {}, fetchPrices = defaultFetchPrices, now = () => Date.now(), rng = Math.random } = {}) {
    this.config = { ...DESK_DEFAULTS, ...config };
    this.fetchPrices = fetchPrices;
    this.now = now;
    this.rng = rng;
    this.prices = null;
    this.pricesAt = 0;
    this.feedError = null;
    this.history = Object.fromEntries(SYMS.map((s) => [s, []]));

    const db = (this.db = new DatabaseSync(path));
    db.exec(`
      CREATE TABLE IF NOT EXISTS desk_accounts (trader TEXT PRIMARY KEY, cash REAL NOT NULL, start REAL NOT NULL, holdings TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS desk_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, trader TEXT NOT NULL, sym TEXT NOT NULL,
        side TEXT NOT NULL, usd REAL, qty REAL, price REAL, fee REAL, status TEXT NOT NULL, why TEXT, reason TEXT);
      CREATE INDEX IF NOT EXISTS desk_orders_trader ON desk_orders(trader, ts);
      CREATE TABLE IF NOT EXISTS desk_prices (ts INTEGER NOT NULL, sym TEXT NOT NULL, bid REAL, ask REAL, last REAL);
      CREATE INDEX IF NOT EXISTS desk_prices_ts ON desk_prices(ts);
      CREATE TABLE IF NOT EXISTS desk_equity (ts INTEGER NOT NULL, trader TEXT NOT NULL, equity REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS desk_equity_ts ON desk_equity(ts);
      CREATE TABLE IF NOT EXISTS desk_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    const p = (sql) => db.prepare(sql);
    this.q = {
      account: p('SELECT * FROM desk_accounts WHERE trader = ?'),
      openAccount: p('INSERT OR IGNORE INTO desk_accounts (trader, cash, start, holdings) VALUES (?, ?, ?, ?)'),
      saveAccount: p('UPDATE desk_accounts SET cash = ?, holdings = ? WHERE trader = ?'),
      order: p('INSERT INTO desk_orders (ts, trader, sym, side, usd, qty, price, fee, status, why, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      getOrder: p('SELECT * FROM desk_orders WHERE id = ?'),
      setOrder: p('UPDATE desk_orders SET status = ?, usd = ?, qty = ?, price = ?, fee = ?, reason = ? WHERE id = ?'),
      pending: p("SELECT * FROM desk_orders WHERE status = 'pending' ORDER BY id"),
      recent: p("SELECT * FROM desk_orders WHERE status != 'pending' ORDER BY id DESC LIMIT 30"),
      dayUsd: p("SELECT COALESCE(SUM(usd), 0) AS usd FROM desk_orders WHERE trader = ? AND status = 'filled' AND ts >= ?"),
      totals: p("SELECT trader, COUNT(*) AS trades, COALESCE(SUM(fee), 0) AS fees FROM desk_orders WHERE status = 'filled' GROUP BY trader"),
      price: p('INSERT INTO desk_prices (ts, sym, bid, ask, last) VALUES (?, ?, ?, ?, ?)'),
      recentPrices: p('SELECT sym, last FROM desk_prices WHERE ts >= ? ORDER BY ts'),
      pruneP: p('DELETE FROM desk_prices WHERE ts < ?'),
      equity: p('INSERT INTO desk_equity (ts, trader, equity) VALUES (?, ?, ?)'),
      curve: p('SELECT ts, trader, equity FROM desk_equity WHERE ts >= ? ORDER BY ts'),
      meta: p('SELECT value FROM desk_meta WHERE key = ?'),
      setMeta: p('INSERT INTO desk_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    };
    for (const t of TRADERS) this.q.openAccount.run(t.id, this.config.startUsd, this.config.startUsd, JSON.stringify(Object.fromEntries(SYMS.map((s) => [s, 0]))));
    // Price history survives restarts, so averages don't start from scratch.
    for (const { sym, last } of this.q.recentPrices.all(this.now() - HISTORY * this.config.pollMs)) {
      if (this.history[sym]) this.history[sym].push(last);
    }
    for (const s of SYMS) this.history[s] = this.history[s].slice(-HISTORY);
  }

  // --- persistence helpers -----------------------------------------------------------
  #meta(key, fallback = null) {
    const row = this.q.meta.get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  #setMeta(key, value) {
    this.q.setMeta.run(key, JSON.stringify(value));
  }
  account(id) {
    const row = this.q.account.get(id);
    return { cash: row.cash, start: row.start, holdings: JSON.parse(row.holdings) };
  }
  #save(id, acct) {
    this.q.saveAccount.run(acct.cash, JSON.stringify(acct.holdings), id);
  }
  get halted() {
    return this.#meta('halted', null);
  }
  get tickCount() {
    return this.#meta('tick', 0);
  }

  onChange(fn) {
    this.#listeners.push(fn);
  }
  #emit() {
    if (!this.#listeners.length) return;
    const state = this.state();
    for (const fn of this.#listeners) {
      try { fn(state); } catch (err) { console.error('desk listener failed:', err); }
    }
  }

  // Liquidation value: holdings priced at the bid, what selling now would fetch.
  equity(id) {
    const a = this.account(id);
    if (!this.prices) return a.cash;
    return a.cash + SYMS.reduce((s, sym) => s + a.holdings[sym] * this.prices[sym].bid, 0);
  }

  // --- the loop ----------------------------------------------------------------------
  async tick() {
    let prices;
    try {
      prices = await this.fetchPrices();
    } catch (err) {
      this.feedError = err.message;
      this.#emit();
      return;
    }
    const ts = this.now();
    this.prices = prices;
    this.pricesAt = ts;
    this.feedError = null;
    for (const sym of SYMS) {
      const q = prices[sym];
      this.q.price.run(ts, sym, q.bid, q.ask, q.last);
      this.history[sym].push(q.last);
      if (this.history[sym].length > HISTORY) this.history[sym].shift();
    }
    const tick = this.tickCount + 1;
    this.#setMeta('tick', tick);
    if (tick % 500 === 0) this.q.pruneP.run(ts - 30 * 24 * 3600 * 1000);

    for (const o of this.q.pending.all()) {
      if (ts - o.ts > PENDING_MS) this.q.setOrder.run('expired', o.usd, o.qty, o.price, o.fee, 'not approved within 5 minutes', o.id);
    }

    if (!this.halted) {
      for (const trader of TRADERS) {
        const intents = decide(trader, { account: this.account(trader.id), prices, history: this.history, syms: SYMS, tick, rng: this.rng });
        for (const intent of intents) this.#order(trader, intent);
      }
    }

    if (tick % this.config.snapshotEvery === 0 || tick === 1) {
      for (const t of TRADERS) this.q.equity.run(ts, t.id, this.equity(t.id));
    }
    this.#checkLossLimit();
    this.#emit();
  }

  #checkLossLimit() {
    if (this.halted) return;
    const agents = TRADERS.filter((t) => !t.benchmark);
    const start = agents.reduce((s, t) => s + this.account(t.id).start, 0);
    const now = agents.reduce((s, t) => s + this.equity(t.id), 0);
    const down = 1 - now / start;
    if (down * 100 >= this.config.maxLossPct) this.halt(`loss limit: the traders are down ${(down * 100).toFixed(1)}% together`);
  }

  // --- guards ------------------------------------------------------------------------
  // Returns the order as it may go through (possibly capped), or a rejection.
  #check(trader, intent) {
    const c = this.config;
    if (this.halted) return { reject: 'desk halted' };
    if (!this.prices || this.now() - this.pricesAt > 3 * c.pollMs) return { reject: 'prices are stale' };
    const acct = this.account(trader.id);
    const q = this.prices[intent.sym];
    const o = { ...intent };
    if (o.side === 'buy') {
      o.usd = Math.min(o.usd, acct.cash);
      if (!(o.usd >= 1)) return { skip: true };
      if (trader.benchmark) return { order: o };
      if (o.usd > c.maxTradeUsd) {
        o.usd = c.maxTradeUsd;
        o.capped = true;
      }
    } else {
      o.qty = Math.min(o.qty, acct.holdings[o.sym]);
      if (!(o.qty * q.bid >= 1)) return { skip: true };
      if (trader.benchmark) return { order: o };
      if (o.qty * q.bid > c.maxTradeUsd) {
        o.qty = c.maxTradeUsd / q.bid;
        o.capped = true;
      }
    }
    const notional = o.side === 'buy' ? o.usd : o.qty * q.bid;
    const today = this.q.dayUsd.get(trader.id, startOfDay(this.now())).usd;
    if (today + notional > c.maxDayUsd) return { reject: `daily limit of $${c.maxDayUsd} reached` };
    return { order: o };
  }

  #order(trader, intent) {
    const r = this.#check(trader, intent);
    if (r.skip) return null;
    const ts = this.now();
    if (r.reject) {
      // Repeated rejections for the same reason are not worth a row each.
      const last = this.q.recent.all().find((x) => x.trader === trader.id);
      if (last?.status === 'rejected' && last.reason === r.reject) return null;
      return this.q.order.run(ts, trader.id, intent.sym, intent.side, intent.usd ?? null, intent.qty ?? null, null, null, 'rejected', intent.why ?? '', r.reject);
    }
    const o = r.order;
    const why = (o.why ?? '') + (o.capped ? ' (capped)' : '');
    if (this.config.approval && !trader.benchmark) {
      return this.q.order.run(ts, trader.id, o.sym, o.side, o.usd ?? null, o.qty ?? null, null, null, 'pending', why, null);
    }
    const { lastInsertRowid } = this.q.order.run(ts, trader.id, o.sym, o.side, null, null, null, null, 'filling', why, null);
    this.#fill(Number(lastInsertRowid), trader, o);
    return null;
  }

  // Paper fill at the live quote. A real-money broker would replace this body.
  #fill(id, trader, o) {
    const acct = this.account(trader.id);
    const q = this.prices[o.sym];
    const fee = this.config.fee;
    if (o.side === 'buy') {
      const qty = (o.usd * (1 - fee)) / q.ask;
      acct.cash -= o.usd;
      acct.holdings[o.sym] += qty;
      this.q.setOrder.run('filled', o.usd, qty, q.ask, o.usd * fee, null, id);
    } else {
      const gross = o.qty * q.bid;
      acct.holdings[o.sym] -= o.qty;
      if (acct.holdings[o.sym] < 1e-12) acct.holdings[o.sym] = 0;
      acct.cash += gross * (1 - fee);
      this.q.setOrder.run('filled', gross, o.qty, q.bid, gross * fee, null, id);
    }
    this.#save(trader.id, acct);
  }

  // --- controls ----------------------------------------------------------------------
  halt(reason = 'kill switch') {
    this.#setMeta('halted', { reason, at: this.now() });
    for (const o of this.q.pending.all()) this.q.setOrder.run('cancelled', o.usd, o.qty, o.price, o.fee, 'desk halted', o.id);
    this.#emit();
    return this.state();
  }

  resume() {
    this.#setMeta('halted', null);
    this.#checkLossLimit(); // still over the loss limit: halts again right away
    this.#emit();
    return this.state();
  }

  decideOrder(id, approve) {
    const o = this.q.getOrder.get(id);
    if (!o) throw Object.assign(new Error('order not found'), { status: 404 });
    if (o.status !== 'pending') throw Object.assign(new Error(`order is ${o.status}`), { status: 409 });
    if (!approve) {
      this.q.setOrder.run('cancelled', o.usd, o.qty, o.price, o.fee, 'rejected by you', id);
    } else {
      const trader = TRADERS.find((t) => t.id === o.trader);
      // Guards run again at approval time, against the price now.
      const r = this.#check(trader, { sym: o.sym, side: o.side, usd: o.usd, qty: o.qty, why: o.why });
      if (r.reject || r.skip) this.q.setOrder.run('rejected', o.usd, o.qty, null, null, r.reject ?? 'nothing left to trade', id);
      else this.#fill(id, trader, r.order);
    }
    this.#emit();
    return this.q.getOrder.get(id);
  }

  start() {
    if (this.#timer) return;
    this.tick();
    this.#timer = setInterval(() => this.tick(), this.config.pollMs);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  // --- reporting ---------------------------------------------------------------------
  curve(points = 150, sinceMs = 7 * 24 * 3600 * 1000) {
    const rows = this.q.curve.all(this.now() - sinceMs);
    const stamps = [...new Set(rows.map((r) => r.ts))];
    const step = Math.max(1, Math.ceil(stamps.length / points));
    const keep = new Set(stamps.filter((_, i) => i % step === 0 || i === stamps.length - 1));
    const series = Object.fromEntries(TRADERS.map((t) => [t.id, []]));
    for (const r of rows) if (keep.has(r.ts)) series[r.trader]?.push(r.equity);
    return { ts: [...keep], series };
  }

  state() {
    const totals = Object.fromEntries(this.q.totals.all().map((r) => [r.trader, r]));
    const day = startOfDay(this.now());
    const traders = TRADERS.map((t) => {
      const a = this.account(t.id);
      const equity = this.equity(t.id);
      return {
        id: t.id,
        name: t.name,
        strategy: t.strategy,
        benchmark: !!t.benchmark,
        cash: a.cash,
        holdings: a.holdings,
        start: a.start,
        equity,
        ret: equity / a.start - 1,
        trades: totals[t.id]?.trades ?? 0,
        fees: totals[t.id]?.fees ?? 0,
        dayUsd: this.q.dayUsd.get(t.id, day).usd,
      };
    });
    return {
      mode: 'paper',
      halted: this.halted,
      feedError: this.feedError,
      pricesAt: this.pricesAt,
      prices: this.prices,
      tick: this.tickCount,
      config: { ...this.config },
      traders,
      pending: this.q.pending.all(),
      recent: this.q.recent.all(),
      curve: this.curve(),
    };
  }
}
