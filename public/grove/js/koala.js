// A low-poly koala: built from flat-shaded primitives, walked and posed in code.
// The scene tells it where to be and what it is doing; this file only animates.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: true, ...extra });
const blob = (r, detail, mat, s = [1, 1, 1]) => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat);
  m.scale.set(...s);
  m.castShadow = true;
  return m;
};
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const angleTo = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const CREAM = '#efe7da';
const WALK = 2.1;
const CLIMB = 1.5;

export class Koala {
  constructor({ id, name, color }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.seed = id === 'mallee' ? 0.3 : 2.1;
    this.pos = new THREE.Vector3();
    this.goal = { x: 0, y: 0, z: 0 };
    this.path = [];
    this.anim = 'idle';
    this.heading = 0;
    this.face = null; // where to look once arrived (angle), or null
    this.moving = false;
    this.blink = 2 + Math.random() * 3;
    this.thinking = false;

    const fur = flat(color);
    const dark = flat('#3b3a3f');
    const root = (this.root = new THREE.Group());
    const rig = (this.rig = new THREE.Group());
    root.add(rig);

    this.torso = blob(0.6, 1, fur, [1, 1.12, 0.92]);
    this.torso.position.y = 0.68;
    const belly = blob(0.44, 1, flat(CREAM), [0.92, 1.05, 0.5]);
    belly.position.set(0, 0.62, 0.3);
    rig.add(this.torso, belly);

    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.36, 0.08);
    head.add(blob(0.5, 1, fur, [1.18, 0.96, 0.96]));
    this.ears = [-1, 1].map((s) => {
      const ear = new THREE.Group();
      ear.position.set(s * 0.52, 0.28, -0.02);
      ear.add(blob(0.3, 1, fur, [1, 1, 0.42]));
      const inner = blob(0.19, 1, flat('#f6eee6'), [1, 1, 0.3]);
      inner.position.z = 0.08;
      ear.add(inner);
      head.add(ear);
      return ear;
    });
    const nose = blob(0.17, 1, flat('#2a2a30', { roughness: 0.5 }), [0.82, 1.3, 0.75]);
    nose.position.set(0, -0.05, 0.47);
    head.add(nose);
    this.eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), flat('#141418', { roughness: 0.3 }));
      e.position.set(s * 0.21, 0.09, 0.43);
      head.add(e);
      return e;
    });
    // Mallee wears a little orange scarf, Bramble a gum leaf on the head.
    if (id === 'mallee') {
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.09, 6, 14), flat('#e88a3c'));
      scarf.rotation.x = Math.PI / 2;
      scarf.position.set(0, 1.04, 0.04);
      rig.add(scarf);
    } else {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 4), flat('#7fa38a'));
      leaf.scale.z = 0.3;
      leaf.position.set(0.12, 0.55, 0);
      leaf.rotation.z = -0.5;
      head.add(leaf);
    }
    rig.add(head);

    const limb = (x, y, z, len) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, len, 6), flat(color, {}));
      m.position.y = -len / 2;
      m.castShadow = true;
      const paw = blob(0.12, 0, dark);
      paw.position.y = -len;
      g.add(m, paw);
      g.paw = paw;
      rig.add(g);
      return g;
    };
    this.arms = [limb(-0.44, 1.0, 0.18, 0.55), limb(0.44, 1.0, 0.18, 0.55)];
    this.legs = [limb(-0.3, 0.36, 0.12, 0.42), limb(0.3, 0.36, 0.12, 0.42)];

    // A gum leaf in the right paw while eating.
    this.snack = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 4), flat('#6b917c'));
    this.snack.scale.z = 0.3;
    this.snack.position.y = -0.12;
    this.arms[1].paw.add(this.snack);
    this.snack.visible = false;

    // The gumnut that circles the head while a real model call is in flight.
    this.nut = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#f2c14e', emissiveIntensity: 2.2, flatShading: true }));
    this.nutLight = new THREE.PointLight('#f2c14e', 0, 4, 2);
    this.nut.add(this.nutLight);
    this.nut.visible = false;
    root.add(this.nut);

    root.traverse((o) => { if (o.isMesh) o.userData.koala = id; });
    this.#labels();
  }

  #labels() {
    const tag = document.createElement('button');
    tag.className = 'koala-tag';
    tag.type = 'button';
    tag.style.setProperty('--c', this.color);
    tag.innerHTML = `<i></i><span class="n"></span><span class="s"></span>`;
    tag.querySelector('.n').textContent = this.name;
    this.tagEl = tag;
    this.tagState = tag.querySelector('.s');
    const tagObj = new CSS2DObject(tag);
    tagObj.position.y = 2.3;
    this.root.add(tagObj);

    const say = document.createElement('div');
    say.className = 'bubble say';
    const think = document.createElement('div');
    think.className = 'bubble think';
    const zzz = document.createElement('div');
    zzz.className = 'zzz';
    zzz.innerHTML = '<span>z</span><span>z</span><span>z</span>';
    const stack = document.createElement('div');
    stack.className = 'bubble-stack';
    stack.append(think, say);
    const stackObj = new CSS2DObject(stack);
    stackObj.position.y = 2.75;
    stackObj.center.set(0.5, 1);
    const zObj = new CSS2DObject(zzz);
    zObj.position.set(0.5, 1.9, 0);
    this.root.add(stackObj, zObj);
    this.sayEl = say;
    this.thinkEl = think;
    this.zEl = zzz;
    this.sayT = 0;
    this.thinkT = 0;
  }

  say(text) {
    this.sayEl.textContent = text;
    this.sayEl.classList.add('show');
    this.sayT = Math.min(11, 4 + text.length / 14);
  }

  thought(text) {
    this.thinkEl.textContent = text;
    this.thinkEl.classList.add('show');
    this.thinkT = 6;
  }

  place(x, y, z) {
    this.pos.set(x, y, z);
    this.goal = { x, y, z };
    this.path = [];
    this.root.position.copy(this.pos);
  }

  // Walk the waypoints, then reach goal (climbing to goal.y if it is up a tree).
  setGoal(goal, anim, path = [], face = null) {
    const moved = Math.hypot(goal.x - this.goal.x, goal.z - this.goal.z) > 0.05 || Math.abs(goal.y - this.goal.y) > 0.05;
    this.goal = goal;
    this.anim = anim;
    this.face = face;
    if (moved) this.path = path;
  }

  get arrived() {
    return !this.moving && Math.abs(this.pos.y - this.goal.y) < 0.02;
  }

  update(dt, t) {
    const p = this.pos;
    const next = this.path[0] ?? this.goal;
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const far = Math.hypot(dx, dz);
    let mode = this.anim;
    this.moving = false;

    if (p.y > 0.02 && Math.hypot(this.goal.x - p.x, this.goal.z - p.z) > 0.25) {
      p.y = Math.max(0, p.y - CLIMB * dt); // climb down before walking off
      mode = 'climbing';
    } else if (far > 0.06) {
      const step = Math.min(far, WALK * dt);
      p.x += (dx / far) * step;
      p.z += (dz / far) * step;
      this.heading += angleTo(this.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      this.moving = true;
      mode = 'walk';
      if (far <= step + 1e-6 && this.path.length) this.path.shift();
    } else if (Math.abs(this.goal.y - p.y) > 0.02) {
      p.y += Math.sign(this.goal.y - p.y) * Math.min(Math.abs(this.goal.y - p.y), CLIMB * dt);
      mode = 'climbing';
    }
    if (!this.moving && this.face != null) this.heading += angleTo(this.heading, this.face) * Math.min(1, dt * 4);
    this.root.position.copy(p);
    this.root.rotation.y = this.heading;
    this.#pose(mode, dt, t);
    this.#bubbles(dt, t);
  }

  #pose(mode, dt, t) {
    const { rig, head, arms, legs } = this;
    const s = t + this.seed;
    const k = 10;
    let pitch = 0, y = 0, z = 0, headX = 0, headY = 0, breathe = 1 + Math.sin(s * 2) * 0.02;
    let aL = -0.3, aR = -0.3, aZ = 0, lL = -1.35, lR = -1.35, eyes = 1;
    this.snack.visible = false;

    switch (mode) {
      case 'walk': {
        const w = Math.sin(s * 9);
        pitch = 1.05; y = -0.2; z = 0.15; headX = -0.95;
        aL = 0.3 + w * 0.7; aR = 0.3 - w * 0.7; lL = -0.2 - w * 0.6; lR = -0.2 + w * 0.6;
        y += Math.abs(w) * 0.05;
        break;
      }
      case 'climbing': {
        const w = Math.sin(s * 7);
        aL = -2.7 + w * 0.35; aR = -2.7 - w * 0.35; lL = -0.6 - w * 0.4; lR = -0.6 + w * 0.4; z = -0.25;
        break;
      }
      case 'cling':
        aL = -2.4; aR = -2.5 + Math.sin(s * 0.8) * 0.1; lL = lR = -0.7; z = -0.3; headY = Math.sin(s * 0.3) * 0.5; headX = 0.1;
        break;
      case 'eat': {
        aL = -2.3; aR = -2.15 + Math.sin(s * 3.2) * 0.3; lL = lR = -0.8; z = -0.25; headX = 0.12 + Math.abs(Math.sin(s * 9)) * 0.06;
        this.snack.visible = true;
        break;
      }
      case 'sleep':
        pitch = 0.55; y = -0.22; headX = 0.55; aL = -0.95; aR = -0.95; aZ = 0.45; lL = lR = -1.5; eyes = 0.12;
        breathe = 1 + Math.sin(s * 1.1) * 0.045;
        break;
      case 'swing': {
        const ph = Math.sin(t * 2.2 + (this.id === 'mallee' ? 0 : 1.4));
        z = ph * 0.55; y = 0.55 + (1 - Math.cos(ph)) * 0.25; pitch = -ph * 0.25;
        aL = aR = -2.9; lL = lR = -1.3 - ph * 0.5;
        break;
      }
      case 'splash': {
        y = Math.abs(Math.sin(s * 5)) * 0.35; aL = -1.6 + Math.sin(s * 10) * 0.8; aR = -1.6 - Math.sin(s * 10) * 0.8; aZ = 0.4;
        headX = -0.2;
        break;
      }
      case 'ball':
        aL = aR = -1.3 + Math.sin(s * 4) * 0.6; pitch = 0.15 + Math.sin(s * 4) * 0.08; headX = -0.15;
        break;
      default: // idle: breathe, look around, twitch an ear
        headY = Math.sin(s * 0.45) * 0.45 + Math.sin(s * 1.3) * 0.08;
        headX = Math.sin(s * 0.3) * 0.08;
        break;
    }

    this.blink -= dt;
    if (this.blink < 0) this.blink = 2.5 + Math.random() * 3.5;
    if (this.blink < 0.12 && mode !== 'sleep') eyes = 0.1;
    for (const e of this.eyes) e.scale.y = damp(e.scale.y, eyes, 30, dt);

    rig.rotation.x = damp(rig.rotation.x, pitch, k, dt);
    rig.position.y = damp(rig.position.y, y, k, dt);
    rig.position.z = damp(rig.position.z, z, k, dt);
    head.rotation.x = damp(head.rotation.x, headX, k, dt);
    head.rotation.y = damp(head.rotation.y, headY, k, dt);
    this.torso.scale.y = 1.12 * breathe;
    arms[0].rotation.x = damp(arms[0].rotation.x, aL, k, dt);
    arms[1].rotation.x = damp(arms[1].rotation.x, aR, k, dt);
    arms[0].rotation.z = damp(arms[0].rotation.z, -aZ, k, dt);
    arms[1].rotation.z = damp(arms[1].rotation.z, aZ, k, dt);
    legs[0].rotation.x = damp(legs[0].rotation.x, lL, k, dt);
    legs[1].rotation.x = damp(legs[1].rotation.x, lR, k, dt);
    const twitch = Math.sin(s * 0.7) > 0.97 ? Math.sin(s * 40) * 0.25 : 0;
    this.ears[0].rotation.z = twitch;
    this.ears[1].rotation.z = -twitch * 0.5;

    this.nut.visible = this.thinking;
    if (this.thinking) {
      this.nut.position.set(Math.cos(t * 3) * 0.75, 2.0 + Math.sin(t * 5) * 0.08, Math.sin(t * 3) * 0.75);
      this.nut.rotation.y += dt * 4;
      this.nutLight.intensity = 3;
    }
    this.zEl.classList.toggle('show', mode === 'sleep');
  }

  #bubbles(dt) {
    if (this.sayT > 0 && (this.sayT -= dt) <= 0) this.sayEl.classList.remove('show');
    if (this.thinkT > 0 && (this.thinkT -= dt) <= 0) this.thinkEl.classList.remove('show');
  }
}
