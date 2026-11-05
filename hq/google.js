// Google Sheets export for the owner's dashboard. All Google traffic goes through the server:
// the page never sees a token. OAuth 2.0 for a "Desktop app" client, loopback redirect, PKCE,
// a one-time state, and only the drive.file scope (the files this app creates, nothing else).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const STATE_MS = 10 * 60000;
const CHUNK_ROWS = 5000;

export class GoogleError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code; // 'not_configured', 'not_connected', 'reconnect'
  }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The client from data/google-client.json (Google's own download, { installed: {...} }) or the env.
export function loadClient(dataDir, env = process.env) {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'google-client.json'), 'utf8'));
    const c = raw.installed ?? raw.web ?? raw;
    if (typeof c.client_id === 'string' && typeof c.client_secret === 'string') return { id: c.client_id, secret: c.client_secret };
  } catch { /* not set up */ }
  return null;
}

export class Google {
  #pending = new Map(); // state -> { verifier, redirect, at }

  constructor({ dataDir, fetch: f = globalThis.fetch, now = Date.now, env = process.env }) {
    this.dataDir = dataDir;
    this.fetch = f;
    this.now = now;
    this.env = env;
    this.tokenFile = path.join(dataDir, 'google-token.json');
  }

  get client() { return loadClient(this.dataDir, this.env); }

  #token() {
    try {
      const t = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
      return typeof t.refresh_token === 'string' ? t : null;
    } catch { return null; }
  }

  #saveToken(t) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.tokenFile, JSON.stringify(t), { mode: 0o600 });
    fs.chmodSync(this.tokenFile, 0o600);
  }

  status() {
    const t = this.#token();
    return { configured: !!this.client, connected: !!t, needsReconnect: !!t?.invalid };
  }

  // Where to send the owner's browser to approve; remembers the state and PKCE verifier.
  authUrl(redirect) {
    const c = this.client;
    if (!c) throw new GoogleError(409, 'Google is not set up yet: put your OAuth client in data/google-client.json', 'not_configured');
    for (const [s, p] of this.#pending) if (this.now() - p.at > STATE_MS) this.#pending.delete(s);
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    this.#pending.set(state, { verifier, redirect, at: this.now() });
    const q = new URLSearchParams({
      client_id: c.id, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
      state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
    });
    return `${AUTH_URL}?${q}`;
  }

  // Google sent the browser back: check the state (once), trade the code for tokens, keep the refresh token.
  async callback({ code, state, error }) {
    const p = typeof state === 'string' ? this.#pending.get(state) : null;
    if (p) this.#pending.delete(state);
    if (!p || this.now() - p.at > STATE_MS) throw new GoogleError(400, 'This sign-in link has expired or was not started here. Try Connect Google again.');
    if (error) throw new GoogleError(400, `Google said: ${error}`);
    if (typeof code !== 'string' || !code) throw new GoogleError(400, 'Google sent no code back.');
    const c = this.client;
    if (!c) throw new GoogleError(409, 'Google is not set up.', 'not_configured');
    const body = await this.#form(TOKEN_URL, {
      code, client_id: c.id, client_secret: c.secret, redirect_uri: p.redirect, grant_type: 'authorization_code', code_verifier: p.verifier,
    });
    if (!body.refresh_token) throw new GoogleError(502, 'Google gave no refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
    this.#saveToken({ refresh_token: body.refresh_token, scope: body.scope ?? SCOPE, at: this.now() });
    this.access = { token: body.access_token, until: this.now() + (body.expires_in ?? 3600) * 1000 - 60000 };
  }

  async disconnect() {
    const t = this.#token();
    this.access = null;
    try { fs.rmSync(this.tokenFile, { force: true }); } catch { /* gone already */ }
    if (t) await this.#form(REVOKE_URL, { token: t.refresh_token }).catch(() => {});
  }

  async #form(url, data) {
    const res = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new GoogleError(502, `Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`);
      err.google = body.error;
      throw err;
    }
    return body;
  }

  async #accessToken() {
    if (this.access && this.now() < this.access.until) return this.access.token;
    const c = this.client;
    if (!c) throw new GoogleError(409, 'Google is not set up yet.', 'not_configured');
    const t = this.#token();
    if (!t) throw new GoogleError(409, 'Connect Google first.', 'not_connected');
    if (t.invalid) throw new GoogleError(409, 'Google access expired or was removed. Reconnect Google.', 'reconnect');
    try {
      const body = await this.#form(TOKEN_URL, { client_id: c.id, client_secret: c.secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' });
      this.access = { token: body.access_token, until: this.now() + (body.expires_in ?? 3600) * 1000 - 60000 };
      return this.access.token;
    } catch (err) {
      if (err.google === 'invalid_grant') {
        this.#saveToken({ ...t, invalid: true });
        throw new GoogleError(409, 'Google access expired or was removed. Reconnect Google.', 'reconnect');
      }
      throw err;
    }
  }

  async #api(url, method, data) {
    const token = await this.#accessToken();
    const res = await this.fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new GoogleError(502, `Google Sheets said: ${body.error?.message ?? res.status}`);
    return body;
  }

  // One new spreadsheet with a tab per entry: { title, header, rows, dateCols, dateCells }.
  async createSpreadsheet(title, tabs) {
    const sheet = await this.#api(SHEETS_URL, 'POST', {
      properties: { title },
      sheets: tabs.map((t, i) => ({ properties: { sheetId: i + 1, title: t.title, index: i, gridProperties: { frozenRowCount: 1, rowCount: Math.max(2, t.rows.length + 1), columnCount: Math.max(1, t.header.length, ...t.rows.map((r) => r.length)) } } })),
    });
    const id = sheet.spreadsheetId;
    const quote = (t) => `'${t.replace(/'/g, "''")}'`;
    // values in chunks, RAW so nothing the koalas wrote is ever read as a formula
    for (const t of tabs) {
      const all = [t.header, ...t.rows];
      for (let start = 0; start < all.length; start += CHUNK_ROWS) {
        await this.#api(`${SHEETS_URL}/${id}/values:batchUpdate`, 'POST', {
          valueInputOption: 'RAW',
          data: [{ range: `${quote(t.title)}!A${start + 1}`, values: all.slice(start, start + CHUNK_ROWS) }],
        });
      }
    }
    const requests = [];
    tabs.forEach((t, i) => {
      const sheetId = i + 1;
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
      for (const col of t.dateCols ?? []) {
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' } } }, fields: 'userEnteredFormat.numberFormat' } });
      }
      for (const [row, col] of t.dateCells ?? []) {
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: row + 1, endRowIndex: row + 2, startColumnIndex: col, endColumnIndex: col + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' } } }, fields: 'userEnteredFormat.numberFormat' } });
      }
      requests.push({ autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: Math.min(t.header.length, 6) } } });
    });
    await this.#api(`${SHEETS_URL}/${id}:batchUpdate`, 'POST', { requests });
    return { id, url: sheet.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit` };
  }
}
