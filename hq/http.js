import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StoreError } from './store.js';

const MAX_BODY = 16 * 1024;
const PING_MS = 25000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        failed = true;
        chunks.length = 0;
        reject(new HttpError(413, 'request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      if (size === 0) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('not an object');
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, 'body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

export function createApp({ store, runner, desk = null, config, publicDir }) {
  const root = path.resolve(publicDir);
  const clients = new Set();

  function broadcast(name, data) {
    const frame = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  }
  store.onChange((msg) => broadcast(msg.type, msg.type === 'ticket' ? msg.ticket : msg.event));
  runner.onAgent((agent) => broadcast('agent', agent));
  desk?.onChange((state) => broadcast('desk', state));

  function sse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    const timer = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.on('close', () => {
      clearInterval(timer);
      clients.delete(res);
    });
  }

  async function api(req, res, pathname) {
    const method = req.method;
    if (method !== 'GET' && method !== 'HEAD') {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') throw new HttpError(415, 'content-type must be application/json');
    }
    if (pathname === '/api/state' && method === 'GET') {
      return sendJson(res, 200, { tickets: store.list(), agent: runner.agent });
    }
    if (pathname === '/api/events' && method === 'GET') return sse(req, res);
    if (pathname === '/api/tickets' && method === 'POST') {
      const { title, body } = await readJson(req);
      return sendJson(res, 201, store.create({ title, body }));
    }
    if (pathname === '/api/desk' || pathname.startsWith('/api/desk/')) return deskApi(req, res, pathname);
    const m = /^\/api\/tickets\/(\d+)(?:\/(assign|retry))?$/.exec(pathname);
    if (m) {
      const id = Number(m[1]);
      const action = m[2];
      if (!action && method === 'GET') {
        const ticket = store.get(id);
        if (!ticket) throw new StoreError(404, 'ticket not found');
        return sendJson(res, 200, { ...ticket, events: store.events(id) });
      }
      if (action && method === 'POST') {
        const ticket = action === 'assign' ? store.assign(id) : store.retry(id);
        runner.kick();
        return sendJson(res, 200, ticket);
      }
    }
    throw new HttpError(404, 'not found');
  }

  // The paper desk: state, kill switch, and approving or rejecting pending orders.
  function deskApi(req, res, pathname) {
    if (!desk) throw new HttpError(404, 'the paper desk is off (DESK=off)');
    const method = req.method;
    if (pathname === '/api/desk' && method === 'GET') return sendJson(res, 200, desk.state());
    if (pathname === '/api/desk/halt' && method === 'POST') return sendJson(res, 200, desk.halt('kill switch'));
    if (pathname === '/api/desk/resume' && method === 'POST') return sendJson(res, 200, desk.resume());
    const m = /^\/api\/desk\/orders\/(\d+)\/(approve|reject)$/.exec(pathname);
    if (m && method === 'POST') {
      try {
        return sendJson(res, 200, desk.decideOrder(Number(m[1]), m[2] === 'approve'));
      } catch (err) {
        if (err.status) throw new HttpError(err.status, err.message);
        throw err;
      }
    }
    throw new HttpError(404, 'not found');
  }

  async function serveStatic(req, res, rawPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    let rel;
    try { rel = decodeURIComponent(rawPath); } catch { throw new HttpError(404, 'not found'); }
    if (rel.includes('\0')) throw new HttpError(404, 'not found');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + path.sep + rel);
    if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(404, 'not found');
    let data;
    try {
      const [real, realRoot] = await Promise.all([fs.realpath(file), fs.realpath(root)]);
      if (!real.startsWith(realRoot + path.sep)) throw new Error('outside');
      data = await fs.readFile(real);
    } catch {
      throw new HttpError(404, 'not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const { port } = server.address();
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
        throw new HttpError(403, 'forbidden host');
      }
      const { origin } = req.headers;
      if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
        throw new HttpError(403, 'forbidden origin');
      }
      const rawPath = (req.url || '/').split('?')[0].split('#')[0];
      if (rawPath === '/api' || rawPath.startsWith('/api/')) await api(req, res, rawPath);
      else await serveStatic(req, res, rawPath);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof StoreError || err instanceof HttpError) {
        if (err.status === 413) res.setHeader('Connection', 'close');
        return sendJson(res, err.status, { error: err.message });
      }
      console.error('request failed:', err);
      sendJson(res, 500, { error: 'internal error' });
    }
  });
  return server;
}
