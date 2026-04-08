export interface PriceCache {
  [ticker: string]: {
    price: number;
    currency: string;
    updatedAt: number;
  };
}

export interface PriceUpdateLog {
  holdingId: string;
  holdingName: string;
  oldValue: number;
  newValue: number;
  source: "auto" | "manual";
  timestamp: number;
}

const CACHE_KEY = "price_cache";
const LOG_KEY = "price_update_log";
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

export function getPriceCache(): PriceCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setPriceCache(cache: PriceCache): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function isCacheStale(ticker: string): boolean {
  const cache = getPriceCache();
  const entry = cache[ticker.toUpperCase()];
  if (!entry) return true;
  return Date.now() - entry.updatedAt > CACHE_DURATION;
}

export function anyCacheStale(tickers: string[]): boolean {
  return tickers.some((t) => isCacheStale(t));
}

export function getUpdateLog(): PriceUpdateLog[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addUpdateLog(entry: PriceUpdateLog): void {
  const log = getUpdateLog();
  log.unshift(entry); // newest first
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 100)));
}

export function deleteUpdateLogEntry(index: number): void {
  const log = getUpdateLog();
  log.splice(index, 1);
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

export function clearUpdateLogForHolding(holdingId: string): void {
  const log = getUpdateLog().filter((e) => e.holdingId !== holdingId);
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

export function canAutoUpdate(ticker: string): boolean {
  // Holdings with a non-empty ticker can be auto-updated
  return ticker.length > 0 && ticker !== "SUPER" && !ticker.startsWith("IFM-");
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
