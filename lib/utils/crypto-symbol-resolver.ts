interface CoinListEntry {
  id: string;
  symbol: string;
  name: string;
}

interface CachedCoinList {
  coins: CoinListEntry[];
  fetchedAt: number;
}

const COIN_LIST_CACHE_KEY = "crypto_coin_list";
const COIN_LIST_TTL = 24 * 60 * 60 * 1000;

let inflight: Promise<CoinListEntry[]> | null = null;

function readCachedCoinList(): CoinListEntry[] | null {
  try {
    const raw = localStorage.getItem(COIN_LIST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCoinList;
    if (Date.now() - parsed.fetchedAt > COIN_LIST_TTL) return null;
    return parsed.coins;
  } catch {
    return null;
  }
}

function writeCachedCoinList(coins: CoinListEntry[]) {
  try {
    const payload: CachedCoinList = { coins, fetchedAt: Date.now() };
    localStorage.setItem(COIN_LIST_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

async function getCoinList(): Promise<CoinListEntry[]> {
  const cached = readCachedCoinList();
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/crypto/coin-list");
      if (!res.ok) return [];
      const data = (await res.json()) as { coins: CoinListEntry[] };
      const coins = data.coins ?? [];
      if (coins.length > 0) writeCachedCoinList(coins);
      return coins;
    } catch {
      return [];
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Pick the coin with the highest market cap from a set of candidates.
 * Uses CoinGecko's /coins/markets endpoint (batched by ids).
 */
async function pickByMarketCap(candidates: CoinListEntry[]): Promise<CoinListEntry | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  try {
    const ids = candidates.map((c) => c.id).join(",");
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&order=market_cap_desc&per_page=${candidates.length}&page=1&sparkline=false`;
    const res = await fetch(url);
    if (!res.ok) return candidates[0];
    const data = (await res.json()) as { id: string; market_cap: number | null }[];
    if (data.length === 0) return candidates[0];
    const top = data.find((d) => d.market_cap != null) ?? data[0];
    return candidates.find((c) => c.id === top.id) ?? candidates[0];
  } catch {
    return candidates[0];
  }
}

/**
 * Resolve a list of token names/symbols to their canonical uppercased
 * trading symbols. Ambiguous names are disambiguated by market cap.
 * Returns a map of input token → resolved symbol (omits unresolvable tokens).
 */
export async function resolveTokenSymbols(
  tokens: string[],
): Promise<Record<string, string>> {
  if (tokens.length === 0) return {};
  const coins = await getCoinList();
  if (coins.length === 0) return {};

  const byName = new Map<string, CoinListEntry[]>();
  const bySymbol = new Map<string, CoinListEntry[]>();
  for (const coin of coins) {
    const nameKey = normalize(coin.name);
    const symKey = coin.symbol.toUpperCase();
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey)!.push(coin);
    if (!bySymbol.has(symKey)) bySymbol.set(symKey, []);
    bySymbol.get(symKey)!.push(coin);
  }

  const result: Record<string, string> = {};
  const ambiguous: { token: string; candidates: CoinListEntry[] }[] = [];

  for (const token of tokens) {
    const nameKey = normalize(token);
    const symKey = token.trim().toUpperCase();

    // Exact symbol match takes priority (CSV already has "BTC")
    const symMatches = bySymbol.get(symKey) ?? [];
    if (symMatches.length === 1) {
      result[token] = symMatches[0].symbol;
      continue;
    }
    if (symMatches.length > 1) {
      ambiguous.push({ token, candidates: symMatches });
      continue;
    }

    const nameMatches = byName.get(nameKey) ?? [];
    if (nameMatches.length === 1) {
      result[token] = nameMatches[0].symbol;
      continue;
    }
    if (nameMatches.length > 1) {
      ambiguous.push({ token, candidates: nameMatches });
      continue;
    }
    // No match — leave unresolved
  }

  // Resolve ambiguous tokens by market cap (parallel calls per token)
  if (ambiguous.length > 0) {
    const picks = await Promise.all(
      ambiguous.map(async ({ token, candidates }) => {
        const winner = await pickByMarketCap(candidates);
        return { token, winner };
      }),
    );
    for (const { token, winner } of picks) {
      if (winner) result[token] = winner.symbol;
    }
  }

  return result;
}
