# Analytics Baseline PnL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the analytics page's "all-time" PnL with a user-set baseline, track daily PnL in both $ and %, and compare portfolio performance against SPY and BTC using Time-Weighted Return math.

**Architecture:** New `analytics_baseline` record + `crypto_deposits` ledger in Supabase/KV. A new utility module (`lib/utils/analytics-baseline.ts`) owns TWR math. Existing analytics cards are rewired to read from the baseline instead of from full-history data. SPY benchmark already returns dividend-adjusted closes via Alpaca `adjustment=all`, so no SPY-TR change is needed.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (KV in `app_data` + relational tables), Recharts, Alpaca + Binance APIs.

**No test runner is installed in this repo.** Verification is via `pnpm lint`, `pnpm tsc --noEmit`, and manual browser testing through the running dev server (Playwright MCP when available).

**Spec:** `docs/superpowers/specs/2026-04-22-analytics-baseline-pnl-design.md`

---

## File Structure

**New files:**
- `lib/utils/analytics-baseline.ts` — TWR math + baseline helpers
- `app/api/analytics/baseline/route.ts` — GET/POST current baseline
- `app/api/crypto/deposits/route.ts` — GET all / POST new deposit
- `app/api/crypto/deposits/[id]/route.ts` — DELETE one deposit
- `app/(app)/analytics/_components/reset-baseline-button.tsx`
- `app/(app)/analytics/_components/no-baseline-empty.tsx`
- `app/(app)/crypto/_components/deposit-log-form.tsx`
- `app/(app)/crypto/_components/deposit-list.tsx`
- `supabase/migrations/2026-04-22-analytics-baseline-and-deposits.sql`

**Modified files:**
- `lib/utils/types.ts` — add `AnalyticsBaseline`, `CryptoDeposit`
- `app/(app)/analytics/page.tsx` — baseline + TWR wiring, new layout
- `app/(app)/analytics/_components/pnl-header.tsx` — show $ and %
- `app/(app)/analytics/_components/comparison-chart.tsx` — baseline-anchored TWR
- `app/(app)/analytics/_components/daily-calendar.tsx` — add % per cell, grey pre-baseline
- `app/(app)/analytics/_components/pnl-by-product.tsx` — TWR split with % view
- `app/(app)/analytics/_components/top-gainers-losers.tsx` — per-holding PnL since baseline
- `app/(app)/analytics/_components/holdings-pnl-table.tsx` — new "Since baseline" columns
- `app/(app)/crypto/page.tsx` — mount DepositLogForm + DepositList

---

## Task 1: Add types for `AnalyticsBaseline` and `CryptoDeposit`

**Files:**
- Modify: `lib/utils/types.ts`

- [ ] **Step 1: Append types to the end of `lib/utils/types.ts`**

```ts
// ---------------------------------------------------------------------------
// Analytics baseline + crypto deposits (see docs/.../2026-04-22-analytics-baseline-pnl-design.md)
// ---------------------------------------------------------------------------

export interface AnalyticsBaseline {
  /** "YYYY-MM-DD" — the day the user reset the baseline. */
  date: string;
  /** Epoch ms when the baseline was captured. */
  createdAt: number;
  /** Per-portfolio-holding snapshot keyed by holding.id. */
  portfolio: Record<string, {
    units: number;
    priceUsd: number;
    valueUsd: number;
    currency: Currency;
    accountType?: AccountType;
  }>;
  /** Per-crypto-token snapshot keyed by token symbol (matches CryptoHolding.token). */
  crypto: Record<string, {
    amount: number;
    priceUsd: number;
    valueUsd: number;
  }>;
  /** Benchmark close prices on baseline_date. */
  benchmarks: {
    spy: number;  // Alpaca `adjustment=all` close (dividend-adjusted → TR equivalent)
    btc: number;
  };
  /** Rolling totals for convenience. */
  totals: {
    portfolioUsd: number;
    cryptoUsd: number;
    combinedUsd: number;
  };
}

export interface CryptoDeposit {
  id: string;
  /** ISO string — may contain time. */
  date: string;
  token: string;
  amount: number;
  usdValueAtDeposit: number;
  kind: "stablecoin" | "crypto";
  notes?: string;
  createdAt: number;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/types.ts
git commit -m "feat(types): add AnalyticsBaseline and CryptoDeposit"
```

---

## Task 2: Supabase migration for new tables

**Files:**
- Create: `supabase/migrations/2026-04-22-analytics-baseline-and-deposits.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Analytics baseline — stores a snapshot of "where the user started tracking".
-- Only one row has is_current=true at any time; past baselines are retained.
create table if not exists analytics_baseline (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  created_at  timestamptz not null default now(),
  snapshot    jsonb not null,
  is_current  boolean not null default true
);

create unique index if not exists analytics_baseline_current_idx
  on analytics_baseline (is_current) where is_current;

-- Crypto deposit ledger — external capital inflows to crypto (matches
-- portfolio_transactions for stocks).
create table if not exists crypto_deposits (
  id                    uuid primary key default gen_random_uuid(),
  date                  timestamptz not null,
  token                 text not null,
  amount                numeric not null,
  usd_value_at_deposit  numeric not null,
  kind                  text not null check (kind in ('stablecoin', 'crypto')),
  notes                 text,
  created_at            timestamptz not null default now()
);

create index if not exists crypto_deposits_date_idx on crypto_deposits (date desc);
```

- [ ] **Step 2: Apply to local Supabase (or note for deploy)**

If Supabase CLI is set up, run:

```bash
supabase db push
```

If not, paste the SQL into the Supabase dashboard SQL editor. Confirm both tables exist via:

```bash
# From SQL editor, or psql:
# \d analytics_baseline
# \d crypto_deposits
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-04-22-analytics-baseline-and-deposits.sql
git commit -m "feat(db): analytics_baseline and crypto_deposits tables"
```

---

## Task 3: Create `analytics-baseline.ts` — baseline + deposits helpers

**Files:**
- Create: `lib/utils/analytics-baseline.ts`

- [ ] **Step 1: Write the full utility module**

```ts
import type {
  AnalyticsBaseline,
  CryptoDeposit,
  CryptoHolding,
  PortfolioHolding,
  PortfolioTransaction,
} from "./types";

// ---------------------------------------------------------------------------
// Capture baseline from current state
// ---------------------------------------------------------------------------

/**
 * Snapshot the current portfolio + crypto state as the starting point for
 * all PnL calculations going forward. Call when the user hits "Reset Baseline".
 * fxToUsd converts native holding currency to USD so totals are comparable.
 */
export function captureBaseline(params: {
  date: string;
  holdings: PortfolioHolding[];
  cryptoHoldings: CryptoHolding[];
  spy: number;
  btc: number;
  fxToUsd: (amount: number, currency: string) => number;
}): AnalyticsBaseline {
  const { date, holdings, cryptoHoldings, spy, btc, fxToUsd } = params;

  const portfolio: AnalyticsBaseline["portfolio"] = {};
  let portfolioUsd = 0;
  for (const h of holdings) {
    if (!h.units || h.units === 0) continue;
    const valueUsd = fxToUsd(h.currentValue, h.currency);
    const priceUsd = h.units > 0 ? valueUsd / h.units : 0;
    portfolio[h.id] = {
      units: h.units,
      priceUsd,
      valueUsd,
      currency: h.currency,
      accountType: h.accountType,
    };
    portfolioUsd += valueUsd;
  }

  const crypto: AnalyticsBaseline["crypto"] = {};
  let cryptoUsd = 0;
  for (const h of cryptoHoldings) {
    if (Math.abs(h.amount) < 1e-8) continue;
    const priceUsd = h.amount > 0 ? h.currentValueUsd / h.amount : 0;
    crypto[h.token] = {
      amount: h.amount,
      priceUsd,
      valueUsd: h.currentValueUsd,
    };
    cryptoUsd += h.currentValueUsd;
  }

  return {
    date,
    createdAt: Date.now(),
    portfolio,
    crypto,
    benchmarks: { spy, btc },
    totals: {
      portfolioUsd,
      cryptoUsd,
      combinedUsd: portfolioUsd + cryptoUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// Deposits → per-day USD map
// ---------------------------------------------------------------------------

/**
 * Build a YYYY-MM-DD → net USD deposit map from stock txns + crypto deposits.
 * Stock buys = positive deposit, sells = negative (withdrawal). Crypto deposits
 * are always positive (use negative `amount` for withdrawals if ever needed).
 * Days ≤ baselineDate are skipped — pre-baseline deposits are rolled into the
 * baseline value and should not count as new capital.
 */
export function depositsByDay(params: {
  portfolioTxns: PortfolioTransaction[];
  cryptoDeposits: CryptoDeposit[];
  baselineDate: string;
  fxToUsd: (amount: number, currency: string) => number;
}): Map<string, number> {
  const { portfolioTxns, cryptoDeposits, baselineDate, fxToUsd } = params;
  const map = new Map<string, number>();

  for (const tx of portfolioTxns) {
    const day = tx.date.slice(0, 10);
    if (day <= baselineDate) continue;
    const usd = fxToUsd(tx.totalAmount, tx.currency);
    const signed = tx.type === "buy" ? usd : -usd;
    map.set(day, (map.get(day) ?? 0) + signed);
  }

  for (const d of cryptoDeposits) {
    const day = d.date.slice(0, 10);
    if (day <= baselineDate) continue;
    map.set(day, (map.get(day) ?? 0) + d.usdValueAtDeposit);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Time-Weighted Return series
// ---------------------------------------------------------------------------

export interface TwrPoint {
  date: string;           // YYYY-MM-DD
  valueUsd: number;       // EOD total value
  depositsUsd: number;    // net deposits on this day
  rDay: number;           // daily return fraction (e.g. 0.012 = +1.2%)
  cumulativePct: number;  // cumulative return % since baseline (0 on baseline_date)
  deltaUsd: number;       // valueUsd − baselineValue − cumulative net deposits
}

/**
 * Walk days from baseline → today computing daily TWR.
 *
 * Formula per day d > baseline_date:
 *   r_d    = (V_d − V_{d-1} − deposits_d) / (V_{d-1} + deposits_d)
 *   cum_d  = Π(1 + r_i) − 1   for i in (baseline_date, d]
 *
 * On baseline_date itself, cumulativePct = 0 and rDay = 0.
 * If V_{d-1} + deposits_d ≤ 0 we skip the day and carry forward the prior
 * cumulative value — prevents divide-by-zero when the portfolio is briefly empty.
 */
export function computeTwrSeries(params: {
  baseline: AnalyticsBaseline;
  /** EOD total values by day (portfolio + crypto, USD). Must include baseline_date. */
  dailyValuesUsd: Map<string, number>;
  deposits: Map<string, number>;
  today: string;
  /** Optional live value for `today` — overrides dailyValuesUsd[today] when provided. */
  liveValueUsd?: number;
}): TwrPoint[] {
  const { baseline, dailyValuesUsd, deposits, today, liveValueUsd } = params;
  const out: TwrPoint[] = [];

  // Sorted list of unique days from baseline through today
  const days: string[] = [];
  for (let d = new Date(`${baseline.date}T00:00:00Z`);
       d <= new Date(`${today}T00:00:00Z`);
       d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }

  const baselineValue = baseline.totals.combinedUsd;
  let prevValue = baselineValue;
  let cumFactor = 1;
  let cumDeposits = 0;

  for (const day of days) {
    const isToday = day === today;
    const isBaseline = day === baseline.date;
    const rawValue = isToday && liveValueUsd != null
      ? liveValueUsd
      : dailyValuesUsd.get(day);
    const value = rawValue ?? prevValue;     // carry-forward on gaps
    const dep = deposits.get(day) ?? 0;

    let rDay = 0;
    if (!isBaseline) {
      const denom = prevValue + dep;
      if (denom > 0) {
        rDay = (value - prevValue - dep) / denom;
        cumFactor *= 1 + rDay;
      }
      cumDeposits += dep;
    }

    out.push({
      date: day,
      valueUsd: value,
      depositsUsd: dep,
      rDay,
      cumulativePct: (cumFactor - 1) * 100,
      deltaUsd: value - baselineValue - cumDeposits,
    });
    prevValue = value;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Benchmark series (SPY, BTC) normalized to 0% on baseline_date
// ---------------------------------------------------------------------------

export interface BenchmarkPoint {
  date: string;
  cumulativePct: number;
}

export function computeBenchmarkSeries(params: {
  baselineDate: string;
  baselinePrice: number;
  bars: { date: string; close: number }[];
  today: string;
}): BenchmarkPoint[] {
  const { baselineDate, baselinePrice, bars, today } = params;
  if (baselinePrice <= 0) return [];

  // Lookup + carry-forward for weekends/holidays
  const byDay = new Map<string, number>(bars.map(b => [b.date, b.close]));
  const out: BenchmarkPoint[] = [];
  let lastClose = baselinePrice;

  for (let d = new Date(`${baselineDate}T00:00:00Z`);
       d <= new Date(`${today}T00:00:00Z`);
       d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const close = byDay.get(day) ?? lastClose;
    lastClose = close;
    out.push({ date: day, cumulativePct: (close / baselinePrice - 1) * 100 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-holding PnL since baseline
// ---------------------------------------------------------------------------

/**
 * PnL for a single holding from baseline → now. `baselineValueUsd` is 0 for
 * holdings that didn't exist at baseline (cost basis = deposits only).
 */
export function holdingPnlSinceBaseline(params: {
  baselineValueUsd: number;
  currentValueUsd: number;
  depositsToHoldingUsd: number;
}): { pnlUsd: number; pnlPct: number } {
  const { baselineValueUsd, currentValueUsd, depositsToHoldingUsd } = params;
  const pnlUsd = currentValueUsd - baselineValueUsd - depositsToHoldingUsd;
  const denom = baselineValueUsd + depositsToHoldingUsd;
  const pnlPct = denom > 0 ? (pnlUsd / denom) * 100 : 0;
  return { pnlUsd, pnlPct };
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/analytics-baseline.ts
git commit -m "feat(analytics): TWR + baseline helpers (captureBaseline, computeTwrSeries, computeBenchmarkSeries)"
```

---

## Task 4: `/api/analytics/baseline` endpoint

**Files:**
- Create: `app/api/analytics/baseline/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { captureBaseline } from "@/lib/utils/analytics-baseline";
import { parseAndComputeHoldings, applyStablecoinTags } from "@/lib/utils/crypto-csv";
import type { AnalyticsBaseline, PortfolioHolding } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

async function getFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (!res.ok) return {};
    const data = await res.json();
    return data.rates ?? {};
  } catch {
    return {};
  }
}

async function fetchBtcClose(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data.price);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

async function fetchSpyClose(): Promise<number | null> {
  const keyId = process.env.ALPACA_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secret) return null;
  try {
    const res = await fetch(
      "https://data.alpaca.markets/v2/stocks/SPY/bars/latest?feed=iex",
      { cache: "no-store", headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { bar?: { c: number } };
    return data.bar?.c ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from("analytics_baseline")
    .select("snapshot")
    .eq("is_current", true)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ baseline: (data?.snapshot ?? null) as AnalyticsBaseline | null });
}

export async function POST() {
  // Pull current state from app_data KV
  const { data: rows, error: readErr } = await supabase
    .from("app_data")
    .select("key, value")
    .in("key", ["portfolio_holdings", "crypto_csv_text", "crypto_stablecoin_tags", "crypto_prices"]);
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const kv: Record<string, string> = {};
  for (const r of rows ?? []) kv[r.key] = r.value;
  const parse = <T,>(k: string, fb: T): T => { try { return kv[k] ? JSON.parse(kv[k]) : fb; } catch { return fb; } };

  const holdings = parse<PortfolioHolding[]>("portfolio_holdings", []);
  const csvText = parse<string>("crypto_csv_text", "");
  const tags = parse<Record<string, boolean>>("crypto_stablecoin_tags", {});
  const cachedPrices = parse<{ prices: Record<string, number> }>("crypto_prices", { prices: {} });

  // Build crypto holdings with live prices applied
  let cryptoHoldings = csvText ? parseAndComputeHoldings(csvText) : [];
  for (const h of cryptoHoldings) {
    const p = cachedPrices.prices?.[h.token];
    if (p != null && h.amount > 0) h.currentValueUsd = p * h.amount;
  }
  cryptoHoldings = applyStablecoinTags(cryptoHoldings, tags);

  // Benchmarks + FX
  const [spy, btc, rates] = await Promise.all([fetchSpyClose(), fetchBtcClose(), getFxRates()]);
  if (spy == null || btc == null) {
    return NextResponse.json(
      { error: "Could not fetch SPY or BTC price; baseline not written" },
      { status: 502 },
    );
  }

  const fxToUsd = (amount: number, currency: string) => {
    if (currency === "USD" || !rates[currency]) return amount;
    return amount / rates[currency];
  };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  const baseline = captureBaseline({ date: today, holdings, cryptoHoldings, spy, btc, fxToUsd });

  // Write — mark previous as inactive, insert new as current
  await supabase.from("analytics_baseline").update({ is_current: false }).eq("is_current", true);
  const { error: insErr } = await supabase.from("analytics_baseline").insert({
    date: today,
    snapshot: baseline,
    is_current: true,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Mirror to KV for client reads
  await supabase.from("app_data").upsert(
    { key: "analytics_baseline", value: JSON.stringify(baseline), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  return NextResponse.json({ baseline });
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Smoke-test the endpoint**

With the dev server running:

```bash
curl -s http://localhost:3000/api/analytics/baseline | head -c 500
```

Expected: `{"baseline":null}` on first run. After POSTing, GET returns the saved baseline.

```bash
curl -s -X POST http://localhost:3000/api/analytics/baseline | head -c 500
```

Expected: `{"baseline":{"date":"2026-04-22",...}}`.

- [ ] **Step 4: Commit**

```bash
git add app/api/analytics/baseline/route.ts
git commit -m "feat(api): analytics baseline GET/POST"
```

---

## Task 5: `/api/crypto/deposits` endpoints

**Files:**
- Create: `app/api/crypto/deposits/route.ts`
- Create: `app/api/crypto/deposits/[id]/route.ts`

- [ ] **Step 1: Write the collection route**

```ts
// app/api/crypto/deposits/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { CryptoDeposit } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

function toCamel(r: Record<string, unknown>): CryptoDeposit {
  return {
    id: r.id as string,
    date: r.date as string,
    token: r.token as string,
    amount: Number(r.amount),
    usdValueAtDeposit: Number(r.usd_value_at_deposit),
    kind: r.kind as "stablecoin" | "crypto",
    notes: (r.notes as string | null) ?? undefined,
    createdAt: new Date(r.created_at as string).getTime(),
  };
}

export async function GET() {
  const { data, error } = await supabase
    .from("crypto_deposits")
    .select("*")
    .order("date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const deposits = (data ?? []).map(toCamel);
  return NextResponse.json({ deposits });
}

export async function POST(req: Request) {
  const body = await req.json() as Partial<CryptoDeposit>;
  if (!body.token || body.amount == null || body.usdValueAtDeposit == null || !body.kind) {
    return NextResponse.json({ error: "token, amount, usdValueAtDeposit, kind required" }, { status: 400 });
  }
  const row = {
    date: body.date ?? new Date().toISOString(),
    token: body.token,
    amount: body.amount,
    usd_value_at_deposit: body.usdValueAtDeposit,
    kind: body.kind,
    notes: body.notes ?? null,
  };
  const { data, error } = await supabase
    .from("crypto_deposits")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deposit: toCamel(data) });
}
```

- [ ] **Step 2: Write the per-id DELETE route**

```ts
// app/api/crypto/deposits/[id]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { error } = await supabase.from("crypto_deposits").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check + smoke test**

```bash
pnpm tsc --noEmit
curl -s http://localhost:3000/api/crypto/deposits
```

Expected: `{"deposits":[]}`.

- [ ] **Step 4: Commit**

```bash
git add app/api/crypto/deposits
git commit -m "feat(api): crypto deposits CRUD endpoints"
```

---

## Task 6: `DepositLogForm` component

**Files:**
- Create: `app/(app)/crypto/_components/deposit-log-form.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CryptoDeposit, CryptoHolding } from "@/lib/utils/types";

interface DepositLogFormProps {
  holdings: CryptoHolding[];
  livePrices: Record<string, number>;
  onSaved: (deposit: CryptoDeposit) => void;
}

export function DepositLogForm({ holdings, livePrices, onSaved }: DepositLogFormProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [usdValue, setUsdValue] = useState<string>("");
  const [kind, setKind] = useState<"stablecoin" | "crypto">("stablecoin");
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function autoFillUsd(nextToken: string, nextAmount: string) {
    const price = livePrices[nextToken];
    const amt = parseFloat(nextAmount);
    if (price != null && Number.isFinite(amt)) setUsdValue((price * amt).toFixed(2));
  }

  async function submit() {
    setError(null);
    if (!token || !amount || !usdValue) { setError("Fill token, amount, and USD value."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/crypto/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, amount: parseFloat(amount), usdValueAtDeposit: parseFloat(usdValue),
          kind, date: `${date}T00:00:00Z`, notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      const { deposit } = await res.json();
      onSaved(deposit);
      setOpen(false);
      setAmount(""); setUsdValue(""); setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setOpen(true)}>
        + Add deposit
      </Button>
    );
  }

  return (
    <div className="finance-card p-4 space-y-3">
      <p className="label-mono">Log Crypto Deposit</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="space-y-1">
          <span className="label-mono block">Token</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={token}
            onChange={(e) => { setToken(e.target.value); autoFillUsd(e.target.value, amount); }}
          >
            <option value="">Select…</option>
            {holdings.map((h) => <option key={h.token} value={h.token}>{h.token}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label-mono block">Kind</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={kind}
            onChange={(e) => setKind(e.target.value as "stablecoin" | "crypto")}
          >
            <option value="stablecoin">Stablecoin</option>
            <option value="crypto">Crypto</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="label-mono block">Amount</span>
          <input
            type="number" step="any"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); autoFillUsd(token, e.target.value); }}
          />
        </label>
        <label className="space-y-1">
          <span className="label-mono block">USD value</span>
          <input
            type="number" step="any"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
            value={usdValue}
            onChange={(e) => setUsdValue(e.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="label-mono block">Date</span>
          <input
            type="date"
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={date} onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="label-mono block">Notes</span>
          <input
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="text-xs text-expense">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save deposit"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/crypto/_components/deposit-log-form.tsx
git commit -m "feat(crypto): DepositLogForm component"
```

---

## Task 7: `DepositList` component

**Files:**
- Create: `app/(app)/crypto/_components/deposit-list.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { Trash2 } from "lucide-react";
import type { CryptoDeposit } from "@/lib/utils/types";

interface DepositListProps {
  deposits: CryptoDeposit[];
  onDeleted: (id: string) => void;
}

export function DepositList({ deposits, onDeleted }: DepositListProps) {
  if (deposits.length === 0) {
    return (
      <div className="finance-card p-4 text-xs text-muted-foreground">
        No deposits logged yet. Use “+ Add deposit” to record stablecoin or crypto inflows.
      </div>
    );
  }

  async function remove(id: string) {
    const ok = window.confirm("Delete this deposit?");
    if (!ok) return;
    const res = await fetch(`/api/crypto/deposits/${id}`, { method: "DELETE" });
    if (res.ok) onDeleted(id);
  }

  return (
    <div className="finance-card p-4 space-y-2">
      <p className="label-mono mb-2">Logged Deposits</p>
      <div className="grid grid-cols-[1fr_80px_100px_110px_60px_28px] gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>Date</span><span>Token</span><span className="text-right">Amount</span>
        <span className="text-right">USD value</span><span>Kind</span><span />
      </div>
      {deposits.map((d) => (
        <div key={d.id} className="grid grid-cols-[1fr_80px_100px_110px_60px_28px] gap-2 text-xs items-center">
          <span>{d.date.slice(0, 10)}</span>
          <span className="font-mono">{d.token}</span>
          <span className="text-right font-mono tabular-nums">{d.amount.toLocaleString()}</span>
          <span className="text-right font-mono tabular-nums">${d.usdValueAtDeposit.toFixed(2)}</span>
          <span className="text-[10px] uppercase text-muted-foreground">{d.kind}</span>
          <button onClick={() => remove(d.id)} className="text-muted-foreground hover:text-expense">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm tsc --noEmit
git add app/\(app\)/crypto/_components/deposit-list.tsx
git commit -m "feat(crypto): DepositList component"
```

---

## Task 8: Mount deposit UI on crypto page

**Files:**
- Modify: `app/(app)/crypto/page.tsx`

- [ ] **Step 1: Add imports near existing component imports** (around line 37)

```tsx
import { DepositLogForm } from "./_components/deposit-log-form";
import { DepositList } from "./_components/deposit-list";
```

Also add `useCloudStorage` is already imported. Add import of type:

```tsx
import type { CryptoDeposit } from "@/lib/utils/types";
```

- [ ] **Step 2: Add state + effect to load deposits** (add just after the `stablecoinTags` useCloudStorage, around line 78)

```tsx
const [deposits, setDeposits] = useState<CryptoDeposit[]>([]);
useEffect(() => {
  fetch("/api/crypto/deposits")
    .then((r) => r.json())
    .then((j) => setDeposits(j.deposits ?? []))
    .catch(() => { /* silent */ });
}, []);
```

(`useState` and `useEffect` are already imported at line 3.)

- [ ] **Step 3: Add the form to the action bar** (inside the `BlurFade delay={0}` block, around line 542 — just before the closing `</div>` of the action bar)

```tsx
<DepositLogForm
  holdings={pricedHoldings}
  livePrices={livePrices}
  onSaved={(d) => setDeposits((prev) => [d, ...prev])}
/>
```

- [ ] **Step 4: Add `DepositList` below `HoldingsBreakdown`** (just before the closing `</div>` at the bottom of the return block, around line 651)

```tsx
<DepositList deposits={deposits} onDeleted={(id) => setDeposits((prev) => prev.filter((d) => d.id !== id))} />
```

- [ ] **Step 5: Type-check, lint, and run the page**

```bash
pnpm tsc --noEmit
pnpm lint
```

Open http://localhost:3000/crypto → verify:
- "+ Add deposit" button appears in action bar
- Click it → form shows
- Select token, enter amount → USD value auto-fills
- Save → deposit appears in the list below holdings
- Delete works

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/crypto/page.tsx
git commit -m "feat(crypto): wire DepositLogForm + DepositList into page"
```

---

## Task 9: Load baseline + deposits on analytics page

**Files:**
- Modify: `app/(app)/analytics/page.tsx`

- [ ] **Step 1: Add imports** (top of file with existing imports)

```tsx
import type { AnalyticsBaseline, CryptoDeposit } from "@/lib/utils/types";
import {
  depositsByDay,
  computeTwrSeries,
  computeBenchmarkSeries,
  holdingPnlSinceBaseline,
  type TwrPoint,
  type BenchmarkPoint,
} from "@/lib/utils/analytics-baseline";
```

- [ ] **Step 2: Add state loaders** (near the top of `AnalyticsPage`, after existing `useCloudStorage` calls)

```tsx
const [baseline, setBaseline] = useState<AnalyticsBaseline | null>(null);
const [cryptoDeposits, setCryptoDeposits] = useState<CryptoDeposit[]>([]);

useEffect(() => {
  fetch("/api/analytics/baseline").then((r) => r.json()).then((j) => setBaseline(j.baseline ?? null)).catch(() => {});
  fetch("/api/crypto/deposits").then((r) => r.json()).then((j) => setCryptoDeposits(j.deposits ?? [])).catch(() => {});
}, []);
```

- [ ] **Step 3: Type-check + commit**

```bash
pnpm tsc --noEmit
git add app/\(app\)/analytics/page.tsx
git commit -m "feat(analytics): load baseline and crypto deposits"
```

---

## Task 10: `NoBaselineEmpty` + `ResetBaselineButton`

**Files:**
- Create: `app/(app)/analytics/_components/no-baseline-empty.tsx`
- Create: `app/(app)/analytics/_components/reset-baseline-button.tsx`

- [ ] **Step 1: Empty state component**

```tsx
// no-baseline-empty.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function NoBaselineEmpty({ onCreated }: { onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setBaseline() {
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/analytics/baseline", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  return (
    <div className="finance-card p-8 text-center space-y-3">
      <p className="label-mono">No baseline set</p>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Set today as your PnL baseline. All charts will reset to 0% and track
        your performance from today forward — comparing against SPY and BTC
        over the same window.
      </p>
      <Button onClick={setBaseline} disabled={saving}>
        {saving ? "Capturing…" : "Set Baseline to Today"}
      </Button>
      {error && <p className="text-xs text-expense">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Reset button component**

```tsx
// reset-baseline-button.tsx
"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function ResetBaselineButton({ baselineDate, onReset }: { baselineDate: string; onReset: () => void }) {
  const [saving, setSaving] = useState(false);
  async function reset() {
    const ok = window.confirm(
      `Replace current baseline (${baselineDate}) with today? Past baseline data is retained but the charts will reset to 0%.`
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch("/api/analytics/baseline", { method: "POST" });
      if (res.ok) onReset();
    } finally { setSaving(false); }
  }
  return (
    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={reset} disabled={saving}>
      <RotateCcw className="h-3 w-3" /> {saving ? "Resetting…" : `Reset baseline (${baselineDate})`}
    </Button>
  );
}
```

- [ ] **Step 3: Mount in `analytics/page.tsx`** (conditional render at top of JSX)

Near the top of the `return` block in `app/(app)/analytics/page.tsx`:

```tsx
if (!baseline) {
  return (
    <div className="p-5">
      <NoBaselineEmpty onCreated={() => fetch("/api/analytics/baseline").then((r) => r.json()).then((j) => setBaseline(j.baseline))} />
    </div>
  );
}
```

Add the reset button as the first element inside the main render (under the existing JSX root):

```tsx
<div className="flex justify-end">
  <ResetBaselineButton
    baselineDate={baseline.date}
    onReset={() => fetch("/api/analytics/baseline").then((r) => r.json()).then((j) => setBaseline(j.baseline))}
  />
</div>
```

Add matching imports at top of `analytics/page.tsx`:

```tsx
import { NoBaselineEmpty } from "./_components/no-baseline-empty";
import { ResetBaselineButton } from "./_components/reset-baseline-button";
```

- [ ] **Step 4: Verify in browser + commit**

```bash
pnpm tsc --noEmit && pnpm lint
```

Open http://localhost:3000/analytics → empty state shows. Click "Set Baseline to Today" → page reloads to full analytics view with Reset button at top.

```bash
git add app/\(app\)/analytics/_components/no-baseline-empty.tsx \
        app/\(app\)/analytics/_components/reset-baseline-button.tsx \
        app/\(app\)/analytics/page.tsx
git commit -m "feat(analytics): empty state + reset baseline button"
```

---

## Task 11: Build TWR + benchmark series in analytics page

**Files:**
- Modify: `app/(app)/analytics/page.tsx`

- [ ] **Step 1: Add series computation** (after the existing `pnlSeries` useMemo, around line 286)

```tsx
// Per-day EOD USD values (portfolio + crypto combined) from snapshots
const dailyValuesUsd = useMemo(() => {
  const map = new Map<string, number>();
  const take = (rows: { date: string; value: number; valueWithSuper?: number }[], kind: "port" | "crypto") => {
    for (const r of rows) {
      const day = r.date.slice(0, 10);
      const v = kind === "port" ? (r.valueWithSuper ?? r.value) : r.value;
      map.set(day, (map.get(day) ?? 0) + v);
    }
  };
  take(portfolioSnapshots as { date: string; value: number; valueWithSuper?: number }[], "port");
  take(cryptoSnapshots as { date: string; value: number }[], "crypto");
  return map;
}, [portfolioSnapshots, cryptoSnapshots]);

const depositsMap = useMemo(() => {
  if (!baseline) return new Map<string, number>();
  return depositsByDay({
    portfolioTxns: portfolioTransactions,
    cryptoDeposits,
    baselineDate: baseline.date,
    fxToUsd: (amount, currency) => convert(amount, currency, "USD"),
  });
}, [baseline, portfolioTransactions, cryptoDeposits, convert]);

const liveCombinedUsd = useMemo(() => {
  const portfolioTotal = livePortfolioHoldings.reduce(
    (s, h) => s + convert(h.currentValue, h.currency, "USD"), 0,
  );
  const cryptoTotal = cryptoHoldings.reduce((s, h) => s + h.currentValueUsd, 0);
  return portfolioTotal + cryptoTotal;
}, [livePortfolioHoldings, cryptoHoldings, convert]);

const twrSeries = useMemo<TwrPoint[]>(() => {
  if (!baseline) return [];
  return computeTwrSeries({
    baseline, dailyValuesUsd, deposits: depositsMap, today, liveValueUsd: liveCombinedUsd,
  });
}, [baseline, dailyValuesUsd, depositsMap, today, liveCombinedUsd]);

const [benchBars, setBenchBars] = useState<{ date: string; btc: number | null; spy: number | null }[]>([]);
useEffect(() => {
  if (!baseline) return;
  fetch(`/api/comparison?from=${baseline.date}&to=${today}`)
    .then((r) => r.json())
    .then((j) => setBenchBars(j.data ?? []))
    .catch(() => setBenchBars([]));
}, [baseline, today]);

const spySeries = useMemo<BenchmarkPoint[]>(() => {
  if (!baseline) return [];
  return computeBenchmarkSeries({
    baselineDate: baseline.date,
    baselinePrice: baseline.benchmarks.spy,
    bars: benchBars.filter((b) => b.spy != null).map((b) => ({ date: b.date, close: b.spy as number })),
    today,
  });
}, [baseline, benchBars, today]);

const btcSeries = useMemo<BenchmarkPoint[]>(() => {
  if (!baseline) return [];
  return computeBenchmarkSeries({
    baselineDate: baseline.date,
    baselinePrice: baseline.benchmarks.btc,
    bars: benchBars.filter((b) => b.btc != null).map((b) => ({ date: b.date, close: b.btc as number })),
    today,
  });
}, [baseline, benchBars, today]);
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm tsc --noEmit
git add app/\(app\)/analytics/page.tsx
git commit -m "feat(analytics): build TWR and benchmark series from baseline"
```

---

## Task 12: Rewire `ComparisonChart` to consume baseline series (hero position)

**Files:**
- Modify: `app/(app)/analytics/_components/comparison-chart.tsx`
- Modify: `app/(app)/analytics/page.tsx`

- [ ] **Step 1: Change `ComparisonChart` props** — top of `comparison-chart.tsx` replace the `ComparisonChartProps` and the entire `series` useMemo:

```tsx
interface ComparisonChartProps {
  twr: { date: string; cumulativePct: number }[];
  spy: { date: string; cumulativePct: number }[];
  btc: { date: string; cumulativePct: number }[];
}

export function ComparisonChart({ twr, spy, btc }: ComparisonChartProps) {
  const series = useMemo<SeriesPoint[]>(() => {
    const portMap = new Map(twr.map((p) => [p.date, p.cumulativePct]));
    const btcMap = new Map(btc.map((p) => [p.date, p.cumulativePct]));
    const spyMap = new Map(spy.map((p) => [p.date, p.cumulativePct]));
    const dates = new Set<string>([...portMap.keys(), ...btcMap.keys(), ...spyMap.keys()]);
    return [...dates].sort().map((date) => ({
      date,
      portfolio: portMap.get(date) ?? null,
      btc: btcMap.get(date) ?? null,
      spy: spyMap.get(date) ?? null,
    }));
  }, [twr, btc, spy]);

  // Remove the `bench`/`loading`/`error`/useEffect fetch block — data is now
  // passed in as props. Also delete the `rangeFrom`/`rangeTo`/useEffect.
  // Keep the `latest` useMemo, `fmtPct`, and the JSX unchanged.
  // ...rest of existing component...
}
```

(Delete the `bench` state, loading/error state, the `useEffect` that fetches `/api/comparison`, and the `cumulativeFromCloses` helper — no longer needed. Leave the Recharts JSX and the `latest` memo intact.)

- [ ] **Step 2: Update the call site in `analytics/page.tsx`** — replace the existing `<ComparisonChart pnlSeries={pnlSeries} />` with:

```tsx
<ComparisonChart twr={twrSeries} spy={spySeries} btc={btcSeries} />
```

Also move the `ComparisonChart` BlurFade above the `PnlHeader` block in the JSX so it's the hero at the top.

- [ ] **Step 3: Verify in browser**

```bash
pnpm tsc --noEmit && pnpm lint
```

Open http://localhost:3000/analytics → Comparison chart now renders at the top, all three lines start at 0% on baseline date.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/analytics/_components/comparison-chart.tsx app/\(app\)/analytics/page.tsx
git commit -m "feat(analytics): ComparisonChart uses baseline-anchored TWR as hero"
```

---

## Task 13: Rewire `PnlHeader` to show $ and % from TWR

**Files:**
- Modify: `app/(app)/analytics/_components/pnl-header.tsx`
- Modify: `app/(app)/analytics/page.tsx`

- [ ] **Step 1: Extend `PnlHeaderProps` and render `%` alongside `$`** — replace the entire `pnl-header.tsx`:

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type PnlRange = "week" | "month" | "year" | "all";

interface PnlHeaderProps {
  todayPnl: number;
  todayPnlPct: number;
  rangePnls: Record<PnlRange, { value: number; pct: number }>;
  estimatedBalance: number;
  format: (amount: number) => string;
  symbol: string;
}

const RANGE_LABELS: Record<PnlRange, string> = { week: "Week", month: "Month", year: "Year", all: "All" };
const RANGE_FULL: Record<PnlRange, string> = { week: "This Week", month: "This Month", year: "This Year", all: "Since baseline" };

function signedPct(p: number) { return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`; }

export function PnlHeader({ todayPnl, todayPnlPct, rangePnls, estimatedBalance, format, symbol }: PnlHeaderProps) {
  const [range, setRange] = useState<PnlRange>("all");
  const rp = rangePnls[range];

  const cellClass = (v: number) =>
    cn("text-lg sm:text-xl font-semibold font-mono tabular-nums",
       v > 0 && "text-income", v < 0 && "text-expense", v === 0 && "text-muted-foreground");

  return (
    <div className="finance-card px-3 py-4 sm:p-5">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="label-mono mb-1">Today&apos;s PnL</p>
          <p className={cellClass(todayPnl)}>
            {todayPnl > 0 ? "+" : todayPnl < 0 ? "-" : ""}{format(Math.abs(todayPnl))}
          </p>
          <p className="text-xs font-mono text-muted-foreground">{signedPct(todayPnlPct)}</p>
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            <p className="label-mono truncate">{RANGE_FULL[range]}</p>
            <div className="ml-auto flex rounded-md bg-secondary p-0.5">
              {(Object.keys(RANGE_LABELS) as PnlRange[]).map((r) => (
                <button key={r} onClick={() => setRange(r)} className={cn(
                  "px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded transition-colors",
                  range === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}>{RANGE_LABELS[r]}</button>
              ))}
            </div>
          </div>
          <p className={cellClass(rp.value)}>
            {rp.value > 0 ? "+" : rp.value < 0 ? "-" : ""}{format(Math.abs(rp.value))}
          </p>
          <p className="text-xs font-mono text-muted-foreground">{signedPct(rp.pct)}</p>
        </div>

        <div>
          <p className="label-mono mb-1">Est. Balance</p>
          <p className="text-lg sm:text-xl font-semibold font-mono tabular-nums">
            {symbol}{format(estimatedBalance).replace(/^[^0-9]*/, "")}
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Compute new `rangePnls` shape in `analytics/page.tsx`** — replace the existing `rangePnls` useMemo:

```tsx
const rangePnls = useMemo<Record<"week" | "month" | "year" | "all", { value: number; pct: number }>>(() => {
  const weekCutoff = new Date(); weekCutoff.setDate(weekCutoff.getDate() - 7);
  const weekStart = weekCutoff.toISOString().slice(0, 10);
  const yearStart = today.slice(0, 4) + "-01-01";
  const start = (d: string) => d < (baseline?.date ?? d) ? (baseline?.date ?? d) : d;

  const at = (d: string): TwrPoint | null => {
    let last: TwrPoint | null = null;
    for (const p of twrSeries) { if (p.date <= d) last = p; else break; }
    return last;
  };

  const rangeBetween = (startDay: string): { value: number; pct: number } => {
    const s = at(startDay);
    const e = at(today);
    if (!s || !e) return { value: 0, pct: 0 };
    const value = convert(e.deltaUsd - s.deltaUsd, "USD");
    // Chained % from startDay+1 → today using TWR
    let factor = 1;
    for (const p of twrSeries) if (p.date > startDay && p.date <= today) factor *= (1 + p.rDay);
    return { value, pct: (factor - 1) * 100 };
  };

  return {
    week: rangeBetween(start(weekStart)),
    month: rangeBetween(start(monthStart)),
    year: rangeBetween(start(yearStart)),
    all: rangeBetween(baseline?.date ?? today),
  };
}, [twrSeries, baseline, today, monthStart, convert]);
```

And compute `todayPnl` + `todayPnlPct` live (replace the existing `todayPnl` const):

```tsx
const todayTwrPoint = twrSeries.length > 0 ? twrSeries[twrSeries.length - 1] : null;
const prevTwrPoint = twrSeries.length > 1 ? twrSeries[twrSeries.length - 2] : null;
const todayPnl = convert(todayTwrPoint ? todayTwrPoint.valueUsd - (prevTwrPoint?.valueUsd ?? baseline?.totals.combinedUsd ?? 0) - todayTwrPoint.depositsUsd : 0, "USD");
const todayPnlPct = todayTwrPoint ? todayTwrPoint.rDay * 100 : 0;
```

Update the JSX call:

```tsx
<PnlHeader
  todayPnl={todayPnl}
  todayPnlPct={todayPnlPct}
  rangePnls={rangePnls}
  estimatedBalance={estimatedBalance}
  format={format}
  symbol={symbol}
/>
```

- [ ] **Step 3: Type-check, lint, browser-verify, commit**

```bash
pnpm tsc --noEmit && pnpm lint
```

Browser: toggle Week/Month/Year/All — both $ and % render correctly. All defaults to "Since baseline".

```bash
git add app/\(app\)/analytics/_components/pnl-header.tsx app/\(app\)/analytics/page.tsx
git commit -m "feat(analytics): PnlHeader shows $ and % via TWR"
```

---

## Task 14: `DailyCalendar` shows % per cell, greys pre-baseline days

**Files:**
- Modify: `app/(app)/analytics/_components/daily-calendar.tsx`

- [ ] **Step 1: Extend props with `baselineDate` and optional `pctByDate`** — add to `DailyCalendarProps`:

```tsx
interface DailyCalendarProps {
  dailyPnl: DailyPnlEntry[];
  format: (amount: number) => string;
  symbol: string;
  baselineDate: string;
  pctByDate: Map<string, number>;  // day → rDay * 100
}
```

- [ ] **Step 2: Render % in each day cell** — inside the day-cell render (around line 180 where `compactPnl` is rendered), add below the $ line:

```tsx
{entry && dayStr >= baselineDate && (
  <span className={cn("text-[9px] font-mono",
    (pctByDate.get(dayStr) ?? 0) > 0 ? "text-income" : (pctByDate.get(dayStr) ?? 0) < 0 ? "text-expense" : "text-muted-foreground")}>
    {(pctByDate.get(dayStr) ?? 0).toFixed(2)}%
  </span>
)}
```

And disable / grey days before baseline:

```tsx
const isPreBaseline = dayStr < baselineDate;
// Add to the day-button className: isPreBaseline && "opacity-30 pointer-events-none"
```

- [ ] **Step 3: Pass props from page** — update the call in `analytics/page.tsx`:

```tsx
const pctByDate = useMemo(() => {
  const m = new Map<string, number>();
  for (const p of twrSeries) m.set(p.date, p.rDay * 100);
  return m;
}, [twrSeries]);

// ...
<DailyCalendar dailyPnl={dailyPnl} format={format} symbol={symbol} baselineDate={baseline.date} pctByDate={pctByDate} />
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm tsc --noEmit && pnpm lint
```

Browser: each day cell shows $ and % below; April 1–baseline_date cells are dimmed.

```bash
git add app/\(app\)/analytics/_components/daily-calendar.tsx app/\(app\)/analytics/page.tsx
git commit -m "feat(analytics): DailyCalendar adds % per cell and greys pre-baseline"
```

---

## Task 15: `PnlByProduct` — split TWR $ between stocks and crypto

**Files:**
- Modify: `app/(app)/analytics/_components/pnl-by-product.tsx`
- Modify: `app/(app)/analytics/page.tsx`

- [ ] **Step 1: Nothing to change in `pnl-by-product.tsx`** — it already accepts `portfolioPnl` and `cryptoPnl` as numbers. Just change the `"Past 30 days"` string to `"Since baseline"` and the values fed in.

Open `pnl-by-product.tsx` line 37: change `"Past 30 days"` → `"Since baseline"`.

- [ ] **Step 2: Compute split from baseline in `analytics/page.tsx`** — add after `twrSeries` is defined:

```tsx
const pnlByProduct = useMemo(() => {
  if (!baseline) return { portfolio: 0, crypto: 0 };
  // Portfolio side: sum(currentValue − baseline_value − stock deposits since baseline)
  const portfolioDepositsUsd = portfolioTransactions
    .filter((t) => t.date.slice(0, 10) > baseline.date)
    .reduce((s, t) => s + (t.type === "buy" ? 1 : -1) * convert(t.totalAmount, t.currency, "USD"), 0);
  const portfolioCurrentUsd = livePortfolioHoldings.reduce(
    (s, h) => s + convert(h.currentValue, h.currency, "USD"), 0,
  );
  const portfolioBaselineUsd = baseline.totals.portfolioUsd;
  const portfolio = portfolioCurrentUsd - portfolioBaselineUsd - portfolioDepositsUsd;

  const cryptoDepositsUsd = cryptoDeposits
    .filter((d) => d.date.slice(0, 10) > baseline.date)
    .reduce((s, d) => s + d.usdValueAtDeposit, 0);
  const cryptoCurrentUsd = cryptoHoldings.reduce((s, h) => s + h.currentValueUsd, 0);
  const cryptoBaselineUsd = baseline.totals.cryptoUsd;
  const crypto = cryptoCurrentUsd - cryptoBaselineUsd - cryptoDepositsUsd;

  return { portfolio: convert(portfolio, "USD"), crypto: convert(crypto, "USD") };
}, [baseline, portfolioTransactions, livePortfolioHoldings, cryptoDeposits, cryptoHoldings, convert]);
```

Replace the existing `<PnlByProduct portfolioPnl={portfolioPnl30d} cryptoPnl={cryptoPnl30d} format={format} />` with:

```tsx
<PnlByProduct portfolioPnl={pnlByProduct.portfolio} cryptoPnl={pnlByProduct.crypto} format={format} />
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm tsc --noEmit && pnpm lint
git add app/\(app\)/analytics/_components/pnl-by-product.tsx app/\(app\)/analytics/page.tsx
git commit -m "feat(analytics): PnlByProduct uses baseline-based split"
```

---

## Task 16: `TopGainersLosers` + `HoldingsPnlTable` use baseline

**Files:**
- Modify: `app/(app)/analytics/page.tsx`
- Modify: `app/(app)/analytics/_components/holdings-pnl-table.tsx`

- [ ] **Step 1: Build per-holding baseline-aware PnL list in `analytics/page.tsx`** — replace the existing `holdingsPnl = useMemo(() => computeHoldingsPnl(...))` with:

```tsx
const holdingsPnl = useMemo(() => {
  if (!baseline) return [];
  const result: HoldingPnl[] = [];

  for (const h of livePortfolioHoldings) {
    const baseEntry = baseline.portfolio[h.id];
    const baseValueUsd = baseEntry?.valueUsd ?? 0;
    const currentUsd = convert(h.currentValue, h.currency, "USD");
    const depositsUsd = portfolioTransactions
      .filter((t) => t.holdingId === h.id && t.date.slice(0, 10) > baseline.date)
      .reduce((s, t) => s + (t.type === "buy" ? 1 : -1) * convert(t.totalAmount, t.currency, "USD"), 0);
    const { pnlUsd, pnlPct } = holdingPnlSinceBaseline({
      baselineValueUsd: baseValueUsd, currentValueUsd: currentUsd, depositsToHoldingUsd: depositsUsd,
    });
    result.push({
      name: h.name, ticker: h.ticker, type: "stock", units: h.units,
      currentValue: convert(currentUsd, "USD"),
      costBasis: convert(baseValueUsd + depositsUsd, "USD"),
      pnl: convert(pnlUsd, "USD"),
      pnlPct,
      currency: h.currency,
    });
  }

  for (const h of cryptoHoldings) {
    const baseEntry = baseline.crypto[h.token];
    const baseValueUsd = baseEntry?.valueUsd ?? 0;
    const depositsUsd = cryptoDeposits
      .filter((d) => d.token === h.token && d.date.slice(0, 10) > baseline.date)
      .reduce((s, d) => s + d.usdValueAtDeposit, 0);
    const { pnlUsd, pnlPct } = holdingPnlSinceBaseline({
      baselineValueUsd: baseValueUsd, currentValueUsd: h.currentValueUsd, depositsToHoldingUsd: depositsUsd,
    });
    result.push({
      name: h.token, ticker: h.token, type: "crypto", units: h.amount,
      currentValue: convert(h.currentValueUsd, "USD"),
      costBasis: convert(baseValueUsd + depositsUsd, "USD"),
      pnl: convert(pnlUsd, "USD"),
      pnlPct,
      currency: "USD",
    });
  }
  return result;
}, [baseline, livePortfolioHoldings, portfolioTransactions, cryptoHoldings, cryptoDeposits, convert]);
```

Also add the import:

```tsx
import type { HoldingPnl } from "@/lib/utils/pnl";
```

- [ ] **Step 2: Rename column "Cost Basis" → "Baseline + deposits" in `holdings-pnl-table.tsx`**

Find the header cell that renders `"Cost Basis"` and replace with `"Baseline + deposits"`. The rest of the table already consumes `holdingsPnl` unchanged.

- [ ] **Step 3: Verify + commit**

```bash
pnpm tsc --noEmit && pnpm lint
```

Browser: Top Gainers and Holdings table now show PnL since baseline. On day zero everything is near 0%. After time passes, they reflect price movement + recorded deposits.

```bash
git add app/\(app\)/analytics/page.tsx app/\(app\)/analytics/_components/holdings-pnl-table.tsx
git commit -m "feat(analytics): per-holding PnL anchored to baseline"
```

---

## Task 17: End-to-end verification in browser

- [ ] **Step 1: Fresh scenario**

1. Reset baseline (click Reset button or first-time Set Baseline).
2. Verify:
   - ComparisonChart shows three lines all starting at **0% on today**
   - PnlHeader "Since baseline" shows **+$0.00 / +0.00%**
   - DailyCalendar: today's cell has no $/% yet (will populate after next cron snapshot)

- [ ] **Step 2: Deposit scenario**

1. Log a $1,000 stablecoin deposit (USDC) on the crypto page.
2. Verify:
   - DepositList shows the row
   - PnlHeader "Since baseline" stays at 0% (deposit doesn't count as PnL)
   - ComparisonChart unaffected

- [ ] **Step 3: Price-movement scenario**

1. Wait for the next cron snapshot (or click "Take snapshot now" in topbar).
2. Verify:
   - PnlHeader shows $ and % reflecting price movement only
   - ComparisonChart your-line moves independently of SPY and BTC
   - HoldingsPnlTable PnL column matches per-holding expectations

- [ ] **Step 4: Reset scenario**

1. Click "Reset baseline".
2. Confirm dialog, click OK.
3. Verify:
   - New baseline captured at today
   - All charts reset to 0%
   - Deposits and snapshots remain in DB (verify via Supabase dashboard or `SELECT` from `crypto_deposits`)

- [ ] **Step 5: Final commit / PR**

No code changes in this task — verification only. If issues found, file them as follow-up tasks rather than amending merged commits.

---

## Self-Review Checklist

After implementation, run:

- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm lint` passes
- [ ] Empty state renders when no baseline exists
- [ ] Baseline POST writes to DB + KV and marks prior rows inactive
- [ ] Deposits POST/GET/DELETE work end-to-end
- [ ] ComparisonChart three lines anchored at 0% on baseline_date
- [ ] PnlHeader toggles all show both $ and %
- [ ] DailyCalendar pre-baseline days greyed
- [ ] TopGainersLosers + HoldingsPnlTable match formula by hand for one stock and one crypto
- [ ] Logging a pure stablecoin deposit leaves "Since baseline" % unchanged

---

## Notes for the implementer

- **SPY Total Return:** Alpaca's `adjustment=all` parameter in `app/api/comparison/route.ts` already returns dividend-adjusted closes. Do **not** try to fetch `^SP500TR` — existing SPY data is equivalent.
- **Live value for "today":** the TWR formula uses `liveValueUsd` for the last point so the chart extends to the current moment even between cron runs. This is already wired in Task 11.
- **Internal swaps (USDC → BTC on exchange):** known limitation. Aggregate TWR stays correct (total value in/out is unchanged); per-token PnL drifts. Documented in the spec's Known Limitations section. A "Log Swap" form can be added later if needed.
- **Currency conversion:** all math is in USD internally; `convert()` is only applied at the display layer. Follow this pattern to avoid double-conversion bugs.
