# Koala Grove graphics overhaul

This file records the technical audit, the plan and the measured result of the Koala Grove
graphics upgrade. Measured numbers are from the fixed capture views in `data/dev/cap.js` (a git-ignored dev helper).

## 1. Audit of the original renderer

Stack: three.js 0.160.0 from jsDelivr (pinned, with a CSP hash on the import map), plain ES
modules, no build step. The grove page is `public/`; the iPhone build in `data/phone/`
is generated from the same files by `data/phone/build.mjs`.

Measured on the original code, 1440×900, devicePixelRatio 1, RTX 4060 laptop GPU, grass and
koalas as built, four-view average of the fixed capture views in `data/dev/cap.js`:

| Metric | Original |
| --- | --- |
| Draw calls (overview, shadow pass included) | 292 |
| Triangles (overview) | 16,103 |
| Geometries | 288 |
| Textures in the whole scene | 2 (one is the ball's stripes) |
| Render time per frame (overview) | 4.81 ms |

Findings, most damaging first:

1. **No surface detail anywhere.** Every material is a flat-shaded `MeshStandardMaterial` with
   one colour, roughness ≈ 0.9, metalness 0. No albedo, normal or roughness maps. Surfaces
   read as plastic and every object has the same finish.
2. **Faceted silhouettes.** Trees are cylinders and detail-0 icosahedra, koalas are detail-1
   icosahedra with `flatShading`. At close range the koala's face is a handful of triangles.
3. **The "grass" is 520 three-sided cones.** They read as spikes, there is no grass cover, and
   the ground is one flat colour with a flat tan rectangle for each path.
4. **Flat, unlit pond.** A flat, nearly opaque disc: no depth, no shoreline, no motion, no
   reflection of the sky.
5. **Lighting is one sun plus a hemisphere light.** No image-based lighting, so shadowed
   areas are a flat grey-green. No ambient occlusion of any kind, so objects float on the
   ground (see the koala's feet and the tree base in the baseline captures).
6. **Sky is a two-colour gradient with flat discs for sun and moon.** No clouds, no glow, no
   haze, no sense of altitude; below the island there is empty gradient.
7. **Draw-call waste.** 292 draw calls for 16k triangles: rocks, bushes, pond stones, reeds,
   lily pads and tree parts are separate meshes. Four point lights are always compiled into
   every material even when their intensity is 0.
8. **UI.** Emoji are used as item icons (rendered differently on every platform), small touch
   targets (36 px) on the phone, place labels always on at full strength, and a single hard-coded
   quality level.

What the current engine can do: everything below is done with three.js 0.160.0 itself plus its
bundled `examples/jsm` modules (EffectComposer, UnrealBloom, OutputPass, PMREM). No new
dependency, no binary assets: textures are generated procedurally at load.

## 2. Plan, in priority order

1. **Clarity** (first): a readable value hierarchy, contrast between koalas, ground and
   props, selection and hover feedback, labels that fade with distance, sharper image
   (MSAA + a light sharpen).
2. **Detail in environment and objects**: heightfield terrain with a real pond basin,
   textured cliffs and roots, instanced blade grass, real eucalyptus (bark, branches, leaf
   cards), ferns, flowers, rocks, a cloud sea and distant islets for depth.
3. **Textures, materials, lighting**: procedural albedo, normal and roughness maps, an
   image-based environment from the live sky, a sky with sun glow, clouds, stars and moon,
   a water shader with fresnel, shore foam, ripples and caustics, shell fur on the koalas.
4. **Animation and effects**: dust, crumbs, splashes, sparkles, hearts, drifting leaves,
   pollen, fireflies, butterflies, wind in grass and leaves.
5. **UI**: one design language, SVG icons, a settings popover (quality, frame rate), bigger
   touch targets, a bottom sheet on phones.
6. **Performance**: three quality tiers, an adaptive governor that lowers resolution and
   effects when frames get slow, instancing everywhere it fits, fixed capacity so tier
   changes need no rebuild.

## 3. What was built

All of it is in `public/js/gfx/` and `scene.js` / `koala.js`; no new dependency, no
downloaded assets (every texture is generated at load).

| Area | What changed |
| --- | --- |
| Sky | One dome shader: Rayleigh-style gradient, sunrise band, a sun with core, corona and rays, a lit moon with maria, craters and phases, three layers of twinkling stars, a Milky Way band, a shooting star, fbm clouds lit by the sun or moon, a cloud sea under the island. The sun climbs in the north (Australia) and the shadow light comes from the same direction as the drawn sun. |
| Lighting | The sky is baked into an image-based light every few seconds (PMREM, olive ground bounce); one shadow-casting key light that is the sun by day and the moon by night with a smooth overhead hand-over; a soft fill; baked occlusion under trees, rocks and the log; contact shadows under koalas and the visitor. |
| Terrain | A heightfield lawn with a carved pond basin, a baked splat map (paths, occlusion, water depth), layered cliffs with a rock normal map, hanging roots, floating islets in the distance. |
| Vegetation | 18,000 instanced grass blades that sway and part around the koalas; real eucalypts (lofted trunk with root flare, bark and normal maps, curved branches, drooping leaf cards) as 3 named trees plus a forest of up to 38 instanced trees and trees on the islets; ferns, bushes, flowers, sculpted rocks. |
| Water | A custom shader on the standard material: fresnel reflection of the baked sky, two flowing normal layers, shore foam and tint from baked depth, ripple rings from play, caustics on the bed. |
| Koalas | 19 parts modelled in Blender (about 11,000 triangles: muzzle bulge, full cheeks, cupped ears, haunches, toe pads) with shell fur (one draw call per part through `gl_InstanceID`), glossy nose, eyes with catch-lights, claws, a woven scarf and a gum leaf, foot-step dust, ear flop. |
| Effects | Pooled billboard particles (dust, crumbs, droplets, sparkles, hearts, drifting leaves, gumnut glow) and a GPU ambient layer (fireflies by night, pollen by day), butterflies, ring and hover highlights. |
| Post | HDR render target with MSAA, bloom, a grade pass (sharpen, contrast, saturation, vignette, time-of-day tint), then tone mapping. |
| UI | Design tokens and a type scale, an inline SVG icon sprite instead of emoji, 44 px touch targets, a bottom sheet on phones, a graphics popover (Auto / Low / Medium / High, frame-rate readout), a first-person / third-person camera button (key `V`), a sun/moon clock icon, labels that fade with distance. |
| Performance | Three tiers; an adaptive governor steps resolution down first, then effects, and back up after a long calm stretch; geometry is built once at full capacity and drawn with a smaller `count`. |

## 4. Measured result

1440×900, devicePixelRatio 1, RTX 4060 laptop GPU, same fixed overview view, shadow pass and
post-processing included. Frame time is GPU-bound and noisy (high varied between about 4 and
9 ms between runs).

| | Draw calls | Triangles | Textures | Frame |
| --- | --- | --- | --- | --- |
| Original | 292 | 16,103 | 2 | 4.8 ms |
| Low | 266 | 431k | | 1.0 ms |
| Medium | 321 | 659k | | 2.6 ms |
| High | 329 | 842k to 893k | 37 | 4 to 9 ms |

Scene build time on the desktop: 3,463 ms at first, 874 ms after caching the noise lattice and
painting baked occlusion per blob (splat 1,688 to 89 ms, textures 1,223 to 569 ms). Phone
medium tier on the same CPU: 432 ms.

## 5. Known limits

- Ambient occlusion is baked and faked (ground occlusion under objects, vertex occlusion on
  trees, rocks and fur, contact blobs). There is no screen-space AO pass: the stock one cannot
  handle the wind-animated, alpha-tested and instanced foliage.
- The pond reflects the baked sky, not the trees around it (no planar reflection).
- Texture size is chosen when the page loads (256 / 384 / 512 by the starting tier); changing the
  tier later changes everything except texture sharpness.
- The cameras are first person (no body, drag to look) and third person (visitor in view, orbit
  within a band of about 4 to 27 degrees above the horizon). There is no overhead camera on
  purpose: it hid every landmark and made the koalas specks.
- The koala's back, underside, ear cups and haunches were modelled without reference (the only
  reference was a render of the old in-game koala); the manifest lists them as inferred.
- Nothing here has been run on a real iPhone. The phone build was exercised at iPhone size in a
  desktop browser with a stand-in for Claude.
- The trees are one species shape in three variants; the leaves are drawn cards, not geometry.

## 6. The Blender koala

The koala is the one model in the game that is not built in code. It was made with the
`blender-image-to-3d` skill (https://github.com/majidmanzarpour/blender-game-skills) and Blender 4.5, in
gated phases, each one checked against rendered images:

1. **Brief** (`assets/koala/asset-brief.md`): the parts, the scale, the triangle budget and what is inferred.
2. **Master scene** (`init_master.py`): metres, Z up, the koala facing -Y, the game's chase camera recreated.
3. **Forms** (`assets/koala/build/03_forms.py`): every size comes from the rig constants in `koala.js`,
   written in the game's own coordinates and converted once. Each part's origin sits on the joint
   the game rotates it about, so the existing pose code drives the new meshes unchanged.
4. **Validate** (`validate.py`): 11,024 triangles against a 12,000 budget, UVs present, no doubled vertices.
5. **Export** (`export_delivery.py`): one GLB plus a manifest. **Round trip** (`roundtrip.py`): the GLB re-imported
   with the same 19 parts and the same height.

Notes from doing it: the koala shows no baked colour because the game draws fur as shell layers, so the
mesh carries smooth normals and a continuous UV (wrapped around the lateral axis so the pinch points sit
under the ears and arms, never on the crown) and nothing else. The first render showed one stacked blob:
`set_origin()` reads `matrix_world`, which Blender does not refresh in background mode, so the script now
offsets the mesh itself. The round-trip check flags the paws as 0.186 m below the ground plane; that is the
game's rig space (the paw pivots hang below the body group), not an error.
