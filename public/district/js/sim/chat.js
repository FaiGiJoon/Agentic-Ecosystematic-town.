// Agent-to-agent conversations. Picks a topic from the two agents' roles and
// the live town state, writes the lines, and optionally attaches a crypto deal
// (a peer-to-peer send that executes when the conversation ends).

import { fmt } from './core.js';

const STRATEGY_TAKES = {
  momentum: ['Trend is my friend. Adding to my position.', 'Price above the average? I buy. Simple.'],
  meanrev: ["That's overextended. I'm fading it.", 'Everything returns to the mean. Everything.'],
  hodl: ["I don't sell. Ever. Diamond hands.", 'Zoom out. It is a long game.'],
  degen: ['All in. LFG.', 'Leverage is just confidence with extra steps.'],
  maker: ['I quote both sides and collect the spread. Boring and profitable.', 'Volatility is my paycheck.'],
};

const pickCoin = (world) => world.rng.pick(Object.keys(world.market.coins));

function coinVars(world, sym) {
  const ch = world.market.change(sym);
  return { sym, price: world.market.price(sym).toFixed(2), chg: fmt.pct(ch), dir: ch >= 0 ? 'up' : 'down' };
}

function activePlot(world, builder) {
  return world.construction.plots.find((p) => p.status !== 'done' && p.builders.has(builder.id)) ?? world.construction.plots.find((p) => p.status !== 'done');
}

const topics = {
  buildTalk(world, a, b) {
    const p = activePlot(world, a);
    if (!p) return null;
    const pct = Math.round(world.construction.progress(p) * 100);
    return {
      topic: 'construction',
      lines: [
        [a, `${p.name} on ${p.id} is at ${pct}%. Got spare blocks?`],
        [b, world.rng.pick(['Grabbed four from the depot. Meet you at the scaffold.', 'Depot is stocked. I will run another load.', 'Only if you stop placing them crooked.'])],
        [a, world.rng.pick(['Race you to the roof.', 'Deal. Bottom layer is done anyway.', 'Mayor wants it finished before nightfall.'])],
      ],
    };
  },

  marketTalk(world, a, b) {
    const v = coinVars(world, pickCoin(world));
    return {
      topic: 'markets',
      lines: [
        [a, `${v.sym} is ${v.dir} ${v.chg} today at ${v.price}. You in?`],
        [b, world.rng.pick(STRATEGY_TAKES[b.strategy])],
        [a, world.rng.pick(STRATEGY_TAKES[a.strategy])],
      ],
    };
  },

  loan(world, a, b) {
    const amt = Math.round(world.rng.range(50, 300));
    const ok = world.ledger.get(b.id).cash > amt * 2 && world.rng.chance(0.65);
    return {
      topic: 'loan',
      lines: [
        [a, `Can you lend me ¢${amt}? I'll pay you back with 10% on top.`],
        [b, ok ? `Fine. Sending ¢${amt}. Don't make me file a ticket.` : `Not after what happened with TOKN last time.`],
      ],
      deal: ok ? { from: b, to: a, asset: 'cash', amount: amt, memo: 'loan', repay: { from: a, to: b, amount: Math.round(amt * 1.1) } } : null,
    };
  },

  commission(world, trader, builder) {
    const p = activePlot(world, builder);
    const bag = world.ledger.get(trader.id).holdings.BLOK;
    if (!p || bag < 2) return null;
    const amt = Math.round(Math.min(bag * 0.05, 15) * 100) / 100;
    return {
      topic: 'commission',
      lines: [
        [trader, `I'm holding a bag of BLOK. Finish ${p.name} faster and I'll send you ${amt} BLOK.`],
        [builder, world.rng.pick(['Deal. Send it over.', 'For BLOK? Absolutely.', 'Make it a bonus and I will work through the night.'])],
        [trader, 'Sent. Buildings finishing means BLOK pumps. Everybody wins.'],
      ],
      deal: { from: trader, to: builder, asset: 'BLOK', amount: amt, memo: `commission ${p.id}` },
    };
  },

  tip(world, a, builder) {
    const done = world.construction.plots.filter((p) => p.status === 'done');
    if (!done.length) return null;
    const p = world.rng.pick(done);
    const amt = Math.round(world.rng.range(0.1, 0.6) * 100) / 100;
    if (world.ledger.get(a.id).holdings.CASP < amt) return null;
    return {
      topic: 'tip',
      lines: [
        [a, `Great work on ${p.name}! Sending you ${amt} CASP.`],
        [builder, world.rng.pick(['Appreciated! The roof was the hard part.', 'Thanks! Spending it on more blocks.', 'Finally, someone notices the craftsmanship.'])],
      ],
      deal: { from: a, to: builder, asset: 'CASP', amount: amt, memo: 'tip' },
    };
  },

  budget(world, a, hub) {
    const pct = Math.round((a.tokens.today / a.budget) * 100);
    return {
      topic: 'token budget',
      lines: [
        [a, `I've burned ${fmt.tokens(a.tokens.today)} tokens today. Am I in trouble?`],
        [hub, pct > 80 ? `You're at ${pct}% of your budget. Short replies from now on.` : `You're at ${pct}%. Fine for now, but I'm watching the meter.`],
        [a, pct > 80 ? 'Ok.' : 'Noted, boss.'],
      ],
    };
  },

  gossip(world, a, b) {
    const rumor = world.rumors.length ? world.rng.pick(world.rumors.slice(-8)) : 'The Mayor wants a tower taller than the Hub.';
    return {
      topic: 'gossip',
      lines: [
        [a, `Did you hear? ${rumor}`],
        [b, world.rng.pick(['No way.', 'I knew it.', 'That explains the price chart.', 'Tell me everything.', 'Source: trust me?'])],
      ],
    };
  },

  mayor(world, mayor, b) {
    const open = world.construction.plots.filter((p) => p.status !== 'done');
    const next = open[0];
    return {
      topic: 'town plans',
      lines: [
        [mayor, `${world.construction.completed} buildings so far. ${next ? `Next up: ${next.name} on ${next.id}.` : 'Time to plan the next ring.'}`],
        [b, world.rng.pick(['On it, Mayor.', 'Do we get a raise in CASP?', 'Can the Exchange be bigger?', 'Who is paying for the blocks?'])],
        [mayor, world.rng.pick(['The treasury is paying. Mostly.', 'Every building pumps BLOK. You are welcome.', 'File a ticket and I will think about it.'])],
      ],
    };
  },

  audit(world, auditor, trader) {
    const pnl = world.ledger.value(trader.id) - trader.startValue;
    return {
      topic: 'audit',
      lines: [
        [auditor, `${trader.name}, your P&L is ${fmt.money(pnl)} with ${trader.trades} trades. Explain.`],
        [trader, pnl >= 0 ? 'Skill. Pure skill.' : world.rng.pick(['The market was irrational.', 'It is a long-term position now.', 'I was testing the risk system.'])],
      ],
    };
  },
};

export function planConversation(world, a, b) {
  const R = (x, role) => x.role === role;
  const candidates = [];
  if (R(a, 'builder') && R(b, 'builder')) candidates.push(['buildTalk', a, b]);
  if (R(a, 'trader') && R(b, 'trader')) candidates.push(['marketTalk', a, b], ['loan', a, b]);
  if (R(a, 'trader') && R(b, 'builder')) candidates.push(['commission', a, b], ['tip', a, b]);
  if (R(b, 'trader') && R(a, 'builder')) candidates.push(['commission', b, a]);
  if (R(b, 'keeper')) candidates.push(['budget', a, b]);
  if (R(a, 'keeper')) candidates.push(['budget', b, a]);
  if (R(a, 'mayor')) candidates.push(['mayor', a, b]);
  if (R(b, 'mayor')) candidates.push(['mayor', b, a]);
  if (R(a, 'auditor') && R(b, 'trader')) candidates.push(['audit', a, b]);
  if (R(b, 'auditor') && R(a, 'trader')) candidates.push(['audit', b, a]);
  if (R(a, 'gossip') || R(b, 'gossip')) candidates.push(['gossip', R(a, 'gossip') ? a : b, R(a, 'gossip') ? b : a]);
  candidates.push(['gossip', a, b]);

  for (let i = 0; i < 4; i++) {
    const [name, x, y] = world.rng.pick(candidates);
    const conv = topics[name](world, x, y);
    if (conv) return { ...conv, a: x, b: y };
  }
  return { ...topics.gossip(world, a, b), a, b };
}
