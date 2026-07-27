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
transactions. **Amended after testing against real data:** the live dataset's
orphans are dominated by renames/experiments with buys and no matching sells
(they'd read as pure losses, e.g. −71%/yr XIRR), so a "Removed: in/out" toggle
(default OUT) controls whether they count in the stats. The aggregated
"Removed holdings" row always renders in the table — with a NOT IN STATS chip
when excluded — so nothing is hidden. Orphans have no `accountType`, so the
include-super filter treats them as normal-account.

## TWR window (amended after testing against real data)

Snapshot history can predate the transaction log (seeded/demo rows — the live
table contains demo values through 2026-04-03 and a $11 garbage day on
2026-04-04). Valuations that precede any logged capital would chain phantom
returns into the index, so the TWR window is clamped to
`max(period start, first logged flow date)`.

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

## Chart colors (validated)

Series colors were validated with the dataviz palette checker on both app
surfaces (#f4f3ed light / #242424 dark): portfolio value/TWR = `ECHARTS_COLORS[0]`
blue in BOTH charts (color follows the entity), net contributions =
`ECHARTS_COLORS[3]` terracotta dashed, S&P 500 = `ECHARTS_COLORS[6]` orange
dashed (purple `[7]` hard-failed the normal-vision separation floor next to
blue; teal `[1]` warned on light-surface contrast). Series-level `color` keeps
legend swatches in sync with line colors.

## Super valuation history (amended 2026-07-27, user-directed)

Super funds have no daily price feed; the recorded `valueWithSuper` snapshot
component is flat between manual updates, then jumps. The performance page
now synthesizes the super series instead (`syntheticSuperSeries`): value(d) =
logged-super-cost-to-date(d) × ratio^frac(d), where ratio = current live
super value ÷ total logged super cost and frac ramps 0→1 from the first
super flow to today. Cost at each contribution date, live value today, gain
accrued at a constant daily rate between (the honest default when the fund's
actual growth path is unknown). Super: in = no-super snapshots + synthetic;
Super: out unchanged; applies in Stocks and All scopes. The `valueWithSuper`
field is no longer read by this page.

## Testing

This is a pnpm project (`pnpm-lock.yaml`) — use `pnpm add -D`, not npm.
Add `vitest` (devDependency) + `"test": "vitest run"` script. Tests only for
`lib/utils/performance.ts`: XIRR against Excel-verified fixtures, TWR
chaining/flow cases, contribution series with mixed currencies, per-holding
stats incl. orphans and closed positions, drift detection. UI follows existing
(untested) page patterns.

## Out of scope (later iterations)

Crypto integration, dividend flows inside XIRR/TWR, selectable benchmarks,
historical-FX-correct conversions.
