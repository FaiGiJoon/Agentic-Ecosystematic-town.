// What the koalas build, and the land that rises once they have built enough. The server
// decides what exists; this draws it: sites going up behind scaffolding, finished builds,
// new islets rising from the water, and the rope bridges that reach them.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildIslet } from './terrain.js';
import { bridgeEnds, RESOURCE_COLORS } from '../view.js';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
const WOOD = mat('#8a6a4a');
const PALE = mat('#c9a77c');
const DARK = mat('#4a3626');
const LEAF = mat('#6f9a62');
const STONE = mat('#a9a196', { roughness: 0.95 });
const ROPE = mat('#d8c8a4');
const GLASS = new THREE.MeshStandardMaterial({ color: '#ffe3a3', emissive: '#f2a541', emissiveIntensity: 0.3 });
const FLOWERS = ['#f08aa0', '#f6e7c8', '#f2c14e', '#c9b6f2', '#e8584f'].map((c) => mat(c));
const RISE_S = 4;

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
}
function cyl(r0, r1, h, m, x = 0, y = 0, z = 0, seg = 8) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
  o.position.set(x, y, z);
  return o;
}
// A log lying along x.
function log(len, r, m, x, y, z) {
  const o = cyl(r, r, len, m, x, y, z, 9);
  o.rotation.z = Math.PI / 2;
  return o;
}

// One small model per kind of build, standing on its own ground at the origin.
const MODELS = {
  bench(g) {
    g.add(cyl(0.22, 0.25, 0.45, WOOD, -0.7, 0.22, 0), cyl(0.22, 0.25, 0.45, WOOD, 0.7, 0.22, 0));
    g.add(log(1.9, 0.2, PALE, 0, 0.55, 0), log(1.8, 0.14, WOOD, 0, 0.95, -0.28));
  },
  lantern(g, layer) {
    g.add(cyl(0.08, 0.1, 2.2, WOOD, 0, 1.1, 0), box(0.7, 0.08, 0.08, WOOD, 0.3, 2.1, 0));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), GLASS.clone());
    glass.position.set(0.55, 1.78, 0);
    const light = new THREE.PointLight('#ffcf80', 0, 7, 1.8);
    glass.add(light);
    g.add(glass);
    layer.glows.push({ glass, light });
  },
  flowerbed(g) {
    for (const [w, d, x, z] of [[2.2, 0.14, 0, 0.7], [2.2, 0.14, 0, -0.7], [0.14, 1.5, 1.05, 0], [0.14, 1.5, -1.05, 0]]) g.add(box(w, 0.3, d, WOOD, x, 0.15, z));
    g.add(box(2, 0.2, 1.3, DARK, 0, 0.12, 0));
    for (let i = 0; i < 18; i++) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), FLOWERS[i % FLOWERS.length]);
      f.position.set(-0.85 + (i % 6) * 0.34, 0.38 + (i % 3) * 0.05, -0.45 + Math.floor(i / 6) * 0.45);
      g.add(f);
    }
  },
  birdhouse(g) {
    g.add(cyl(0.07, 0.09, 1.7, WOOD, 0, 0.85, 0), box(0.55, 0.55, 0.5, PALE, 0, 1.95, 0));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.4, 4), mat('#b05a3c'));
    roof.position.y = 2.42;
    roof.rotation.y = Math.PI / 4;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), DARK);
    hole.position.set(0, 2.0, 0.26);
    g.add(roof, hole, box(0.04, 0.04, 0.2, WOOD, 0, 1.86, 0.33));
  },
  stones(g) {
    for (let i = 0; i < 6; i++) {
      const a = -0.9 + i * 0.36;
      const s = cyl(0.36 - (i % 2) * 0.05, 0.4, 0.14, STONE, Math.sin(a) * 1.6, 0.07, Math.cos(a) * 1.6 - 1.2, 9);
      s.rotation.y = i;
      g.add(s);
    }
  },
  hut(g) {
    g.add(cyl(1.25, 1.35, 1.1, PALE, 0, 0.55, 0, 10));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.8, 10), LEAF);
    roof.position.y = 1.95;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.85), DARK);
    door.position.set(0, 0.43, 1.33);
    g.add(roof, door);
  },
  treehouse(g) {
    for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) g.add(cyl(0.12, 0.15, 2.4, WOOD, x, 1.2, z));
    g.add(box(2.4, 0.18, 2.4, PALE, 0, 2.45, 0), box(1.5, 1.1, 1.4, WOOD, 0, 3.1, -0.2));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.9, 4), LEAF);
    roof.position.set(0, 4.1, -0.2);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    // the ladder
    for (const x of [-0.25, 0.25]) {
      const rail = cyl(0.04, 0.04, 2.7, WOOD, x, 1.25, 1.55);
      rail.rotation.x = -0.25;
      g.add(rail);
    }
    for (let i = 0; i < 6; i++) g.add(box(0.5, 0.05, 0.05, PALE, 0, 0.3 + i * 0.4, 1.86 - i * 0.1));
  },
  tower(g) {
    for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      const leg = cyl(0.09, 0.12, 4.4, WOOD, x * 0.82, 2.2, z * 0.82);
      leg.rotation.set(z * 0.07, 0, -x * 0.07);
      g.add(leg);
    }
    g.add(box(1.7, 0.14, 1.7, PALE, 0, 4.4, 0));
    for (const [w, d, x, z] of [[1.7, 0.06, 0, 0.82], [1.7, 0.06, 0, -0.82], [0.06, 1.7, 0.82, 0], [0.06, 1.7, -0.82, 0]]) g.add(box(w, 0.5, d, WOOD, x, 4.7, z));
    g.add(cyl(0.03, 0.03, 1.4, WOOD, 0.75, 5.4, 0.75));
    g.add(box(0.5, 0.3, 0.02, mat('#f2c14e'), 1.0, 5.9, 0.75));
  },
  well(g) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.7, 14, 1, true), mat('#a9a196', { roughness: 0.95, side: THREE.DoubleSide }));
    ring.position.y = 0.35;
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.7, 14), mat('#4e8fa3', { roughness: 0.2 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.45;
    g.add(ring, water, cyl(0.06, 0.06, 1.6, WOOD, -0.7, 0.8, 0), cyl(0.06, 0.06, 1.6, WOOD, 0.7, 0.8, 0), log(1.6, 0.06, WOOD, 0, 1.55, 0));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.6, 4), mat('#b05a3c'));
    roof.position.y = 1.9;
    roof.rotation.y = Math.PI / 4;
    g.add(roof, cyl(0.12, 0.1, 0.2, WOOD, 0, 1.1, 0));
  },
  reading_nook(g) {
    g.add(log(1.6, 0.16, PALE, 0, 0.42, 0.5), cyl(0.18, 0.2, 0.4, WOOD, -0.6, 0.2, 0.5), cyl(0.18, 0.2, 0.4, WOOD, 0.6, 0.2, 0.5));
    g.add(box(1.4, 1.3, 0.35, WOOD, 0, 0.65, -0.5));
    const books = ['#b05a3c', '#4e8fa3', '#f2c14e', '#6f9a62', '#c9b6f2'];
    for (let i = 0; i < 10; i++) g.add(box(0.1, 0.3, 0.22, mat(books[i % books.length]), -0.55 + (i % 5) * 0.27, 0.45 + Math.floor(i / 5) * 0.45, -0.32));
    const shade = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.6, 9), LEAF);
    shade.position.set(0, 2.1, 0);
    g.add(shade, cyl(0.05, 0.05, 1.9, WOOD, 0, 1.0, 0.05));
  },
};

// Dressing for each resource island, so you can tell from the shore what it holds.
const DRESS = {
  water(g, r) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(r * 0.35, 20), mat('#4e8fa3', { roughness: 0.15, metalness: 0.1 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = r * 0.07 + 0.02;
    g.add(pool);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), STONE).translateX(Math.cos(a) * r * 0.37).translateZ(Math.sin(a) * r * 0.37).translateY(r * 0.07));
    }
    // a thin waterfall spilling over the edge
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(0.9, r * 1.6), mat('#9fd4ea', { transparent: true, opacity: 0.7, emissive: '#4e8fa3', emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    fall.position.set(r * 0.98, -r * 0.7, 0);
    fall.rotation.y = Math.PI / 2;
    g.add(fall);
  },
  sand(g, r) {
    const beach = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 28), mat('#e6d29a', { roughness: 1 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = r * 0.05;
    g.add(beach);
    for (let i = 0; i < 7; i++) {
      const shell = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 6), mat(i % 2 ? '#f6e7c8' : '#f08aa0'));
      shell.position.set(Math.cos(i * 2.1) * r * 0.5, r * 0.06, Math.sin(i * 2.1) * r * 0.5);
      shell.rotation.z = Math.PI / 2;
      g.add(shell);
    }
  },
  stone(g, r) {
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + (i % 3) * 0.25, 0), STONE);
      s.position.set(Math.cos(i * 1.7) * r * 0.45, r * 0.06 + 0.2, Math.sin(i * 1.7) * r * 0.45);
      s.rotation.set(i, i * 2, 0);
      g.add(s);
    }
  },
  book(g, r) {
    const hut = new THREE.Group();
    hut.add(box(2.2, 1.6, 1.8, PALE, 0, 0.8, 0));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.0, 4), mat('#b05a3c'));
    roof.position.y = 2.1;
    roof.rotation.y = Math.PI / 4;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), DARK);
    door.position.set(0, 0.45, 0.91);
    hut.add(roof, door);
    for (let i = 0; i < 6; i++) hut.add(box(0.36, 0.08, 0.26, mat(['#4e8fa3', '#f2c14e', '#6f9a62'][i % 3]), 1.5, 0.04 + i * 0.08, 0.6));
    hut.position.y = r * 0.06;
    g.add(hut);
  },
};

// Scaffolding around a build that is still going up, with a stack of logs beside it.
function scaffold(height) {
  const g = new THREE.Group();
  const h = Math.max(1.6, height + 0.4);
  for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) g.add(cyl(0.05, 0.05, h, PALE, x, h / 2, z, 5));
  for (const y of [h * 0.5, h - 0.05]) {
    g.add(box(2.4, 0.06, 0.06, PALE, 0, y, 1.2), box(2.4, 0.06, 0.06, PALE, 0, y, -1.2));
    g.add(box(0.06, 0.06, 2.4, PALE, 1.2, y, 0), box(0.06, 0.06, 2.4, PALE, -1.2, y, 0));
  }
  for (let i = 0; i < 4; i++) g.add(log(1.1, 0.09, WOOD, 1.9, 0.09 + Math.floor(i / 2) * 0.16, -0.5 + (i % 2) * 0.2));
  return g;
}

const HEIGHT = { bench: 1, lantern: 2.2, flowerbed: 0.5, birdhouse: 2.6, stones: 0.2, hut: 2.9, treehouse: 4.5, tower: 6, well: 2.2, reading_nook: 2.4 };

export class BuildLayer {
  constructor({ scene, tex, baseY, island }) {
    this.scene = scene;
    this.baseY = baseY;
    this.island = island;
    this.sites = new Map(); // build id -> view
    this.lands = new Map(); // land id -> view
    this.glows = [];
    this.seen = false; // what already stood when the page opened appears without a show
    this.rock = new THREE.MeshStandardMaterial({ map: tex.rock.map, normalMap: tex.rock.normal, vertexColors: true, roughness: 0.96 });
    this.grass = new THREE.MeshStandardMaterial({ color: '#7fa05a', map: tex.grass.map, normalMap: tex.grass.normal, roughness: 0.95 });
  }

  // Ground height on new land and its bridges, or null when (x, z) is on neither.
  heightAt(x, z) {
    for (const v of this.lands.values()) {
      const l = v.land;
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < l.r * 0.97) return v.group.position.y + (1 - (d / l.r) ** 2) * l.r * 0.07 - 0.05;
      if (!v.open) continue; // no bridge yet: the island cannot be reached
      const { a, b } = v.bridge;
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const t = ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz);
      if (t < 0 || t > 1) continue;
      if (Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)) < 0.9) return Math.max(this.baseY(x, z), v.deckY(t));
    }
    return null;
  }

  sync(state) {
    const plots = new Map(state.plots.map((p) => [p.id, p]));
    for (const l of state.lands) if (l.risen && !this.lands.has(l.id)) this.#raise(l);
    // resource islands float there from the start; their bridge appears once it is built
    for (const i of state.islands ?? []) {
      const v = this.lands.get(i.id) ?? this.#raise(i, { open: i.bridged });
      if (i.bridged && !v.open) {
        v.open = true;
        v.bridgeMesh.visible = true;
      }
    }
    if (state.places?.stockpile) this.#stockpile(state.places.stockpile, state.stock ?? {});
    for (const b of state.builds) {
      const view = this.sites.get(b.id) ?? this.#site(b, plots.get(b.plot));
      if (view && (view.done !== b.done || view.progress !== b.progress)) this.#shape(view, b);
    }
    this.seen = true;
  }

  #site(b, plot) {
    if (!plot) return null;
    const group = new THREE.Group();
    group.position.set(plot.x, this.heightAt(plot.x, plot.z) ?? this.baseY(plot.x, plot.z), plot.z);
    // face the clearing, so doors and ladders look into the grove
    group.rotation.y = Math.atan2(-plot.x, 2 - plot.z);
    const model = new THREE.Group();
    (MODELS[b.kind] ?? MODELS.bench)(model, this);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(model);
    const el = document.createElement('div');
    el.className = 'build-label';
    el.innerHTML = '<b></b><span class="prog"><i></i></span><small></small>';
    el.querySelector('b').textContent = b.title;
    const label = new CSS2DObject(el);
    label.position.y = (HEIGHT[b.kind] ?? 2) + 0.7;
    group.add(label);
    this.scene.add(group);
    const view = { group, model, el, label, kind: b.kind, done: null, progress: null, grow: 0, want: 0 };
    this.sites.set(b.id, view);
    return view;
  }

  #shape(view, b) {
    const firstLook = view.done === null;
    view.done = b.done;
    view.progress = b.progress;
    view.want = b.done ? 1 : 0.15 + 0.85 * (b.progress / b.effort) * 0.9;
    if (firstLook) view.grow = view.want;
    if (!b.done && !view.scaffold) {
      view.scaffold = scaffold(HEIGHT[b.kind] ?? 2);
      view.group.add(view.scaffold);
    }
    if (b.done && view.scaffold) {
      view.group.remove(view.scaffold);
      view.scaffold = null;
    }
    view.el.classList.toggle('done', b.done);
    view.el.querySelector('i').style.width = `${Math.round((b.progress / b.effort) * 100)}%`;
    view.el.querySelector('small').textContent = b.done ? '' : `${b.progress} of ${b.effort}`;
  }

  #raise(l, { open = true } = {}) {
    const { group, spots } = buildIslet({ radius: l.r, seed: l.id.length * 7 + 3, rockMat: this.rock, grassMat: this.grass });
    group.position.set(l.x, -RISE_S * 1.5, l.z);
    if (l.resource) DRESS[l.resource]?.(group, l.r);
    for (const s of spots.slice(0, l.resource ? 1 : 3)) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + (s.x % 0.3), 0), LEAF);
      bush.position.set(s.x, s.y + 0.3, s.z);
      bush.scale.y = 0.7;
      group.add(bush);
    }
    this.scene.add(group);

    // A rope bridge from the island to the new land.
    const { island: a, land: b } = bridgeEnds(l, this.island);
    const h0 = this.baseY(a.x, a.z);
    const h1 = (1 - ((l.r - 1.2) / l.r) ** 2) * l.r * 0.07 - 0.05;
    const deckY = (t) => h0 + (h1 - h0) * t - Math.sin(Math.PI * t) * 0.25 + 0.06;
    const bridge = new THREE.Group();
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const n = Math.ceil(len / 0.45);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const plank = box(1.5, 0.07, 0.34, i % 2 ? PALE : WOOD, a.x + (b.x - a.x) * t, deckY(t) - 0.04, a.z + (b.z - a.z) * t);
      plank.rotation.y = yaw;
      plank.receiveShadow = true;
      bridge.add(plank);
    }
    for (const side of [-1, 1]) {
      const ox = Math.cos(yaw) * 0.75 * side;
      const oz = -Math.sin(yaw) * 0.75 * side;
      for (const [p, t] of [[a, 0], [b, 1]]) bridge.add(cyl(0.07, 0.09, 1.3, WOOD, p.x + ox, deckY(t) + 0.55, p.z + oz));
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + ox, deckY(t) + 0.9 - Math.sin(Math.PI * t) * 0.15, a.z + (b.z - a.z) * t + oz));
      }
      bridge.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.03, 4), ROPE));
    }
    bridge.visible = false;
    this.scene.add(bridge);

    const el = document.createElement('div');
    el.className = 'place-label';
    el.textContent = l.resource ? `${l.name} · ${l.resource === 'book' ? 'books' : l.resource}` : l.name;
    const label = new CSS2DObject(el);
    label.position.set(0, l.resource === 'book' ? 3.6 : 2.2, 0);
    group.add(label);
    // islands are always there; only land raised by building rises while you watch
    const age = this.seen && !l.resource ? 0 : RISE_S;
    if (age === RISE_S) {
      group.position.y = 0;
      bridge.visible = open;
    }
    const view = { land: l, group, bridgeMesh: bridge, bridge: { a, b }, deckY, age, open };
    this.lands.set(l.id, view);
    return view;
  }

  // The stockpile: a little crate yard with a stack of blocks per resource, as many as are stored (up to 12 shown).
  #stockpile(p, stock) {
    const key = JSON.stringify(stock);
    if (key === this.stockKey) return;
    this.stockKey = key;
    if (!this.pile) {
      this.pile = new THREE.Group();
      this.pile.position.set(p.x, this.baseY(p.x, p.z), p.z);
      for (const [x, z] of [[-1.3, -1.0], [1.3, -1.0], [-1.3, 1.0], [1.3, 1.0]]) this.pile.add(cyl(0.06, 0.07, 0.6, WOOD, x, 0.3, z, 5));
      this.pile.add(box(2.8, 0.06, 0.06, PALE, 0, 0.55, -1.0), box(2.8, 0.06, 0.06, PALE, 0, 0.55, 1.0));
      this.blocks = new THREE.Group();
      this.pile.add(this.blocks);
      this.scene.add(this.pile);
    }
    this.blocks.clear();
    ['wood', 'water', 'sand', 'stone', 'book'].forEach((r, col) => {
      const n = Math.min(12, stock[r] ?? 0);
      const m = mat(RESOURCE_COLORS[r]);
      for (let i = 0; i < n; i++) {
        const b = r === 'water' ? cyl(0.13, 0.13, 0.26, m, 0, 0, 0, 8) : box(r === 'book' ? 0.3 : 0.26, r === 'book' ? 0.12 : 0.26, 0.26, m);
        b.position.set(-1.0 + col * 0.5, 0.13 + Math.floor(i / 4) * (r === 'book' ? 0.13 : 0.27), -0.45 + (i % 4) * 0.3);
        b.castShadow = true;
        this.blocks.add(b);
      }
    });
  }

  // Builds grow toward their progress; new land rises out of the water, then its bridge appears.
  update(dt, t, night) {
    for (const v of this.sites.values()) {
      v.grow += (v.want - v.grow) * Math.min(1, dt * 2.5);
      v.model.scale.set(1, Math.max(0.02, v.grow), 1);
    }
    for (const v of this.lands.values()) {
      if (v.age >= RISE_S) continue;
      v.age = Math.min(RISE_S, v.age + dt);
      const k = v.age / RISE_S;
      v.group.position.y = -RISE_S * 1.5 * (1 - k) ** 3;
      v.bridgeMesh.visible = v.open && k > 0.8;
    }
    for (const g of this.glows) {
      g.light.intensity = night * 5;
      g.glass.material.emissiveIntensity = 0.3 + night * 2.4 + Math.sin(t * 3 + g.glass.position.x) * 0.1 * night;
    }
  }
}
