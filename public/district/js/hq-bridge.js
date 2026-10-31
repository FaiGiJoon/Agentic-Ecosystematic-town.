// The district's line to the real Agent HQ: the same tickets, event stream and
// CLAUDE phase machine as Goldenrod City, drawn in 3D. The simulated agents
// around it never touch this data; real usage is kept apart from their estimates.

import { api, connect } from '../../town/live.js';
import { bubble, claudeGoal, describe, nextPhase, outcomeDue } from '../../town/hq-view.js';
import { DISTRICTS } from './sim/builders.js';
import { dist } from './sim/core.js';

// Where CLAUDE stands for each goal of the shared phase machine.
export const SPOTS = {
  board: { x: DISTRICTS.board.x + 1.6, z: DISTRICTS.board.z + 2.4 },
  desk: { x: DISTRICTS.hub.x + 5.2, z: DISTRICTS.hub.z + 3.6 },
  home: { x: DISTRICTS.library.x + 3.2, z: DISTRICTS.library.z - 3.2 },
};

const SPEED = 5;

// Real spend over all finished runs, as reported by Claude Code.
export function usageTotals(tickets) {
  const t = { runs: 0, cost: 0, in: 0, out: 0, ms: 0 };
  for (const x of tickets || []) {
    if (x.cost_usd == null) continue;
    t.runs++;
    t.cost += Number(x.cost_usd) || 0;
    t.in += Number(x.tokens_in) || 0;
    t.out += Number(x.tokens_out) || 0;
    t.ms += Number(x.duration_ms) || 0;
  }
  return t;
}

// Only the file name of a vault note is shown, never the full path.
export function noteName(p) {
  return p ? String(p).split(/[\\/]/).pop() : null;
}

export function connectHQ(world, scene) {
  const claude = {
    id: 'claude',
    name: 'Claude',
    role: 'claude',
    external: true,
    color: '#d97757',
    pos: { ...SPOTS.home },
    heading: Math.PI,
    queue: [],
    state: 'idle at the library',
    thought: 'Waiting for a ticket.',
    carry: 0,
    talking: null,
    throttled: false,
  };

  const hq = {
    claude,
    online: false,
    tickets: [],
    agent: { status: 'idle', ticket: null, step: null },
    prevAgent: null,
    phase: 'idle',
    outcome: null,
    notes: 0,
    onChange: null,
  };

  scene.addAgent(claude);

  const atGoal = () => dist(claude.pos, SPOTS[claudeGoal(hq.agent, hq.phase)]) < 0.15;

  function advance(next) {
    const p = nextPhase(hq.prevAgent, next, hq.phase, atGoal());
    hq.prevAgent = next;
    hq.agent = next;
    const was = hq.phase;
    hq.phase = p;
    if (hq.outcome && outcomeDue(was, hq.phase)) {
      scene.showBubble(claude, hq.outcome, 'say');
      hq.outcome = null;
    }
  }

  function upsert(t) {
    const i = hq.tickets.findIndex((x) => x.id === t.id);
    const before = i >= 0 ? hq.tickets[i] : null;
    if (i >= 0) hq.tickets[i] = t;
    else hq.tickets.push(t);
    if (t.note_path && !before?.note_path) {
      hq.notes++;
      scene.addBook?.();
      world.log('vault', `Claude's answer to #${t.id} was saved to Obsidian: ${noteName(t.note_path)}`);
    }
    if (before && before.status !== t.status) {
      if (t.status === 'working') world.rumor(`Claude is working on #${t.id}: ${t.title}.`);
      if (t.status === 'done') world.rumor(`Claude finished #${t.id}: ${t.title}.`);
      if (t.status === 'failed') world.rumor(`Claude couldn't finish #${t.id}.`);
    }
    hq.onChange?.();
  }

  connect({
    onState(s) {
      hq.online = true;
      hq.tickets = s.tickets || [];
      hq.notes = hq.tickets.filter((t) => t.note_path).length;
      scene.setBooks?.(hq.notes);
      if (s.agent) advance(s.agent);
      hq.onChange?.();
    },
    onTicket: upsert,
    onEvent(e) {
      if (e.kind === 'done') hq.outcome = `! #${e.ticket_id} done`;
      else if (e.kind === 'failed') hq.outcome = `? #${e.ticket_id} failed`;
    },
    onAgent(a) {
      if (a.step) {
        claude.thought = `${describe(a.step)} ${a.step.detail || ''}`.trim();
        scene.showBubble(claude, `${bubble(a.step)} ${a.step.detail || ''}`.trim(), 'think');
      }
      advance(a);
    },
    onOffline() {
      hq.online = false;
      hq.onChange?.();
    },
  });

  hq.update = (dt) => {
    advance(hq.agent);
    const goal = SPOTS[claudeGoal(hq.agent, hq.phase)];
    const dx = goal.x - claude.pos.x;
    const dz = goal.z - claude.pos.z;
    const d = Math.hypot(dx, dz);
    const step = SPEED * dt;
    if (d > 0.15) {
      const k = Math.min(1, step / d);
      claude.pos.x += dx * k;
      claude.pos.z += dz * k;
      claude.heading = Math.atan2(dx, dz);
      claude.queue = [{ k: 'walk' }];
    } else {
      claude.queue = [];
    }
    const working = hq.agent.status === 'working';
    claude.state = !hq.online
      ? 'offline: is the HQ server running?'
      : hq.phase === 'pickup'
        ? `picking up #${hq.agent.ticket}`
        : hq.phase === 'work'
          ? `working on #${hq.agent.ticket} at the Hub`
          : hq.phase === 'handin'
            ? 'bringing the result to the board'
            : 'idle at the library';
    if (!working && hq.phase === 'idle') claude.thought = 'Waiting for a ticket.';
  };

  hq.create = (title, body) => api.create({ title, body });
  hq.assign = (id) => api.assign(id);
  hq.retry = (id) => api.retry(id);
  hq.usage = () => usageTotals(hq.tickets);
  return hq;
}
