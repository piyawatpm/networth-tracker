# Portfolio Transactions + Three Worlds + Money Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add buy/sell transaction logging per portfolio holding, a three-worlds distribution chart (Normal/Crypto/Super), and a money flow insights card on the dashboard.

**Architecture:** New `PortfolioTransaction` type stored in localStorage follows the existing `PriceUpdateLog` pattern from `prices.ts`. A transaction dialog on the portfolio page records buys/sells that auto-update holding units/invested. Dashboard gets two new cards: a donut showing asset distribution across Normal/Crypto/Super worlds, and a money flow breakdown showing Income/Expenses/Invested/Free Cash with rates.

**Tech Stack:** React, Next.js App Router, localStorage via `useLocalStorage` hook, ECharts for charts, shadcn/ui Dialog components, existing `useCurrency` context for conversion.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `lib/utils/portfolio-transactions.ts` | CRUD for portfolio transactions in localStorage (follows `prices.ts` pattern) |
| `components/portfolio/transaction-dialog.tsx` | Buy/Sell form dialog for a holding |
| `components/portfolio/transaction-history.tsx` | Per-holding transaction timeline dialog |
| `app/(app)/dashboard/_components/world-distribution-chart.tsx` | Donut chart: Normal vs Crypto vs Super |
| `app/(app)/dashboard/_components/money-flow-card.tsx` | Income/Expenses/Invested/Free Cash breakdown card |

### Modified Files
| File | Changes |
|------|---------|
| `lib/utils/types.ts` | Add `PortfolioTransaction` interface |
| `lib/utils/constants.ts` | Add `INCOME_WORLD_MAP` constant |
| `app/(app)/portfolio/_components/holdings-table.tsx` | Add "Buy/Sell" and "History" buttons per holding |
| `app/(app)/portfolio/page.tsx` | Wire transaction state, auto-log on new holding creation |
| `app/(app)/dashboard/page.tsx` | Compute world totals + investment metrics, render new cards |

---

## Task 1: Add PortfolioTransaction Type + INCOME_WORLD_MAP

**Files:**
- Modify: `lib/utils/types.ts`
- Modify: `lib/utils/constants.ts`

- [ ] **Step 1: Add PortfolioTransaction interface to types.ts**

Add after the `PortfolioHolding` interface (after line 168):

```typescript
export interface PortfolioTransaction {
  id: string;
  holdingId: string;
  holdingName: string;
  type: "buy" | "sell";
  units: number;
  pricePerUnit: number;
  totalAmount: number;
  currency: Currency;
  date: string; // YYYY-MM-DD
  notes: string;
  createdAt: number;
}
```

- [ ] **Step 2: Add INCOME_WORLD_MAP to constants.ts**

Add at the end of `constants.ts`:

```typescript
export type FinancialWorld = "normal" | "crypto" | "super";

export const INCOME_WORLD_MAP: Record<string, FinancialWorld> = {
  salary: "normal",
  super_employer: "super",
  super_personal: "super",
  arena_bot: "crypto",
  arb_bot: "crypto",
  uber: "normal",
  freelance: "normal",
  dividend: "normal",
  crypto_yield: "crypto",
  interest: "normal",
  rental: "normal",
  bonus: "normal",
  other: "normal",
};

export const WORLD_LABELS: Record<FinancialWorld, string> = {
  normal: "Traditional",
  crypto: "Crypto",
  super: "Super",
};

export const WORLD_COLORS: Record<FinancialWorld, string> = {
  normal: "#b8860b",
  crypto: "#2e8b57",
  super: "#4d7cc7",
};
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add lib/utils/types.ts lib/utils/constants.ts
git commit -m "feat: add PortfolioTransaction type and INCOME_WORLD_MAP constants"
```

---

## Task 2: Create portfolio-transactions.ts Utility

**Files:**
- Create: `lib/utils/portfolio-transactions.ts`

- [ ] **Step 1: Create the utility file**

Follow the exact pattern from `lib/utils/prices.ts` (getUpdateLog/addUpdateLog):

```typescript
import type { PortfolioTransaction } from "./types";

const STORAGE_KEY = "portfolio_transactions";
const MAX_ENTRIES = 500;

export function getTransactions(): PortfolioTransaction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTransactions(txns: PortfolioTransaction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(txns.slice(0, MAX_ENTRIES)));
}

export function addTransaction(tx: PortfolioTransaction): void {
  const txns = getTransactions();
  txns.unshift(tx);
  saveTransactions(txns);
}

export function getTransactionsForHolding(holdingId: string): PortfolioTransaction[] {
  return getTransactions().filter((t) => t.holdingId === holdingId);
}

export function getTransactionsInDateRange(from: string, to: string): PortfolioTransaction[] {
  return getTransactions().filter((t) => t.date >= from && t.date <= to);
}

export function getBuysInDateRange(from: string, to: string): PortfolioTransaction[] {
  return getTransactionsInDateRange(from, to).filter((t) => t.type === "buy");
}

export function totalInvestedInRange(
  from: string,
  to: string,
  convert: (amount: number, currency: string) => number,
): number {
  return getBuysInDateRange(from, to).reduce(
    (sum, tx) => sum + convert(tx.totalAmount, tx.currency),
    0,
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/utils/portfolio-transactions.ts
git commit -m "feat: add portfolio-transactions utility for buy/sell logging"
```

---

## Task 3: Create TransactionDialog Component

**Files:**
- Create: `components/portfolio/transaction-dialog.tsx`

- [ ] **Step 1: Create the transaction dialog**

Follow the pattern from `components/portfolio/holding-dialog.tsx` for form structure and `components/shared/manage-categories-dialog.tsx` for dialog pattern:

```tsx
"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PortfolioHolding, PortfolioTransaction, Currency } from "@/lib/utils/types";
import { useCurrency } from "@/components/providers/currency-provider";
import { getSydneyDateString } from "@/lib/utils/timezone";

interface TransactionDialogProps {
  holding: PortfolioHolding;
  onSave: (tx: PortfolioTransaction) => void;
  trigger: React.ReactNode;
}

export function TransactionDialog({ holding, onSave, trigger }: TransactionDialogProps) {
  const { enabledCurrencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const [txType, setTxType] = useState<"buy" | "sell">("buy");
  const [units, setUnits] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [currency, setCurrency] = useState<Currency>(holding.currency);
  const [date, setDate] = useState(getSydneyDateString());
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setTxType("buy");
      setUnits("");
      setPricePerUnit(
        holding.units > 0
          ? (holding.currentValue / holding.units).toFixed(2)
          : "",
      );
      setCurrency(holding.currency);
      setDate(getSydneyDateString());
      setNotes("");
    }
  }, [open, holding]);

  const parsedUnits = parseFloat(units);
  const parsedPrice = parseFloat(pricePerUnit);
  const totalAmount =
    !isNaN(parsedUnits) && !isNaN(parsedPrice) ? parsedUnits * parsedPrice : 0;

  function handleSave() {
    if (isNaN(parsedUnits) || parsedUnits <= 0) return;
    if (isNaN(parsedPrice) || parsedPrice < 0) return;
    if (txType === "sell" && parsedUnits > holding.units) return;

    const tx: PortfolioTransaction = {
      id: crypto.randomUUID(),
      holdingId: holding.id,
      holdingName: holding.name,
      type: txType,
      units: parsedUnits,
      pricePerUnit: parsedPrice,
      totalAmount,
      currency,
      date,
      notes,
      createdAt: Date.now(),
    };

    onSave(tx);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Log Transaction &mdash; {holding.name}
          </DialogTitle>
          <DialogDescription>
            {holding.ticker} &middot; {holding.units} units held
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Buy / Sell toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTxType("buy")}
              className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                txType === "buy"
                  ? "border-income bg-income/10 text-income"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setTxType("sell")}
              className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                txType === "sell"
                  ? "border-expense bg-expense/10 text-expense"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Sell
            </button>
          </div>

          {/* Units + Price per unit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-xs">Units</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                placeholder="0"
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Price per Unit</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={pricePerUnit}
                onChange={(e) => setPricePerUnit(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
          </div>

          {/* Total + Currency */}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="grid gap-2">
              <Label className="text-xs">Total Amount</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm tabular-nums">
                {totalAmount > 0 ? totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v)}>
                <SelectTrigger className="w-[90px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enabledCurrencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date */}
          <div className="grid gap-2">
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="grid gap-2">
            <Label className="text-xs">Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. DCA buy, rebalancing..."
            />
          </div>

          {/* Sell warning */}
          {txType === "sell" && parsedUnits > holding.units && (
            <p className="text-xs text-expense">
              Cannot sell more than {holding.units} units held.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            onClick={handleSave}
            disabled={
              isNaN(parsedUnits) ||
              parsedUnits <= 0 ||
              isNaN(parsedPrice) ||
              parsedPrice < 0 ||
              (txType === "sell" && parsedUnits > holding.units)
            }
            className={txType === "buy" ? "" : "bg-expense hover:bg-expense/90"}
          >
            Log {txType === "buy" ? "Buy" : "Sell"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add components/portfolio/transaction-dialog.tsx
git commit -m "feat: add TransactionDialog component for buy/sell logging"
```

---

## Task 4: Create TransactionHistory Component

**Files:**
- Create: `components/portfolio/transaction-history.tsx`

- [ ] **Step 1: Create the transaction history dialog**

Follow the exact pattern from `app/(app)/portfolio/_components/price-update-status.tsx`:

```tsx
"use client";

import type { PortfolioHolding, PortfolioTransaction } from "@/lib/utils/types";
import { formatTimeAgo } from "@/lib/utils/prices";
import { cn } from "@/lib/utils";
import { formatDateString } from "@/lib/utils/timezone";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TransactionHistoryProps {
  holdings: PortfolioHolding[];
  transactions: PortfolioTransaction[];
  holdingId: string | null;
  setHoldingId: (id: string | null) => void;
  format: (value: number, currency?: string) => string;
}

export function TransactionHistory({
  holdings,
  transactions,
  holdingId,
  setHoldingId,
  format,
}: TransactionHistoryProps) {
  const holding = holdings.find((h) => h.id === holdingId);
  const entries = transactions.filter((t) => t.holdingId === holdingId);

  // Compute summary
  const totalBought = entries
    .filter((t) => t.type === "buy")
    .reduce((s, t) => s + t.units, 0);
  const totalSold = entries
    .filter((t) => t.type === "sell")
    .reduce((s, t) => s + t.units, 0);
  const totalInvested = entries
    .filter((t) => t.type === "buy")
    .reduce((s, t) => s + t.totalAmount, 0);

  return (
    <Dialog
      open={holdingId !== null}
      onOpenChange={(open) => {
        if (!open) setHoldingId(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Transaction History &mdash; {holding?.name ?? ""}
          </DialogTitle>
          <DialogDescription>
            {holding?.ticker ?? ""} &middot;{" "}
            {entries.length} transaction{entries.length !== 1 ? "s" : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Summary */}
        {entries.length > 0 && (
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <div className="rounded-lg bg-secondary/50 p-2">
              <p className="text-muted-foreground">Bought</p>
              <p className="font-mono font-medium tabular-nums">
                {totalBought.toLocaleString(undefined, { maximumFractionDigits: 4 })} units
              </p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2">
              <p className="text-muted-foreground">Sold</p>
              <p className="font-mono font-medium tabular-nums">
                {totalSold.toLocaleString(undefined, { maximumFractionDigits: 4 })} units
              </p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2">
              <p className="text-muted-foreground">Invested</p>
              <p className="font-mono font-medium tabular-nums">
                {format(totalInvested)}
              </p>
            </div>
          </div>
        )}

        {entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No transactions recorded yet.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto -mx-1 px-1">
            <div className="divide-y divide-border">
              {entries.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    {tx.type === "buy" ? (
                      <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-income bg-income/10 px-1.5 py-0.5 rounded">
                        <TrendingUp className="h-2.5 w-2.5" /> buy
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-expense bg-expense/10 px-1.5 py-0.5 rounded">
                        <TrendingDown className="h-2.5 w-2.5" /> sell
                      </span>
                    )}
                    <div>
                      <span className="font-mono tabular-nums text-xs">
                        {tx.units.toLocaleString(undefined, { maximumFractionDigits: 4 })} units
                      </span>
                      <span className="text-muted-foreground/50 mx-1">@</span>
                      <span className="font-mono tabular-nums text-xs">
                        {format(tx.pricePerUnit)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        "font-mono tabular-nums text-xs font-medium",
                        tx.type === "buy" ? "text-income" : "text-expense",
                      )}
                    >
                      {tx.type === "buy" ? "+" : "-"}{format(tx.totalAmount)}
                    </p>
                    <p className="text-[10px] text-muted-foreground/50">
                      {formatDateString(tx.date)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add components/portfolio/transaction-history.tsx
git commit -m "feat: add TransactionHistory dialog for per-holding timeline"
```

---

## Task 5: Wire Transactions into Portfolio Page

**Files:**
- Modify: `app/(app)/portfolio/page.tsx`
- Modify: `app/(app)/portfolio/_components/holdings-table.tsx`

- [ ] **Step 1: Update portfolio/page.tsx — add transaction state and handlers**

Add imports at top of `portfolio/page.tsx`:

```typescript
import { addTransaction, getTransactions } from "@/lib/utils/portfolio-transactions";
import type { PortfolioTransaction } from "@/lib/utils/types";
import { TransactionHistory } from "@/components/portfolio/transaction-history";
```

Add state hooks (near the other useState calls, around line 48):

```typescript
const [transactions, setTransactions] = useState<PortfolioTransaction[]>([]);
const [txHistoryHoldingId, setTxHistoryHoldingId] = useState<string | null>(null);

// Load transactions on mount
useEffect(() => {
  setTransactions(getTransactions());
}, []);
```

Add the transaction handler function (near handleSave, around line 314):

```typescript
function handleTransaction(tx: PortfolioTransaction) {
  addTransaction(tx);
  setTransactions(getTransactions());

  // Auto-update holding units and amountInvested
  setHoldings((prev) =>
    prev.map((h) => {
      if (h.id !== tx.holdingId) return h;
      if (tx.type === "buy") {
        return {
          ...h,
          units: h.units + tx.units,
          amountInvested: h.amountInvested + tx.totalAmount,
        };
      }
      // Sell: reduce units, reduce invested proportionally
      const fraction = tx.units / h.units;
      return {
        ...h,
        units: h.units - tx.units,
        amountInvested: h.amountInvested * (1 - fraction),
      };
    }),
  );
}
```

Also update `handleSave` to auto-log the initial buy when creating a new holding:

```typescript
function handleSave(h: PortfolioHolding) {
  setHoldings((prev) => {
    const idx = prev.findIndex((p) => p.id === h.id);
    if (idx >= 0) {
      const updated = [...prev];
      updated[idx] = h;
      return updated;
    }
    return [...prev, h];
  });

  // Auto-log initial buy for new holdings
  const isNew = !holdings.some((p) => p.id === h.id);
  if (isNew && h.units > 0 && h.amountInvested > 0) {
    const tx: PortfolioTransaction = {
      id: crypto.randomUUID(),
      holdingId: h.id,
      holdingName: h.name,
      type: "buy",
      units: h.units,
      pricePerUnit: h.amountInvested / h.units,
      totalAmount: h.amountInvested,
      currency: h.currency,
      date: getSydneyDateString(),
      notes: "Initial holding",
      createdAt: Date.now(),
    };
    addTransaction(tx);
    setTransactions(getTransactions());
  }
}
```

Add import for `getSydneyDateString` if not present:

```typescript
import { getSydneyDateString } from "@/lib/utils/timezone";
```

- [ ] **Step 2: Pass transaction props to HoldingsTable**

In the `<HoldingsTable>` component call, add these props:

```typescript
onTransaction={handleTransaction}
transactions={transactions}
onShowTxHistory={setTxHistoryHoldingId}
```

- [ ] **Step 3: Render TransactionHistory dialog**

Add at the end of the page JSX (near the existing PriceUpdateStatus):

```tsx
<TransactionHistory
  holdings={holdings}
  transactions={transactions}
  holdingId={txHistoryHoldingId}
  setHoldingId={setTxHistoryHoldingId}
  format={format}
/>
```

- [ ] **Step 4: Update HoldingsTable to accept and use transaction props**

In `holdings-table.tsx`, add to the props interface:

```typescript
onTransaction: (tx: PortfolioTransaction) => void;
transactions: PortfolioTransaction[];
onShowTxHistory: (holdingId: string) => void;
```

Add the necessary imports:

```typescript
import { TransactionDialog } from "@/components/portfolio/transaction-dialog";
import type { PortfolioTransaction } from "@/lib/utils/types";
import { ArrowRightLeft, History } from "lucide-react";
```

In each holding card's action buttons area (where the edit/delete/history buttons are), add two new buttons before the existing edit button:

```tsx
{/* Transaction buttons */}
<TransactionDialog
  holding={h}
  onSave={onTransaction}
  trigger={
    <Button variant="ghost" size="icon-xs" title="Log Buy/Sell">
      <ArrowRightLeft className="h-3.5 w-3.5" />
    </Button>
  }
/>
<Button
  variant="ghost"
  size="icon-xs"
  title="Transaction History"
  onClick={() => onShowTxHistory(h.id)}
>
  <History className="h-3.5 w-3.5" />
</Button>
```

- [ ] **Step 5: Verify types compile and build passes**

Run: `npx tsc --noEmit && npx next build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/portfolio/page.tsx app/\(app\)/portfolio/_components/holdings-table.tsx
git commit -m "feat: wire buy/sell transactions into portfolio page with auto-update"
```

---

## Task 6: Create World Distribution Chart

**Files:**
- Create: `app/(app)/dashboard/_components/world-distribution-chart.tsx`

- [ ] **Step 1: Create the component**

Follow the pattern from `income-expense-charts.tsx` for ECharts donut:

```tsx
"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { getPieBaseOption } from "@/lib/utils/echarts";
import { WORLD_LABELS, WORLD_COLORS, type FinancialWorld } from "@/lib/utils/constants";
import { BlurFade } from "@/components/ui/blur-fade";
import { Eye, EyeOff } from "lucide-react";

interface WorldDistributionChartProps {
  normalTotal: number;
  cryptoTotal: number;
  superTotal: number;
  format: (amount: number) => string;
  delay: number;
}

export function WorldDistributionChart({
  normalTotal,
  cryptoTotal,
  superTotal,
  format,
  delay,
}: WorldDistributionChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [hidden, setHidden] = useState<Set<FinancialWorld>>(new Set());

  function toggleWorld(w: FinancialWorld) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });
  }

  const worlds: { key: FinancialWorld; value: number }[] = [
    { key: "normal", value: normalTotal },
    { key: "crypto", value: cryptoTotal },
    { key: "super", value: superTotal },
  ];

  const grandTotal = worlds
    .filter((w) => !hidden.has(w.key))
    .reduce((s, w) => s + w.value, 0);

  const option = useMemo(() => {
    const base = getPieBaseOption(isDark);
    const visible = worlds.filter((w) => !hidden.has(w.key) && w.value > 0);

    return {
      ...base,
      series: [
        {
          type: "pie",
          radius: ["55%", "78%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: false,
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 12, fontWeight: "bold" },
          },
          data: visible.map((w) => ({
            name: WORLD_LABELS[w.key],
            value: Math.round(w.value),
            itemStyle: { color: WORLD_COLORS[w.key] },
          })),
        },
      ],
    };
  }, [isDark, worlds, hidden]);

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="label-mono">Asset Distribution</p>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-4 items-center">
          <ReactECharts
            option={option}
            style={{ height: "160px" }}
          />

          <div className="space-y-2 min-w-[130px]">
            {worlds.map((w) => {
              const isHidden = hidden.has(w.key);
              const pct = grandTotal > 0 && !isHidden
                ? ((w.value / grandTotal) * 100).toFixed(1)
                : "—";
              return (
                <button
                  key={w.key}
                  onClick={() => toggleWorld(w.key)}
                  className="flex items-center gap-2 w-full text-left group"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0 transition-opacity"
                    style={{
                      backgroundColor: WORLD_COLORS[w.key],
                      opacity: isHidden ? 0.25 : 1,
                    }}
                  />
                  <div className={`flex-1 text-xs transition-opacity ${isHidden ? "opacity-40" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{WORLD_LABELS[w.key]}</span>
                      <span className="text-muted-foreground">{pct}%</span>
                    </div>
                    <p className="font-mono tabular-nums text-muted-foreground">
                      {isHidden ? "hidden" : format(w.value)}
                    </p>
                  </div>
                  {isHidden ? (
                    <EyeOff className="h-3 w-3 text-muted-foreground/50" />
                  ) : (
                    <Eye className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/dashboard/_components/world-distribution-chart.tsx
git commit -m "feat: add WorldDistributionChart with Normal/Crypto/Super donut"
```

---

## Task 7: Create Money Flow Card

**Files:**
- Create: `app/(app)/dashboard/_components/money-flow-card.tsx`

- [ ] **Step 1: Create the component**

Follow the pattern from `goal-progress.tsx` (VitalsCard) for layout:

```tsx
"use client";

import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Info } from "lucide-react";

interface MoneyFlowCardProps {
  periodLabel: string;
  periodIncome: number;
  periodExpenses: number;
  periodInvested: number;
  format: (amount: number) => string;
  delay: number;
}

export function MoneyFlowCard({
  periodLabel,
  periodIncome,
  periodExpenses,
  periodInvested,
  format,
  delay,
}: MoneyFlowCardProps) {
  const [showFormulas, setShowFormulas] = useState(false);

  const freeCash = periodIncome - periodExpenses - periodInvested;
  const expenseRate = periodIncome > 0 ? (periodExpenses / periodIncome) * 100 : 0;
  const investmentRate = periodIncome > 0 ? (periodInvested / periodIncome) * 100 : 0;
  const savingsRate = periodIncome > 0 ? ((periodIncome - periodExpenses) / periodIncome) * 100 : 0;
  const freeCashRate = periodIncome > 0 ? (freeCash / periodIncome) * 100 : 0;

  const rows = [
    { label: "Income", value: periodIncome, rate: 100, color: "text-income", bar: "bg-income" },
    { label: "Expenses", value: -periodExpenses, rate: expenseRate, color: "text-expense", bar: "bg-expense" },
    { label: "Invested", value: -periodInvested, rate: investmentRate, color: "text-accent", bar: "bg-accent" },
    { label: "Free Cash", value: freeCash, rate: freeCashRate, color: freeCash >= 0 ? "text-income" : "text-expense", bar: freeCash >= 0 ? "bg-income" : "bg-expense" },
  ];

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="label-mono">Money Flow ({periodLabel})</p>
          <button
            onClick={() => setShowFormulas(true)}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title="How is this calculated?"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={row.label}>
              {i === 3 && (
                <div className="border-t border-dashed border-border my-3" />
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <div className="flex items-center gap-2">
                  <span className={cn("font-mono tabular-nums font-medium", row.color)}>
                    {row.value >= 0 ? "" : ""}{format(Math.abs(row.value))}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground/60 w-[42px] text-right">
                    {row.rate.toFixed(1)}%
                  </span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-secondary/50 mt-1 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", row.bar)}
                  style={{ width: `${Math.min(100, Math.abs(row.rate))}%`, opacity: 0.6 }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Formulas dialog */}
        <Dialog open={showFormulas} onOpenChange={setShowFormulas}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>How Money Flow is Calculated</DialogTitle>
              <DialogDescription>
                Tracks where your income goes each period.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <div className="rounded-lg bg-secondary/50 p-3 space-y-2 font-mono text-xs">
                  <p><span className="text-income">Income</span> = Sum of all income entries this period</p>
                  <p><span className="text-expense">Expenses</span> = Sum of all expense entries this period</p>
                  <p><span className="text-accent">Invested</span> = Sum of portfolio buy transactions this period</p>
                  <p className="border-t border-dashed border-border pt-2">
                    <span className="font-medium">Free Cash</span> = Income - Expenses - Invested
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="font-medium">Rates (% of Income)</p>
                <div className="rounded-lg bg-secondary/50 p-3 space-y-1 font-mono text-xs">
                  <p>Expense Rate = Expenses / Income x 100</p>
                  <p>Investment Rate = Invested / Income x 100</p>
                  <p>Savings Rate = (Income - Expenses) / Income x 100</p>
                  <p>Free Cash Rate = Free Cash / Income x 100</p>
                </div>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong>Income</strong> includes: salary, freelance, dividends, crypto yield, etc.</p>
                <p><strong>Expenses</strong> includes: food, rent, subscriptions, etc.</p>
                <p><strong>Invested</strong> includes: portfolio buy transactions only (logged via Portfolio page).</p>
                <p><strong>Crypto</strong> investments are tracked separately via CSV upload.</p>
                <p><strong>Super</strong> contributions from employer/personal are counted as income, not investment.</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </BlurFade>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/dashboard/_components/money-flow-card.tsx
git commit -m "feat: add MoneyFlowCard with income/expenses/invested breakdown"
```

---

## Task 8: Wire Dashboard with New Cards

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add imports**

Add at the top of `dashboard/page.tsx`:

```typescript
import { WorldDistributionChart } from "./_components/world-distribution-chart";
import { MoneyFlowCard } from "./_components/money-flow-card";
import { totalInvestedInRange } from "@/lib/utils/portfolio-transactions";
```

- [ ] **Step 2: Compute world totals**

Add new useMemo blocks (near the existing `portfolioTotal` / `cryptoTotal` computations):

```typescript
// World distribution totals
const normalTotal = useMemo(
  () =>
    holdings
      .filter((h) => h.accountType === "normal")
      .reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
  [holdings, convert],
);

const superTotal = useMemo(
  () =>
    holdings
      .filter((h) => h.accountType === "super")
      .reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
  [holdings, convert],
);
```

Note: `cryptoTotal` should already exist — verify it's computed from crypto holdings.

- [ ] **Step 3: Compute period investment total**

Add a useMemo for period-based investment total. This needs the current period date range. Find where `periodIncome` and `periodExpenses` are computed and add nearby:

```typescript
const periodInvested = useMemo(() => {
  // Derive date range from period
  const today = getSydneyDateString();
  let from: string;
  if (period === "W") {
    from = getWeekStart();
  } else if (period === "M") {
    from = today.slice(0, 7) + "-01";
  } else {
    from = today.slice(0, 4) + "-01-01";
  }
  return totalInvestedInRange(from, today, convert);
}, [period, convert]);
```

Make sure `getWeekStart` and `getSydneyDateString` are imported from `@/lib/utils/timezone` (they likely already are).

- [ ] **Step 4: Render the new components**

Place `WorldDistributionChart` after the existing `AssetBreakdown` in the grid layout. Find the section where `<AssetBreakdown>` is rendered and add the new card as a sibling:

```tsx
<WorldDistributionChart
  normalTotal={normalTotal}
  cryptoTotal={cryptoTotal}
  superTotal={superTotal}
  format={format}
  delay={0.15}
/>
```

Place `MoneyFlowCard` near the `VitalsCard` section:

```tsx
<MoneyFlowCard
  periodLabel={period === "W" ? "This Week" : period === "M" ? "This Month" : "This Year"}
  periodIncome={periodIncomeTotal}
  periodExpenses={periodExpenseTotal}
  periodInvested={periodInvested}
  format={format}
  delay={0.2}
/>
```

- [ ] **Step 5: Verify build passes**

Run: `npx tsc --noEmit && npx next build`
Expected: No errors, all routes compile

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/dashboard/page.tsx
git commit -m "feat: wire WorldDistributionChart and MoneyFlowCard into dashboard"
```

---

## Task 9: Final Build Verification and Push

- [ ] **Step 1: Full build**

Run: `npx next build`
Expected: All routes compile with no errors

- [ ] **Step 2: Manual smoke test**

Open `http://localhost:3000` and verify:
1. Portfolio page: "Log Buy/Sell" button appears on each holding card
2. Portfolio page: TransactionDialog opens, buy/sell works, holding units/invested update
3. Portfolio page: "Transaction History" button opens timeline dialog
4. Dashboard: World Distribution donut shows Normal/Crypto/Super with toggle
5. Dashboard: Money Flow card shows Income/Expenses/Invested/Free Cash with percentages
6. Dashboard: Info icon opens formulas explanation dialog
7. Dashboard: Period toggle (W/M/Y) updates Money Flow numbers

- [ ] **Step 3: Final commit and push**

```bash
git push
```
