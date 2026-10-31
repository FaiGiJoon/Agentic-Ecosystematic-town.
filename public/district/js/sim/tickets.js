// Ticket board: the Mayor files tickets, agents claim them and reason through
// Understand -> Plan -> Act -> Verify. Each step is charged as tokens.

import { fmt } from './core.js';

export class TicketBoard {
  constructor(bus) {
    this.bus = bus;
    this.tickets = [];
    this.seq = 1;
  }

  create(kind, title, payload = {}, by = 'Mayor Casper', now = 0) {
    const t = { id: 'T-' + this.seq++, kind, title, payload, by, status: 'open', assignee: null, steps: [], created: now, outcome: '' };
    this.tickets.unshift(t);
    if (this.tickets.length > 60) this.tickets = this.tickets.filter((x, i) => i < 40 || x.status !== 'done');
    this.bus.emit('ticket', { ticket: t, ev: 'open' });
    return t;
  }

  next(kinds) {
    for (let i = this.tickets.length - 1; i >= 0; i--) {
      const t = this.tickets[i];
      if (t.status === 'open' && kinds.includes(t.kind)) return t;
    }
    return null;
  }

  openCount(kind) {
    return this.tickets.filter((t) => t.status !== 'done' && (!kind || t.kind === kind)).length;
  }

  claim(t, agent) {
    t.status = 'in_progress';
    t.assignee = agent.id;
    this.bus.emit('ticket', { ticket: t, ev: 'claim', agent });
  }

  step(t, phase, text) {
    const s = { phase, text };
    t.steps.push(s);
    this.bus.emit('ticket', { ticket: t, ev: 'step', step: s });
    return s;
  }

  close(t, outcome) {
    t.status = 'done';
    t.outcome = outcome;
    this.bus.emit('ticket', { ticket: t, ev: 'done' });
  }
}

// Offline "reasoner": produces plausible reasoning grounded in real sim state.
// Swap for an LLM via js/sim/llm.js to get genuine model reasoning.
export const reasoners = {
  build(world, t) {
    const plot = world.construction.plots.find((p) => p.id === t.payload.plotId);
    const n = plot.voxels.length;
    return {
      understand: `${plot.id} needs a ${plot.kind}: ${n} voxels, ${Math.max(...plot.voxels.map((v) => v.y)) + 1} layers tall.`,
      plan: `Carry ${world.config.carry} blocks per trip from the depot: about ${Math.ceil((n - plot.placed) / world.config.carry)} trips. Bottom layer first, go around the ring.`,
      verify: () => `All ${n} blocks placed on ${plot.id}. ${plot.name} is open for business.`,
    };
  },

  audit(world, t) {
    const traders = world.agents.filter((a) => a.role === 'trader');
    const ranked = traders.map((a) => ({ a, pnl: world.ledger.value(a.id) - a.startValue })).sort((x, y) => x.pnl - y.pnl);
    const worst = ranked[0];
    const best = ranked[ranked.length - 1];
    return {
      understand: `Review the last ${world.market.trades.length} exchange trades and every trader's P&L.`,
      plan: `Rank traders by P&L. Flag anyone down more than ¢500 and send a note.`,
      verify: () =>
        worst.pnl < -500
          ? `Flagged ${worst.a.name} (${fmt.money(worst.pnl)}). Top trader: ${best.a.name} (${fmt.money(best.pnl)}).`
          : `Books are clean. Top trader: ${best.a.name} (${fmt.money(best.pnl)}).`,
      flag: worst.pnl < -500 ? worst.a : null,
    };
  },

  budget(world, t) {
    const TIERS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
    const total = world.tokens.total.cost || 1;
    const spenders = [...world.agents].sort((a, b) => b.tokens.cost - a.tokens.cost);
    const top = spenders[0];
    const share = top.tokens.cost / total;
    const understand = `Town has spent ${fmt.usd(world.tokens.total.cost)} on ${fmt.tokens(world.tokens.total.in + world.tokens.total.out)} tokens. ${top.name} accounts for ${Math.round(share * 100)}%.`;
    const tier = TIERS.indexOf(top.model);
    if (share > 0.16 && tier > 0) {
      const cheaper = TIERS[tier - 1];
      return {
        understand,
        plan: `${top.name} is over their fair share on ${top.model}. Route them to ${cheaper}.`,
        verify: () => `${top.name} now runs on ${cheaper}.`,
        apply: () => (top.model = cheaper),
      };
    }
    // spend is healthy: reward the thriftiest agent that still has headroom
    const thrifty = [...world.agents].filter((a) => TIERS.indexOf(a.model) < 2).sort((a, b) => a.tokens.cost - b.tokens.cost)[0];
    if (!thrifty) return { understand, plan: 'Spend is balanced. No routing changes.', verify: () => 'Routing table unchanged.', apply: () => {} };
    const better = TIERS[TIERS.indexOf(thrifty.model) + 1];
    return {
      understand,
      plan: `Spend is balanced. ${thrifty.name} has been thrifty; promote them to ${better}.`,
      verify: () => `${thrifty.name} promoted to ${better}.`,
      apply: () => (thrifty.model = better),
    };
  },

  research(world, t) {
    const sym = t.payload.sym;
    const c = world.market.coins[sym];
    const h = c.history;
    const sma = h.slice(-30).reduce((s, x) => s + x, 0) / Math.min(30, h.length);
    const signal = c.price > sma * 1.01 ? 'bullish' : c.price < sma * 0.99 ? 'bearish' : 'flat';
    return {
      understand: `${sym} trades at ${c.price.toFixed(2)}; 30-step average ${sma.toFixed(2)}.`,
      plan: `Compare price to its average and the town fundamentals behind ${sym}.`,
      verify: () => `${sym} outlook: ${signal}. Report posted to the Exchange.`,
      signal,
    };
  },
};
