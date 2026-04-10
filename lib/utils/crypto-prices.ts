import type { CryptoHolding } from "./types";
import { STABLECOINS } from "./constants";

const PRICE_CACHE_KEY = "crypto_prices";
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour (client-side re-fetch interval)

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

/**
 * Fetch crypto prices from Binance API.
 * Tokens that Binance doesn't have fall back to CoinGecko via server API.
 * Falls back to stale cache if all fetches fail.
 */
export async function fetchCryptoPrices(
  tokens: string[],
): Promise<Record<string, number>> {
  // Filter out stablecoins
  const toFetch = tokens.filter((t) => {
    const upper = t.toUpperCase();
    return !STABLECOINS.has(upper) && upper !== "STABLECOIN" && upper !== "CASH";
  });

  if (toFetch.length === 0) return {};

  try {
    // Step 1: Fetch from Binance in parallel
    const results = await Promise.all(
      toFetch.map(async (token) => {
        const symbol = `${token.toUpperCase()}USDT`;
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
          );
          if (!res.ok) return { token, price: null };
          const data = await res.json();
          return { token, price: parseFloat(data.price) };
        } catch {
          return { token, price: null };
        }
      }),
    );

    const prices: Record<string, number> = {};
    const failedTokens: string[] = [];
    for (const r of results) {
      if (r.price !== null && !isNaN(r.price)) {
        prices[r.token] = r.price;
      } else {
        failedTokens.push(r.token);
      }
    }

    // Step 2: CoinGecko fallback for tokens Binance doesn't have
    if (failedTokens.length > 0) {
      try {
        const res = await fetch("/api/crypto-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokens: failedTokens }),
        });
        if (res.ok) {
          const data = await res.json();
          for (const [token, price] of Object.entries(data.prices)) {
            prices[token] = price as number;
          }
        }
      } catch {
        // CoinGecko fallback failed — continue with Binance prices only
      }
    }

    // Cache result
    if (Object.keys(prices).length > 0) {
      const cached: CachedPrices = { prices, fetchedAt: Date.now() };
      try {
        localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cached));
      } catch {
        // localStorage not available
      }
    }

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
    if (h.token === "Stablecoin" || STABLECOINS.has(h.token.toUpperCase())) return h;
    const livePrice = prices[h.token];
    if (livePrice == null) return h;
    return {
      ...h,
      currentValueUsd: livePrice * h.amount,
    };
  });
}
