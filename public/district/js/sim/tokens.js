// Token accounting for the Agent Hub. Every message, thought and ticket an
// agent produces is charged here, per agent and per model.

// USD per million tokens (Claude API list prices, Oct 2026).
export const MODELS = {
  'claude-haiku-5-5': { label: 'Haiku 5.5', in: 0.1, out: 0.5, color: '#5ec8a8' },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', in: 2, out: 10, color: '#6c9cf0' },
  'claude-opus-5-5': { label: 'Opus 5.5', in: 4, out: 20, color: '#c48af0' },
};

export const estimateTokens = (text) => Math.max(1, Math.ceil(String(text).length / 4));

export class TokenLedger {
  constructor(bus) {
    this.bus = bus;
    this.total = { in: 0, out: 0, cost: 0, calls: 0 };
    this.byModel = Object.fromEntries(Object.keys(MODELS).map((m) => [m, { in: 0, out: 0, cost: 0 }]));
    this.byReason = {};
    this.history = []; // tokens per sample window, for the sparkline
    this.window = 0;
  }

  charge(agent, { input = 0, output = 0, reason = 'chat' }) {
    const m = MODELS[agent.model];
    const cost = (input * m.in + output * m.out) / 1e6;
    agent.tokens.in += input;
    agent.tokens.out += output;
    agent.tokens.cost += cost;
    agent.tokens.today += input + output;
    agent.tokens.calls += 1;
    this.total.in += input;
    this.total.out += output;
    this.total.cost += cost;
    this.total.calls += 1;
    const bm = this.byModel[agent.model];
    bm.in += input;
    bm.out += output;
    bm.cost += cost;
    this.byReason[reason] = (this.byReason[reason] ?? 0) + input + output;
    this.window += input + output;
    this.bus.emit('tokens', { agent, input, output, cost, reason });
    if (agent.tokens.today > agent.budget && !agent.throttled) {
      agent.throttled = true;
      this.bus.emit('throttled', { agent });
    }
    return cost;
  }

  // Called once per sample period by the world clock.
  sample() {
    this.history.push(this.window);
    if (this.history.length > 120) this.history.shift();
    this.window = 0;
  }

  resetDay(agents) {
    for (const a of agents) {
      a.tokens.today = 0;
      if (a.throttled) {
        a.throttled = false;
        this.bus.emit('unthrottled', { agent: a });
      }
    }
  }
}
