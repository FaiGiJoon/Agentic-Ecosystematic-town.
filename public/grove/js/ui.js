// The grove's panels: top bar with Play/Pause and the real-spend chips, the side
// panel (Koalas, Talk, Meter), the inspector card with the visitor's actions, and
// the event feed. Model text is always inserted as text, never as HTML.

import { fmtUsd, fmtTokens, statusOf } from './view.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ITEM_GLYPH = { leaf: '🍃', blossom: '🌸', pebble: '🪨', ball: '⚽', feather: '🪶' };
const DOING = {
  move: 'looking around', eat: 'munching eucalyptus', nap: 'napping', play: 'playing', climb: 'up the tree',
  approach: 'keeping company', give: 'sharing', sit: 'sitting',
};
const LOG_CLASS = { say: 'say', think: 'think', act: 'act', visitor: 'visitor', error: 'error', system: 'system' };

export function createUI({ scene, api }) {
  let state = null;
  let selected = null;
  let tab = 'koalas';
  let clockOffset = 0;
  let introDismissed = false;
  let busy = false;
  const name = (id) => state?.koalas.find((k) => k.id === id)?.name ?? id;

  // --- top bar -------------------------------------------------------------------------
  const playBtn = $('#play');
  playBtn.addEventListener('click', async () => {
    if (!state || busy) return;
    busy = true;
    playBtn.disabled = true;
    try {
      await (state.playing ? api.pause() : api.play());
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
      playBtn.disabled = false;
    }
  });
  const modeBtn = $('#mode');
  const setMode = (m) => {
    scene.setMode(m);
    modeBtn.textContent = m === 'walk' ? 'Walking' : 'Watching';
    modeBtn.title = m === 'walk' ? 'Switch to watching (V)' : 'Switch to walking (V)';
    $('#hint').textContent = m === 'walk'
      ? 'WASD or click the grass to walk, drag to look, E or click a koala to visit, V to watch'
      : 'Drag to orbit, scroll to zoom, click a koala to follow it, V to walk';
  };
  modeBtn.addEventListener('click', () => setMode(scene.mode === 'walk' ? 'watch' : 'walk'));
  setMode('walk');

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, button')) return;
    const k = e.key.toLowerCase();
    if (k === 'v') setMode(scene.mode === 'walk' ? 'watch' : 'walk');
    if (k === 'escape') select(null);
    if (k === 'e') {
      const me = scene.visitor.root.position;
      let best = null;
      for (const [id, v] of scene.koalas) {
        const d = Math.hypot(v.pos.x - me.x, v.pos.z - me.z);
        if (d < 4.5 && (!best || d < best.d)) best = { id, d };
      }
      if (best) select(best.id);
      else toast('Walk closer to a koala first.');
    }
  });

  // --- side panel ----------------------------------------------------------------------
  for (const b of document.querySelectorAll('#tabs button')) {
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('on', x === b);
      for (const s of document.querySelectorAll('.tab-body')) s.hidden = s.id !== `tab-${tab}`;
      draw();
    });
  }
  $('#panel-toggle').addEventListener('click', () => {
    $('#panel').classList.toggle('collapsed');
    scene.resize();
  });

  // --- inspector -----------------------------------------------------------------------
  const insp = $('#inspector');
  insp.innerHTML = `
    <div class="head">
      <div class="avatar"></div>
      <div><div class="iname"></div><div class="state"></div></div>
      <button class="close" type="button" title="Close (Esc)">×</button>
    </div>
    <div class="thought"></div>
    <div class="said"></div>
    <div class="needs"></div>
    <div class="give" role="group" aria-label="Give an item"></div>
    <form class="talk">
      <input maxlength="140" placeholder="Say something to the koala" aria-label="Say something">
      <button class="btn" type="submit">Say</button>
      <button class="btn ghost pat" type="button">Pat</button>
    </form>
    <div class="cost-note">Giving, saying and patting are free. The koala reacts on its next decision, and that is a real model call.</div>`;
  insp.querySelector('.close').addEventListener('click', () => select(null));
  const give = insp.querySelector('.give');
  for (const item of Object.keys(ITEM_GLYPH)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item';
    b.title = `Give a ${item}`;
    b.innerHTML = `<span aria-hidden="true">${ITEM_GLYPH[item]}</span>${item}`;
    b.addEventListener('click', () => act({ kind: 'give', item }, `Gave ${name(selected)} a ${item}.`));
    give.append(b);
  }
  const form = insp.querySelector('.talk');
  const input = form.querySelector('input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return input.focus();
    act({ kind: 'say', text }, null).then((ok) => { if (ok) input.value = ''; });
  });
  insp.querySelector('.pat').addEventListener('click', () => act({ kind: 'pet' }, `You patted ${name(selected)}.`));

  async function act(body, done) {
    if (!selected) return false;
    scene.visit(selected);
    try {
      await api.act({ koala: selected, ...body });
      if (done) toast(done);
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  }

  function select(id) {
    selected = id;
    scene.select(id);
    insp.hidden = !id;
    drawInspector();
  }
  scene.onPick = (id) => select(id);

  // --- intro ---------------------------------------------------------------------------
  const intro = $('#intro');
  $('#intro-play').addEventListener('click', async () => {
    introDismissed = true;
    intro.hidden = true;
    try { await api.play(); } catch (err) { toast(err.message); }
  });
  $('#intro-look').addEventListener('click', () => {
    introDismissed = true;
    intro.hidden = true;
  });

  // --- feed and toast ------------------------------------------------------------------
  const feed = $('#feed');
  function onLog(e) {
    if (e.kind === 'think') return;
    const el = document.createElement('div');
    el.className = `ev ${LOG_CLASS[e.kind] ?? ''}`;
    const who = e.koala ? state?.koalas.find((k) => k.id === e.koala) : null;
    el.style.setProperty('--c', e.kind === 'error' ? 'var(--red)' : e.kind === 'visitor' ? 'var(--mint)' : who?.color ?? 'var(--muted)');
    el.textContent = e.kind === 'say' ? `${who?.name ?? ''}: “${e.text}”` : e.text;
    feed.prepend(el);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => el.remove(), 14000);
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // --- drawing -------------------------------------------------------------------------
  function bar(v, color) {
    return `<div class="bar"><i style="width:${Math.round(v)}%;background:${color}"></i></div>`;
  }
  function bondBar(v) {
    const left = v < 0 ? 50 + v / 2 : 50;
    const w = Math.abs(v) / 2;
    return `<div class="bond"><i style="left:${left}%;width:${w}%;background:${v < 0 ? 'var(--red)' : 'var(--mint)'}"></i><b></b></div>`;
  }
  const where = (k) => state.places[k.place]?.name ?? k.place;
  function nextIn(k) {
    if (k.thinking) return 'thinking now';
    if (!state.playing || state.capped || k.nextAt == null) return 'resting';
    const s = Math.max(0, Math.round((k.nextAt - (Date.now() + clockOffset)) / 1000));
    return s ? `decides in ${s} s` : 'deciding soon';
  }

  function drawKoalas() {
    const friend = (k) => state.koalas.find((o) => o.id !== k.id);
    $('#tab-koalas').innerHTML = state.koalas.map((k) => `
      <article class="kcard" style="--c:${k.color}" data-id="${esc(k.id)}">
        <div class="khead">
          <span class="dot"></span><b>${esc(k.name)}</b><span class="mood">${esc(k.mood)}</span>
          <span class="next" data-next="${esc(k.id)}">${esc(nextIn(k))}</span>
        </div>
        <div class="doing">${esc(DOING[k.activity] ?? k.activity)} at the ${esc(where(k))}</div>
        ${k.thought ? `<div class="thought">${esc(k.thought)}</div>` : ''}
        <div class="needs2">
          <label>Hunger</label>${bar(k.hunger, 'var(--orange)')}
          <label>Energy</label>${bar(k.energy, 'var(--mint)')}
          <label>Bond</label>${bondBar(k.bond)}
        </div>
        <div class="opinion">${k.opinion ? `On ${esc(friend(k).name)}: “${esc(k.opinion)}”` : `No opinion of ${esc(friend(k).name)} yet.`}</div>
        <div class="holds">Holding: ${k.inventory.length ? k.inventory.map(esc).join(', ') : 'nothing'}</div>
        <details ${k.memories.length ? 'open' : ''}><summary>Remembers (${k.memories.length})</summary>
          <ul>${k.memories.map((m) => `<li>${esc(m)}</li>`).join('') || '<li class="muted">Nothing yet. Memories form as the koalas live.</li>'}</ul>
        </details>
        <details><summary>Noticed lately</summary><ul>${k.recent.map((m) => `<li>${esc(m)}</li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul></details>
      </article>`).join('');
    for (const card of document.querySelectorAll('.kcard')) card.addEventListener('click', (e) => {
      if (!e.target.closest('details')) select(card.dataset.id);
    });
  }

  function drawTalk() {
    const body = $('#tab-talk');
    const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
    body.innerHTML = state.log.length ? state.log.map((e) => {
      const k = state.koalas.find((x) => x.id === e.koala);
      const time = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const head = e.kind === 'visitor' ? 'You' : k?.name ?? 'Grove';
      return `<div class="line ${LOG_CLASS[e.kind] ?? ''}" style="--c:${k?.color ?? 'var(--muted)'}">
        <span class="t">${time}</span><b>${esc(head)}</b><span class="x">${esc(e.kind === 'say' ? `“${e.text}”` : e.text)}</span></div>`;
    }).join('') : '<p class="empty">Nothing has happened yet. Press Play and the koalas start deciding for themselves.</p>';
    if (atEnd) body.scrollTop = body.scrollHeight;
  }

  function drawMeter() {
    const u = state.usage;
    const pct = Math.min(100, (u.today.cost / u.dayUsd) * 100);
    const avg = u.total.calls ? u.total.cost / u.total.calls : 0;
    const row = (k) => {
      const b = u.byKoala[k.id];
      return `<div class="row real" style="--c:${k.color}">
        <div class="name"><span class="dot" style="background:${k.color}"></span>${esc(k.name)}</div>
        <div class="meta">${fmtUsd(b.today.cost)} today</div>
        <div class="sub">${b.today.calls} calls, ${fmtTokens(b.today.tokens_in)} in, ${fmtTokens(b.today.tokens_out)} out</div>
        <div class="meta">${fmtUsd(b.total.cost)} all time</div>
      </div>`;
    };
    const last = u.last;
    $('#tab-meter').innerHTML = `
      <div class="disclaimer real-note">Real usage. Each decision is one <code>claude -p</code> call on your Claude Code login,
        model <code>${esc(u.model)}</code>, at most ${fmtUsd(u.callUsd)} per call. The numbers come from the CLI's own result.</div>
      <h3>Today</h3>
      <div class="spend"><b>${fmtUsd(u.today.cost)}</b> of ${fmtUsd(u.dayUsd)} daily cap</div>
      <div class="bar cap"><i style="width:${pct}%;background:${pct >= 100 ? 'var(--red)' : 'var(--real)'}"></i></div>
      <div class="big real">
        <div class="stat"><div class="k">Decisions</div><div class="v">${u.today.calls}</div></div>
        <div class="stat"><div class="k">Tokens in</div><div class="v">${fmtTokens(u.today.tokens_in)}</div></div>
        <div class="stat"><div class="k">Tokens out</div><div class="v">${fmtTokens(u.today.tokens_out)}</div></div>
      </div>
      <h3>Per koala</h3>
      <div class="rows">${state.koalas.map(row).join('')}</div>
      <h3>Last call</h3>
      <p class="lastcall">${last ? `${esc(name(last.koala))}: ${fmtTokens(last.tokens_in)} in, ${fmtTokens(last.tokens_out)} out,
        ${last.ms != null ? `${(last.ms / 1000).toFixed(1)} s, ` : ''}${fmtUsd(last.cost)}${last.ok ? '' : ', failed'}` : 'No calls yet.'}</p>
      <h3>Pace</h3>
      <p class="lastcall">${u.total.calls ? `${fmtUsd(avg)} per decision on average. Two koalas deciding every 40 s or so comes to about ${fmtUsd(avg * 180)} an hour.` : 'The pace shows after the first decisions.'}
        All time: ${fmtUsd(u.total.cost)} over ${u.total.calls} calls.</p>`;
  }

  function drawInspector() {
    if (!selected || !state) return;
    const k = state.koalas.find((x) => x.id === selected);
    if (!k) return;
    insp.style.setProperty('--c', k.color);
    insp.querySelector('.avatar').textContent = k.name[0];
    insp.querySelector('.iname').textContent = k.name;
    insp.querySelector('.state').textContent = `${k.mood}, ${DOING[k.activity] ?? k.activity} at the ${where(k)}`;
    const th = insp.querySelector('.thought');
    th.textContent = k.thinking ? 'Thinking…' : k.thought || 'No thoughts yet.';
    const said = insp.querySelector('.said');
    said.textContent = k.say ? `Last said: “${k.say}”` : '';
    said.hidden = !k.say;
    insp.querySelector('.needs').innerHTML = `<label>Hunger</label>${bar(k.hunger, 'var(--orange)')}<label>Energy</label>${bar(k.energy, 'var(--mint)')}`;
    const full = k.inventory.length >= 4;
    for (const b of give.children) b.disabled = full;
    give.title = full ? `${k.name}'s paws are full` : '';
  }

  function drawChips() {
    const st = statusOf(state);
    const u = state.usage;
    $('#chips').innerHTML = `
      <div class="chip status ${st.key}" title="${esc(st.text)}"><i></i>${esc({ live: 'Live', thinking: 'Thinking', paused: 'Paused', capped: 'Cap reached', away: 'Waiting', offline: 'Offline' }[st.key])}</div>
      <div class="chip real" title="Real spend today, against GROVE_DAY_USD">Today <b>${fmtUsd(u.today.cost)}</b> / ${fmtUsd(u.dayUsd)}</div>
      <div class="chip real" title="Real tokens today, in and out">Tokens <b>${fmtTokens(u.today.tokens_in + u.today.tokens_out)}</b></div>`;
    playBtn.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
    playBtn.classList.toggle('on', !state.playing);
    playBtn.title = state.playing ? 'Pause: no more model calls' : 'Play: the koalas start making real model calls';
    $('#status-line').textContent = st.text;
    $('#clock').textContent = state.clock.label;
  }

  function draw() {
    if (!state) return;
    drawChips();
    if (tab === 'koalas') drawKoalas();
    if (tab === 'talk') drawTalk();
    if (tab === 'meter') drawMeter();
    drawInspector();
  }

  let second = 0;
  return {
    onLog,
    render(s) {
      state = s;
      clockOffset = s.now - Date.now();
      $('#boot').hidden = true;
      if (s.playing) introDismissed = true; // the intro is for a grove that has not woken yet
      if (!introDismissed) {
        intro.hidden = s.playing;
        $('#intro-cap').textContent = `Today's cap is ${fmtUsd(s.usage.dayUsd)}, on ${s.usage.model}. Spent so far: ${fmtUsd(s.usage.today.cost)}.`;
      }
      draw();
    },
    offline(msg) {
      $('#chips').innerHTML = `<div class="chip status offline"><i></i>Offline</div>`;
      $('#status-line').textContent = msg || 'Lost the connection to Agent HQ. Reconnecting…';
    },
    tick(dt) {
      second += dt;
      if (second < 1 || !state) return;
      second = 0;
      for (const el of document.querySelectorAll('[data-next]')) {
        const k = state.koalas.find((x) => x.id === el.dataset.next);
        if (k) el.textContent = nextIn(k);
      }
    },
  };
}
