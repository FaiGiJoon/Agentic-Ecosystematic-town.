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

## Tests

```
npm test
```

## Credits

The town engine, sprites and font are copied from the FaiGiJoon.github.io portfolio. The map
data comes from Pokemon Crystal via the pret/pokecrystal disassembly. Pokemon is a trademark of
Nintendo, Game Freak and Creatures; this is a personal, non-commercial project.
