"use client";

import { motion } from "motion/react";
import { Zap, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";

type Period = "W" | "M" | "Y";

interface FinancialFreedomCardProps {
  period: Period;
  /** Passive income for the selected period (user currency) */
  passiveIncome: number;
  /** Total expenses for the selected period (user currency, recurring only) */
  expenses: number;
  /** Annualised passive income (user currency) */
  passiveAnnualised: number;
  /** Annualised recurring expenses (user currency) */
  expensesAnnualised: number;
  format: (value: number) => string;
  delay: number;
}

const PERIOD_LABELS: Record<Period, { full: string; unit: string }> = {
  W: { full: "This Week", unit: "wk" },
  M: { full: "This Month", unit: "mo" },
  Y: { full: "This Year", unit: "yr" },
};

export function FinancialFreedomCard({
  period,
  passiveIncome,
  expenses,
  passiveAnnualised,
  expensesAnnualised,
  format,
  delay,
}: FinancialFreedomCardProps) {
  const pct = expenses > 0 ? Math.min((passiveIncome / expenses) * 100, 100) : 0;
  const raw = expenses > 0 ? (passiveIncome / expenses) * 100 : 0;
  const gap = Math.max(0, expenses - passiveIncome);
  const isFree = raw >= 100;
  const { full: label, unit } = PERIOD_LABELS[period];

  const statusColor = isFree
    ? "text-income"
    : raw >= 50
    ? "text-accent"
    : "text-muted-foreground";

  const statusMessage = isFree
    ? "You've hit financial freedom for this period."
    : raw >= 50
    ? `Covering ${raw.toFixed(0)}% of your ${label.toLowerCase()} burn from passive income.`
    : raw > 0
    ? `Passive income covers ${raw.toFixed(0)}% of expenses. Keep compounding.`
    : "No passive income recorded in this period yet.";

  return (
    <BlurFade delay={delay}>
      <div className="finance-card relative overflow-hidden p-5 sm:p-6">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-md",
                isFree ? "bg-income/15" : "bg-accent/15",
              )}
            >
              {isFree ? (
                <Check className="h-3.5 w-3.5 text-income" />
              ) : (
                <Zap className="h-3.5 w-3.5 text-accent" />
              )}
            </span>
            <p className="label-mono">Financial Freedom</p>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
              {label}
            </span>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold tabular-nums",
              isFree
                ? "bg-income/10 text-income"
                : raw >= 50
                ? "bg-accent/10 text-accent"
                : "bg-muted text-muted-foreground",
            )}
          >
            {raw.toFixed(0)}%
          </span>
        </div>

        {/* Columns */}
        <div className="grid grid-cols-2 gap-4 sm:gap-6">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
              Passive Income
            </p>
            <p className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-income">
              {format(passiveIncome)}
            </p>
            <p className="text-[11px] text-muted-foreground/70 tabular-nums">
              {format(passiveAnnualised)} / year
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
              Expenses
            </p>
            <p className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-expense">
              {format(expenses)}
            </p>
            <p className="text-[11px] text-muted-foreground/70 tabular-nums">
              {format(expensesAnnualised)} / year
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-5">
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <motion.div
              className={cn(
                "h-full rounded-full",
                isFree ? "bg-income" : raw >= 50 ? "bg-accent" : "bg-[#4d7cc7]",
              )}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            />
            {/* Target line at 100% — only meaningful when bar is under target */}
            {!isFree && (
              <div className="absolute inset-y-0 right-0 w-px bg-foreground/30" />
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className={cn("leading-tight", statusColor)}>{statusMessage}</span>
            {gap > 0 && (
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                +{format(gap)}/{unit} to cover
              </span>
            )}
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
