"use client";

import { useState, useMemo } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry, ExpenseEntry } from "@/lib/utils/types";
import { getCurrencySymbol } from "@/lib/utils/types";
import {
  INCOME_TYPE_LABELS,
  EXPENSE_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/utils/constants";
import {
  getCurrentMonthKey,
  getMonthKey,
  monthKeyToFullLabel,
  formatDateString,
  getLastNMonthKeys,
} from "@/lib/utils/timezone";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, CreditCard, Wallet, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { exportBudgetToXls } from "@/lib/utils/export-budget";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BudgetPage() {
  const [incomeEntries] = useCloudStorage<IncomeEntry[]>("income_entries", []);
  const [expenseEntries] = useCloudStorage<ExpenseEntry[]>("expense_entries", []);
  const { convert, format, currency: displayCurrency } = useCurrency();

  // Month selector
  const monthKeys = useMemo(() => getLastNMonthKeys(12), []);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthKey());

  // Filter entries by selected month
  const monthIncome = useMemo(
    () => incomeEntries.filter((e) => getMonthKey(e.date) === selectedMonth),
    [incomeEntries, selectedMonth],
  );

  const monthExpenses = useMemo(
    () => expenseEntries.filter((e) => getMonthKey(e.date) === selectedMonth),
    [expenseEntries, selectedMonth],
  );

  // Split expenses: credit card vs non-credit-card
  const regularExpenses = useMemo(
    () => monthExpenses.filter((e) => (e.paymentMethod ?? "other") !== "credit_card"),
    [monthExpenses],
  );

  const creditCardExpenses = useMemo(
    () => monthExpenses.filter((e) => (e.paymentMethod ?? "other") === "credit_card"),
    [monthExpenses],
  );

  // Totals (converted to display currency)
  const totalIncome = useMemo(
    () => monthIncome.reduce((s, e) => s + convert(e.amount, e.currency), 0),
    [monthIncome, convert],
  );
  const totalExpense = useMemo(
    () => monthExpenses.reduce((s, e) => s + convert(e.amount, e.currency), 0),
    [monthExpenses, convert],
  );
  const totalCC = useMemo(
    () => creditCardExpenses.reduce((s, e) => s + convert(e.amount, e.currency), 0),
    [creditCardExpenses, convert],
  );
  const totalRegular = useMemo(
    () => regularExpenses.reduce((s, e) => s + convert(e.amount, e.currency), 0),
    [regularExpenses, convert],
  );
  const netBalance = totalIncome - totalExpense;

  // Expense category breakdown
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of monthExpenses) {
      const label = (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type;
      map[label] = (map[label] ?? 0) + convert(e.amount, e.currency);
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1]);
  }, [monthExpenses, convert]);

  // Income type breakdown
  const incomeBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of monthIncome) {
      const label = (INCOME_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type;
      map[label] = (map[label] ?? 0) + convert(e.amount, e.currency);
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1]);
  }, [monthIncome, convert]);

  // Export handler
  function handleExport() {
    exportBudgetToXls({
      month: monthKeyToFullLabel(selectedMonth),
      incomeEntries: monthIncome,
      expenseEntries: regularExpenses,
      creditCardEntries: creditCardExpenses,
      currencies: [displayCurrency, "USD"],
      convert: (amount, from, to) => {
        // Use the provider's convert (always converts to displayCurrency)
        // For multi-currency export, we do a simple conversion
        if (from === to) return amount;
        const inDisplay = convert(amount, from);
        if (to === displayCurrency) return inDisplay;
        // Convert from display currency to target
        const rateToDisplay = amount > 0 ? inDisplay / amount : 1;
        const targetInDisplay = convert(1, to);
        if (targetInDisplay === 0) return inDisplay;
        return inDisplay / targetInDisplay;
      },
    });
  }

  const sym = getCurrencySymbol(displayCurrency);

  return (
    <div className="space-y-6">
      {/* Header */}
      <BlurFade delay={0}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-mono mb-2">Monthly Budget</p>
            <div className={cn(
              "display-number",
              netBalance >= 0 ? "text-income" : "text-expense",
            )}>
              {netBalance >= 0 ? "+" : "-"}
              <NumberTicker value={Math.abs(netBalance)} prefix={sym} decimalPlaces={0} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthKeys.map((mk) => (
                  <SelectItem key={mk} value={mk}>
                    {monthKeyToFullLabel(mk)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Export XLS
            </Button>
          </div>
        </div>
      </BlurFade>

      {/* Summary Tiles */}
      <BlurFade delay={0.05}>
        <div className="finance-card p-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-0 md:divide-x md:divide-border">
            <div className="md:pr-6">
              <p className="label-mono mb-1">Total Income</p>
              <p className="text-lg font-semibold tabular-nums text-income">
                {sym}{totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="md:px-6">
              <p className="label-mono mb-1">Total Expenses</p>
              <p className="text-lg font-semibold tabular-nums text-expense">
                {sym}{totalExpense.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="md:px-6">
              <p className="label-mono mb-1">Credit Card</p>
              <p className="text-lg font-semibold tabular-nums text-expense">
                {sym}{totalCC.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="md:pl-6">
              <p className="label-mono mb-1">Net Balance</p>
              <p className={cn(
                "text-lg font-semibold tabular-nums",
                netBalance >= 0 ? "text-income" : "text-expense",
              )}>
                {netBalance >= 0 ? "+" : ""}{sym}{Math.abs(netBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      </BlurFade>

      {/* Three-column layout: Income | Expenses | Credit Card */}
      <BlurFade delay={0.1}>
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Income Column */}
          <div className="finance-card p-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-income/5">
              <Wallet className="h-4 w-4 text-income" />
              <p className="text-sm font-semibold text-income">Income</p>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {monthIncome.length} entries
              </span>
            </div>
            {monthIncome.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No income this month.
              </p>
            ) : (
              <div className="divide-y divide-border/30">
                {monthIncome
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((e) => (
                    <div key={e.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{e.description}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateString(e.date)} · {(INCOME_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type}
                        </p>
                      </div>
                      <span className="text-sm font-medium tabular-nums text-income shrink-0">
                        {format(e.amount, e.currency)}
                      </span>
                    </div>
                  ))}
                {/* Income total footer */}
                <div className="px-4 py-2.5 bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Total</span>
                  <span className="text-sm font-semibold tabular-nums text-income">
                    {format(totalIncome)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Expenses Column */}
          <div className="finance-card p-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-expense/5">
              <ArrowUpRight className="h-4 w-4 text-expense" />
              <p className="text-sm font-semibold text-expense">Expenses</p>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {regularExpenses.length} entries
              </span>
            </div>
            {regularExpenses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No expenses this month.
              </p>
            ) : (
              <div className="divide-y divide-border/30">
                {regularExpenses
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((e) => (
                    <div key={e.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{e.description}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateString(e.date)} · {(EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type}
                          {e.vendor ? ` · ${e.vendor}` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-medium tabular-nums text-expense shrink-0">
                        {format(e.amount, e.currency)}
                      </span>
                    </div>
                  ))}
                <div className="px-4 py-2.5 bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Total</span>
                  <span className="text-sm font-semibold tabular-nums text-expense">
                    {format(totalRegular)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Credit Card Column */}
          <div className="finance-card p-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-expense/5">
              <CreditCard className="h-4 w-4 text-expense" />
              <p className="text-sm font-semibold text-expense">Credit Card</p>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {creditCardExpenses.length} entries
              </span>
            </div>
            {creditCardExpenses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No credit card expenses this month.
              </p>
            ) : (
              <div className="divide-y divide-border/30">
                {creditCardExpenses
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((e) => (
                    <div key={e.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{e.description}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateString(e.date)} · {(EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type}
                          {e.vendor ? ` · ${e.vendor}` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-medium tabular-nums text-expense shrink-0">
                        {format(e.amount, e.currency)}
                      </span>
                    </div>
                  ))}
                <div className="px-4 py-2.5 bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Total</span>
                  <span className="text-sm font-semibold tabular-nums text-expense">
                    {format(totalCC)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </BlurFade>

      {/* Category Breakdown */}
      <BlurFade delay={0.15}>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Expense Categories */}
          <div className="finance-card p-5">
            <p className="label-mono mb-3">Expense Categories</p>
            {categoryBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data</p>
            ) : (
              <div className="space-y-2">
                {categoryBreakdown.map(([label, value]) => {
                  const pct = totalExpense > 0 ? (value / totalExpense) * 100 : 0;
                  return (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span>{label}</span>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="text-muted-foreground text-xs">
                          {pct.toFixed(0)}%
                        </span>
                        <span className="font-medium">{format(value)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Income Breakdown */}
          <div className="finance-card p-5">
            <p className="label-mono mb-3">Income Sources</p>
            {incomeBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data</p>
            ) : (
              <div className="space-y-2">
                {incomeBreakdown.map(([label, value]) => {
                  const pct = totalIncome > 0 ? (value / totalIncome) * 100 : 0;
                  return (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span>{label}</span>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="text-muted-foreground text-xs">
                          {pct.toFixed(0)}%
                        </span>
                        <span className="font-medium">{format(value)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </BlurFade>
    </div>
  );
}
