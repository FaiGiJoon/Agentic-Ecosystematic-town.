// The island body: heightfield lawn, the baked splat map the ground shader reads, the
// layered cliff beneath it, hanging roots, and small floating islets in the distance.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, smoothstep, rng } from './noise.js';
import { ISLAND, WATER_Y, SHORE_R } from './terrain-math.js';
import { TILE } from './materials.js';

const TAU = Math.PI * 2;

// R = worn path, B = baked occlusion (dark under trees, rocks, logs), A = water depth in metres.
// blobs: [{ x, z, r, s }] soft round occluders; caps: [{ ax, az, bx, bz, r, s }] elongated ones.
export function buildSplat({ terrain, size, blobs, caps = [] }) {
  const data = new Uint8Array(size * size * 4);
  const span = ISLAND * 2;
  const pond = terrain.pond;
  for (let j = 0; j < size; j++) {
    const z = ((j + 0.5) / size - 0.5) * span;
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size - 0.5) * span;
      const o = (j * size + i) * 4;
      if (Math.hypot(x, z) > ISLAND + 0.6) continue;
      data[o] = terrain.pathMask(x, z) * 255;
      // water only exists near the pond, so the height is only needed there
      if (Math.hypot(x - pond.x, z - pond.z) < SHORE_R + 2) {
        const h = terrain.height(x, z);
        data[o + 3] = h < WATER_Y ? Math.min(1, (WATER_Y - h) / 1.0) * 255 : 0;
      }
    }
  }
  // Occluders are painted into their own small box of texels, not tested against every texel.
  const px = size / span;
  const paint = (x0, z0, x1, z1, fn) => {
    const i0 = Math.max(0, Math.floor((x0 + ISLAND) * px));
    const i1 = Math.min(size - 1, Math.ceil((x1 + ISLAND) * px));
    const j0 = Math.max(0, Math.floor((z0 + ISLAND) * px));
    const j1 = Math.min(size - 1, Math.ceil((z1 + ISLAND) * px));
    for (let j = j0; j <= j1; j++) {
      const z = ((j + 0.5) / size - 0.5) * span;
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) / size - 0.5) * span;
        const a = fn(x, z);
        if (a > 0) {
          const o = (j * size + i) * 4 + 2;
          const v = a * 255;
          if (v > data[o]) data[o] = v;
        }
      }
    }
  };
  const falloff = (d, r, s) => {
    if (d >= r) return 0;
    const f = 1 - d / r;
    return Math.min(1, s * f * f * (3 - 2 * f));
  };
  for (const b of blobs) paint(b.x - b.r, b.z - b.r, b.x + b.r, b.z + b.r, (x, z) => falloff(Math.hypot(x - b.x, z - b.z), b.r, b.s));
  for (const c of caps) {
    const vx = c.bx - c.ax;
    const vz = c.bz - c.az;
    const len2 = vx * vx + vz * vz;
    paint(Math.min(c.ax, c.bx) - c.r, Math.min(c.az, c.bz) - c.r, Math.max(c.ax, c.bx) + c.r, Math.max(c.az, c.bz) + c.r, (x, z) => {
      const t = Math.max(0, Math.min(1, ((x - c.ax) * vx + (z - c.az) * vz) / len2));
      return falloff(Math.hypot(x - (c.ax + vx * t), z - (c.az + vz * t)), c.r, c.s);
    });
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// The lawn: a polar grid so the circular edge is exact. Smooth normals come from the height
// function itself, not from the triangles.
export function buildLawn({ terrain, rings, segs, material }) {
  const n = (rings + 1) * (segs + 1);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const e = 0.12;
  let k = 0;
  for (let i = 0; i <= rings; i++) {
    const r = Math.max(0.001, (i / rings) * ISLAND);
    for (let j = 0; j <= segs; j++, k++) {
      const a = (j / segs) * TAU;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pos[k * 3] = x;
      pos[k * 3 + 1] = terrain.height(x, z);
      pos[k * 3 + 2] = z;
      const nx = terrain.height(x - e, z) - terrain.height(x + e, z);
      const nz = terrain.height(x, z - e) - terrain.height(x, z + e);
      const inv = 1 / Math.hypot(nx, 2 * e, nz);
      nor[k * 3] = nx * inv;
      nor[k * 3 + 1] = 2 * e * inv;
      nor[k * 3 + 2] = nz * inv;
      uv[k * 2] = x / TILE;
      uv[k * 2 + 1] = z / TILE;
    }
  }
  const idx = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

// The rock under the lawn: strata, ledges and a noisy silhouette, tapering to a point.
// `radius` scales it, so the same code builds the islets.
export function buildCliff({ radius = ISLAND, depth = 14, top = -0.9, rings = 30, segs = 96, seed = 1, material }) {
  const n = (rings + 1) * (segs + 1);
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  let k = 0;
  const c = new THREE.Color();
  const soil = new THREE.Color('#5a3d26');
  const ochre = new THREE.Color('#c88b52');
  const umber = new THREE.Color('#8a5a38');
  const slate = new THREE.Color('#6c6258');
  for (let i = 0; i <= rings; i++) {
    const v = i / rings;
    const r0 = radius * (1 - Math.pow(v, 1.55) * 0.97);
    const y = top - v * depth;
    for (let j = 0; j <= segs; j++, k++) {
      const a = (j / segs) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nz = fbm(ca * 1.7 + 3 + seed, sa * 1.7 + v * 4.5, { octaves: 3, seed: 5 + seed });
      const ledge = 0.5 + 0.5 * Math.sin(v * 44 + nz * 6);
      const r = r0 * (1 + (nz - 0.5) * 0.3 - ledge * 0.035 * (1 - v));
      pos[k * 3] = ca * r;
      pos[k * 3 + 1] = y + (nz - 0.5) * 0.5 * (1 - v);
      pos[k * 3 + 2] = sa * r;
      uv[k * 2] = (j / segs) * 9;
      uv[k * 2 + 1] = v * 3.2 + nz * 0.4;
      // strata colour: green-brown soil lip, ochre and umber bands, slate near the point
      const band = 0.5 + 0.5 * Math.sin(v * 30 + nz * 7);
      c.copy(ochre).lerp(umber, band * 0.55 + v * 0.35).lerp(slate, smoothstep(0.55, 1, v) * 0.7);
      c.lerp(soil, (1 - smoothstep(0, 0.05, v)) * 0.8);
      const shade = 0.82 + nz * 0.36;
      col[k * 3] = c.r * shade;
      col[k * 3 + 1] = c.g * shade;
      col[k * 3 + 2] = c.b * shade;
    }
  }
  const idx = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A tapered tube along a list of points, as raw geometry (merges well; 3-6 sides).
export function tube(points, r0, r1, radial = 5, uvRepeat = 1, colorTop = null) {
  const rows = points.length;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < rows; i++) {
    const p = points[i];
    const t = i / (rows - 1);
    const tan = (points[Math.min(rows - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)])).normalize();
    const side = new THREE.Vector3().crossVectors(Math.abs(tan.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up, tan).normalize();
    const fwd = new THREE.Vector3().crossVectors(tan, side).normalize();
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      pos.push(p.x + (side.x * Math.cos(a) + fwd.x * Math.sin(a)) * r, p.y + (side.y * Math.cos(a) + fwd.y * Math.sin(a)) * r, p.z + (side.z * Math.cos(a) + fwd.z * Math.sin(a)) * r);
      uv.push((j / radial) * 1.4, t * uvRepeat);
      const shade = colorTop ? 0.62 + 0.38 * t : 1;
      col.push(shade, shade, shade);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Roots hanging from the underside of the lawn's rim.
export function buildRoots({ count = 16, seed = 4, material }) {
  const r = rng(seed);
  const geos = [];
  for (let i = 0; i < count; i++) {
    const a = r() * TAU;
    const rad = ISLAND * (0.78 + r() * 0.16);
    const len = 2.5 + r() * 5;
    const pts = [];
    const sway = (r() - 0.5) * 1.6;
    for (let k = 0; k < 9; k++) {
      const t = k / 8;
      pts.push(new THREE.Vector3(Math.cos(a) * (rad - t * 1.2) + Math.sin(t * 3 + i) * 0.25 + sway * t * t, -1.6 - t * len, Math.sin(a) * (rad - t * 1.2) + Math.cos(t * 2.6) * 0.2));
    }
    geos.push(tube(pts, 0.2 + r() * 0.1, 0.02, 5, 3));
  }
  const m = new THREE.Mesh(mergeGeometries(geos), material);
  m.castShadow = true;
  return m;
}

// A small floating islet: a round lawn on a cone of rock. Returns the group and the spots
// where trees may be planted on it (island-local x, z, y).
export function buildIslet({ radius, seed, rockMat, grassMat }) {
  const g = new THREE.Group();
  const cliff = buildCliff({ radius, depth: radius * 1.5, top: -0.15, rings: 14, segs: 40, seed, material: rockMat });
  g.add(cliff);
  const top = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.99, 40, 0, TAU), grassMat);
  top.rotation.x = -Math.PI / 2;
  const p = top.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const d = Math.hypot(x, y) / radius;
    p.setZ(i, (1 - d * d) * radius * 0.07 + fbm(x * 0.4 + seed, y * 0.4, { octaves: 2, seed }) * 0.2 - 0.1);
  }
  top.geometry.computeVertexNormals();
  top.receiveShadow = true;
  g.add(top);
  const r = rng(seed * 31 + 7);
  const spots = [];
  const n = Math.max(2, Math.round(radius / 3.2));
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    const d = Math.sqrt(r()) * radius * 0.65;
    spots.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: (1 - (d / radius) ** 2) * radius * 0.07 });
  }
  return { group: g, spots };
}
