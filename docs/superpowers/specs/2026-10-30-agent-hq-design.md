# Agent HQ — design

Date: 2026-10-30. Status: approved in brainstorming, awaiting spec review.

## Goal

A fun, local-only dashboard on Casper's MacBook: the walkable Goldenrod City from the portfolio,
where an AI agent works on tickets and you watch it work in town. Not part of the public website;
it lives in `~/agent-hq`, its own git repo, and the portfolio repo (`~/FaiGiJoon.github.io`) stays
untouched.

Done for v1:

- `node server.js` starts a server on `127.0.0.1` that serves the town and a small API.
- In town you can create a ticket, assign it to Claude, and read its status, history and output.
- The Claude agent picks up the ticket, works on it via the Claude Code CLI, and its result is
  written back to the ticket and to the Obsidian vault.
- While it works, the Claude character's position, bubble and the ticker show live state.
- A README explains how to run it.

Out of scope for v1 (decided): Perplexity agent, an Obsidian "archivist" agent, handoffs between
agents, a side panel outside the canvas, sound, multiple tickets in parallel.

## Decisions

| Question | Decision |
| --- | --- |
| Where tickets live | SQLite (`node:sqlite`, built into Node 26) is the source of truth; finished tickets are exported as a Markdown note in the vault |
| How Claude runs | `claude -p` (Claude Code CLI, existing login, no API key), headless, `stream-json` output |
| Agents in v1 | Claude only |
| Where the board lives | Only in town (no side panel) |
| What Claude may touch | Read/write its own per-ticket folder, read-only vault, web search/fetch, no shell |

## Architecture

Zero dependencies: no `npm install`. Plain `node:http` serves files and a JSON API; live updates go
to the page over Server-Sent Events (SSE); the browser sends commands as small POST requests.

```
~/agent-hq/
  server.js            HTTP server, static files, API, SSE; wires store + runner + export
  hq/store.js          SQLite tickets + events (no HTTP, testable)
  hq/runner.js         spawns claude -p per ticket, parses stream-json, timeout, queue
  hq/vault.js          writes the finished-ticket note into the vault
  hq/activity.js       maps runner events to agent state: step label for bubble/ticker
  public/index.html    host page (canvas + new-ticket box)
  public/town/         copied engine.js, render.js, font.js, town.css, data/goldenrod.json
  public/town/main.js  adapted from the portfolio: HQ buildings, Claude actor, SSE client
  public/town/content.js  HQ text: buildings, signs, NPCs
  test/*.test.mjs      node --test
  data/hq.sqlite       created on first run (gitignored)
  work/<id>/           Claude's per-ticket folder (gitignored)
```

Config by environment variable, with defaults: `PORT` (4317), `VAULT`
(`~/Documents/Obsidian Vault`), `CLAUDE_BIN` (`claude`), `TICKET_TIMEOUT_MS` (600000),
`MAX_BUDGET_USD` (1).

The server binds to `127.0.0.1` only and rejects requests whose `Host` header isn't
`127.0.0.1:<port>` or `localhost:<port>` (guards against DNS rebinding).

### Copied from the portfolio

From `~/FaiGiJoon.github.io/town/`: `engine.js`, `render.js`, `font.js`, `town.css`,
`data/goldenrod.json` and the engine tests. `main.js` and `content.js` are copied and adapted.
The Gym and Fan Club maps, the GitHub projects page, and the sound engine (lives in
`red-battle/`) are not copied.

## Data

`tickets`: `id` (integer), `title`, `body`, `assignee` (`'claude'` or null), `status`
(`open | queued | working | done | failed`), `output` (text), `note_path` (vault note, once
written), `created_at`, `updated_at`.

`events`: `id`, `ticket_id`, `at`, `kind` (`created | assigned | started | step | done | failed |
reset`), `text`. This is the ticket history, and every inserted event is also pushed over SSE.

## API

- `GET /api/state` → `{ tickets, agent }`: all tickets (newest first) and the agent state.
- `GET /api/tickets/:id` → ticket plus its events.
- `POST /api/tickets` `{ title, body }` → new ticket (status `open`).
- `POST /api/tickets/:id/assign` → assignee `claude`, status `queued`; the runner picks it up.
- `POST /api/tickets/:id/retry` → a failed ticket goes back to `queued`.
- `GET /api/events` → SSE stream: `ticket` (changed ticket), `event` (history row), `agent`
  (agent state: `{ status: idle|working, ticket, step }`).

Bodies are JSON, capped at 16 KB; title is required (max 80 chars).

## Runner

One ticket at a time, oldest queued first. For a ticket it:

1. Creates `work/<id>/`, sets status `working`, emits `started`.
2. Spawns, with `cwd = work/<id>/`:

   ```
   claude -p <prompt> --output-format stream-json --verbose
     --allowedTools Read Glob Grep WebSearch WebFetch Write Edit
     --disallowedTools Bash "Write(<vault>/**)" "Edit(<vault>/**)"
     --add-dir <vault>
     --permission-mode dontAsk
     --max-budget-usd <MAX_BUDGET_USD>
   ```

   The prompt holds the ticket title and body, says the vault is read-only reference material,
   and asks Claude to end with its final answer as plain Markdown. No shell; Write/Edit only reach
   the work folder because the vault is explicitly denied. If `--permission-mode dontAsk` is not
   accepted by the installed CLI version, the implementation uses the closest non-interactive mode
   that still denies anything outside the allowlist, and the README says which.
3. Reads stdout line by line as JSON. `assistant` messages with `tool_use` become `step` events
   (`READ`, `WEB`, `WRITE`, `SEARCH` from the tool name, plus a short detail like the file name or
   query); text blocks become `THINK`. The final `result` message gives the output.
4. Exit code 0 with a `result` → status `done`, `output` saved, vault note written, `done` event.
   Anything else (spawn error, `claude` missing, not logged in, non-zero exit, `is_error`
   result) → status `failed` with the last stderr lines in a `failed` event.
5. A timeout (`TICKET_TIMEOUT_MS`) kills the process and fails the ticket ("timed out").

On server start, tickets left `working` go back to `queued` with a `reset` event.

## Vault export

On `done`, the server (not Claude) writes `00-inbox/agent-hq-<id>-<slug>.md`, following the
vault's CLAUDE.md: YAML frontmatter (`type: note`, `status: active`, `tags: [agent-hq]`,
`created`/`updated` dates, `source: agent-hq #<id>`), no emojis, a `# <title>` heading, the
request, then the output. An existing file with that name is never overwritten (a `-2` suffix
is added). The path goes into `note_path`.

## The town

All portfolio text is gone; the intro says "Welcome to AGENT HQ". Doors other than the two below
say "CLOSED. Nobody works here yet."

- **Pokémon Center = TICKET BOARD.** A Game Boy page lists the tickets (`#3 OPEN title`).
  Menu: NEW TICKET, then one item per ticket. A ticket page shows title, status, assignee,
  request, history (newest last) and output; menu: ASSIGN TO CLAUDE (when open), RETRY (when
  failed), BACK. The page updates live while it is open.
- **New ticket box:** an HTML overlay over the canvas styled as the Game Boy text box (same font,
  palette and border). Step 1 title (one line), step 2 details (multi-line). Enter goes on/saves,
  Shift+Enter is a newline in details, Esc cancels. While it is open, game keys are ignored.
- **Radio Tower = CLAUDE'S DESK.** Talking at its door shows the current step.

### The Claude character

An NPC named CLAUDE (a distinct sprite) driven by agent state, not by random wandering:

- idle: wanders near the Pokémon Center.
- ticket started: walks to the Pokémon Center door, then to the Radio Tower door, and stands
  there facing it.
- each `step`: a small bubble above its head shows the label (`...` for THINK, `READ`, `WEB`,
  `WRITE`, `SEARCH`) for a few seconds.
- done or failed: walks back to the Pokémon Center door, shows `!` (done) or `?` (failed), then
  idles.

Walking uses the engine's tile collision with a simple path search (BFS) on the town grid.
Talking to Claude: idle → "No tickets for me. Add one at the POKéMON CENTER!"; working →
"Working on #3: <title>. Now: <step detail>".

A ticker line at the top of the canvas shows `CLAUDE  #3  WEB SEARCH` (or `CLAUDE  IDLE`).

### Live updates

The page opens `EventSource('/api/events')`. On (re)connect it fetches `/api/state` in full;
afterwards it applies `ticket`, `event` and `agent` messages. The browser reconnects by itself.

## Error handling

| Case | Behaviour |
| --- | --- |
| `claude` not found / not logged in / non-zero exit | Ticket `failed`, stderr tail in history, Claude shows `?` and says it couldn't finish |
| Timeout | Process killed, ticket `failed` ("timed out after 10 min") |
| Server restart mid-ticket | Ticket back to `queued` with a `reset` event, picked up again |
| Vault folder missing or not writable | Ticket still `done`; a history event says the note couldn't be written |
| SSE drops | Browser reconnects and reloads the full state |
| Bad API input | 400 with a short message; the new-ticket box shows it |

## Testing

`node --test test/`:

- Copied engine tests (unchanged behaviour).
- `store`: create, assign, status changes, events, restart reset; in-memory SQLite.
- `runner`: a fake `claude` script (via `CLAUDE_BIN`) replays recorded stream-json for success,
  error result, non-zero exit and hang (timeout); asserts statuses, events and the exact CLI args
  (allowlist, vault denied, no Bash).
- `vault`: note format, slug, no-overwrite, into a temp folder.
- `activity`: tool names → step labels; agent state → Claude's target position and bubble.
- `path`: BFS between Pokémon Center and Radio Tower doors on the real map.

Then one manual end-to-end run with the real CLI: create a ticket in town, assign it, watch
Claude walk and work, read the output on the board and the note in `00-inbox/`.
