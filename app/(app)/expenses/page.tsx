"use client";

import { useState, useMemo } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ExpenseEntry, ExpenseType } from "@/lib/utils/types";
import { CURRENCY_SYMBOLS } from "@/lib/utils/types";
import {
  EXPENSE_TYPE_LABELS,
  EXPENSE_TYPE_COLORS,
} from "@/lib/utils/constants";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getCurrentYearKey,
  getMonthKey,
  formatDateString,
} from "@/lib/utils/timezone";
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
import { useTheme } from "next-themes";
import { getEchartsBaseOption } from "@/lib/utils/echarts";
import { Plus, Pencil, Trash2, Receipt } from "lucide-react";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPENSE_TYPES = Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[];

function sumConverted(
  entries: ExpenseEntry[],
  convert: (amount: number, from: ExpenseEntry["currency"]) => number
) {
  return entries.reduce((acc, e) => acc + convert(e.amount, e.currency), 0);
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function ExpensesPage() {
  const [entries, setEntries] = useLocalStorage<ExpenseEntry[]>(
    "expense_entries",
    []
  );
  const { currency, format, convert, symbol } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Filters
  const [typeFilter, setTypeFilter] = useState<ExpenseType | "all">("all");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntry | null>(null);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const currentMonth = getCurrentMonthKey();
  const lastMonth = getLastMonthKey();
  const currentYear = getCurrentYearKey();

  const thisMonthEntries = useMemo(
    () => entries.filter((e) => getMonthKey(e.date ?? "") === currentMonth),
    [entries, currentMonth]
  );
  const lastMonthEntries = useMemo(
    () => entries.filter((e) => getMonthKey(e.date ?? "") === lastMonth),
    [entries, lastMonth]
  );
  const ytdEntries = useMemo(
    () => entries.filter((e) => (e.date ?? "").slice(0, 4) === currentYear),
    [entries, currentYear]
  );

  const thisMonthTotal = sumConverted(thisMonthEntries, convert);
  const lastMonthTotal = sumConverted(lastMonthEntries, convert);
  const ytdTotal = sumConverted(ytdEntries, convert);
  const allTimeTotal = sumConverted(entries, convert);

  // Breakdown by type for this month
  const breakdownByType = useMemo(() => {
    const map: Record<ExpenseType, number> = {} as Record<ExpenseType, number>;
    for (const t of EXPENSE_TYPES) map[t] = 0;
    for (const e of thisMonthEntries) {
      map[e.type] += convert(e.amount, e.currency);
    }
    return EXPENSE_TYPES.filter((t) => map[t] > 0).map((t) => ({
      type: t,
      label: EXPENSE_TYPE_LABELS[t],
      value: map[t],
      color: EXPENSE_TYPE_COLORS[t],
    }));
  }, [thisMonthEntries, convert]);

  // ECharts pie option
  const pieOption = useMemo(() => {
    const base = getEchartsBaseOption(isDark);
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        trigger: "item" as const,
        formatter: (params: { name: string; value: number; percent: number }) => {
          const label =
            EXPENSE_TYPE_LABELS[params.name as ExpenseType] ?? params.name;
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
            <span style="color:${isDark ? "#888" : "#968360"}">${label}</span>
            <span style="font-family:var(--font-geist-mono),ui-monospace,monospace;font-weight:500">${format(params.value)} (${params.percent.toFixed(1)}%)</span>
          </div>`;
        },
      },
      series: [
        {
          type: "pie",
          radius: ["60%", "85%"],
          padAngle: 2,
          itemStyle: { borderWidth: 0 },
          label: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 4,
          },
          data: breakdownByType.map((item) => ({
            name: item.type,
            value: item.value,
            itemStyle: { color: item.color },
          })),
        },
      ],
    };
  }, [breakdownByType, isDark, format]);

  // Filtered + sorted entries for the table
  const filteredEntries = useMemo(() => {
    const filtered =
      typeFilter === "all"
        ? [...entries]
        : entries.filter((e) => e.type === typeFilter);
    return filtered.sort(
      (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.createdAt - a.createdAt
    );
  }, [entries, typeFilter]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleSave(saved: ExpenseEntry) {
    setEntries((prev) => {
      const existing = prev.findIndex((e) => e.id === saved.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = saved;
        return updated;
      }
      return [...prev, saved];
    });
  }

  function handleDelete(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setDeleteTarget(null);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------------ */}
      {/* Hero Section                                                        */}
      {/* ------------------------------------------------------------------ */}
      <BlurFade delay={0}>
        <section className="space-y-4">
          <p className="label-mono">This Month&rsquo;s Expenses</p>
          <div className="display-number text-expense">
            <NumberTicker
              value={thisMonthTotal}
              prefix={symbol}
              decimalPlaces={2}
            />
          </div>

          {/* Summary tiles */}
          <div className="finance-card inline-flex divide-x divide-border text-sm">
            {[
              { label: "This Month", value: thisMonthTotal },
              { label: "Last Month", value: lastMonthTotal },
              { label: "YTD", value: ytdTotal },
              { label: "All Time", value: allTimeTotal },
            ].map((tile) => (
              <div key={tile.label} className="px-5 py-3 text-center">
                <p className="label-mono mb-1">{tile.label}</p>
                <p className="font-semibold tabular-nums">
                  {format(tile.value)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </BlurFade>

      {/* ------------------------------------------------------------------ */}
      {/* This Month Breakdown                                                */}
      {/* ------------------------------------------------------------------ */}
      <BlurFade delay={0.08}>
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="label-mono">Breakdown</p>
            <ExpenseDialog
              onSave={handleSave}
              trigger={
                <Button size="sm">
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Expense
                </Button>
              }
            />
          </div>

          {breakdownByType.length === 0 ? (
            <div className="finance-card flex flex-col items-center justify-center py-16 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                No expenses recorded this month.
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Tap &ldquo;Add Expense&rdquo; to get started.
              </p>
            </div>
          ) : (
            <div className="finance-card p-6">
              <div className="grid gap-6 md:grid-cols-[240px_1fr]">
                {/* Donut Chart */}
                <div className="mx-auto aspect-square w-full max-w-[240px]">
                  <ReactECharts
                    option={pieOption}
                    notMerge lazyUpdate
                    style={{ width: "100%", height: "100%" }}
                    opts={{ renderer: "svg" }}
                  />
                </div>

                {/* Progress bars */}
                <div className="flex flex-col justify-center gap-2.5">
                  {breakdownByType
                    .sort((a, b) => b.value - a.value)
                    .map((item) => {
                      const pct =
                        thisMonthTotal > 0
                          ? (item.value / thisMonthTotal) * 100
                          : 0;
                      return (
                        <div key={item.type} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: item.color }}
                              />
                              <span>{item.label}</span>
                            </div>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {format(item.value)} ({pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: item.color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </section>
      </BlurFade>

      {/* ------------------------------------------------------------------ */}
      {/* Records Table                                                       */}
      {/* ------------------------------------------------------------------ */}
      <BlurFade delay={0.16}>
        <section className="space-y-4">
          <p className="label-mono">Records</p>

          {/* Filter pills */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setTypeFilter("all")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                typeFilter === "all"
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              )}
            >
              All
            </button>
            {EXPENSE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  typeFilter === t
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {EXPENSE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Table */}
          {filteredEntries.length === 0 ? (
            <div className="finance-card flex flex-col items-center justify-center py-12 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                No records found.
              </p>
            </div>
          ) : (
            <div className="finance-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground">
                        Date
                      </th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">
                        Type
                      </th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">
                        Description
                      </th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">
                        Vendor
                      </th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">
                        Amount
                      </th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDateString(entry.date)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{
                                backgroundColor:
                                  EXPENSE_TYPE_COLORS[entry.type],
                              }}
                            />
                            {EXPENSE_TYPE_LABELS[entry.type]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="line-clamp-1">
                            {entry.description}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {entry.vendor || "\u2014"}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className="font-mono tabular-nums text-expense">
                            {CURRENCY_SYMBOLS[entry.currency]}
                            {entry.amount.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                          {entry.currency !== currency && (
                            <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                              ({format(entry.amount, entry.currency)})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <ExpenseDialog
                              entry={entry}
                              onSave={handleSave}
                              trigger={
                                <Button variant="ghost" size="icon-xs">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => setDeleteTarget(entry)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </BlurFade>

      {/* ------------------------------------------------------------------ */}
      {/* Delete Confirmation Dialog                                           */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Expense</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;
              {deleteTarget?.description}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
