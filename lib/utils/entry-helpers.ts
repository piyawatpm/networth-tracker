import type { Currency } from "./types";

/** Sum entries' amounts, converting each to the target currency */
export function sumConverted<T extends { amount: number; currency: Currency }>(
  entries: T[],
  convert: (amount: number, from: string) => number,
): number {
  return entries.reduce((acc, e) => acc + convert(e.amount, e.currency), 0);
}

/** Filter entries whose date falls within [from, to] */
export function filterByDateRange<T extends { date: string }>(
  entries: T[],
  range: { from: string; to: string },
): T[] {
  return entries.filter((e) => e.date >= range.from && e.date <= range.to);
}

/** Hash a string to a stable integer (for fallback color assignment) */
export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** Advance a YYYY-MM-DD date string by one day */
export function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
