# Analytics: All-Time Baseline from First Snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "Reset Baseline" flow with an auto-derived baseline anchored to the earliest snapshot, and add a one-shot backfill of `performance_snapshots` with daily historical BTC (CoinGecko) + SPY (Alpaca) data so the comparison chart covers the full tracking journey.

**Architecture:** All new logic lives in a pure helper module (`lib/utils/analytics-backfill.ts`) that returns data ready to insert. Two API routes consume it: `GET /api/analytics/baseline` (auto-derive on first call) and `POST /api/analytics/backfill-performance` (one-shot wipe-and-reinsert for the current baseline). The cron also calls the auto-derive helper on first-ever run. UI swap: `ResetBaselineButton` → `RebuildHistoryButton`. Per-holding PnL widgets stay unchanged — they work correctly when `baseline.portfolio = {}` and `baseline.date` is earlier than every transaction, because their deposits-since-baseline path converges to `currentValue − cost_basis`.

**Tech Stack:** Next.js App Router 16 (React 19), Supabase (PostgreSQL), TypeScript 5. External APIs: CoinGecko `/coins/bitcoin/market_chart/range` (env: `COINGECKO_API_KEY`), Alpaca `/v2/stocks/SPY/bars` (env: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`).

**Note on tests:** This repo has no test framework installed (see `package.json` — only `next`, `eslint`). Verification steps use `npm run build` (TypeScript + Next build validates types + route handlers) and manual `curl` / browser checks. No TDD loop available.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `lib/utils/analytics-backfill.ts` | Pure helpers: derive anchor date, build baseline from snapshots, compute daily performance rows |
| Create | `app/api/analytics/backfill-performance/route.ts` | POST endpoint: wipe + reinsert `performance_snapshots` for current baseline using historical BTC/SPY |
| Create | `app/(app)/analytics/_components/rebuild-history-button.tsx` | UI button: POSTs to backfill endpoint, shows loading + toast-equivalent inline feedback |
| Modify | `app/api/analytics/baseline/route.ts` | `GET` auto-derives baseline from earliest snapshot if table empty; `POST` deleted |
| Modify | `app/api/cron/snapshot/route.ts` | If no active baseline at end of cron run, auto-derive one using helper |
| Modify | `app/(app)/analytics/page.tsx` | Use `RebuildHistoryButton` instead of `ResetBaselineButton` |
| Delete | `app/(app)/analytics/_components/reset-baseline-button.tsx` | Replaced by rebuild-history-button |

**Unchanged (kept intentionally):**
- `app/(app)/analytics/_components/no-baseline-empty.tsx` — still used when BOTH snapshot tables are empty (brand-new install). Its button posts to `/api/analytics/baseline` with `POST` which we're removing, so we must patch it to call `GET` instead (which now auto-derives).
- `lib/utils/analytics-baseline.ts` — `depositsByDay`, `computeTwrSeries`, `holdingPnlSinceBaseline` all stay. New helpers go in `analytics-backfill.ts`.
- All widget components (`pnl-header`, `daily-calendar`, `holdings-pnl-table`, etc.) — they use the `baseline` + deposits pattern, which is correct for earlier baselines.

---

## Task 1: Pure helper module — derive anchor, build baseline, compute perf rows

**Files:**
- Create: `lib/utils/analytics-backfill.ts`

- [ ] **Step 1: Write the helper module**

```typescript
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
  /** ISO timestamp at ~EOD Sydney for the day. */
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
// 2. Totals at a specific day (first snapshot on or after `day`)
// ---------------------------------------------------------------------------

/**
 * For each stream, pick the FIRST snapshot on or after `day` (sorted asc).
 * Portfolio uses valueWithSuper if present (matches chart's dailyValuesUsd
 * handling); crypto uses value directly.
 */
export function anchorTotalsFromSnapshots(params: {
  portfolioSnapshots: SnapshotRow[];
  cryptoSnapshots: SnapshotRow[];
  anchorDate: string;
}): { portfolioUsd: number; cryptoUsd: number; combinedUsd: number } {
  const { portfolioSnapshots, cryptoSnapshots, anchorDate } = params;

  const pickFirst = (rows: SnapshotRow[], useSuper: boolean): number => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    for (const r of sorted) {
      if (r.date.slice(0, 10) >= anchorDate) {
        return useSuper ? (r.valueWithSuper ?? r.value) : r.value;
      }
    }
    return 0;
  };

  const portfolioUsd = pickFirst(portfolioSnapshots, true);
  const cryptoUsd = pickFirst(cryptoSnapshots, false);
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
 * set to EOD Sydney (21:00 UTC ~ early morning Sydney next day, close enough
 * for day-keyed data). For the anchor day, all pcts are 0 and combined
 * equals anchor totals.
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
      // EOD Sydney ≈ 14:00 UTC (AEST) / 13:00 UTC (AEDT). Use 14:00 UTC for
      // consistency — it's within the trading day boundary and unambiguous.
      timestamp: `${day}T14:00:00Z`,
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
```

- [ ] **Step 2: Type-check the file**

Run: `npx tsc --noEmit`
Expected: No errors. The new file imports only from `./types`, which already exports `AnalyticsBaseline`, `CryptoDeposit`, `PortfolioTransaction`.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/analytics-backfill.ts
git commit -m "feat(analytics): pure helpers for all-time baseline backfill"
```

---

## Task 2: Historical price fetchers (BTC + SPY)

**Files:**
- Modify: `lib/utils/analytics-backfill.ts` — add fetcher functions at the bottom

- [ ] **Step 1: Add fetchers to the helper module**

Append to `lib/utils/analytics-backfill.ts`:

```typescript
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
 * Uses dividend-adjusted closes so the line reflects total return (matches
 * the baseline benchmark convention from /api/analytics/baseline POST).
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/analytics-backfill.ts
git commit -m "feat(analytics): BTC + SPY historical daily close fetchers"
```

---

## Task 3: Auto-derive baseline in `GET /api/analytics/baseline`; remove `POST`

**Files:**
- Modify: `app/api/analytics/baseline/route.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
// app/api/analytics/baseline/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { AnalyticsBaseline } from "@/lib/utils/types";
import {
  deriveAnchorDate,
  anchorTotalsFromSnapshots,
  buildBaselineFromSnapshots,
  fetchBtcDailyCloses,
  fetchSpyDailyCloses,
  type SnapshotRow,
} from "@/lib/utils/analytics-backfill";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

/**
 * GET — returns the active baseline. If none exists yet, auto-derives one from
 * the earliest snapshot in portfolio_snapshots/crypto_snapshots and persists it.
 * If both tables are empty (brand-new install), returns `{ baseline: null }`.
 */
export async function GET() {
  // 1. Look up existing current baseline first.
  const existing = await supabase
    .from("analytics_baseline")
    .select("snapshot")
    .eq("is_current", true)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }
  if (existing.data) {
    return NextResponse.json({
      baseline: existing.data.snapshot as AnalyticsBaseline,
    });
  }

  // 2. Auto-derive. Read snapshot streams from the KV `app_data` table since
  //    that's where the client + cron currently store them.
  const { data: rows, error: readErr } = await supabase
    .from("app_data")
    .select("key, value")
    .in("key", ["portfolio_snapshots", "crypto_snapshots"]);

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const kv: Record<string, string> = {};
  for (const r of rows ?? []) kv[r.key] = r.value;
  const parse = <T,>(k: string, fb: T): T => {
    try {
      return kv[k] ? (JSON.parse(kv[k]) as T) : fb;
    } catch {
      return fb;
    }
  };

  const portfolioSnapshots = parse<SnapshotRow[]>("portfolio_snapshots", []);
  const cryptoSnapshots = parse<SnapshotRow[]>("crypto_snapshots", []);

  const anchorDate = deriveAnchorDate(portfolioSnapshots, cryptoSnapshots);
  if (!anchorDate) {
    return NextResponse.json({ baseline: null });
  }

  const totals = anchorTotalsFromSnapshots({
    portfolioSnapshots,
    cryptoSnapshots,
    anchorDate,
  });

  // 3. Fetch historical benchmark prices for the anchor day (single-day fetch).
  const cgKey = process.env.COINGECKO_API_KEY;
  const apcaId = process.env.ALPACA_KEY_ID;
  const apcaSecret = process.env.ALPACA_SECRET_KEY;
  if (!cgKey || !apcaId || !apcaSecret) {
    return NextResponse.json(
      { error: "Missing COINGECKO_API_KEY or ALPACA_* env vars" },
      { status: 500 },
    );
  }

  let btcClose = 0;
  let spyClose = 0;
  try {
    const [btcBars, spyBars] = await Promise.all([
      fetchBtcDailyCloses({ fromDay: anchorDate, toDay: anchorDate, apiKey: cgKey }),
      fetchSpyDailyCloses({
        fromDay: anchorDate,
        toDay: anchorDate,
        apcaKeyId: apcaId,
        apcaSecret,
      }),
    ]);
    btcClose = btcBars[0]?.close ?? 0;
    spyClose = spyBars[0]?.close ?? 0;
  } catch (e) {
    return NextResponse.json(
      { error: `Benchmark fetch failed: ${String(e)}` },
      { status: 502 },
    );
  }

  if (btcClose <= 0 || spyClose <= 0) {
    return NextResponse.json(
      { error: `No benchmark close found for anchor date ${anchorDate}` },
      { status: 502 },
    );
  }

  // 4. Persist.
  const baseline = buildBaselineFromSnapshots({
    anchorDate,
    totals,
    btcClose,
    spyClose,
  });

  const { error: insErr } = await supabase.from("analytics_baseline").insert({
    date: anchorDate,
    snapshot: baseline,
    is_current: true,
  });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Mirror to KV (existing contract — some client code reads this key).
  await supabase.from("app_data").upsert(
    {
      key: "analytics_baseline",
      value: JSON.stringify(baseline),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  return NextResponse.json({ baseline });
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: No errors. (The removed POST handler means route.ts only exports GET — that's valid.)

- [ ] **Step 3: Commit**

```bash
git add app/api/analytics/baseline/route.ts
git commit -m "feat(analytics): GET baseline auto-derives from first snapshot, remove POST"
```

---

## Task 4: Auto-derive baseline in cron route (first-ever cron run)

**Files:**
- Modify: `app/api/cron/snapshot/route.ts` — add auto-derive block just before the existing "Performance snapshot" block (around line 501)

- [ ] **Step 1: Read the current performance-snapshot section to locate the insertion point**

Run: `grep -n "Performance snapshot" app/api/cron/snapshot/route.ts`
Expected: matches around line 501 (the try-catch that writes to `performance_snapshots`).

- [ ] **Step 2: Add the auto-derive block**

Find this line in `app/api/cron/snapshot/route.ts`:
```typescript
    // ── Performance snapshot (portfolio/SPY/BTC % since baseline) ──
```

Insert the following **directly above** that comment (still inside the outer `try` block):

```typescript
    // ── Auto-derive baseline on first-ever cron run (no manual reset needed). ──
    try {
      const { data: hasBaseline } = await supabase
        .from("analytics_baseline")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (!hasBaseline) {
        const { deriveAnchorDate, anchorTotalsFromSnapshots, buildBaselineFromSnapshots, fetchBtcDailyCloses, fetchSpyDailyCloses } =
          await import("@/lib/utils/analytics-backfill");
        type SnapshotLike = { date: string; value?: number; valueWithSuper?: number };

        // Snapshots were just appended in the updates[] array — merge with KV.
        const portUpdate = updates.find((u) => u.key === "portfolio_snapshots");
        const cryUpdate = updates.find((u) => u.key === "crypto_snapshots");
        const mergedPort = (portUpdate ? JSON.parse(portUpdate.value) : portfolioSnapshots) as SnapshotLike[];
        const mergedCry = (cryUpdate ? JSON.parse(cryUpdate.value) : cryptoSnapshots) as SnapshotLike[];
        const mergedPortNormalized = mergedPort.map((r) => ({
          date: r.date,
          value: r.value ?? 0,
          valueWithSuper: r.valueWithSuper,
        }));
        const mergedCryNormalized = mergedCry.map((r) => ({
          date: r.date,
          value: r.value ?? 0,
        }));

        const anchor = deriveAnchorDate(mergedPortNormalized, mergedCryNormalized);
        if (anchor && process.env.COINGECKO_API_KEY && process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY) {
          const totals = anchorTotalsFromSnapshots({
            portfolioSnapshots: mergedPortNormalized,
            cryptoSnapshots: mergedCryNormalized,
            anchorDate: anchor,
          });
          const [btcBars, spyBars] = await Promise.all([
            fetchBtcDailyCloses({ fromDay: anchor, toDay: anchor, apiKey: process.env.COINGECKO_API_KEY }),
            fetchSpyDailyCloses({
              fromDay: anchor,
              toDay: anchor,
              apcaKeyId: process.env.ALPACA_KEY_ID,
              apcaSecret: process.env.ALPACA_SECRET_KEY,
            }),
          ]);
          const btcClose = btcBars[0]?.close ?? 0;
          const spyClose = spyBars[0]?.close ?? 0;
          if (btcClose > 0 && spyClose > 0) {
            const baseline = buildBaselineFromSnapshots({ anchorDate: anchor, totals, btcClose, spyClose });
            await supabase.from("analytics_baseline").insert({
              date: anchor,
              snapshot: baseline,
              is_current: true,
            });
            await supabase.from("app_data").upsert(
              {
                key: "analytics_baseline",
                value: JSON.stringify(baseline),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "key" },
            );
            log.push(`Auto-derived baseline on first run: anchor=${anchor} combined=$${totals.combinedUsd.toFixed(0)}`);
          } else {
            log.push(`Auto-derive baseline: skipped — btc=${btcClose} spy=${spyClose} (fetch returned no data)`);
          }
        } else if (!anchor) {
          log.push(`Auto-derive baseline: skipped — no snapshots yet`);
        } else {
          log.push(`Auto-derive baseline: skipped — missing env keys`);
        }
      }
    } catch (e) {
      log.push(`Auto-derive baseline failed: ${String(e)}`);
    }

```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit`
Expected: No errors. The dynamic `import()` returns the typed module.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/snapshot/route.ts
git commit -m "feat(cron): auto-derive baseline on first run from earliest snapshot"
```

---

## Task 5: Backfill endpoint — `POST /api/analytics/backfill-performance`

**Files:**
- Create: `app/api/analytics/backfill-performance/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/analytics/backfill-performance/route.ts
//
// One-shot backfill of `performance_snapshots` for the current baseline.
// Wipes existing rows for baseline_id, fetches daily BTC/SPY history from
// anchor_date → yesterday, and re-inserts one row per day. Cron continues
// writing 15-min rows for today going forward.
//
// Idempotent — running twice produces the same end state.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type {
  AnalyticsBaseline,
  CryptoDeposit,
  PortfolioTransaction,
} from "@/lib/utils/types";
import {
  dailyCombinedUsd,
  depositsPerDay,
  benchmarkByDay,
  computeDailyPerfRows,
  fetchBtcDailyCloses,
  fetchSpyDailyCloses,
  type SnapshotRow,
} from "@/lib/utils/analytics-backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

async function getFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { rates?: Record<string, number> };
    return data.rates ?? {};
  } catch {
    return {};
  }
}

function yesterdaySydney(): string {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Australia/Sydney",
  });
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export async function POST() {
  // 1. Fetch current baseline + id (need id for cascade scoping).
  const { data: baselineRow, error: baselineErr } = await supabase
    .from("analytics_baseline")
    .select("id, date, snapshot")
    .eq("is_current", true)
    .maybeSingle();

  if (baselineErr) {
    return NextResponse.json({ error: baselineErr.message }, { status: 500 });
  }
  if (!baselineRow) {
    return NextResponse.json(
      { error: "No active baseline. Wait for cron to run once, then retry." },
      { status: 400 },
    );
  }
  const baseline = baselineRow.snapshot as AnalyticsBaseline;
  const anchorDate = baseline.date;
  const toDay = yesterdaySydney();
  if (anchorDate > toDay) {
    return NextResponse.json(
      { error: `Baseline date ${anchorDate} is in the future.` },
      { status: 400 },
    );
  }

  // 2. Wipe existing rows for this baseline (idempotency).
  const { error: delErr } = await supabase
    .from("performance_snapshots")
    .delete()
    .eq("baseline_id", baselineRow.id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // 3. Read snapshots + txns + crypto deposits.
  const { data: kvRows } = await supabase
    .from("app_data")
    .select("key, value")
    .in("key", ["portfolio_snapshots", "crypto_snapshots", "portfolio_transactions"]);

  const kv: Record<string, string> = {};
  for (const r of kvRows ?? []) kv[r.key] = r.value;
  const parse = <T,>(k: string, fb: T): T => {
    try {
      return kv[k] ? (JSON.parse(kv[k]) as T) : fb;
    } catch {
      return fb;
    }
  };

  const portfolioSnapshots = parse<SnapshotRow[]>("portfolio_snapshots", []);
  const cryptoSnapshots = parse<SnapshotRow[]>("crypto_snapshots", []);
  const portfolioTxns = parse<PortfolioTransaction[]>("portfolio_transactions", []);

  const { data: depositRows } = await supabase
    .from("crypto_deposits")
    .select("id, date, token, amount, usd_value_at_deposit, kind");
  const cryptoDeposits: CryptoDeposit[] = (depositRows ?? []).map((r) => ({
    id: r.id as string,
    date: r.date as string,
    token: r.token as string,
    amount: Number(r.amount),
    usdValueAtDeposit: Number(r.usd_value_at_deposit),
    kind: r.kind as "stablecoin" | "crypto",
    createdAt: 0,
  }));

  // 4. FX rates for txn currency → USD conversion.
  const rates = await getFxRates();
  const fxToUsd = (amount: number, currency: string) => {
    if (currency === "USD" || !rates[currency]) return amount;
    return amount / rates[currency];
  };

  // 5. Fetch historical benchmarks for [anchorDate, toDay].
  const cgKey = process.env.COINGECKO_API_KEY;
  const apcaId = process.env.ALPACA_KEY_ID;
  const apcaSecret = process.env.ALPACA_SECRET_KEY;
  if (!cgKey || !apcaId || !apcaSecret) {
    return NextResponse.json(
      { error: "Missing COINGECKO_API_KEY or ALPACA_* env vars" },
      { status: 500 },
    );
  }

  let btcBars;
  let spyBars;
  try {
    [btcBars, spyBars] = await Promise.all([
      fetchBtcDailyCloses({ fromDay: anchorDate, toDay, apiKey: cgKey }),
      fetchSpyDailyCloses({
        fromDay: anchorDate,
        toDay,
        apcaKeyId: apcaId,
        apcaSecret,
      }),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: `Benchmark fetch failed: ${String(e)}` },
      { status: 502 },
    );
  }

  // 6. Compute per-day rows.
  const dailyCombined = dailyCombinedUsd({
    portfolioSnapshots,
    cryptoSnapshots,
    fromDay: anchorDate,
    toDay,
  });
  const deposits = depositsPerDay({
    portfolioTxns,
    cryptoDeposits,
    anchorDate,
    fxToUsd,
  });
  const btcByDay = benchmarkByDay(btcBars);
  const spyByDay = benchmarkByDay(spyBars);

  const rows = computeDailyPerfRows({
    anchorDate,
    toDay,
    anchorTotals: baseline.totals,
    anchorBenchmarks: baseline.benchmarks,
    dailyCombined,
    deposits,
    btcByDay,
    spyByDay,
  });

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, daysWritten: 0, from: anchorDate, to: toDay });
  }

  // 7. Insert in chunks (Supabase limit = 1000 per insert).
  const snakeRows = rows.map((r) => ({
    baseline_id: baselineRow.id,
    baseline_date: baseline.date,
    timestamp: r.timestamp,
    portfolio_usd: r.portfolioUsd,
    crypto_usd: r.cryptoUsd,
    combined_usd: r.combinedUsd,
    deposits_usd: r.depositsUsd,
    spy_price_usd: r.spyPriceUsd,
    btc_price_usd: r.btcPriceUsd,
    portfolio_pct: r.portfolioPct,
    spy_pct: r.spyPct,
    btc_pct: r.btcPct,
  }));

  for (let i = 0; i < snakeRows.length; i += 500) {
    const chunk = snakeRows.slice(i, i + 500);
    const { error: insErr } = await supabase
      .from("performance_snapshots")
      .insert(chunk);
    if (insErr) {
      return NextResponse.json(
        { error: `Insert failed at chunk ${i}: ${insErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    daysWritten: rows.length,
    from: anchorDate,
    to: toDay,
  });
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/analytics/backfill-performance/route.ts
git commit -m "feat(analytics): one-shot backfill of performance_snapshots with BTC/SPY history"
```

---

## Task 6: UI — replace Reset Baseline button with Rebuild History button

**Files:**
- Create: `app/(app)/analytics/_components/rebuild-history-button.tsx`
- Modify: `app/(app)/analytics/page.tsx`
- Modify: `app/(app)/analytics/_components/no-baseline-empty.tsx`
- Delete: `app/(app)/analytics/_components/reset-baseline-button.tsx`

- [ ] **Step 1: Create the new button component**

Write to `app/(app)/analytics/_components/rebuild-history-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RebuildHistoryButtonProps {
  baselineDate: string;
  onRebuilt: () => void;
}

export function RebuildHistoryButton({ baselineDate, onRebuilt }: RebuildHistoryButtonProps) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function run() {
    setStatus("running");
    setMessage("");
    try {
      const res = await fetch("/api/analytics/backfill-performance", { method: "POST" });
      const json = (await res.json()) as
        | { ok: true; daysWritten: number; from: string; to: string }
        | { error: string };
      if (!res.ok || "error" in json) {
        setStatus("error");
        setMessage("error" in json ? json.error : `HTTP ${res.status}`);
        return;
      }
      setStatus("done");
      setMessage(`Rebuilt ${json.daysWritten} days (${json.from} → ${json.to})`);
      onRebuilt();
    } catch (e) {
      setStatus("error");
      setMessage(String(e));
    }
  }

  const label =
    status === "running" ? "Rebuilding…" :
    status === "done" ? "Rebuilt ✓" :
    status === "error" ? "Failed — retry" :
    `Rebuild history (from ${baselineDate})`;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={run}
        disabled={status === "running"}
      >
        <History className="h-3 w-3" /> {label}
      </Button>
      {message && (
        <p className={`text-xs font-mono ${status === "error" ? "text-expense" : "text-muted-foreground"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `page.tsx` to use the new button**

In `app/(app)/analytics/page.tsx`:

Replace this line (line 50):
```typescript
import { ResetBaselineButton } from "./_components/reset-baseline-button";
```
with:
```typescript
import { RebuildHistoryButton } from "./_components/rebuild-history-button";
```

Replace this block (around lines 578-583):
```tsx
      <div className="flex justify-end">
        <ResetBaselineButton
          baselineDate={baseline.date}
          onReset={() => fetch("/api/analytics/baseline").then((r) => r.json()).then((j) => setBaseline(j.baseline))}
        />
      </div>
```
with:
```tsx
      <div className="flex justify-end">
        <RebuildHistoryButton
          baselineDate={baseline.date}
          onRebuilt={() => {
            fetch("/api/analytics/performance-snapshots")
              .then((r) => r.json())
              .then((j) => setPerfSnapshots(j.snapshots ?? []))
              .catch(() => {});
          }}
        />
      </div>
```

- [ ] **Step 3: Patch `no-baseline-empty.tsx` — remove POST call**

The `NoBaselineEmpty` button previously POST'd to `/api/analytics/baseline`; that handler no longer exists. Since GET now auto-derives, the button just needs to re-fetch (which triggers derivation server-side) if any snapshots have since arrived.

Replace the full contents of `app/(app)/analytics/_components/no-baseline-empty.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function NoBaselineEmpty({ onCreated }: { onCreated: () => void }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/baseline");
      const j = (await res.json()) as { baseline: unknown; error?: string };
      if (j.error) {
        setError(j.error);
        return;
      }
      if (j.baseline) {
        onCreated();
        return;
      }
      setError("Still no snapshots yet. Wait for the next cron run (every 15 min) or trigger one from the Debug page.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="finance-card p-8 text-center space-y-3">
      <p className="label-mono">No baseline yet</p>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        The baseline auto-derives from your first portfolio or crypto snapshot,
        written every 15 min by the cron. Once the first snapshot lands, your
        analytics will start tracking automatically.
      </p>
      <Button onClick={check} disabled={checking}>
        {checking ? "Checking…" : "Check now"}
      </Button>
      {error && <p className="text-xs text-expense">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Delete the obsolete `reset-baseline-button.tsx`**

```bash
rm app/\(app\)/analytics/_components/reset-baseline-button.tsx
```

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: No errors. All imports of `ResetBaselineButton` removed; the new file is imported in `page.tsx`.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/analytics/_components/rebuild-history-button.tsx \
        app/\(app\)/analytics/_components/no-baseline-empty.tsx \
        app/\(app\)/analytics/page.tsx
git rm app/\(app\)/analytics/_components/reset-baseline-button.tsx
git commit -m "feat(analytics): Rebuild History button replaces Reset Baseline"
```

---

## Task 7: End-to-end manual verification

**No files changed — this task is verification only.**

- [ ] **Step 1: Build the app**

Run: `npm run build`
Expected: Build succeeds with no type errors. If it fails, fix before proceeding.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: Dev server on `http://localhost:3000`.

- [ ] **Step 3: Check baseline auto-derive via API**

In a separate terminal:
```bash
curl -s http://localhost:3000/api/analytics/baseline | head -c 400
```

Expected: JSON containing a `baseline` key with non-null `{ date, totals, benchmarks, ... }`. The `date` should be early (the oldest day in your snapshots), NOT today.

If it returns `{ baseline: null }` with no error → your snapshots are empty, which is the true-empty-state path. Populate snapshots first via `curl http://localhost:3000/api/cron/snapshot`.

- [ ] **Step 4: Trigger backfill**

```bash
curl -s -X POST http://localhost:3000/api/analytics/backfill-performance
```

Expected: `{ "ok": true, "daysWritten": N, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` where N is the number of days between baseline date and yesterday.

- [ ] **Step 5: Inspect data in Supabase dashboard**

Open Supabase → Table Editor → `performance_snapshots`. Sort by `timestamp` ascending.

Expected:
- First rows go back to the baseline date (matches the `from` in step 4).
- `portfolio_pct = 0`, `spy_pct = 0`, `btc_pct = 0` on the anchor-day row.
- `btc_price_usd` and `spy_price_usd` are populated on every row.
- Later rows (from today/cron) have 15-min `timestamp` granularity; older rows have `14:00:00Z` daily timestamps.

- [ ] **Step 6: Visual check on the analytics page**

Navigate to `http://localhost:3000/analytics`.

Expected:
- Chart's leftmost point = baseline date (old), not recent.
- BTC line and SPY line are both present and non-flat across the full range.
- Portfolio line tracks the shape you'd expect from your historical snapshots.
- A "Rebuild history (from YYYY-MM-DD)" button appears in the top-right (not "Reset baseline").
- `PnlHeader`'s "All time" value matches roughly `currentValue − cost_basis` (i.e., unrealized PnL on current holdings).

- [ ] **Step 7: Idempotency check**

Click the Rebuild History button on the page. It should complete in a few seconds with no error, and the chart should re-render identically.

- [ ] **Step 8: Commit any verification-driven fixes (if needed)**

```bash
# Only if anything needed tweaking during verification
git add -A
git commit -m "fix(analytics): <specific adjustment from verification>"
```

---

## Self-review notes

**Spec coverage:**
- ✅ Section 1 (conceptual model, auto-baseline = first snapshot) → Tasks 3 + 4
- ✅ Section 2 (data flow) → Tasks 1, 2, 3, 4, 5
- ✅ Section 3 (file changes table) → All file paths in each task match the spec's table
- ✅ Section 4 (daily granularity for old period) → `computeDailyPerfRows` in Task 1 + timestamp `14:00:00Z` in Task 1
- ✅ Section 5 (manual Rebuild button trigger) → Task 6
- ✅ Acceptance criteria → Task 7 verification steps

**Type consistency:**
- `SnapshotRow`, `BenchmarkBar`, `PerfBackfillRow` defined in Task 1 and consumed consistently in Tasks 3, 4, 5
- `AnalyticsBaseline` reused from existing `lib/utils/types.ts`
- `baseline_id` column mapped to `baselineRow.id` (UUID from existing schema)

**Placeholder scan:**
- No TBD/TODO entries
- Every code block is complete (no "... similar to above")
- All routes have explicit error handling and return shapes documented

**Scope check:**
- Single deliverable: auto-baseline + manual backfill
- No tangential refactors (baseline schema unchanged, widgets untouched, cron mostly untouched)
