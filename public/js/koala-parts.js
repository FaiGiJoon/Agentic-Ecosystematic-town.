// The koala's body parts, modelled in Blender (assets/koala/ holds the brief, the build script
// and the .blend) and exported as one GLB. Each part's origin sits on the joint the rig turns
// it about, so a part's geometry drops straight into the matching group in koala.js. The game
// keeps working without the file: koala.js falls back to its own ellipsoids when this returns null.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let parts = null;

// GLTFLoader strips "." from node names, so CR_Koala_Cheek.L arrives as CR_Koala_CheekL.
const key = (name) => name.replace(/^CR_Koala_/, '').replace(/\./g, '');

// source: a URL string, or the GLB's bytes as an ArrayBuffer (the phone build embeds them).
export async function loadKoalaParts(source) {
  try {
    const loader = new GLTFLoader();
    const gltf = source instanceof ArrayBuffer ? await loader.parseAsync(source, '') : await loader.loadAsync(source);
    const found = {};
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.geometry.attributes.normal && o.geometry.attributes.uv) found[key(o.name)] = o.geometry;
    });
    parts = Object.keys(found).length ? found : null;
  } catch (err) {
    console.warn('koala model not loaded, using the built-in shapes:', err?.message || err);
    parts = null;
  }
  return parts;
}

// The named part's geometry, or null when the model is not loaded.
export const koalaPart = (name) => parts?.[name] ?? null;
