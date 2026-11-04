// Koala Grove: the rules of the grove. Two koalas, each a real model call away
// from its next move. Everything here is pure: the Grove (grove.js) owns time,
// storage and the model calls, and asks these functions what a decision means.

export const KOALAS = [
  {
    id: 'mallee',
    name: 'Mallee',
    gender: 'girl',
    outfit: 'a pink scarf',
    color: '#b9c2c9',
    home: 'clearing',
    persona: 'Mallee is a bold and endlessly curious baby koala, a girl (she/her) who wears a pink scarf. '
      + 'Mallee loves exploring every corner of the grove, collects shiny pebbles, splashes at the pond, '
      + 'talks a lot, gets bored quickly and sometimes teases. Mallee secretly wants Bramble to think she is brave.',
  },
  {
    id: 'bramble',
    name: 'Bramble',
    gender: 'boy',
    outfit: 'a small blue hat',
    color: '#8d8478',
    home: 'hollow',
    persona: 'Bramble is a gentle and sleepy baby koala, a boy (he/him) who wears a small blue hat. Bramble adores '
      + 'eucalyptus, long naps in the mossy hollow and quiet company. He speaks softly and a little poetically, '
      + 'is slow to trust, notices small things, and is protective of friends once they have earned it.',
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

// Growing up. Both koalas start as babies. Strength (0 to 100) rises with what they do and
// decides what they can: how big they are, how high they climb, how much they carry, how fast they tire.
export const STAGES = [
  { id: 'baby', label: 'Baby', at: 0 },
  { id: 'joey', label: 'Joey', at: 20 },
  { id: 'youngster', label: 'Youngster', at: 45 },
  { id: 'grown', label: 'Grown-up', at: 75 },
];
export const START_STRENGTH = 5;
const TRAIN = { climb: 2, play: 1.5, eat: 1, nap: 0.5, move: 0.2, approach: 0.1 }; // strength per action
const PRONOUNS = { girl: 'she/her', boy: 'he/him' };

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

export const stageOf = (strength) => [...STAGES].reverse().find((st) => strength >= st.at) ?? STAGES[0];
export const sizeOf = (strength) => 0.5 + 0.5 * (clamp(strength, 0, 100) / 100) ** 0.8; // half of full size, up to full
export const carryLimit = (strength) => 2 + (strength >= 35 ? 1 : 0) + (strength >= 70 ? 1 : 0);
export const reachOf = (strength) => 0.3 + 0.7 * Math.min(1, Math.max(0, strength) / 60); // share of a tree it can climb
const fatigue = (strength) => 1.5 - 0.7 * (clamp(strength, 0, 100) / 100); // babies tire faster

// What the page needs to draw and describe a koala's growth, worked out from its strength.
export function growthOf(k) {
  const st = stageOf(k.strength);
  const next = STAGES.find((x) => x.at > k.strength);
  return {
    gender: byId(k.id)?.gender ?? 'girl',
    outfit: byId(k.id)?.outfit ?? '',
    stage: st.id,
    stageLabel: st.label,
    nextStage: next ? { label: next.label, at: next.at } : null,
    size: Math.round(sizeOf(k.strength) * 1000) / 1000,
    carry: carryLimit(k.strength),
    reach: Math.round(reachOf(k.strength) * 100) / 100,
  };
}
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
    strength: START_STRENGTH,
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

function describe(d, friendName, strength) {
  switch (d.action) {
    case 'move': return `went to the ${PLACES[d.target].name}`;
    case 'eat': return `ate eucalyptus at the ${PLACES[d.target].name}`;
    case 'climb': {
      const tree = PLACES[d.target].name;
      return strength < 25 ? `scrambled a little way up the ${tree}` : strength < 60 ? `climbed part of the way up the ${tree}` : `climbed the ${tree}`;
    }
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
      if (f.inventory.length < carryLimit(f.strength)) f.inventory.push(d.target);
      push(f.recent, `${k.name} gave you a ${d.target}.`, MAX_RECENT);
      break;
    default: break;
  }
  if (d.action === 'eat') k.hunger = clamp(k.hunger - 45, 0, 100);
  if (d.action === 'nap') k.energy = clamp(k.energy + 40, 0, 100);
  if (d.action === 'play') {
    k.energy = clamp(k.energy - 8 * fatigue(k.strength), 0, 100);
    k.hunger = clamp(k.hunger + 4, 0, 100);
  }
  if (d.action === 'climb') k.energy = clamp(k.energy - 8 * fatigue(k.strength), 0, 100);
  // Training: what a koala does makes it stronger, a little less each time as it nears full strength.
  const stageBefore = stageOf(k.strength);
  k.strength = clamp(k.strength + (TRAIN[d.action] ?? 0) * (1 - k.strength / 150), 0, 100);
  k.activity = d.action;
  k.mood = d.mood;
  k.thought = d.thought;
  k.say = d.say;
  k.bond = clamp(k.bond + d.bond * 4, -100, 100);
  if (d.opinion) k.opinion = d.opinion;
  if (d.remember) push(k.memories, d.remember, MAX_MEMORIES);

  const did = describe(d, f.name, k.strength);
  push(k.recent, `You ${did}.`, MAX_RECENT);
  if (f.place === k.place && d.action !== 'give' && d.action !== 'approach') push(f.recent, `${k.name} ${did} near you.`, MAX_RECENT);
  if (d.action === 'approach') push(f.recent, `${k.name} came over to you.`, MAX_RECENT);
  const log = [{ koala: id, kind: 'act', text: `${k.name} ${did}`, action: d.action, target: d.target }];
  if (d.say) {
    push(k.recent, `You said: "${d.say}"`, MAX_RECENT);
    push(f.recent, `${k.name} said: "${d.say}"`, MAX_RECENT);
    log.push({ koala: id, kind: 'say', text: d.say });
  }
  const stageNow = stageOf(k.strength);
  if (stageNow.id !== stageBefore.id) {
    const word = stageNow.label.toLowerCase();
    push(k.recent, `You feel stronger. You are a ${word} now!`, MAX_RECENT);
    push(f.recent, `${k.name} has grown into a ${word}.`, MAX_RECENT);
    log.push({ koala: id, kind: 'grow', text: `${k.name} grew into a ${word}!` });
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
    `You are ${k.name}, a koala living in a small eucalyptus grove with one other koala, ${f.name}, a ${f.gender} (${PRONOUNS[f.gender]}).`,
    k.persona,
    'You are both babies. You grow stronger the more you climb, play, eat and rest, and when you are stronger you can climb higher and carry more.',
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
  const g = growthOf(k);
  const fg = growthOf(f);
  const lines = [
    `It is ${clock.label}, ${clock.phase}.`,
    `You are at the ${place(k.place)}, ${k.activity === 'nap' ? 'napping' : `last action: ${k.activity}`}.`,
    `Hunger: ${level(k.hunger, ['full', 'peckish', 'hungry', 'starving'])}. Energy: ${level(k.energy, ['exhausted', 'tired', 'awake', 'full of beans'])}.`,
    `You are a ${g.stageLabel.toLowerCase()}, strength ${Math.round(k.strength)} of 100${g.nextStage ? ` (a ${g.nextStage.label.toLowerCase()} at ${g.nextStage.at})` : ''}. `
      + `You can climb about ${Math.round(g.reach * 100)}% of the way up a tree and hold ${g.carry} things. ${f.name} is a ${fg.stageLabel.toLowerCase()}.`,
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
