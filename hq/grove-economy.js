// The grove's economy: resources, where they come from, the islands that hold them, the
// shared stockpile, and what each build costs. Pure, like grove-world.js, which uses it.

export const RESOURCES = ['wood', 'water', 'sand', 'stone', 'book'];

// Floating islands off the main island, each reached by a bridge the koalas build.
export const ISLANDS = [
  { id: 'spring_isle', name: 'Spring Isle', resource: 'water', x: -30, z: -22, r: 6 },
  { id: 'sandy_shoal', name: 'Sandy Shoal', resource: 'sand', x: 38, z: -6, r: 6.5 },
  { id: 'stone_crag', name: 'Stone Crag', resource: 'stone', x: 24, z: -30, r: 5.5 },
  { id: 'library_isle', name: 'Library Isle', resource: 'book', x: -8, z: 38, r: 6 },
];

// Islands reachable from day one: their bridge already stands and is never built.
export const OPEN_ISLANDS = ['library_isle'];

// What can be gathered where. Sources never run out.
export const SOURCES = {
  big_gum: ['wood'],
  river_gum: ['wood'],
  blue_gum: ['wood'],
  fern_islet: ['wood'],
  pond: ['water'],
  spring_isle: ['water'],
  sandy_shoal: ['sand'],
  sunset_point: ['sand'],
  stone_crag: ['stone'],
  lookout: ['stone'],
  library_isle: ['book'],
};

export const COSTS = {
  bench: { wood: 2 },
  lantern: { wood: 1, stone: 1 },
  flowerbed: { wood: 2, water: 1 },
  birdhouse: { wood: 2 },
  stones: { stone: 3 },
  hut: { wood: 4, sand: 2 },
  treehouse: { wood: 5, stone: 1 },
  tower: { wood: 3, stone: 3 },
  well: { stone: 2, sand: 2, water: 1 },
  reading_nook: { wood: 2, book: 2 },
  bridge: { wood: 4, stone: 2 },
};

// A fresh grove's stockpile, so the first build can happen soon.
export const START_STOCK = { wood: 4 };

export const BRIDGE_IN = 2.5; // a bridge starts this far in from the island's edge
const ISLAND_R = 24;

export const costOf = (kind) => (kind.startsWith('bridge_') ? COSTS.bridge : COSTS[kind] ?? {});
export const islandById = (id) => ISLANDS.find((i) => i.id === id) ?? null;
export const stockOf = (world) => (world.stock ??= { ...START_STOCK });

// Things in a koala's paws: items and resources together.
export function held(k) {
  return (k.inventory?.length ?? 0) + Object.values(k.res ?? {}).reduce((s, n) => s + n, 0);
}

export function canAfford(stock, cost) {
  const missing = {};
  for (const [r, n] of Object.entries(cost)) if ((stock[r] ?? 0) < n) missing[r] = n - (stock[r] ?? 0);
  return { ok: Object.keys(missing).length === 0, missing };
}

export function spend(stock, cost) {
  for (const [r, n] of Object.entries(cost)) {
    stock[r] = (stock[r] ?? 0) - n;
    if (stock[r] <= 0) delete stock[r];
  }
}

export function add(stock, res) {
  for (const [r, n] of Object.entries(res)) if (n > 0) stock[r] = (stock[r] ?? 0) + n;
}

// "3 wood and 2 sand", in resource order.
export function amounts(res) {
  const parts = RESOURCES.filter((r) => res[r] > 0).map((r) => `${res[r]} ${r}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? 'nothing';
}

// Islands whose bridge is finished.
export function bridged(world) {
  const built = (world.builds ?? []).filter((b) => b.done && b.kind.startsWith('bridge_')).map((b) => b.kind.slice(7));
  return new Set([...OPEN_ISLANDS, ...built]);
}

// Where the koalas stand to build a bridge: its island end.
export function bridgeFoot(island) {
  const d = Math.hypot(island.x, island.z);
  return { x: (island.x / d) * (ISLAND_R - BRIDGE_IN), z: (island.z / d) * (ISLAND_R - BRIDGE_IN) };
}
