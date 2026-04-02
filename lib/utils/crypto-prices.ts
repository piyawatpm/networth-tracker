import type { CryptoHolding } from "./types";
import { COINGECKO_IDS } from "./constants";

const PRICE_CACHE_KEY = "crypto_prices";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface CachedPrices {
  prices: Record<string, number>; // token symbol → USD price
  fetchedAt: number;
}

export function getCachedCryptoPrices(): CachedPrices | null {
  try {
    const cached = localStorage.getItem(PRICE_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {
    // Invalid cache
  }
  return null;
}

export function isCryptoPricesCacheStale(): boolean {
  const cached = getCachedCryptoPrices();
  if (!cached) return true;
  return Date.now() - cached.fetchedAt > CACHE_DURATION;
}

export async function fetchCryptoPrices(
  tokens: string[],
): Promise<Record<string, number>> {
  // Build CoinGecko IDs list from token symbols
  const idMap: Record<string, string> = {}; // coingecko_id → token symbol
  for (const token of tokens) {
    if (token === "CASH") continue; // stablecoins are $1
    const geckoId = COINGECKO_IDS[token] ?? token.toLowerCase();
    idMap[geckoId] = token;
  }

  const ids = Object.keys(idMap);
  if (ids.length === 0) return {};

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    const data: Record<string, { usd?: number }> = await res.json();

    const prices: Record<string, number> = {};
    for (const [geckoId, priceData] of Object.entries(data)) {
      const token = idMap[geckoId];
      if (token && priceData.usd != null) {
        prices[token] = priceData.usd;
      }
    }

    // Cache result
    const cached: CachedPrices = { prices, fetchedAt: Date.now() };
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cached));

    return prices;
  } catch {
    // Return stale cache if available
    const cached = getCachedCryptoPrices();
    return cached?.prices ?? {};
  }
}

export function applyLivePrices(
  holdings: CryptoHolding[],
  prices: Record<string, number>,
): CryptoHolding[] {
  return holdings.map((h) => {
    if (h.token === "CASH") return h; // stablecoins stay at amount = value
    const livePrice = prices[h.token];
    if (livePrice == null) return h; // no price found, keep cost basis
    return {
      ...h,
      currentValueUsd: livePrice * h.amount,
    };
  });
}
