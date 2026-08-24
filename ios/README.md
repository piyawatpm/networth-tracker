# Vesta — native iPhone app

Fully native SwiftUI app (iOS 26, Liquid Glass) over the **same Supabase data
the web app uses**. The web version is untouched and keeps working as a PWA —
this is a second client, not a replacement. Sign in with the same email +
password as the web login.

```
Native SwiftUI pages ──REST──▶ Supabase (app_data blobs + snapshots table)
Action Button intent ──POST──▶ /api/quick-expense (deployed web API)
More → web sheets    ──loads──▶ my-networth-tracker.vercel.app (unported pages)
```

## Native pages

| Tab | What's in it |
|---|---|
| **Dashboard** | Net worth hero, 30/90/365d history chart, asset breakdown, month money-flow, recent activity |
| **Income** | Month total + interactive donut (tap slices), records list with search, swipe edit/delete, add form — includes the derived realized-gains rows (sells only, marked with 🔗, read-only) |
| **Expenses** | Month total + ranked category bars, records with search, swipe edit/delete, add form |
| **Invest** | Stocks: holdings with unrealized %, detail (zoom transition) with tx history + buy/sell logging. Crypto: pot replayed from the tx CSV, invested vs cash split, per-token P&L |
| **More** | Debts (signed-net, overpaid ledgers flip sides), Performance (XIRR + value charts), web sheets for Budget / Emergency Fund / Full Performance / Settings, Action Button config, sign out |

The math is ported line-for-line from the web's `lib/utils` (average-cost
replay, sells-only crypto realized, signed debt nets, XIRR, USD-based FX) so
both clients show the same numbers. Category colors match the web donuts.

Tech: pure Apple stack — SwiftUI + Swift Charts + Observation, no third-party
dependencies. iOS 26 details: glass buttons, tab bar that recedes on scroll,
mesh-gradient sign-in, numeric-text rolling numbers, sector-mark donuts with
angle selection, sensory feedback, zoom navigation transitions.

## Writes

In-app add/edit/delete of income, expenses and portfolio transactions
re-encode the whole blob — the same read-modify-write convention the web app
itself uses, so the two clients can't corrupt each other's shape. The Action
Button intent still posts to `/api/quick-expense` (works offline via the
on-device queue; retries are idempotent).

## Install

1. Xcode → Settings → Accounts → + → your Apple ID (free).
2. iPhone plugged in + unlocked → Trust; Settings → Privacy & Security →
   Developer Mode → On.
3. `open ios/VestaQuickAdd.xcodeproj` → target → Signing & Capabilities →
   Team = your Personal Team.
4. Select your iPhone → ⌘R. First launch: Settings → General → VPN & Device
   Management → trust your Apple ID.

Free Apple ID = reinstall from Xcode every 7 days; $99/yr = yearly.

## Prerequisites

- **Auth user** must exist in the Supabase project (see the root README —
  `scripts/create-auth-user.mjs`, or Dashboard → Authentication → Add user).
  Sign in once on the app's sign-in screen; the session persists in the
  Keychain. The app works before AND after the RLS lockdown is applied. No
  credentials live in this repo.
- **Action Button** needs the deployed `/api/quick-expense` + `QUICK_ADD_TOKEN`
  in Vercel env (branch currently undeployed). Everything else works today.
- FX rates come from open.er-api.com (same source as the web).

## Files

`Native/` — Models, SupabaseAPI (auth + REST, session in Keychain), DataStore
(@Observable), FinanceMath / PortfolioMath / CryptoMath (ports), Theme, and one
file per page. Root: `RootView.swift` (sign-in gate + tabs),
`AddExpenseIntent.swift` + `PendingQueue.swift` (Action Button),
`WebView.swift` (web sheets), `ContentView.swift` (offline quick-add form).

Verify changes with `xcrun --sdk iphonesimulator swiftc -typecheck` — this
machine has no simulator runtimes installed.
