// Crypto-scope performance derivation. The crypto investment pot is the set
// of NON-cash tokens: stablecoins are the cash layer, so buys of investment
// tokens are deposits from cash, sells are withdrawals to cash, and transfers
// (bot profits / yield / inter-exchange moves) are zero-flow — their value
// surfaces in the pot's growth, i.e. as return.
import type { CryptoTransaction } from "./types";
import { isStablecoin, computeHoldings, computeRealizedPnl } from "./crypto-csv";
import { xirr, type CashFlow, type DailyFlow, type HoldingPerfRow } from "./performance";

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

/**
 * Cached prices come from the cron's CoinGecko fetch, where a mis-mapped
 * coin id occasionally returns a DIFFERENT coin's price (observed: GRAM
 * briefly priced as TON, ~3.3x). If the cache disagrees with the user's
 * last TRADED price by more than 3x either way, trust the trade — a silent
 * 3x move between the last trade and now is far less likely than a bad id.
 */
function sanePrice(livePrice: number | undefined, lastTxPrice: number): number {
  if (livePrice == null) return lastTxPrice;
  if (lastTxPrice > 0) {
    const ratio = livePrice / lastTxPrice;
    if (ratio > 3 || ratio < 1 / 3) return lastTxPrice;
  }
  return livePrice;
}

/** Per-token performance rows for non-cash tokens, shaped like stock rows.
 * IMPORTANT: computeHoldings DROPS fully-sold tokens (|amount| < 0.0001), so
 * rows are built from the UNION of open holdings and tokens that appear in
 * computeRealizedPnl.byToken — exited positions keep their realized P&L row. */
export function perTokenStats(
  txs: CryptoTransaction[],
  livePrices: Record<string, number>,
  tickerMappings: Record<string, string>,
  isCash: (token: string) => boolean,
  todayIso: string,
): HoldingPerfRow[] {
  const holdings = computeHoldings(txs).filter((h) => !isCash(h.token));
  const holdingByToken = new Map(holdings.map((h) => [h.token, h]));
  const realizedByToken = new Map(
    computeRealizedPnl(txs).byToken.map((r) => [r.token, r.realizedPnlUsd]),
  );
  const tokens = [...new Set([...holdingByToken.keys(), ...realizedByToken.keys()])].filter(
    (t) => !isCash(t),
  );

  const rows: HoldingPerfRow[] = tokens.map((token) => {
    const h = holdingByToken.get(token);
    const own = txs.filter((t) => t.token === token);
    const livePrice = livePrices[token] ?? livePrices[tickerMappings[token] ?? token];
    const lastTxPrice = [...own].reverse().find((t) => t.priceUsd != null)?.priceUsd ?? 0;
    const price = sanePrice(livePrice, lastTxPrice);
    const closed = h == null || Math.abs(h.amount) < 1e-6;
    const valueUsd = closed ? 0 : h.amount * price;
    const grossBuysUsd = own
      .filter((t) => t.type === "buy" && t.totalValueUsd != null)
      .reduce((s, t) => s + (t.totalValueUsd as number), 0);
    // Cost-basis gain — unrealized (value − remaining avg-cost) + realized —
    // the SAME convention as the crypto page and external trackers, so the
    // per-token rows agree everywhere the user looks. Yield units carry cost
    // at the avg-buy price (invisible here; it surfaces in pot-level TWR).
    const realized = realizedByToken.get(token) ?? 0;
    const gainUsd = valueUsd - (h?.totalCostUsd ?? 0) + realized;
    const flows: CashFlow[] = own
      .filter(
        (t) =>
          (t.type === "buy" || t.type === "sell") &&
          t.totalValueUsd != null &&
          Number.isFinite(t.totalValueUsd),
      )
      .map((t) => ({
        date: t.date.slice(0, 10),
        amount: t.type === "buy" ? -(t.totalValueUsd as number) : (t.totalValueUsd as number),
      }));
    if (!closed && valueUsd > 0) flows.push({ date: todayIso, amount: valueUsd });
    return {
      holdingId: `crypto-${token}`,
      name: token,
      ticker: token,
      isOrphan: false,
      accountType: "normal" as const,
      investedUsd: h?.totalCostUsd ?? 0,
      valueUsd,
      gainUsd,
      returnPct: grossBuysUsd > 0 ? gainUsd / grossBuysUsd : null,
      xirrPct: xirr(flows),
      closed,
      badge: "CRYPTO",
    };
  });

  return rows.sort((a, b) => {
    if (a.xirrPct == null && b.xirrPct == null) return b.gainUsd - a.gainUsd;
    if (a.xirrPct == null) return 1;
    if (b.xirrPct == null) return -1;
    return b.xirrPct - a.xirrPct;
  });
}

/**
 * Onboarding guard for the crypto pot series. When tracking begins, the first
 * holdings uploads often cover only part of the stack, so the pot value jumps
 * violently once the full holdings appear — and pre-existing coins enter
 * without any logged buy. Two corrections:
 *
 * 1. TRIM leading days whose flow-adjusted next-day return exceeds +200%
 *    (only within the first 14 calendar days of the series — later spikes are
 *    real market moves and stay).
 * 2. OPENING DEPOSIT: the first trusted day's pot value counts as capital
 *    deposited that day; logged flows on or before that date are inside that
 *    value already and are replaced by it.
 */
export function bootstrapCryptoWindow(
  potValues: { date: string; value: number }[],
  flows: DailyFlow[],
): { values: { date: string; value: number }[]; flows: DailyFlow[] } {
  if (potValues.length === 0) return { values: [], flows: [] };

  const trimLimitDate = new Date(
    Date.parse(potValues[0].date + "T00:00:00Z") + 14 * 86400000,
  )
    .toISOString()
    .slice(0, 10);

  // Scan every consecutive pair inside the bootstrap window; the series is
  // trusted only AFTER the last violent unexplained jump (both days of a
  // partial-coverage stretch can look calm relative to each other).
  let start = 0;
  for (let i = 0; i < potValues.length - 1; i++) {
    const prev = potValues[i];
    if (prev.date > trimLimitDate) break;
    const next = potValues[i + 1];
    const flow = flows.reduce(
      (s, f) => (f.date > prev.date && f.date <= next.date ? s + f.amount : s),
      0,
    );
    const r = prev.value > 1e-9 ? (next.value - flow) / prev.value - 1 : 0;
    if (r > 2) start = i + 1;
  }

  const values = potValues.slice(start);
  const d0 = values[0];
  const laterFlows = flows.filter((f) => f.date > d0.date);
  return {
    values,
    flows: [{ date: d0.date, amount: d0.value }, ...laterFlows],
  };
}

/**
 * All-time crypto P&L in the crypto page's convention: unrealized
 * (live value − remaining avg-buy cost, via computeHoldings) + realized
 * (computeRealizedPnl), non-cash tokens only. This is the number that
 * matches the Crypto page and external trackers — use it for the crypto
 * scope's Net Gain tile so every surface agrees.
 */
export function cryptoAllTimePnl(
  txs: CryptoTransaction[],
  livePrices: Record<string, number>,
  tickerMappings: Record<string, string>,
  isCash: (token: string) => boolean,
): { unrealizedUsd: number; realizedUsd: number; totalUsd: number; costBasisUsd: number } {
  let unrealizedUsd = 0;
  let costBasisUsd = 0;
  for (const h of computeHoldings(txs)) {
    if (isCash(h.token)) continue;
    const livePrice = livePrices[h.token] ?? livePrices[tickerMappings[h.token] ?? h.token];
    const lastTxPrice =
      [...txs].reverse().find((t) => t.token === h.token && t.priceUsd != null)?.priceUsd ?? 0;
    const price = sanePrice(livePrice, lastTxPrice);
    unrealizedUsd += h.amount * price - h.totalCostUsd;
    costBasisUsd += h.totalCostUsd;
  }
  const realizedUsd = computeRealizedPnl(txs).byToken.reduce(
    (s, r) => (isCash(r.token) ? s : s + r.realizedPnlUsd),
    0,
  );
  return { unrealizedUsd, realizedUsd, totalUsd: unrealizedUsd + realizedUsd, costBasisUsd };
}
