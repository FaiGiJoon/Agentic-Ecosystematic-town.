// Little lives around the koalas: turtles plodding over the grass, frogs hopping on the pond's
// bank, birds circling the gum trees. Scripted and free (no model calls); the server now and then
// tells a koala it noticed one. Where each one is comes from critterPath in view.js.

import * as THREE from 'three';
import { critterPath } from '../view.js';

const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });

function turtle() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#5f7a3c'));
  shell.scale.y = 0.75;
  shell.position.y = 0.1;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.33, 0.07, 12), mat('#8a7a4a'));
  rim.position.y = 0.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat('#8f9a5a'));
  head.position.set(0, 0.14, 0.4);
  g.add(shell, rim, head);
  for (const [x, z] of [[-0.22, 0.2], [0.22, 0.2], [-0.22, -0.2], [0.22, -0.2]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6), mat('#8f9a5a'));
    leg.position.set(x, 0.05, z);
    g.add(leg);
  }
  g.userData.head = head;
  return g;
}

function frog() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat('#6fa04a'));
  body.scale.set(1, 0.72, 1.2);
  body.position.y = 0.1;
  g.add(body);
  for (const x of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat('#f6f2e0'));
    eye.position.set(x, 0.2, 0.08);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), mat('#141418'));
    pupil.position.set(x, 0.21, 0.12);
    g.add(eye, pupil);
  }
  return g;
}

function bird(color, belly) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat(color));
  body.scale.set(0.8, 0.8, 1.5);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat(belly));
  chest.position.set(0, -0.03, 0.08);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 5), mat('#e2a33a'));
  beak.rotation.x = Math.PI / 2;
  beak.position.z = 0.24;
  g.add(body, chest, beak);
  g.userData.wings = [-1, 1].map((s) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.16), mat(color));
    w.geometry.translate(s * 0.18, 0, 0);
    w.position.x = s * 0.05;
    g.add(w);
    return w;
  });
  return g;
}

export class Critters {
  constructor({ scene, groundY, places }) {
    this.groundY = groundY;
    const pond = places.pond;
    this.list = [
      { kind: 'turtle', home: { x: pond.x + 8, z: pond.z - 1 }, phase: 0, mesh: turtle() },
      { kind: 'turtle', home: { x: -6, z: 17 }, phase: 2, mesh: turtle() },
      ...[0, 2.1, 4.2].map((phase) => ({ kind: 'frog', home: pond, phase, mesh: frog() })),
      { kind: 'bird', home: places.big_gum, phase: 0, mesh: bird('#8a6a4a', '#f2eadc') }, // a kookaburra
      { kind: 'bird', home: places.big_gum, phase: Math.PI, mesh: bird('#c8463a', '#3f6fb0') }, // a rosella
      { kind: 'bird', home: places.river_gum, phase: 1, mesh: bird('#e8e2d6', '#f2c14e') }, // a cockatoo
      { kind: 'bird', home: places.blue_gum, phase: 2.5, mesh: bird('#4f8a54', '#c8463a') }, // a lorikeet
    ];
    const SCALE = { turtle: 1.4, frog: 1.6, bird: 1.3 }; // big enough to spot over the grass
    for (const c of this.list) {
      c.mesh.scale.setScalar(SCALE[c.kind]);
      c.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(c.mesh);
    }
  }

  update(dt, t, night) {
    for (const c of this.list) {
      const p = critterPath(c.kind, t, c.home, c.phase);
      const m = c.mesh;
      if (c.kind === 'bird') {
        m.visible = night < 0.6; // birds roost at night
        if (!m.visible) continue;
        m.position.set(p.x, this.groundY(c.home.x, c.home.z) + p.y, p.z);
        m.rotation.set(0, p.yaw, Math.sin(t * 0.9 + c.phase) * 0.25);
        const flap = Math.sin(t * 14 + c.phase) * 0.7;
        m.userData.wings[0].rotation.z = flap;
        m.userData.wings[1].rotation.z = -flap;
      } else {
        m.position.set(p.x, this.groundY(p.x, p.z) + p.y, p.z);
        m.rotation.y = p.yaw + (c.kind === 'turtle' ? -Math.PI / 2 : 0);
        if (c.kind === 'turtle') m.userData.head.position.z = 0.38 + Math.sin(t * 1.3 + c.phase) * 0.04;
      }
    }
  }
}
