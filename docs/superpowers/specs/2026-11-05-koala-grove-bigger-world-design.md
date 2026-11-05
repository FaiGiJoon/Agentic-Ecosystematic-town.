# Koala Grove: a world 20x bigger — Design

## Why
The owner wants the koalas' world much bigger: "make the world bigger", choosing 20x the area.
More room to explore, more places to visit, more space to build what they invent.

## Goals
1. **Island radius 24 m → 107 m** (20x the area). One constant drives it on the page
   (`ISLAND` in `public/js/gfx/terrain-math.js`) and on the server (`ISLAND_R` in
   `hq/grove-economy.js`); they must stay equal (add a test that checks they match).
2. **The old grove stays the heart of the island.** Existing places keep their ids. Their coordinates
   are spread out by 2.5x (the clearing stays at the centre), so the core is roomier but still a
   short walk.
3. **New land is filled, not empty.**
   - New places (ids are stable, names are friendly): `eucalyptus_forest` (a tree, eat/climb/wood),
     `ghost_gum` (a tree), `red_gum` (a tree), `sunrise_meadow`, `misty_hill` (a stone source),
     `fern_gully`, `waterfall_pool` (water source), `sandy_cove` (sand source on the shore). Spread them
     around the island at roughly 35–90 m from the centre so every direction has something.
   - Build plots: from 8 on the main island to about 40, spread over the whole island in open ground
     (clear of places, paths and each other). The plot ids of the first 8 stay `plot_1`..`plot_8`
     (spread 2.5x like places) so existing builds stay on their plots.
   - Gathering: the new tree places give wood, `misty_hill` stone, `waterfall_pool` water,
     `sandy_cove` sand (add to `SOURCES`).
   - Worn paths reach the new places (terrain path mask), and the library road still runs from the
     clearing to the library bridge foot.
4. **Islands and new land move out with the edge.** Resource islands (`ISLANDS`) and rising land
   (`LANDS`) keep their direction from the centre but sit just beyond the new edge (their distance
   from the island edge stays about what it is now). Their plots move with them. Bridges and
   `bridgeFoot` follow `ISLAND_R`.
5. **It still runs smoothly.** Foliage, grass, rocks, ferns, flowers and critters scale with the land
   but stay within the quality presets' budgets (`public/js/gfx/quality.js`): denser near the
   grove, sparser far out; use the existing quality caps. The terrain mesh gets enough rings/segments
   for the larger radius at each quality level. Fog, camera far plane and the sun's shadow camera are
   tuned so the far island is visible and shadows look right around the player (the shadow camera
   may follow the player). No frame-rate collapse on the "high" preset.
6. **Moving around is still pleasant.** Koalas walk between places on the page; long trips must not
   take more than ~12 s (speed up with distance). The visitor walks faster (and runs with Shift);
   clicking the grass to walk still works.
7. **Existing saves load.** Koalas, builds, stockpile and memories stay; builds stay on their plot ids
   (which moved with the spread), koalas stay at their place ids. Nothing is deleted.

## Non-goals
- No terrain chunking or streaming. No new resources or rules beyond the new places' sources.
- The koalas' decisions, budgets and prompts are unchanged except that the new places and plots
  appear in them (the place list in the prompt must stay compact: names and ids only).

## Constraints
- No npm dependencies; `npm test` green. Pure server rules stay pure. Tests that assert old
  coordinates are updated to the new layout, not deleted.
