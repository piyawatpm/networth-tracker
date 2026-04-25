// lib/utils/analytics-backfill.ts
//
// Pure helpers for the "all-time baseline from first snapshot" feature.
// No Supabase / fetch / Node APIs — everything here is a plain function so
// it can be unit-reasoned and tested via route-level integration.
//
// See docs/superpowers/specs/2026-04-25-analytics-all-time-backfill-design.md

import type {
  AnalyticsBaseline,
  CryptoDeposit,
  PortfolioTransaction,
} from "./types";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  /** "YYYY-MM-DD HH:MM" (Sydney local, as written by cron) or "YYYY-MM-DD". */
  date: string;
  /** Portfolio: no-super USD. Crypto: total USD. */
  value: number;
  /** Portfolio-only: total including super. */
  valueWithSuper?: number;
}

export interface BenchmarkBar {
  /** "YYYY-MM-DD". */
  date: string;
  /** Close price in USD. */
  close: number;
}

export interface PerfBackfillRow {
  /** ISO timestamp at noon UTC for the day (sortable daily anchor). */
  timestamp: string;
  portfolioUsd: number;
  cryptoUsd: number;
  combinedUsd: number;
  depositsUsd: number;
  spyPriceUsd: number | null;
  btcPriceUsd: number | null;
  portfolioPct: number | null;
  spyPct: number | null;
  btcPct: number | null;
}

// ---------------------------------------------------------------------------
// 1. Anchor date
// ---------------------------------------------------------------------------

/**
 * Pick the earliest Sydney date present in either snapshot stream.
 * Returns null only when both streams are empty.
 */
export function deriveAnchorDate(
  portfolioSnapshots: SnapshotRow[],
  cryptoSnapshots: SnapshotRow[],
): string | null {
  const days: string[] = [];
  for (const r of portfolioSnapshots) days.push(r.date.slice(0, 10));
  for (const r of cryptoSnapshots) days.push(r.date.slice(0, 10));
  if (days.length === 0) return null;
  days.sort();
  return days[0];
}

// ---------------------------------------------------------------------------
// 2. Anchor-day totals (last tick of `anchorDate`, per stream)
// ---------------------------------------------------------------------------

/**
 * For each stream, pick the LAST snapshot whose date == anchorDate (matching
 * dailyCombinedUsd's lastByDay). A stream with no snapshot on the anchor day
 * contributes 0 — it simply wasn't being tracked yet. Portfolio uses
 * `valueWithSuper ?? value`; crypto uses `value`.
 */
export function anchorTotalsFromSnapshots(params: {
  portfolioSnapshots: SnapshotRow[];
  cryptoSnapshots: SnapshotRow[];
  anchorDate: string;
}): { portfolioUsd: number; cryptoUsd: number; combinedUsd: number } {
  const { portfolioSnapshots, cryptoSnapshots, anchorDate } = params;

  // Last-tick-on-anchor-day per stream. Matches dailyCombinedUsd's lastByDay
  // semantics so the anchor-day row computes a true 0% for portfolioPct.
  // Stream with no snapshot on anchorDate contributes 0 — that stream simply
  // hadn't started being tracked yet on the anchor day.
  const pickOnDay = (rows: SnapshotRow[], useSuper: boolean): number => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    let result = 0;
    for (const r of sorted) {
      if (r.date.slice(0, 10) === anchorDate) {
        result = useSuper ? (r.valueWithSuper ?? r.value) : r.value;
      }
    }
    return result;
  };

  const portfolioUsd = pickOnDay(portfolioSnapshots, true);
  const cryptoUsd = pickOnDay(cryptoSnapshots, false);
  return { portfolioUsd, cryptoUsd, combinedUsd: portfolioUsd + cryptoUsd };
}

// ---------------------------------------------------------------------------
// 3. Build baseline payload (stores zeros for per-holding; deposits path
//    on the client reconstructs PnL correctly — see design doc § "Key insight")
// ---------------------------------------------------------------------------

export function buildBaselineFromSnapshots(params: {
  anchorDate: string;
  totals: { portfolioUsd: number; cryptoUsd: number; combinedUsd: number };
  btcClose: number;
  spyClose: number;
}): AnalyticsBaseline {
  const { anchorDate, totals, btcClose, spyClose } = params;
  return {
    date: anchorDate,
    createdAt: Date.now(),
    portfolio: {},
    crypto: {},
    benchmarks: { spy: spyClose, btc: btcClose },
    totals,
  };
}

// ---------------------------------------------------------------------------
// 4. Daily combined map (per-day last-tick, portfolio + crypto)
// ---------------------------------------------------------------------------

/**
 * For each day between `fromDay` (inclusive) and `toDay` (inclusive), the
 * last snapshot tick wins per stream. Days with no tick carry forward the
 * prior day's value (so weekends/cron gaps don't zero out combined value).
 */
export function dailyCombinedUsd(params: {
  portfolioSnapshots: SnapshotRow[];
  cryptoSnapshots: SnapshotRow[];
  fromDay: string;
  toDay: string;
}): Map<string, { portfolio: number; crypto: number; combined: number }> {
  const { portfolioSnapshots, cryptoSnapshots, fromDay, toDay } = params;

  const lastByDay = (rows: SnapshotRow[], useSuper: boolean) => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const m = new Map<string, number>();
    for (const r of sorted) {
      const d = r.date.slice(0, 10);
      if (d < fromDay || d > toDay) continue;
      const v = useSuper ? (r.valueWithSuper ?? r.value) : r.value;
      m.set(d, v);
    }
    return m;
  };

  const portLast = lastByDay(portfolioSnapshots, true);
  const cryLast = lastByDay(cryptoSnapshots, false);

  const out = new Map<string, { portfolio: number; crypto: number; combined: number }>();
  let pPrev = 0;
  let cPrev = 0;

  for (let d = new Date(`${fromDay}T00:00:00Z`);
       d <= new Date(`${toDay}T00:00:00Z`);
       d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const p = portLast.get(day) ?? pPrev;
    const c = cryLast.get(day) ?? cPrev;
    out.set(day, { portfolio: p, crypto: c, combined: p + c });
    pPrev = p;
    cPrev = c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Deposits per day (post-anchor only)
// ---------------------------------------------------------------------------

/**
 * Build a YYYY-MM-DD → USD net deposit map for days strictly AFTER anchor.
 * Stock buys = +, sells = −. Crypto deposits = + (we don't track withdrawals).
 * Anchor-day deposits are excluded because they're already reflected in the
 * anchor's totals.
 */
export function depositsPerDay(params: {
  portfolioTxns: PortfolioTransaction[];
  cryptoDeposits: CryptoDeposit[];
  anchorDate: string;
  fxToUsd: (amount: number, currency: string) => number;
}): Map<string, number> {
  const { portfolioTxns, cryptoDeposits, anchorDate, fxToUsd } = params;
  const m = new Map<string, number>();

  for (const tx of portfolioTxns) {
    const day = tx.date.slice(0, 10);
    if (day <= anchorDate) continue;
    const usd = fxToUsd(tx.totalAmount, tx.currency);
    const signed = tx.type === "buy" ? usd : -usd;
    m.set(day, (m.get(day) ?? 0) + signed);
  }

  for (const d of cryptoDeposits) {
    const day = d.date.slice(0, 10);
    if (day <= anchorDate) continue;
    m.set(day, (m.get(day) ?? 0) + d.usdValueAtDeposit);
  }
  return m;
}

// ---------------------------------------------------------------------------
// 6. Benchmark lookup with carry-forward (weekends, market holidays)
// ---------------------------------------------------------------------------

export function benchmarkByDay(bars: BenchmarkBar[]): Map<string, number> {
  const m = new Map<string, number>();
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  for (const b of sorted) m.set(b.date, b.close);
  return m;
}

// ---------------------------------------------------------------------------
// 7. Per-day performance rows
// ---------------------------------------------------------------------------

/**
 * Build backfill rows for every day in [anchorDate, toDay]. Timestamp is
 * set to noon UTC for the day (sortable, unambiguous; cron 15-min ticks for
 * today land later than these backfilled timestamps). For the anchor day,
 * all pcts are 0 and combined equals anchor totals.
 */
export function computeDailyPerfRows(params: {
  anchorDate: string;
  toDay: string;
  anchorTotals: { portfolioUsd: number; cryptoUsd: number; combinedUsd: number };
  anchorBenchmarks: { spy: number; btc: number };
  dailyCombined: Map<string, { portfolio: number; crypto: number; combined: number }>;
  deposits: Map<string, number>;
  btcByDay: Map<string, number>;
  spyByDay: Map<string, number>;
}): PerfBackfillRow[] {
  const {
    anchorDate,
    toDay,
    anchorTotals,
    anchorBenchmarks,
    dailyCombined,
    deposits,
    btcByDay,
    spyByDay,
  } = params;

  const out: PerfBackfillRow[] = [];
  let cumDeposits = 0;
  let btcCarry = anchorBenchmarks.btc;
  let spyCarry = anchorBenchmarks.spy;

  for (let d = new Date(`${anchorDate}T00:00:00Z`);
       d <= new Date(`${toDay}T00:00:00Z`);
       d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const dep = deposits.get(day) ?? 0;
    cumDeposits += dep;

    const combined = dailyCombined.get(day) ?? {
      portfolio: anchorTotals.portfolioUsd,
      crypto: anchorTotals.cryptoUsd,
      combined: anchorTotals.combinedUsd,
    };

    // Carry-forward benchmarks on gaps (weekends/holidays).
    const btc = btcByDay.get(day) ?? btcCarry;
    const spy = spyByDay.get(day) ?? spyCarry;
    btcCarry = btc;
    spyCarry = spy;

    const denom = anchorTotals.combinedUsd + cumDeposits;
    const portfolioPct =
      denom > 0
        ? ((combined.combined - anchorTotals.combinedUsd - cumDeposits) / denom) * 100
        : null;
    const btcPct = anchorBenchmarks.btc > 0 ? (btc / anchorBenchmarks.btc - 1) * 100 : null;
    const spyPct = anchorBenchmarks.spy > 0 ? (spy / anchorBenchmarks.spy - 1) * 100 : null;

    out.push({
      // Noon UTC — daily anchor timestamp; falls before any same-day cron
      // 15-min tick (which uses the actual run time, typically much later).
      timestamp: `${day}T12:00:00Z`,
      portfolioUsd: combined.portfolio,
      cryptoUsd: combined.crypto,
      combinedUsd: combined.combined,
      depositsUsd: cumDeposits,
      spyPriceUsd: spy,
      btcPriceUsd: btc,
      portfolioPct,
      spyPct,
      btcPct,
    });
  }
  return out;
}
