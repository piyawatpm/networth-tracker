# Analytics Page + Dashboard PnL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OKX-style `/analytics` page with daily PnL calendar, per-asset PnL table, gainers/losers, allocation donut, and PnL analysis — plus add a combined asset allocation + daily PnL section to the dashboard.

**Architecture:** Pure client-side computation from existing Supabase data (hourly net-worth/portfolio/crypto snapshots + portfolio transactions + crypto CSV). A shared utility module (`lib/utils/pnl.ts`) computes daily PnL by diffing end-of-day snapshots and subtracting cash flows from transactions. The analytics page is a new route `/analytics` with sub-components. The dashboard gets two new cards.

**Tech Stack:** Next.js App Router, `useCloudStorage` hook for Supabase data, `echarts-for-react` for donut chart, Tailwind CSS, `useCurrency()` for formatting/conversion, `lucide-react` icons.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/utils/pnl.ts` | **Create** | Daily PnL computation: snapshot diffing, transaction cash-flow adjustment, calendar data builder, per-asset PnL, win-rate stats |
| `app/(app)/analytics/page.tsx` | **Create** | Analytics page — loads data via `useCloudStorage`, computes derived state, renders sub-components |
| `app/(app)/analytics/_components/pnl-header.tsx` | **Create** | Header stats card: Today's PnL, This month's PnL, Estimated balance |
| `app/(app)/analytics/_components/daily-calendar.tsx` | **Create** | Mon–Sun calendar grid with green/red cells showing daily PnL, month navigation |
| `app/(app)/analytics/_components/pnl-by-product.tsx` | **Create** | Stocks vs Crypto PnL breakdown bars (30-day) |
| `app/(app)/analytics/_components/pnl-analysis.tsx` | **Create** | Win rate, gainers/losers count, cumulative profit/loss stats |
| `app/(app)/analytics/_components/holdings-pnl-table.tsx` | **Create** | Per-holding table: Name, Amount, Value, Current PnL, Current PnL% with sort |
| `app/(app)/analytics/_components/top-gainers-losers.tsx` | **Create** | Tabbed top-10 gainers / top-10 losers ranked by PnL% |
| `app/(app)/analytics/_components/asset-allocation-donut.tsx` | **Create** | ECharts donut showing each individual holding with % share |
| `app/(app)/dashboard/_components/combined-allocation.tsx` | **Create** | Dashboard card: unified donut of every stock + crypto token |
| `app/(app)/dashboard/_components/daily-pnl-strip.tsx` | **Create** | Dashboard card: compact net-worth daily PnL (today + month) |
| `app/(app)/layout.tsx` | **Modify** | Add "Analytics" nav link |
| `app/(app)/dashboard/page.tsx` | **Modify** | Wire new dashboard cards |

---

### Task 1: PnL Computation Utility (`lib/utils/pnl.ts`)

**Files:**
- Create: `lib/utils/pnl.ts`

This is the data engine. All analytics components consume its output.

- [ ] **Step 1: Create `lib/utils/pnl.ts` with types and `computeDailyPnl`**

```typescript
// lib/utils/pnl.ts
import type { PortfolioTransaction, CryptoTransaction, PortfolioHolding, CryptoHolding } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyPnlEntry {
  /** YYYY-MM-DD */
  date: string;
  /** Price-change PnL for stocks (excludes buy/sell cash flow) */
  portfolioPnl: number;
  /** Price-change PnL for crypto (excludes buy/sell cash flow) */
  cryptoPnl: number;
  /** Combined: portfolioPnl + cryptoPnl */
  totalPnl: number;
}

export interface HoldingPnl {
  name: string;
  ticker: string;
  type: "stock" | "crypto";
  units: number;
  currentValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  currency: string;
}

export interface PnlAnalysis {
  winDays: number;
  lossDays: number;
  winRate: number;
  cumulativeProfit: number;
  cumulativeLoss: number;
  totalPnl: number;
}

// ---------------------------------------------------------------------------
// Daily PnL from snapshots + transactions
// ---------------------------------------------------------------------------

/**
 * Build a YYYY-MM-DD → last-snapshot-value map from hourly snapshots.
 * Each snapshot has `{ date: "YYYY-MM-DD HH:MM" | "YYYY-MM-DD", value: number }`.
 * We keep the last snapshot per calendar day (end-of-day value).
 */
function buildDailyMap(
  snapshots: { date: string; value: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of snapshots) {
    const day = s.date.slice(0, 10); // YYYY-MM-DD
    // Last-write-wins — snapshots are chronologically sorted
    map.set(day, s.value);
  }
  return map;
}

/**
 * Sum buy/sell cash flows per day from portfolio transactions.
 * Buys = positive outflow (money going into investments).
 * Sells = negative outflow (money coming out).
 * Returns Map<YYYY-MM-DD, netDeposit>.
 */
function portfolioCashFlowByDay(
  txns: PortfolioTransaction[],
  convert: (amount: number, currency: string) => number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const tx of txns) {
    const day = tx.date.slice(0, 10);
    const amount = convert(tx.totalAmount, tx.currency);
    const prev = map.get(day) ?? 0;
    // Buy = deposit (positive), sell = withdrawal (negative)
    map.set(day, prev + (tx.type === "buy" ? amount : -amount));
  }
  return map;
}

/**
 * Sum buy/sell cash flows per day from crypto transactions.
 */
function cryptoCashFlowByDay(
  txns: CryptoTransaction[],
  convert: (amount: number, currency: string) => number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const tx of txns) {
    if (tx.type !== "buy" && tx.type !== "sell") continue;
    const day = tx.date.slice(0, 10);
    const amount = convert(tx.totalValueUsd ?? 0, "USD");
    const prev = map.get(day) ?? 0;
    map.set(day, prev + (tx.type === "buy" ? amount : -amount));
  }
  return map;
}

/**
 * Compute daily PnL entries from snapshots and transactions.
 *
 * Formula per day:
 *   PnL = (endOfDay value) - (endOfPrevDay value) - (net deposits that day)
 *
 * This isolates price-change returns from cash-flow contributions.
 */
export function computeDailyPnl(
  portfolioSnapshots: { date: string; value: number }[],
  cryptoSnapshots: { date: string; value: number }[],
  portfolioTxns: PortfolioTransaction[],
  cryptoTxns: CryptoTransaction[],
  convert: (amount: number, currency: string) => number,
): DailyPnlEntry[] {
  const portDaily = buildDailyMap(portfolioSnapshots);
  const cryptoDaily = buildDailyMap(cryptoSnapshots);
  const portCF = portfolioCashFlowByDay(portfolioTxns, convert);
  const cryptoCF = cryptoCashFlowByDay(cryptoTxns, convert);

  // Collect all unique dates across both snapshot sets
  const allDays = new Set([...portDaily.keys(), ...cryptoDaily.keys()]);
  const sortedDays = [...allDays].sort();

  const result: DailyPnlEntry[] = [];
  let prevPort = 0;
  let prevCrypto = 0;

  for (const day of sortedDays) {
    const curPort = portDaily.get(day) ?? prevPort;
    const curCrypto = cryptoDaily.get(day) ?? prevCrypto;

    // Only emit entries after the first snapshot (no PnL for day 0)
    if (prevPort > 0 || prevCrypto > 0) {
      const portDeposit = portCF.get(day) ?? 0;
      const cryptoDeposit = cryptoCF.get(day) ?? 0;

      const portfolioPnl = curPort - prevPort - portDeposit;
      const cryptoPnl = curCrypto - prevCrypto - cryptoDeposit;

      result.push({
        date: day,
        portfolioPnl,
        cryptoPnl,
        totalPnl: portfolioPnl + cryptoPnl,
      });
    }

    prevPort = curPort;
    prevCrypto = curCrypto;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-holding current PnL
// ---------------------------------------------------------------------------

export function computeHoldingsPnl(
  portfolioHoldings: PortfolioHolding[],
  cryptoHoldings: CryptoHolding[],
  convert: (amount: number, currency: string) => number,
): HoldingPnl[] {
  const items: HoldingPnl[] = [];

  for (const h of portfolioHoldings) {
    const currentValue = convert(h.currentValue, h.currency);
    const costBasis = convert(h.amountInvested, h.currency);
    items.push({
      name: h.name,
      ticker: h.ticker || h.name,
      type: "stock",
      units: h.units,
      currentValue,
      costBasis,
      pnl: currentValue - costBasis,
      pnlPct: costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0,
      currency: h.currency,
    });
  }

  for (const h of cryptoHoldings) {
    const currentValue = convert(h.currentValueUsd, "USD");
    const costBasis = convert(h.totalCostUsd, "USD");
    items.push({
      name: h.token,
      ticker: h.token,
      type: "crypto",
      units: h.amount,
      currentValue,
      costBasis,
      pnl: currentValue - costBasis,
      pnlPct: costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0,
      currency: "USD",
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// PnL Analysis stats
// ---------------------------------------------------------------------------

export function computePnlAnalysis(dailyPnl: DailyPnlEntry[]): PnlAnalysis {
  let winDays = 0;
  let lossDays = 0;
  let cumulativeProfit = 0;
  let cumulativeLoss = 0;

  for (const d of dailyPnl) {
    if (d.totalPnl > 0) {
      winDays++;
      cumulativeProfit += d.totalPnl;
    } else if (d.totalPnl < 0) {
      lossDays++;
      cumulativeLoss += d.totalPnl;
    }
  }

  const total = winDays + lossDays;
  return {
    winDays,
    lossDays,
    winRate: total > 0 ? (winDays / total) * 100 : 0,
    cumulativeProfit,
    cumulativeLoss,
    totalPnl: cumulativeProfit + cumulativeLoss,
  };
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

/** Get all days in a month as YYYY-MM-DD strings */
export function getMonthDays(year: number, month: number): string[] {
  const days: string[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return days;
}

/** 0=Mon..6=Sun (ISO weekday) for a YYYY-MM-DD string */
export function getISOWeekday(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  return (d.getDay() + 6) % 7; // JS Sun=0 → ISO Mon=0
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/pnl.ts
git commit -m "feat(analytics): add PnL computation utility"
```

---

### Task 2: Analytics Page Shell + Header

**Files:**
- Create: `app/(app)/analytics/page.tsx`
- Create: `app/(app)/analytics/_components/pnl-header.tsx`
- Modify: `app/(app)/layout.tsx:36-49` (add nav link)

- [ ] **Step 1: Add Analytics to navigation**

In `app/(app)/layout.tsx`, add to `SECONDARY_NAV` array (after the Budget entry) and add the `BarChart3` import:

```typescript
// Add to import at top:
import { ..., BarChart3 } from "lucide-react";

// Add to SECONDARY_NAV:
{ href: "/analytics", label: "Analytics", icon: BarChart3 },
```

- [ ] **Step 2: Create `app/(app)/analytics/_components/pnl-header.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils";

interface PnlHeaderProps {
  todayPnl: number;
  monthPnl: number;
  estimatedBalance: number;
  format: (amount: number) => string;
  symbol: string;
}

export function PnlHeader({
  todayPnl,
  monthPnl,
  estimatedBalance,
  format,
  symbol,
}: PnlHeaderProps) {
  const todayPositive = todayPnl >= 0;
  const monthPositive = monthPnl >= 0;

  return (
    <div className="finance-card p-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Today's PnL */}
        <div>
          <p className="label-mono mb-1">Today&apos;s PnL</p>
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums tracking-tight",
              todayPositive ? "text-income" : "text-expense",
            )}
          >
            {todayPositive ? "+" : ""}
            {format(todayPnl)}
          </p>
        </div>

        {/* This Month's PnL */}
        <div>
          <p className="label-mono mb-1">This Month&apos;s PnL</p>
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums tracking-tight",
              monthPositive ? "text-income" : "text-expense",
            )}
          >
            {monthPositive ? "+" : ""}
            {format(monthPnl)}
          </p>
        </div>

        {/* Estimated Balance */}
        <div>
          <p className="label-mono mb-1">Estimated Balance</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {symbol}
            {estimatedBalance.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create analytics page shell `app/(app)/analytics/page.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { parseCryptoCSV, parseAndComputeHoldings, getTotalCryptoValueUsd } from "@/lib/utils/crypto-csv";
import { applyLivePrices, applyStablecoinTags } from "@/lib/utils/crypto-prices";
import { canAutoUpdate } from "@/lib/utils/prices";
import { useAlpacaWs } from "@/components/providers/alpaca-ws-provider";
import { useBinanceWs } from "@/components/providers/binance-ws-provider";
import {
  computeDailyPnl,
  computeHoldingsPnl,
  computePnlAnalysis,
  type DailyPnlEntry,
} from "@/lib/utils/pnl";
import type {
  PortfolioHolding,
  PortfolioTransaction,
  CryptoHolding,
} from "@/lib/utils/types";

import { PnlHeader } from "./_components/pnl-header";
import { DailyCalendar } from "./_components/daily-calendar";
import { PnlByProduct } from "./_components/pnl-by-product";
import { PnlAnalysisCard } from "./_components/pnl-analysis";
import { HoldingsPnlTable } from "./_components/holdings-pnl-table";
import { TopGainersLosers } from "./_components/top-gainers-losers";
import { AssetAllocationDonut } from "./_components/asset-allocation-donut";

export default function AnalyticsPage() {
  // ---- Data sources -------------------------------------------------------
  const [cryptoCsvText] = useCloudStorage<string>("crypto_csv_text", "");
  const [portfolioHoldings] = useCloudStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [portfolioTransactions] = useCloudStorage<PortfolioTransaction[]>("portfolio_transactions", []);
  const [portfolioSnapshots] = useCloudStorage<{ date: string; value: number }[]>("portfolio_snapshots", []);
  const [cryptoSnapshots] = useCloudStorage<{ date: string; value: number }[]>("crypto_snapshots", []);
  const [stablecoinTags] = useCloudStorage<Record<string, boolean>>("crypto_stablecoin_tags", {});
  const [tickerMappings] = useCloudStorage<Record<string, string>>("crypto_ticker_mappings", {});

  const { convert, format, symbol } = useCurrency();

  // ---- Live prices (same pattern as dashboard) ----------------------------
  const stockWsSymbols = useMemo(() => {
    return portfolioHoldings
      .filter((h) => h.ticker && canAutoUpdate(h.ticker) && h.country?.toUpperCase() === "US")
      .map((h) => h.ticker.toUpperCase());
  }, [portfolioHoldings]);
  const { livePrices: finnhubPrices } = useAlpacaWs(stockWsSymbols);

  const rawCryptoHoldings = useMemo(
    () => (cryptoCsvText ? parseAndComputeHoldings(cryptoCsvText) : []),
    [cryptoCsvText],
  );

  const cryptoWsSymbols = useMemo(() => {
    const skip = new Set(["CASH", "USD", "USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD"]);
    const syms: string[] = [];
    for (const h of rawCryptoHoldings) {
      if (stablecoinTags[h.token]) continue;
      const mapped = tickerMappings[h.token];
      if (!mapped) continue;
      const upper = mapped.toUpperCase();
      if (skip.has(upper)) continue;
      const sym = `${upper}USDT`;
      if (!syms.includes(sym)) syms.push(sym);
    }
    return syms;
  }, [rawCryptoHoldings, tickerMappings, stablecoinTags]);
  const { livePrices: binancePrices } = useBinanceWs(cryptoWsSymbols);

  const livePortfolioHoldings = useMemo(() => {
    if (Object.keys(finnhubPrices).length === 0) return portfolioHoldings;
    return portfolioHoldings.map((h) => {
      const trade = finnhubPrices[h.ticker?.toUpperCase()];
      if (!trade) return h;
      const newValue = h.units * trade.price;
      if (Math.abs(newValue - h.currentValue) < 0.01) return h;
      return { ...h, currentValue: newValue };
    });
  }, [portfolioHoldings, finnhubPrices]);

  const cryptoLivePrices = useMemo(() => {
    if (Object.keys(binancePrices).length === 0) return {};
    const mapped: Record<string, number> = {};
    for (const h of rawCryptoHoldings) {
      const ticker = tickerMappings[h.token] ?? h.token;
      const sym = `${ticker.toUpperCase()}USDT`;
      if (binancePrices[sym]) mapped[h.token] = binancePrices[sym].price;
    }
    return mapped;
  }, [binancePrices, rawCryptoHoldings, tickerMappings]);

  const cryptoHoldings = useMemo(() => {
    const tagged = applyStablecoinTags(rawCryptoHoldings, stablecoinTags);
    return applyLivePrices(tagged, cryptoLivePrices);
  }, [rawCryptoHoldings, stablecoinTags, cryptoLivePrices]);

  // ---- Crypto transactions (parsed from CSV) ------------------------------
  const cryptoTxns = useMemo(() => {
    if (!cryptoCsvText) return [];
    try {
      return parseCryptoCSV(cryptoCsvText);
    } catch {
      return [];
    }
  }, [cryptoCsvText]);

  // ---- Derived analytics --------------------------------------------------
  const today = getSydneyDateString();
  const monthStart = today.slice(0, 7) + "-01";

  const dailyPnl = useMemo(
    () => computeDailyPnl(portfolioSnapshots, cryptoSnapshots, portfolioTransactions, cryptoTxns, convert),
    [portfolioSnapshots, cryptoSnapshots, portfolioTransactions, cryptoTxns, convert],
  );

  const todayPnl = useMemo(() => dailyPnl.find((d) => d.date === today)?.totalPnl ?? 0, [dailyPnl, today]);
  const monthPnl = useMemo(
    () => dailyPnl.filter((d) => d.date >= monthStart && d.date <= today).reduce((s, d) => s + d.totalPnl, 0),
    [dailyPnl, monthStart, today],
  );

  // 30-day PnL by product
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);
  const last30 = useMemo(() => dailyPnl.filter((d) => d.date >= thirtyDaysAgo), [dailyPnl, thirtyDaysAgo]);
  const portfolioPnl30d = useMemo(() => last30.reduce((s, d) => s + d.portfolioPnl, 0), [last30]);
  const cryptoPnl30d = useMemo(() => last30.reduce((s, d) => s + d.cryptoPnl, 0), [last30]);

  const holdingsPnl = useMemo(
    () => computeHoldingsPnl(livePortfolioHoldings, cryptoHoldings, convert),
    [livePortfolioHoldings, cryptoHoldings, convert],
  );

  const pnlAnalysis = useMemo(() => computePnlAnalysis(last30), [last30]);

  const estimatedBalance = useMemo(
    () =>
      livePortfolioHoldings.reduce((s, h) => s + convert(h.currentValue, h.currency), 0) +
      convert(getTotalCryptoValueUsd(cryptoHoldings), "USD"),
    [livePortfolioHoldings, cryptoHoldings, convert],
  );

  const D = 0.05;

  return (
    <div className="space-y-6 pb-12">
      {/* Header: Today PnL, Month PnL, Balance */}
      <BlurFade delay={0}>
        <PnlHeader
          todayPnl={todayPnl}
          monthPnl={monthPnl}
          estimatedBalance={estimatedBalance}
          format={format}
          symbol={symbol}
        />
      </BlurFade>

      {/* Daily Calendar */}
      <BlurFade delay={D}>
        <DailyCalendar dailyPnl={dailyPnl} format={format} />
      </BlurFade>

      {/* PnL by Product + PnL Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <BlurFade delay={D * 2}>
          <PnlByProduct
            portfolioPnl={portfolioPnl30d}
            cryptoPnl={cryptoPnl30d}
            format={format}
          />
        </BlurFade>
        <BlurFade delay={D * 3}>
          <PnlAnalysisCard analysis={pnlAnalysis} format={format} />
        </BlurFade>
      </div>

      {/* Asset Allocation Donut */}
      <BlurFade delay={D * 4}>
        <AssetAllocationDonut holdings={holdingsPnl} format={format} symbol={symbol} />
      </BlurFade>

      {/* Top Gainers / Losers */}
      <BlurFade delay={D * 5}>
        <TopGainersLosers holdings={holdingsPnl} format={format} />
      </BlurFade>

      {/* Full Holdings PnL Table */}
      <BlurFade delay={D * 6}>
        <HoldingsPnlTable holdings={holdingsPnl} format={format} symbol={symbol} />
      </BlurFade>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Errors for missing sub-components (expected — we'll create them next).

- [ ] **Step 5: Commit**

```bash
git add app/(app)/analytics/page.tsx app/(app)/analytics/_components/pnl-header.tsx app/(app)/layout.tsx
git commit -m "feat(analytics): add page shell with PnL header and nav link"
```

---

### Task 3: Daily PnL Calendar

**Files:**
- Create: `app/(app)/analytics/_components/daily-calendar.tsx`

- [ ] **Step 1: Create the calendar component**

```tsx
"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { getMonthDays, getISOWeekday, type DailyPnlEntry } from "@/lib/utils/pnl";

interface DailyCalendarProps {
  dailyPnl: DailyPnlEntry[];
  format: (amount: number) => string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DailyCalendar({ dailyPnl, format }: DailyCalendarProps) {
  const today = getSydneyDateString();
  const [year, setYear] = useState(() => parseInt(today.slice(0, 4)));
  const [month, setMonth] = useState(() => parseInt(today.slice(5, 7)));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const pnlMap = useMemo(() => {
    const map = new Map<string, DailyPnlEntry>();
    for (const d of dailyPnl) map.set(d.date, d);
    return map;
  }, [dailyPnl]);

  const days = useMemo(() => getMonthDays(year, month), [year, month]);
  const firstDayOffset = useMemo(() => getISOWeekday(days[0]), [days]);
  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;

  const selectedEntry = selectedDay ? pnlMap.get(selectedDay) : null;

  const goPrev = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
    setSelectedDay(null);
  };
  const goNext = () => {
    const nowY = parseInt(today.slice(0, 4));
    const nowM = parseInt(today.slice(5, 7));
    if (year > nowY || (year === nowY && month >= nowM)) return;
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
    setSelectedDay(null);
  };

  const isCurrentMonth = year === parseInt(today.slice(0, 4)) && month === parseInt(today.slice(5, 7));

  return (
    <div className="finance-card p-5">
      {/* Header with selected-day detail */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="label-mono mb-1">Daily Breakdown</p>
          {selectedEntry ? (
            <>
              <p className="text-xs text-muted-foreground">
                PnL as of {selectedEntry.date}
              </p>
              <p
                className={cn(
                  "text-xl font-semibold tabular-nums mt-0.5",
                  selectedEntry.totalPnl >= 0 ? "text-income" : "text-expense",
                )}
              >
                {selectedEntry.totalPnl >= 0 ? "+" : ""}
                {format(selectedEntry.totalPnl)}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Click a day to see detail
            </p>
          )}
        </div>

        {/* Month nav */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={goPrev}
            className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-secondary/60 transition-colors text-muted-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-mono text-sm tabular-nums min-w-[5.5rem] text-center">
            {monthLabel}
          </span>
          <button
            onClick={goNext}
            disabled={isCurrentMonth}
            className={cn(
              "h-7 w-7 flex items-center justify-center rounded-full transition-colors",
              isCurrentMonth
                ? "text-muted-foreground/30 cursor-not-allowed"
                : "hover:bg-secondary/60 text-muted-foreground",
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-mono text-muted-foreground/60 uppercase"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells before the first day */}
        {Array.from({ length: firstDayOffset }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {days.map((day) => {
          const entry = pnlMap.get(day);
          const isFuture = day > today;
          const isToday = day === today;
          const isSelected = day === selectedDay;
          const pnl = entry?.totalPnl ?? 0;
          const hasData = entry != null;
          const positive = pnl >= 0;
          const dayNum = parseInt(day.slice(8, 10));

          return (
            <button
              key={day}
              type="button"
              disabled={isFuture || !hasData}
              onClick={() => setSelectedDay(isSelected ? null : day)}
              className={cn(
                "relative flex flex-col items-center justify-center rounded-md py-1.5 px-0.5 min-h-[3.5rem] transition-colors text-center",
                isFuture && "opacity-30 cursor-not-allowed",
                !isFuture && !hasData && "opacity-40",
                !isFuture && hasData && positive && "bg-income/8 hover:bg-income/15",
                !isFuture && hasData && !positive && "bg-expense/8 hover:bg-expense/15",
                isSelected && "ring-2 ring-foreground/30",
              )}
            >
              <span className="text-[11px] font-mono text-muted-foreground">
                {isToday ? "Today" : dayNum}
              </span>
              {hasData && (
                <span
                  className={cn(
                    "text-[10px] font-mono tabular-nums mt-0.5 leading-tight",
                    positive ? "text-income" : "text-expense",
                  )}
                >
                  {positive ? "+" : ""}
                  {Math.abs(pnl) >= 1000
                    ? `${(pnl / 1000).toFixed(1)}k`
                    : pnl.toFixed(0)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day breakdown */}
      {selectedEntry && (
        <div className="mt-4 pt-3 border-t border-border/60 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Stocks PnL</p>
            <p
              className={cn(
                "font-mono tabular-nums font-medium",
                selectedEntry.portfolioPnl >= 0 ? "text-income" : "text-expense",
              )}
            >
              {selectedEntry.portfolioPnl >= 0 ? "+" : ""}
              {format(selectedEntry.portfolioPnl)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Crypto PnL</p>
            <p
              className={cn(
                "font-mono tabular-nums font-medium",
                selectedEntry.cryptoPnl >= 0 ? "text-income" : "text-expense",
              )}
            >
              {selectedEntry.cryptoPnl >= 0 ? "+" : ""}
              {format(selectedEntry.cryptoPnl)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors for this file.

- [ ] **Step 3: Commit**

```bash
git add app/(app)/analytics/_components/daily-calendar.tsx
git commit -m "feat(analytics): add daily PnL calendar component"
```

---

### Task 4: PnL by Product + PnL Analysis Cards

**Files:**
- Create: `app/(app)/analytics/_components/pnl-by-product.tsx`
- Create: `app/(app)/analytics/_components/pnl-analysis.tsx`

- [ ] **Step 1: Create PnL by Product**

```tsx
"use client";

import { cn } from "@/lib/utils";

interface PnlByProductProps {
  portfolioPnl: number;
  cryptoPnl: number;
  format: (amount: number) => string;
}

export function PnlByProduct({ portfolioPnl, cryptoPnl, format }: PnlByProductProps) {
  const items = [
    { label: "Stocks", pnl: portfolioPnl, color: "#4d7cc7" },
    { label: "Crypto", pnl: cryptoPnl, color: "#d4a033" },
  ];
  const maxAbs = Math.max(...items.map((i) => Math.abs(i.pnl)), 1);

  return (
    <div className="finance-card p-5 h-full">
      <p className="label-mono mb-1">PnL by Product</p>
      <p className="text-xs text-muted-foreground mb-4">Past 30 days</p>
      <div className="space-y-3">
        {items.map((item) => {
          const positive = item.pnl >= 0;
          const barWidth = Math.min(100, (Math.abs(item.pnl) / maxAbs) * 100);
          return (
            <div key={item.label}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm">{item.label}</span>
                </div>
                <span
                  className={cn(
                    "font-mono tabular-nums text-sm font-medium",
                    positive ? "text-income" : "text-expense",
                  )}
                >
                  {positive ? "+" : ""}
                  {format(item.pnl)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: positive ? "var(--income)" : "var(--expense)",
                    opacity: 0.7,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create PnL Analysis card**

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { PnlAnalysis } from "@/lib/utils/pnl";

interface PnlAnalysisCardProps {
  analysis: PnlAnalysis;
  format: (amount: number) => string;
}

export function PnlAnalysisCard({ analysis, format }: PnlAnalysisCardProps) {
  const rows = [
    {
      label: "Win Rate",
      value: `${analysis.winRate.toFixed(1)}%`,
      className: analysis.winRate >= 50 ? "text-income" : "text-expense",
    },
    { label: "Winning Days", value: String(analysis.winDays), className: "text-income" },
    { label: "Losing Days", value: String(analysis.lossDays), className: "text-expense" },
    {
      label: "Cumulative Profit",
      value: `+${format(analysis.cumulativeProfit)}`,
      className: "text-income",
    },
    {
      label: "Cumulative Loss",
      value: format(analysis.cumulativeLoss),
      className: "text-expense",
    },
  ];

  return (
    <div className="finance-card p-5 h-full">
      <p className="label-mono mb-1">PnL Analysis</p>
      <p className="text-xs text-muted-foreground mb-4">Past 30 days</p>

      {/* Win rate visual */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">Win Rate</span>
          <span
            className={cn(
              "text-lg font-semibold tabular-nums",
              analysis.winRate >= 50 ? "text-income" : "text-expense",
            )}
          >
            {analysis.winRate.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-secondary/40 overflow-hidden flex">
          <div
            className="h-full bg-income/70 transition-all duration-500"
            style={{ width: `${analysis.winRate}%` }}
          />
          <div
            className="h-full bg-expense/70 transition-all duration-500"
            style={{ width: `${100 - analysis.winRate}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] font-mono text-income">
            {analysis.winDays} wins
          </span>
          <span className="text-[10px] font-mono text-expense">
            {analysis.lossDays} losses
          </span>
        </div>
      </div>

      {/* Profit / Loss */}
      <div className="space-y-2 pt-3 border-t border-border/60">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Cumulative Profit</span>
          <span className="font-mono tabular-nums text-sm text-income font-medium">
            +{format(analysis.cumulativeProfit)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Cumulative Loss</span>
          <span className="font-mono tabular-nums text-sm text-expense font-medium">
            {format(analysis.cumulativeLoss)}
          </span>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-sm font-medium">Net PnL</span>
          <span
            className={cn(
              "font-mono tabular-nums text-sm font-semibold",
              analysis.totalPnl >= 0 ? "text-income" : "text-expense",
            )}
          >
            {analysis.totalPnl >= 0 ? "+" : ""}
            {format(analysis.totalPnl)}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/(app)/analytics/_components/pnl-by-product.tsx app/(app)/analytics/_components/pnl-analysis.tsx
git commit -m "feat(analytics): add PnL by product and PnL analysis cards"
```

---

### Task 5: Asset Allocation Donut

**Files:**
- Create: `app/(app)/analytics/_components/asset-allocation-donut.tsx`

- [ ] **Step 1: Create the donut component**

```tsx
"use client";

import { useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { getPieBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import type { HoldingPnl } from "@/lib/utils/pnl";

interface AssetAllocationDonutProps {
  holdings: HoldingPnl[];
  format: (amount: number) => string;
  symbol: string;
}

export function AssetAllocationDonut({ holdings, format, symbol }: AssetAllocationDonutProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartRef = useRef<ReactECharts>(null);

  const { data, total } = useMemo(() => {
    const sorted = [...holdings]
      .filter((h) => h.currentValue > 0)
      .sort((a, b) => b.currentValue - a.currentValue);
    const total = sorted.reduce((s, h) => s + h.currentValue, 0);
    // Show top N individually, group rest as "Other"
    const topN = 10;
    const top = sorted.slice(0, topN);
    const rest = sorted.slice(topN);
    const data = top.map((h) => ({
      name: h.ticker,
      value: Math.round(h.currentValue * 100) / 100,
    }));
    if (rest.length > 0) {
      data.push({
        name: "Other",
        value: Math.round(rest.reduce((s, h) => s + h.currentValue, 0) * 100) / 100,
      });
    }
    return { data, total };
  }, [holdings]);

  const option = useMemo(() => {
    const base = getPieBaseOption(isDark, symbol);
    return {
      ...base,
      series: [
        {
          type: "pie",
          radius: ["50%", "75%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 4,
            borderColor: isDark ? "#1a1a1a" : "#f4f3ed",
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 13,
              fontWeight: "bold",
              formatter: `{b}\n${symbol}{c}`,
            },
          },
          data,
        },
      ],
    };
  }, [data, isDark, symbol]);

  return (
    <div className="finance-card p-5">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="label-mono mb-1">Asset Allocation</p>
          <p className="text-xs text-muted-foreground">
            Total {symbol}
            {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: 240, width: "100%" }}
          notMerge
        />

        {/* Legend list */}
        <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
          {data.map((item, i) => {
            const pct = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <div
                key={item.name}
                className="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-secondary/30 transition-colors"
                onMouseEnter={() => {
                  chartRef.current?.getEchartsInstance().dispatchAction({
                    type: "highlight",
                    seriesIndex: 0,
                    dataIndex: i,
                  });
                }}
                onMouseLeave={() => {
                  chartRef.current?.getEchartsInstance().dispatchAction({
                    type: "downplay",
                    seriesIndex: 0,
                    dataIndex: i,
                  });
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2 w-2 rounded-sm shrink-0"
                    style={{ backgroundColor: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }}
                  />
                  <span className="text-sm truncate">{item.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <span className="font-mono tabular-nums text-sm shrink-0">
                  {format(item.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/(app)/analytics/_components/asset-allocation-donut.tsx
git commit -m "feat(analytics): add asset allocation donut chart"
```

---

### Task 6: Top Gainers/Losers + Holdings PnL Table

**Files:**
- Create: `app/(app)/analytics/_components/top-gainers-losers.tsx`
- Create: `app/(app)/analytics/_components/holdings-pnl-table.tsx`

- [ ] **Step 1: Create Top Gainers/Losers with tabs**

```tsx
"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HoldingPnl } from "@/lib/utils/pnl";

interface TopGainersLosersProps {
  holdings: HoldingPnl[];
  format: (amount: number) => string;
}

export function TopGainersLosers({ holdings, format }: TopGainersLosersProps) {
  const [tab, setTab] = useState<"gainers" | "losers">("gainers");

  const { gainers, losers } = useMemo(() => {
    const sorted = [...holdings].sort((a, b) => b.pnlPct - a.pnlPct);
    return {
      gainers: sorted.filter((h) => h.pnl > 0).slice(0, 10),
      losers: sorted.filter((h) => h.pnl < 0).reverse().slice(0, 10),
    };
  }, [holdings]);

  const items = tab === "gainers" ? gainers : losers;

  return (
    <div className="finance-card p-5">
      <p className="label-mono mb-3">Top 10 {tab === "gainers" ? "Gainers" : "Losers"}</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 rounded-full bg-secondary/40 p-0.5 w-fit">
        {(["gainers", "losers"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1 text-xs font-mono font-medium rounded-full transition-colors capitalize",
              tab === t
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground/50 py-4">
          No {tab} to show
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((h, idx) => {
            const positive = h.pnl > 0;
            return (
              <div
                key={`${h.ticker}-${h.type}`}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground/50 w-5 text-right">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{h.ticker}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">
                      {h.type}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={cn(
                      "font-mono tabular-nums text-sm",
                      positive ? "text-income" : "text-expense",
                    )}
                  >
                    {positive ? "+" : ""}
                    {format(h.pnl)}
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums text-xs min-w-[4rem] text-right",
                      positive ? "text-income" : "text-expense",
                    )}
                  >
                    {positive ? "+" : ""}
                    {h.pnlPct.toFixed(2)}%
                  </span>
                  {positive ? (
                    <ArrowUpRight className="h-3.5 w-3.5 text-income" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5 text-expense" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create Holdings PnL Table**

```tsx
"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HoldingPnl } from "@/lib/utils/pnl";

type SortKey = "name" | "value" | "pnl" | "pnlPct";

interface HoldingsPnlTableProps {
  holdings: HoldingPnl[];
  format: (amount: number) => string;
  symbol: string;
}

export function HoldingsPnlTable({ holdings, format, symbol }: HoldingsPnlTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...holdings];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.ticker.localeCompare(b.ticker);
          break;
        case "value":
          cmp = a.currentValue - b.currentValue;
          break;
        case "pnl":
          cmp = a.pnl - b.pnl;
          break;
        case "pnlPct":
          cmp = a.pnlPct - b.pnlPct;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [holdings, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ label, k, align }: { label: string; k: SortKey; align?: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className={cn(
        "flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors",
        align === "right" && "ml-auto",
      )}
    >
      {label}
      <ArrowUpDown className={cn("h-3 w-3", sortKey === k && "text-foreground")} />
    </button>
  );

  return (
    <div className="finance-card p-5">
      <p className="label-mono mb-4">Holdings PnL</p>

      {/* Header */}
      <div className="grid grid-cols-[1fr_5rem_5rem_5rem_4rem] sm:grid-cols-[1fr_6rem_7rem_7rem_5rem] gap-2 pb-2 border-b border-border/60">
        <SortHeader label="Asset" k="name" />
        <SortHeader label="Units" k="name" align="right" />
        <SortHeader label="Value" k="value" align="right" />
        <SortHeader label="PnL" k="pnl" align="right" />
        <SortHeader label="PnL%" k="pnlPct" align="right" />
      </div>

      {/* Rows */}
      <div className="divide-y divide-border/30 max-h-[28rem] overflow-y-auto">
        {sorted.map((h) => {
          const positive = h.pnl >= 0;
          return (
            <div
              key={`${h.ticker}-${h.type}`}
              className="grid grid-cols-[1fr_5rem_5rem_5rem_4rem] sm:grid-cols-[1fr_6rem_7rem_7rem_5rem] gap-2 py-2.5 items-center hover:bg-secondary/20 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{h.ticker}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{h.type}</p>
              </div>
              <p className="font-mono tabular-nums text-xs text-right text-muted-foreground">
                {h.units < 1 ? h.units.toPrecision(4) : h.units.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
              <p className="font-mono tabular-nums text-sm text-right">
                {format(h.currentValue)}
              </p>
              <p
                className={cn(
                  "font-mono tabular-nums text-sm text-right font-medium",
                  positive ? "text-income" : "text-expense",
                )}
              >
                {positive ? "+" : ""}
                {format(h.pnl)}
              </p>
              <p
                className={cn(
                  "font-mono tabular-nums text-xs text-right",
                  positive ? "text-income" : "text-expense",
                )}
              >
                {positive ? "+" : ""}
                {h.pnlPct.toFixed(1)}%
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/(app)/analytics/_components/top-gainers-losers.tsx app/(app)/analytics/_components/holdings-pnl-table.tsx
git commit -m "feat(analytics): add top gainers/losers and holdings PnL table"
```

---

### Task 7: Dashboard Cards — Combined Allocation + Daily PnL

**Files:**
- Create: `app/(app)/dashboard/_components/combined-allocation.tsx`
- Create: `app/(app)/dashboard/_components/daily-pnl-strip.tsx`
- Modify: `app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Create Combined Allocation card for dashboard**

```tsx
"use client";

import { useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { getPieBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";
import type { PortfolioHolding, CryptoHolding } from "@/lib/utils/types";

interface CombinedAllocationProps {
  portfolioHoldings: PortfolioHolding[];
  cryptoHoldings: CryptoHolding[];
  convert: (amount: number, currency: string) => number;
  format: (amount: number) => string;
  symbol: string;
  delay: number;
}

export function CombinedAllocation({
  portfolioHoldings,
  cryptoHoldings,
  convert,
  format,
  symbol,
  delay,
}: CombinedAllocationProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartRef = useRef<ReactECharts>(null);

  const { data, total } = useMemo(() => {
    const items: { name: string; value: number; type: string }[] = [];

    for (const h of portfolioHoldings) {
      items.push({
        name: h.ticker || h.name,
        value: convert(h.currentValue, h.currency),
        type: "stock",
      });
    }
    for (const h of cryptoHoldings) {
      items.push({
        name: h.token,
        value: convert(h.currentValueUsd, "USD"),
        type: "crypto",
      });
    }

    const sorted = items
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = sorted.reduce((s, i) => s + i.value, 0);

    // Top 10 + Other
    const top = sorted.slice(0, 10);
    const rest = sorted.slice(10);
    const data = top.map((i) => ({ name: i.name, value: Math.round(i.value * 100) / 100 }));
    if (rest.length > 0) {
      data.push({ name: "Other", value: Math.round(rest.reduce((s, i) => s + i.value, 0) * 100) / 100 });
    }
    return { data, total };
  }, [portfolioHoldings, cryptoHoldings, convert]);

  const option = useMemo(() => {
    const base = getPieBaseOption(isDark, symbol);
    return {
      ...base,
      series: [
        {
          type: "pie",
          radius: ["50%", "75%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 4,
            borderColor: isDark ? "#1a1a1a" : "#f4f3ed",
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 13,
              fontWeight: "bold",
              formatter: `{b}\n${symbol}{c}`,
            },
          },
          data,
        },
      ],
    };
  }, [data, isDark, symbol]);

  if (data.length === 0) return null;

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="label-mono mb-1">All Assets</p>
            <p className="text-xs text-muted-foreground">
              {data.length} holdings · {symbol}
              {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: 220, width: "100%" }}
            notMerge
          />

          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {data.map((item, i) => {
              const pct = total > 0 ? (item.value / total) * 100 : 0;
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-secondary/30 transition-colors"
                  onMouseEnter={() => {
                    chartRef.current?.getEchartsInstance().dispatchAction({
                      type: "highlight",
                      seriesIndex: 0,
                      dataIndex: i,
                    });
                  }}
                  onMouseLeave={() => {
                    chartRef.current?.getEchartsInstance().dispatchAction({
                      type: "downplay",
                      seriesIndex: 0,
                      dataIndex: i,
                    });
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2 w-2 rounded-sm shrink-0"
                      style={{ backgroundColor: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }}
                    />
                    <span className="text-sm truncate">{item.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <span className="font-mono tabular-nums text-sm shrink-0">
                    {format(item.value)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
```

- [ ] **Step 2: Create Daily PnL Strip for dashboard**

```tsx
"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { getSydneyDateString } from "@/lib/utils/timezone";

interface DailyPnlStripProps {
  /** Net-worth snapshots with { date, value } — we diff end-of-day values */
  nwSnapshots: { date: string; value: number }[];
  format: (amount: number) => string;
  delay: number;
}

export function DailyPnlStrip({ nwSnapshots, format, delay }: DailyPnlStripProps) {
  const today = getSydneyDateString();
  const monthStart = today.slice(0, 7) + "-01";

  // Build day → last snapshot value
  const dailyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of nwSnapshots) {
      map.set(s.date.slice(0, 10), s.value);
    }
    return map;
  }, [nwSnapshots]);

  // Find previous day with data relative to today
  const sortedDays = useMemo(() => [...dailyMap.keys()].sort(), [dailyMap]);

  const todayVal = dailyMap.get(today) ?? 0;
  const prevDay = sortedDays.filter((d) => d < today).pop();
  const prevVal = prevDay ? (dailyMap.get(prevDay) ?? 0) : 0;

  const todayPnl = prevVal > 0 ? todayVal - prevVal : 0;
  const todayPct = prevVal > 0 ? (todayPnl / prevVal) * 100 : 0;

  // Month PnL: last snapshot today - last snapshot before monthStart
  const preMonthDay = sortedDays.filter((d) => d < monthStart).pop();
  const preMonthVal = preMonthDay ? (dailyMap.get(preMonthDay) ?? 0) : 0;
  const monthPnl = preMonthVal > 0 ? todayVal - preMonthVal : 0;
  const monthPct = preMonthVal > 0 ? (monthPnl / preMonthVal) * 100 : 0;

  if (todayPnl === 0 && monthPnl === 0) return null;

  const todayPositive = todayPnl >= 0;
  const monthPositive = monthPnl >= 0;

  return (
    <BlurFade delay={delay}>
      <div className="finance-card px-5 py-4">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                Today
              </p>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "font-mono tabular-nums text-sm font-semibold",
                    todayPositive ? "text-income" : "text-expense",
                  )}
                >
                  {todayPositive ? "+" : ""}
                  {format(todayPnl)}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-mono tabular-nums",
                    todayPositive ? "text-income" : "text-expense",
                  )}
                >
                  ({todayPositive ? "+" : ""}
                  {todayPct.toFixed(2)}%)
                </span>
              </div>
            </div>

            <div className="h-6 w-px bg-border/60" />

            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                This Month
              </p>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "font-mono tabular-nums text-sm font-semibold",
                    monthPositive ? "text-income" : "text-expense",
                  )}
                >
                  {monthPositive ? "+" : ""}
                  {format(monthPnl)}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-mono tabular-nums",
                    monthPositive ? "text-income" : "text-expense",
                  )}
                >
                  ({monthPositive ? "+" : ""}
                  {monthPct.toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
```

- [ ] **Step 3: Wire dashboard cards**

In `app/(app)/dashboard/page.tsx`:

Add imports at the top (alongside existing imports):
```typescript
import { CombinedAllocation } from "./_components/combined-allocation";
import { DailyPnlStrip } from "./_components/daily-pnl-strip";
```

Then in the JSX — insert the DailyPnlStrip right after the net worth PerformanceChart `</BlurFade>`, and the CombinedAllocation after the existing WorldDistributionChart block:

After the net worth chart closing `</BlurFade>` (around line 691):
```tsx
      {/* Net Worth Daily PnL */}
      <DailyPnlStrip
        nwSnapshots={nwChartSnapshots}
        format={format}
        delay={D * 0.15}
      />
```

After the existing WorldDistributionChart section (around line 720):
```tsx
        {/* Combined all-assets allocation */}
        <CombinedAllocation
          portfolioHoldings={livePortfolioHoldings}
          cryptoHoldings={cryptoHoldings}
          convert={convert}
          format={format}
          symbol={symbol}
          delay={D * 3}
        />
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/dashboard/_components/combined-allocation.tsx app/(app)/dashboard/_components/daily-pnl-strip.tsx app/(app)/dashboard/page.tsx
git commit -m "feat(dashboard): add combined allocation donut and daily PnL strip"
```

---

### Task 8: Verify & Polish

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: Clean compile, zero errors.

- [ ] **Step 2: Start dev server and test**

Run: `npm run dev`

Test checklist:
- [ ] Navigate to `/analytics` — page renders with header, calendar, cards
- [ ] Calendar shows green/red cells with PnL values for days with snapshot data
- [ ] Click a calendar cell — shows detail breakdown (Stocks PnL + Crypto PnL)
- [ ] Month navigation works (back months, forward disabled for current)
- [ ] PnL by Product shows Stocks vs Crypto bars
- [ ] PnL Analysis shows win rate, cumulative profit/loss
- [ ] Asset allocation donut shows individual holdings with hover highlight
- [ ] Top Gainers/Losers tabs switch correctly
- [ ] Holdings PnL table sorts by all columns
- [ ] Dashboard: DailyPnlStrip shows below net worth chart (Today + This Month)
- [ ] Dashboard: CombinedAllocation donut shows all stocks + crypto tokens
- [ ] Nav: "Analytics" appears in the "More" dropdown

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(analytics): polish and bug fixes from testing"
```
