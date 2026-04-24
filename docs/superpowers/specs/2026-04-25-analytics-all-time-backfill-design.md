# Analytics: All-Time Baseline from First Snapshot

## Goal

Extend the analytics page's performance view backwards from the user-triggered "baseline reset" point to the first-ever snapshot the cron wrote, and populate BTC / S&P 500 comparison lines for that full range. The user sees their actual journey since they started tracking, not just since they last hit a button.

## Background

The current flow (shipped in `2026-04-22-analytics-baseline-pnl-design.md`):

1. User clicks **Reset Baseline** → `POST /api/analytics/baseline` captures current portfolio + BTC/SPY prices into `analytics_baseline`.
2. Cron (`/api/cron/snapshot`) runs every 15 min, computes `portfolio_pct / btc_pct / spy_pct` vs. that baseline, appends to `performance_snapshots`.
3. `ComparisonChart` reads `performance_snapshots` filtered by current baseline — so the timeline only goes back to the last reset.

The user has been tracking for much longer via `portfolio_snapshots` and `crypto_snapshots` (written every 15 min by the cron) and has all the cost-basis data needed (`portfolio_transactions` + crypto CSV). Nothing reaches back to use it.

## Design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Remove Reset Baseline button.** Baseline is auto-derived from oldest snapshot. | One canonical timeline; "when did I start tracking" is unambiguous. |
| 2 | **Anchor = earliest of `portfolio_snapshots` or `crypto_snapshots`.** | First cron write on either side. One combined timeline. |
| 3 | **Backfill into `performance_snapshots`** (not a separate benchmark table). | Simpler — chart reads one table; matches existing code path. |
| 4 | **Daily granularity for backfilled period, 15-min for ongoing.** | BTC/SPY APIs provide daily cheaply; 15-min benchmarks would be interpolated to zero info gain. |
| 5 | **Manual "Rebuild history" button triggers backfill.** | Backfill is seconds-long external fetch — user should see it run and finish. |

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│ portfolio_snapshots │     │   crypto_snapshots   │
│  (cron, 15-min)     │     │   (cron, 15-min)     │
└──────────┬──────────┘     └──────────┬───────────┘
           │                           │
           └───────────┬───────────────┘
                       ▼
            earliest date = anchor date
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
 ┌──────────────────┐      ┌────────────────────────┐
 │ CoinGecko /range │      │ Alpaca /bars (SPY)     │
 │ BTC daily USD    │      │ daily 1Day close       │
 └────────┬─────────┘      └─────────────┬──────────┘
          └────────────────┬─────────────┘
                           ▼
              ┌────────────────────────────┐
              │   analytics_baseline       │
              │   (1 row, auto-upserted)   │
              │   date=anchor              │
              │   benchmarks={spy,btc}     │
              │   snapshot.totals from     │
              │     earliest snapshots     │
              │   snapshot.portfolio={}    │ ← empty; deposits path handles PnL
              │   snapshot.crypto={}       │
              └──────────────┬─────────────┘
                             ▼
              ┌────────────────────────────┐
              │  performance_snapshots     │
              │  backfilled rows (daily)   │ ← one-shot from Rebuild button
              │  live rows (15-min)        │ ← cron, unchanged
              └──────────────┬─────────────┘
                             ▼
                     ComparisonChart
```

**Key insight — per-holding PnL emerges naturally.** The widgets (`holdingsPnl`, `pnlByProduct`, `rangePnls`) compute PnL as `currentValue − baselineValue − deposits_since_baseline`. When baseline goes back before all transactions, `baselineValue[id] = 0` and `deposits_since_baseline` = every buy/sell/deposit — so PnL converges to `currentValue − cost_basis`. That's exactly the correct metric. No widget code changes.

**Empty-state fallback.** If both snapshot tables are empty (brand-new install, cron never ran), `GET /api/analytics/baseline` returns `{ baseline: null }` and the page shows `NoBaselineEmpty` prompting the user to wait for cron or trigger a snapshot. The component stays.

## File changes

| Action | File | What |
|---|---|---|
| Delete | `app/(app)/analytics/_components/reset-baseline-button.tsx` | Replaced by "Rebuild history" (see below). |
| Create | `app/(app)/analytics/_components/rebuild-history-button.tsx` | Small button; POSTs `/api/analytics/backfill-performance`, shows toast on completion. |
| Modify | `app/(app)/analytics/page.tsx` | Swap `<ResetBaselineButton>` → `<RebuildHistoryButton>`. No other changes; `NoBaselineEmpty` branch stays for truly-empty state. |
| Modify | `app/api/analytics/baseline/route.ts` | `GET` auto-derives + persists baseline from earliest snapshot if `analytics_baseline` is empty. Historical BTC/SPY fetched for anchor date. `POST` deleted (or left as a dev-only force-rebuild — out of scope, decide at impl time). |
| Create | `app/api/analytics/backfill-performance/route.ts` | One-shot POST: wipe `performance_snapshots` for current baseline, fetch daily BTC/SPY from anchor → today, for each daily bucket compute pct triplet, insert rows. Idempotent (wipe + reinsert). |
| Modify | `app/api/cron/snapshot/route.ts` | After writing snapshot data, if `analytics_baseline` is empty, auto-derive using the same helper (covers the first-ever cron run). Performance-snapshot block stays unchanged for live 15-min writes. |
| Create | `lib/utils/analytics-backfill.ts` | Pure helpers: `deriveAnchorDate`, `buildBaselineFromSnapshots`, `computeDailyPerfRows`, price-history mergers. No Supabase / `fetch` calls. |
| Delete | `app/(app)/analytics/_components/no-baseline-empty.tsx` | **Not deleted** — kept for the "no snapshots anywhere" edge case. Correcting the earlier brainstorm statement. |

## Algorithms

### A) Auto-derive baseline (`GET /api/analytics/baseline` when empty)

```
1. Read analytics_baseline WHERE is_current=true. If exists, return it.
2. Query min(date) from portfolio_snapshots and crypto_snapshots.
   Let anchor_date = earlier of the two (YYYY-MM-DD, Sydney timezone).
   If both empty → return { baseline: null }.
3. Fetch the FIRST portfolio_snapshots row on/after anchor_date → portfolioBaselineUsd.
4. Fetch the FIRST crypto_snapshots row on/after anchor_date → cryptoBaselineUsd.
   (Either can be 0 if that side started later.)
5. Fetch historical BTC close for anchor_date (CoinGecko market_chart/range).
6. Fetch historical SPY close for anchor_date (Alpaca /bars, 1Day, single day).
7. Build AnalyticsBaseline:
     date: anchor_date
     createdAt: Date.now()
     portfolio: {}    ← empty; deposits-since-baseline path handles per-holding
     crypto: {}
     benchmarks: { spy, btc }
     totals: { portfolioUsd, cryptoUsd, combinedUsd }
8. Insert into analytics_baseline (is_current=true), return it.
```

### B) Backfill performance snapshots (`POST /api/analytics/backfill-performance`)

```
1. Read current baseline. If null → 400 "No baseline yet".
2. DELETE FROM performance_snapshots WHERE baseline_id = current.id.
   (Idempotent: running twice gives same result.)
3. Build per-day combined values:
   - Read all portfolio_snapshots sorted asc; for each day, keep last tick → Map<day, portfolioUsd>.
   - Same for crypto_snapshots → Map<day, cryptoUsd>.
   - Merge: for each day from anchor → yesterday, combined = (port||carry) + (crypto||carry).
     Carry-forward prior day's value on gaps.
4. Build deposits-per-day map:
   - portfolio_transactions: day_of_tx → signed USD (buy=+, sell=−), filtered date > anchor.
   - crypto_deposits: day_of_deposit → USD, filtered date > anchor.
5. Fetch historical BTC daily closes from anchor → yesterday (CoinGecko).
6. Fetch historical SPY daily closes from anchor → yesterday (Alpaca, 1Day timeframe).
   (Gaps on weekends/holidays — carry forward.)
7. For each day D from anchor → yesterday:
   depositsCum  = sum of deposits from (anchor, D] in USD
   portfolioPct = ((combined[D] − baseline.totals.combinedUsd − depositsCum) /
                   (baseline.totals.combinedUsd + depositsCum)) * 100
   btcPct       = (btcClose[D] / baseline.benchmarks.btc − 1) * 100
   spyPct       = (spyClose[D] / baseline.benchmarks.spy − 1) * 100
   Insert row:
     baseline_id, baseline_date, timestamp=D@EOD_Sydney_ISO,
     portfolio_usd, crypto_usd, combined_usd, deposits_usd=depositsCum,
     spy_price_usd, btc_price_usd, portfolio_pct, spy_pct, btc_pct
8. Note: today's row is NOT backfilled — the cron continues writing 15-min rows
   for today and onwards. No overlap.
9. Return { ok: true, days_written: N, from: anchor, to: yesterday }.
```

### Timezone note

Snapshots use Sydney dates (`en-CA` YYYY-MM-DD, Australia/Sydney). BTC/SPY daily bars are UTC (CoinGecko) / US market days (Alpaca). We slice the snapshot timestamp's Sydney date and treat benchmark daily bars for the same `YYYY-MM-DD` as the match. Minor ±1 day offset possible at the edges; acceptable for a chart showing weeks/months of data.

## Acceptance criteria

- [ ] Reset Baseline button no longer appears on `/analytics`.
- [ ] Rebuild History button appears in its place; clicking it returns within ~10s and shows a toast on completion.
- [ ] With existing data in `portfolio_snapshots` and `crypto_snapshots`, baseline auto-populates on next `/analytics` load (no manual action needed).
- [ ] After clicking Rebuild History, the ComparisonChart extends back to the earliest snapshot date, with non-flat BTC and SPY lines covering that full range.
- [ ] `holdingsPnl` table shows per-holding PnL ≈ `currentValue − cost_basis` (cost basis = sum of post-baseline transactions, which is effectively all of them).
- [ ] `rangePnls.all.value` reflects total unrealized PnL since first snapshot.
- [ ] Cron continues writing 15-min rows; they don't conflict with backfilled daily rows.
- [ ] Clicking Rebuild History twice produces the same result (idempotent).

## Out of scope

- Dropping the `analytics_baseline` table or redesigning its schema.
- Intraday (15-min) backfill for historical BTC/SPY — daily only.
- Adding additional benchmarks (ETH, NVDA, total-crypto-market). The architecture supports it (add a fetch + column), but not in this change.
- Realized P&L from closed positions (the chart is unrealized-only; "all-time profit" that includes realized is a separate feature).
- Per-holding baseline reconstruction (computing what each holding was worth at the anchor date). Not needed — deposits-path handles it.
