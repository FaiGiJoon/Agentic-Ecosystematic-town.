// Construction: voxel blueprints, building plots and the town layout.

// District centres in world units (1 unit = 1 voxel).
export const DISTRICTS = {
  hub: { x: 0, z: 0, r: 8, label: 'Agent Hub' },
  exchange: { x: 20, z: -12, r: 9, label: 'Town Exchange' },
  plaza: { x: 3, z: 17, r: 7, label: 'Chatter Plaza' },
  depot: { x: -24, z: -14, r: 6, label: 'Block Depot' },
  board: { x: -9, z: -5, r: 4, label: 'Ticket Board' },
  yard: { x: -21, z: 9, r: 1, label: 'Builders Yard' },
  library: { x: -12, z: 21, r: 5, label: 'Vault Library' },
};

const box = (voxels, x0, y0, z0, w, h, d, color, hollow = false) => {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      for (let z = z0; z < z0 + d; z++) {
        const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
        if (!hollow || edge) voxels.push({ x, y, z, color });
      }
};

function house(rng) {
  const v = [];
  const wall = rng.pick(['#efe0bd', '#d9e4ec', '#f2d0c2', '#dcefd2']);
  const roof = rng.pick(['#c4553b', '#4a6fa5', '#5b8a4a', '#8a5a9e']);
  box(v, 0, 0, 0, 5, 3, 5, wall, true);
  for (const p of v) {
    if (p.y === 1 && (p.x === 2 || p.z === 2) && !(p.z === 0 && p.x === 2)) p.color = '#9fd3f0';
    if (p.z === 0 && p.x === 2 && p.y < 2) p.color = '#7a5236';
  }
  for (let i = 0; i < 3; i++) box(v, i, 3 + i, i, 5 - 2 * i, 1, 5 - 2 * i, roof);
  return { kind: 'house', name: 'House', voxels: v };
}

function tower(rng) {
  const v = [];
  const glow = rng.pick(['#7fd1e8', '#f2c14e', '#c48af0']);
  box(v, 0, 0, 0, 4, 9, 4, '#b8c0cc', true);
  for (const p of v) if (p.y % 2 === 1 && (p.x === 1 || p.x === 2 || p.z === 1 || p.z === 2)) p.color = '#86b8de';
  box(v, 0, 9, 0, 4, 1, 4, '#5c6470');
  box(v, 1, 10, 1, 2, 2, 2, glow);
  return { kind: 'tower', name: 'Tower', voxels: v };
}

function shop(rng) {
  const v = [];
  const awning = rng.pick(['#e8774a', '#4ab07a', '#d24c6a', '#4a8fd2']);
  box(v, 0, 0, 0, 6, 3, 5, '#e6dccb', true);
  for (const p of v) if (p.z === 0 && p.y === 1 && p.x > 0 && p.x < 5) p.color = '#a9dcf3';
  box(v, 0, 3, 0, 6, 1, 5, '#6b5b4b');
  for (let x = 0; x < 6; x++) v.push({ x, y: 2, z: -1, color: x % 2 ? '#ffffff' : awning });
  return { kind: 'shop', name: 'Shop', voxels: v };
}

function hall(rng) {
  const v = [];
  const roof = rng.pick(['#7a4a3a', '#3f5f7a']);
  box(v, 0, 0, 0, 6, 1, 6, '#cfc6b4');
  for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5], [2, 0], [3, 0]]) box(v, x, 1, z, 1, 3, 1, '#f4efe4');
  box(v, 1, 1, 2, 4, 3, 4, '#e3d5bd', true);
  for (let i = 0; i < 3; i++) box(v, 0, 4 + i, i, 6, 1, 6 - 2 * i, roof);
  return { kind: 'hall', name: 'Hall', voxels: v };
}

function windmill(rng) {
  const v = [];
  box(v, 1, 0, 1, 3, 6, 3, '#d8c8a8', true);
  box(v, 1, 6, 1, 3, 1, 3, '#8a5236');
  const sail = rng.pick(['#f4efe4', '#f2c14e']);
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    v.push({ x: 2 + i, y: 5, z: 0, color: sail });
    v.push({ x: 2, y: 5 + i, z: 0, color: sail });
  }
  v.push({ x: 2, y: 5, z: 0, color: '#5c4430' });
  return { kind: 'windmill', name: 'Windmill', voxels: v };
}

export const BLUEPRINTS = { house, tower, shop, hall, windmill };

// Build bottom-up, then around the ring, so structures grow believably.
function order(voxels) {
  const cx = voxels.reduce((s, p) => s + p.x, 0) / voxels.length;
  const cz = voxels.reduce((s, p) => s + p.z, 0) / voxels.length;
  return voxels
    .map((p) => ({ ...p, x: Math.round(p.x), z: Math.round(p.z) }))
    .sort((a, b) => a.y - b.y || Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
}

function computeSlots() {
  const slots = [];
  for (let x = -40; x <= 40; x += 9)
    for (let z = -40; z <= 40; z += 9) {
      const clear = Object.entries(DISTRICTS).every(([k, d]) => k === 'yard' || Math.hypot(x - d.x, z - d.z) > d.r + 7);
      if (clear) slots.push({ x, z });
    }
  const y = DISTRICTS.yard;
  return slots.sort((a, b) => Math.hypot(a.x - y.x, a.z - y.z) - Math.hypot(b.x - y.x, b.z - y.z));
}

export class Construction {
  constructor(rng, bus) {
    this.rng = rng;
    this.bus = bus;
    this.slots = computeSlots();
    this.plots = [];
    this.blocksPlaced = 0;
    this.completed = 0;
    this.recentCompletions = []; // timestamps, for the build-rate fundamental
    this.counts = {};
  }

  openPlot(now = 0) {
    const slot = this.slots[this.plots.length];
    if (!slot) return null;
    const kinds = Object.keys(BLUEPRINTS);
    const bp = BLUEPRINTS[this.rng.pick(kinds)](this.rng);
    this.counts[bp.kind] = (this.counts[bp.kind] ?? 0) + 1;
    const plot = {
      id: 'P' + (this.plots.length + 1),
      x: slot.x,
      z: slot.z,
      kind: bp.kind,
      name: `${bp.name} #${this.counts[bp.kind]}`,
      voxels: order(bp.voxels),
      placed: 0,
      status: 'open',
      builders: new Set(),
      opened: now,
    };
    this.plots.push(plot);
    this.bus.emit('plot:open', plot);
    return plot;
  }

  progress(plot) {
    return plot.placed / plot.voxels.length;
  }

  // Place the next voxel of a plot. Returns false when the plot is finished.
  place(plot, builder, now = 0) {
    if (plot.status === 'done') return false;
    plot.status = 'building';
    const voxel = plot.voxels[plot.placed];
    plot.placed += 1;
    this.blocksPlaced += 1;
    this.bus.emit('block', { plot, voxel, index: plot.placed - 1, builder });
    if (plot.placed >= plot.voxels.length) {
      plot.status = 'done';
      this.completed += 1;
      this.recentCompletions.push(now);
      this.bus.emit('plot:done', { plot, builder });
      return false;
    }
    return true;
  }

  buildRate(now, window = 120) {
    this.recentCompletions = this.recentCompletions.filter((t) => now - t < window);
    return this.recentCompletions.length;
  }
}
