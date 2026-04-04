"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EXPENSE_TYPE_LABELS, INCOME_TYPE_LABELS, CHART_COLORS } from "@/lib/utils/constants";
import type { ExpenseEntry, IncomeEntry } from "@/lib/utils/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MoneyFlowCardProps {
  periodLabel: string;
  periodIncome: number;
  periodExpenses: number;
  periodInvested: number;
  incomeEntries: IncomeEntry[];
  expenseEntries: ExpenseEntry[];
  convert: (amount: number, from: string) => number;
  format: (amount: number) => string;
  delay: number;
}

interface CategoryBreakdown {
  label: string;
  value: number;
  pct: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MoneyFlowCard({
  periodLabel,
  periodIncome,
  periodExpenses,
  incomeEntries,
  expenseEntries,
  convert,
  format,
  delay,
}: MoneyFlowCardProps) {
  const [modalType, setModalType] = useState<"income" | "expense" | null>(null);

  const savings = periodIncome - periodExpenses;
  const savingsRate = periodIncome > 0 ? (savings / periodIncome) * 100 : 0;
  const savingsPositive = savings >= 0;

  // Expense breakdown by category
  const expenseBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenseEntries) {
      const label = (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type;
      map[label] = (map[label] ?? 0) + convert(e.amount, e.currency);
    }
    const total = periodExpenses || 1;
    return Object.entries(map)
      .map(([label, value], i) => ({
        label,
        value,
        pct: (value / total) * 100,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [expenseEntries, convert, periodExpenses]);

  // Income breakdown by type
  const incomeBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of incomeEntries) {
      const label = (INCOME_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type;
      map[label] = (map[label] ?? 0) + convert(e.amount, e.currency);
    }
    const total = periodIncome || 1;
    return Object.entries(map)
      .map(([label, value], i) => ({
        label,
        value,
        pct: (value / total) * 100,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [incomeEntries, convert, periodIncome]);

  // Top 4 expense categories for compact view
  const topExpenses = expenseBreakdown.slice(0, 4);
  const otherExpenses = expenseBreakdown.slice(4);
  const otherTotal = otherExpenses.reduce((s, c) => s + c.value, 0);

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <p className="label-mono mb-4">Money Flow ({periodLabel})</p>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <button
            onClick={() => setModalType("income")}
            className="text-left rounded-lg p-2 -m-0.5 transition-colors hover:bg-income/5 cursor-pointer"
          >
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Income</p>
            <p className="text-base font-bold tabular-nums text-income">{format(periodIncome)}</p>
          </button>
          <button
            onClick={() => setModalType("expense")}
            className="text-left rounded-lg p-2 -m-0.5 transition-colors hover:bg-expense/5 cursor-pointer"
          >
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Expenses</p>
            <p className="text-base font-bold tabular-nums text-expense">{format(periodExpenses)}</p>
          </button>
          <div className="p-2 -m-0.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Saved</p>
            <p className={cn("text-base font-bold tabular-nums", savingsPositive ? "text-income" : "text-expense")}>
              {savingsPositive ? "+" : ""}{format(savings)}
            </p>
          </div>
        </div>

        {/* Stacked bar: income vs expenses proportionally */}
        <div className="h-3 w-full rounded-full bg-secondary/50 overflow-hidden flex mb-4">
          {periodIncome > 0 && (
            <>
              <div
                className="h-full bg-expense transition-all"
                style={{ width: `${Math.min((periodExpenses / periodIncome) * 100, 100)}%` }}
              />
              <div
                className="h-full bg-income/40 transition-all flex-1"
              />
            </>
          )}
        </div>

        {/* Expense breakdown bars */}
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Expense Breakdown
          </p>
          {topExpenses.map((cat) => (
            <div key={cat.label} className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-xs text-muted-foreground truncate flex-1">{cat.label}</span>
              <div className="w-20 h-1.5 rounded-full bg-secondary/50 overflow-hidden shrink-0">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${cat.pct}%`, backgroundColor: cat.color }}
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground w-16 text-right shrink-0">
                {format(cat.value)}
              </span>
            </div>
          ))}
          {otherTotal > 0 && (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/30" />
              <span className="text-xs text-muted-foreground truncate flex-1">
                +{otherExpenses.length} more
              </span>
              <div className="w-20 h-1.5 rounded-full bg-secondary/50 overflow-hidden shrink-0">
                <div
                  className="h-full rounded-full bg-muted-foreground/30 transition-all"
                  style={{ width: `${(otherTotal / (periodExpenses || 1)) * 100}%` }}
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground w-16 text-right shrink-0">
                {format(otherTotal)}
              </span>
            </div>
          )}
          {expenseBreakdown.length === 0 && (
            <p className="text-xs text-muted-foreground/50 py-2">No expenses this period</p>
          )}

          {/* Click to see all */}
          {expenseBreakdown.length > 4 && (
            <button
              onClick={() => setModalType("expense")}
              className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground py-1 transition-colors"
            >
              View all {expenseBreakdown.length} categories
            </button>
          )}
        </div>

        {/* Breakdown Modal */}
        <Dialog open={modalType !== null} onOpenChange={(open) => { if (!open) setModalType(null); }}>
          <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {modalType === "income" ? "Income" : "Expense"} Breakdown — {periodLabel}
              </DialogTitle>
              <DialogDescription>
                {modalType === "income"
                  ? `Total: ${format(periodIncome)}`
                  : `Total: ${format(periodExpenses)}`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              {(modalType === "income" ? incomeBreakdown : expenseBreakdown).map((cat) => (
                <div key={cat.label} className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-sm truncate flex-1">{cat.label}</span>
                  <div className="w-24 h-2 rounded-full bg-secondary/50 overflow-hidden shrink-0">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${cat.pct}%`, backgroundColor: cat.color }}
                    />
                  </div>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground w-12 text-right shrink-0">
                    {cat.pct.toFixed(0)}%
                  </span>
                  <span className="font-mono text-sm tabular-nums font-medium w-20 text-right shrink-0">
                    {format(cat.value)}
                  </span>
                </div>
              ))}
            </div>

            {/* Savings summary at bottom of expense modal */}
            {modalType === "expense" && (
              <div className="border-t border-border/50 pt-3 mt-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Savings Rate</span>
                <span className={cn(
                  "font-mono text-sm tabular-nums font-semibold",
                  savingsPositive ? "text-income" : "text-expense",
                )}>
                  {savingsRate.toFixed(1)}% ({savingsPositive ? "+" : ""}{format(savings)})
                </span>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </BlurFade>
  );
}
