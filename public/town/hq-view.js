// Browser-safe view helpers for Agent HQ. Pure: no DOM, no Node imports.

const WORDS = {
  THINK: 'THINKING',
  READ: 'READING',
  WEB: 'WEB SEARCH',
  WRITE: 'WRITING',
  SEARCH: 'SEARCHING',
};

export function describe(step) {
  return WORDS[step && step.label] || 'THINKING';
}

const GOALS = { pickup: 'board', work: 'desk', handin: 'board', idle: 'home' };
const MAX_ITEM = 18;

// Characters the canvas font cannot draw become their base letter, or '?'.
export function displayText(s, font) {
  let out = '';
  for (const ch of String(s)) {
    if (font.has(ch)) { out += ch; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base !== ch && font.has(base) ? base : '?';
  }
  return out;
}

export function ticker(agent, tickets) {
  if (!agent || agent.status !== 'working') return 'CLAUDE  IDLE';
  const what = agent.step ? `  ${describe(agent.step)}` : '';
  return `CLAUDE  #${agent.ticket}${what}`;
}

export function bubble(step) {
  const label = step && step.label;
  return label === 'READ' || label === 'WEB' || label === 'WRITE' || label === 'SEARCH' ? label : '...';
}

export function claudeGoal(agent, phase) {
  return GOALS[phase] || 'home';
}

export function nextPhase(prevAgent, agent, phase, atGoal) {
  const working = !!agent && agent.status === 'working';
  if (phase === 'idle') return working ? 'pickup' : 'idle';
  if (phase === 'pickup') {
    if (!working) return atGoal ? 'idle' : 'handin';
    return atGoal ? 'work' : 'pickup';
  }
  if (phase === 'work') {
    if (!working) return 'handin';
    const switched = prevAgent && prevAgent.status === 'working' && prevAgent.ticket !== agent.ticket;
    return switched ? 'handin' : 'work';
  }
  if (phase === 'handin') {
    if (!atGoal) return 'handin';
    return working ? 'pickup' : 'idle';
  }
  return 'idle';
}

// The done/failed bubble waits for the hand-in: it shows once CLAUDE leaves the
// handin phase (it has reached the board), or right away when it is already idle.
export function outcomeDue(prevPhase, phase) {
  return phase === 'idle' || (prevPhase === 'handin' && phase !== 'handin');
}

const num = (id) => Number(id) || 0;

function newestFirst(tickets) {
  return [...(tickets || [])].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || '')) || num(b.id) - num(a.id));
}

export function boardItems(tickets) {
  const sorted = newestFirst(tickets);
  return ['NEW TICKET', ...sorted.map((t) =>
    `#${t.id} ${String(t.status).toUpperCase()}  ${String(t.title).replace(/\s+/g, ' ').trim()}`.slice(0, MAX_ITEM))];
}

function hhmm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 52010 -> '52K', 3100 -> '3.1K', 900 -> '900'.
function kilo(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? Number(k.toFixed(1)) : Math.round(k)}K`;
}

// The font has no '$', so cost reads '0.41 USD'.
function usageLine(t) {
  if (t.cost_usd == null) return null;
  const secs = Math.round((t.duration_ms || 0) / 1000);
  return `USAGE: ${Number(t.cost_usd).toFixed(2)} USD  ${kilo(t.tokens_in || 0)} IN  ${kilo(t.tokens_out || 0)} OUT  ${secs}S`;
}

export function ticketLines(ticket, events) {
  const usage = usageLine(ticket);
  const lines = [
    ticket.title,
    `STATUS: ${String(ticket.status).toUpperCase()}`,
    `FOR: ${ticket.assignee ? 'CLAUDE' : 'NOBODY'}`,
    ...(usage ? [usage] : []),
    'REQUEST',
    ...String(ticket.body || '').split(/\r?\n/),
    'HISTORY',
  ];
  for (const e of events || []) lines.push(`${hhmm(e.at)} ${String(e.kind).toUpperCase()} ${e.text}`);
  lines.push('RESULT', ...String(ticket.output || '(none yet)').split(/\r?\n/));
  return lines;
}

export function ticketMenu(ticket) {
  const menu = [];
  const st = String(ticket.status).toLowerCase();
  if (st === 'open') menu.push('ASSIGN TO CLAUDE');
  if (st === 'failed') menu.push('RETRY');
  menu.push('BACK');
  return menu;
}

export function claudeSays(agent, tickets) {
  if (!agent || agent.status !== 'working') {
    const newest = newestFirst(tickets)[0];
    if (newest && String(newest.status).toLowerCase() === 'failed') {
      return `I couldn't finish #${newest.id}. Try RETRY at the board.`;
    }
    return 'No tickets for me. Add one at the POKéMON CENTER!';
  }
  const t = (tickets || []).find((x) => Number(x.id) === Number(agent.ticket));
  const title = t ? `: ${t.title}` : '';
  const detail = agent.step && agent.step.detail ? ` ${agent.step.detail}` : '';
  const now = agent.step ? describe(agent.step) : 'THINKING';
  return `Working on #${agent.ticket}${title}. Now: ${now}${detail}`;
}
