# Agent HQ

A small, local-only dashboard on your own Mac. It is a walkable Game Boy town (Goldenrod City)
where you hand tickets to a Claude agent and watch it work. It is not the portfolio site: it
only runs on 127.0.0.1 and nothing is deployed anywhere.

You file a ticket at the ticket board, assign it to Claude, and Claude walks to its desk and
works on it by running the Claude Code CLI in the background. When it finishes, the answer shows
on the board and a note is saved in your Obsidian vault inbox.

## Requirements

- Node 26 or newer. There are no npm dependencies.
- The Claude Code CLI (`claude`) installed and already logged in. Agent HQ uses your existing
  login, not an API key.

## Run it

```
node server.js        # or: npm start
```

Then open http://127.0.0.1:4317 (http://localhost:4317 also works).

### Start at login

```
scripts/install-autostart.sh
```

This installs a macOS LaunchAgent (`~/Library/LaunchAgents/com.agent-hq.server.plist`) that starts
the server when you log in and restarts it if it crashes, and adds `~/Applications/Agent HQ.app`,
which opens the dashboard (drag it to the Dock). Server output goes to `logs/server.log`. Run the
script again after moving the repo or changing Node versions. While it runs, `node server.js` by
hand reports that the port is already in use.

To undo it (tickets in `data/` are kept):

```
scripts/uninstall-autostart.sh
```

## Controls

- Walk: arrow keys or WASD, or click where to go.
- Run: hold Space (clicking to walk also runs).
- Talk, open doors, confirm: Z or Enter.
- Back, cancel: X or Esc.

## Using the board

1. Walk into the Pokemon Center door: the ticket board opens.
2. Choose NEW TICKET. Type a title and press Enter, then type the details (Shift+Enter for a
   new line) and press Enter to save. Esc cancels. While the box is open, game keys are ignored.
3. Open the ticket from the list and choose ASSIGN TO CLAUDE.
4. Claude walks from the Pokemon Center door to the Radio Tower door (its desk) and stands
   there. A small bubble over its head shows what it is doing: `...` (thinking), READ, WEB,
   SEARCH or WRITE. The ticker at the top shows the same, for example `CLAUDE  #3  WEB SEARCH`.
5. When it is done, Claude walks back and shows `!` (done) or `?` (failed). Open the ticket on
   the board to read the output. A failed ticket has a RETRY item.
6. Once a run ends (done or failed), the ticket page shows its usage, for example
   `USAGE: 0.41 USD  52K IN  3.1K OUT  23S`: cost, input tokens (including cached context),
   output tokens and run time, as reported by Claude Code. Tickets from before this was added
   have no usage line.

Talking to Claude, or at the Radio Tower door, shows what it is working on (or, after a
failure, which ticket to RETRY). If the live connection to the server drops, the ticker shows
`AGENT HQ  OFFLINE` until it comes back.
Only one ticket runs at a time; assigned tickets wait in a queue.

## The 3D district

Click **3D DISTRICT** in the top right (or open http://127.0.0.1:4317/district/) for a 3D view
of the same HQ, with a whole simulated town around it.

What is real, from the HQ server:

- **Claude** (orange, with a spinning star) follows the same phases as in Goldenrod: from its
  home at the **Vault Library** to the **Ticket Board** to pick up a ticket, to its desk at the
  **Agent Hub** while it works (bubbles show READ, WEB, SEARCH, WRITE), and back to the board
  with `!` or `?`.
- The **Tickets** tab files, assigns and retries real tickets, and shows each one's output,
  usage and the name of the note it was saved as in your Obsidian `00-inbox/`.
- The **Agent Hub** tab starts with real Claude Code spend: tokens, USD and run time over all
  finished tickets.
- The **Vault Library** shelf gets a book for every ticket whose answer was saved to the vault.

What is simulated, and labelled so (nothing in it calls a model or spends money):

- 13 town agents: builders who build voxel buildings block by block, traders, a Mayor who files
  town tickets, an auditor, the Hub keeper and a gossip. They talk to each other, and their
  token counts are estimates that never mix with Claude's real usage.
- The **Exchange**: three made-up coins and play-money credits. You can trade or back a trader
  agent's fund. No wallet, exchange or chain is involved.
- The town's gossip does pick up real news ("Claude finished #3 ...").

three.js 0.160.0 loads from cdn.jsdelivr.net, so the district needs internet; the page's own
Content-Security-Policy allows only that host and a hash of its import map. Goldenrod City is
unchanged and still loads nothing from outside except its font.

## The paper desk: can the traders make money?

The top of the district's **Exchange** tab is a live paper desk. The server fetches real BTC,
ETH and SOL prices from Kraken's public ticker once a minute (read-only market data: no account,
no key) and five trader agents trade them with $1,000 of paper money each:

| Trader | Strategy |
| --- | --- |
| Moonshot | random big bets |
| Ledger Lou | momentum: buys when the 10-minute average crosses above the 30-minute one, sells on the way down |
| Mean Mabel | mean reversion: buys 1% under the 30-minute average, sells half 1% over |
| Diamond Hans | buys $100 every 30 minutes, never sells |
| Spready | small trades on every 0.3% wiggle |
| Buy & Hold | the benchmark: splits $1,000 over the three coins once, then does nothing |

Fills are realistic: buys at the real ask, sells at the real bid, and every fill pays the
exchange fee (0.4%, Kraken's lowest tier). The board shows each trader's return and whether it
is beating or behind Buy & Hold. If a trader can't beat doing nothing after fees over weeks,
it would not make money with real money either.

The same guards that a real-money version would need already sit in front of every order:

- a cap per trade (`DESK_MAX_TRADE_USD`) and per trader per day (`DESK_MAX_DAY_USD`),
- a total loss limit (`DESK_MAX_LOSS_PCT`) that stops all trading when the traders together
  are down that far, and stops it again on resume while they still are,
- **Stop all trading**, a kill switch in the Exchange tab that also cancels pending orders,
- with `DESK_APPROVAL=on`, every order waits for you to approve it (and expires after 5 minutes);
  guards run again, against the price at that moment, when you approve.

State lives in `data/desk.sqlite` (git-ignored) and survives restarts. Claude's tickets have no
access to the desk, and there is deliberately no real-money broker: `#fill` in `hq/desk.js` is
the one place one would plug in, behind the same guards.

## Koala Grove: two koalas that are real AI agents

Click **KOALA GROVE** in the top right of Goldenrod (or **Koala Grove** in the district's top
bar, or open http://127.0.0.1:4317/grove/). It is a small 3D game and an experiment: two koalas,
Mallee and Bramble, live on a floating eucalyptus island, and every move they make and every word
they say is a real model decision. Watch how two LLM agents get on when left to themselves.

- **Mallee** is young, bold and curious, collects shiny pebbles and wants to look brave.
  **Bramble** is older, gentle and sleepy, loves eucalyptus and naps, and is slow to trust.
- They eat at three gum trees, climb, nap in the mossy hollow, play on the rope swing, with the
  ball or in the pond, visit the lookout rock, talk, give each other things, and remember.
- Each decision is JSON: a private thought, an action and target, what they say out loud, a mood,
  something to remember, and how the moment changed their feelings about the other koala.
- Memory lives in `data/grove.sqlite` (git-ignored) and survives restarts: the last 10 things
  each koala noticed, up to 12 long-term memories it chose to keep, a bond score from -100 to 100,
  and a one-line opinion of its friend. All of it goes into the next prompt.
- Days run on a 20-minute clock with dawn, dusk, stars, fireflies and glowing mushrooms.

**You** are the little visitor with the lantern. Walk with WASD or the arrow keys (Shift runs), or
click the grass; drag to look around. Click a koala, or press E next to one, to open its card:
give it a leaf, blossom, pebble, ball or feather, say something (up to 140 characters), or pat
it. That costs nothing by itself; the koala reacts on its next decision. Press V to switch
between walking and just watching (click a koala to follow it).

Press **B** (or the Overview / Horizon button) to fly between the horizon view, with the sky, sun,
moon and stars, and a high overview where every landmark and both koalas are easy to see.

**Graphics.** The gear in the top bar opens the graphics settings: Auto, Low, Medium or High, and
a frame-rate readout. Auto starts from a tier that suits the device (phones start one lower), and
lowers the resolution and then the effects if frames get slow, and brings them back after a long
calm stretch. The sky, forest, fur and water are described in
[docs/grove-graphics.md](docs/grove-graphics.md), with the measurements and the known limits.

The side panel has **Koalas** (mood, hunger, energy, bond, opinion, memories), **Talk** (every
thought, line and action) and **Meter**.

### What it costs, and how it is kept in check

Playing uses real tokens on your Claude Code login, so the **Meter** tab and the top bar show
real tokens and USD per koala, today and all time, from the CLI's own `result` usage (the same
numbers as a ticket's usage line, kept apart from the district's simulated estimates). Measured
on 2026-10-31 with `claude-haiku-5-5`: about 2,600 to 3,300 tokens in and $0.0007 per decision,
so roughly $0.10 to $0.15 an hour with both koalas awake.

- The grove starts **paused**. Nothing is called until you press **Play** (or "Wake the koalas").
- Even when playing, the koalas only think while a grove page is open and visible: the page
  checks in every 15 seconds, and 45 seconds without a check-in stops the calls. Close the tab
  and they rest.
- Each koala decides every 20 to 60 seconds, sooner (6 to 12 seconds) when spoken to or given
  something, never twice within 12 seconds, and never with two calls in flight.
- **Pause** stops new calls at once. Three failed calls in a row pause the grove by themselves.
- `GROVE_DAY_USD` (default $0.50) caps today's real spend; once reached, the koalas rest until
  midnight. A call already running when the cap is hit still finishes, so the total can go over
  by at most one call per koala.
- `GROVE_CALL_USD` is passed to `--max-budget-usd` for every call.

Each decision is one `claude -p` call, isolated like the ticket runner but with **no tools at
all**: `--tools ""`, `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`,
`--permission-mode dontAsk` and `--no-session-persistence`, with `--system-prompt` set to the
koala's persona (which also leaves out Claude Code's own long system prompt), `--model
claude-haiku-5-5`, and `--json-schema` for the reply. The server checks every reply again before
acting on it: unknown actions become sitting, impossible targets are corrected, text is capped.
What you type to a koala goes into its prompt, but a koala has nothing it could do with it
except talk back.

## Settings

All settings are environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4317` | Port to listen on (always on 127.0.0.1). |
| `VAULT` | `~/Documents/Obsidian Vault` | Obsidian vault; results are saved to its `00-inbox/`. Spaces are fine; the server refuses to start if the path contains `* ? [ ] ! \ # ( )`, which have special meaning in Claude permission rules. A symlinked vault is resolved to its real path. |
| `CLAUDE_BIN` | `claude` | The Claude Code executable. |
| `TICKET_TIMEOUT_MS` | `600000` | A ticket that runs longer than this (10 minutes) is stopped and fails. |
| `MAX_BUDGET_USD` | `1` | Spending cap per ticket, passed to `--max-budget-usd`. |
| `DESK` | on | `off` turns the paper desk off, including its price requests to Kraken. |
| `DESK_POLL_MS` | `60000` | How often prices are fetched and the traders decide. |
| `DESK_FEE` | `0.004` | Fee per fill (0.4%). |
| `DESK_START_USD` | `1000` | Paper dollars each trader starts with. |
| `DESK_MAX_TRADE_USD` | `250` | Largest single order; bigger ones are capped. |
| `DESK_MAX_DAY_USD` | `2000` | Most a trader may trade per day. |
| `DESK_MAX_LOSS_PCT` | `25` | All trading stops when the traders together are down this far. |
| `DESK_APPROVAL` | off | `on` makes every order wait for your approval. |
| `GROVE` | on | `off` turns Koala Grove off. |
| `GROVE_MODEL` | `claude-haiku-5-5` | Model for the koalas' decisions. |
| `GROVE_DAY_USD` | `0.5` | Real spend per day after which the koalas stop thinking until midnight. |
| `GROVE_CALL_USD` | `0.05` | Spending cap per decision, passed to `--max-budget-usd` (at most 1). |
| `GROVE_BIN` | `CLAUDE_BIN` | The executable the koalas call, if it should differ from the tickets'. |

Note on the budget: the run does not load your plugins, so a small ticket costs well under
the default `MAX_BUDGET_USD` of 1 (the sandbox probe runs cost about $0.08 to $0.09 each).

## What Claude may touch

Claude runs as `claude -p` with `--permission-mode dontAsk`: anything not explicitly allowed is
denied without a prompt. The run is isolated from your own Claude setup with
`--setting-sources ""` and `--strict-mcp-config`, so your user and project settings, plugins,
hooks and MCP servers cannot add permissions or tools. This also means settings such as your
chosen model are ignored: the run uses the Claude Code default model (verified on CLI 2.1.314).

- Tools: only Read, Glob, Grep, WebSearch, WebFetch, Write and Edit exist in the session
  (`--tools`). Bash is not available at all, and is also on the deny list.
- Read, Glob and Grep work in Claude's own folder, `work/<ticket id>/` inside this project
  (git-ignored), and in the vault. Anywhere else on the Mac they are denied.
- Write and Edit work only in Claude's own folder. They are denied in the vault (explicit
  deny rules, which win over everything) and everywhere else.
- WebSearch and WebFetch are allowed.
- The server, not Claude, writes the result note into the vault.

Permission rules use `//` for absolute paths (`Write(//Users/you/Documents/Obsidian Vault/**)`);
a single `/` would be read relative to the project and match nothing, which is why an earlier
version did not hold. This was checked with live probes on Claude Code 2.1.314 (2026-10-30), on
a temp vault whose name has a space. Denied: Read, Glob and Grep on a folder outside both;
Write and Edit in the vault (also through a `../` path); Write outside both folders. Allowed:
Read, Glob (`*.md` in `00-inbox/`) and Grep in the vault; Glob, Grep and Write in the work folder.

What is still up to you: Claude can read the whole vault and can use the web, so content from a
fetched page could ask it to send vault text out in a WebFetch URL. Do not give it tickets that
fetch untrusted pages if your vault holds secrets.

The server itself binds to 127.0.0.1 only, rejects any request with a foreign `Host` or
`Origin` header, and requires `Content-Type: application/json` on API writes, so a web page
you happen to visit cannot create or assign tickets.

## Where results go

- The ticket output is shown on the board and stored in `data/hq.sqlite` (git-ignored).
- A note is written to `<vault>/00-inbox/agent-hq-<id>-<slug>.md` with YAML frontmatter
  (`source: "agent-hq #<id>"`, created and updated dates), the title, the request and the
  output. An existing file is never overwritten.

## Try it without spending tokens

`test/fixtures/fake-claude.mjs` stands in for the CLI. `FAKE_MODE` is one of `ok`, `error`,
`noise`, `hang` or `budget`, and `FAKE_DELAY_MS` slows it down (about 8000 lets you watch Claude
stand at its desk). Use a temporary vault so your real one is untouched:

```
mkdir -p /tmp/demo-vault/00-inbox
CLAUDE_BIN=$PWD/test/fixtures/fake-claude.mjs FAKE_MODE=ok FAKE_DELAY_MS=8000 \
  VAULT=/tmp/demo-vault node server.js
```

For the grove, `test/fixtures/fake-koala.mjs` plays a koala: it answers with plausible random
decisions (`FAKE_MODE` `ok`, `text`, `garbage`, `error`, `budget` or `hang`), so you can watch the
game with the meter counting made-up usage. Its usage then lands in `data/grove.sqlite`; delete
that file afterwards so the meter shows only real spend again.

```
GROVE_BIN=$PWD/test/fixtures/fake-koala.mjs FAKE_DELAY_MS=1500 node server.js
```

## Tests

```
npm test
```

## Credits

The town engine, sprites and font are copied from the FaiGiJoon.github.io portfolio. The map
data comes from Pokemon Crystal via the pret/pokecrystal disassembly. Pokemon is a trademark of
Nintendo, Game Freak and Creatures; this is a personal, non-commercial project.
