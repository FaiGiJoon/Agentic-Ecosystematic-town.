// Koala Grove: the rules of the grove. Two koalas, each a real model call away
// from its next move. Everything here is pure: the Grove (grove.js) owns time,
// storage and the model calls, and asks these functions what a decision means.

export const KOALAS = [
  {
    id: 'mallee',
    name: 'Mallee',
    color: '#b9c2c9',
    home: 'clearing',
    persona: 'Mallee is a young, bold and endlessly curious koala. Mallee loves exploring every corner of the grove, '
      + 'collects shiny pebbles, splashes at the pond, talks a lot, gets bored quickly and sometimes teases. '
      + 'Mallee secretly wants Bramble to think Mallee is brave.',
  },
  {
    id: 'bramble',
    name: 'Bramble',
    color: '#8d8478',
    home: 'hollow',
    persona: 'Bramble is an older, gentle and sleepy koala. Bramble adores eucalyptus, long naps in the mossy hollow '
      + 'and quiet company. Bramble speaks softly and a little poetically, is slow to trust, notices small things, '
      + 'and is protective of friends once they have earned it.',
  },
];

// Grove-space coordinates (metres); the page builds the same places in 3D.
export const PLACES = {
  big_gum: { name: 'Big Gum', x: -8, z: -6, tree: true },
  river_gum: { name: 'River Gum', x: 9, z: -9, tree: true },
  blue_gum: { name: 'Blue Gum', x: -12, z: 8, tree: true },
  pond: { name: 'Lily Pond', x: 10, z: 2 },
  swing: { name: 'Rope Swing', x: 2, z: -12 },
  clearing: { name: 'Sunny Clearing', x: 0, z: 2 },
  hollow: { name: 'Mossy Hollow', x: -15, z: -1 },
  lookout: { name: 'Lookout Rock', x: 14, z: 12 },
  flowers: { name: 'Blossom Patch', x: -2, z: 13 },
};

export const ITEMS = ['leaf', 'blossom', 'pebble', 'ball', 'feather'];
export const ACTIONS = ['move', 'eat', 'nap', 'play', 'climb', 'approach', 'give', 'sit'];
export const MOODS = ['happy', 'playful', 'sleepy', 'hungry', 'curious', 'cozy', 'grumpy', 'shy', 'content', 'lonely'];
const TOYS = { ball: 'clearing', swing: 'swing', pond: 'pond' };
const TREES = Object.keys(PLACES).filter((id) => PLACES[id].tree);
const MAX_RECENT = 10;
const MAX_MEMORIES = 12;
const MAX_ITEMS = 4;
export { MAX_ITEMS };

export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    thought: { type: 'string', description: 'Your private thought right now, one short sentence.' },
    action: { type: 'string', enum: ACTIONS },
    target: { type: 'string', description: 'A place id, a toy (ball, swing, pond) or an item to give; empty if none.' },
    say: { type: 'string', description: 'What you say out loud, or empty to stay quiet.' },
    mood: { type: 'string', enum: MOODS },
    remember: { type: 'string', description: 'Something worth remembering for a long time, or empty.' },
    bond: { type: 'integer', minimum: -3, maximum: 3, description: 'How this moment changes your feelings about your friend.' },
    opinion: { type: 'string', description: 'One line: what you think of your friend now, or empty to keep it.' },
  },
  required: ['thought', 'action', 'target', 'say', 'mood', 'remember', 'bond', 'opinion'],
  additionalProperties: false,
};

const byId = (id) => KOALAS.find((k) => k.id === id);
const other = (id) => KOALAS.find((k) => k.id !== id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const text = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const push = (list, item, max) => {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
};

export function newKoala(id) {
  const k = byId(id);
  return {
    id,
    name: k.name,
    place: k.home,
    activity: 'sit',
    mood: 'content',
    hunger: 30,
    energy: 80,
    inventory: [],
    bond: 0,
    opinion: '',
    memories: [],
    recent: [],
    thought: '',
    say: '',
  };
}

// The first {...} block in a string, parsed; null if there is none that parses.
function jsonIn(s) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// A model's reply made safe to act on: unknown actions become sitting, impossible
// targets are replaced with the nearest sensible one, text is trimmed and capped.
export function parseDecision(raw, koala) {
  const obj = typeof raw === 'string' ? jsonIn(raw) : raw;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  let action = ACTIONS.includes(obj.action) ? obj.action : 'sit';
  let target = text(obj.target, 40).toLowerCase();
  if (action === 'move') {
    if (!PLACES[target]) target = koala.place;
  } else if (action === 'eat' || action === 'climb') {
    if (!PLACES[target]?.tree) target = PLACES[koala.place]?.tree ? koala.place : TREES[0];
  } else if (action === 'play') {
    if (!TOYS[target]) target = 'ball';
  } else if (action === 'give') {
    if (!koala.inventory.includes(target)) {
      action = 'sit';
      target = '';
    }
  } else {
    target = '';
  }
  const bond = Number.isFinite(Number(obj.bond)) ? clamp(Math.round(Number(obj.bond)), -3, 3) : 0;
  return {
    thought: text(obj.thought, 200),
    action,
    target,
    say: text(obj.say, 160),
    mood: MOODS.includes(obj.mood) ? obj.mood : 'content',
    remember: text(obj.remember, 140),
    bond,
    opinion: text(obj.opinion, 120),
  };
}

function describe(d, friendName) {
  switch (d.action) {
    case 'move': return `went to the ${PLACES[d.target].name}`;
    case 'eat': return `ate eucalyptus at the ${PLACES[d.target].name}`;
    case 'climb': return `climbed the ${PLACES[d.target].name}`;
    case 'play': return d.target === 'pond' ? 'splashed in the pond' : `played with the ${d.target}`;
    case 'nap': return 'curled up for a nap';
    case 'approach': return `went over to ${friendName}`;
    case 'give': return `gave ${friendName} a ${d.target}`;
    default: return 'sat and looked around';
  }
}

// Carries out a parsed decision; returns the log entries it produced.
export function applyDecision(world, id, d) {
  const k = world.koalas[id];
  const f = world.koalas[other(id).id];
  switch (d.action) {
    case 'move': case 'eat': case 'climb': k.place = d.target; break;
    case 'play': k.place = TOYS[d.target]; break;
    case 'approach': k.place = f.place; break;
    case 'give':
      k.inventory.splice(k.inventory.indexOf(d.target), 1);
      if (f.inventory.length < MAX_ITEMS) f.inventory.push(d.target);
      push(f.recent, `${k.name} gave you a ${d.target}.`, MAX_RECENT);
      break;
    default: break;
  }
  if (d.action === 'eat') k.hunger = clamp(k.hunger - 45, 0, 100);
  if (d.action === 'nap') k.energy = clamp(k.energy + 40, 0, 100);
  if (d.action === 'play') {
    k.energy = clamp(k.energy - 8, 0, 100);
    k.hunger = clamp(k.hunger + 4, 0, 100);
  }
  k.activity = d.action;
  k.mood = d.mood;
  k.thought = d.thought;
  k.say = d.say;
  k.bond = clamp(k.bond + d.bond * 4, -100, 100);
  if (d.opinion) k.opinion = d.opinion;
  if (d.remember) push(k.memories, d.remember, MAX_MEMORIES);

  const did = describe(d, f.name);
  push(k.recent, `You ${did}.`, MAX_RECENT);
  if (f.place === k.place && d.action !== 'give' && d.action !== 'approach') push(f.recent, `${k.name} ${did} near you.`, MAX_RECENT);
  if (d.action === 'approach') push(f.recent, `${k.name} came over to you.`, MAX_RECENT);
  const log = [{ koala: id, kind: 'act', text: `${k.name} ${did}`, action: d.action, target: d.target }];
  if (d.say) {
    push(k.recent, `You said: "${d.say}"`, MAX_RECENT);
    push(f.recent, `${k.name} said: "${d.say}"`, MAX_RECENT);
    log.push({ koala: id, kind: 'say', text: d.say });
  }
  return log;
}

// Needs change with time: hunger rises, energy falls, napping recovers it.
export function drift(k, minutes) {
  k.hunger = clamp(k.hunger + 1.2 * minutes, 0, 100);
  k.energy = clamp(k.energy + (k.activity === 'nap' ? 2 : -0.8) * minutes, 0, 100);
}

export const DAY_MS = 20 * 60000;

// One grove day lasts 20 real minutes; the first one starts at 08:00.
export function groveClock(ms) {
  const total = Math.floor((ms / DAY_MS) * 1440 + 1e-6) + 8 * 60;
  const day = Math.floor(total / 1440) + 1;
  const hour = Math.floor((total % 1440) / 60);
  const minute = total % 60;
  const phase = hour >= 20 || hour < 5 ? 'night' : hour < 7 ? 'dawn' : hour < 18 ? 'day' : 'dusk';
  const pad = (n) => String(n).padStart(2, '0');
  return { day, hour, minute, phase, frac: (total % 1440) / 1440, label: `Day ${day} · ${pad(hour)}:${pad(minute)}` };
}

const level = (v, words) => words[Math.min(words.length - 1, Math.floor(v / (100 / words.length)))];

export function systemPrompt(id) {
  const k = byId(id);
  const f = other(id);
  return [
    `You are ${k.name}, a koala living in a small eucalyptus grove with one other koala, ${f.name}.`,
    k.persona,
    'Stay in character. You are a koala: you think and talk like one, simply and warmly, in short sentences.',
    'A human visitor sometimes walks around the grove, gives you things or talks to you.',
    'Each turn you choose one thing to do next. Reply with only a JSON object matching the given schema:',
    'thought (private), action, target, say (out loud, or empty), mood, remember (or empty), bond (-3..3), opinion (or empty).',
    'Leave remember empty unless something new and important happened that is not already in what you remember.',
  ].join('\n');
}

export function buildPrompt(world, id, clock) {
  const k = world.koalas[id];
  const f = world.koalas[other(id).id];
  const place = (p) => `${PLACES[p].name} (${p})`;
  const lines = [
    `It is ${clock.label}, ${clock.phase}.`,
    `You are at the ${place(k.place)}, ${k.activity === 'nap' ? 'napping' : `last action: ${k.activity}`}.`,
    `Hunger: ${level(k.hunger, ['full', 'peckish', 'hungry', 'starving'])}. Energy: ${level(k.energy, ['exhausted', 'tired', 'awake', 'full of beans'])}.`,
    `You hold: ${k.inventory.length ? k.inventory.join(', ') : 'nothing'}.`,
    `${f.name} is at the ${place(f.place)}, ${f.activity === 'nap' ? 'napping' : `doing: ${f.activity}`}, looking ${f.mood}.`,
    `How you feel about ${f.name}: ${k.bond} (from -100 to 100). ${k.opinion ? `You think: "${k.opinion}"` : 'You have no firm opinion yet.'}`,
    '',
    'Things you remember:',
    ...(k.memories.length ? k.memories.map((m) => `- ${m}`) : ['- nothing yet']),
    '',
    'What happened just now (oldest first):',
    ...(k.recent.length ? k.recent.map((r) => `- ${r}`) : ['- nothing yet']),
    '',
    `Places: ${Object.keys(PLACES).map(place).join(', ')}. Eucalyptus grows on: ${TREES.join(', ')}.`,
    'Actions: move (target: place), eat (target: a tree), climb (target: a tree), nap, play (target: ball, swing or pond),',
    `approach (go to ${f.name}), give (target: an item you hold, to ${f.name}), sit.`,
    'Choose what you do next.',
  ];
  return lines.join('\n');
}
