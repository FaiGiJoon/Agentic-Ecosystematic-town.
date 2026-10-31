// The browser's line to the HQ server: the API calls and the live event stream.

async function request(url, opts) {
  const res = await fetch(url, opts);
  let body = {};
  try { body = await res.json(); } catch { /* no JSON body */ }
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

// The server rejects POSTs without a JSON content type, even body-less ones.
const post = (url, data = {}) => request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  state: () => request('/api/state'),
  ticket: (id) => request(`/api/tickets/${id}`),
  create: ({ title, body }) => post('/api/tickets', { title, body }),
  assign: (id) => post(`/api/tickets/${id}/assign`),
  retry: (id) => post(`/api/tickets/${id}/retry`),
  desk: () => request('/api/desk'),
  deskHalt: () => post('/api/desk/halt'),
  deskResume: () => post('/api/desk/resume'),
  deskOrder: (id, approve) => post(`/api/desk/orders/${id}/${approve ? 'approve' : 'reject'}`),
};

// EventSource reconnects by itself; every (re)connect reloads the full state.
// A dropped stream or a failed state load calls onOffline until the next good load.
export function connect({ onState, onTicket, onEvent, onAgent, onDesk, onOffline }) {
  const es = new EventSource('/api/events');
  es.addEventListener('error', () => onOffline?.());
  const on = (name, fn) => es.addEventListener(name, (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    fn?.(data);
  });
  es.addEventListener('open', () => {
    api.state().then((s) => onState?.(s), (err) => {
      console.warn('Could not load state:', err);
      onOffline?.();
    });
  });
  on('ticket', onTicket);
  on('event', onEvent);
  on('agent', onAgent);
  on('desk', onDesk);
  return es;
}
