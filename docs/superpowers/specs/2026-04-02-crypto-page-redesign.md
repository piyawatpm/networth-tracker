# Crypto Page Redesign — Design Spec

## Overview

Overhaul the crypto page to fix broken P&L data, add live prices, improve UX with exchange tagging, interactive charts, and align patterns with income/expenses pages.

## Scope

10 changes in order of priority:

1. Fix syrupUSDC categorization (yield tokens ≠ stablecoins)
2. Add live price fetching via CoinGecko (24h cache, re-fetch on CSV upload)
3. Show CASH P&L (remove `--` hiding)
4. Add "last updated" timestamps (CSV + prices)
5. Add confirmation dialog on Clear
6. Exchange/wallet auto-parse from CSV notes + manual override + Exchange column
7. Fix donut chart dark mode (use `getPieBaseOption`)
8. Clickable legend to hide/show tokens (recalculates hero + metrics)
9. Table column sorting (click headers, asc/desc toggle)
10. Inline exchange editing on holdings table

---

## 1. Fix syrupUSDC Categorization

**File:** `lib/utils/crypto-csv.ts`

**Problem:** `isStablecoin()` matches any token containing "usdc" in the name, so `syrupUSDC` gets grouped into CASH. syrupUSDC is a yield-bearing token from Maple Finance that trades at ~$1.15, not $1.00.

**Solution:**
- Add a yield-token exclusion list: tokens with prefixes like `syrup`, `a` (aave), `st` (staked), `w` (wrapped) that are NOT stablecoins even though they contain stablecoin substrings
- Specifically: if a token name starts with a known yield-prefix AND contains a stablecoin name, treat it as its own token (not CASH)
- Yield prefixes to exclude: `syrup`, `aave`, `st` (stETH, stSOL), `w` (wETH, wBTC — these are wrapped, not stablecoins)

**Implementation:**
```ts
const YIELD_PREFIXES = ["syrup", "aave", "compound", "venus"];

function isStablecoin(name: string): boolean {
  const upper = name.toUpperCase();
  const lower = name.toLowerCase();

  // Yield-bearing tokens are NOT stablecoins
  if (YIELD_PREFIXES.some(p => lower.startsWith(p))) return false;

  // Existing stablecoin checks...
  if (STABLECOINS.has(upper)) return true;
  // ...
}
```

**Impact:** syrupUSDC becomes its own row in holdings table. CASH only contains true stablecoins (USDC, USDT, BUSD, DAI, etc.). CASH value and P&L become accurate.

---

## 2. Live Price Fetching via CoinGecko

**New file:** `lib/utils/crypto-prices.ts`

**API:** CoinGecko `/api/v3/simple/price` (free, no API key, 30 req/min)
- Endpoint: `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana,...&vs_currencies=usd`

**Token ID Mapping:**
- Maintain a `COINGECKO_IDS` map: `{ BTC: "bitcoin", ETH: "ethereum", SOL: "solana", OKB: "okb", syrupUSDC: "syrup-usdc", ... }`
- For unknown tokens: attempt lowercase match, skip if not found (fall back to cost basis)

**Caching:**
- Store in localStorage key `"crypto_prices"` as `{ prices: Record<string, number>, fetchedAt: number }`
- Cache duration: **24 hours** (same pattern as FX rates in `lib/utils/fx.ts`)
- Re-fetch triggers:
  - Page load when cache is stale (> 24h)
  - New CSV upload (always re-fetch — new portfolio may have new tokens)

**Integration with holdings:**
- After `parseAndComputeHoldings()` returns holdings, apply live prices:
  - For each non-CASH holding: `currentValueUsd = livePrice * amount` (if price available)
  - For CASH: keep `currentValueUsd = amount` (stablecoins pegged to $1)
  - If no live price for a token: keep cost basis as fallback, show a "no price" indicator

**Exports:**
```ts
export async function fetchCryptoPrices(tokens: string[]): Promise<Record<string, number>>
export function getCachedCryptoPrices(): { prices: Record<string, number>; fetchedAt: number } | null
export function isCryptoPricesCacheStale(): boolean
export function applyLivePrices(holdings: CryptoHolding[], prices: Record<string, number>): CryptoHolding[]
```

---

## 3. Show CASH P&L

**File:** `app/(app)/crypto/page.tsx`

**Problem:** Line 386-393 has `isCash ? "--" : ...` which hides CASH P&L. CASH currently shows a real loss (~$1,944 USD) from premium paid on syrupUSDC and trading activity.

**Solution:** Remove the `isCash` special case. CASH P&L renders the same as any other token: green if positive, red if negative, with `+` or `-` prefix and formatted amount.

**Before:**
```tsx
{isCash ? "--" : `${rowPnl >= 0 ? "+" : "-"}${format(Math.abs(rowPnl), "USD")}`}
```

**After:**
```tsx
{`${rowPnl >= 0 ? "+" : "-"}${format(Math.abs(rowPnl), "USD")}`}
```

Color class also updated: remove `isCash ? "text-muted-foreground/40"` branch.

---

## 4. "Last Updated" Timestamps

**File:** `app/(app)/crypto/page.tsx`

**Two timestamps shown:**
1. **CSV upload time** — stored in `localStorage` key `"crypto_csv_uploaded_at"` as unix timestamp when CSV is processed
2. **Prices fetched time** — from `crypto_prices.fetchedAt` in the cache

**Display:** Small muted text below the hero number:
```
CSV: 2 Apr 2026 · Prices: 2 Apr 2026, 9:30 AM
```

**Pattern:** Matches the `text-xs text-muted-foreground` style used elsewhere.

**Implementation:**
- On successful CSV parse in `handleFile()`, store `Date.now()` to `crypto_csv_uploaded_at`
- Read price cache timestamp from `getCachedCryptoPrices()`
- Format both using `formatSydneyDate()` from timezone utils

---

## 5. Confirmation Dialog on Clear

**File:** `app/(app)/crypto/page.tsx`

**Pattern:** Match the exact delete confirmation dialog from income/expenses pages.

**Implementation:**
- Add `const [showClearDialog, setShowClearDialog] = useState(false)`
- Clear button opens dialog instead of calling `clearCsv()` directly
- Dialog content:
  - Title: "Clear Crypto Data"
  - Description: "This will remove all crypto holdings data. You can re-import a CSV anytime."
  - Buttons: Cancel (outline) + Clear (destructive)
- Uses same `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose` imports as income/expenses

---

## 6. Exchange/Wallet Tagging

### 6a. Auto-parse from CSV notes

**File:** `lib/utils/crypto-csv.ts`

**Problem:** Transaction notes contain exchange info like `"okx"`, `"bybit"`, `"rollbit bot1"` but it's discarded during holdings computation.

**Solution:** During `computeHoldings()`, extract exchange hints from the `notes` field and attach them to holdings.

**Data model change in `lib/utils/types.ts`:**
```ts
export interface CryptoHolding {
  token: string;
  amount: number;
  totalCostUsd: number;
  currentValueUsd: number;
  exchange?: string;  // NEW — auto-parsed from CSV notes or manually set
}
```

**Parsing logic:**
- Known exchange keywords: `okx`, `bybit`, `binance`, `coinbase`, `kraken`, `rollbit`, `maple`, `aave`
- When computing holdings from transactions, collect all exchange hints per token
- If a token has transactions from multiple exchanges, join with comma: `"OKX, Bybit"`
- For portfolio overview format: check notes field similarly

### 6b. Manual override

**localStorage key:** `"crypto_exchange_overrides"` as `Record<string, string>`

**Behavior:**
- Overrides auto-parsed exchange for a specific token
- Persists across CSV re-imports (stored separately from CSV data)
- Applied after auto-parse: `exchange = overrides[token] ?? autoExchange ?? ""`

### 6c. Table column

**New "Exchange" column** in the holdings table between "P&L" and "% Port":
- Shows exchange name (auto-parsed or overridden)
- Clickable to edit inline: click → input field appears → type → press Enter or blur to save
- Saves to `crypto_exchange_overrides` in localStorage
- If empty, shows em-dash `—`

---

## 7. Fix Donut Dark Mode

**File:** `app/(app)/crypto/page.tsx`

**Problem:** `CryptoDonut` hardcodes light-theme tooltip colors:
```ts
backgroundColor: "#f4f3ed",
borderColor: "#c9c3a8",
textStyle: { color: "#2c251e" },
```

**Solution:** Use `getPieBaseOption(isDark)` from `lib/utils/echarts.ts`, matching the pattern in income/expenses pages.

**Implementation:**
- Add `useTheme()` hook, derive `isDark`
- Pass `isDark` to `CryptoDonut` as prop
- Inside `CryptoDonut`, spread `getPieBaseOption(isDark)` as the base option, then add the series config on top
- Remove hardcoded tooltip colors

**After:**
```tsx
function CryptoDonut({ chartData, isDark }: { ... }) {
  const base = getPieBaseOption(isDark);
  const option = {
    ...base,
    series: [{ type: "pie", radius: ["46%", "76%"], ... }],
  };
  return <ReactECharts option={option} ... />;
}
```

---

## 8. Clickable Legend (Interactive Token Visibility)

**File:** `app/(app)/crypto/page.tsx`

**Behavior:**
- ECharts donut gets a `legend` config with `selectedMode: true`
- Clicking a legend item hides/shows that token in the donut
- ECharts handles donut percentage recalculation automatically
- A `selectedTokens` state tracks which tokens are visible (default: all selected)
- **Hero number, P&L, and metric tiles recalculate** based on `selectedTokens`:
  - Only sum `currentValueUsd` / `totalCostUsd` for selected tokens
  - CASH tile only shows if CASH is selected

**Legend style:** Horizontal wrap below chart, matching current legend position but using ECharts built-in legend component with click behavior.

**Muted table rows:** Holdings not in `selectedTokens` render with `opacity-40` class on the table row.

**ECharts event:** Listen to `legendselectchanged` event to sync `selectedTokens` state.

---

## 9. Table Column Sorting

**File:** `app/(app)/crypto/page.tsx`

**Pattern:** Match income page's sort implementation.

**Sortable columns:** Token (alphabetical), Amount, Value, Cost, P&L, % Port, Exchange

**State:**
```ts
const [sortField, setSortField] = useState<"token" | "amount" | "value" | "cost" | "pnl" | "pct" | "exchange">("value");
const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
```

**Toggle logic** (same as income page):
```ts
function toggleSort(field: SortField) {
  if (sortField === field) {
    setSortDir(d => d === "desc" ? "asc" : "desc");
  } else {
    setSortField(field);
    setSortDir("desc");
  }
}
```

**Header rendering:** Clickable `<th>` with `cursor-pointer select-none`, shows `ArrowUpDown` icon on active column (same pattern as income page).

**Default:** Sorted by Value descending (current behavior).

---

## 10. Inline Exchange Editing

Covered in section 6c. The exchange cell in the holdings table is clickable:
- Normal state: shows exchange name or `—`
- Click: transforms into a small `<input>` (text field)
- Enter or blur: saves to `crypto_exchange_overrides` localStorage
- Escape: cancels edit

**Style:** Input matches table cell size, no visible border change (subtle transition), `text-xs` font.

---

## Architecture Summary

### Files to modify:
- `lib/utils/types.ts` — Add `exchange?` to `CryptoHolding`
- `lib/utils/crypto-csv.ts` — Fix stablecoin detection, extract exchange from notes
- `lib/utils/constants.ts` — Add `YIELD_PREFIXES`, `KNOWN_EXCHANGES`, `COINGECKO_IDS`
- `app/(app)/crypto/page.tsx` — All UI changes (donut, table, legend, sorting, dialogs, timestamps)

### New files:
- `lib/utils/crypto-prices.ts` — CoinGecko price fetching + caching

### localStorage keys used:
- `crypto_csv_text` — existing, raw CSV text
- `crypto_csv_uploaded_at` — NEW, unix timestamp of last CSV upload
- `crypto_prices` — NEW, `{ prices: Record<string, number>, fetchedAt: number }`
- `crypto_exchange_overrides` — NEW, `Record<string, string>` manual exchange assignments

### Dependencies:
- No new npm packages needed
- CoinGecko API is free (no key required for `/simple/price`)
- All existing UI components reused (Dialog, Button, Input from shadcn)
