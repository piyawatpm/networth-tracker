# Crypto Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken P&L data, add live CoinGecko prices, exchange tagging, interactive charts, and align crypto page patterns with income/expenses pages.

**Architecture:** Pure client-side. New `crypto-prices.ts` utility handles CoinGecko API with 24h localStorage cache (same pattern as `fx.ts`). CSV parsing fixes in `crypto-csv.ts` for stablecoin detection and exchange extraction. All UI changes in `crypto/page.tsx` — adding dark mode chart, clickable legend, sorting, inline exchange editing, clear confirmation dialog, and timestamps.

**Tech Stack:** Next.js 16, React 19, ECharts, localStorage, CoinGecko free API, shadcn/base-ui Dialog

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/utils/types.ts` | Modify | Add `exchange?` field to `CryptoHolding` |
| `lib/utils/constants.ts` | Modify | Add `YIELD_PREFIXES`, `KNOWN_EXCHANGES`, `COINGECKO_IDS` |
| `lib/utils/crypto-csv.ts` | Modify | Fix stablecoin detection, extract exchange from notes |
| `lib/utils/crypto-prices.ts` | Create | CoinGecko price fetching + caching + applyLivePrices |
| `app/(app)/crypto/page.tsx` | Modify | All UI changes |

---

### Task 1: Data model and constants

**Files:**
- Modify: `lib/utils/types.ts:106-111`
- Modify: `lib/utils/constants.ts`

- [ ] **Step 1: Add `exchange` field to CryptoHolding**

In `lib/utils/types.ts`, add the `exchange` field:

```ts
export interface CryptoHolding {
  token: string;
  amount: number;
  totalCostUsd: number;
  currentValueUsd: number;
  exchange?: string;  // auto-parsed from CSV notes or manually set
}
```

- [ ] **Step 2: Add new constants**

In `lib/utils/constants.ts`, add these after the existing `STABLECOINS` export:

```ts
// Yield-bearing token prefixes — NOT stablecoins even if they contain "usdc"/"usdt"
export const YIELD_PREFIXES = ["syrup", "aave", "compound", "venus", "morpho"];

// Known exchange keywords for auto-parsing from CSV notes
export const KNOWN_EXCHANGES: Record<string, string> = {
  okx: "OKX",
  bybit: "Bybit",
  binance: "Binance",
  coinbase: "Coinbase",
  kraken: "Kraken",
  rollbit: "Rollbit",
  maple: "Maple",
  kucoin: "KuCoin",
  gateio: "Gate.io",
  bitget: "Bitget",
  mexc: "MEXC",
};

// Map token symbols to CoinGecko IDs
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  OKB: "okb",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  UNI: "uniswap",
  ATOM: "cosmos",
  ARB: "arbitrum",
  OP: "optimism",
  APT: "aptos",
  SUI: "sui",
  SEI: "sei-network",
  TIA: "celestia",
  NEAR: "near",
  FTM: "fantom",
  INJ: "injective-protocol",
  RENDER: "render-token",
  FET: "fetch-ai",
  syrupUSDC: "syrup-usdc",
};
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors related to types.ts or constants.ts

- [ ] **Step 4: Commit**

```bash
git add lib/utils/types.ts lib/utils/constants.ts
git commit -m "feat(crypto): add exchange field to CryptoHolding and new constants"
```

---

### Task 2: Fix stablecoin detection and extract exchange from CSV

**Files:**
- Modify: `lib/utils/crypto-csv.ts`

- [ ] **Step 1: Fix `isStablecoin()` to exclude yield-bearing tokens**

Replace the existing `isStablecoin` function in `lib/utils/crypto-csv.ts`:

```ts
import { STABLECOINS, YIELD_PREFIXES, KNOWN_EXCHANGES } from "./constants";

function isStablecoin(name: string): boolean {
  const upper = name.toUpperCase();
  const lower = name.toLowerCase();

  // Yield-bearing tokens are NOT stablecoins even if they contain stablecoin names
  if (YIELD_PREFIXES.some((p) => lower.startsWith(p))) return false;

  if (STABLECOINS.has(upper)) return true;

  // Check common stablecoin names
  const stablecoinNames = [
    "tether", "usdt", "usdc", "busd", "dai", "tusd", "fdusd", "pyusd",
    "world liberty financial usd",
  ];
  return stablecoinNames.some((s) => lower.includes(s) || upper === s);
}
```

- [ ] **Step 2: Add exchange extraction helper**

Add this function before `computeHoldings()`:

```ts
function extractExchange(notes: string): string | undefined {
  if (!notes) return undefined;
  const lower = notes.toLowerCase().trim();
  for (const [keyword, label] of Object.entries(KNOWN_EXCHANGES)) {
    if (lower.includes(keyword)) return label;
  }
  return undefined;
}
```

- [ ] **Step 3: Update `computeHoldings()` to track exchanges per token**

Replace the `computeHoldings` function body:

```ts
export function computeHoldings(transactions: CryptoTransaction[]): CryptoHolding[] {
  const holdingsMap = new Map<string, { amount: number; totalCostUsd: number; exchanges: Set<string> }>();

  for (const tx of transactions) {
    // Group stablecoins as CASH
    const token = STABLECOINS.has(tx.token) || isStablecoin(tx.token) ? "CASH" : tx.token;

    if (!holdingsMap.has(token)) {
      holdingsMap.set(token, { amount: 0, totalCostUsd: 0, exchanges: new Set() });
    }

    const h = holdingsMap.get(token)!;

    // Extract exchange from notes
    const exchange = extractExchange(tx.notes);
    if (exchange) h.exchanges.add(exchange);

    switch (tx.type) {
      case "buy":
      case "transferIn":
        h.amount += tx.amount;
        if (tx.totalValueUsd) h.totalCostUsd += tx.totalValueUsd;
        break;
      case "sell":
      case "transferOut":
        h.amount -= tx.amount;
        if (tx.totalValueUsd) h.totalCostUsd -= tx.totalValueUsd;
        break;
    }
  }

  const holdings: CryptoHolding[] = [];
  for (const [token, data] of holdingsMap) {
    if (Math.abs(data.amount) < 0.0001) continue;
    const estimatedValue = token === "CASH" ? data.amount : data.totalCostUsd;
    holdings.push({
      token,
      amount: data.amount,
      totalCostUsd: Math.max(0, data.totalCostUsd),
      currentValueUsd: estimatedValue,
      exchange: data.exchanges.size > 0 ? Array.from(data.exchanges).join(", ") : undefined,
    });
  }

  return holdings.sort((a, b) => b.currentValueUsd - a.currentValueUsd);
}
```

- [ ] **Step 4: Update `parsePortfolioOverview()` to include exchange field**

In `parsePortfolioOverview()`, the `holdings.push()` call needs `exchange: undefined` added:

```ts
    holdings.push({
      token,
      amount,
      totalCostUsd: Math.max(0, costBasis),
      currentValueUsd: currentValue,
      exchange: undefined,
    });
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 6: Verify in browser**

Open `http://localhost:3001/crypto`. Verify:
- syrupUSDC appears as its own row (NOT grouped into CASH)
- CASH only contains USDC, USDT, USD1
- Exchange column data auto-detected (e.g., BTC shows nothing, SOL shows "OKX", ETH shows "OKX")

- [ ] **Step 7: Commit**

```bash
git add lib/utils/crypto-csv.ts
git commit -m "fix(crypto): exclude yield tokens from stablecoins, extract exchange from notes"
```

---

### Task 3: Create CoinGecko price fetching utility

**Files:**
- Create: `lib/utils/crypto-prices.ts`

- [ ] **Step 1: Create the crypto-prices module**

Create `lib/utils/crypto-prices.ts`:

```ts
import type { CryptoHolding } from "./types";
import { COINGECKO_IDS } from "./constants";

const PRICE_CACHE_KEY = "crypto_prices";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface CachedPrices {
  prices: Record<string, number>; // token symbol → USD price
  fetchedAt: number;
}

export function getCachedCryptoPrices(): CachedPrices | null {
  try {
    const cached = localStorage.getItem(PRICE_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {
    // Invalid cache
  }
  return null;
}

export function isCryptoPricesCacheStale(): boolean {
  const cached = getCachedCryptoPrices();
  if (!cached) return true;
  return Date.now() - cached.fetchedAt > CACHE_DURATION;
}

export async function fetchCryptoPrices(
  tokens: string[],
): Promise<Record<string, number>> {
  // Build CoinGecko IDs list from token symbols
  const idMap: Record<string, string> = {}; // coingecko_id → token symbol
  for (const token of tokens) {
    if (token === "CASH") continue; // stablecoins are $1
    const geckoId = COINGECKO_IDS[token] ?? token.toLowerCase();
    idMap[geckoId] = token;
  }

  const ids = Object.keys(idMap);
  if (ids.length === 0) return {};

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    const data: Record<string, { usd?: number }> = await res.json();

    const prices: Record<string, number> = {};
    for (const [geckoId, priceData] of Object.entries(data)) {
      const token = idMap[geckoId];
      if (token && priceData.usd != null) {
        prices[token] = priceData.usd;
      }
    }

    // Cache result
    const cached: CachedPrices = { prices, fetchedAt: Date.now() };
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cached));

    return prices;
  } catch {
    // Return stale cache if available
    const cached = getCachedCryptoPrices();
    return cached?.prices ?? {};
  }
}

export function applyLivePrices(
  holdings: CryptoHolding[],
  prices: Record<string, number>,
): CryptoHolding[] {
  return holdings.map((h) => {
    if (h.token === "CASH") return h; // stablecoins stay at amount = value
    const livePrice = prices[h.token];
    if (livePrice == null) return h; // no price found, keep cost basis
    return {
      ...h,
      currentValueUsd: livePrice * h.amount,
    };
  });
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/crypto-prices.ts
git commit -m "feat(crypto): add CoinGecko price fetching with 24h cache"
```

---

### Task 4: Crypto page — dark mode donut, CASH P&L, timestamps, clear dialog

**Files:**
- Modify: `app/(app)/crypto/page.tsx`

This task refactors the core page: fixes the donut theme, shows CASH P&L, adds timestamps, and adds the clear confirmation dialog. The exchange column, legend, and sorting are separate tasks.

- [ ] **Step 1: Update imports**

Replace the imports section at the top of `app/(app)/crypto/page.tsx`:

```ts
"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import {
  parseAndComputeHoldings,
  getTotalCryptoValueUsd,
  getTotalCryptoCostUsd,
  getCashValueUsd,
} from "@/lib/utils/crypto-csv";
import {
  fetchCryptoPrices,
  getCachedCryptoPrices,
  isCryptoPricesCacheStale,
  applyLivePrices,
} from "@/lib/utils/crypto-prices";
import { getPieBaseOption } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import ReactECharts from "echarts-for-react";
import { ECHARTS_COLORS } from "@/lib/utils/echarts";
import { Upload, FileText, X, Bitcoin } from "lucide-react";
```

- [ ] **Step 2: Fix CryptoDonut to use theme-aware base option**

Replace the entire `CryptoDonut` component:

```tsx
function CryptoDonut({
  chartData,
  isDark,
}: {
  chartData: { token: string; value: number; fill: string }[];
  isDark: boolean;
}) {
  const base = getPieBaseOption(isDark);
  const option = useMemo(
    () => ({
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["46%", "76%"],
          center: ["50%", "50%"],
          padAngle: 2,
          data: chartData.map((d) => ({
            name: d.token,
            value: d.value,
            itemStyle: { color: d.fill },
          })),
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.3)",
            },
          },
        },
      ],
    }),
    [base, chartData],
  );

  return <ReactECharts option={option} style={{ height: 260, width: "100%" }} />;
}
```

- [ ] **Step 3: Add theme, timestamps, clear dialog state, and live prices to the page component**

At the top of `CryptoPage()`, after the existing state declarations (`csvText`, `format`, `isDragOver`, etc.), add:

```tsx
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Timestamps
  const [csvUploadedAt, setCsvUploadedAt] = useLocalStorage<number | null>(
    "crypto_csv_uploaded_at",
    null,
  );

  // Clear confirmation dialog
  const [showClearDialog, setShowClearDialog] = useState(false);

  // Live prices
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
```

- [ ] **Step 4: Add price fetching effect**

After the state declarations, add:

```tsx
  // Fetch live prices on mount (if stale) and after CSV upload
  useEffect(() => {
    if (holdings.length === 0) return;
    const tokens = holdings.map((h) => h.token);

    // Use cache if fresh
    const cached = getCachedCryptoPrices();
    if (cached && !isCryptoPricesCacheStale()) {
      setLivePrices(cached.prices);
      return;
    }

    // Fetch fresh prices
    fetchCryptoPrices(tokens).then((prices) => {
      if (Object.keys(prices).length > 0) {
        setLivePrices(prices);
      }
    });
  }, [holdings]);
```

- [ ] **Step 5: Apply live prices to holdings and recalculate metrics**

Replace the existing metrics calculations (`totalValueUsd`, `totalCostUsd`, `cashUsd`, `pnlUsd`, and their converted values) with:

```tsx
  // Apply live prices to holdings
  const pricedHoldings = useMemo(
    () => applyLivePrices(holdings, livePrices),
    [holdings, livePrices],
  );

  const totalValueUsd = useMemo(
    () => getTotalCryptoValueUsd(pricedHoldings),
    [pricedHoldings],
  );
  const totalCostUsd = useMemo(
    () => getTotalCryptoCostUsd(pricedHoldings),
    [pricedHoldings],
  );
  const cashUsd = useMemo(() => getCashValueUsd(pricedHoldings), [pricedHoldings]);
  const pnlUsd = totalValueUsd - totalCostUsd;

  const totalValueConverted = convert(totalValueUsd, "USD");
  const totalCostConverted = convert(totalCostUsd, "USD");
  const pnlConverted = convert(pnlUsd, "USD");
  const cashConverted = convert(cashUsd, "USD");
```

Also update `chartData` to use `pricedHoldings`:

```tsx
  const chartData = useMemo(() => {
    if (totalValueUsd === 0) return [];
    return pricedHoldings
      .filter((h) => h.currentValueUsd / totalValueUsd >= 0.01)
      .map((h, i) => ({
        token: h.token,
        value: h.currentValueUsd,
        fill: ECHARTS_COLORS[i % ECHARTS_COLORS.length],
      }));
  }, [pricedHoldings, totalValueUsd]);
```

- [ ] **Step 6: Update `handleFile` to store upload timestamp and re-fetch prices**

Replace the existing `handleFile` callback:

```tsx
  const handleFile = useCallback(
    (file: File) => {
      setUploadStatus("Reading file...");
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text && text.trim().length > 0) {
          setCsvText(text);
          setCsvUploadedAt(Date.now());
          const h = parseAndComputeHoldings(text);
          if (h.length > 0) {
            setUploadStatus(`Loaded ${h.length} holdings`);
            // Re-fetch prices for new portfolio
            const tokens = h.map((holding) => holding.token);
            fetchCryptoPrices(tokens).then((prices) => {
              if (Object.keys(prices).length > 0) {
                setLivePrices(prices);
              }
            });
          } else {
            setUploadStatus("Could not parse holdings. Check CSV format.");
          }
        } else {
          setUploadStatus("File was empty");
        }
      };
      reader.onerror = () => {
        setUploadStatus("Error reading file");
      };
      reader.readAsText(file);
    },
    [setCsvText, setCsvUploadedAt],
  );
```

- [ ] **Step 7: Update clearCsv to also clear timestamps**

```tsx
  const clearCsv = useCallback(() => {
    setCsvText("");
    setCsvUploadedAt(null);
    setUploadStatus(null);
    setShowClearDialog(false);
  }, [setCsvText, setCsvUploadedAt]);
```

- [ ] **Step 8: Add timestamps below hero**

In the hero section, after the `display-number` div, add:

```tsx
          {/* Timestamps */}
          {csvUploadedAt && (
            <p className="text-xs text-muted-foreground mt-2">
              CSV: {new Date(csvUploadedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
              {getCachedCryptoPrices()?.fetchedAt && (
                <>
                  {" · Prices: "}
                  {new Date(getCachedCryptoPrices()!.fetchedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </>
              )}
            </p>
          )}
```

- [ ] **Step 9: Fix CASH P&L — remove the `--` hiding**

In the holdings table row, replace the P&L cell:

```tsx
                        <td
                          className={cn(
                            "px-4 py-3 text-right tabular-nums font-mono text-xs",
                            rowPnl >= 0 ? "text-income" : "text-expense",
                          )}
                        >
                          {`${rowPnl >= 0 ? "+" : "-"}${format(Math.abs(rowPnl), "USD")}`}
                        </td>
```

Remove the `const isCash = h.token === "CASH";` line since it's no longer needed in the P&L rendering.

- [ ] **Step 10: Update CryptoDonut call to pass isDark**

```tsx
              <CryptoDonut chartData={chartData} isDark={isDark} />
```

- [ ] **Step 11: Replace Clear button with dialog-opening button**

Replace the Clear button `onClick` from `clearCsv` to `() => setShowClearDialog(true)`:

```tsx
              <button
                onClick={() => setShowClearDialog(true)}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
```

- [ ] **Step 12: Add the Clear confirmation dialog**

At the very end of the return, before the closing `</div>`, add:

```tsx
      {/* Clear confirmation dialog */}
      <Dialog
        open={showClearDialog}
        onOpenChange={(open) => !open && setShowClearDialog(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear Crypto Data</DialogTitle>
            <DialogDescription>
              This will remove all crypto holdings data. You can re-import a CSV
              anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button variant="destructive" onClick={clearCsv}>
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 13: Update holdings table to use `pricedHoldings`**

In the table body, change `{holdings.map((h, i) => {` to `{pricedHoldings.map((h, i) => {`.

- [ ] **Step 14: Verify build**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: No errors.

- [ ] **Step 15: Verify in browser**

Open `http://localhost:3001/crypto`. Check:
- Donut tooltip adapts to dark/light mode (toggle theme to verify)
- CASH row shows real P&L (not `--`)
- "CSV: X · Prices: Y" appears below hero number
- Clear button opens a confirmation dialog
- P&L values for BTC/SOL/ETH reflect live prices (not all +$0.00)

- [ ] **Step 16: Commit**

```bash
git add app/\(app\)/crypto/page.tsx
git commit -m "feat(crypto): dark mode donut, CASH P&L, timestamps, clear dialog, live prices"
```

---

### Task 5: Exchange column with inline editing

**Files:**
- Modify: `app/(app)/crypto/page.tsx`

- [ ] **Step 1: Add exchange override state**

In `CryptoPage()`, after the existing state declarations, add:

```tsx
  // Exchange overrides (manual assignments persisted across CSV re-imports)
  const [exchangeOverrides, setExchangeOverrides] = useLocalStorage<Record<string, string>>(
    "crypto_exchange_overrides",
    {},
  );
  const [editingExchange, setEditingExchange] = useState<string | null>(null);
  const [editExchangeValue, setEditExchangeValue] = useState("");
```

- [ ] **Step 2: Add helper to get effective exchange for a token**

```tsx
  const getExchange = useCallback(
    (holding: CryptoHolding) => exchangeOverrides[holding.token] ?? holding.exchange ?? "",
    [exchangeOverrides],
  );

  const saveExchange = useCallback(
    (token: string, value: string) => {
      setExchangeOverrides((prev) => ({
        ...prev,
        [token]: value.trim(),
      }));
      setEditingExchange(null);
    },
    [setExchangeOverrides],
  );
```

Import `CryptoHolding` type at the top if not already imported:

```ts
import type { CryptoHolding } from "@/lib/utils/types";
```

- [ ] **Step 3: Add Exchange column header**

In the table `<thead>`, add this `<th>` between the P&L and % Port columns:

```tsx
                    <th className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Exchange
                    </th>
```

- [ ] **Step 4: Add Exchange cell with inline editing**

In the table `<tbody>`, add this `<td>` between the P&L and % Port cells for each row:

```tsx
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {editingExchange === h.token ? (
                            <input
                              autoFocus
                              className="w-20 bg-transparent border-b border-border text-right text-xs outline-none"
                              value={editExchangeValue}
                              onChange={(e) => setEditExchangeValue(e.target.value)}
                              onBlur={() => saveExchange(h.token, editExchangeValue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveExchange(h.token, editExchangeValue);
                                if (e.key === "Escape") setEditingExchange(null);
                              }}
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setEditingExchange(h.token);
                                setEditExchangeValue(getExchange(h));
                              }}
                              className="hover:text-foreground transition-colors cursor-pointer"
                            >
                              {getExchange(h) || "\u2014"}
                            </button>
                          )}
                        </td>
```

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3001/crypto`. Check:
- Exchange column shows auto-parsed exchanges (e.g., "OKX" for SOL, ETH)
- Click on an exchange cell to edit it inline
- Type a new value, press Enter — it persists
- Press Escape to cancel
- Replace CSV — manual overrides persist, auto-parsed values update

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/crypto/page.tsx
git commit -m "feat(crypto): add exchange column with auto-parse and inline editing"
```

---

### Task 6: Clickable legend with metrics recalculation

**Files:**
- Modify: `app/(app)/crypto/page.tsx`

- [ ] **Step 1: Add selectedTokens state**

In `CryptoPage()`, add:

```tsx
  // Interactive legend — tracks which tokens are visible
  const [selectedTokens, setSelectedTokens] = useState<Record<string, boolean>>({});

  // Initialize selectedTokens when holdings change
  useEffect(() => {
    if (pricedHoldings.length > 0) {
      setSelectedTokens((prev) => {
        const next: Record<string, boolean> = {};
        for (const h of pricedHoldings) {
          // Keep existing selection, default to true for new tokens
          next[h.token] = prev[h.token] ?? true;
        }
        return next;
      });
    }
  }, [pricedHoldings]);
```

- [ ] **Step 2: Compute filtered metrics based on selected tokens**

Add these after the existing metric calculations:

```tsx
  // Filtered metrics based on legend selection
  const filteredHoldings = useMemo(
    () => pricedHoldings.filter((h) => selectedTokens[h.token] !== false),
    [pricedHoldings, selectedTokens],
  );
  const filteredValueUsd = useMemo(
    () => getTotalCryptoValueUsd(filteredHoldings),
    [filteredHoldings],
  );
  const filteredCostUsd = useMemo(
    () => getTotalCryptoCostUsd(filteredHoldings),
    [filteredHoldings],
  );
  const filteredCashUsd = useMemo(
    () => getCashValueUsd(filteredHoldings),
    [filteredHoldings],
  );
  const filteredPnlUsd = filteredValueUsd - filteredCostUsd;

  const allSelected = pricedHoldings.length === filteredHoldings.length;
```

- [ ] **Step 3: Update hero and metrics to use filtered values**

Replace the hero `NumberTicker` value and the four `MetricCell` values to use `filteredValueUsd`, `filteredCostUsd`, `filteredPnlUsd`, `filteredCashUsd` (converted via `convert(x, "USD")`):

Hero:
```tsx
              <NumberTicker value={convert(filteredValueUsd, "USD")} decimalPlaces={2} />
```

Metric tiles:
```tsx
          <MetricCell label="Total Value" value={format(filteredValueUsd, "USD")} />
          <MetricCell label="Total Cost" value={format(filteredCostUsd, "USD")} />
          <MetricCell
            label="P&L"
            value={format(Math.abs(filteredPnlUsd), "USD")}
            prefix={filteredPnlUsd >= 0 ? "+" : "-"}
            className={filteredPnlUsd >= 0 ? "text-income" : "text-expense"}
          />
          <MetricCell label="Cash" value={format(filteredCashUsd, "USD")} />
```

- [ ] **Step 4: Replace manual legend with clickable legend**

Replace the current legend `<div className="mt-4 flex flex-wrap ...">` block with:

```tsx
            {/* Clickable legend */}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
              {chartData.map((d) => {
                const isSelected = selectedTokens[d.token] !== false;
                return (
                  <button
                    key={d.token}
                    onClick={() =>
                      setSelectedTokens((prev) => ({
                        ...prev,
                        [d.token]: !isSelected,
                      }))
                    }
                    className={cn(
                      "flex items-center gap-1.5 transition-opacity cursor-pointer",
                      !isSelected && "opacity-30",
                    )}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: d.fill }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {d.token}
                    </span>
                  </button>
                );
              })}
            </div>
```

- [ ] **Step 5: Mute unselected rows in the table**

Update the table row `<tr>` to add opacity when deselected:

```tsx
                      <tr
                        key={h.token}
                        className={cn(
                          "border-b border-border/40 transition-colors hover:bg-secondary/40",
                          i === pricedHoldings.length - 1 && "border-b-0",
                          selectedTokens[h.token] === false && "opacity-40",
                        )}
                      >
```

- [ ] **Step 6: Show indicator when filtering is active**

Below the metric tiles, add a subtle indicator when not all tokens are selected:

```tsx
        {!allSelected && (
          <p className="text-xs text-muted-foreground">
            Showing {filteredHoldings.length} of {pricedHoldings.length} tokens ·{" "}
            <button
              onClick={() => {
                const all: Record<string, boolean> = {};
                pricedHoldings.forEach((h) => { all[h.token] = true; });
                setSelectedTokens(all);
              }}
              className="underline hover:text-foreground cursor-pointer"
            >
              Show all
            </button>
          </p>
        )}
```

- [ ] **Step 7: Verify in browser**

Open `http://localhost:3001/crypto`. Check:
- Click legend items to hide/show tokens
- Hero number and P&L recalculate when tokens are hidden
- Hidden tokens appear muted in table
- "Showing X of Y tokens · Show all" link appears when filtering
- Click "Show all" to reset

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/crypto/page.tsx
git commit -m "feat(crypto): clickable legend with metrics recalculation"
```

---

### Task 7: Table column sorting

**Files:**
- Modify: `app/(app)/crypto/page.tsx`

- [ ] **Step 1: Add sorting imports and state**

Add `ArrowUpDown` to the lucide-react import:

```ts
import { Upload, FileText, X, Bitcoin, ArrowUpDown } from "lucide-react";
```

Add sort state in `CryptoPage()`:

```tsx
  type SortField = "token" | "amount" | "value" | "cost" | "pnl" | "pct" | "exchange";
  const [sortField, setSortField] = useState<SortField>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }
```

- [ ] **Step 2: Add sorted holdings computation**

After `pricedHoldings`, add:

```tsx
  const sortedHoldings = useMemo(() => {
    const list = [...pricedHoldings];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "token":
          cmp = a.token.localeCompare(b.token);
          break;
        case "amount":
          cmp = a.amount - b.amount;
          break;
        case "value":
          cmp = a.currentValueUsd - b.currentValueUsd;
          break;
        case "cost":
          cmp = a.totalCostUsd - b.totalCostUsd;
          break;
        case "pnl":
          cmp = (a.currentValueUsd - a.totalCostUsd) - (b.currentValueUsd - b.totalCostUsd);
          break;
        case "pct":
          cmp = a.currentValueUsd - b.currentValueUsd; // same as value sort
          break;
        case "exchange":
          cmp = (getExchange(a)).localeCompare(getExchange(b));
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [pricedHoldings, sortField, sortDir, getExchange]);
```

- [ ] **Step 3: Replace table headers with clickable sortable headers**

Replace all `<th>` elements in the table header with:

```tsx
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th
                      className="px-6 pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("token")}
                    >
                      <span className="inline-flex items-center gap-1">
                        Token
                        {sortField === "token" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("amount")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Amount
                        {sortField === "amount" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("value")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Value
                        {sortField === "value" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("cost")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Cost
                        {sortField === "cost" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("pnl")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        P&L
                        {sortField === "pnl" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("exchange")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Exchange
                        {sortField === "exchange" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-6 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("pct")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        % Port
                        {sortField === "pct" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                  </tr>
                </thead>
```

- [ ] **Step 4: Use `sortedHoldings` in the table body**

Change `{pricedHoldings.map((h, i) => {` to `{sortedHoldings.map((h, i) => {` in the table body.

Also update the last-row border check: `i === sortedHoldings.length - 1 && "border-b-0"`.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3001/crypto`. Check:
- Click "Token" header → sorts alphabetically
- Click "Value" header → sorts by value (default)
- Click again → reverses direction
- Active sort column shows small arrow icon
- All columns sortable: Token, Amount, Value, Cost, P&L, Exchange, % Port

- [ ] **Step 6: Final build verification**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/crypto/page.tsx
git commit -m "feat(crypto): add sortable table columns"
```

---

## Verification Checklist

After all tasks are complete, verify the full page end-to-end:

- [ ] syrupUSDC shows as its own row (not grouped into CASH)
- [ ] BTC/SOL/ETH/OKB show live prices and real P&L (not +$0.00)
- [ ] CASH shows real P&L (not `--`)
- [ ] "CSV: date · Prices: date" appears below hero
- [ ] Clear button opens confirmation dialog
- [ ] Exchange column shows auto-parsed values (OKX, Bybit, Rollbit)
- [ ] Exchange cell is clickable for inline editing
- [ ] Donut chart tooltip works in both light and dark mode
- [ ] Click legend items to hide/show tokens
- [ ] Hero, P&L, and metrics recalculate when tokens are hidden
- [ ] Hidden tokens appear muted in table
- [ ] "Show all" link appears and works
- [ ] All table columns are sortable with arrow indicator
- [ ] Replace CSV re-fetches prices
- [ ] `next build` passes with no errors
