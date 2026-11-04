# Koala Grove: islands, resources, family and smarter koalas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Koalas bridge out to resource islands, gather and store resources, build from them, raise babies, file tickets to the player and research on the web, while spending fewer tokens per hour.

**Architecture:** Pure rules stay in `hq/` modules with no I/O (`grove-world.js` orchestrates; new `grove-economy.js` and `grove-family.js` hold the new rules). `hq/grove.js` owns time, sqlite, the scheduler and model calls; `hq/grove-brain.js` builds CLI args. The page draws server state; pure page helpers live in `public/js/view.js` so Node tests can run them.

**Tech Stack:** Node 24+/26 (`node:sqlite`, `node:test`), no npm dependencies, three.js 0.160.0 from jsDelivr, the `claude` CLI.

**Spec:** `docs/superpowers/specs/2026-11-04-koala-grove-islands-family-design.md`

## Global Constraints

- No npm dependencies; tests run with `npm test` (`node --test`), all green on Windows and macOS.
- Model: `claude-haiku-5-5` by default (`GROVE_MODEL`); every call keeps `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`, `--permission-mode dontAsk`, `--no-session-persistence`.
- Decisions have no tools (`--tools ""`); only research calls get `--tools WebSearch`.
- Koala ids `ruby` (boy, he/him) and `crystal` (girl, she/her); at most 4 koalas.
- Resources: `wood`, `water`, `sand`, `stone`, `book`. Fresh grove stockpile: 4 wood.
- Bridge to a resource island: 4 wood + 2 stone, effort 4.
- `GROVE_RESEARCH_PER_DAY` default 3, `GROVE_RESEARCH_USD` default 0.10.
- Max 3 open tickets per koala. Nest needs both grown-up, bond ≥ 80 both ways, same place, both choose `nest` within 2 grove hours.
- Everything model-written reaches the page as text, never HTML. Server keeps Host/Origin/JSON-POST checks on new routes.
- `data/` is never committed.

## Review Focus

- A koala holding resources when its paws limit drops (it cannot: strength never falls) or when given an item with full paws: `act give` must still refuse at `carryLimit`, counting resources too.
- A grove db from before this change (`mallee`/`bramble`, no stockpile, builds without `cost`): starts cleanly, renamed, stockpile 4 wood, old builds kept.
- Model replies naming an unbridged island, a resource the place lacks, or a build the stockpile cannot afford: the koala sits with a note, nothing is spent.
- Research text and ticket text from the model or the player containing HTML or 10 KB strings: capped and shown as text.
- Two koalas reaching the koala cap at the same moment (both choose `nest` when 3 koalas exist and one baby is pending): never more than 4.

---

### Task 1: Ruby and Crystal, with a migration of old groves

**Files:**
- Modify: `hq/grove-world.js` (`KOALAS`), `hq/grove.js` (constructor), `public/js/view.js` (`SIDE`), `public/js/koala.js` and `public/js/scene.js` (any `'mallee'`/`'bramble'` literals)
- Modify tests: `test/grove-world.test.mjs`, `test/grove.test.mjs`, `test/grove-view.test.mjs`, `test/grove-build.test.mjs`, `test/grove-http.test.mjs`, `test/fixtures/fake-koala.mjs`

**Interfaces:**
- Produces: `KOALAS = [{ id: 'crystal', name: 'Crystal', gender: 'girl', outfit: 'a pink scarf', home: 'clearing', ... }, { id: 'ruby', name: 'Ruby', gender: 'boy', outfit: 'a small blue hat', home: 'hollow', ... }]` (personas: Mallee's and Bramble's with the names swapped in). `export function migrateNames(text: string): string` in `hq/grove-world.js` (Mallee→Crystal, Bramble→Ruby, whole words).

- [ ] **Step 1: Write failing tests**
  - `grove-world.test.mjs` "two koalas with their own personas": `KOALAS.map(k => k.id)` deep-equals `['crystal', 'ruby']`; Crystal's persona matches `/girl \(she\/her\)/`, Ruby's `/boy \(he\/him\)/`; `migrateNames('Mallee told Bramble.')` equals `'Crystal told Ruby.'`; `migrateNames('Bramblewood')` unchanged.
  - `grove.test.mjs` "an old grove with Mallee and Bramble wakes up as Crystal and Ruby": create a db file, insert `grove_koalas` rows `mallee`/`bramble` whose data has `memories: ['Bramble is kind']`, `opinion: 'Mallee is brave'`, and one `grove_log` row text `'Mallee went to the pond'`; open a `Grove` on it; `state().koalas.map(k => k.id)` is `['crystal','ruby']`, Crystal's memories `['Ruby is kind']`, Ruby's opinion `'Crystal is brave'`, log text `'Crystal went to the pond'`; no `mallee` row remains.
  - Replace `mallee`/`bramble` with `crystal`/`ruby` in all other tests and the fake CLI.
- [ ] **Step 2:** `npm test` — the new tests fail (unknown ids).
- [ ] **Step 3:** Rename in `KOALAS`; in the `Grove` constructor, before loading koalas, migrate: for each old id with a row and no new row, insert the new row with `migrateNames` applied to `name`, `memories[]`, `recent[]`, `opinion`, `thought`, `say`, delete the old row, `UPDATE grove_log SET koala = new WHERE koala = old`, rewrite log `text` with `migrateNames`, and `UPDATE grove_usage SET koala`. Update page literals.
- [ ] **Step 4:** `npm test` — all green.
- [ ] **Step 5:** Commit `Koala Grove: Mallee and Bramble become Crystal and Ruby`.

### Task 2: Economy rules — resources, islands, bridges, gathering, the stockpile, costs

**Files:**
- Create: `hq/grove-economy.js`
- Modify: `hq/grove-world.js` (`ACTIONS`, `BLUEPRINTS`, `PLACES`, `placesOf`, `parseDecision`, `applyDecision`, `buildStep`, prompt lines)
- Test: `test/grove-economy.test.mjs`; update `test/grove-build.test.mjs` for costs

**Interfaces:**
- Produces (in `grove-economy.js`):
  - `RESOURCES = ['wood','water','sand','stone','book']`
  - `ISLANDS = [{ id, name, resource, x, z, r }]` with the spec's four rows exactly
  - `SOURCES: Record<placeId, resource[]>` — `big_gum`,`river_gum`,`blue_gum`,`fern_islet`→`['wood']`; `pond`,`spring_isle`→`['water']`; `sandy_shoal`,`sunset_point`→`['sand']`; `stone_crag`,`lookout`→`['stone']`; `library_isle`→`['book']`
  - `COSTS: Record<buildKind, Partial<Record<resource, number>>>` — the spec's table, plus `bridge: { wood: 4, stone: 2 }`
  - `START_STOCK = { wood: 4 }`
  - `held(k): number` — items + resources in paws; `canAfford(stock, cost): { ok: boolean, missing: Partial<Record<resource,number>> }`; `spend(stock, cost): void`
  - `bridged(world): Set<islandId>` — islands whose `bridge_<id>` build is done
- Produces (in `grove-world.js`): `ACTIONS` adds `'gather'` and `'store'`; `BLUEPRINTS` adds `well` (effort 4), `reading_nook` (effort 3) and one `bridge_<islandId>` per island (`{ name: 'Bridge to <Island>', effort: 4, bridge: islandId }`); `PLACES.stockpile = { name: 'Stockpile', x: 2.6, z: 4.4 }`; koala state gains `res: Record<resource, number>` (default `{}`); world gains `stock` (default `{ ...START_STOCK }`); `placesOf(world)` includes bridged islands (`{ name, x, z, island: true, resource }`).

- [ ] **Step 1: Write failing tests** in `test/grove-economy.test.mjs`:
  - "resource islands sit off the edge, reachable by a short bridge, overlapping nothing": for each island `hypot(x,z) - 24` between 13 and 15 (centre beyond edge) and `hypot(x,z) - r - 24` < 9; every pair among `ISLANDS` and `LANDS` has centre distance > rA + rB + 2.
  - "gather takes one unit where the place has it": koala at `pond`, `parseDecision({action:'gather', target:'water'})` then `applyDecision` → `k.res.water === 1`, log text matches `/gathered water/`; at `pond` gathering `sand` → koala sits, recent matches `/no sand here/`.
  - "paws are shared by items and resources": a baby (`strength 5`, limit 2) holding one item gathers once (ok) then again → sits, recent `/paws are full/`.
  - "store empties the paws into the stockpile": at `stockpile` with `res {wood:2, sand:1}` → `world.stock` `{ wood: 6, sand: 1 }` (from 4 wood), `k.res` `{}`; `store` elsewhere moves the koala to `stockpile` first (place becomes `stockpile`).
  - "an unbridged island cannot be visited": `parseDecision({action:'move', target:'sandy_shoal'}, k, placesOf(world))` keeps the koala's place.
  - "a bridge is built like anything else and opens its island": stock `{wood: 8, stone: 4}`, `build` target `bridge_sandy_shoal` ×4 by one koala → `bridged(world).has('sandy_shoal')`, `placesOf(world).sandy_shoal.resource === 'sand'`, stock `{ wood: 4, stone: 2 }`, a `built` log entry, and a bridge build has `plot === null`.
  - "a build only starts when the stockpile can pay": stock `{ wood: 1 }`, `build hut` → no build, koala sits, recent matches `/needs 3 more wood and 2 more sand/`; stock unchanged. With `{ wood: 4, sand: 2 }` it starts and the stock becomes `{}` (zeros dropped).
  - "the prompt lists what can be gathered here, the stockpile, and only affordable builds": with stock `{ wood: 2 }` the prompt matches `/Stockpile: 2 wood/`, includes `bench` and does not include `treehouse`.
  - Update `grove-build.test.mjs` worlds to start with ample stock (`stock: { wood: 99, stone: 99, sand: 99, water: 99, book: 99 }`) so building tests keep testing building.
- [ ] **Step 2:** `node --test test/grove-economy.test.mjs` — fails (module missing).
- [ ] **Step 3:** Implement `grove-economy.js` and wire it into `grove-world.js`. `gather` validation lives in `applyDecision` (needs world); `parseDecision` only checks `target ∈ RESOURCES` (else sit). Bridge builds skip plot selection (`plot: null`) and `placesOf` skips plot-less builds. `buildStep` checks `canAfford` before starting and spends on start. Prompt: replace the full places list with places reachable now; add `Here you can gather: …`, `Stockpile: …`, `You carry: …`; list only builds `canAfford` allows (bridges included).
- [ ] **Step 4:** `npm test` — green.
- [ ] **Step 5:** Commit `Koala Grove: resources, island bridges, gathering and a stockpile`.

### Task 3: Grove state — persist the economy, sightings, leaner pacing

**Files:**
- Modify: `hq/grove.js`, `hq/grove-world.js` (prompt trimming)
- Test: `test/grove.test.mjs`, `test/grove-world.test.mjs`

**Interfaces:**
- Consumes: Task 2's `world.stock`, `k.res`, `ISLANDS`, `bridged`, `COSTS`.
- Produces: `state()` adds `stock`, `islands: ISLANDS.map(i => ({ ...i, bridged }))`, `costs: COSTS`, `resources: RESOURCES`; meta key `stock` (default `START_STOCK` when missing). `GROVE_DEFAULTS` adds `idleMinMs: 40000`, `idleMaxMs: 90000`. `export const SIGHTINGS: string[]` in `grove-world.js`.

- [ ] **Step 1: Write failing tests**
  - "the stockpile survives a restart and starts at 4 wood": fresh grove `state().stock` deep-equals `{ wood: 4 }`; after a scripted `gather` at `big_gum` then `store`, reopen → `{ wood: 5 }`.
  - "act give counts resources against full paws": koala with `res {wood:2}` and strength 5 → `act give leaf` throws status 409.
  - "a koala with nothing new to react to waits longer": scripted `sit` decisions with no speech; after a decision the koala's `nextAt - now` is ≥ 40000; after the friend speaks it is ≤ 12000.
  - "now and then a koala notices a critter": with `rng` stubbed to return 0.01 and the grove hour advanced, some koala's `recent` gains an entry from `SIGHTINGS`; with `rng` 0.99 none.
  - `grove-world.test.mjs` "prompts stay short": `buildPrompt` for a koala with 10 recent and 12 memories includes only the last 6 recent and last 8 memories, and the whole prompt is under 3,200 characters.
- [ ] **Step 2:** `npm test` — the new tests fail.
- [ ] **Step 3:** Implement: load/save `stock` meta beside `builds`; idle pacing uses `idleMinMs..idleMaxMs` when the koala's `recent` gained nothing since its last call (track the length at call start); sightings rolled in `tick()` at most once per grove hour (`rng() < 0.15` per koala); trim prompt lists.
- [ ] **Step 4:** `npm test` — green.
- [ ] **Step 5:** Commit `Koala Grove: the stockpile is saved, idle koalas wait longer, critter sightings`.

### Task 4: Page — resource islands, bridges, the stockpile, carried blocks, resource UI

**Files:**
- Modify: `public/js/gfx/builds.js` (islands + bridges for `state.islands`, stockpile piles), `public/js/scene.js` (route over island bridges, remove the replaced decorative islets), `public/js/koala.js` (carried blocks), `public/js/view.js`, `public/js/ui.js`, `public/index.html`, `public/grove.css`
- Test: `test/grove-view.test.mjs`

**Interfaces:**
- Consumes: Task 3's `state.islands`, `state.stock`, `state.costs`, `k.res`.
- Produces (in `view.js`): `stockText(stock): string` (e.g. `'6 wood · 1 sand'`, `'empty'` when nothing), `carried(k): string[]` (one entry per held resource unit, in `RESOURCES` order), `RESOURCE_COLORS: Record<resource, string>` (`wood #8a6a4a`, `water #4e8fa3`, `sand #e6d29a`, `stone #a9a196`, `book #b05a3c`). `landRoute` already accepts any `{x,z,r}` list — pass bridged islands as well as risen lands.

- [ ] **Step 1: Failing tests** in `grove-view.test.mjs`: "stockText reads well" (`{wood:6,sand:1}` → `'6 wood · 1 sand'`, `{}` → `'empty'`, zero counts skipped); "carried lists each unit" (`{res:{stone:1,wood:2}}` → `['wood','wood','stone']`); "walking to a bridged island crosses its bridge" (`landRoute` from `(0,2)` to Sandy Shoal's centre with `[sandy]` returns 2 waypoints, the second inside Sandy Shoal).
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement helpers; in `BuildLayer.sync` raise `state.islands` with `bridged` like lands but with the bridge appearing only when `bridged` (island always visible, floating); dress each island for its resource (spring: a small waterfall of `WATER`-coloured planes; shoal: sand-coloured top; crag: rocks; library: a tiny shelf hut). Draw the stockpile as stacks of small boxes coloured by `RESOURCE_COLORS`, count-capped at 12 per resource. Koala: up to 4 small boxes held at chest height, coloured by `carried(k)`. UI: resource chips in the top bar from `stockText`; a "Resources" block on the Builds tab (stockpile, each build's cost, islands with bridged/unbridged). Remove the decorative islets whose `sites` overlap new islands.
- [ ] **Step 4:** `npm test` green; open the page with the fake CLI and check: islands float with no bridge, building a bridge shows it, koalas walk over, carried blocks show, stockpile grows. No console errors.
- [ ] **Step 5:** Commit `Koala Grove: resource islands, bridges and carried blocks on the page`.

### Task 5: Page — turtles, frogs and birds

**Files:**
- Create: `public/js/gfx/critters.js`
- Modify: `public/js/scene.js` (create and update the layer)
- Test: `test/grove-view.test.mjs`

**Interfaces:**
- Produces: `export class Critters { constructor({ scene, groundY, places, islands }); update(dt, t, night) }`; pure `export function critterPath(kind, t, home): { x, z, y, yaw }` in `view.js` (deterministic; turtles crawl slowly around a beach loop, frogs hop between 3 points by the pond, birds circle a gum tree at 9–12 m).

- [ ] **Step 1: Failing test** "critters keep to their homes": for t in 0..60 s, a turtle stays within 6 m of its home, a frog within 6 m of the pond and at y ≥ 0, a bird between 8 and 13 m up.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement `critterPath` and the low-poly meshes (turtle: domed shell + head; frog: two spheres; bird: body + two flapping wings). Two turtles, three frogs, four birds; frogs go quiet and birds roost (hidden) at night.
- [ ] **Step 4:** `npm test` green; check them in the browser.
- [ ] **Step 5:** Commit `Koala Grove: turtles, frogs and birds`.

### Task 6: A roster of 2 to 4 koalas

**Files:**
- Modify: `hq/grove-world.js` (`other()` → `others()`, prompts, `applyDecision` messages to every other koala), `hq/grove.js` (roster from the db, scheduler, usage, state), `public/js/scene.js`, `public/js/ui.js`
- Test: `test/grove-world.test.mjs`, `test/grove.test.mjs`

**Interfaces:**
- Produces: `world.koalas` may hold 2–4 entries; `export const MAX_KOALAS = 4`; `others(world, id): Koala[]`; each koala state may carry `parents: [id, id]` and `follows: id | null`. `Grove` keeps `#run` per koala present in `world.koalas`; `state().koalas` lists all, founders first.

- [ ] **Step 1: Failing tests**: a world with a third koala `{ id: 'pip', follows: 'crystal' }` — `applyDecision` by Ruby with `say` reaches both Crystal's and Pip's `recent`; `buildPrompt` for Ruby names both others; in `grove.test.mjs` a grove with a following koala makes no model call for it (`calls` never contain its id) and its `place` equals its parent's after each parent decision.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Generalise the friend logic to "the others" (bond and opinion stay per koala, about the others as a group: "how you feel about the others"); followers copy their parent's place and an `idle`/`sit` activity after each parent decision; scheduler skips followers.
- [ ] **Step 4:** `npm test` green.
- [ ] **Step 5:** Commit `Koala Grove: room for more koalas`.

### Task 7: Love, nesting and babies

**Files:**
- Create: `hq/grove-family.js`
- Modify: `hq/grove-world.js` (`ACTIONS` adds `'nest'`), `hq/grove.js` (birth timer, naming), `hq/http.js` (`POST /api/grove/name {koala, name}`), `public/js/ui.js` (name dialog), `public/js/scene.js` (babies drawn small via existing `grow(size)`)
- Test: `test/grove-family.test.mjs`, `test/grove-http.test.mjs`

**Interfaces:**
- Produces (in `grove-family.js`): `canNest(world, a, b): { ok, why }` (both `stage === 'grown'`, both `bond ≥ 80`, same place, roster `< MAX_KOALAS` counting a pending baby); `nestStep(world, id, nowGroveMin): { pending?: true, conceived?: true }` (records `world.nest = { by, at }`; a matching choice by the other within 120 grove minutes sets `world.baby = { due: at + 1440, parents: [a,b] }`); `bornBaby(world, nowGroveMin, name): Koala | null` (when due: new koala at `hollow`, `strength: START_STRENGTH`, `follows` = mother (the girl), `parents`, persona from `babyPersona(parentA, parentB, name)`); `graduates(k): boolean` (`follows` and strength ≥ 45).
- `Grove`: when a baby is due, it is born with a default name from `['Pip','Wattle','Gumnut','Sky']` (first unused) and a `grow` log entry; `POST /api/grove/name` renames a koala younger than one grove day (else 409); graduation clears `follows` and schedules the koala.

- [ ] **Step 1: Failing tests** in `grove-family.test.mjs`: nest refused for babies, for bond 79, for different places, at 4 koalas (and at 3 with a pending baby); two `nest` choices 100 grove minutes apart conceive, 130 apart do not; `bornBaby` before `due` returns null, after returns a koala following Crystal with strength 5; `graduates` false at 44, true at 45. In `grove-http.test.mjs`: name route 200 for a newborn, 409 for Ruby, 400 for an empty or 30+ character name, 415 without JSON.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement; nest outcome text in recent ("You and Ruby made a nest together. A baby is on the way!"); prompts mention nesting only when `canNest` is ok.
- [ ] **Step 4:** `npm test` green; check a forced birth on the page (dev harness with a seeded db) shows a tiny koala following its mother and the name dialog.
- [ ] **Step 5:** Commit `Koala Grove: love, nests and baby koalas`.

### Task 8: Tickets to the player

**Files:**
- Create: `hq/grove-tickets.js`
- Modify: `hq/grove-world.js` (`ACTIONS` adds `'file_ticket'`), `hq/grove.js`, `hq/http.js`, `public/js/ui.js`, `public/index.html` (Tickets tab), `public/grove.css`
- Test: `test/grove-tickets.test.mjs`, `test/grove-http.test.mjs`

**Interfaces:**
- Produces: `class Tickets { constructor(db); open(koala, text): ticket; reply(id, text): ticket; close(id): ticket; list(): ticket[]; openCount(koala): number }` with table `grove_tickets(id, koala, text, status, reply, created, updated)`; `ticket = { id, koala, title, text, status: 'open'|'answered'|'closed', reply }`. Routes `POST /api/grove/tickets/:id/reply {text}` (1–300 chars) and `POST /api/grove/tickets/:id/close`; `state().tickets` = all not closed.

- [ ] **Step 1: Failing tests**: a `file_ticket` decision with `say: 'We cannot reach the sand'` creates an open ticket titled with the first 60 chars; a 4th open ticket for the same koala is refused (koala sits, note in recent); reply sets `answered`, puts `The visitor answered your ticket: "…"` in that koala's recent and nudges it; text over 300 chars → 400; unknown id → 404; foreign Origin → 403.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement; Tickets tab lists tickets with a reply box and a close button; a small board mesh near the clearing shows the open count.
- [ ] **Step 4:** `npm test` green; reply from the page in the harness.
- [ ] **Step 5:** Commit `Koala Grove: koalas file tickets, you answer them`.

### Task 9: Research trips to Library Isle

**Files:**
- Modify: `hq/grove-brain.js` (`researchArgs`), `hq/grove-world.js` (`ACTIONS` adds `'research'`), `hq/grove.js`, `hq/config.js` (`researchPerDay`, `researchUsd`), `test/fixtures/fake-koala.mjs` (answers research schema)
- Test: `test/grove-brain.test.mjs`, `test/grove.test.mjs`, `test/config.test.mjs`

**Interfaces:**
- Produces: `researchArgs({ prompt, model, callUsd }): string[]` — same isolation flags as `koalaArgs`, but `--tools WebSearch --allowedTools WebSearch`, `--json-schema` of `RESEARCH_SCHEMA = { fact: string, idea: string }` (both required); `Grove` config `researchPerDay` (default 3), `researchUsd` (default 0.10); env `GROVE_RESEARCH_PER_DAY` (integer 1–50), `GROVE_RESEARCH_USD` (max 1).

- [ ] **Step 1: Failing tests**: `researchArgs` is exact (like "koalaArgs is exact"); a `research` decision at Library Isle (bridged) makes a second brain call whose args include `WebSearch`, stores `fact` (≤ 200 chars) in memories and `idea` in recent, and meters its usage under that koala; at another place the koala sits with `/only at Library Isle/`; the 4th research of the day sits with `/library is closed/`; config rejects `GROVE_RESEARCH_PER_DAY=0`.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement; the research call's prompt is the koala's question plus "Answer as a short fact a koala could remember, and one idea for the grove, or empty."
- [ ] **Step 4:** `npm test` green.
- [ ] **Step 5:** Commit `Koala Grove: research trips to Library Isle`.

### Task 10: Fake CLI, README, live checks, PR

**Files:**
- Modify: `test/fixtures/fake-koala.mjs` (gather, store, bridges, nest, file_ticket, research), `README.md`

- [ ] **Step 1:** Teach the fake koala the new actions (weighted toward gather/store/build so the economy moves in a demo).
- [ ] **Step 2:** Update README: islands and resources, family, tickets, research (with its cost limits), new settings, the rename.
- [ ] **Step 3:** Run the harness with the fake CLI for ~5 minutes; check a bridge gets built, resources flow, no console errors, mobile width holds.
- [ ] **Step 4:** Real check: harness with the real CLI and `GROVE_DAY_USD=0.05`; record tokens in per decision before (main) and after; the real model uses `gather`/`store`/`build` sensibly. Note results in the PR.
- [ ] **Step 5:** `npm test` green; commit, push the branch with `env -u GITHUB_TOKEN git push -u origin feat/islands-family`, open the PR (app button; `gh` has no login here).
