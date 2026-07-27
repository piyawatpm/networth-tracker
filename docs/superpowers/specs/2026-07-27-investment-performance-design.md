# Investment Performance Page — Design

**Date:** 2026-07-27
**Status:** Approved (Option A — full performance page)

## Problem

Net worth keeps rising because of top-ups, which says nothing about whether the
investments themselves are earning. The user needs performance measures that
separate "money I added" from "money my money made." v1 covers the stock
portfolio only (crypto follows in a later iteration).

## Decisions locked in with the user

- All buys/sells exist as `portfolio_transactions` (confirmed complete; holding
  creation auto-logs an "Initial holding" buy). A data-quality guard still ships.
- Benchmark comparison: yes, fixed to S&P 500 (SPY) for v1.
- Dividends: shown as an informational stat from `dividend`-type income entries;
  NOT mixed into XIRR/TWR in v1 (income entries aren't linked to holdings).
- Internal math in USD; formatted into display currency at render time.

## Metrics

1. **Net contributions series** — cumulative Σ(buys − sells) per day, USD.
   Sells subtract full proceeds, so `value − contributions` = total profit
   (realized + unrealized).
2. **XIRR** (money-weighted, %/yr) — flows: buys negative, sells positive,
   terminal flow = current portfolio value today. Newton-Raphson with bisection
   fallback. Returns null (renders "—") if flows lack a sign change or the
   earliest flow is < 30 days old.
3. **TWR** (time-weighted) — chained sub-period returns over daily portfolio
   snapshots (already stored in USD): `r_t = (V_t − F_t) / V_{t−1}`, where
   `F_t` = net external flows since the previous snapshot (end-of-period
   convention; snapshot gaps chain across multi-day sub-periods). Window capped
   by snapshot history; the page states "history starts when daily snapshots
   began."
4. **Benchmark** — SPY daily closes; index `100 × close_t / close_start` over
   the selected period; "vs S&P 500" stat = portfolio TWR − SPY return, in
   percentage points.
5. **Per-holding** — cost basis / realized P&L via existing `derivePosition`;
   per-holding XIRR from its own flows (+ current value if units > 0);
   total return % = total gain / gross buys.

## Orphan transactions (deleted holdings)

`handleDelete` on the portfolio page removes the holding but keeps its
transactions. These flows are real history and are INCLUDED in portfolio-level
contributions/XIRR/TWR (excluding them would inflate results). They render as a
single aggregated "Removed holdings" row in the table. Orphans have no
`accountType`, so the include-super filter treats them as normal-account.

## Architecture

### `lib/utils/performance.ts` (new, pure functions, relative imports only)

- `buildContributionSeries(txs, toUsd)` → `{date, contributed}[]`
- `xirr(flows: {date, amount}[])` → `number | null`
- `computeTwrSeries(snapshots, flows)` → `{date, index}[]` + period return
- `perHoldingStats(holdings, txs, toUsd)` → rows incl. orphan aggregate
- `costBasisDrift(holdings, txs, toUsd)` → data-quality warnings

### `app/api/benchmark/route.ts` (new)

GET `?symbol=SPY&from=YYYY-MM-DD` → `{prices: {date, close}[]}` proxying the
Yahoo Finance v8 chart API (same upstream the snapshot cron uses), with
`s-maxage` response caching. Client caches result in localStorage for 12h.
On failure the benchmark line/stat hides; the rest of the page is unaffected.

### `app/(app)/performance/page.tsx` + `_components/`

- `perf-stats.tsx` — 4 stat cards: XIRR · TWR (period) · Net gain $ (with
  dividends-received sub-line) · vs S&P 500 (green/red).
- `value-contributions-chart.tsx` — two-line echarts (lazy-echarts wrapper):
  portfolio value vs net contributions, shaded gap, unified tooltip.
- `growth-chart.tsx` — growth-of-$100: TWR index vs SPY index.
- `holdings-performance-table.tsx` — logo, name, invested, value, gain $,
  return %, XIRR/yr; sorted by XIRR desc; 0-unit positions included; orphan
  aggregate row last.
- Page controls: period selector (3M / 6M / 1Y / All, default All) +
  include-super toggle (default ON, matching portfolio page).
- Data-quality banner when any holding's `amountInvested` drifts > 1% from
  tx-derived cost basis.

### Navigation

`SECONDARY_NAV` first entry: `{ href: "/performance", label: "Performance",
icon: LineChart }` (top bar is already 5 primary items; mobile reaches it via
More).

## Data flow

All reads via existing `useCloudStorage` keys (`portfolio_holdings`,
`portfolio_transactions`, `portfolio_snapshots`) and `useCurrency().convert`
with explicit `"USD"` target for internal math — current FX rates, matching the
app-wide convention used by realized P&L. No new storage keys, no schema
changes, no writes.

## Edge cases

- No snapshots yet → charts show an empty-state note; XIRR/net gain still work
  (transaction-only).
- SPY fetch fails → benchmark UI hides gracefully.
- Flows on days without a snapshot → accumulated into the next sub-period.
- Oversells already clamped inside `derivePosition`.
- `valueWithSuper` vs `value` snapshot fields drive the include-super toggle;
  tx flows are filtered by the holding's `accountType`.

## Testing

Add `vitest` (devDependency) + `"test": "vitest run"` script. Tests only for
`lib/utils/performance.ts`: XIRR against Excel-verified fixtures, TWR
chaining/flow cases, contribution series with mixed currencies, per-holding
stats incl. orphans and closed positions, drift detection. UI follows existing
(untested) page patterns.

## Out of scope (later iterations)

Crypto integration, dividend flows inside XIRR/TWR, selectable benchmarks,
historical-FX-correct conversions.
