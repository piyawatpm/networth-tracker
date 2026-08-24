# Vesta · Android

Native Android port of the Vesta net-worth tracker — a Kotlin + Jetpack
Compose twin of the iOS app (`ios/VestaQuickAdd`), talking to the same
Supabase `app_data` blobs, the same snapshot table, and the same live price
feeds, so all three clients stay in lockstep.

## What's inside

| Tab | Parity |
|---|---|
| **Home** | Net-worth hero chart (scrub, 1D–All, indexed mode, stocks/crypto overlays + debt step-strip), monthly growth invested-vs-market split with per-month detail sheet & dust collapsing, asset distribution (+segment sheets, cash picker), month flow, goal ETA, upcoming recurring, recent activity |
| **Income** | Donut + legend filters, month trend (stacked categories, tap-to-scope), insights, on-device blurb, month chips, day-grouped ledger, search-by-anything (dates included), add/edit/delete |
| **Spend** | Ranked category bars, pace vs last month same-day, burn stats, top vendors, weekday pattern (avg/total), everything Income has |
| **Invest** | Total strip, Stocks ⇄ Crypto pager; stocks: history chart, invested/unrealized, allocation donut (type/holdings/country), theme groups, realized P&L, brokers, holding cards → detail (Hostplus unit-price log, tx history, buy/sell form); crypto: history chart, invested/cash split, coin donut, realized, per-coin cards, exchanges |
| **More** | Debts (tiles, 6-month step trend, repayments, ledger detail w/ progress + forms), Performance (You-vs-SPY/BTC DCA comparison with settling mask + windows, crypto split card, value chart), Earn income ledger (tap-to-veto, synced exclusions), Trading by coin, Ask your money, Forecast & goals (full levers/paths/planner/composition), web pages in-place, quick-add settings, diagnostics, sign out |

Plus: silent owner sign-in with manual fallback, disk cache v6 with delta
sync, Binance + Gate.io + Alpaca websockets with 400 ms tick coalescing,
Hostplus repricing, WorkManager background refresh (~2 h), `vesta://add`
deep-link quick-add with on-device categorisation, offline queue that
enqueues to disk before the network, and a quick-add notification (the
Live-Activity stand-in).

The iOS FoundationModels features (blurbs, tap categorisation, Ask) run on
deterministic on-device rules here — same contract: the narrator only ever
repeats precomputed numbers.

## Build

Requires JDK 17 and the Android SDK (platform 36, build-tools 36).

```sh
cd android
./gradlew :app:assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease   # minified, debug-signed for sideloading
```

Point `local.properties` at your SDK (`sdk.dir=…`) if Gradle doesn't find it.

## Install

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Automation quick-add

Any automation app can log an expense with a deep link:

```
vesta://add?amount=14.50&merchant=7-Eleven
vesta://tap?amount=…&merchant=…   # inspect-only, shows what arrived
```

Amount parsing is forgiving (currency symbols, comma decimals); the currency
is read from the text (`฿`, `A$`, 3-letter codes) or falls back to the
default; the merchant is categorised on-device against the real category
list.

## Layout

```
app/src/main/java/com/piyawatpm/vesta/
  core/      FinanceMath (Money/SydneyTime/SnapshotDate/xirr), FlowMath, Forecast
  data/      Models, VestaStore (+DiskCache), SupabaseApi, PriceSockets,
             CryptoMath/CryptoSplit/PortfolioMath/DcaCompare, HostplusApi,
             QuickAdd (PendingQueue), Settings, DeepLink, Notify
  ai/        OnDeviceAI (rule-based narrator/categoriser)
  ui/        Root (tabs + glass bar), theme, components (charts, chips, cards)
  ui/screens Dashboard, Income/Expenses, Invest, More stack, Forecast,
             SignIn, EntryForm, PerfCompare
  work/      BackgroundRefresh (WorkManager)
```

Kotlin files mirror their Swift counterparts by name where one exists, so
the two ports can be diffed side by side.
