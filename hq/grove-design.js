// Turns a koala's invention (a name and one sentence) into a deterministic build spec and cost.
// Pure: no I/O. The page draws the spec; the economy charges the cost.

export const SHAPES = ['house', 'tower', 'machine', 'bridge', 'garden', 'statue', 'shelter', 'playground', 'boat'];
export const PARTS = ['roof', 'door', 'window', 'flag', 'wheel', 'screen', 'buttons', 'lights', 'chimney', 'slide', 'flowers', 'sign', 'dome', 'stairs', 'bell', 'star'];
export const COLORS = ['pink', 'blue', 'red', 'green', 'yellow', 'purple', 'orange', 'white', 'gold', 'silver', 'brown', 'black'];
export const DEFAULT_COLORS = ['brown'];

// word -> shape, checked in this order
const SHAPE_WORDS = [
  ['machine', /\b(game|arcade|machine|robot)s?\b/i],
  ['tower', /\b(tower|lighthouse|castle)s?\b/i],
  ['house', /\b(house|hut|home|cottage)s?\b/i],
  ['bridge', /\b\w*bridges?\b/i],
  ['garden', /\b(garden|flowers?)s?\b/i],
  ['statue', /\b(statue|sculpture)s?\b/i],
  ['playground', /\b(swing|slide|playground)s?\b/i],
  ['boat', /\b(boat|ship)s?\b/i],
];
const PART_WORDS = [
  ['roof', /\broofs?\b/i], ['door', /\bdoors?\b/i], ['window', /\bwindows?\b/i], ['flag', /\bflags?\b/i],
  ['wheel', /\bwheels?\b/i], ['screen', /\bscreens?\b/i], ['buttons', /\bbuttons?\b/i],
  ['lights', /\b(lights?|lanterns?)\b/i], ['chimney', /\bchimneys?\b/i], ['slide', /\bslides?\b/i],
  ['flowers', /\bflowers?\b/i], ['sign', /\bsigns?\b/i], ['dome', /\bdomes?\b/i],
  ['stairs', /\b(stairs?|ladders?)\b/i], ['bell', /\bbells?\b/i], ['star', /\bstars?\b/i],
];
const SMALL = /\b(tiny|little|small)\b/i;
const BIG = /\b(big|huge|giant|tall)\b/i;

const SIZE_COST = {
  small: { cost: { wood: 2 }, effort: 2 },
  medium: { cost: { wood: 3, stone: 1 }, effort: 4 },
  big: { cost: { wood: 5, stone: 3 }, effort: 6 },
};

export function designSpec(name, design) {
  const text = `${name ?? ''} ${design ?? ''}`;
  const size = SMALL.test(text) ? 'small' : BIG.test(text) ? 'big' : 'medium';
  const shape = SHAPE_WORDS.find(([, re]) => re.test(text))?.[0] ?? 'shelter';
  const parts = PART_WORDS.filter(([, re]) => re.test(text)).map(([p]) => p).slice(0, 8);
  const colors = COLORS.map((c) => [c, text.search(new RegExp(`\\b${c}\\b`, 'i'))])
    .filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1]).map(([c]) => c).slice(0, 3);
  return { shape, size, parts, colors: colors.length ? colors : [...DEFAULT_COLORS], design: String(design ?? '').trim().slice(0, 160) };
}

export function designCost(spec) {
  const base = SIZE_COST[spec.size] ?? SIZE_COST.medium;
  const cost = { ...base.cost };
  const text = spec.design ?? '';
  if (/\b(stone|rock)s?\b/i.test(text) && cost.wood > 0) {
    cost.wood -= 1;
    cost.stone = (cost.stone ?? 0) + 1;
  }
  if (/\b(water|fountain|pool)s?\b/i.test(text)) cost.water = (cost.water ?? 0) + 1;
  if (/\b(sand|glass)\b/i.test(text)) cost.sand = (cost.sand ?? 0) + 1;
  if (/\b(books?|library|reading)\b/i.test(text)) cost.book = (cost.book ?? 0) + 1;
  for (const r of Object.keys(cost)) if (cost[r] <= 0) delete cost[r];
  return { cost, effort: base.effort };
}
