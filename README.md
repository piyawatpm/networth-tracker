# Vesta

Personal net-worth tracker: income & expense ledgers, stock/super/crypto
portfolios, debts, live prices, performance vs benchmarks, and a compound
forecast — one Supabase backend, three clients that all show the same
numbers.

```
                 ┌────────────────────────────────────────────┐
                 │              Supabase (Postgres)           │
                 │  app_data KV blobs  ·  snapshots table     │
                 │  auth (one owner account)                  │
                 └───────▲──────────────▲──────────────▲──────┘
                         │              │              │
                 ┌───────┴───┐   ┌──────┴────┐   ┌─────┴─────┐
                 │  Web/PWA  │   │    iOS    │   │  Android  │
                 │  Next.js  │   │  SwiftUI  │   │  Compose  │
                 └───────▲───┘   └───────────┘   └───────────┘
                         │        Binance WS · Gate.io WS · Alpaca WS
   Vercel cron ──────────┘        open.er-api.com FX · Hostplus daily price
   (snapshots, repricing)
```

| Directory | What it is |
|---|---|
| `app/`, `components/`, `lib/` | Next.js 16 web app (the PWA, deployed on Vercel) — also serves the API routes the cron and mobile helpers use |
| `ios/` | Native SwiftUI app (`ios/README.md`) |
| `android/` | Native Kotlin + Jetpack Compose app (`android/README.md`) |
| `lib/supabase/` | `migration.sql` (all tables), `rls.sql` (lockdown), clients |
| `scripts/create-auth-user.mjs` | Creates the single auth account the apps sign in as |
| `supabase/migrations/` | Later additive migrations (analytics baseline, performance snapshots) |

The financial math (average-cost replay, sells-only realized income, signed
debt nets, XIRR, the DCA benchmark comparison, the forecast walk, the crypto
earn rule) lives in `lib/utils/` and is ported line-for-line into both mobile
apps, so a number that disagrees between clients is a bug, not an opinion.

---

## 1 · Set up Supabase (required for everything)

The whole system runs on one Supabase project. ~10 minutes from zero.

### 1.1 Create the project and tables

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open **SQL Editor** and run this first — the `app_data` key-value table is
   the source of truth every client reads and writes:

   ```sql
   CREATE TABLE IF NOT EXISTS app_data (
     key        TEXT        PRIMARY KEY,
     value      TEXT,
     updated_at TIMESTAMPTZ DEFAULT now()
   );
   ```

3. Run the whole of **`lib/supabase/migration.sql`** — creates the relational
   mirror tables plus `snapshots` (the append-only history the charts read)
   and `cron_logs`. Idempotent, safe to re-run.
4. (Optional, for the web Analytics page) run the files in
   `supabase/migrations/` too.

### 1.2 Get your keys

From **Project Settings → API** you need three values:

| Value | Looks like | Who uses it |
|---|---|---|
| Project URL | `https://xxxx.supabase.co` | all clients |
| Publishable (anon) key | `sb_publishable_…` | web browser bundle, iOS, Android — public by design, useless on its own once RLS is applied |
| Secret (service-role) key | `sb_secret_…` | **server only**: the cron and API routes. Never put this in a client |

### 1.3 Configure the web app

Create `.env.local` in the repo root:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
SUPABASE_SECRET_KEY=sb_secret_…

# quick-add bearer token for /api/quick-expense — any long random string
QUICK_ADD_TOKEN=<openssl rand -base64 32>

# optional price/benchmark providers (the app degrades gracefully without them)
COINGECKO_API_KEY=…
FINNHUB_API_KEY=…
ALPACA_KEY_ID=…            # paper-trading keys; used server-side
ALPACA_SECRET_KEY=…
NEXT_PUBLIC_ALPACA_KEY_ID=…       # same keys; used by the browser websocket
NEXT_PUBLIC_ALPACA_SECRET_KEY=…
```

On Vercel, add the same variables in the project settings. `vercel.json`
already schedules the snapshot cron that writes the history charts.

### 1.4 Create the auth account

Every client signs in as one owner account (single-user app — "signed in"
IS the authorization model):

```sh
node scripts/create-auth-user.mjs you@example.com    # prints a password if omitted
```

### 1.5 Lock it down — ORDER MATTERS

Until RLS is applied, the publishable key alone can read and write every
table. Apply `lib/supabase/rls.sql` **last**, in this order (the file's
header explains why — running it early cuts the deployed site off from its
own data):

1. create the auth user (1.4)
2. deploy the web app with the login build
3. sign in on the deployed site, confirm data loads
4. **then** run `lib/supabase/rls.sql` in the SQL editor

Server-side code is unaffected either way — the secret key bypasses RLS.

---

## 2 · Install the web app

```sh
pnpm install
pnpm dev          # http://localhost:3000 — sign in with the account from 1.4
pnpm test         # vitest suite for lib/utils math
pnpm build        # production build
```

Deploy: push to the connected Vercel project (or `vercel deploy`), with the
env vars from 1.3 set. The mobile apps also load a few not-yet-native pages
from this deployment and call its `/api/benchmark` for SPY/BTC closes, so
the mobile experience is best with the web app deployed.

## 3 · Install the iOS app

See **`ios/README.md`**. Short version: open
`ios/VestaQuickAdd.xcodeproj`, set your team, run on a device —
`ios/reinstall.sh` automates build + install, `ios/install-auto-resign.sh`
keeps a free-account signature renewed. Supabase URL/key live in
`ios/VestaQuickAdd/Native/SupabaseAPI.swift` (`SupabaseConfig`).

## 4 · Install the Android app

See **`android/README.md`** for the full walkthrough (toolchain from zero,
device install, emulator, and the Supabase connection section). Short
version:

```sh
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Supabase URL/key live in
`android/app/src/main/java/com/piyawatpm/vesta/data/SupabaseApi.kt`
(`SupabaseConfig`).

---

## How the data fits together

- **`app_data` blobs are the source of truth.** Every collection
  (`income_entries`, `expense_entries`, `portfolio_holdings`,
  `portfolio_transactions`, `debt_records`, `debt_transactions`, the crypto
  CSV slots, settings like `preferred_currency` and `forecast_assumptions`)
  is one JSON-string row. Writers re-encode the whole array —
  read-modify-write, last write wins — so the three clients can't corrupt
  each other's shape. The relational tables from the migration are mirrors;
  several are intentionally empty.
- **`snapshots` is append-only** (types `networth` / `portfolio` / `crypto`,
  values in USD). The cron writes it; clients only ever read and merge —
  never delete-and-reinsert to "match" local state.
- **Currency:** snapshots and crypto are USD at rest; entries carry their own
  currency; conversion happens at render through USD-based rates from
  `open.er-api.com`. Dates are Sydney wall time everywhere.
- **Live prices** come straight to each client (Binance + Gate.io websockets
  for crypto, Alpaca for US stocks); the Hostplus super unit price is fetched
  from their public returns feed and `balance = units × price`.
- The two crypto CSV slots (`crypto_csv_text` holdings overview,
  `crypto_tx_csv_text` transaction history) are uploaded on the web app's
  crypto page; both mobile apps parse them with the same quote-aware parser.

## Secrets policy

`.env.local` is git-ignored. The publishable key ships in clients by design;
the **secret key and `QUICK_ADD_TOKEN` must only ever live in `.env.local` /
Vercel env**. The mobile apps keep their session tokens in app-private
storage that is excluded from OS backups.
