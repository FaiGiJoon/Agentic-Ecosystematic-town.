// DOM overlay: top bar, Agent Hub, Exchange, Tickets, Chat, inspector, feed.

import { MODELS } from './sim/tokens.js';
import { fmt } from './sim/core.js';
import { noteName } from './hq-bridge.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ROLE_ICON = { claude: '✳️', mayor: '🎩', keeper: '📡', auditor: '📋', gossip: '📣', builder: '👷', trader: '📈' };
const KIND_COLOR = { build: '#f2a541', audit: '#e9eef5', research: '#7fd1e8', budget: '#c48af0' };
const STATUS_COLOR = { open: '#f2c14e', in_progress: '#7fd1e8', done: '#4fd18b' };
const REASON_COLOR = { chat: '#7fd1e8', trading: '#4fd18b', ticket: '#c48af0', planning: '#f2c14e', reasoning: '#f07fb0', building: '#f2a541' };
const EVENT_COLOR = { vault: '#a78bfa', build: '#f2a541', deal: '#f2c14e', hub: '#c48af0', audit: '#e9eef5', day: '#7fd1e8', news: '#4fd18b', you: '#ffe066' };

function setupCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * dpr)) {
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

function drawLine(canvas, data, color, { fillArea = true, grid = false } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (data.length < 2 || !w) return;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const pad = 8;
  const X = (i) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const Y = (v) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2);
  if (grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i <= 3; i++) {
      const y = pad + (i / 3) * (h - pad * 2);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
      ctx.fillText((hi - (i / 3) * (hi - lo)).toFixed(2), pad + 2, y - 2);
    }
  }
  ctx.beginPath();
  data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (fillArea) {
    ctx.lineTo(X(data.length - 1), h);
    ctx.lineTo(X(0), h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, color + '55');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fill();
  }
}

export function createUI(world, scene, hq) {
  const ui = { tab: 'hub', coin: 'BLOK', selected: null, timer: 0 };
  const { market, ledger, funds, tokens, board } = world;

  // --- top bar ---------------------------------------------------------------
  $('speed').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    world.speed = Number(b.dataset.speed);
    for (const x of $('speed').children) x.classList.toggle('on', x === b);
  });
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab === ui.tab && !$('panel').classList.contains('collapsed')) {
      $('panel').classList.add('collapsed');
      setTimeout(() => scene.resize(), 260);
      return;
    }
    ui.tab = b.dataset.tab;
    for (const x of $('tabs').children) x.classList.toggle('on', x === b);
    for (const t of ['hub', 'exchange', 'tickets', 'chat']) $('tab-' + t).hidden = t !== ui.tab;
    if ($('panel').classList.contains('collapsed')) {
      $('panel').classList.remove('collapsed');
      setTimeout(() => scene.resize(), 260);
    }
    render();
  });
  $('panel-toggle').addEventListener('click', () => {
    $('panel').classList.toggle('collapsed');
    setTimeout(() => scene.resize(), 260);
  });

  function renderTop() {
    const tod = (world.time % world.config.dayLength) / world.config.dayLength;
    const mins = Math.floor((6 * 60 + tod * 24 * 60) % (24 * 60));
    $('clock').textContent = `Day ${world.day} · ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const T = tokens.total;
    const casp = market.coins.CASP;
    const ch = market.change('CASP');
    const hqChip = hq.online
      ? `✳️ Claude<b>${hq.agent.status === 'working' ? '#' + hq.agent.ticket : 'idle'}</b>`
      : '✳️ HQ<b class="down">offline</b>';
    $('chips').innerHTML = [
      hqChip,
      `🏗️ Buildings<b>${world.construction.completed}</b>`,
      `🧱 Blocks<b>${fmt.num(world.construction.blocksPlaced)}</b>`,
      `⚡ Tokens<b>${fmt.tokens(T.in + T.out)}</b>`,
      `💸 Spend<b>${fmt.usd(T.cost)}</b>`,
      `🪙 CASP<b>${casp.price.toFixed(2)}</b> <span class="${ch >= 0 ? 'up' : 'down'}">${fmt.pct(ch)}</span>`,
      `💬 Live chats<b>${world.convs.length}</b>`,
    ]
      .map((c) => `<div class="chip">${c}</div>`)
      .join('');
  }

  // --- Agent Hub -------------------------------------------------------------
  $('tab-hub').innerHTML = `
    <h3>Claude Code · real runs</h3>
    <div class="big real">
      <div class="stat"><div class="k">Tokens</div><div class="v" id="r-tok"></div></div>
      <div class="stat"><div class="k">Spend</div><div class="v" id="r-cost" style="color:var(--gold)"></div></div>
      <div class="stat"><div class="k">Runs</div><div class="v" id="r-runs"></div></div>
    </div>
    <div class="legend" id="r-note"></div>
    <h3>Simulated town agents · estimates</h3>
    <div class="big">
      <div class="stat"><div class="k">Tokens</div><div class="v" id="h-tok"></div></div>
      <div class="stat"><div class="k">Spend</div><div class="v" id="h-cost" style="color:var(--gold)"></div></div>
      <div class="stat"><div class="k">LLM calls</div><div class="v" id="h-calls"></div></div>
    </div>
    <canvas class="spark" id="h-spark"></canvas>
    <div class="legend"><span style="--c:#c48af0">tokens / second, last 2 min</span><span id="h-rate" style="--c:transparent"></span></div>
    <h3>By model</h3><div class="stack" id="h-models"></div><div class="legend" id="h-models-l"></div>
    <h3>By activity</h3><div class="stack" id="h-reasons"></div><div class="legend" id="h-reasons-l"></div>
    <h3>Agents · today vs budget</h3><div class="rows" id="h-agents"></div>`;
  $('h-agents').addEventListener('pointerdown', (e) => {
    const row = e.target.closest('[data-agent]');
    if (row) select(world.byId(row.dataset.agent));
  });

  function stack(elBar, elLegend, parts) {
    const total = parts.reduce((s, p) => s + p.v, 0) || 1;
    elBar.innerHTML = parts.map((p) => `<i style="flex:${p.v / total};background:${p.c}"></i>`).join('');
    elLegend.innerHTML = parts.map((p) => `<span style="--c:${p.c}">${p.k} ${p.label ?? fmt.tokens(p.v)}</span>`).join('');
  }

  function renderHub() {
    const R = hq.usage();
    $('r-tok').textContent = fmt.tokens(R.in + R.out);
    $('r-cost').textContent = fmt.usd(R.cost);
    $('r-runs').textContent = R.runs;
    $('r-note').innerHTML = hq.online
      ? `<span style="--c:#d97757">${fmt.tokens(R.in)} in · ${fmt.tokens(R.out)} out · ${Math.round(R.ms / 1000)}s of work, as reported by Claude Code</span>`
      : '<span style="--c:var(--red)">Agent HQ server not reachable. Start it with node server.js.</span>';
    const T = tokens.total;
    $('h-tok').textContent = fmt.tokens(T.in + T.out);
    $('h-cost').textContent = fmt.usd(T.cost);
    $('h-calls').textContent = fmt.num(T.calls);
    drawLine($('h-spark'), tokens.history.length > 1 ? tokens.history : [0, 0], '#c48af0');
    const rate = tokens.history.slice(-10).reduce((s, x) => s + x, 0) / 10;
    $('h-rate').textContent = `now ${fmt.tokens(rate)}/s · in ${fmt.tokens(T.in)} · out ${fmt.tokens(T.out)}`;
    stack(
      $('h-models'),
      $('h-models-l'),
      Object.entries(tokens.byModel).map(([m, v]) => ({ k: MODELS[m].label, v: v.in + v.out, c: MODELS[m].color, label: `${fmt.tokens(v.in + v.out)} · ${fmt.usd(v.cost)}` })),
    );
    stack(
      $('h-reasons'),
      $('h-reasons-l'),
      Object.entries(tokens.byReason).map(([k, v]) => ({ k, v, c: REASON_COLOR[k] ?? '#888' })),
    );
    const rows = [...world.agents].sort((a, b) => b.tokens.today - a.tokens.today);
    $('h-agents').innerHTML = rows
      .map((a) => {
        const pct = Math.min(100, (a.tokens.today / a.budget) * 100);
        const col = pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--orange)' : MODELS[a.model].color;
        return `<div class="row" data-agent="${a.id}">
          <div class="name">${ROLE_ICON[a.role]} ${esc(a.name)} <span class="badge" style="--c:${MODELS[a.model].color}">${MODELS[a.model].label}</span></div>
          <div class="meta">${fmt.tokens(a.tokens.today)} / ${fmt.tokens(a.budget)} · ${fmt.usd(a.tokens.cost)}</div>
          <div class="bar"><i style="width:${pct}%;background:${col}"></i></div>
          <div class="state">${a.throttled ? '<span class="zz">Zz rate-limited</span>' : esc(a.state)}</div>
        </div>`;
      })
      .join('');
  }

  // --- Exchange ----------------------------------------------------------------
  $('tab-exchange').innerHTML = `
    <section class="desk">
      <div class="desk-head"><h3>Live paper desk</h3><span class="pill" id="d-status"></span></div>
      <div class="disclaimer">Real BTC, ETH and SOL prices from Kraken, paper dollars. Buys fill at the real ask, sells at the real bid, and every fill pays the exchange fee. No account, no real money.</div>
      <div class="coins" id="d-prices"></div>
      <canvas class="chart" id="d-chart" aria-label="Each trader's return since the start"></canvas>
      <div class="legend" id="d-legend"></div>
      <div class="rows" id="d-board"></div>
      <div id="d-pending"></div>
      <div class="trade"><button class="btn sell" id="d-halt" type="button">Stop all trading</button></div>
      <div class="legend" id="d-guards"></div>
      <h3>Desk orders</h3><div class="tape" id="d-tape"></div>
    </section>
    <h3>Town coins · simulated</h3>
    <div class="disclaimer">🎮 Play money only. Coins, prices and agents are simulated. Nothing here touches a real wallet or chain.</div>
    <div class="coins" id="x-coins"></div>
    <canvas class="chart" id="x-chart"></canvas>
    <div class="legend" id="x-blurb"></div>
    <div class="trade">
      <input id="x-amt" type="number" min="1" step="50" value="500" aria-label="Amount in credits" />
      <button class="btn buy" id="x-buy">Buy</button>
      <button class="btn sell" id="x-sell">Sell</button>
    </div>
    <h3>Your wallet</h3><div class="wallet" id="x-wallet"></div>
    <h3>Back an agent · invest ¢500 in their fund</h3><div id="x-funds"></div>
    <h3>Agent-to-agent transfers</h3><div class="tape" id="x-p2p"></div>
    <h3>Trade tape</h3><div class="tape" id="x-tape"></div>`;

  const p2p = [];
  world.bus.on('transfer', (t) => {
    if (t.memo.startsWith('fund')) return;
    p2p.unshift(t);
    if (p2p.length > 12) p2p.pop();
  });

  $('x-coins').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-sym]');
    if (b) {
      ui.coin = b.dataset.sym;
      renderExchange();
    }
  });
  const you = { id: 'player', name: 'You' };
  $('x-buy').addEventListener('click', () => {
    const amt = Number($('x-amt').value);
    const q = ledger.buy('player', ui.coin, amt, you);
    toast(q ? `Bought ${q.toFixed(3)} ${ui.coin}` : 'Not enough credits');
    if (q) world.log('you', `You bought ${q.toFixed(3)} ${ui.coin} for ¢${fmt.num(amt)}.`);
    renderExchange();
  });
  $('x-sell').addEventListener('click', () => {
    const amt = Number($('x-amt').value);
    const qty = Math.min(ledger.get('player').holdings[ui.coin], amt / market.price(ui.coin));
    const got = ledger.sell('player', ui.coin, qty, you);
    toast(got ? `Sold ${qty.toFixed(3)} ${ui.coin} for ¢${got.toFixed(2)}` : `You hold no ${ui.coin}`);
    if (got) world.log('you', `You sold ${qty.toFixed(3)} ${ui.coin} for ¢${fmt.num(got)}.`);
    renderExchange();
  });
  $('x-funds').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = world.byId(b.dataset.agent);
    if (b.dataset.act === 'invest') {
      const s = funds.invest('player', a.id, 500);
      toast(s ? `Invested ¢500 with ${a.name}` : 'Not enough credits');
      if (s) world.log('you', `You backed ${a.name} with ¢500.`);
    } else {
      const got = funds.withdraw('player', a.id);
      toast(got ? `Withdrew ¢${got.toFixed(2)} from ${a.name}` : 'No stake to withdraw');
      if (got) world.log('you', `You cashed out ¢${fmt.num(got)} from ${a.name}.`);
    }
    renderExchange();
  });

  // --- live paper desk -------------------------------------------------------------
  const DESK_COLOR = { 'buy-and-hold': '#e9eef5', moonshot: '#f07fb0', 'ledger-lou': '#7fd1e8', 'mean-mabel': '#c48af0', 'diamond-hans': '#f2c14e', spready: '#4fd18b' };
  const usd = (n) => '$' + fmt.num(n, 2);

  $('d-halt').addEventListener('click', async () => {
    const halted = !!hq.desk?.halted;
    try {
      await (halted ? hq.deskResume() : hq.deskHalt());
      toast(halted ? 'Trading resumed' : 'All trading stopped');
    } catch (err) {
      toast(err.message);
    }
  });
  $('d-pending').addEventListener('pointerdown', async (e) => {
    const b = e.target.closest('button[data-order]');
    if (!b) return;
    try {
      const o = await hq.deskOrder(Number(b.dataset.order), b.dataset.ok === '1');
      toast(o.status === 'filled' ? `Filled at ${usd(o.price)}` : o.status === 'rejected' ? `Blocked: ${o.reason}` : 'Order rejected');
    } catch (err) {
      toast(err.message);
    }
  });

  // Every trader's return since the start, on one percent scale; the benchmark dashed.
  function drawDeskChart(canvas, d) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const ids = Object.keys(d.curve.series).filter((id) => d.curve.series[id].length > 1);
    if (!ids.length || !w) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px JetBrains Mono';
      ctx.fillText('The chart fills in after a few minutes of trading.', 10, h / 2);
      return;
    }
    const start = Object.fromEntries(d.traders.map((t) => [t.id, t.start]));
    const rets = Object.fromEntries(ids.map((id) => [id, d.curve.series[id].map((v) => (v / start[id] - 1) * 100)]));
    const all = Object.values(rets).flat();
    const lo = Math.min(0, ...all);
    const hi = Math.max(0, ...all);
    const pad = 10;
    const n = Math.max(...ids.map((id) => rets[id].length));
    const X = (i) => pad + (i / Math.max(1, n - 1)) * (w - pad * 2);
    const Y = (v) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(pad, Y(0));
    ctx.lineTo(w - pad, Y(0));
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(`${hi.toFixed(2)}%`, pad + 2, pad + 8);
    ctx.fillText(`${lo.toFixed(2)}%`, pad + 2, h - pad - 2);
    for (const id of ids) {
      ctx.setLineDash(id === 'buy-and-hold' ? [5, 4] : []);
      ctx.strokeStyle = DESK_COLOR[id] ?? '#888';
      ctx.lineWidth = id === 'buy-and-hold' ? 1.5 : 2;
      ctx.beginPath();
      rets[id].forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function renderDesk() {
    const d = hq.desk;
    if (!d) {
      $('d-status').textContent = hq.online ? 'off' : 'offline';
      $('d-status').style.setProperty('--c', '#5c6b85');
      $('d-prices').innerHTML = '<div class="disclaimer">The paper desk runs inside the Agent HQ server. Start it with <code>node server.js</code> (and leave DESK unset) to trade live prices.</div>';
      return;
    }
    const status = d.halted ? 'stopped' : d.feedError ? 'no prices' : d.config.approval ? 'paper · approvals' : 'paper · running';
    $('d-status').textContent = status;
    $('d-status').style.setProperty('--c', d.halted ? '#ff6b6b' : d.feedError ? '#f2a541' : '#4fd18b');
    $('d-halt').textContent = d.halted ? 'Resume trading' : 'Stop all trading';
    $('d-halt').className = `btn ${d.halted ? 'buy' : 'sell'}`;
    const age = d.pricesAt ? Math.round((Date.now() - d.pricesAt) / 1000) : null;
    $('d-prices').innerHTML = d.prices
      ? Object.entries(d.prices)
          .map(([sym, q]) => `<div class="coin-tab"><div class="s">${sym}</div><div class="p">${usd(q.last)}</div><div class="state">bid ${fmt.num(q.bid, 2)} · ask ${fmt.num(q.ask, 2)}</div></div>`)
          .join('')
      : `<div class="disclaimer">${esc(d.feedError ?? 'Waiting for the first prices…')}</div>`;
    drawDeskChart($('d-chart'), d);
    $('d-legend').innerHTML = d.traders.map((t) => `<span style="--c:${DESK_COLOR[t.id]}">${esc(t.name)}</span>`).join('') + (age != null ? `<span style="--c:transparent">prices ${age}s old</span>` : '');
    const bench = d.traders.find((t) => t.benchmark);
    const ranked = [...d.traders].sort((a, b) => b.ret - a.ret);
    $('d-board').innerHTML = ranked
      .map((t) => {
        const vs = t.ret - bench.ret;
        const verdict = t.benchmark ? 'the benchmark' : `${vs >= 0 ? 'beating' : 'behind'} Buy & Hold by ${fmt.pct(Math.abs(vs)).replace('+', '')}`;
        return `<div class="row desk-row" style="--c:${DESK_COLOR[t.id]}">
          <div class="name"><span class="dot" style="background:${DESK_COLOR[t.id]}"></span>${esc(t.name)} <span class="state">${t.strategy}</span></div>
          <div class="meta">${usd(t.equity)} <span class="${t.ret >= 0 ? 'up' : 'down'}">${fmt.pct(t.ret)}</span></div>
          <div class="state">${verdict}</div>
          <div class="meta">${t.trades} trades · ${usd(t.fees)} fees</div>
        </div>`;
      })
      .join('');
    const name = (id) => d.traders.find((t) => t.id === id)?.name ?? id;
    $('d-pending').innerHTML = d.pending.length
      ? `<h3>Waiting for your approval</h3>` +
        d.pending
          .map((o) => `<div class="fund"><div><b>${esc(name(o.trader))}</b> wants to ${o.side} ${o.side === 'buy' ? usd(o.usd) + ' of' : fmt.num(o.qty, 6)} ${o.sym}<div class="state">${esc(o.why ?? '')}</div></div>
            <div class="actions"><button class="btn small buy" data-order="${o.id}" data-ok="1">Approve</button><button class="btn small ghost" data-order="${o.id}" data-ok="0">Reject</button></div></div>`)
          .join('')
      : '';
    const g = d.config;
    $('d-guards').innerHTML = [
      `max ${usd(g.maxTradeUsd)} per trade`,
      `max ${usd(g.maxDayUsd)} per trader per day`,
      `stops at -${g.maxLossPct}% together`,
      `fee ${(g.fee * 100).toFixed(2)}%`,
      g.approval ? 'every order needs your approval' : 'approvals off (DESK_APPROVAL=on to turn on)',
      d.halted ? `stopped: ${esc(d.halted.reason)}` : '',
    ]
      .filter(Boolean)
      .map((x) => `<span style="--c:transparent">${x}</span>`)
      .join('');
    $('d-tape').innerHTML =
      d.recent
        .slice(0, 14)
        .map((o) => {
          const when = new Date(o.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          if (o.status !== 'filled') return `<div>${when} <span class="down">${o.status.toUpperCase()}</span> ${esc(name(o.trader))} ${o.side} ${o.sym}: ${esc(o.reason ?? '')}</div>`;
          return `<div>${when} <span class="${o.side === 'buy' ? 'up' : 'down'}">${o.side.toUpperCase()}</span> ${esc(name(o.trader))} ${usd(o.usd)} ${o.sym} @ ${fmt.num(o.price, 2)} · ${esc(o.why ?? '')}</div>`;
        })
        .join('') || '<div>No orders yet.</div>';
  }
  hq.onDesk = () => ui.tab === 'exchange' && renderDesk();

  function renderExchange() {
    renderDesk();
    $('x-coins').innerHTML = Object.values(market.coins)
      .map((c) => {
        const ch = market.change(c.sym);
        return `<button class="coin-tab ${c.sym === ui.coin ? 'on' : ''}" data-sym="${c.sym}" style="--c:${c.color}">
          <div class="s">${c.sym}</div><div class="p">${c.price.toFixed(2)}</div><div class="${ch >= 0 ? 'up' : 'down'}" style="font:11px var(--mono)">${fmt.pct(ch)}</div></button>`;
      })
      .join('');
    const c = market.coins[ui.coin];
    drawLine($('x-chart'), c.history, c.color, { grid: true });
    $('x-blurb').innerHTML = `<span style="--c:${c.color}">${c.name}: ${c.blurb}</span>`;

    const w = ledger.get('player');
    const value = ledger.value('player');
    let staked = 0;
    for (const [id] of funds.funds) staked += funds.position(id, 'player').value;
    const total = value + staked;
    const pnl = total - world.config.playerCash;
    $('x-wallet').innerHTML = `
      <div>Credits<br><b>¢${fmt.num(w.cash, 2)}</b></div>
      <div>Net worth<br><b>¢${fmt.num(total, 2)}</b> <span class="${pnl >= 0 ? 'up' : 'down'}">${fmt.money(pnl)}</span></div>
      ${Object.entries(w.holdings)
        .map(([s, q]) => `<div style="color:${market.coins[s].color}">${s}<br><b>${q.toFixed(3)}</b> ≈ ¢${fmt.num(q * market.price(s), 2)}</div>`)
        .join('')}
      <div>In agent funds<br><b>¢${fmt.num(staked, 2)}</b></div>`;

    $('x-funds').innerHTML = world.agents
      .filter((a) => a.role === 'trader')
      .map((a) => {
        const nav = ledger.value(a.id);
        const pps = funds.pps(a.id);
        const ret = pps - 1;
        const pos = funds.position(a.id, 'player');
        return `<div class="fund">
          <div><div class="name" style="font-weight:600">${esc(a.name)} <span class="state">${a.strategy}</span></div>
            <div class="state">NAV ¢${fmt.num(nav)} · return <span class="${ret >= 0 ? 'up' : 'down'}">${fmt.pct(ret)}</span>${pos.shares ? ` · your stake ¢${fmt.num(pos.value, 2)}` : ''}</div></div>
          <div class="actions"><button class="btn small buy" data-act="invest" data-agent="${a.id}">Invest</button>
          <button class="btn small ghost" data-act="withdraw" data-agent="${a.id}" ${pos.shares ? '' : 'disabled'}>Cash out</button></div>
        </div>`;
      })
      .join('');

    const name = (id) => world.byId(id)?.name ?? (id === 'player' ? 'You' : id);
    $('x-p2p').innerHTML =
      p2p.map((t) => `<div>${esc(name(t.from))} → ${esc(name(t.to))}: <b style="color:${t.asset === 'cash' ? 'var(--gold)' : market.coins[t.asset].color}">${t.asset === 'cash' ? '¢' + fmt.num(t.amount) : fmt.num(t.amount, 2) + ' ' + t.asset}</b> · ${esc(t.memo)}</div>`).join('') ||
      '<div>No transfers yet. Traders send loans, tips and commissions when they chat.</div>';
    $('x-tape').innerHTML = market.trades
      .slice(-10)
      .reverse()
      .map((t) => `<div><span class="${t.side === 'buy' ? 'up' : 'down'}">${t.side.toUpperCase()}</span> ${esc(t.name)} ¢${fmt.num(t.notional)} ${t.sym} @ ${t.price.toFixed(2)}</div>`)
      .join('');
  }

  // --- Tickets ---------------------------------------------------------------------
  $('tab-tickets').innerHTML = `
    <h3>Agent HQ · real tickets for Claude</h3>
    <form id="hq-form" class="hq-form" novalidate>
      <input id="hq-title" maxlength="80" placeholder="Ticket title" autocomplete="off" aria-label="Ticket title" />
      <textarea id="hq-body" rows="2" placeholder="Details (optional)" aria-label="Ticket details"></textarea>
      <div class="trade"><button class="btn buy" id="hq-file" type="submit">File ticket</button><button class="btn ghost" id="hq-file-assign" type="button">File and assign to Claude</button></div>
    </form>
    <div id="hq-list"></div>
    <div id="sim-list"></div>`;

  async function fileTicket(assign) {
    const title = $('hq-title').value.trim();
    if (!title) return toast('Give the ticket a title');
    try {
      const t = await hq.create(title, $('hq-body').value);
      if (assign) await hq.assign(t.id);
      $('hq-title').value = '';
      $('hq-body').value = '';
      toast(assign ? `Filed #${t.id} and assigned it to Claude` : `Filed #${t.id}`);
    } catch (err) {
      toast(err.message);
    }
  }
  $('hq-form').addEventListener('submit', (e) => {
    e.preventDefault();
    fileTicket(false);
  });
  $('hq-file-assign').addEventListener('click', () => fileTicket(true));
  $('hq-list').addEventListener('pointerdown', async (e) => {
    const b = e.target.closest('button[data-hq]');
    if (!b) return;
    const id = Number(b.dataset.id);
    try {
      await (b.dataset.hq === 'assign' ? hq.assign(id) : hq.retry(id));
      toast(b.dataset.hq === 'assign' ? `Claude is on #${id}` : `Retrying #${id}`);
    } catch (err) {
      toast(err.message);
    }
  });

  const HQ_COLOR = { open: '#f2c14e', queued: '#f2a541', working: '#7fd1e8', done: '#4fd18b', failed: '#ff6b6b' };
  const plain = (md) => md.replace(/[#*`|>]/g, '').replace(/\s+/g, ' ').trim();
  function renderHqTickets() {
    if (!hq.online) {
      $('hq-list').innerHTML = '<div class="disclaimer">Agent HQ is offline. Run <code>node server.js</code> and open this page from http://127.0.0.1:4317/district/.</div>';
      return;
    }
    const list = [...hq.tickets].sort((a, b) => b.id - a.id).slice(0, 20);
    $('hq-list').innerHTML =
      list
        .map((t) => {
          const usage = t.cost_usd != null ? ` · ${fmt.usd(Number(t.cost_usd))} · ${fmt.tokens((t.tokens_in || 0) + (t.tokens_out || 0))} tok` : '';
          const note = noteName(t.note_path);
          const action = t.status === 'open' ? 'assign' : t.status === 'failed' ? 'retry' : null;
          const text = t.output ? plain(t.output) : '';
          const out = text ? esc(text.slice(0, 180)) + (text.length > 180 ? '…' : '') : '';
          return `<div class="ticket real" style="--c:${HQ_COLOR[t.status] ?? '#888'}">
            <div class="t"><span>#${t.id} · ${esc(t.title)}</span><span class="pill" style="--c:${HQ_COLOR[t.status] ?? '#888'}">${t.status}</span></div>
            <div class="who">${t.assignee ? 'Claude' : 'unassigned'}${usage}</div>
            ${out ? `<div class="out">${out}</div>` : ''}
            ${note ? `<div class="who vault">📓 Saved to Obsidian: 00-inbox/${esc(note)}</div>` : ''}
            ${action ? `<div class="trade"><button class="btn small ${action === 'assign' ? 'buy' : 'ghost'}" data-hq="${action}" data-id="${t.id}">${action === 'assign' ? 'Assign to Claude' : 'Retry'}</button></div>` : ''}
          </div>`;
        })
        .join('') || '<div class="disclaimer">No tickets yet. File one above.</div>';
  }

  function renderTickets() {
    renderHqTickets();
    const list = board.tickets.slice(0, 30);
    $('sim-list').innerHTML =
      `<h3>Town tickets · simulated · ${board.openCount()} open · ${board.tickets.filter((t) => t.status === 'done').length} closed</h3>` +
      list
        .map((t) => {
          const who = t.assignee ? world.byId(t.assignee).name : 'unassigned';
          return `<div class="ticket" style="--c:${KIND_COLOR[t.kind]}">
            <div class="t"><span>${t.id} · ${esc(t.title)}</span><span class="pill" style="--c:${STATUS_COLOR[t.status]}">${t.status.replace('_', ' ')}</span></div>
            <div class="who">${t.kind} · filed by ${esc(t.by)} · ${esc(who)}</div>
            ${t.steps.length ? `<ul class="steps">${t.steps.map((s) => `<li><b>${s.phase}</b>${esc(s.text)}</li>`).join('')}</ul>` : ''}
          </div>`;
        })
        .join('');
  }

  // --- Chat feed --------------------------------------------------------------------
  world.bus.on('chat', ({ conv, speaker, listener, text }) => {
    const el = document.createElement('div');
    el.className = 'msg';
    el.innerHTML = `<div class="h"><b style="--c:${speaker.color};color:${speaker.color}">${esc(speaker.name)}</b> → ${esc(listener.name)} <span class="topic">${conv.topic}</span></div>${esc(text)}`;
    const feed = $('chat-feed');
    feed.prepend(el);
    while (feed.children.length > 80) feed.lastChild.remove();
  });

  // --- event feed + toast ------------------------------------------------------------
  const feedEvent = (kind, text) => {
    const el = document.createElement('div');
    el.className = 'ev';
    el.style.setProperty('--c', EVENT_COLOR[kind] ?? '#888');
    el.textContent = text;
    $('feed').prepend(el);
    while ($('feed').children.length > 6) $('feed').lastChild.remove();
    setTimeout(() => el.remove(), 10000);
  };
  world.bus.on('log', (l) => feedEvent(l.kind, l.text));
  world.bus.on('news', (n) => feedEvent('news', `📰 ${n.headline}`));

  let toastTimer;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // --- inspector ----------------------------------------------------------------------
  function select(a) {
    ui.selected = a;
    scene.select(a);
    $('inspector').hidden = !a;
    renderInspector();
  }
  scene.onSelect = select;
  $('inspector').addEventListener('click', (e) => {
    if (e.target.closest('.close')) select(null);
    if (e.target.closest('.follow')) scene.follow = !scene.follow;
  });

  function renderInspector() {
    const a = ui.selected;
    if (!a) return;
    if (a.external) {
      const R = hq.usage();
      const cur = hq.agent.status === 'working' ? hq.tickets.find((t) => t.id === hq.agent.ticket) : null;
      $('inspector').innerHTML = `
        <div class="head"><div class="avatar" style="--c:${a.color}">✳️</div>
          <div><div style="font-weight:700">Claude</div><div class="state">real agent · Claude Code via Agent HQ</div></div>
          <button class="close" title="Close">✕</button></div>
        <div class="thought">💭 ${esc(a.thought)}</div>
        <div class="grid">
          <div style="grid-column:1/-1"><span>Doing</span>${esc(a.state)}</div>
          ${cur ? `<div style="grid-column:1/-1"><span>Ticket</span>#${cur.id} ${esc(cur.title)}</div>` : ''}
          <div><span>Runs</span>${R.runs}</div>
          <div><span>Real spend</span>${fmt.usd(R.cost)}</div>
          <div><span>Tokens</span>${fmt.tokens(R.in + R.out)}</div>
          <div><span>Vault notes</span>${hq.notes}</div>
        </div>
        <div style="margin-top:10px;display:flex;gap:6px"><button class="btn small ghost follow">${scene.follow ? 'Stop following' : 'Follow'}</button></div>`;
      return;
    }
    const acct = ledger.get(a.id);
    const value = ledger.value(a.id);
    const pnl = value - a.startValue;
    const m = MODELS[a.model];
    $('inspector').innerHTML = `
      <div class="head"><div class="avatar" style="--c:${a.color}">${ROLE_ICON[a.role]}</div>
        <div><div style="font-weight:700">${esc(a.name)}</div><div class="state">${a.role}${a.strategy ? ' · ' + a.strategy : ''} · <span class="badge" style="--c:${m.color}">${m.label}</span></div></div>
        <button class="close" title="Close">✕</button></div>
      <div class="thought">💭 ${esc(a.thought)}</div>
      ${a.lastMsg ? `<div class="state" style="margin-top:6px">Last said: “${esc(a.lastMsg)}”</div>` : ''}
      <div class="grid">
        <div><span>Doing</span>${a.throttled ? 'Zz rate-limited' : esc(a.state)}</div>
        <div><span>Tokens today</span>${fmt.tokens(a.tokens.today)} / ${fmt.tokens(a.budget)}</div>
        <div><span>Tokens total</span>${fmt.tokens(a.tokens.in + a.tokens.out)}</div>
        <div><span>Spend</span>${fmt.usd(a.tokens.cost)}</div>
        <div><span>Wallet</span>¢${fmt.num(acct.cash)}</div>
        <div><span>Net worth</span>¢${fmt.num(value)} <span class="${pnl >= 0 ? 'up' : 'down'}">${fmt.money(pnl)}</span></div>
        <div style="grid-column:1/-1"><span>Coins</span>${Object.entries(acct.holdings).map(([s, q]) => `${s} ${q.toFixed(2)}`).join(' · ')}</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px"><button class="btn small ghost follow">${scene.follow ? 'Stop following' : 'Follow'}</button></div>`;
  }

  function render() {
    renderTop();
    if (ui.tab === 'hub') renderHub();
    if (ui.tab === 'exchange') renderExchange();
    if (ui.tab === 'tickets') renderTickets();
    renderInspector();
  }

  ui.tick = (dt) => {
    ui.timer -= dt;
    if (ui.timer <= 0) {
      ui.timer = 0.5;
      render();
    }
  };
  ui.select = select;
  hq.onChange = () => ui.tab === 'tickets' && renderHqTickets();
  if (innerWidth <= 820) $('panel').classList.add('collapsed');
  render();
  return ui;
}
