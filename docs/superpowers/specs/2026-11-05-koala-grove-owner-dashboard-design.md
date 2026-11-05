# Koala Grove: the owner dashboard and Google Sheets export

## Why

The owner wants an overview like a network monitor (Zabbix, PRTG) for the koalas. At a glance it should show what each
koala is doing now, what its habits are, how many tokens it uses, and whether it needs something. The owner also wants
a single button that exports all of the agents' data to Google Sheets: actions, thinking, and token usage. The point is
to watch two AI agents over time, and to keep the raw record somewhere the owner can sort, chart and keep.

The owner picked layout A, the one-page wall, and asked for it "with just a bit more data". They also picked a direct
export into Google Sheets over a file they would import themselves, which accepts a one-time Google setup.

## Goals

- **A dashboard button in the top corner of the game screen.** It opens the dashboard as a full overlay above the
  grove. The game keeps running behind it.
- **One page, with everything at a glance (layout A):**
  - **Status card per koala** (one per koala, including babies): an OK, Warning or Problem light; what it is doing now
    and whether a model call is running; hunger and energy bars; mood; its current wish; what it needs or wants.
  - **Usage:** today's tokens in and out, and cost against the daily cap (`GROVE_DAY_USD`). A small chart of tokens per
    hour over the last 24 hours. A per-koala split. Average call duration.
  - **Habits (24 h):** each koala's share of actions (explore, eat, talk, nap, build, read, ...) over the last 24 hours.
  - **Problems:** active warnings, newest first (rules below).
  - **Live feed:** the latest decisions as they happen, each with the koala's thought.
  - **The "bit more data":** memories, what each koala has learned (reading and research), how the koalas get on with
    each other (bond and opinion), and recent errors.
- **"Export to Google Sheets" on the dashboard.** One click creates a new spreadsheet in the owner's Google Drive and
  opens it in a new tab. It holds all recorded data, not just the recent window.
- **Live updates** over the existing event stream. Nothing needs a manual refresh.

## Non-goals

- No access for anyone other than the owner. The server is localhost-only and stays that way.
- No keeping a sheet in sync continuously. Each export is a fresh snapshot.
- No Google Docs export. The owner settled on Sheets.
- No raw transcripts of the model's own hidden reasoning. "Thinking" means the koala's `thought` field from each
  decision, which is what the koalas already record.
- No new npm dependencies (the project has none). Google is called with plain `fetch` against its REST APIs.

## Anti-goals (would count as failure even if it works)

- The Google token leaking: into the page, the git repo, the logs, or a shared sheet.
- The dashboard slowing the game down, or pausing the koalas.
- A cluttered, enterprise-looking screen. It should read like a simple monitor, with large status lights, a few
  numbers and a feed.
- Asking Google for broad access to the owner's Drive.

## What exists today (facts from the code)

- `hq/grove.js` keeps everything in SQLite (`node:sqlite`, under `data/`, which is git-ignored):
  - `grove_log(ts, koala, kind, text, action, target)`. The kinds include `think` (the decision's thought), `error`,
    `learn`, `ticket`, `visitor`, `grow` and `system`, plus the entries `applyDecision` returns for actions.
  - `grove_usage(ts, koala, ok, cost_usd, tokens_in, tokens_out, duration_ms)`, one row per model call (decide, read,
    research), filled from the `claude -p --output-format json` result.
  - `grove_koalas(id, data)`: each koala's full state as JSON (hunger, energy, mood, memories, bond, opinion, wish,
    learned facts, ...). Hunger runs from 0 (full) to 100 (starving).
- `grove.state()` already returns usage sums for today and all time, plus the last 40 or so log rows. The page's Meter
  tab (`public/js/ui.js` `drawMeter`) shows a simple version of the usage.
- `hq/http.js` serves `/api/*` and an SSE stream (`/api/events`), and rejects foreign origins and non-JSON posts. The
  page's Content-Security-Policy allows only the CDN for three.js.

## Decisions taken

- **Layout A** (one-page wall). Owner's choice.
- **Opened from a button in the top corner of the HUD.** Owner's choice. *My call:* top-right, beside the settings gear,
  with a monitor or chart icon. It opens a full-screen overlay that Esc closes.
- **Direct export to Google Sheets.** Owner's choice, accepting a one-time setup.
- **My call: all Google traffic goes through the server.** The browser never talks to Google, so the CSP stays the
  same and the token never reaches the page.
- **My call: OAuth 2.0 with a "Desktop app" client** created by the owner in Google Cloud Console. Loopback redirect to
  `http://127.0.0.1:4317/api/google/callback`, with PKCE and a `state` check. Scope `https://www.googleapis.com/auth/drive.file`
  only, which covers just the files this app creates. The Sheets API must be enabled on that project.
- **My call: where secrets live.** The client ID and secret go in `data/google-client.json`, the JSON Google offers for
  download (or the env vars `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`). The refresh token goes in
  `data/google-token.json`, written with mode 0600. Both are under the git-ignored `data/`. A "Disconnect Google" link
  deletes the token.
- **My call: built on `feat/library-life`** (PR #6), since wishes and learned facts come from there. The work is on
  branch `feat/owner-dashboard`, not on the unfinished `feat/bigger-world`.

## The spreadsheet (my call on the layout)

A new spreadsheet named `Koala Grove export YYYY-MM-DD HH:MM`, with these tabs:

1. **Summary:** export time, model, totals (calls, tokens in and out, cost), totals per koala, and per-day totals.
2. **Koalas:** one row per koala (name, age or stage, hunger, energy, mood, wish, bond, opinion, counts of memories and
   learned facts).
3. **Activity:** every `grove_log` row (time, koala, kind, action, target, text).
4. **Thinking:** the `think` rows on their own (time, koala, thought), since that is the part the owner most wants to read.
5. **Usage:** every `grove_usage` row (time, koala, call kind, ok, tokens in, tokens out, cost, seconds).
6. **Memories & learned:** one row per memory or learned fact, per koala.

Times are written in local time as real sheet dates. Header rows are frozen and bold. Rows are written in batches
(Sheets `values:batchUpdate` / `append`), so a large log does not hit the request size limits.

## Problem rules (my call on the defaults, all in one place so they are easy to tune)

- Warning when hunger ≥ 70. Problem when hunger ≥ 90.
- Warning when energy ≤ 25. Problem when energy ≤ 10.
- Problem when a model call failed in the last 15 minutes (from `error` log rows or `grove_usage.ok = 0`).
- Warning when today's spend reaches 80 % of the daily cap. Problem at 100 % (the koalas stop deciding).
- Warning when a koala has an open ticket with no reply ("needs something from you").
- A koala's light shows its worst active problem.

## Data needed that does not exist yet

- **The call kind per usage row** (decide, read or research). Add a nullable `kind` column to `grove_usage` with a
  migration that leaves old rows empty.
- **The full history of memories.** Each koala keeps only a rolling, capped list (`learned` is cut to the last 8,
  `memories` to `MAX_MEMORIES`), so old memories are lost. *My call:* from now on, each new memory is also written to
  `grove_log` as kind `remember`. The "Memories & learned" tab then holds the full history: `learn` and `remember`
  log rows, plus whatever the koalas hold now that predates the change, marked "(held now, date unknown)".
- Everything else (habits, tokens per hour, per-koala splits) is computed from the existing tables by a new
  `GET /api/dashboard`, so `grove.state()`, which is broadcast every tick, does not grow.

## Setup the owner does once (it goes in the README)

1. In Google Cloud Console: create a project, enable the **Google Sheets API**, set up the OAuth consent screen
   (External), **publish it to "In production"**, and create an **OAuth client ID** of type **Desktop app**.
   *My call:* production rather than Testing, because Google expires Testing refresh tokens after 7 days. `drive.file`
   is a non-sensitive scope, so publishing needs no review. The owner sees an "unverified app" warning once and clicks
   through it. The builder still handles an expired or revoked token (`invalid_grant`): the dashboard shows
   "Reconnect Google", and the export button says so instead of failing.
2. Download its JSON to `data/google-client.json`.
3. On the dashboard, click **Connect Google** and approve. From then on, **Export to Google Sheets** works with one click.

When nothing is set up, the export button explains these steps instead of failing.

## Left to the builder

- Visual details: the exact icon, colours (match the existing HUD and `grove.css`), and the chart drawing (plain SVG or
  canvas, no libraries).
- How the live feed and status cards subscribe to the SSE stream, and how often `/api/dashboard` refetches its heavier
  numbers (about every 30 s is fine).
- Error copy and empty states (no calls yet, Google not connected, export failed halfway).
- Tests: follow the existing `node --test` setup. Cover the problem rules, the dashboard aggregates, the export row
  building (with Google calls mocked), and the OAuth state and PKCE handling.
