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
 * Pick the earliest Sydney date for which BOTH active streams have a snapshot.
 * If only one stream has data ever, anchor on that stream's earliest date.
 *
 * Why MAX of stream-firsts (not MIN): when one stream starts later than the
 * other, anchoring on the earlier date means the late-starting stream's
 * first value (e.g. $19K of pre-existing super holdings the cron just
 * started snapshotting) appears as a phantom gain — it's larger than the
 * anchor combined, isn't backed by a transaction record, and gets counted
 * as a return rather than a starting position. Anchoring where both
 * streams have data lets each contribute a real value on day 1.
 */
export function deriveAnchorDate(
  portfolioSnapshots: SnapshotRow[],
  cryptoSnapshots: SnapshotRow[],
): string | null {
  const earliest = (rows: SnapshotRow[]): string | null => {
    if (rows.length === 0) return null;
    let min: string | null = null;
    for (const r of rows) {
      const d = r.date.slice(0, 10);
      if (min === null || d < min) min = d;
    }
    return min;
  };
  const portFirst = earliest(portfolioSnapshots);
  const cryFirst = earliest(cryptoSnapshots);
  if (portFirst && cryFirst) return portFirst > cryFirst ? portFirst : cryFirst;
  return portFirst ?? cryFirst;
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

// ---------------------------------------------------------------------------
// External price fetchers (live in the same module to keep the backfill API
// thin — they're easy to mock by replacing the module's fetch calls in tests
// later if/when we add them)
// ---------------------------------------------------------------------------

/**
 * Fetch daily BTC closes (USD) from CoinGecko /market_chart/range.
 * Inclusive of `fromDay`, inclusive of `toDay`. Requires COINGECKO_API_KEY.
 */
export async function fetchBtcDailyCloses(params: {
  fromDay: string;
  toDay: string;
  apiKey: string;
}): Promise<BenchmarkBar[]> {
  const { fromDay, toDay, apiKey } = params;
  // CoinGecko: market_chart/range uses unix seconds.
  // `daily` interval auto-selected when range > 90 days.
  const from = Math.floor(new Date(`${fromDay}T00:00:00Z`).getTime() / 1000);
  const to = Math.floor(new Date(`${toDay}T23:59:59Z`).getTime() / 1000);
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "x-cg-demo-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`CoinGecko BTC fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { prices?: [number, number][] };
  const bars: BenchmarkBar[] = [];
  for (const [ms, close] of data.prices ?? []) {
    const day = new Date(ms).toISOString().slice(0, 10);
    bars.push({ date: day, close });
  }
  // Dedupe: CoinGecko returns multiple samples per day near range endpoints;
  // keep the last close for each day.
  const byDay = new Map<string, number>();
  for (const b of bars) byDay.set(b.date, b.close);
  return [...byDay.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch daily SPY closes (USD) from Alpaca /v2/stocks/SPY/bars.
 * Uses `adjustment=all` so closes are dividend-adjusted — i.e., the line
 * reflects total return (TR) rather than price return.
 */
export async function fetchSpyDailyCloses(params: {
  fromDay: string;
  toDay: string;
  apcaKeyId: string;
  apcaSecret: string;
}): Promise<BenchmarkBar[]> {
  const { fromDay, toDay, apcaKeyId, apcaSecret } = params;
  const url =
    `https://data.alpaca.markets/v2/stocks/SPY/bars?timeframe=1Day` +
    `&start=${fromDay}T00:00:00Z&end=${toDay}T23:59:59Z` +
    `&adjustment=all&feed=iex&limit=10000`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "APCA-API-KEY-ID": apcaKeyId,
      "APCA-API-SECRET-KEY": apcaSecret,
    },
  });
  if (!res.ok) {
    throw new Error(`Alpaca SPY fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { bars?: { t: string; c: number }[] };
  return (data.bars ?? []).map((b) => ({
    date: b.t.slice(0, 10),
    close: b.c,
  }));
}
