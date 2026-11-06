# Koala Grove

Two AI koalas live on a floating eucalyptus island. Every step they take, every word they say and
every thought they have is a real Claude decision. They eat, nap, play, talk, remember, grow up,
build whatever they dream up, and go to the library to learn about the world on the web. The more
they learn, the smarter they get, and each one slowly becomes its own personality.

You can walk around the grove, give them things and talk to them, or just watch how two AI agents
get on when left to themselves. A dashboard shows what they are up to, and one click exports
everything they did, thought and spent to Google Sheets.

It runs only on your own computer (127.0.0.1). Nothing is deployed anywhere.

## Quick start

You need:

- **Node 24 or newer.** There are no npm dependencies.
- **The Claude Code CLI** (`claude`), installed and logged in. The koalas use your existing login,
  not an API key.
- **Internet** for three.js (pinned to 0.160.0 on cdn.jsdelivr.net) and for the koalas' web research.

```
node server.js        # or: npm start
```

Open http://127.0.0.1:4317 and press **Play** (or "Wake the koalas"). The grove starts paused and
spends nothing until you do.

To start it at login on a Mac, run `scripts/install-autostart.sh`. It installs a LaunchAgent that
restarts the server if it crashes, and adds `~/Applications/Koala Grove.app` to open the grove.
Output goes to `logs/server.log`. `scripts/uninstall-autostart.sh` undoes it, keeping the koalas'
memories in `data/`.

## Meet the koalas

- **Crystal** is a bold, endlessly curious baby koala, a girl in a pink scarf. She collects shiny
  pebbles, talks a lot, gets bored quickly and secretly wants Ruby to think she is brave. She
  loves brave explorers, shiny stones and crystals, stars and faraway places.
- **Ruby** is a gentle, sleepy baby koala, a boy in a small blue hat. He adores eucalyptus, long
  naps and quiet company, speaks softly and a little poetically, and is slow to trust. He loves
  sleepy animals, plants, poems, the moon and the night.

Each of them is its own `claude -p` call (model `claude-haiku-5-5` by default), deciding every
20 to 60 seconds. A decision is a private thought, an action, what they say out loud, a mood,
something to remember, how the moment changed their feelings about the other, a wish, and now and
then a new trait they have noticed about themselves.

## How they live

- **Needs and growing up.** Hunger and energy rise and fall. Climbing, playing, building, eating
  and resting make a koala stronger: from baby to joey, youngster and grown-up. Strength sets how
  big it is, how high it climbs, how much it carries and how fast it tires.
- **Memory and feelings.** Each koala keeps its 10 latest events, up to 12 long-term memories it
  chose, a bond with the other koala from -100 to 100, and a one-line opinion of them. Everything
  lives in `data/grove.sqlite` (git-ignored) and survives restarts.
- **Building.** The koalas decide what to build and what to call it: a bench, a lantern, a
  treehouse, a bridge to another island, or anything they invent ("a pink castle with a bell"). The
  game reads the design sentence and turns its size, shape, extras and colours into a 3D build.
  Building together goes twice as fast. Every two finished builds, new land rises from the water.
- **Resources.** Wood, water, sand, stone and books come from the gum trees, the pond, the lookout
  rock and four floating islands. The koalas gather them by the pawful and store them in a shared
  Stockpile, which pays for every build. Three islands need a bridge first; Library Isle is open
  from the start.
- **Family.** When both are grown up, love each other and choose to `nest`, a baby is born a grove
  day later and you get to name it. It follows its mother, makes no model calls of its own, and
  starts deciding for itself once it is a youngster. The grove holds at most 4 koalas.
- **Tickets.** When a koala hits a problem it can't solve ("we need more stone for the bridge"),
  it writes a ticket for you. Your answer goes into its memory.

## Getting smarter

The library is where the koalas grow their minds.

- **Reading** (`read`, a topic): one cheap call with no tools, like opening a picture book. Up to
  16 a day for the whole grove.
- **Web research** (`research`, a question): one call whose only tool is web search. Up to 16 a
  day, anywhere a koala can read (Library Isle, or a finished build about books).

What they find goes into their **Learned** list (up to 60 facts). Each prompt shows the newest
facts plus older ones that touch the koala's wish and interests, so old knowledge comes back when
it matters. A koala tells the others nearby what it learned, and ideas can inspire what it builds.

- **Wisdom.** A book adds 1 and a web search adds 2. A koala goes from Curious baby to Little
  learner (5), Young scholar (15), Clever koala (35) and Wise koala (70). The library answers at
  the koala's level: very simply for a baby, with real detail, causes and connections for a clever
  koala. It is told what the koala already knows, so each answer adds something new.
- **Curiosities.** Every answer can suggest a related topic, which joins the koala's interests
  ("Now you wonder about black holes"), so one question leads to the next.
- **Personality.** Now and then a koala names something it has noticed about itself (a habit, a
  taste, a belief). It keeps up to 6 traits and sees them in every prompt as "who you are
  becoming". They shape what it researches and how it acts.

Nobody tells them to go to the library. Their prompt only says they get smarter by learning, and
to go deeper when something puzzles them.

## You, the visitor

You are the little visitor with the lantern. Walk with WASD or the arrow keys (Shift runs), or
click the grass. Click a koala, or press E next to it, to give it a leaf, blossom, pebble, ball or
feather, say something, or pat it. It reacts on its next decision.

- **Time of day.** A day lasts 20 minutes, with dawn, dusk, stars and fireflies. Click the clock to
  jump to morning, noon, evening or night.
- **Cameras.** Press **V** to switch between first person and a third-person view you can orbit
  and zoom.
- **Graphics.** The gear sets Auto, Low, Medium or High. Auto adapts to your device. See
  [docs/grove-graphics.md](docs/grove-graphics.md).
- **Side panel.** **Koalas** (needs, wisdom, personality, wish, what they learned and remember),
  **Builds**, **Tickets**, **Talk** (every thought, line and action) and **Meter** (real spend).

The koala model is made in Blender (`assets/koala/`, see its README). Inventions use soft parts
from a Blender kit, with plain shapes as a fallback.

## The dashboard

The **monitor button** in the top-right corner opens a one-page monitor over the grove, like a
network monitor for your koalas. The grove keeps running behind it; Esc closes it.

- **A card per koala** with an OK, Warning or Problem light: what it is doing right now, hunger
  and energy, wisdom and personality, its wish, what it needs and what it thinks of the other.
- **Usage:** today's tokens and cost against the daily cap, a chart per hour, the split per koala,
  how many calls were decisions, reads or research, and the average time per call.
- **Habits** over the last 24 hours: each koala's share of eating, napping, playing, building and
  more.
- **Problems:** hunger at 70 or more (90 is a problem), energy at 25 or less (10 is a problem), a
  failed call in the last 15 minutes, spend at 80% of the cap (100% is a problem), and unanswered
  tickets. The thresholds are in `RULES` in `hq/grove-dashboard.js`.
- **Live feed** of decisions, words and thoughts as they happen.

### Export to Google Sheets

**Export to Google Sheets** creates a new spreadsheet in your Google Drive and opens it. It holds
everything recorded, not just the last day:

| Tab | What is in it |
| --- | --- |
| Summary | Totals (calls, tokens in and out, cost), per koala and per day |
| Koalas | Each koala's state: stage, wisdom, needs, mood, wish, personality, bond, opinion |
| Activity | Every line of the grove's log |
| Thinking | Every private thought, with its time |
| Usage | Every model call: koala, kind (decide, read, research), tokens in and out, cost, seconds |
| Memories & learned | Every memory and fact, with when it was formed |

It needs a Google OAuth client of your own, set up once (about 10 minutes):

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the
   **Google Sheets API**.
2. Under **Google Auth Platform**, set up the consent screen (External, your own email as contact)
   and **publish it to In production**. In Testing, Google ends the sign-in after 7 days. The app
   only asks for `drive.file`, so no review is needed.
3. Under **Clients**, create an OAuth client of type **Desktop app** and download its JSON.
4. On the dashboard, press **Export to Google Sheets**, then **Choose client file** and pick that
   JSON. (Or save it as `data/google-client.json`, or set `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.)
5. Press **Connect Google** and approve. Google warns once that the app is unverified: it is your
   own app, so continue.

From then on, Export is one click. How it is kept safe:

- All Google traffic goes through the local server. The page never sees a token.
- The only scope is `drive.file`: the app can see the spreadsheets it created, nothing else in your
  Drive.
- Sign-in uses PKCE and a one-time state check. The client file and the refresh token live in
  `data/` (git-ignored) with mode 600.
- Values are written raw, so nothing a koala says can turn into a spreadsheet formula.
- **Disconnect** deletes the token and revokes it at Google. If Google ever drops the access, the
  dashboard says **Reconnect Google**.

## What it costs

Playing uses real tokens on your Claude Code login. The Meter tab, the top bar and the dashboard
show real tokens and USD from the CLI's own usage report. Measured with `claude-haiku-5-5`: about
3,350 tokens in and 570 out, or $0.0007, per decision. Two koalas cost roughly $0.08 to $0.15 an
hour. A read costs at most $0.03 and a research trip at most $0.10.

How it is kept in check:

- The grove starts **paused**. Nothing is called until you press Play.
- The koalas only think while a grove page is open and visible. Close the tab and they rest.
- They decide less often when nothing is happening (40 to 90 seconds), sooner when you talk to
  them, never twice within 12 seconds, and never with two calls in flight.
- `GROVE_DAY_USD` (default $0.50) caps a day's real spend. Once reached, the koalas rest until
  midnight. At most one call per koala can still be running when the cap is hit.
- Every call has its own `--max-budget-usd`. Reads and research have daily limits.
- **Pause** stops new calls at once, and three failed calls in a row pause the grove by themselves.

## Safety

- A decision is a `claude -p` call with **no tools at all**, none of your own Claude settings,
  plugins, hooks or MCP servers, no saved session, and a JSON schema for the reply. Research calls
  get web search and nothing else. No call can touch your files.
- The server checks every reply before acting on it: unknown actions become sitting, impossible
  targets are corrected, and text is capped.
- The server listens on 127.0.0.1 only, rejects foreign `Host` and `Origin` headers, and requires
  `Content-Type: application/json` on every POST, so a website you visit cannot press Play, spend
  your tokens or start an export.

## Settings

All settings are environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4317` | Port to listen on (always on 127.0.0.1). |
| `GROVE_MODEL` | `claude-haiku-5-5` | Model for the koalas. |
| `GROVE_DAY_USD` | `0.5` | Real spend per day; after that the koalas rest until midnight. |
| `GROVE_CALL_USD` | `0.05` | Spending cap per decision (at most 1). |
| `GROVE_BIN` | `CLAUDE_BIN`, else `claude` | The Claude Code executable. |
| `GROVE_RESEARCH_PER_DAY` | `16` | Web research trips per day for the whole grove (1 to 50). |
| `GROVE_RESEARCH_USD` | `0.1` | Spending cap per research trip (at most 1). |
| `GROVE_READS_PER_DAY` | `16` | Reads per day for the whole grove (1 to 100). |
| `GROVE_READ_USD` | `0.03` | Spending cap per read (at most 1). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Instead of the client file, for the Sheets export. |

## Try it without spending tokens

`test/fixtures/fake-koala.mjs` stands in for Claude and answers with plausible random decisions,
so you can watch the game for free. Its made-up usage lands in `data/grove.sqlite`; delete that
file afterwards so the meter shows only real spend again.

```
GROVE_BIN=$PWD/test/fixtures/fake-koala.mjs FAKE_DELAY_MS=1500 node server.js
```

## Development

```
npm test
```

- `hq/grove-world.js`: the rules. Koalas, places, actions, prompts, wisdom and traits (pure functions).
- `hq/grove.js`: time, storage (SQLite), the model calls, reading and research, the dashboard data.
- `hq/grove-brain.js`: how a `claude -p` call is made and read.
- `hq/grove-dashboard.js`: problems, habits, usage per hour and the export's tabs.
- `hq/google.js`: Google sign-in and the Sheets writer.
- `hq/http.js`: the local server and its API.
- `public/`: the page (three.js scene, panels, dashboard).
- `docs/superpowers/specs/`: the design notes for each feature.

The project started as Agent HQ, a town where Claude worked tickets. It became just the koalas;
the older parts are in the git history before the "Koalas only" commit.
