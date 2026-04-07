"use client";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { TrendingUp, TrendingDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = "W" | "M" | "Y";

export interface VitalsCardProps {
  period: Period;
  periodLabel: string;
  periodIncomeTotal: number;
  periodExpenseTotal: number;
  netCashFlow: number;
  incomeChange: number;
  expenseChange: number;
  prevIncomeTotal: number;
  prevExpenseTotal: number;
  healthScore: number;
  healthLabel: string;
  healthColor: string;
  savingsRate: number;
  debtToAssetRatio: number;
  format: (amount: number) => string;
  delayVitals: number;
  delayHealth: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VitalsCard({
  periodLabel,
  periodIncomeTotal,
  periodExpenseTotal,
  netCashFlow,
  incomeChange,
  expenseChange,
  prevIncomeTotal,
  prevExpenseTotal,
  healthScore,
  healthLabel,
  healthColor,
  savingsRate,
  debtToAssetRatio,
  format,
  delayVitals,
  delayHealth,
}: VitalsCardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
      <BlurFade delay={delayVitals} className="md:col-span-8">
        <div className="finance-card p-6 h-full flex flex-col justify-center">
          <p className="label-mono mb-4">{periodLabel}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-0 sm:divide-x sm:divide-border">
            {/* Income */}
            <div className="sm:pr-5">
              <p className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-income">
                {format(periodIncomeTotal)}
              </p>
              <p className="label-mono mt-1">Income</p>
              {prevIncomeTotal > 0 && (
                <div
                  className={cn(
                    "flex items-center gap-1 mt-1.5 text-xs font-medium",
                    incomeChange >= 0 ? "text-income" : "text-expense",
                  )}
                >
                  {incomeChange >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  <span>
                    {incomeChange >= 0 ? "+" : ""}
                    {incomeChange.toFixed(1)}% vs prev
                  </span>
                </div>
              )}
            </div>
            {/* Expenses */}
            <div className="sm:px-5">
              <p className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-expense">
                {format(periodExpenseTotal)}
              </p>
              <p className="label-mono mt-1">Expenses</p>
              {prevExpenseTotal > 0 && (
                <div
                  className={cn(
                    "flex items-center gap-1 mt-1.5 text-xs font-medium",
                    expenseChange <= 0 ? "text-income" : "text-expense",
                  )}
                >
                  {expenseChange <= 0 ? (
                    <TrendingDown className="h-3 w-3" />
                  ) : (
                    <TrendingUp className="h-3 w-3" />
                  )}
                  <span>
                    {expenseChange >= 0 ? "+" : ""}
                    {expenseChange.toFixed(1)}% vs prev
                  </span>
                </div>
              )}
            </div>
            {/* Net */}
            <div className="sm:pl-5">
              <p
                className={cn(
                  "text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight tabular-nums",
                  netCashFlow >= 0 ? "text-income" : "text-expense",
                )}
              >
                {netCashFlow >= 0 ? "+" : ""}
                {format(netCashFlow)}
              </p>
              <p className="label-mono mt-1">Net Cash Flow</p>
            </div>
          </div>
        </div>
      </BlurFade>

      {/* Financial Health Score */}
      <BlurFade delay={delayHealth} className="md:col-span-4">
        <div className="finance-card p-6 h-full flex flex-col items-center justify-center">
          <p className="label-mono mb-4">Financial Health</p>
          <div className="relative flex items-center justify-center">
            <svg width="96" height="96" viewBox="0 0 96 96">
              <circle
                cx="48"
                cy="48"
                r="40"
                fill="none"
                stroke="#c9c3a8"
                strokeWidth="6"
                opacity="0.3"
              />
              <circle
                cx="48"
                cy="48"
                r="40"
                fill="none"
                stroke={healthColor}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(healthScore / 100) * 251.3} 251.3`}
                transform="rotate(-90 48 48)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: healthColor }}
              >
                {healthScore}
              </span>
            </div>
          </div>
          <p
            className="text-sm font-medium mt-2"
            style={{ color: healthColor }}
          >
            {healthLabel}
          </p>
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <span>Savings {savingsRate.toFixed(0)}%</span>
            <span>Debt {debtToAssetRatio.toFixed(0)}%</span>
          </div>
        </div>
      </BlurFade>
    </div>
  );
}
