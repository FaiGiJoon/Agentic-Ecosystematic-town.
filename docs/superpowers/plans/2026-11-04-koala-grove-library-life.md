# Koala Grove: library road, reading, research and building anything — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Library Isle is open from day one with a road to it; koalas read books (cheap, tool-less call) and research the web (WebSearch call) as part of their own lives, keep a list of things they learned and a wish, and build anything they invent, drawn from a word-to-parts kit.

**Spec:** `docs/superpowers/specs/2026-11-04-koala-grove-library-life-design.md` (read it first; it holds the exact numbers).

**Architecture:** Pure rules in `hq/grove-world.js`, `hq/grove-economy.js` and a new pure `hq/grove-design.js`. `hq/grove.js` owns sqlite, scheduling and calls; `hq/grove-brain.js` builds CLI args. The page draws server state; pure page helpers live in `public/js/view.js` so Node tests can import them. 3D in `public/js/gfx/builds.js`.

**Tech:** Node 26 (`node:sqlite`, `node:test`), no npm deps, three.js 0.160.0 from jsDelivr.

## Global constraints

- `npm test` green after every task. No npm dependencies. Write tests first (TDD) for every rule change.
- Decisions keep `--tools ''`; reads get `--tools ''` too (separate system prompt + schema); only research gets `--tools WebSearch`. All calls keep `--setting-sources ''`, `--strict-mcp-config`, `--disable-slash-commands`, `--permission-mode dontAsk`, `--no-session-persistence`, `--max-budget-usd`.
- The daily cap (`dayUsd`) blocks reads and research as well as decisions.
- Model text (facts, wishes, design text, names) is trimmed, length-capped and rendered with `textContent`/`esc()`, never as HTML.
- Old groves load unchanged: old build kinds, builds without `spec`, koalas without `learned`/`wish`/`interests`.
- `DECISION_SCHEMA` stays strict: all properties required, `additionalProperties: false`.
- Run from the repo root. The repo is a local git repo; commit after each task with a short message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Library open from day one, the road, and new config

**Files:** `hq/grove-economy.js`, `hq/grove-world.js`, `hq/config.js`, `hq/grove.js` (defaults), `public/js/scene.js` and/or `public/js/gfx/terrain-math.js` (road), tests in `test/grove-economy.test.mjs`, `test/config.test.mjs`, `test/grove-build.test.mjs`.

- [ ] `grove-economy.js`: export `OPEN_ISLANDS = ['library_isle']`; `bridged(world)` always includes them. Building `bridge_library_isle` is no longer offered (treat as already built): `buildLines` must not list it, and `buildStep` must refuse it like a bridge that exists.
- [ ] `parseDecision`: moving to `library_isle` works in a fresh grove (no "needs a bridge" note).
- [ ] Page: islands with `bridged: true` already show their bridge (`BuildLayer.sync`), so the library bridge appears via state. Add the road: a worn path from the Sunny Clearing to the library bridge foot (`bridgeFoot(library_isle)` ≈ (-4.4, 21.0)). Preferred: pass an extra path target into the terrain places used by `terrain-math.js` so `pathMask` draws it and trees/rocks avoid it. Check `test/grove-gfx.test.mjs`/`grove-visual.test.mjs` still pass.
- [ ] Config: `GROVE_RESEARCH_PER_DAY` default 6; new `GROVE_READS_PER_DAY` (default 16, integer 1..100) → `readsPerDay`, `GROVE_READ_USD` (default 0.03, max 1) → `readUsd`. Add both to `GROVE_DEFAULTS` in `grove.js` and to `config.test.mjs`.
- [ ] Tests: fresh world has `library_isle` in `bridged()` and `placesOf()`; affordable list never contains `bridge_library_isle`; config defaults/overrides.

### Task 2: Reading and research as part of a koala's day

**Files:** `hq/grove-world.js`, `hq/grove-brain.js`, `hq/grove.js`, `test/fixtures/fake-koala.mjs`, tests in `test/grove.test.mjs`, `test/grove-brain.test.mjs`, `test/grove-world.test.mjs`.

- [ ] Add `'read'` to `ACTIONS`. `parseDecision`: `read` target = topic text (cap 80); empty → sit.
- [ ] Pure helper in `grove-world.js`: `canReadAt(world, place)` → true at `library_isle` or at a finished build whose kind is `reading_nook` or whose `spec.design`/title mentions book/books/reading/library/story. Research stays Library Isle only.
- [ ] `grove-brain.js`: `READ_SYSTEM` ("You are a picture book in the koala grove's library. The koala opens you at a topic; tell one true, simple, interesting thing about it, and maybe an idea for the grove.") and `readArgs({prompt, model, callUsd})` with `--tools ''`, `--json-schema RESEARCH_SCHEMA`.
- [ ] `grove.js`: `#mayRead(id)` mirrors `#mayResearch` with its own meta counter `reads` and `readsPerDay`, and refuses when `!canReadAt`. Generalise `#research(id, question)` into `#learn(id, topic, {web})` that picks `researchArgs`/`readArgs` and budget, records usage, and on success: push the fact to `k.learned` (max 8, new list, default `[]`), push `At the library you read: ...` or `On the web you found out: ...` to recent, tell other koalas at the same place (`<name> told you: <fact>`), log kind `learn` with text `<Name> read about <topic>: <fact>` or `<Name> looked up "<q>" on the web: <fact>`. Facts no longer go into `memories`.
- [ ] `applyDecision`: `read` costs energy like play (`-5 * fatigue`), describe as `opened a book about "<topic>"`; `research` describe stays.
- [ ] `buildPrompt`: always include one line `The library is on Library Isle (library_isle), across the bridge from the grove: there you can read books and look things up on the web.` Offer `read (target: a topic you are curious about; ...)` when `canReadAt(world, k.place)`; offer `research` at `library_isle`. Add `Things you learned:` section (last 5 of `k.learned`) after memories.
- [ ] Fake koala: when the prompt offers `read (target`, sometimes choose `read`; when args have `--tools ''` and the system prompt is the book (detect `READ_SYSTEM` text or `picture book`), reply `{fact, idea}`.
- [ ] Tests: read at library makes exactly one extra call with no tools and the read budget; fact lands in `learned` and in the friend's recent when nearby; reads stop at `readsPerDay`; read away from a book place sits with a note and makes no call; capped day makes no read call.

### Task 3: Their own lives — interests, wishes, curiosity

**Files:** `hq/grove-world.js`, `hq/grove-family.js`, `public/js/ui.js`, tests in `test/grove-world.test.mjs`, `test/grove-family.test.mjs`, `test/grove-view.test.mjs` if ui helpers are touched.

- [ ] `KOALAS[].interests` per spec; `babyPersona`/`bornBaby` give babies `interests` mixed from both parents (2 from each, deduped).
- [ ] `DECISION_SCHEMA` gets `wish` (string: "Something you would love to do or make one day, or empty to keep your wish"). `parseDecision` → `wish` capped 120. `applyDecision`: non-empty wish replaces `k.wish`; log `act` unchanged, add log `{kind:'wish', text:'<Name> wishes: <wish>'}` only when it changes.
- [ ] `systemPrompt`: add lines: `You have your own mind and your own life. You are curious about: <interests>.`, `Follow your curiosity: visit the library to read or look things up, then talk about what you learned and let it inspire what you build.` and mention the `wish` field in the field list.
- [ ] `buildPrompt`: `Your wish: "<wish>"` or `You have no wish yet.`
- [ ] UI Koalas card: show wish and a "Learned (n)" disclosure like "Remembers", using `esc`/`textContent`. Map new log kind `wish` in `LOG_CLASS` to the same style as `learn`.
- [ ] Tests: schema has `wish` required; wish stored and shown in prompt; interests in system prompt; baby interests mixed.

### Task 4: Build anything (server)

**Files:** new `hq/grove-design.js`, `hq/grove-world.js`, `hq/grove-economy.js`, `hq/grove.js` (state), `public/js/ui.js` (Builds tab), tests new `test/grove-design.test.mjs`, `test/grove-build.test.mjs`.

- [ ] `grove-design.js` (pure): `designSpec(name, design)` → `{ shape, size, parts, colors, design }` using the keyword rules in the spec (case-insensitive, word boundaries; parts deduped, max 8; colors max 3; `design` capped 160). `designCost(spec)` → `{cost, effort}` per spec.
- [ ] `DECISION_SCHEMA` gets `build_design` (string: "When you start building something new that you invented (target new), one sentence on what it is and what it looks like; otherwise empty"). `parseDecision`: `build` target `new` (or any unknown non-empty target when `build_design` or `build_name` is given) → target `new`, `buildDesign` capped 160.
- [ ] `buildStep`: target `new` with a name or design → if `open.length < MAX_OPEN` and a free plot exists, compute spec and cost, check/spend stockpile (missing → same "needs N more" note), create build `{kind:'custom', title, spec, cost, effort, ...}`. Legacy kinds unchanged. `placesOf` uses `b.title` as now; `describeBuild` unchanged.
- [ ] `buildLines`: keep the known kinds as ideas, and add: `Or invent anything you like: build with target new, a build_name and a build_design (e.g. a game machine, a castle, a footbridge, a fountain). Small costs 2 wood, medium 3 wood and 1 stone, big 5 wood and 3 stone.` List done/open custom builds with their design. Remove the old wording that suggests only listed builds are possible.
- [ ] Builds tab (`ui.js`): for custom builds show the design text under the title (escaped) and the cost table adds rows "Your own invention — small/medium/big".
- [ ] Tests: `designSpec` keyword cases (arcade machine with pink buttons → machine, parts include buttons, colors pink; "tiny stone tower" → tower small, cost moves wood→stone); building `new` spends cost and creates a custom build that progresses and finishes; can't afford → note, nothing spent; old saved builds still load and render data unchanged.

### Task 5: Build anything (3D)

**Files:** `public/js/gfx/builds.js`, `public/js/view.js` (pure helper), test in `test/grove-view.test.mjs` or `test/grove-gfx.test.mjs`.

- [ ] Pure `customPlan(spec)` in `view.js`: returns a list of primitive descriptors `{type:'box'|'cyl'|'cone'|'sphere', size:[...], pos:[x,y,z], rot?, color, glow?}` built from shape base + parts, scaled by size (small 0.7, medium 1, big 1.4), colours cycled from `spec.colors` (fallback wood tones `#8a6a4a`, `#c9a77c`, `#b05a3c`), and `height`. Shapes: house (walls + pitched roof + door), tower (tall cylinder + cone top), machine (cabinet + screen glow + buttons), bridge (arched deck + rails), garden (bed + flowers), statue (plinth + figure of spheres), shelter (posts + roof), playground (frame + slide), boat (hull + mast + sail). Parts add features (flag, wheel, screen, buttons, lights → glow, chimney, slide, flowers, sign, dome, stairs, bell, star, window, door, roof).
- [ ] `builds.js`: `MODELS.custom(g, layer, b)` draws `customPlan(b.spec)` (pass the build to model fns); glowing parts join `layer.glows` like the lantern; `HEIGHT` for custom builds comes from the plan height. Builds without spec fall back to `MODELS.bench`.
- [ ] Tests: each shape yields ≥3 primitives and a finite positive height; parts add primitives; unknown shape falls back to shelter; colors used.

### Task 6: Docs and live check

- [ ] README: update Research section (library open, road, reading vs research, caps), Building section (invent anything, sizes and costs), the koalas' interests and wishes, the config table (`GROVE_READS_PER_DAY`, `GROVE_READ_USD`, research default 6).
- [ ] `npm test` all green; start the server on a free port with `CLAUDE_BIN=test/fixtures/fake-koala.mjs` and check `/api` state shows `library_isle` bridged.
