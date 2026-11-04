# Koala Grove: visual polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the grove look and move like a finished game: cinematic grading, real ambient occlusion, smooth motion, koalas that behave like koalas, bushland detail, richer particles and a polished HUD. No backend changes.

**Architecture:** Page only (`public/`). New pure helpers (testable in Node) in `public/js/gfx/grade.js` and `public/js/view.js`; three.js code in `gfx/post.js`, `gfx/quality.js`, `koala.js`, `scene.js`, `gfx/props.js`, `gfx/particles.js`; styling in `grove.css`.

**Tech Stack:** three.js 0.160.0 (jsDelivr, CSP-pinned import map) and its `examples/jsm` add-ons, `node:test`.

**Spec:** the brief in the conversation of 2026-11-04 (rendering, assets, particles, animation, HUD, performance), plus the koala biology notes (postures, chewing, bushland flora, termite mounds).

## Global Constraints

- Do not touch `hq/`, `server.js` or `/api` behaviour; the page reads the same state.
- No new npm dependency and no binary assets beyond what exists; three.js stays 0.160.0 and every add-on loads from the same import map (CSP hash unchanged).
- Every tier keeps working: Low renders without post-processing; the adaptive governor stays in charge of frame rate.
- `npm test` stays green on Windows.

## Decisions the brief leaves open

- **KTX2/Basis:** not applicable. Every texture is generated on the client at load (canvas), so there are no texture files to compress; adding a transcoder (WASM) would add load time for nothing.
- **"Locked 60 FPS":** cannot be guaranteed on every device; the existing governor (resolution first, then effects) is the mechanism. AO runs only on High and is the first effect the governor drops.
- **Blender:** not installed on this machine. New assets (termite mounds, paperbarks) are built in code, in the style of the existing procedural trees.
- **Streams:** none in the grove; the water work goes into the pond and the Spring Isle waterfall.

## Review Focus

- The governor stepping down from High to Medium while GTAO is on: AO must switch off cleanly (no black frame, no leaked render targets).
- Wind-animated grass and alpha-tested leaf cards under GTAO: no dark halos or crawling noise around foliage.
- A koala napping at a tree place it can only partly climb (baby reach): it must wedge low on the trunk, not float in the canopy.
- Phone widths (375 px) and very wide screens (2560 px): HUD must not cover the koalas or overflow.
- Tab switching and panel collapse under prefers-reduced-motion: transitions off.

---

### Task 1: Cinematic grade
- Create `public/js/gfx/grade.js`: `gradeAt(frac: number): { shadow: [r,g,b], highlight: [r,g,b], saturation, contrast, exposure, bloom, warmth }` — keyframed palette through the day: dawn peach, clean day with eucalyptus-green saturation, golden hour (warm highlights, olive shadows), twilight (teal-blue shadows, rose highlights), night (deep blue, stronger bloom).
- `post.js` GradeShader gains split-toning (`uShadow`, `uHighlight`) and exposure; `scene.js` feeds `gradeAt` each frame.
- Tests (`test/grove-visual.test.mjs`): golden hour (frac 0.74) highlight warmer than blue (`r > b`); twilight (0.81) shadow bluer than red; night bloom > day bloom; values finite for 200 samples; no adjacent-sample jump in any channel above 0.08 (no popping).

### Task 2: Ground contact — GTAO on High
- `quality.js` SETTINGS gain `ao` (low false, medium false, high true); the governor's first step down from High turns AO off.
- `post.js` adds `GTAOPass` after the render pass when `ao`; objects flagged `userData.noAO` (grass, leaf cards, particles, water, sky) are hidden from AO's depth/normal pass by overriding `overrideVisibility` / `restoreVisibility`.
- Tests: tiers' `ao` flags; `ladder('high')` reaches a step with `ao` false before resolution drops below 0.85.

### Task 3: Smooth motion
- `view.js`: `glide(speed, distance, dt, { max, accel })` → `{ speed, step }`: eases in from rest, eases out to stop at the target, never overshoots.
- `koala.js` uses it for walking and climbing; heading turns with a critically damped spring.
- Tests: from rest `speed ≤ accel·dt`; far away it reaches but never exceeds `max`; near the target it slows; `step ≤ distance` always.

### Task 4: Koalas that behave like koalas
- `view.js`: `postureFor({ anim, place, hour, inTree })` → `'fork' | 'curl' | 'hug' | anim`: a nap up a tree is a fork wedge; a nap on the ground at night (20:00–06:00) or in the cold early morning is a ball curl; clinging in the midday heat (11:00–15:00) is a tree hug.
- `spotFor`: a nap at a tree place puts the koala in a fork up the trunk, at its reach.
- `koala.js` poses: `fork` (wedged, legs dangling, head resting), `curl` (ball, head tucked), `hug` (limbs flush around the trunk), chewing with a lateral jaw slide while eating, idle weight shift and slow body sway, softer breathing that changes with the pose.
- Tests: the posture table above; nap at `big_gum` with reach 0.35 gives `0.5 < y < 2.5`.

### Task 5: Bushland details
- `props.js`/`scene.js`: 3 termite mounds (lumpy ochre cones with a crumbly normal map), 4 paperbark trees by the pond (white papery peeling bark, narrow grey-green leaves), bark variety on the forest (smooth pale gums and rough stringybark).
- Placement avoids places, plots, paths and the pond via `terrain.blocked`; a test checks the chosen spots.

### Task 6: Particles
- Sunbeam dust motes by day (stronger in golden hour), a steady fall of eucalyptus leaves from the named gums, fireflies and lantern glass brighter so bloom catches them.
- Verified in the browser at noon, golden hour and night.

### Task 7: HUD polish
- `grove.css`: refined glass (layered blur, inner highlight, softer borders), one easing curve for every transition, tab bodies fade/slide, bars animate their width, chips with tabular numbers, panel collapse animated, all transitions off under `prefers-reduced-motion`.
- Layout: the panel collapses by default below 1100 px width and sits as a bottom sheet on phones; top bar wraps without covering the centre of the view.
- Verified in the browser at 375×812, 1400×860 and 2560×1440.

### Task 8: Measure, document, ship
- Frame time and draw calls on High/Medium/Low at the fixed overview, before and after; `docs/grove-graphics.md` gains a section; push the branch and open a PR.
