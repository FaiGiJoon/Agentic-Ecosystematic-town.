# Koala Grove: the library road, reading, research and building anything — Design

## Why

The koalas almost never use the library. Library Isle is locked behind a bridge (4 wood, 2 stone),
and `research` is only offered while a koala stands on the island, so in practice it never
happens. Reading books does not exist as an activity; books are only a building material. And
builds come from a fixed menu of 11 models.

The owner wants the koalas to have their own lives: their own brain decides what they are curious
about, they go to the library because they want to, read books and look things up on the web, and
they build whatever they like (bridges, houses, towers, game machines, anything). What they learn
should show up in what they talk about, wish for and build.

## Goals

1. **The library is open from day one.** The bridge to Library Isle stands from the start (also in
   existing groves), and a worn road runs from the Sunny Clearing to the bridge foot.
2. **Reading.** New action `read` (target: a topic). Allowed at Library Isle or at any finished
   build whose description mentions books/reading/library (including the old `reading_nook`).
   A read is one cheap, tool-less library call ("the book") that returns a fact and maybe an idea.
3. **Research on the web** stays a separate, rarer call with WebSearch only. Default
   `GROVE_RESEARCH_PER_DAY` goes from 3 to 6. New `GROVE_READS_PER_DAY` (default 16) and
   `GROVE_READ_USD` (default 0.03). `read` and `research` are offered in the prompt whenever the
   koala is somewhere it can do them, and the prompt always says where the library is.
4. **Their own lives.**
   - Each founder gets `interests` (Crystal: brave explorers, shiny stones and crystals, stars,
     faraway places; Ruby: sleepy animals, eucalyptus and plants, poems, the moon and night).
     Babies inherit a mix of their parents'.
   - What a koala learns goes into a new `learned` list (last 8 facts), shown in its prompt as
     "Things you learned", separate from memories, and tells nearby koalas ("Crystal told you
     about ...").
   - New decision field `wish`: something the koala would love to do or make one day (or empty to
     keep it). Stored as `k.wish`, shown in its prompt and in the Koalas tab.
   - The system prompt says plainly: you have your own mind; follow your curiosity; the library
     is across the bridge; what you learn can inspire what you build.
5. **Build anything.** A koala may still name a known kind (bench, lantern, ... reading_nook,
   bridge_<island>), or invent its own: action `build`, target `new`, `build_name` (the name) and
   a new decision field `build_design` (one sentence: what it is and what it looks like). The
   server turns that into a `custom` build with a deterministic spec:
   - `size` small | medium | big, from words in the design (tiny/little/small, big/huge/giant/tall),
     default medium.
   - `cost` and `effort` by size: small 2 wood, effort 2; medium 3 wood + 1 stone, effort 4;
     big 5 wood + 3 stone, effort 6. Words "stone"/"rock" move 1 wood to 1 stone; "water"/"fountain"/
     "pool" add 1 water; "sand"/"glass" add 1 sand; "book"/"library"/"reading" add 1 book.
   - `shape`: one of house, tower, machine, bridge, garden, statue, shelter, playground, boat,
     from keywords (game/arcade/machine/robot -> machine; tower/lighthouse/castle -> tower;
     house/hut/home/cottage -> house; bridge -> bridge; garden/flowers -> garden; statue/sculpture
     -> statue; swing/slide/playground -> playground; boat/ship -> boat), default shelter.
   - `parts`: extra features found as words (roof, door, window, flag, wheel, screen, buttons,
     lights/lantern, chimney, slide, flowers, sign, dome, stairs/ladder, bell, star).
   - `colors`: up to 3 colour words found (pink, blue, red, green, yellow, purple, orange, white,
     gold, silver, brown, black), defaulting to warm wood tones.
   The page draws a custom build from that spec: a base shape per `shape`, scaled by `size`,
   tinted by `colors`, with each part added. Every custom build looks different. The
   design text appears in the Builds tab and on hover of the label.
   A "custom bridge" is a decorative footbridge on a plot (it does not open islands); bridges to
   islands stay the `bridge_<island>` builds.

## Non-goals

- No change to the money limits beyond the new per-call/day defaults above; the $0.50 daily cap
  still stops every call (decisions, reads and research).
- No new tools for decisions; reads have no tools; only research has WebSearch.
- No free placement: custom builds still use the existing plots and the 2-at-once limit.
- No 3D model generation from the model: the model writes words; the page maps words to parts.

## Anti-goals

- Koalas spending the day only reading (reads are capped per day and each read uses energy like
  playing does).
- Model text reaching the page as HTML. All design text, facts and wishes are rendered as text,
  capped in length.
- Breaking existing groves: old builds, kinds and stockpiles must load unchanged.

## Constraints

- No npm dependencies; `npm test` stays green. Pure rules live in `hq/grove-world.js` and
  `hq/grove-economy.js` (no I/O); page helpers that tests touch live in `public/js/view.js`.
- Decision JSON schema stays strict (`additionalProperties: false`, all fields required);
  the new fields `wish` and `build_design` are strings that are empty when unused.

## Left to the builder

- Exact geometry of each custom shape and part, and how the road is drawn (terrain path mask
  preferred).
- Where reads/research appear in the Talk tab (a "learn" log kind already exists).
