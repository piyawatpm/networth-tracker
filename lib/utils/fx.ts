import type { CachedRates } from "./types";
import { getCurrencySymbol } from "./types";

type Currency = string;

const FX_CACHE_KEY = "fx_rates_cache";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const FX_API_URL = "https://open.er-api.com/v6/latest/USD";

export async function fetchFxRates(): Promise<CachedRates | null> {
  // Check cache first
  try {
    const cached = localStorage.getItem(FX_CACHE_KEY);
    if (cached) {
      const parsed: CachedRates = JSON.parse(cached);
      if (Date.now() - parsed.fetchedAt < CACHE_DURATION) {
        return parsed;
      }
    }
  } catch {
    // Cache miss or invalid
  }

  // Fetch fresh
  try {
    const res = await fetch(FX_API_URL);
    if (!res.ok) throw new Error("FX fetch failed");
    const data = await res.json();
    const cached: CachedRates = {
      rates: data.rates,
      fetchedAt: Date.now(),
    };
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify(cached));
    return cached;
  } catch {
    // Return stale cache if available
    try {
      const cached = localStorage.getItem(FX_CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch {
      // Nothing
    }
    return null;
  }
}

export function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency,
  rates: Record<string, number> | null
): number {
  if (from === to || !rates) return amount;
  // Rates are relative to USD
  const fromRate = rates[from] ?? 1;
  const toRate = rates[to] ?? 1;
  return (amount / fromRate) * toRate;
}

export function formatCurrency(
  amount: number,
  currency: Currency,
  compact = false
): string {
  const symbol = getCurrencySymbol(currency);
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (compact && abs >= 1_000_000) {
    return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (compact && abs >= 1_000) {
    return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`;
  }

  return `${sign}${symbol}${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

