# Vesta · Android

Native Android port of the Vesta net-worth tracker — a Kotlin + Jetpack
Compose twin of the iOS app (`ios/VestaQuickAdd`), talking to the same
Supabase `app_data` blobs, the same snapshot table, and the same live price
feeds, so all three clients stay in lockstep.

```
Compose screens ──REST──▶ Supabase  (app_data blobs · snapshots · GoTrue auth)
Live prices     ──WS────▶ Binance · Gate.io · Alpaca (iex)
Benchmarks      ──GET───▶ {web deployment}/api/benchmark   (SPY/BTC closes)
More → web      ──loads─▶ the deployed web app (pages not yet native)
```

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

---

## 1 · Install the toolchain

You need **JDK 17** and the **Android SDK** (platform 36, build-tools 36).
Android Studio gives you both; the command-line-only route on macOS is:

```sh
brew install openjdk@17
brew install --cask android-commandlinetools

export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME="$HOME/Library/Android/sdk"

yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
  "cmdline-tools;latest"
```

Then tell Gradle where the SDK is (skip if `ANDROID_HOME` is exported):

```sh
cd android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
```

> **Why compileSdk is pinned to 36:** Compose 1.12+, lifecycle 2.11+ and
> OkHttp 5.5's Android artifact all demand compileSdk 37, which has no
> released platform yet. The version catalog pins Compose BOM 2026.06.01 /
> lifecycle 2.10 / OkHttp 4.12 accordingly — bump them together with
> compileSdk when 37 ships.

## 2 · Build

```sh
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:assembleDebug
#  → app/build/outputs/apk/debug/app-debug.apk

./gradlew :app:testDebugUnitTest    # math-parity suite (ports of the web's vitest tests)
./gradlew :app:assembleRelease      # minified, debug-signed — fine for sideloading
```

## 3 · Install on a phone

1. On the phone: **Settings → About → tap "Build number" 7×** to unlock
   Developer options, then enable **USB debugging**.
2. Plug in over USB (accept the RSA prompt) and:

```sh
adb devices                       # phone should be listed as "device"
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

No cable? `adb pair <ip:port>` / `adb connect <ip:port>` (Wireless
debugging on the phone) works the same, or just AirDrop-equivalent the APK
over and open it (allow "install unknown apps").

First launch: the app signs in silently as the owner account, paints from
cache, then syncs. If credentials don't match your Supabase project you'll
see the sign-in screen instead — see the next section.

### Emulator (optional)

```sh
sdkmanager --sdk_root="$ANDROID_HOME" "emulator" "system-images;android-36;google_apis;arm64-v8a"
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n vesta \
  -k "system-images;android-36;google_apis;arm64-v8a" -d "pixel_7"
"$ANDROID_HOME/emulator/emulator" -avd vesta &
adb wait-for-device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 4 · Connect to Supabase

All backend config lives in **one place**:

```
app/src/main/java/com/piyawatpm/vesta/data/SupabaseApi.kt   →  object SupabaseConfig
```

| Constant | What it is |
|---|---|
| `URL` | your Supabase project URL (`https://xxxx.supabase.co`) |
| `PUBLISHABLE_KEY` | the anon/publishable key (`sb_publishable_…`). Public by design — it already ships in the web bundle; once RLS is applied it can do nothing without a signed-in session |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | the single auth account the app signs in as, silently, on every launch. Single-user app on the owner's own device — the phone's lock screen is the real gate. If the password ever changes, the app falls back to the sign-in screen instead of bricking |

**Point the app at your own Supabase project:**

1. Do the backend setup in the root `README.md` §1 (create the `app_data`
   table, run `lib/supabase/migration.sql`, create the auth user with
   `node scripts/create-auth-user.mjs you@example.com`).
2. Edit `SupabaseConfig` with your URL, publishable key and account —
   or leave the credentials blank-ish and just sign in manually on the
   fallback screen; the session persists either way.
3. Rebuild and install.

**What the app does with the connection** (mirrors the iOS client exactly):

- **Auth**: GoTrue password grant → access/refresh tokens stored in
  app-private `files/vesta-session.json` (excluded from OS backups via
  `res/xml/data_extraction_rules.xml` — the Android stand-in for the iOS
  Keychain). Tokens auto-refresh 60 s before expiry.
- **Reads**: all `app_data` rows via REST, then *delta* fetches using an
  `updated_at` watermark — a quiet app-open costs a few KB, not the
  multi-hundred-KB CSV blobs. `snapshots` is paged newest-first (1000/page)
  and merged append-only into the on-device cache
  (`files/vesta-cache.json`, versioned — bump `DiskCache.CURRENT_VERSION`
  together with iOS when cached semantics change).
- **Writes**: whole-blob read-modify-write of the same JSON arrays the web
  app writes (`income_entries`, `expense_entries`, `portfolio_holdings`,
  `portfolio_transactions`, `debt_records`, `debt_transactions`,
  `crypto_cash_tags`, `earn_exclusions`, `networth_goals`,
  `portfolio_groups`, `forecast_assumptions`, `preferred_currency`).
  Currency choice on the phone follows to the web and vice-versa.
- **Quick-add** (`vesta://add` deep link and the offline queue) appends to
  the `expense_entries` blob directly with clientId idempotency — a replay
  can never double-log.

**Things that use the deployed web app, not Supabase:** the Performance
page's SPY/BTC closes come from `{base}/api/benchmark`, and the "On the
web" pages load `{base}` in-place. `{base}` defaults to the production URL
in `data/Settings.kt` (`PRODUCTION_URL`) and can be changed at runtime in
**More → Quick add & server** (that screen's `QUICK_ADD_TOKEN` field only
matters for the legacy `/api/quick-expense` connection test — live writes
go straight to Supabase).

## 5 · Troubleshooting

| Symptom | Fix |
|---|---|
| `SDK location not found` | write `android/local.properties` with `sdk.dir=…` or export `ANDROID_HOME` |
| `Unable to locate a Java Runtime` / AGP version errors | run Gradle with `JAVA_HOME=/opt/homebrew/opt/openjdk@17` (JDK 17+) |
| AAR metadata errors demanding compileSdk 37 | you bumped a library past the pin — see the note in §1 |
| App opens on the sign-in screen | `SupabaseConfig` credentials don't match an auth user in your project — create one (root README §1.4) or sign in manually |
| Screens empty after sign-in | RLS is on but the session isn't accepted (wrong project keys), or the `app_data` table is empty — seed data via the web app |
| Benchmark card says it can't load prices | the web deployment URL in More → Quick add & server isn't reachable |

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
app/src/test/  CoreMathTest — parity ports of lib/utils/__tests__
```

Kotlin files mirror their Swift counterparts by name where one exists, so
the two ports can be diffed side by side.
