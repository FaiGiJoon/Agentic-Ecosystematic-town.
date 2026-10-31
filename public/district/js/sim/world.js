// The town simulation: agents, their behaviours, the clock and all systems.
// Pure logic with no DOM or three.js, so it runs (and is tested) in Node.

import { makeRng, Bus, dist, fmt } from './core.js';
import { TokenLedger, estimateTokens } from './tokens.js';
import { Market, Ledger, Funds } from './market.js';
import { Construction, DISTRICTS } from './builders.js';
import { TicketBoard, reasoners } from './tickets.js';
import { planConversation } from './chat.js';

export const ROSTER = [
  { name: 'Mayor Casper', role: 'mayor', model: 'claude-opus-5-5', color: '#b07ce8' },
  { name: 'Hubert', role: 'keeper', model: 'claude-sonnet-5-5', color: '#5b8ff0' },
  { name: 'Auditor Iris', role: 'auditor', model: 'claude-sonnet-5-5', color: '#e9eef5' },
  { name: 'Gossip Gil', role: 'gossip', model: 'claude-haiku-5-5', color: '#f07fb0' },
  { name: 'Bricks', role: 'builder', model: 'claude-haiku-5-5', color: '#f2a541' },
  { name: 'Girder', role: 'builder', model: 'claude-haiku-5-5', color: '#f2a541' },
  { name: 'Plumb', role: 'builder', model: 'claude-sonnet-5-5', color: '#f2a541' },
  { name: 'Trowel', role: 'builder', model: 'claude-haiku-5-5', color: '#f2a541' },
  { name: 'Moonshot', role: 'trader', strategy: 'degen', model: 'claude-opus-5-5', color: '#4fd18b' },
  { name: 'Ledger Lou', role: 'trader', strategy: 'momentum', model: 'claude-sonnet-5-5', color: '#4fd18b' },
  { name: 'Mean Mabel', role: 'trader', strategy: 'meanrev', model: 'claude-sonnet-5-5', color: '#4fd18b' },
  { name: 'Diamond Hans', role: 'trader', strategy: 'hodl', model: 'claude-haiku-5-5', color: '#4fd18b' },
  { name: 'Spready', role: 'trader', strategy: 'maker', model: 'claude-haiku-5-5', color: '#4fd18b' },
];

const BUDGETS = { 'claude-opus-5-5': 18000, 'claude-sonnet-5-5': 24000, 'claude-haiku-5-5': 30000 };

export const DEFAULT_CONFIG = {
  seed: 7,
  dayLength: 180, // sim seconds per town day
  carry: 10, // blocks per depot trip
  placeInterval: 0.22,
  activePlots: 3,
  maxConversations: 4,
  lineInterval: 2.3,
  playerCash: 10000,
};

const jitter = (rng, p, r) => {
  const a = rng() * Math.PI * 2;
  const d = r * (0.4 + 0.6 * rng());
  return { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
};

export function createWorld(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const rng = makeRng(config.seed);
  const bus = new Bus();
  const market = new Market(rng, bus);
  const ledger = new Ledger(bus, market);
  const world = {
    config,
    rng,
    bus,
    market,
    ledger,
    funds: new Funds(bus, ledger),
    tokens: new TokenLedger(bus),
    construction: new Construction(rng, bus),
    board: new TicketBoard(bus),
    agents: [],
    convs: [],
    rumors: [],
    pending: [],
    time: 0,
    day: 1,
    speed: 1,
    dialogueHook: null, // optional async LLM rewrite, see llm.js
    acc: { market: 0, sample: 0, chat: 0, mayor: 0 },
  };

  ledger.open('treasury', 50000, { CASP: 200 });
  ledger.open('exchange', 0);
  ledger.open('player', config.playerCash);

  ROSTER.forEach((r, i) => {
    const home = r.role === 'builder' ? DISTRICTS.yard : r.role === 'trader' ? DISTRICTS.exchange : r.role === 'keeper' ? DISTRICTS.hub : DISTRICTS.plaza;
    const a = {
      ...r,
      id: r.name.toLowerCase().replace(/[^a-z]+/g, '-'),
      pos: jitter(rng, home, 5),
      heading: 0,
      speed: r.role === 'builder' ? 6 : 3.8,
      queue: [],
      state: 'idle',
      thought: 'Just woke up.',
      carry: 0,
      plot: null,
      talking: null,
      throttled: false,
      budget: BUDGETS[r.model],
      tokens: { in: 0, out: 0, cost: 0, today: 0, calls: 0 },
      trades: 0,
      lastMsg: '',
    };
    world.agents.push(a);
    if (r.role === 'trader') {
      ledger.open(a.id, 5000, { CASP: 10, BLOK: 60, TOKN: 150 });
    } else if (r.role === 'builder') {
      ledger.open(a.id, 200);
    } else {
      ledger.open(a.id, 800, { CASP: 4 });
    }
    a.startValue = ledger.value(a.id);
    if (r.role === 'trader') world.funds.create(a.id);
  });

  world.byId = (id) => world.agents.find((a) => a.id === id);
  world.log = (kind, text) => bus.emit('log', { kind, text, time: world.time });
  world.rumor = (text) => {
    world.rumors.push(text);
    if (world.rumors.length > 30) world.rumors.shift();
  };

  // --- token charging -----------------------------------------------------
  world.charge = (a, reason, text = '', extraIn = 0) => {
    const output = estimateTokens(text) + Math.round(rng.range(20, 140)); // visible text + hidden reasoning
    const input = Math.round(rng.range(180, 520)) + extraIn; // system prompt + context window
    return world.tokens.charge(a, { input, output, reason });
  };

  // --- action helpers ---------------------------------------------------------
  const walk = (p, label = 'walking') => ({ k: 'walk', x: p.x, z: p.z, label });
  const wait = (t, label = 'idle') => ({ k: 'wait', t, label });
  const act = (fn) => ({ k: 'do', fn });
  const think = (a, text, reason = 'reasoning') =>
    act(() => {
      a.thought = text;
      world.charge(a, reason, text);
    });

  const ticketStep = (a, t, phase, text, reason = 'ticket') =>
    act(() => {
      world.board.step(t, phase, text);
      a.thought = `${phase}: ${text}`;
      world.charge(a, reason, text, 250 * t.steps.length);
    });

  // --- behaviours ---------------------------------------------------------------
  const behaviours = {
    builder(a) {
      const C = world.construction;
      if (a.plot && a.plot.status !== 'done') {
        const p = a.plot;
        const centre = { x: p.x + 2.5, z: p.z + 2.5 };
        const spot = jitter(rng, centre, 0.1);
        const ang = rng() * Math.PI * 2;
        spot.x = centre.x + Math.cos(ang) * 4.6;
        spot.z = centre.z + Math.sin(ang) * 4.6;
        a.queue.push(
          walk(jitter(rng, DISTRICTS.depot, 2.5), 'fetching blocks'),
          wait(0.7, 'loading blocks'),
          act(() => (a.carry = config.carry)),
          walk(spot, 'carrying blocks'),
          { k: 'build', plot: p, timer: 0 },
        );
        return;
      }
      a.plot = null;
      const t = world.board.next(['build']);
      if (t) {
        const plot = C.plots.find((p) => p.id === t.payload.plotId);
        const r = reasoners.build(world, t);
        world.board.claim(t, a);
        a.queue.push(
          walk(jitter(rng, DISTRICTS.board, 2), 'reading tickets'),
          ticketStep(a, t, 'Understand', r.understand),
          wait(1.2, 'reasoning'),
          ticketStep(a, t, 'Plan', r.plan),
          wait(1, 'reasoning'),
          act(() => {
            a.plot = plot;
            plot.builders.add(a.id);
            plot.ticket = t;
            plot.verify = r.verify;
            world.board.step(t, 'Act', `${a.name} is building ${plot.name}.`);
          }),
        );
        return;
      }
      // no ticket: help whichever plot has the fewest builders
      const open = C.plots.filter((p) => p.status !== 'done' && p.ticket).sort((x, y) => x.builders.size - y.builders.size);
      if (open.length) {
        a.plot = open[0];
        a.plot.builders.add(a.id);
        a.queue.push(think(a, `No open tickets. Helping on ${a.plot.name}.`));
        return;
      }
      a.queue.push(walk(jitter(rng, DISTRICTS.yard, 5), 'strolling'), wait(rng.range(1.5, 3), 'waiting for tickets'));
    },

    trader(a) {
      if (rng.chance(0.22)) {
        a.queue.push(walk(jitter(rng, DISTRICTS.plaza, 6), 'heading to plaza'), wait(rng.range(3, 7), 'networking'));
        return;
      }
      a.queue.push(walk(jitter(rng, DISTRICTS.exchange, 7), 'heading to exchange'), wait(rng.range(1, 2.5), 'watching charts'), act(() => trade(a)));
    },

    mayor(a) {
      a.queue.push(walk(jitter(rng, DISTRICTS.board, 2), 'walking to the board'), act(() => fileTickets(a)), wait(1.5, 'planning'));
      const dest = rng.pick([DISTRICTS.plaza, DISTRICTS.yard, DISTRICTS.exchange, DISTRICTS.hub]);
      a.queue.push(walk(jitter(rng, dest, 6), 'touring town'), wait(rng.range(3, 6), 'inspecting'));
    },

    auditor(a) {
      const t = world.board.next(['audit', 'research']);
      if (!t) {
        a.queue.push(walk(jitter(rng, DISTRICTS.exchange, 7), 'patrolling'), wait(rng.range(2, 4), 'observing trades'));
        return;
      }
      const r = reasoners[t.kind](world, t);
      world.board.claim(t, a);
      a.queue.push(
        walk(jitter(rng, DISTRICTS.exchange, 5), 'heading to exchange'),
        ticketStep(a, t, 'Understand', r.understand),
        wait(1.5, 'reasoning'),
        ticketStep(a, t, 'Plan', r.plan),
        wait(1.5, 'reasoning'),
        act(() => {
          const verdict = r.verify();
          world.board.step(t, 'Act', t.kind === 'audit' ? 'Pulled every wallet and trade.' : 'Ran the numbers.');
          world.board.step(t, 'Verify', verdict);
          world.board.close(t, verdict);
          world.charge(a, 'ticket', verdict, 600);
          if (r.flag) {
            const fine = Math.min(50, ledger.get(r.flag.id).cash);
            if (fine > 0 && ledger.transfer(r.flag.id, 'treasury', 'cash', fine, 'audit fine')) {
              world.log('audit', `${a.name} fined ${r.flag.name} ¢${fine.toFixed(0)} for reckless trading.`);
              world.rumor(`${a.name} fined ${r.flag.name} for reckless trading.`);
            }
          }
          if (r.signal && r.signal !== 'flat') {
            market.news(t.payload.sym, r.signal === 'bullish' ? 0.0012 : -0.0012, `${a.name}: ${t.payload.sym} outlook ${r.signal}`);
            world.rumor(`${a.name} thinks ${t.payload.sym} is ${r.signal}.`);
          }
        }),
      );
    },

    keeper(a) {
      const t = world.board.next(['budget']);
      if (!t) {
        a.queue.push(walk(jitter(rng, DISTRICTS.hub, 5), 'watching the meters'), wait(rng.range(2, 4), 'counting tokens'));
        return;
      }
      const r = reasoners.budget(world, t);
      world.board.claim(t, a);
      a.queue.push(
        walk(jitter(rng, DISTRICTS.hub, 4), 'to the Hub console'),
        ticketStep(a, t, 'Understand', r.understand),
        wait(1.4, 'reasoning'),
        ticketStep(a, t, 'Plan', r.plan),
        wait(1.2, 'reasoning'),
        act(() => {
          r.apply();
          const v = r.verify();
          world.board.step(t, 'Act', 'Updated the model routing table.');
          world.board.step(t, 'Verify', v);
          world.board.close(t, v);
          world.log('hub', `${a.name}: ${v}`);
          world.rumor(v);
        }),
      );
    },

    gossip(a) {
      const others = world.agents.filter((o) => o !== a && !o.throttled);
      const target = rng.pick(others);
      a.queue.push(walk(jitter(rng, target.pos, 2), `looking for ${target.name}`), wait(rng.range(1, 2.5), 'eavesdropping'));
    },
  };

  function fileTickets(a) {
    const C = world.construction;
    let filed = 0;
    while (C.plots.filter((p) => p.status !== 'done').length < config.activePlots) {
      const plot = C.openPlot(world.time);
      if (!plot) break;
      world.board.create('build', `Build ${plot.name} on ${plot.id}`, { plotId: plot.id }, a.name, world.time);
      filed++;
    }
    if (!world.board.openCount('audit') && rng.chance(0.5)) {
      world.board.create('audit', 'Audit trader P&L', {}, a.name, world.time);
      filed++;
    }
    if (!world.board.openCount('research') && rng.chance(0.5)) {
      const sym = rng.pick(Object.keys(market.coins));
      world.board.create('research', `Research ${sym} outlook`, { sym }, a.name, world.time);
      filed++;
    }
    if (!world.board.openCount('budget') && world.tokens.total.cost > 0.02 && rng.chance(0.3)) {
      world.board.create('budget', 'Review token spend', {}, a.name, world.time);
      filed++;
    }
    const msg = filed ? `Filed ${filed} ticket${filed > 1 ? 's' : ''}.` : 'Board looks healthy.';
    a.thought = msg;
    world.charge(a, 'planning', msg, 400);
  }

  function sma(sym, n) {
    const h = market.coins[sym].history.slice(-n);
    return h.reduce((s, x) => s + x, 0) / h.length;
  }

  function trade(a) {
    const acct = ledger.get(a.id);
    const syms = Object.keys(market.coins);
    const sym = rng.pick(syms);
    const p = market.price(sym);
    const avg = sma(sym, 20);
    const dev = p / avg - 1;
    let side = null;
    let size = 0;
    let why = '';
    switch (a.strategy) {
      case 'momentum':
        if (dev > 0.004) [side, size, why] = ['buy', acct.cash * 0.25, 'trend is up'];
        else if (dev < -0.004) [side, size, why] = ['sell', acct.holdings[sym] * 0.5, 'trend broke'];
        break;
      case 'meanrev':
        if (dev > 0.006) [side, size, why] = ['sell', acct.holdings[sym] * 0.4, 'overextended'];
        else if (dev < -0.006) [side, size, why] = ['buy', acct.cash * 0.3, 'oversold'];
        break;
      case 'hodl':
        if (acct.cash > ledger.value(a.id) * 0.15) [side, size, why] = ['buy', acct.cash * 0.3, 'stacking'];
        break;
      case 'degen':
        if (rng.chance(0.55)) [side, size, why] = ['buy', acct.cash * 0.6, rng.pick(['vibes', 'saw a tweet', 'number go up', 'gut feeling'])];
        else if (rng.chance(0.5)) [side, size, why] = ['sell', acct.holdings[sym], 'panic'];
        break;
      case 'maker':
        if (Math.abs(dev) > 0.002) [side, size, why] = dev > 0 ? ['sell', acct.holdings[sym] * 0.15, 'leaning on the offer'] : ['buy', acct.cash * 0.1, 'leaning on the bid'];
        break;
    }
    let text;
    if (side === 'buy' && size > 5) {
      const q = ledger.buy(a.id, sym, size, a);
      text = `Bought ${q.toFixed(2)} ${sym} @ ${p.toFixed(2)}: ${why}.`;
      a.trades++;
    } else if (side === 'sell' && size * p > 5) {
      const got = ledger.sell(a.id, sym, size, a);
      text = `Sold ${size.toFixed(2)} ${sym} for ¢${got.toFixed(0)}: ${why}.`;
      a.trades++;
    } else {
      text = `${sym} at ${p.toFixed(2)}. Holding.`;
    }
    a.thought = text;
    world.charge(a, 'trading', text, 300);
    if (side && a.strategy === 'degen' && size * p > 1500) world.rumor(`${a.name} just aped ¢${(size * (side === 'buy' ? 1 : p)).toFixed(0)} into ${sym}.`);
  }

  // --- conversations ------------------------------------------------------------
  function startConversation() {
    const free = world.agents.filter((a) => !a.talking && !a.throttled && a.queue[0]?.k !== 'build');
    if (free.length < 2) return;
    const weighted = free.flatMap((a) => (a.role === 'gossip' || a.role === 'mayor' ? [a, a, a] : [a]));
    const a = rng.pick(weighted);
    const near = free.filter((b) => b !== a && dist(a.pos, b.pos) < 9).sort((x, y) => dist(a.pos, x.pos) - dist(a.pos, y.pos));
    if (!near.length) return;
    const b = near[0];
    const plan = planConversation(world, a, b);
    const conv = { id: 'c' + Math.round(world.time * 1000) + a.id, ...plan, i: 0, t: 0.4, pending: false };
    a.talking = b.talking = conv.id;
    world.convs.push(conv);
    world.bus.emit('conv:start', conv);
    if (world.dialogueHook) {
      conv.pending = true;
      world
        .dialogueHook(world, conv)
        .then((res) => {
          if (res?.lines?.length === conv.lines.length) {
            conv.lines = conv.lines.map((l, i) => [l[0], res.lines[i]]);
            conv.usage = res.usage;
          }
        })
        .catch(() => {})
        .finally(() => (conv.pending = false));
    }
  }

  function endConversation(conv) {
    if (conv.deal && !conv.cancelled) {
      const d = conv.deal;
      if (ledger.transfer(d.from.id, d.to.id, d.asset, d.amount, d.memo)) {
        world.log('deal', `${d.from.name} sent ${d.asset === 'cash' ? '¢' + d.amount : d.amount + ' ' + d.asset} to ${d.to.name} (${d.memo}).`);
        if (d.repay) world.pending.push({ at: world.time + 60, ...d.repay });
      }
    }
    for (const x of [conv.a, conv.b]) if (x.talking === conv.id) x.talking = null;
    world.convs = world.convs.filter((c) => c !== conv);
    world.bus.emit('conv:end', conv);
  }

  function stepConversations(dt) {
    world.acc.chat += dt;
    if (world.acc.chat > 1.6) {
      world.acc.chat = 0;
      if (world.convs.length < config.maxConversations && rng.chance(0.7)) startConversation();
    }
    for (const conv of [...world.convs]) {
      if (conv.a.throttled || conv.b.throttled) {
        conv.cancelled = true;
        endConversation(conv);
        continue;
      }
      if (conv.pending) continue;
      conv.t -= dt;
      if (conv.t > 0) continue;
      if (conv.i >= conv.lines.length) {
        endConversation(conv);
        continue;
      }
      const [speaker, text] = conv.lines[conv.i];
      const listener = speaker === conv.a ? conv.b : conv.a;
      const u = conv.usage?.[conv.i];
      if (u) world.tokens.charge(speaker, { input: u.input, output: u.output, reason: 'chat' });
      else {
        world.charge(speaker, 'chat', text, 120 * conv.i);
        world.tokens.charge(listener, { input: estimateTokens(text) + 60, output: 0, reason: 'chat' });
      }
      speaker.lastMsg = text;
      world.bus.emit('chat', { conv, speaker, listener, text });
      conv.i++;
      conv.t = conv.i >= conv.lines.length ? 1.6 : config.lineInterval;
    }
  }

  // --- reactions ------------------------------------------------------------------
  bus.on('plot:done', ({ plot, builder }) => {
    if (plot.ticket && plot.ticket.status !== 'done') {
      const v = plot.verify();
      world.board.step(plot.ticket, 'Verify', v);
      world.board.close(plot.ticket, v);
    }
    for (const id of plot.builders) {
      const b = world.byId(id);
      if (b.plot === plot) b.plot = null;
    }
    market.news('BLOK', 0.0016, `${plot.name} completed! BLOK rallies.`);
    world.log('build', `${builder.name} placed the last block. ${plot.name} is finished.`);
    world.rumor(`${plot.name} just got finished by ${builder.name}.`);
  });

  bus.on('throttled', ({ agent }) => {
    agent.queue = [walk(jitter(rng, DISTRICTS.hub, 3), 'rate-limited, walking to Hub'), { k: 'nap' }];
    agent.carry = 0;
    agent.thought = 'Out of token budget. Napping until tomorrow.';
    world.log('hub', `${agent.name} hit the daily token budget (${fmt.tokens(agent.budget)}) and is rate-limited.`);
    world.rumor(`${agent.name} got rate-limited at the Hub.`);
  });

  // --- main step --------------------------------------------------------------------
  function stepAgent(a, dt) {
    if (a.talking) {
      a.state = 'chatting';
      const conv = world.convs.find((c) => c.id === a.talking);
      if (conv) {
        const other = conv.a === a ? conv.b : conv.a;
        a.heading = Math.atan2(other.pos.x - a.pos.x, other.pos.z - a.pos.z);
      }
      return;
    }
    if (!a.queue.length) behaviours[a.role](a);
    const q = a.queue[0];
    if (!q) return;
    switch (q.k) {
      case 'walk': {
        const dx = q.x - a.pos.x;
        const dz = q.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const s = a.speed * dt;
        a.state = q.label;
        if (d <= s) {
          a.pos.x = q.x;
          a.pos.z = q.z;
          a.queue.shift();
        } else {
          a.pos.x += (dx / d) * s;
          a.pos.z += (dz / d) * s;
          a.heading = Math.atan2(dx, dz);
        }
        break;
      }
      case 'wait':
        a.state = q.label;
        q.t -= dt;
        if (q.t <= 0) a.queue.shift();
        break;
      case 'do':
        a.queue.shift();
        q.fn();
        break;
      case 'build': {
        a.state = 'building';
        const p = q.plot;
        a.heading = Math.atan2(p.x + 2.5 - a.pos.x, p.z + 2.5 - a.pos.z);
        q.timer -= dt;
        if (q.timer > 0) break;
        if (p.status === 'done' || a.carry <= 0) {
          a.queue.shift();
          break;
        }
        a.carry--;
        world.construction.place(p, a, world.time);
        q.timer = config.placeInterval;
        if (rng.chance(0.08)) world.charge(a, 'building', 'Checking alignment of the next course.');
        break;
      }
      case 'nap':
        a.state = 'napping';
        if (!a.throttled) a.queue.shift();
        break;
    }
  }

  world.step = (dt) => {
    world.time += dt;
    const fund = {
      buildRate: world.construction.buildRate(world.time),
      tokenRate: world.tokens.history.slice(-60).reduce((s, x) => s + x, 0),
      buildings: world.construction.completed,
    };
    world.acc.market += dt;
    while (world.acc.market >= 0.5) {
      market.step(fund);
      world.acc.market -= 0.5;
    }
    world.acc.sample += dt;
    while (world.acc.sample >= 1) {
      world.tokens.sample();
      world.acc.sample -= 1;
    }
    const day = 1 + Math.floor(world.time / config.dayLength);
    if (day !== world.day) {
      world.day = day;
      world.tokens.resetDay(world.agents);
      market.newDay();
      world.log('day', `Day ${day} begins. Token budgets reset.`);
      bus.emit('day', day);
    }
    for (const p of [...world.pending]) {
      if (world.time < p.at) continue;
      world.pending = world.pending.filter((x) => x !== p);
      if (ledger.transfer(p.from.id, p.to.id, 'cash', p.amount, 'loan repayment')) world.log('deal', `${p.from.name} repaid ¢${p.amount} to ${p.to.name}.`);
      else {
        world.log('deal', `${p.from.name} defaulted on a ¢${p.amount} loan from ${p.to.name}!`);
        world.rumor(`${p.from.name} defaulted on a loan from ${p.to.name}.`);
      }
    }
    stepConversations(dt);
    for (const a of world.agents) stepAgent(a, dt);
  };

  // Advance by a real-time delta at the current speed, in stable sub-steps.
  world.advance = (realDt) => {
    let t = Math.min(realDt, 0.1) * world.speed;
    while (t > 0) {
      const d = Math.min(t, 0.05);
      world.step(d);
      t -= d;
    }
  };

  // Kick off: the Mayor files the first tickets immediately.
  fileTickets(world.agents[0]);
  return world;
}
