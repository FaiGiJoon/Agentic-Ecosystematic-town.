// Live prices for the paper desk from Kraken's public ticker. No account, no key:
// this endpoint only reads market data.

export const COINS = [
  { sym: 'BTC', pair: 'XBTUSD', key: 'XXBTZUSD', name: 'Bitcoin' },
  { sym: 'ETH', pair: 'ETHUSD', key: 'XETHZUSD', name: 'Ether' },
  { sym: 'SOL', pair: 'SOLUSD', key: 'SOLUSD', name: 'Solana' },
];

const URL = `https://api.kraken.com/0/public/Ticker?pair=${COINS.map((c) => c.pair).join(',')}`;

// Kraken's ticker JSON -> { BTC: { bid, ask, last }, ... }. Throws on anything odd,
// so a bad response never turns into a trade at a made-up price.
export function parseTicker(json) {
  if (!json || typeof json !== 'object') throw new Error('price feed: not JSON');
  if (Array.isArray(json.error) && json.error.length) throw new Error(`price feed: ${json.error.join('; ')}`);
  const out = {};
  for (const c of COINS) {
    const t = json.result?.[c.key];
    const bid = Number(t?.b?.[0]);
    const ask = Number(t?.a?.[0]);
    const last = Number(t?.c?.[0]);
    if (!(bid > 0 && ask > 0 && last > 0 && ask >= bid)) throw new Error(`price feed: bad quote for ${c.sym}`);
    out[c.sym] = { bid, ask, last };
  }
  return out;
}

export async function fetchPrices({ timeoutMs = 10000 } = {}) {
  const res = await fetch(URL, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`price feed: HTTP ${res.status}`);
  return parseTicker(await res.json());
}
