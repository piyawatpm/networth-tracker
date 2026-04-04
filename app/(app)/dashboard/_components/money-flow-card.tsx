"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
  periodInvested,
  format,
  delay,
}: MoneyFlowCardProps) {
  const [infoOpen, setInfoOpen] = useState(false);

  const freeCash = periodIncome - periodExpenses - periodInvested;

  const expenseRate = periodIncome > 0 ? (periodExpenses / periodIncome) * 100 : 0;
  const investedRate = periodIncome > 0 ? (periodInvested / periodIncome) * 100 : 0;
  const freeCashRate = periodIncome > 0 ? (freeCash / periodIncome) * 100 : 0;

  const rows = [
    {
      label: "Income",
      value: periodIncome,
      rate: 100,
      barWidth: 100,
      colorClass: "text-income",
      barColor: "bg-income",
    },
    {
      label: "Expenses",
      value: periodExpenses,
      rate: expenseRate,
      barWidth: Math.min(Math.abs(expenseRate), 100),
      colorClass: "text-expense",
      barColor: "bg-expense",
    },
    {
      label: "Invested",
      value: periodInvested,
      rate: investedRate,
      barWidth: Math.min(Math.abs(investedRate), 100),
      colorClass: "text-accent",
      barColor: "bg-accent",
    },
  ];

  const freeCashPositive = freeCash >= 0;

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <p className="label-mono">Money Flow ({periodLabel})</p>
          <button
            onClick={() => setInfoOpen(true)}
            className="p-1 rounded-md text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Rows */}
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <div className="flex items-center gap-2">
                  <span className={cn("font-mono text-sm tabular-nums", row.colorClass)}>
                    {format(row.value)}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground/60 w-12 text-right">
                    {row.rate.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-secondary/50 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", row.barColor)}
                  style={{ width: `${row.barWidth}%` }}
                />
              </div>
            </div>
          ))}

          {/* Dashed divider */}
          <div className="border-t border-dashed border-border" />

          {/* Free Cash row */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-muted-foreground">Free Cash</span>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-mono text-sm tabular-nums font-medium",
                    freeCashPositive ? "text-income" : "text-expense",
                  )}
                >
                  {freeCash < 0 ? "-" : ""}
                  {format(Math.abs(freeCash))}
                </span>
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums w-12 text-right",
                    freeCashPositive
                      ? "text-income/60"
                      : "text-expense/60",
                  )}
                >
                  {freeCashRate.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-secondary/50 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  freeCashPositive ? "bg-income" : "bg-expense",
                )}
                style={{ width: `${Math.min(Math.abs(freeCashRate), 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Info Dialog */}
        <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Money Flow Formulas</DialogTitle>
              <DialogDescription>
                How each value in the Money Flow card is calculated.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <h4 className="font-medium text-foreground">Values</h4>
                <dl className="space-y-1.5 text-muted-foreground">
                  <div>
                    <dt className="font-mono text-xs text-foreground/80">Income</dt>
                    <dd>Sum of all income entries this period</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs text-foreground/80">Expenses</dt>
                    <dd>Sum of all expense entries this period</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs text-foreground/80">Invested</dt>
                    <dd>Sum of portfolio buy transactions this period</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs text-foreground/80">Free Cash</dt>
                    <dd>Income - Expenses - Invested</dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-foreground">Rates</h4>
                <dl className="space-y-1.5 text-muted-foreground">
                  <div>
                    <dt className="font-mono text-xs text-foreground/80">Expense Rate</dt>
                    <dd>Expenses / Income x 100</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs text-foreground/80">Investment Rate</dt>
                    <dd>Invested / Income x 100</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs text-foreground/80">Savings Rate</dt>
                    <dd>(Income - Expenses) / Income x 100</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground space-y-1">
                <p>
                  <strong>Income</strong> includes salary, super contributions, freelance,
                  dividends, crypto yield, and all other income sources.
                </p>
                <p>
                  <strong>Expenses</strong> includes all tracked spending across every category.
                </p>
                <p>
                  <strong>Invested</strong> only counts buy-side portfolio transactions
                  (stocks, ETFs, etc.) recorded this period.
                </p>
                <p>
                  <strong>Free Cash</strong> is what remains after expenses and investments.
                  A negative value means you spent or invested more than you earned.
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </BlurFade>
  );
}
