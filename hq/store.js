import { DatabaseSync } from 'node:sqlite';

export class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'StoreError';
    this.status = status;
  }
}

const STATUSES = ['open', 'queued', 'working', 'done', 'failed'];
const KINDS = ['created', 'assigned', 'started', 'step', 'done', 'failed', 'reset'];
const USAGE_COLUMNS = [['cost_usd', 'REAL'], ['tokens_in', 'INTEGER'], ['tokens_out', 'INTEGER'], ['duration_ms', 'INTEGER']];

export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.listeners = [];
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        assignee TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        output TEXT,
        note_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS events_ticket ON events(ticket_id, id);
    `);
    // Usage columns came later; add them to databases made before.
    const cols = new Set(this.db.prepare('PRAGMA table_info(tickets)').all().map((c) => c.name));
    for (const [name, type] of USAGE_COLUMNS) {
      if (!cols.has(name)) this.db.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${type}`);
    }
    const p = (sql) => this.db.prepare(sql);
    this.q = {
      insert: p('INSERT INTO tickets (title, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
      get: p('SELECT * FROM tickets WHERE id = ?'),
      list: p('SELECT * FROM tickets ORDER BY id DESC'),
      events: p('SELECT * FROM events WHERE ticket_id = ? ORDER BY id ASC'),
      getEvent: p('SELECT * FROM events WHERE id = ?'),
      addEvent: p('INSERT INTO events (ticket_id, at, kind, text) VALUES (?, ?, ?, ?)'),
      assign: p("UPDATE tickets SET assignee = 'claude', status = 'queued', updated_at = ? WHERE id = ?"),
      status: p('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?'),
      output: p('UPDATE tickets SET output = ? WHERE id = ?'),
      notePath: p('UPDATE tickets SET note_path = ? WHERE id = ?'),
      usage: p('UPDATE tickets SET cost_usd = ?, tokens_in = ?, tokens_out = ?, duration_ms = ? WHERE id = ?'),
      nextQueued: p("SELECT * FROM tickets WHERE status = 'queued' ORDER BY id ASC LIMIT 1"),
      working: p("SELECT id FROM tickets WHERE status = 'working' ORDER BY id ASC"),
    };
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  #depth = 0;
  #pending = [];

  // Run fn in a transaction; listeners are notified only after commit.
  #tx(fn) {
    if (this.#depth > 0) return fn();
    this.db.exec('BEGIN');
    this.#depth = 1;
    let result;
    try {
      result = fn();
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      this.#depth = 0;
      this.#pending = [];
      throw err;
    }
    this.#depth = 0;
    const msgs = this.#pending;
    this.#pending = [];
    for (const m of msgs) this.#dispatch(m);
    return result;
  }

  #emit(msg) {
    if (this.#depth > 0) this.#pending.push(msg);
    else this.#dispatch(msg);
  }

  #dispatch(msg) {
    for (const fn of this.listeners) {
      try { fn(msg); } catch (err) { console.error('store listener failed:', err); }
    }
  }

  #now() {
    return new Date().toISOString();
  }

  #require(id) {
    const t = this.get(id);
    if (!t) throw new StoreError(404, 'ticket not found');
    return t;
  }

  #emitTicket(id) {
    const ticket = this.get(id);
    this.#emit({ type: 'ticket', ticket });
    return ticket;
  }

  create({ title, body = '' } = {}) {
    return this.#tx(() => {
      const t = typeof title === 'string' ? title.trim() : '';
      if (!t) throw new StoreError(400, 'title is required');
      if (t.length > 80) throw new StoreError(400, 'title must be 80 characters or fewer');
      if (body != null && typeof body !== 'string') throw new StoreError(400, 'body must be text');
      const now = this.#now();
      const { lastInsertRowid } = this.q.insert.run(t, body ?? '', 'open', now, now);
      const id = Number(lastInsertRowid);
      this.addEvent(id, 'created');
      return this.#emitTicket(id);
    });
  }

  get(id) {
    return this.q.get.get(id) ?? null;
  }

  list() {
    return this.q.list.all();
  }

  events(id) {
    return this.q.events.all(id);
  }

  assign(id) {
    return this.#tx(() => {
      const t = this.#require(id);
      if (t.status !== 'open') throw new StoreError(409, `cannot assign a ${t.status} ticket`);
      this.q.assign.run(this.#now(), id);
      this.addEvent(id, 'assigned');
      return this.#emitTicket(id);
    });
  }

  retry(id) {
    return this.#tx(() => {
      const t = this.#require(id);
      if (t.status !== 'failed') throw new StoreError(409, `cannot retry a ${t.status} ticket`);
      this.q.status.run('queued', this.#now(), id);
      this.addEvent(id, 'assigned', 'retry');
      return this.#emitTicket(id);
    });
  }

  setStatus(id, status, fields = {}) {
    return this.#tx(() => {
      if (!STATUSES.includes(status)) throw new StoreError(400, 'invalid status');
      this.#require(id);
      this.q.status.run(status, this.#now(), id);
      if (fields.output !== undefined) this.q.output.run(fields.output, id);
      if (fields.note_path !== undefined) this.q.notePath.run(fields.note_path, id);
      if (fields.usage) {
        const u = fields.usage;
        this.q.usage.run(u.cost_usd ?? null, u.tokens_in ?? null, u.tokens_out ?? null, u.duration_ms ?? null, id);
      }
      return this.#emitTicket(id);
    });
  }

  addEvent(id, kind, text = '') {
    return this.#tx(() => {
      if (!KINDS.includes(kind)) throw new StoreError(400, 'invalid event kind');
      this.#require(id);
      const { lastInsertRowid } = this.q.addEvent.run(id, this.#now(), kind, String(text));
      const event = this.q.getEvent.get(Number(lastInsertRowid));
      this.#emit({ type: 'event', event });
      return event;
    });
  }

  nextQueued() {
    return this.q.nextQueued.get() ?? null;
  }

  resetWorking() {
    return this.#tx(() => {
      const out = [];
      for (const { id } of this.q.working.all()) {
        this.q.status.run('queued', this.#now(), id);
        this.addEvent(id, 'reset');
        out.push(this.#emitTicket(id));
      }
      return out;
    });
  }
}
