// What each paper trader wants to do this tick. Pure: given prices, history and
// the trader's account, return order intents. The desk applies fees and guards.
//
// A buy is { sym, side: 'buy', usd, why }; a sell is { sym, side: 'sell', qty, why }.

export const TRADERS = [
  { id: 'buy-and-hold', name: 'Buy & Hold', strategy: 'benchmark', benchmark: true },
  { id: 'moonshot', name: 'Moonshot', strategy: 'degen' },
  { id: 'ledger-lou', name: 'Ledger Lou', strategy: 'momentum' },
  { id: 'mean-mabel', name: 'Mean Mabel', strategy: 'meanrev' },
  { id: 'diamond-hans', name: 'Diamond Hans', strategy: 'hodl' },
  { id: 'spready', name: 'Spready', strategy: 'scalper' },
];

const sma = (xs, n) => {
  const s = xs.slice(-n);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN;
};

const STRATEGIES = {
  // Splits its cash evenly across the coins on the first tick and never trades again.
  benchmark({ account, syms }) {
    if (account.cash < 1 || syms.some((s) => account.holdings[s] > 0)) return [];
    const each = account.cash / syms.length;
    return syms.map((sym) => ({ sym, side: 'buy', usd: each, why: 'start of the benchmark' }));
  },

  // Buys a little of one coin every 30 ticks while it has cash. Never sells.
  hodl({ account, syms, tick }) {
    if (tick % 30 !== 0 || account.cash < 10) return [];
    const sym = syms[(tick / 30) % syms.length];
    return [{ sym, side: 'buy', usd: Math.min(100, account.cash), why: 'regular buy' }];
  },

  // Short average above the long one: buy. Below: sell everything in that coin.
  momentum({ account, history, syms }) {
    const out = [];
    for (const sym of syms) {
      const h = history[sym];
      if (h.length < 30) continue;
      const fast = sma(h, 10);
      const slow = sma(h, 30);
      const held = account.holdings[sym];
      if (fast > slow * 1.002 && held === 0 && account.cash > 10) out.push({ sym, side: 'buy', usd: account.cash * 0.3, why: 'short average crossed above long' });
      else if (fast < slow * 0.998 && held > 0) out.push({ sym, side: 'sell', qty: held, why: 'short average crossed below long' });
    }
    return out;
  },

  // More than 1% under the 30-tick average: buy. More than 1% over: sell half.
  meanrev({ account, history, prices, syms }) {
    const out = [];
    for (const sym of syms) {
      const h = history[sym];
      if (h.length < 30) continue;
      const avg = sma(h, 30);
      const p = prices[sym].last;
      const held = account.holdings[sym];
      if (p < avg * 0.99 && account.cash > 10) out.push({ sym, side: 'buy', usd: account.cash * 0.25, why: `${((1 - p / avg) * 100).toFixed(1)}% under its average` });
      else if (p > avg * 1.01 && held > 0) out.push({ sym, side: 'sell', qty: held / 2, why: `${((p / avg - 1) * 100).toFixed(1)}% over its average` });
    }
    return out;
  },

  // Random big bets. The cautionary tale.
  degen({ account, syms, rng }) {
    const sym = syms[Math.floor(rng() * syms.length)];
    const r = rng();
    if (r < 0.08 && account.cash > 10) return [{ sym, side: 'buy', usd: account.cash * 0.5, why: 'gut feeling' }];
    if (r > 0.95 && account.holdings[sym] > 0) return [{ sym, side: 'sell', qty: account.holdings[sym], why: 'panic' }];
    return [];
  },

  // Small trades on any wiggle over 0.3%. Shows what fees do to frequent trading.
  scalper({ account, history, prices, syms }) {
    const out = [];
    for (const sym of syms) {
      const h = history[sym];
      if (h.length < 5) continue;
      const dev = prices[sym].last / sma(h, 5) - 1;
      if (dev < -0.003 && account.cash > 10) out.push({ sym, side: 'buy', usd: Math.min(50, account.cash), why: 'dip' });
      else if (dev > 0.003 && account.holdings[sym] > 0) out.push({ sym, side: 'sell', qty: account.holdings[sym], why: 'pop' });
    }
    return out;
  },
};

export function decide(trader, ctx) {
  return STRATEGIES[trader.strategy](ctx);
}
