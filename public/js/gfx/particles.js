// Effects: a pooled billboard particle system drawing from the shape atlas (one for
// additive glows, one for ordinary alpha shapes), plus an ambient layer animated entirely
// on the GPU: fireflies by night, drifting pollen in the sun by day.

import * as THREE from 'three';
import { ATLAS } from './textures.js';

const VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  attribute float aFrame;
  attribute float aRot;
  uniform float uScale;
  varying vec4 vColor;
  varying float vFrame;
  varying float vRot;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 220.0);
    vColor = aColor; vFrame = aFrame; vRot = aRot;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec4 vColor;
  varying float vFrame;
  varying float vRot;
  void main(){
    if (vColor.a < 0.004) discard;
    vec2 c = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) discard;
    float col = mod(vFrame, 4.0);
    float row = floor(vFrame / 4.0);
    vec4 t = texture2D(uAtlas, vec2((col + c.x) / 4.0, 1.0 - (row + c.y) / 2.0));
    gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Pool {
  constructor({ scene, atlas, max, additive }) {
    this.max = max;
    this.cap = max;
    this.i = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3).fill(-9999);
    this.color = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.frame = new Float32Array(max);
    this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aFrame', new THREE.BufferAttribute(this.frame, 1));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.uScale = { value: 800 };
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas }, uScale: this.uScale },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
    this.p = Array.from({ length: max }, () => ({ life: 0 }));
  }

  emit(o) {
    const idx = this.i % this.cap;
    this.i++;
    const p = this.p[idx];
    Object.assign(p, {
      life: o.life ?? 1, max: o.life ?? 1,
      x: o.x, y: o.y, z: o.z, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
      g: o.gravity ?? 0, drag: o.drag ?? 0, s0: o.size ?? 0.2, s1: o.size1 ?? o.size ?? 0.2,
      rot: o.rot ?? 0, spin: o.spin ?? 0, r: o.r ?? 1, gr: o.g2 ?? 1, b: o.b ?? 1, a: o.a ?? 1,
      frame: o.frame ?? 0, flutter: o.flutter ?? 0, seed: Math.random() * 10, fade: o.fade ?? 0.3,
    });
    this.frame[idx] = p.frame;
  }

  update(dt, scale) {
    this.uScale.value = scale;
    let live = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) {
        if (this.color[i * 4 + 3] !== 0) this.color[i * 4 + 3] = 0;
        continue;
      }
      live = true;
      p.life -= dt;
      const k = 1 - Math.max(0, p.life) / p.max;
      p.vy -= p.g * dt;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.vz *= damp;
      p.x += p.vx * dt + (p.flutter ? Math.sin(p.seed + k * 9) * p.flutter * dt : 0);
      p.y += p.vy * dt;
      p.z += p.vz * dt + (p.flutter ? Math.cos(p.seed * 1.3 + k * 8) * p.flutter * dt : 0);
      p.rot += p.spin * dt;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      const a = Math.min(1, k / 0.12) * Math.min(1, (1 - k) / p.fade) * p.a;
      this.color[i * 4] = p.r;
      this.color[i * 4 + 1] = p.gr;
      this.color[i * 4 + 2] = p.b;
      this.color[i * 4 + 3] = a;
      this.size[i] = p.s0 + (p.s1 - p.s0) * k;
      this.rot[i] = p.rot;
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = g.aColor.needsUpdate = g.aSize.needsUpdate = g.aRot.needsUpdate = g.aFrame.needsUpdate = true;
    return live;
  }
}

// The scene's effects, by name, so game code reads "fx.hearts(x, y, z)".
export class Effects {
  constructor({ scene, atlas, max }) {
    this.glow = new Pool({ scene, atlas, max: Math.ceil(max * 0.5), additive: true });
    this.soft = new Pool({ scene, atlas, max, additive: false });
    this.cap = 1;
  }

  setCap(f) {
    this.glow.cap = Math.max(8, Math.floor(this.glow.max * f));
    this.soft.cap = Math.max(8, Math.floor(this.soft.max * f));
  }

  update(dt, scale) {
    this.glow.update(dt, scale);
    this.soft.update(dt, scale);
  }

  dust(x, y, z, strength = 1) {
    this.soft.emit({ x, y: y + 0.08, z, vx: (Math.random() - 0.5) * 0.5, vy: 0.25 + Math.random() * 0.25, vz: (Math.random() - 0.5) * 0.5, drag: 1.5, life: 0.9, size: 0.14, size1: 0.5, frame: ATLAS.puff, r: 0.82, g2: 0.72, b: 0.58, a: 0.42 * strength, spin: (Math.random() - 0.5), rot: Math.random() * 6 });
  }

  crumb(x, y, z) {
    this.soft.emit({ x, y, z, vx: (Math.random() - 0.5) * 0.7, vy: 0.5 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.7, gravity: 4.5, life: 0.9, size: 0.1, size1: 0.07, frame: ATLAS.crumb, r: 0.55, g2: 0.78, b: 0.4, a: 1, spin: (Math.random() - 0.5) * 8, rot: Math.random() * 6, fade: 0.25 });
  }

  droplet(x, y, z) {
    this.soft.emit({ x, y, z, vx: (Math.random() - 0.5) * 1.8, vy: 2 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 1.8, gravity: 9, life: 0.8, size: 0.14, size1: 0.08, frame: ATLAS.drop, r: 0.7, g2: 0.88, b: 1, a: 0.85, fade: 0.2 });
  }

  sparkle(x, y, z, n = 10, color = [1, 0.86, 0.45]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 1.4;
      this.glow.emit({ x, y, z, vx: Math.cos(a) * s, vy: 0.6 + Math.random() * 1.4, vz: Math.sin(a) * s, drag: 1.6, gravity: -0.3, life: 0.9 + Math.random() * 0.6, size: 0.3 + Math.random() * 0.25, size1: 0.05, frame: ATLAS.sparkle, r: color[0], g2: color[1], b: color[2], a: 1, spin: (Math.random() - 0.5) * 4, rot: Math.random() * 6 });
    }
  }

  hearts(x, y, z, n = 3) {
    for (let i = 0; i < n; i++) {
      this.soft.emit({ x: x + (Math.random() - 0.5) * 0.5, y, z: z + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 0.3, vy: 0.7 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.3, drag: 0.4, life: 1.7 + Math.random() * 0.5, size: 0.18, size1: 0.42, frame: ATLAS.heart, r: 1, g2: 0.4, b: 0.55, a: 0.95, fade: 0.4, flutter: 0.3, rot: (Math.random() - 0.5) * 0.4 });
    }
  }

  gumnut(x, y, z) {
    this.glow.emit({ x, y, z, vy: -0.1, life: 0.7, size: 0.2, size1: 0.02, frame: ATLAS.glow, r: 1, g2: 0.78, b: 0.3, a: 0.85 });
  }

  leaf(x, y, z, tint) {
    this.soft.emit({ x, y, z, vx: 0.3, vy: -0.45, vz: 0.1, life: 7 + Math.random() * 4, size: 0.2, size1: 0.2, frame: ATLAS.leaf, r: tint[0], g2: tint[1], b: tint[2], a: 1, flutter: 0.9, spin: (Math.random() - 0.5) * 3, rot: Math.random() * 6, fade: 0.1 });
  }

  ring(x, y, z) {
    this.glow.emit({ x, y, z, life: 1.1, size: 0.3, size1: 2.4, frame: ATLAS.ring, r: 0.8, g2: 0.92, b: 1, a: 0.5, fade: 0.8 });
  }
}

// Fireflies and pollen: every point is animated in the vertex shader from a fixed seed.
export function buildAmbient({ scene, count, bounds, groundY }) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * bounds;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    pos[i * 3] = x;
    pos[i * 3 + 1] = groundY(x, z) + 0.4 + Math.random() * 3.2;
    pos[i * 3 + 2] = z;
    seed[i * 2] = Math.random() * 100;
    seed[i * 2 + 1] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const u = { uTime: { value: 0 }, uNight: { value: 0 }, uDay: { value: 1 }, uGolden: { value: 0 }, uScale: { value: 800 } };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */ `
      attribute vec2 aSeed;
      uniform float uTime, uNight, uDay, uGolden, uScale;
      varying float vA; varying float vMode; varying float vGold;
      void main(){
        float t = uTime, s = aSeed.x;
        // by day these are dust motes and pollen, drifting slowly in the light; by night, fireflies
        float drift = mix(0.4, 1.0, uNight);
        vec3 p = position + vec3(sin(t * 0.45 * drift + s) * 1.6 + sin(t * 1.1 + s * 3.0) * 0.3, sin(t * 1.2 * drift + s * 2.0) * 0.45, cos(t * 0.37 * drift + s * 1.7) * 1.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float fire = uNight;
        float blink = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * (1.1 + aSeed.y * 1.6) + s * 5.0), 3.0);
        float glint = 0.6 + 0.4 * sin(t * 2.3 + s * 7.0); // motes turning in a sunbeam
        vA = mix(uDay * (0.22 + 0.33 * aSeed.y) * (1.0 + uGolden * 1.6) * glint, blink, fire);
        vMode = fire;
        vGold = uGolden;
        float size = mix(0.055, 0.34, fire) * (0.7 + 0.6 * aSeed.y);
        gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 1.0, 60.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vMode; varying float vGold;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float core = 1.0 - smoothstep(0.0, 1.0, d);
        float a = core * core * vA;
        if (a < 0.01) discard;
        vec3 day = mix(vec3(1.0, 0.94, 0.7), vec3(1.0, 0.78, 0.42), vGold);
        vec3 col = mix(day, vec3(0.78, 1.0, 0.42), vMode);
        // fireflies are bright in HDR so the bloom pass gives them a soft halo
        gl_FragColor = vec4(col * (1.0 + vMode * 2.8 + vGold * 0.6), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = 7;
  scene.add(points);
  return { points, u };
}
