// The Town Exchange: three simulated coins traded with play-money credits (¢).
// Nothing here touches a real chain or real money.

export const COINS = [
  { sym: 'CASP', name: 'Casper Coin', price: 100, vol: 0.006, color: '#f2c14e', blurb: 'The town reserve coin. Slow and steady-ish.' },
  { sym: 'BLOK', name: 'Blok', price: 12, vol: 0.011, color: '#e8774a', blurb: 'Pumps when builders finish buildings.' },
  { sym: 'TOKN', name: 'Token Token', price: 3, vol: 0.016, color: '#7fd1e8', blurb: 'Tracks how many LLM tokens the town burns.' },
];

export const FEE = 0.003; // taker fee, paid to the exchange

export class Market {
  constructor(rng, bus) {
    this.rng = rng;
    this.bus = bus;
    this.coins = {};
    for (const c of COINS) {
      this.coins[c.sym] = { ...c, base: c.price, open: c.price, history: Array(60).fill(c.price), pressure: 0, drift: 0 };
    }
    this.volume = 0;
    this.trades = [];
  }

  price(sym) {
    return this.coins[sym].price;
  }

  change(sym) {
    const c = this.coins[sym];
    return c.price / c.open - 1;
  }

  // One market step. `fund` carries the town fundamentals that move prices.
  step(fund) {
    for (const c of Object.values(this.coins)) {
      // fair value follows town fundamentals; price mean-reverts toward it
      const fair = c.base * (c.sym === 'CASP' ? 1 + 0.02 * fund.buildings : c.sym === 'BLOK' ? 1 + 0.06 * fund.buildings + 0.15 * fund.buildRate : Math.pow(Math.max(500, fund.tokenRate) / 20000, 0.35));
      let mu = c.drift - 0.004 * Math.log(c.price / fair);
      // mean-revert drift from news so spikes fade
      c.drift *= 0.97;
      const shock = this.rng.gauss() * c.vol;
      c.price = Math.max(0.01, c.price * Math.exp(mu + shock + c.pressure));
      c.pressure *= 0.6;
      c.history.push(c.price);
      if (c.history.length > 300) c.history.shift();
    }
  }

  // Market impact: buying lifts the price a little, selling lowers it.
  execute(trader, sym, side, notional) {
    const c = this.coins[sym];
    const impact = Math.min(0.008, notional / 250000);
    c.pressure += side === 'buy' ? impact : -impact;
    this.volume += notional;
    const t = { trader: trader.id, name: trader.name, sym, side, notional, price: c.price };
    this.trades.push(t);
    if (this.trades.length > 80) this.trades.shift();
    this.bus.emit('trade', t);
  }

  news(sym, drift, headline) {
    this.coins[sym].drift += drift;
    this.bus.emit('news', { sym, drift, headline });
  }

  newDay() {
    for (const c of Object.values(this.coins)) c.open = c.price;
  }
}

// Wallets for agents, the player and the treasury. `cash` is play credits.
export class Ledger {
  constructor(bus, market) {
    this.bus = bus;
    this.market = market;
    this.accounts = new Map();
  }

  open(id, cash = 0, holdings = {}) {
    const acct = { id, cash, holdings: { CASP: 0, BLOK: 0, TOKN: 0, ...holdings }, fees: 0 };
    this.accounts.set(id, acct);
    return acct;
  }

  get(id) {
    return this.accounts.get(id);
  }

  value(id) {
    const a = this.get(id);
    let v = a.cash;
    for (const [sym, q] of Object.entries(a.holdings)) v += q * this.market.price(sym);
    return v;
  }

  // Peer-to-peer send between two wallets. asset is 'cash' or a coin symbol.
  transfer(fromId, toId, asset, amount, memo = '') {
    const from = this.get(fromId);
    const to = this.get(toId);
    if (!from || !to || !(amount > 0)) return false;
    const have = asset === 'cash' ? from.cash : from.holdings[asset];
    if (have < amount - 1e-9) return false;
    if (asset === 'cash') {
      from.cash -= amount;
      to.cash += amount;
    } else {
      from.holdings[asset] -= amount;
      to.holdings[asset] += amount;
    }
    this.bus.emit('transfer', { from: fromId, to: toId, asset, amount, memo });
    return true;
  }

  buy(id, sym, cash, trader = { id, name: id }) {
    const a = this.get(id);
    cash = Math.min(cash, a.cash);
    if (cash <= 0.01) return 0;
    const fee = cash * FEE;
    const qty = (cash - fee) / this.market.price(sym);
    a.cash -= cash;
    a.holdings[sym] += qty;
    this.get('exchange').cash += fee;
    this.market.execute(trader, sym, 'buy', cash);
    return qty;
  }

  sell(id, sym, qty, trader = { id, name: id }) {
    const a = this.get(id);
    qty = Math.min(qty, a.holdings[sym]);
    if (qty <= 1e-9) return 0;
    const gross = qty * this.market.price(sym);
    const fee = gross * FEE;
    a.holdings[sym] -= qty;
    a.cash += gross - fee;
    this.get('exchange').cash += fee;
    this.market.execute(trader, sym, 'sell', gross);
    return gross - fee;
  }
}

// Agent funds: the player can back a trader agent and share in its P&L.
// Shares are priced at the agent wallet's net asset value (NAV).
export class Funds {
  constructor(bus, ledger) {
    this.bus = bus;
    this.ledger = ledger;
    this.funds = new Map();
  }

  create(agentId) {
    const nav = this.ledger.value(agentId);
    this.funds.set(agentId, { agentId, shares: nav, investors: new Map([[agentId, nav]]), startNav: 1 });
  }

  pps(agentId) {
    const f = this.funds.get(agentId);
    return f.shares > 0 ? this.ledger.value(agentId) / f.shares : 1;
  }

  position(agentId, investorId) {
    const f = this.funds.get(agentId);
    const shares = f.investors.get(investorId) ?? 0;
    return { shares, value: shares * this.pps(agentId) };
  }

  invest(investorId, agentId, amount) {
    const f = this.funds.get(agentId);
    const pps = this.pps(agentId);
    if (!this.ledger.transfer(investorId, agentId, 'cash', amount, 'fund deposit')) return 0;
    const shares = amount / pps;
    f.shares += shares;
    f.investors.set(investorId, (f.investors.get(investorId) ?? 0) + shares);
    this.bus.emit('fund', { kind: 'invest', investorId, agentId, amount });
    return shares;
  }

  // Redeem all of an investor's shares; the agent sells coins pro rata if it lacks cash.
  withdraw(investorId, agentId) {
    const f = this.funds.get(agentId);
    const shares = f.investors.get(investorId) ?? 0;
    if (shares <= 0) return 0;
    const fraction = shares / f.shares;
    const agentAcct = this.ledger.get(agentId);
    let payout = agentAcct.cash * fraction;
    for (const sym of Object.keys(agentAcct.holdings)) {
      const q = agentAcct.holdings[sym] * fraction;
      if (q > 0) payout += this.ledger.sell(agentId, sym, q);
    }
    payout = Math.min(payout, agentAcct.cash);
    this.ledger.transfer(agentId, investorId, 'cash', payout, 'fund redemption');
    f.shares -= shares;
    f.investors.delete(investorId);
    this.bus.emit('fund', { kind: 'withdraw', investorId, agentId, amount: payout });
    return payout;
  }
}
