# Koala Grove: islands, resources, family and smarter koalas — design

Date: 2026-11-04. Status: design approved in chat; this spec awaits review.

## Goal

Make the grove a small living economy that two (and later more) AI koalas run themselves:
they bridge out to floating islands, gather resources, carry them home and build from them;
they fall in love and raise babies; they tell the player about problems; and now and then they
look things up on the web. Token use per hour goes down, not up.

## Decisions (made with the user)

| Question | Choice |
| --- | --- |
| Babies | Follow a parent for free (no model calls) until grown, then become real AI koalas. At most 4 koalas. |
| Tickets | Koalas file tickets to the player: a board in the grove and a Tickets tab. Player replies reach the koala's next prompt. |
| Internet | Rare research trips: a separate call with only WebSearch, at most `GROVE_RESEARCH_PER_DAY` (default 3) per day. |
| Tokens | Each koala stays its own agent on Haiku, with a leaner prompt and slower pacing when idle. Target: 30–50% less per hour. |
| Names | Ruby (boy, he/him, was Bramble) and Crystal (girl, she/her, was Mallee). Memories carry over. |

## Stage 1 — Islands, resources, building from resources

### Resources

Five resources: `wood`, `water`, `sand`, `stone`, `book`.

| Resource | Where it is gathered |
| --- | --- |
| wood | the three gum trees on the main island (fallen branches) and Fern Islet |
| water | the Lily Pond and Spring Isle |
| sand | Sandy Shoal and Sunset Point |
| stone | Stone Crag and the Lookout Rock |
| book | Library Isle |

Sources never run out; gathering takes one decision per unit.

### Resource islands

Four islands whose centres sit 13–15 m beyond the main island's edge, so a bridge of 6–8 m reaches them. They replace
the nearest of the decorative distant islets (the rest stay as scenery):

| Id | Name | Resource | Position (x, z), radius |
| --- | --- | --- | --- |
| spring_isle | Spring Isle | water | (-30, -22), 6 |
| sandy_shoal | Sandy Shoal | sand | (38, -6), 6.5 |
| stone_crag | Stone Crag | stone | (24, -30), 5.5 |
| library_isle | Library Isle | book | (-8, 38), 6 |

These islands and the existing new lands (Fern Islet, Sunset Point, Moss Isle) must not overlap;
a test checks every pair.

A resource island is unreachable until its **bridge** is built. A bridge is a build kind with the
target island's id (`bridge_spring_isle`, ...); it needs no plot (it stands between island and
islet) and costs 4 wood + 2 stone, effort 4. While unbridged, `move` and `gather` targets on that
island are refused (the koala sits instead and notes it cannot get there). The existing new lands
keep their free bridges.

### Carrying and the stockpile

- A koala carries resources in its paws along with items; the total is limited by
  `carryLimit(strength)` (2 for a baby, up to 4).
- `gather` (target: a resource) works only at a place that has that resource; it adds one unit to
  the koala's paws, or fails with a note when paws are full.
- The **Stockpile** is a new place by the clearing. `store` moves every resource the koala holds
  into the shared stockpile (persisted in sqlite meta).
- Starting a build takes its full cost from the stockpile; if there is not enough, the build does
  not start and the koala learns what is missing ("needs 2 more sand").

### Costs

| Build | Cost | Effort |
| --- | --- | --- |
| bench | 2 wood | 2 |
| lantern | 1 wood, 1 stone | 2 |
| flowerbed | 2 wood, 1 water | 3 |
| birdhouse | 2 wood | 3 |
| stones | 3 stone | 3 |
| hut | 4 wood, 2 sand | 5 |
| treehouse | 5 wood, 1 stone | 6 |
| tower | 3 wood, 3 stone | 6 |
| bridge_<island> | 4 wood, 2 stone | 4 |
| well (new) | 2 stone, 2 sand, 1 water | 4 |
| reading_nook (new) | 2 wood, 2 book | 3 |

A fresh grove starts with 4 wood in the stockpile so the first build can happen quickly.

### Critters (scripted, no tokens)

Turtles on beaches, frogs at the pond, birds circling the gum trees, rendered and animated on the
page. The server occasionally (at most once per grove hour, random) adds a one-line sighting to a
koala's recent events ("A turtle plodded past the pond.") so the koalas can react.

### Rename

`KOALAS` becomes `ruby` (boy, blue hat, home hollow, Bramble's persona with the new name) and
`crystal` (girl, pink scarf, home clearing, Mallee's persona with the new name). On start, a grove
database with `mallee`/`bramble` rows is migrated: rows are copied to the new ids, and names in
memories, recent events, opinions and the log are rewritten.

### UI

- Top bar: the stockpile as small resource chips next to the spend chips.
- A **Resources** section on the Builds tab: stockpile, costs, which islands are bridged.
- Carried resources are drawn as small blocks in a koala's arms (a stack of up to 4).
- The stockpile is drawn as piles that grow with the counts.

## Stage 2 — Family

- `nest` action: only when both koalas are grown-up, bond ≥ 80 in both directions, both at the
  same place, and fewer than 4 koalas. Both must choose `nest` within 2 grove hours of each other.
- A baby is born one grove day later at the Mossy Hollow. The page asks the player for a name
  (default from a list); its persona is generated from both parents' traits by a fixed template.
- A baby follows a parent: same place as that parent, no model calls, needs drift as usual.
  At strength 45 (youngster) it becomes a real AI koala with its own schedule and meter line.
- The scheduler, usage meter and prompts handle 2–4 koalas; "your friend" becomes "the others".

## Stage 3 — Smarter koalas

### Tickets

- `file_ticket` action with `say` as the ticket text (title = first 60 characters).
- Stored in sqlite (`grove_tickets`: id, koala, text, status open/answered/closed, reply, times).
- API: `GET /api/grove` includes open tickets; `POST /api/grove/tickets/:id/reply {text}`,
  `POST /api/grove/tickets/:id/close`. Same JSON/Origin checks.
- A reply goes into the filing koala's recent events ("The visitor answered your ticket: ...")
  and nudges it.
- At most 3 open tickets per koala.

### Research

- `research` action (target: a short question, ≤ 120 chars) only at Library Isle (bridged).
- A separate call: `claude -p` with `--tools WebSearch`, `--allowedTools WebSearch`, the same
  isolation flags, `--max-budget-usd GROVE_RESEARCH_USD` (default 0.10), JSON schema
  `{ fact, idea }`. Its usage is metered like any decision.
- Limited by `GROVE_RESEARCH_PER_DAY` (default 3) across all koalas; over the limit the koala sits
  and notes the library is closed for today.
- `fact` goes into long-term memory; `idea` (if any) into recent events.

## Token budget

- Prompt: only places within the koala's reach (main island + bridged islands), build list only
  when the stockpile can afford something or a build is open, at most 6 recent events and 8
  memories in the prompt (more are stored).
- The system prompt stays identical across calls per koala (cache-friendly).
- Idle pacing: when nothing happened since a koala's last decision, its next decision waits
  40–90 s instead of 20–60 s.
- Measure before and after with the real CLI on a small cap; report tokens in per decision.

## Testing

Test-first for every rule: resources and gathering, carry limits, stockpile and costs, bridges
gating islands, island placement, rename migration, nesting rules and the koala cap, baby
following and graduating, tickets API, research limit and call args, prompt length. The 3D parts
are checked in the browser with the fake koala CLI, which learns the new actions. A short real run
with a $0.05 cap checks the real model uses the new actions and measures tokens.

## Out of scope

A Claude fixer agent for tickets; babies that are real agents from birth; more than 4 koalas;
resources running out; trading with the visitor.
