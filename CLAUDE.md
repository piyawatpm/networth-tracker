# Life Investment — Personal Finance Tracker

## What This App Is

A self-hosted personal finance tracking portal for a Sydney-based user. Tracks all financial data: income, expenses, crypto, stocks/ETFs/funds, debts, and net worth. All dates in **Australia/Sydney** timezone. Default currency **AUD** with live FX toggle to USD/THB.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v4
- **UI Primitives**: shadcn/ui (**base-ui backed**, NOT Radix)
- **Animations**: Magic UI (number-ticker, blur-fade, shimmer-button, border-beam, dock, text-animate) + Motion (framer-motion)
- **Charts**: Recharts via shadcn chart component
- **Icons**: Lucide React
- **Data**: localStorage (via `useLocalStorage` hook). Drizzle ORM + libSQL schema exists but not wired yet.
- **FX Rates**: Live from open.er-api.com, cached 24h in localStorage

## CRITICAL: base-ui API Differences

This project uses **base-ui** (NOT Radix). The APIs are different:

```tsx
// ❌ WRONG (Radix pattern)
<DialogTrigger asChild><Button>Open</Button></DialogTrigger>

// ✅ CORRECT (base-ui pattern)
<DialogTrigger render={<Button>Open</Button>} />
```

```tsx
// ❌ WRONG — Select onValueChange signature
onValueChange={setValue}  // Will get null

// ✅ CORRECT — guard against null
onValueChange={(v) => v && setValue(v)}
```

Button `size="icon-xs"` exists as a custom variant in this project.

## Pages & Routes

### `/dashboard` (Dashboard)
Net worth overview pulling from all data sources. Shows:
- Net worth hero number (portfolio + crypto + owed to me - I owe)
- Asset breakdown (Portfolio, Crypto, Debts)
- This month income/expenses/cash flow
- Savings rate, debt-to-asset ratio
- Asset allocation donut chart
- Income vs expenses bar chart (last 6 months)
- Income/Expense YTD breakdowns
- Recent activity feed

### `/income` (Income Tracking)
- Add/edit/delete income entries with modal dialogs
- Types: salary, super_employer, super_personal, arena_bot, arb_bot, uber, freelance, dividend, crypto_yield, interest, rental, bonus, other
- This month donut breakdown + progress bars by type
- YTD stats, filter by type
- Multi-currency with live FX conversion
- Delete confirmation dialog

### `/expenses` (Expense Tracking)
- Same pattern as income
- Types: food, transport, rent, utilities, entertainment, shopping, health, insurance, subscriptions, education, travel, gifts, other
- Image upload support (base64, resized to 800px max, up to 5 per entry)

### `/crypto` (Crypto Portfolio)
- CSV drag-and-drop upload (CoinStats export format)
- Parses transactions: buy/sell/transferIn/transferOut
- Stablecoins (USDC, USDT, USD1, etc.) grouped as "CASH"
- Allocation donut chart + holdings table
- All values in USD from CSV, converted to display currency
- Persisted in localStorage (CSV text + filename)

### `/portfolio` (Stocks/ETFs/Funds)
- Add/edit/delete holdings
- Fields: name, ticker, type (stock/etf/fund/bond), account type (normal/super), broker, country, units, amount invested, current value, link, currency
- **Include Super toggle** — show/hide superannuation from totals
- Allocation by type donut + broker breakdown
- P&L tracking (value vs cost)

### `/debts` (Debt Management)
- Two directions: "I Owe" and "Owed to Me"
- Each debt: person, reason, original amount, currency
- Payment tracking with transaction history per debt
- Payments can be positive (reduce debt) or negative (adjustment/add more)
- Progress bar showing payoff progress
- Image upload on debts and payments
- Delete confirmation for both debts and payments

## Navigation

Bottom floating dock (Magic UI Dock component) with macOS-style icon magnification on hover. Minimal top bar with logo + currency toggle.

## Global Features

### Currency Toggle
- Header button cycles AUD → USD → THB
- Hover shows FX rates with last update timestamp
- `useCurrency()` hook provides: `currency`, `setCurrency`, `rates`, `convert(amount, from, to?)`, `ratesLoaded`, `ratesFetchedAt`
- All amounts stored in original currency, converted at display time

### Sydney Timezone
- All date pickers default to today in Sydney
- `getSydneyDateString()`, `sydneyDateToTimestamp()`, `timestampToSydneyDate()`, `formatSydneyDate()`

### Image Upload
- Shared `ImageUpload` component + `ImageGallery` (read-only)
- Images resized to max 800px, JPEG 0.7 quality
- Stored as base64 data URLs in localStorage
- Click thumbnail for full-size preview modal

## File Structure

```
src/
├── app/
│   ├── (app)/           # App shell with dock nav
│   │   ├── layout.tsx   # Dock + top bar + currency toggle
│   │   ├── dashboard/
│   │   ├── income/
│   │   ├── expenses/
│   │   ├── crypto/
│   │   ├── portfolio/
│   │   └── debts/
│   ├── layout.tsx       # Root layout (fonts, providers)
│   └── page.tsx         # Redirects to /dashboard
├── components/
│   ├── analytics/       # AllocationChart, IncomeVsExpenses
│   ├── crypto/          # CsvDropzone
│   ├── debts/           # DebtDialog, PaymentDialog, DeleteDialog
│   ├── expenses/        # ExpenseDialog, DeleteDialog, ExpenseTrend
│   ├── income/          # IncomeDialog, DeleteDialog, IncomeTrend
│   ├── portfolio/       # HoldingDialog, DeleteDialog, PortfolioBreakdown
│   ├── providers/       # CurrencyProvider, Providers
│   ├── shared/          # ImageUpload, ImageGallery
│   └── ui/              # shadcn + Magic UI components
├── hooks/
│   └── use-local-storage.ts
├── lib/
│   ├── actions/         # Server actions (income, expenses) — not wired yet
│   ├── db/              # Drizzle schema + client — not wired yet
│   └── utils/           # constants, types, fx, timezone, crypto-csv
```

## localStorage Keys

| Key | Type | Used By |
|-----|------|---------|
| `income_entries` | `IncomeEntry[]` | Income page |
| `expense_entries` | `ExpenseEntry[]` | Expenses page |
| `crypto_csv_text` | `string` | Crypto page (raw CSV) |
| `crypto_csv_filename` | `string` | Crypto page |
| `portfolio_holdings` | `PortfolioHolding[]` | Portfolio page |
| `debt_records` | `DebtRecord[]` | Debts page |
| `debt_transactions` | `DebtTransaction[]` | Debts page |
| `preferred_currency` | `Currency` | Currency toggle |
| `fx_rates_cache` | `CachedRates` | FX provider |

## Design System

Currently using a Stripe-inspired light theme with indigo accent (#635BFF). Also has a "Ledger Noir" dark theme defined. The user wants a clean, premium look — reference pexatech.com.au for style inspiration (Geist font, tight letter-spacing, subtle shadows, hover lifts).

### Key CSS Classes
- `.stripe-card` — light mode shadow card with hover lift
- `.bento-panel` — bento grid panel with 16px radius
- `text-income` / `text-expense` — semantic colors (green/red)
- `font-mono` — tabular-nums for financial figures

## What's NOT Built Yet

- Settings page
- Data export/import (JSON backup)
- Switching from localStorage to SQLite DB (schema exists in `src/lib/db/`)
- Auth (Better Auth schema exists but not wired)
- Mobile responsive pass
- Dark/light mode toggle (currently hardcoded)
