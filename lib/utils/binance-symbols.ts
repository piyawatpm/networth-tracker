const SYMBOLS_CACHE_KEY = "binance_symbols";
const SYMBOLS_TTL = 24 * 60 * 60 * 1000;

interface CachedSymbols {
  symbols: string[];
  fetchedAt: number;
}

let inflight: Promise<Set<string> | null> | null = null;

function readCachedSymbols(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SYMBOLS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSymbols;
    if (Date.now() - parsed.fetchedAt > SYMBOLS_TTL) return null;
    return new Set(parsed.symbols);
  } catch {
    return null;
  }
}

function writeCachedSymbols(symbols: string[]) {
  try {
    const payload: CachedSymbols = { symbols, fetchedAt: Date.now() };
    localStorage.setItem(SYMBOLS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

/**
 * Fetch the set of symbols listed on Binance (e.g. "BTCUSDT"), cached 24h.
 * Used to route live-price subscriptions: symbols Binance lists go to its
 * WebSocket, the rest fall through to Gate.io.
 * Returns null if the list can't be fetched (caller keeps everything on
 * Binance — the pre-Gate behavior).
 */
export async function getBinanceSymbolSet(): Promise<Set<string> | null> {
  const cached = readCachedSymbols();
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("https://api.binance.com/api/v3/ticker/price");
      if (!res.ok) return null;
      const data = (await res.json()) as { symbol: string }[];
      if (!Array.isArray(data) || data.length === 0) return null;
      const symbols = data.map((d) => d.symbol);
      writeCachedSymbols(symbols);
      return new Set(symbols);
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
