"use client";

import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { EXPENSE_TYPE_LABELS } from "@/lib/utils/constants";
import { formatDateString } from "@/lib/utils/timezone";
import type { IncomeEntry, ExpenseEntry, Currency } from "@/lib/utils/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityItem {
  id: string;
  kind: "income" | "expense";
  type: string;
  label: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
}

export interface GlanceCardsProps {
  incomeEntries: IncomeEntry[];
  expenseEntries: ExpenseEntry[];
  recentActivity: ActivityItem[];
  convert: (amount: number, from: string) => number;
  format: (amount: number, from?: string) => string;
  delayWeek: number;
  delayRecent: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GlanceCards({
  incomeEntries,
  expenseEntries,
  recentActivity,
  convert,
  format,
  delayWeek,
  delayRecent,
}: GlanceCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
      {/* Weekly Cash Flow Mini Chart + Insights */}
      <BlurFade delay={delayWeek} className="md:col-span-5">
        <div className="finance-card p-5 h-full">
          <p className="label-mono mb-4">This Week</p>
          {(() => {
            // Build last 7 days of cash flow
            const today = new Date();
            const days: {
              label: string;
              date: string;
              income: number;
              expense: number;
            }[] = [];
            for (let i = 6; i >= 0; i--) {
              const d = new Date(today);
              d.setDate(d.getDate() - i);
              const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              const dayLabel = d.toLocaleDateString("en-AU", {
                weekday: "short",
              });
              const dayIncome = incomeEntries
                .filter((e) => e.date === dateStr)
                .reduce((s, e) => s + convert(e.amount, e.currency), 0);
              const dayExpense = expenseEntries
                .filter((e) => e.date === dateStr)
                .reduce((s, e) => s + convert(e.amount, e.currency), 0);
              days.push({
                label: dayLabel,
                date: dateStr,
                income: dayIncome,
                expense: dayExpense,
              });
            }
            const weekIncome = days.reduce((s, d) => s + d.income, 0);
            const weekExpense = days.reduce((s, d) => s + d.expense, 0);
            const weekNet = weekIncome - weekExpense;
            const maxVal = Math.max(
              ...days.map((d) => Math.max(d.income, d.expense)),
              1,
            );

            // Top expense category this week
            const weekExpEntries = expenseEntries.filter((e) =>
              days.some((d) => d.date === e.date),
            );
            const catMap: Record<string, number> = {};
            for (const e of weekExpEntries) {
              const label =
                (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ??
                e.type;
              catMap[label] =
                (catMap[label] ?? 0) + convert(e.amount, e.currency);
            }
            const topCat = Object.entries(catMap).sort(
              (a, b) => b[1] - a[1],
            )[0];

            const daysWithSpending = days.filter((d) => d.expense > 0).length;
            const noSpendDays = 7 - daysWithSpending;

            return (
              <div className="space-y-4">
                {/* Summary row */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">In</p>
                    <p className="text-sm font-semibold tabular-nums text-income">
                      {format(weekIncome)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Out</p>
                    <p className="text-sm font-semibold tabular-nums text-expense">
                      {format(weekExpense)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Net</p>
                    <p
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        weekNet >= 0 ? "text-income" : "text-expense",
                      )}
                    >
                      {weekNet >= 0 ? "+" : ""}
                      {format(weekNet)}
                    </p>
                  </div>
                </div>

                {/* Mini daily bar chart */}
                <div className="flex items-end gap-1.5 h-20">
                  {days.map((d) => {
                    const incH =
                      maxVal > 0 ? (d.income / maxVal) * 100 : 0;
                    const expH =
                      maxVal > 0 ? (d.expense / maxVal) * 100 : 0;
                    const isToday = d.date === days[days.length - 1].date;
                    return (
                      <div
                        key={d.date}
                        className="flex-1 flex flex-col items-center gap-0.5"
                      >
                        <div
                          className="w-full flex gap-px justify-center"
                          style={{ height: 64 }}
                        >
                          <div className="flex flex-col justify-end w-2.5">
                            <div
                              className="bg-income/70 rounded-t-sm transition-all"
                              style={{ height: `${incH}%` }}
                            />
                          </div>
                          <div className="flex flex-col justify-end w-2.5">
                            <div
                              className="bg-expense/70 rounded-t-sm transition-all"
                              style={{ height: `${expH}%` }}
                            />
                          </div>
                        </div>
                        <span
                          className={cn(
                            "text-[9px]",
                            isToday
                              ? "font-semibold text-foreground"
                              : "text-muted-foreground/50",
                          )}
                        >
                          {d.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Insights */}
                <div className="space-y-1.5 border-t border-border/50 pt-3">
                  {topCat && (
                    <p className="text-xs text-muted-foreground">
                      Top spend:{" "}
                      <span className="font-medium text-foreground">
                        {topCat[0]}
                      </span>{" "}
                      — {format(topCat[1])}
                    </p>
                  )}
                  {noSpendDays > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="text-income font-medium">
                        {noSpendDays}
                      </span>{" "}
                      no-spend day{noSpendDays !== 1 ? "s" : ""} this week
                    </p>
                  )}
                  {weekExpense > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Daily avg:{" "}
                      <span className="font-medium text-foreground">
                        {format(weekExpense / 7)}
                      </span>
                      /day
                    </p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </BlurFade>

      {/* Recent Activity */}
      <BlurFade delay={delayRecent} className="md:col-span-7">
        <div className="finance-card p-5 h-full">
          <p className="label-mono mb-4">Recent Activity</p>
          {recentActivity.length > 0 ? (
            <div className="divide-y divide-border/50">
              {recentActivity.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center h-7 w-7 rounded-full shrink-0",
                      item.kind === "income"
                        ? "bg-income/10 text-income"
                        : "bg-expense/10 text-expense",
                    )}
                  >
                    {item.kind === "income" ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {item.description || item.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.label} · {formatDateString(item.date)}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "text-sm font-mono tabular-nums font-medium shrink-0",
                      item.kind === "income"
                        ? "text-income"
                        : "text-expense",
                    )}
                  >
                    {item.kind === "income" ? "+" : "-"}
                    {format(item.amount, item.currency as Currency)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/50 py-6">
              No transactions recorded yet
            </p>
          )}
        </div>
      </BlurFade>
    </div>
  );
}
