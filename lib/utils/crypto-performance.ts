// Crypto-scope performance derivation. The crypto investment pot is the set
// of NON-cash tokens: stablecoins are the cash layer, so buys of investment
// tokens are deposits from cash, sells are withdrawals to cash, and transfers
// (bot profits / yield / inter-exchange moves) are zero-flow — their value
// surfaces in the pot's growth, i.e. as return.
import type { CryptoTransaction } from "./types";
import { isStablecoin } from "./crypto-csv";
import type { DailyFlow } from "./performance";

/** Dollar-pegged tokens the base classifier misses (yield-prefix exclusion
 * catches syrupUSDC; USDe/USDG/GUSD aren't in its name list). */
const PEGGED_EXTRAS = new Set(["USDE", "USDG", "GUSD", "SYRUPUSDC"]);

export function isCashLikeToken(
  token: string,
  stablecoinTags: Record<string, boolean>,
): boolean {
  if (stablecoinTags[token] === true) return true;
  if (PEGGED_EXTRAS.has(token.toUpperCase())) return true;
  return isStablecoin(token);
}

/** Net deposits (non-cash buys) − withdrawals (non-cash sells) per day, USD. */
export function cryptoNetFlowsByDay(
  txs: CryptoTransaction[],
  isCash: (token: string) => boolean,
): { flows: DailyFlow[]; skippedUnpriced: number } {
  const byDay = new Map<string, number>();
  let skippedUnpriced = 0;
  for (const t of txs) {
    if (t.type !== "buy" && t.type !== "sell") continue; // transfers = yield
    if (isCash(t.token)) continue; // cash management, not investment flow
    if (t.totalValueUsd == null || !Number.isFinite(t.totalValueUsd)) {
      skippedUnpriced++;
      continue;
    }
    const day = t.date.slice(0, 10);
    const signed = t.type === "buy" ? t.totalValueUsd : -t.totalValueUsd;
    byDay.set(day, (byDay.get(day) ?? 0) + signed);
  }
  const flows = [...byDay.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .filter((f) => f.amount !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { flows, skippedUnpriced };
}

/** Cumulative cash-token balance per day ($1 per unit), floored at 0. */
export function stableBalanceByDay(
  txs: CryptoTransaction[],
  isCash: (token: string) => boolean,
): { date: string; balance: number }[] {
  const deltaByDay = new Map<string, number>();
  for (const t of txs) {
    if (!isCash(t.token)) continue;
    const day = t.date.slice(0, 10);
    const sign = t.type === "buy" || t.type === "transferIn" ? 1 : -1;
    deltaByDay.set(day, (deltaByDay.get(day) ?? 0) + sign * t.amount);
  }
  const days = [...deltaByDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  let balance = 0;
  return days.map(([date, delta]) => {
    balance = Math.max(0, balance + delta);
    return { date, balance };
  });
}

/** Snapshot value minus forward-filled stable balance; non-positive days dropped. */
export function cryptoPotValues(
  snapshotValues: { date: string; value: number }[],
  stableBalance: { date: string; balance: number }[],
): { date: string; value: number }[] {
  let si = -1;
  let level = 0;
  const out: { date: string; value: number }[] = [];
  for (const s of snapshotValues) {
    while (si + 1 < stableBalance.length && stableBalance[si + 1].date <= s.date) {
      si++;
      level = stableBalance[si].balance;
    }
    const v = s.value - level;
    if (v > 0) out.push({ date: s.date, value: v });
  }
  return out;
}
