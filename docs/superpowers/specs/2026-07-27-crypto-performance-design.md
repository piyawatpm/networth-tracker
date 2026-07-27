# Crypto in the Performance Page — Design

**Date:** 2026-07-27
**Status:** Approved (Option A — scope switcher with combined view)
**Builds on:** `2026-07-27-investment-performance-design.md` (stocks v1, shipped)

## Problem

`/performance` covers stocks only. The user's crypto activity (bots, yield,
active trading across Binance/Gate/OKX, logged via CSV uploads) needs the same
XIRR/TWR/benchmark treatment, plus a combined all-assets view.

## Decisions locked in with the user

- **Pot model:** the crypto investment pot = non-stablecoin tokens. Stablecoins
  are the cash layer (matches the app's existing cash/stablecoin tags).
- **Flow semantics** (from inspecting the real CSV — 313 txs, 115 transfers of
  which 109 unpriced): non-stable **buys = deposits** into the pot, non-stable
  **sells = withdrawals**, **transfers = zero-flow** (they're bot profits/yield
  → pure return), **stablecoin rows ignored** (cash management).
- **Benchmarks (crypto scope): both BTC and SPY** overlaid; "vs BTC" is the
  primary stat with "vs SPY" as the sub-line.
- Scope switcher **Stocks | Crypto | All**, default **All**.

## Cash-like token boundary

`isCashLikeToken(token, stablecoinTags)` (new, in crypto-performance.ts) =
`isStablecoin(token)` (exported from crypto-csv.ts — currently internal)
OR `stablecoinTags[token] === true` (symbol-keyed user tags)
OR token ∈ PEGGED_EXTRAS = {USDE, USDG, GUSD, SYRUPUSDC} — dollar-pegged
tokens the base classifier misses (yield-prefix exclusion catches syrupUSDC;
USDe/USDG/GUSD aren't in its name list). XAUt (gold) is NOT cash — it's an
investment.

## Crypto math — `lib/utils/crypto-performance.ts` (new, pure, vitest-covered)

Consumes `CryptoTransaction[]` (parsed from `crypto_tx_csv_text` by the
existing `parseCryptoCSV`) and the crypto snapshot series. All USD.

- `cryptoNetFlowsByDay(txs, isCash)` → `DailyFlow[]`: +totalValueUsd for
  non-cash buys, −totalValueUsd for non-cash sells; rows with null
  totalValueUsd skipped (every buy/sell in the live CSV is priced; guard
  anyway); transfers and cash-token rows contribute nothing.
- `stableBalanceByDay(txs, isCash)` → `{date, balance}[]`: cumulative cash
  amount (buy/transferIn +, sell/transferOut −) per day, $1 per unit, floored
  at 0.
- `cryptoPotValues(snapshotValues, stableBalance)` → `{date, value}[]`:
  per snapshot day, `max(0, snapshotValue − forwardFilledStableBalance)`;
  zero/negative days dropped (same rule as `dailySnapshotValues`).
- `perTokenStats(txs, livePrices, isCash, todayIso)` → `HoldingPerfRow[]`:
  one row per non-cash token using the existing `computeHoldings` (remaining
  cost basis, amount) + `computeRealizedPnl` (realized per token);
  `valueUsd = amount × livePrice` (from the `crypto_prices` app-data cache +
  `crypto_ticker_mappings`, no WebSocket needed); gain = unrealized +
  realized; returnPct = gain / gross priced buys; xirrPct from priced
  buy/sell flows + terminal value (transfers excluded from flows — their
  value inflates the return, which is correct: it's yield). Rows fill the
  existing `HoldingPerfRow` shape with `accountType: "normal"`,
  `isOrphan: false`, ticker = token; `closed` when amount ≈ 0.

The generic module (`xirr`, `computeTwr`, `buildContributionSeries`,
`dailySnapshotValues`) is reused untouched. TWR/XIRR windows clamp to the
first crypto flow (~2026-03-26), excluding the seeded pre-April snapshot era —
same guard as stocks.

## Benchmark route

`GET /api/benchmark?symbol=SPY|BTC&from=…` (whitelist; default SPY; 400 on
unknown symbol). BTC branch: Binance klines
`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000`
→ `{date, close}[]` (close = k[4], date from k[0] open-time UTC). SPY branch
unchanged (Yahoo). Same cache headers. Client caches per symbol
(`benchmark_spy_cache`, `benchmark_btc_cache`), 12h.

## Page changes

- **Scope control** (`Stocks | Crypto | All`, default All) left of the
  existing toggles. Super/Removed toggles render only when scope ≠ crypto.
  Crypto scope shows a one-line note: "Stablecoins count as cash; transfers
  count as yield."
- **Data per scope:**
  - stocks: exactly today's behavior.
  - crypto: values = `cryptoPotValues`, flows = `cryptoNetFlowsByDay`,
    current value = Σ non-cash token live values.
  - all: values = stock daily + crypto pot daily, union of dates with
    forward-fill of whichever side is missing that day (no value until both
    sides have appeared once); flows = stock flows (respecting super/removed
    filters) ∪ crypto flows; current value = sum. Window clamp =
    min(first stock flow, first crypto flow).
- **Stats:** XIRR · TWR · Net gain unchanged in meaning per scope. 4th tile:
  stocks/all → "VS S&P 500"; crypto → "VS BTC" with "vs SPY ±x.xpp" sub-line.
  Dividends sub-stat only in stocks scope.
- **Growth chart:** generalized to N benchmark series
  (`benchmarks: {name, color, dash, series}[]`). Crypto scope: You (blue
  solid) + BTC (dashed) + SPY (dotted). The third color is chosen from
  ECHARTS_COLORS and MUST pass the dataviz validator against blue+orange on
  both surfaces before shipping; dash patterns are the secondary encoding.
- **Table:** one merged list per scope, sorted by XIRR. Crypto rows carry a
  `CRYPTO` chip (new `chip` passthrough alongside the existing SUPER/CLOSED/
  NOT IN STATS chips). All scope = stock rows + crypto rows in one ranking.
- **Value-vs-contributions chart:** unchanged component; per-scope subtitle
  (crypto: "gap = market gains + yield").

## Edge cases

- No crypto CSV uploaded → crypto scope shows an empty-state card; All scope
  silently equals stocks (with a small note).
- BTC or SPY fetch failure → that line and its stat hide independently.
- Null-valued buys/sells (future CSVs) → skipped from flows; count surfaced in
  a muted footnote on the table ("n unpriced rows ignored").
- Snapshot-minus-stables ≤ 0 → day dropped.
- Crypto snapshots have no super dimension; include-super only affects the
  stock component of All.

## Testing

`lib/utils/__tests__/crypto-performance.test.ts`: flow classification (cash
vs non-cash, transfers excluded, null-value guard), stable balance replay
(including transferOut floor), pot derivation (forward-fill + floor),
per-token stats (realized+unrealized gain, closed detection, XIRR flows,
live-price application), isCashLikeToken boundary (syrupUSDC/USDe cash;
XAUt not). Existing 24 tests must stay green.

## Amendments from real-data verification

- **`bootstrapCryptoWindow`** (added): trims leading pot days whose
  flow-adjusted return exceeds +200% (first 14 days only) and books the first
  trusted day's pot value as an opening deposit. On the live dataset this is a
  NO-OP (the log fully explains the pot from day one) — it exists as tested
  protection for partial-coverage onboarding.
- **Terminal pot value** comes from the snapshot-based series (falls back to
  Σ token×live price): coins in Earn/locked positions never appear in the tx
  log but are in the holdings CSV → snapshots.
- **BTC klines**: Binance returns the FIRST 1000 candles after `startTime`, so
  the start is clamped to `now − 999d`; the client benchmark fetch uses
  `cache: "no-store"` (browsers heuristically reused stale responses).
- **data-provider fix** (shared infra): the snapshot backfill now pages
  newest-first and unions the in-memory Phase A window, so a pagination that
  dies early can no longer clobber the newest rows (production data was
  silently truncated at 2026-05-08 for every chart in the app).
- Verified end-to-end: an independent quote-aware replay reproduces the page's
  crypto numbers exactly (TWR +21.0%, net gain ≈ +$1,331 on $22.9k
  contributed as of 2026-07-27). Note for future diagnosis scripts: the tx CSV
  quotes thousands separators — naive comma-splitting corrupts every row with
  a 4+ digit value.

## Out of scope

Fiat-deposit detection inside stablecoin buys (user confirmed deposits are
rare; revisit if they start logging them), historical crypto prices for
unpriced transfers, per-exchange breakdown.
