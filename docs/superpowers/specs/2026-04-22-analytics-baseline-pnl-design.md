# Analytics Redesign — Baseline PnL + Benchmark Comparison

**Date:** 2026-04-22
**Status:** Design (pending implementation plan)

## Problem

The analytics page's "All-time" PnL mixes realized + unrealized PnL since the very first transaction. The user wants to:

1. **Reset the PnL reference point to today** ("baseline = today, gain = 0").
2. **Track daily unrealized PnL in both $ and %** going forward.
3. **Compare portfolio performance** against **SPY** and **BTC** over the same window.
4. Support **ongoing deposits** — stocks via existing transactions, crypto via a new manual deposit log.
5. Keep using the **Portfolio Overview CSV** from CoinMarketCap as the crypto holdings source.

## Goals

- Single source of truth for "where did I start" → `analytics_baseline` record.
- Standard, defensible math (Time-Weighted Return) so benchmark comparison is apples-to-apples.
- Reuse existing analytics cards; rewire the math rather than rebuild the UI.
- Zero destructive writes to existing snapshots — reset is reversible.

## Non-Goals

- Money-Weighted Return (MWR/IRR). TWR is sufficient for the stated goal.
- Historical backfill of pre-baseline data.
- Auto-detect crypto deposits by diffing Overview CSVs (user will log manually).
- Replacing the Portfolio Overview CSV workflow.

## Architecture

### Data model

Two new storage keys in `app_data` (KV) + mirrored relational tables.

#### `analytics_baseline` (single record, replaceable)

```ts
interface AnalyticsBaseline {
  date: string;                    // "YYYY-MM-DD" — the day Reset was hit
  createdAt: number;               // epoch ms
  portfolio: Record<string, {      // keyed by holding.id
    units: number;
    priceUsd: number;              // close on baseline_date in USD
    valueUsd: number;              // units × priceUsd
    currency: string;              // native currency at time of baseline
    accountType?: "super" | "normal";
  }>;
  crypto: Record<string, {         // keyed by token symbol
    amount: number;
    priceUsd: number;
    valueUsd: number;
  }>;
  benchmarks: {
    spy: number;                   // SPY Total Return Index close on baseline_date
    btc: number;                   // BTC-USD close on baseline_date
  };
  totals: {
    portfolioUsd: number;          // sum of portfolio.*.valueUsd
    cryptoUsd: number;             // sum of crypto.*.valueUsd
    combinedUsd: number;
  };
}
```

#### `crypto_deposits` (append-only ledger)

```ts
interface CryptoDeposit {
  id: string;                      // uuid
  date: string;                    // ISO timestamp
  token: string;                   // "USDC", "ETH", "BTC", etc.
  amount: number;                  // token units deposited
  usdValueAtDeposit: number;       // market value at deposit time
  kind: "stablecoin" | "crypto";
  notes?: string;
}
```

Stocks already have `portfolio_transactions` — no new table needed there. Buys = deposits, sells = withdrawals.

#### Relational table mirror

Matching tables in Supabase:

```sql
create table analytics_baseline (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  created_at    timestamptz not null default now(),
  snapshot      jsonb not null,         -- full AnalyticsBaseline payload
  is_current    boolean not null default true
);
create unique index on analytics_baseline (is_current) where is_current;

create table crypto_deposits (
  id                    uuid primary key default gen_random_uuid(),
  date                  timestamptz not null,
  token                 text not null,
  amount                numeric not null,
  usd_value_at_deposit  numeric not null,
  kind                  text not null check (kind in ('stablecoin','crypto')),
  notes                 text,
  created_at            timestamptz not null default now()
);
```

`analytics_baseline.is_current` keeps history of past resets (unique partial index ensures only one active).

### Math: Time-Weighted Return (TWR)

For each day `d ≥ baseline_date`:

```
deposits_d     = Σ(stock buy USD on d) − Σ(stock sell USD on d) + Σ(crypto_deposits.usdValueAtDeposit on d)
value_d        = EOD total USD value (from latest snapshot on d, or live if d = today)
r_d            = (value_d − value_{d−1} − deposits_d) / (value_{d−1} + deposits_d)

cumulative_d   = Π_{i ≤ d}(1 + r_i) − 1
```

Benchmark (no deposits):

```
r_bench_d      = price_d / price_baseline − 1
```

All three series start at **0% on `baseline_date`**. Chart plots cumulative % through today.

**Currency:** Everything computed in USD server-side; display layer converts via the existing `convert()` currency provider.

### Component wiring

| Component | File | Change |
|---|---|---|
| **PnlHeader** | `app/(app)/analytics/_components/pnl-header.tsx` | Three cells unchanged in layout. **Today's PnL** now uses live WS prices vs yesterday's EOD snapshot (minus today's deposits). **Range PnL** toggle (Week/Month/Year/**All**) shows both $ and % via TWR since baseline, clamped to start ≥ baseline_date. **Est. Balance** unchanged. |
| **ComparisonChart** | `app/(app)/analytics/_components/comparison-chart.tsx` | Move to top as the hero. Data source switches from current `pnlSeries` (ROI vs cost) to TWR cumulative % since baseline. 3 lines anchored at 0% on baseline_date. |
| **DailyCalendar** | `app/(app)/analytics/_components/daily-calendar.tsx` | Each cell shows $ PnL and %. Days before baseline rendered as empty/greyed. |
| **PnlByProduct** | `app/(app)/analytics/_components/pnl-by-product.tsx` | TWR split by stocks vs crypto over window. |
| **AssetAllocationDonut** | `app/(app)/analytics/_components/asset-allocation-donut.tsx` | Unchanged (always current). |
| **TopGainersLosers** | `app/(app)/analytics/_components/top-gainers-losers.tsx` | Per-holding % = `(current_value − baseline_value − deposits_to_holding) / (baseline_value + deposits_to_holding)`. |
| **HoldingsPnlTable** | `app/(app)/analytics/_components/holdings-pnl-table.tsx` | Per-holding PnL $ and % since baseline. New column "Deposits since baseline" for transparency. |

New components:

| Component | Location | Purpose |
|---|---|---|
| **ResetBaselineButton** | `app/(app)/analytics/_components/reset-baseline-button.tsx` | Confirm dialog → captures current state → writes baseline. |
| **DepositLogForm** | `app/(app)/crypto/_components/deposit-log-form.tsx` | Modal on crypto page. Fields: date, token, amount, USD value (auto-fill from live price), kind. |
| **DepositList** | `app/(app)/crypto/_components/deposit-list.tsx` | Read-only table of past deposits, with edit/delete per row. |

### New utility module

`lib/utils/analytics-baseline.ts`

```ts
export function captureBaseline(
  holdings: PortfolioHolding[],
  cryptoHoldings: CryptoHolding[],
  spy: number,
  btc: number,
): AnalyticsBaseline;

export function depositsByDay(
  portfolioTxns: PortfolioTransaction[],
  cryptoDeposits: CryptoDeposit[],
  baselineDate: string,
  toUsd: (amount: number, currency: string) => number,
): Map<string, number>;

export function computeTwrSeries(params: {
  baseline: AnalyticsBaseline;
  snapshots: { date: string; portfolioUsd: number; cryptoUsd: number }[];
  deposits: Map<string, number>;            // day -> net deposits USD
  today: string;
  liveValueUsd?: number;                    // optional live value for today
}): { date: string; cumulativePct: number; deltaUsd: number }[];

export function computeBenchmarkSeries(
  baselinePrice: number,
  bars: { date: string; close: number }[],
): { date: string; cumulativePct: number }[];

export function holdingPnlSinceBaseline(
  baseline: AnalyticsBaseline,
  currentValueUsd: number,
  depositsToHoldingUsd: number,
): { pnlUsd: number; pnlPct: number };
```

### API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/analytics/baseline` | `POST` | Capture current state → write new `analytics_baseline`, set previous to `is_current=false`. Fetches SPY+BTC close for today. |
| `/api/analytics/baseline` | `GET` | Return current baseline. |
| `/api/crypto/deposits` | `GET` / `POST` / `DELETE /:id` | CRUD for deposit ledger. |
| `/api/comparison` | `GET` | **Existing** — extend to optionally return SPY Total Return Index (ticker `^SP500TR` or `SPYTR`). Falls back to `SPY` if TR not available. |

### Snapshot cadence

- **Keep daily cron** at `00:00 UTC` in `vercel.json` — this is the official EOD anchor for the TWR chain.
- **Intraday "Today" values** use live WS prices (Alpaca + Binance, already wired) for real-time Today's PnL and allocation donut — no cron changes needed.
- **Manual "Take snapshot now"** button already exists in the topbar — retained for ad-hoc intraday capture.
- Optional future: bump cron to hourly if the user wants intraday resolution in the cumulative chart. Not required for MVP.

## Data Flow

### On Reset Baseline

```
User clicks Reset Baseline
  → ResetBaselineButton confirms
  → POST /api/analytics/baseline
      → read portfolio_holdings, parseAndComputeHoldings(crypto_csv_text), crypto_prices
      → fetch today's SPY Total Return close + BTC close
      → build AnalyticsBaseline payload
      → mark previous analytics_baseline is_current=false
      → insert new row with is_current=true
      → mirror to app_data["analytics_baseline"]
  → client refetches, analytics page re-renders from 0%
```

### On Log Deposit (crypto)

```
User opens DepositLogForm
  → picks token (dropdown of current holdings + common stablecoins)
  → enters amount; usdValue auto-fills from live price (editable)
  → POST /api/crypto/deposits
      → insert into crypto_deposits table
      → update app_data["crypto_deposits"] array
  → client refetches → deposit appears in DepositList
  → next TWR compute uses new deposit
```

### On analytics page render

```
Load: analytics_baseline, crypto_deposits, portfolio_transactions,
      portfolio_snapshots, crypto_snapshots, portfolio_holdings,
      crypto_csv_text, live prices

Filter snapshots to date >= baseline.date
Build deposits-by-day map (stock txns + crypto deposits, USD)
computeTwrSeries() → portfolio cumulative %
Fetch /api/comparison → SPY TR + BTC closes
computeBenchmarkSeries() × 2
Render ComparisonChart (3 lines)
Populate PnlHeader ranges via TWR over week/month/year/all
Populate per-holding cards via holdingPnlSinceBaseline()
```

## UI Changes (at a glance)

**Analytics page, top to bottom:**

1. **PnL Header** (Today live / Week / Month / Year / **All**, each showing $ + %)
2. **ComparisonChart** (hero) — You vs SPY TR vs BTC, % since baseline
3. **Daily Calendar** (with $ and %; pre-baseline greyed)
4. Two-column: **PnL by Product** | **PnL Analysis**
5. **Asset Allocation Donut**
6. **Top Gainers / Losers**
7. **Holdings PnL Table** (new "Deposits since baseline" column)
8. **Reset Baseline** button in the page action bar (or topbar), confirm dialog

**Crypto page additions:**

- **+ Add Deposit** button in the action bar
- **DepositList** card below HoldingsBreakdown

## Error Handling

- Baseline capture fails if SPY/BTC fetch fails → show error toast, do not write partial baseline.
- Deposit with unknown token → accept, warn user that USD value may not auto-fill.
- Missing snapshots for a day between baseline and today → carry forward last known value (same policy as existing `reconstructCryptoSnapshots`).
- No baseline set yet → analytics page shows an empty state with a single "Set Baseline to Today" CTA.

## Known Limitations

- **Internal swaps aren't detected.** The Portfolio Overview CSV only shows current holdings, not swap transactions. If the user swaps USDC → BTC on an exchange, the next CSV shows USDC down and BTC up, but no swap record exists. Aggregate TWR (total portfolio vs SPY/BTC) is correct because total value in/out is unchanged. **Per-token** PnL is best-effort: the "Holdings PnL" column will drift when swaps occur, showing a fake loss on the sold token and a fake gain on the bought token. This matches CoinMarketCap's behavior and is a known tradeoff of using snapshot-based crypto tracking.
- **Mitigation:** A "Log Swap" form can be added later if per-token accuracy becomes important.

## Testing

- Unit tests for `computeTwrSeries` with known sequences:
  - No deposits → cumulative matches simple price change
  - Deposit mid-window → TWR ignores deposit, benchmark unaffected
  - Withdrawal (stock sell) → TWR handles negative deposits_day
  - Zero prior value → first-day r_d guarded against divide-by-zero
- Unit tests for `holdingPnlSinceBaseline` with and without deposits.
- Integration test for `/api/analytics/baseline` POST → GET round-trip.
- Manual: reset baseline, verify all three lines start at 0%; log a $1000 stablecoin deposit, verify your line doesn't jump but benchmarks stay unchanged.

## Migration / Rollout

1. Ship behind no flag — additive only.
2. On first visit after deploy, if no `analytics_baseline` exists, show the "Set Baseline to Today" empty state. User opts in.
3. Before baseline is set, analytics page falls back to the existing HoldingsPnl math so nothing regresses.
4. `crypto_deposits` table created via migration; empty ledger is fine.

## Open Questions

None blocking. Noted for future:

- Should deposits support non-USD currencies directly (e.g., AUD bank transfer valued in AUD at time of deposit)? MVP uses USD only.
- Should baseline support "as-of date in the past" (not just today)? MVP is today-only.
- Should the page allow multiple named baselines (e.g., "2026 YTD", "post-layoff")? MVP is single current baseline.
