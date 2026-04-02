"use client";

import { useState, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry, IncomeType } from "@/lib/utils/types";
import { INCOME_TYPE_LABELS, INCOME_TYPE_COLORS } from "@/lib/utils/constants";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getCurrentYearKey,
  formatDateString,
} from "@/lib/utils/timezone";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { IncomeDialog } from "@/components/income/income-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumConverted(
  entries: IncomeEntry[],
  convert: (amount: number, from: IncomeEntry["currency"]) => number,
) {
  return entries.reduce((sum, e) => sum + convert(e.amount, e.currency), 0);
}

// ---------------------------------------------------------------------------
// Delete Confirmation Dialog
// ---------------------------------------------------------------------------

function DeleteConfirm({
  onConfirm,
  children,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger render={children as React.JSX.Element} />
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Delete Entry</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this income entry? This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IncomePage() {
  const [entries, setEntries] = useLocalStorage<IncomeEntry[]>(
    "income_entries",
    [],
  );
  const { currency, format, convert, symbol } = useCurrency();
  const [typeFilter, setTypeFilter] = useState<IncomeType | "all">("all");

  // ---- Derived data --------------------------------------------------------

  const currentMonth = getCurrentMonthKey();
  const lastMonth = getLastMonthKey();
  const currentYear = getCurrentYearKey();

  const thisMonthEntries = useMemo(
    () => entries.filter((e) => (e.date ?? "").startsWith(currentMonth)),
    [entries, currentMonth],
  );

  const lastMonthEntries = useMemo(
    () => entries.filter((e) => (e.date ?? "").startsWith(lastMonth)),
    [entries, lastMonth],
  );

  const ytdEntries = useMemo(
    () => entries.filter((e) => (e.date ?? "").startsWith(currentYear)),
    [entries, currentYear],
  );

  const thisMonthTotal = useMemo(
    () => sumConverted(thisMonthEntries, convert),
    [thisMonthEntries, convert],
  );

  const lastMonthTotal = useMemo(
    () => sumConverted(lastMonthEntries, convert),
    [lastMonthEntries, convert],
  );

  const ytdTotal = useMemo(
    () => sumConverted(ytdEntries, convert),
    [ytdEntries, convert],
  );

  const allTimeTotal = useMemo(
    () => sumConverted(entries, convert),
    [entries, convert],
  );

  // ---- Breakdown by type (current month) -----------------------------------

  const breakdownByType = useMemo(() => {
    const map: Partial<Record<IncomeType, number>> = {};
    thisMonthEntries.forEach((e) => {
      const converted = convert(e.amount, e.currency);
      map[e.type] = (map[e.type] ?? 0) + converted;
    });
    return Object.entries(map)
      .map(([type, value]) => ({
        type: type as IncomeType,
        label: INCOME_TYPE_LABELS[type as IncomeType],
        value: value as number,
        color: INCOME_TYPE_COLORS[type as IncomeType],
      }))
      .sort((a, b) => b.value - a.value);
  }, [thisMonthEntries, convert]);

  const pieOption = {
    tooltip: {
      trigger: "item" as const,
      formatter: "{b}: {c} ({d}%)",
    },
    series: [
      {
        type: "pie" as const,
        radius: ["55%", "85%"],
        center: ["50%", "50%"],
        data: breakdownByType.map((d) => ({
          name: d.label,
          value: d.value,
          itemStyle: { color: d.color },
        })),
        label: { show: false },
        itemStyle: {
          emphasis: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.3)",
          },
        },
      },
    ],
  };

  // ---- Filter pills --------------------------------------------------------

  const typesPresent = useMemo(() => {
    const set = new Set<IncomeType>();
    entries.forEach((e) => set.add(e.type));
    return Array.from(set);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const filtered =
      typeFilter === "all"
        ? entries
        : entries.filter((e) => e.type === typeFilter);
    return [...filtered].sort((a, b) =>
      (b.date ?? "") > (a.date ?? "")
        ? 1
        : (b.date ?? "") < (a.date ?? "")
          ? -1
          : 0,
    );
  }, [entries, typeFilter]);

  // ---- Handlers ------------------------------------------------------------

  function handleAdd(entry: IncomeEntry) {
    setEntries((prev) => [...prev, entry]);
  }

  function handleEdit(updated: IncomeEntry) {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }

  function handleDelete(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }
  console.log("pieOption", pieOption);

  // ---- Render --------------------------------------------------------------

  return (
    <div className="space-y-8">
      {/* ================================================================= */}
      {/* Hero Section                                                       */}
      {/* ================================================================= */}
      <BlurFade delay={0}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-mono mb-2">This Month&apos;s Income</p>
            <div className="display-number text-income">
              <NumberTicker
                value={thisMonthTotal}
                prefix={symbol}
                decimalPlaces={2}
              />
            </div>
          </div>
          <IncomeDialog
            onSave={handleAdd}
            trigger={
              <Button size="default">
                <Plus className="size-4 mr-1" />
                Add Income
              </Button>
            }
          />
        </div>
      </BlurFade>

      {/* Summary tiles */}
      <BlurFade delay={0.05}>
        <div className="finance-card p-0">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
            {[
              { label: "This Month", value: thisMonthTotal },
              { label: "Last Month", value: lastMonthTotal },
              { label: "YTD", value: ytdTotal },
              { label: "All Time", value: allTimeTotal },
            ].map((metric) => (
              <div key={metric.label} className="px-5 py-4">
                <p className="label-mono mb-1">{metric.label}</p>
                <p className="text-lg font-semibold tabular-nums">
                  {format(metric.value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </BlurFade>

      {/* ================================================================= */}
      {/* TEST: Hardcoded chart — does this blink on hover?                   */}
      {/* ================================================================= */}
      <div className="finance-card p-6">
        <p className="label-mono mb-4">TEST: Hardcoded Data (delete later)</p>
        <ReactECharts
          option={{
            tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
            series: [
              {
                type: "pie",
                radius: "55%",
                center: ["50%", "50%"],
                data: [
                  { value: 335, name: "Salary" },
                  { value: 310, name: "Freelance" },
                  { value: 234, name: "Uber" },
                ],
                itemStyle: {
                  emphasis: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: "rgba(0, 0, 0, 0.5)",
                  },
                },
              },
            ],
          }}
          style={{ height: 300 }}
        />
      </div>

      {/* ================================================================= */}
      {/* This Month Breakdown                                               */}
      {/* ================================================================= */}
      {/* <BlurFade delay={0.1}> */}
      <div className="finance-card p-6">
        <p className="label-mono mb-4">This Month Breakdown</p>

        {breakdownByType.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No income recorded this month.
          </p>
        ) : (
          <div className="grid md:grid-cols-[280px_1fr] gap-8 items-center">
            {/* Donut */}
            <ReactECharts
              option={pieOption}
              style={{ height: "200px" }}
              // shouldSetOption={() => false}
            />

            {/* Progress bars */}
            <div className="space-y-3 min-w-0">
              {breakdownByType.map((item) => {
                const pct =
                  thisMonthTotal > 0 ? (item.value / thisMonthTotal) * 100 : 0;
                return (
                  <div key={item.type} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="size-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate font-medium">
                          {item.label}
                        </span>
                      </div>
                      <span className="tabular-nums text-income font-medium shrink-0">
                        {format(item.value)}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
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
        )}
      </div>
      {/* </BlurFade> */}

      {/* ================================================================= */}
      {/* Records Table                                                      */}
      {/* ================================================================= */}
      <BlurFade delay={0.15}>
        <div className="finance-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <p className="label-mono">Records</p>

            {/* Filter pills */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setTypeFilter("all")}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  typeFilter === "all"
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                All
              </button>
              {typesPresent.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    typeFilter === t
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  {INCOME_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {filteredEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No income records yet. Add your first entry above.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left font-medium px-6 py-2.5">Date</th>
                    <th className="text-left font-medium px-3 py-2.5">Type</th>
                    <th className="text-left font-medium px-3 py-2.5 hidden sm:table-cell">
                      Description
                    </th>
                    <th className="text-right font-medium px-3 py-2.5">
                      Amount
                    </th>
                    <th className="text-center font-medium px-3 py-2.5 hidden md:table-cell">
                      Currency
                    </th>
                    <th className="text-right font-medium px-6 py-2.5">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-6 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateString(entry.date)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: INCOME_TYPE_COLORS[entry.type],
                            }}
                          />
                          <span className="text-xs font-medium whitespace-nowrap">
                            {INCOME_TYPE_LABELS[entry.type]}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden sm:table-cell max-w-[200px] truncate">
                        {entry.description}
                      </td>
                      <td className="px-3 py-2.5 text-right text-income tabular-nums font-medium whitespace-nowrap">
                        {format(entry.amount, entry.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-center hidden md:table-cell font-mono text-xs text-muted-foreground">
                        {entry.currency}
                      </td>
                      <td className="px-6 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <IncomeDialog
                            entry={entry}
                            onSave={handleEdit}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            }
                          />
                          <DeleteConfirm
                            onConfirm={() => handleDelete(entry.id)}
                          >
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </DeleteConfirm>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </BlurFade>
    </div>
  );
}
