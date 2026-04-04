"use client";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MoneyFlowCardProps {
  periodLabel: string;
  periodIncome: number;
  periodExpenses: number;
  periodInvested: number;
  format: (amount: number) => string;
  delay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MoneyFlowCard({
  periodLabel,
  periodIncome,
  periodExpenses,
  format,
  delay,
}: MoneyFlowCardProps) {
  const savings = periodIncome - periodExpenses;
  const savingsRate = periodIncome > 0 ? (savings / periodIncome) * 100 : 0;
  const expenseRate = periodIncome > 0 ? (periodExpenses / periodIncome) * 100 : 0;
  const savingsPositive = savings >= 0;

  // Bar proportions — income is always 100% width
  const maxVal = Math.max(periodIncome, periodExpenses, 1);

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <p className="label-mono mb-4">Money Flow ({periodLabel})</p>

        <div className="space-y-3">
          {/* Income */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">Income</span>
              <span className="font-mono text-sm tabular-nums text-income">
                {format(periodIncome)}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-income transition-all"
                style={{ width: `${(periodIncome / maxVal) * 100}%` }}
              />
            </div>
          </div>

          {/* Expenses */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">Expenses</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm tabular-nums text-expense">
                  {format(periodExpenses)}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground/50 w-10 text-right">
                  {expenseRate.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-expense transition-all"
                style={{ width: `${(periodExpenses / maxVal) * 100}%` }}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-dashed border-border" />

          {/* Savings = Income - Expenses */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">Saved</span>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-mono text-sm tabular-nums font-semibold",
                    savingsPositive ? "text-income" : "text-expense",
                  )}
                >
                  {savingsPositive ? "+" : "-"}{format(Math.abs(savings))}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] tabular-nums w-10 text-right font-medium",
                    savingsPositive ? "text-income/60" : "text-expense/60",
                  )}
                >
                  {savingsRate.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary/50 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  savingsPositive ? "bg-income" : "bg-expense",
                )}
                style={{ width: `${Math.min(Math.abs(savingsRate), 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
