"use client";

import { useState, useMemo } from "react";
import { useTheme } from "next-themes";
import ReactECharts from "echarts-for-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import { useRecurringExpenses } from "@/hooks/use-recurring-expenses";
import { useExpenseCategories } from "@/hooks/use-expense-categories";
import type {
  ExpenseEntry,
  IncomeEntry,
  PaymentMethod,
} from "@/lib/utils/types";
import { normalizeExpenseEntry, CURRENCY_SYMBOLS } from "@/lib/utils/types";
import {
  PAYMENT_METHOD_LABELS,
} from "@/lib/utils/constants";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getMonthKey,
  formatDateString,
  getDaysInMonth,
  getSydneyDayOfMonth,
} from "@/lib/utils/timezone";
import { getPieBaseOption } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";

// UI
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";

// Icons
import {
  Plus,
  Pencil,
  Trash2,
  Receipt,
  Search,
  RefreshCw,
  Tags,
} from "lucide-react";

// Feature components
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { RecurringDialog } from "@/components/expenses/recurring-dialog";
import { ImageViewer } from "@/components/expenses/image-viewer";
import {
  DateRangeFilter,
  getPresetRange,
  type DatePreset,
  type DateRange,
} from "@/components/expenses/date-range-filter";
import { PaymentMethodBreakdown } from "@/components/expenses/payment-method-breakdown";
import { SpendingTrend } from "@/components/expenses/spending-trend";
import { ComparisonView } from "@/components/expenses/comparison-view";
import { CumulativePaceChart } from "@/components/expenses/cumulative-pace-chart";
import { ManageCategoriesDialog } from "@/components/expenses/manage-categories-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumConverted(
  entries: ExpenseEntry[],
  convert: (amount: number, from: ExpenseEntry["currency"]) => number,
) {
  return entries.reduce((acc, e) => acc + convert(e.amount, e.currency), 0);
}

function filterByDateRange(entries: ExpenseEntry[], range: DateRange): ExpenseEntry[] {
  return entries.filter((e) => e.date >= range.from && e.date <= range.to);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExpensesPage() {
  const [rawEntries, setEntries] = useLocalStorage<ExpenseEntry[]>(
    "expense_entries",
    [],
  );
  // Normalize old entries missing new fields
  const entries = useMemo(
    () => rawEntries.map((e) => normalizeExpenseEntry(e as unknown as Record<string, unknown>)),
    [rawEntries],
  );

  const [incomeEntries] = useLocalStorage<IncomeEntry[]>("income_entries", []);
  const { currency, format, convert, symbol } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Dynamic expense categories
  const {
    allTypes: categoryTypes,
    allLabels: categoryLabels,
    allColors: categoryColors,
    customCategories,
    addCategory,
    removeCategory,
    getLabel,
    getColor,
  } = useExpenseCategories();

  // Recurring expenses
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTemplate,
  } = useRecurringExpenses(entries, setEntries);

  // ---- State ----------------------------------------------------------------

  // Records tab filters
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Breakdown tab date range
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [customRange, setCustomRange] = useState<DateRange>(
    getPresetRange("this_month"),
  );
  const activeDateRange =
    datePreset === "custom" ? customRange : getPresetRange(datePreset);

  // Comparison tab
  const currentMonth = getCurrentMonthKey();
  const lastMonth = getLastMonthKey();
  const [compMonthA, setCompMonthA] = useState(lastMonth);
  const [compMonthB, setCompMonthB] = useState(currentMonth);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntry | null>(null);

  // ---- Derived data ---------------------------------------------------------

  const thisMonthEntries = useMemo(
    () => entries.filter((e) => getMonthKey(e.date ?? "") === currentMonth),
    [entries, currentMonth],
  );
  const lastMonthEntries = useMemo(
    () => entries.filter((e) => getMonthKey(e.date ?? "") === lastMonth),
    [entries, lastMonth],
  );

  const thisMonthTotal = sumConverted(thisMonthEntries, convert);
  const lastMonthTotal = sumConverted(lastMonthEntries, convert);

  // Daily average & velocity
  const daysElapsed = getSydneyDayOfMonth();
  const dailyAvg = daysElapsed > 0 ? thisMonthTotal / daysElapsed : 0;
  const daysInMonth = getDaysInMonth(currentMonth);
  const monthlyPace = dailyAvg * daysInMonth;
  const paceVsLast =
    lastMonthTotal > 0 ? ((monthlyPace - lastMonthTotal) / lastMonthTotal) * 100 : 0;

  // Breakdown by type (date-range-filtered)
  const dateFilteredEntries = useMemo(
    () => filterByDateRange(entries, activeDateRange),
    [entries, activeDateRange],
  );
  const dateFilteredTotal = sumConverted(dateFilteredEntries, convert);

  const breakdownByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of dateFilteredEntries) {
      map[e.type] = (map[e.type] ?? 0) + convert(e.amount, e.currency);
    }
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .map(([t, value]) => ({
        type: t,
        label: getLabel(t),
        value,
        color: getColor(t),
      }))
      .sort((a, b) => b.value - a.value);
  }, [dateFilteredEntries, convert, getLabel, getColor]);

  // Income for ratio
  const dateFilteredIncome = useMemo(() => {
    return incomeEntries
      .filter((e) => e.date >= activeDateRange.from && e.date <= activeDateRange.to)
      .reduce((sum, e) => sum + convert(e.amount, e.currency), 0);
  }, [incomeEntries, activeDateRange, convert]);

  // Pie chart option
  const pieOption = useMemo(() => {
    const base = getPieBaseOption(isDark);
    return {
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["60%", "85%"],
          center: ["50%", "50%"],
          padAngle: 2,
          data: breakdownByType.map((item) => ({
            name: item.label,
            value: item.value,
            itemStyle: { color: item.color },
          })),
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.3)",
            },
          },
        },
      ],
    };
  }, [breakdownByType, isDark]);

  // Records tab: smart filter pills + search + method filter
  const typesPresent = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.type));
    return Array.from(set);
  }, [entries]);

  // Category ids that are in use (for manage dialog)
  const usedCategoryIds = useMemo(() => new Set(entries.map((e) => e.type)), [entries]);

  const methodsPresent = useMemo(() => {
    const set = new Set<PaymentMethod>();
    entries.forEach((e) => {
      if (e.paymentMethod && e.paymentMethod !== "other") set.add(e.paymentMethod);
    });
    return Array.from(set);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    let result = [...entries];
    if (typeFilter !== "all") result = result.filter((e) => e.type === typeFilter);
    if (methodFilter !== "all")
      result = result.filter((e) => (e.paymentMethod ?? "other") === methodFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          (e.vendor ?? "").toLowerCase().includes(q),
      );
    }
    return result.sort(
      (a, b) =>
        (b.date ?? "").localeCompare(a.date ?? "") || b.createdAt - a.createdAt,
    );
  }, [entries, typeFilter, methodFilter, searchQuery]);

  // ---- Handlers -------------------------------------------------------------

  function handleSave(saved: ExpenseEntry) {
    setEntries((prev: ExpenseEntry[]) => {
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
    setEntries((prev: ExpenseEntry[]) => prev.filter((e) => e.id !== id));
    setDeleteTarget(null);
  }

  function handleDateRangeChange(preset: DatePreset, range: DateRange) {
    setDatePreset(preset);
    setCustomRange(range);
  }

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ================================================================= */}
      {/* Hero Section (always visible)                                     */}
      {/* ================================================================= */}
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
          <div className="finance-card inline-flex flex-wrap divide-x divide-border text-sm">
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">This Month</p>
              <p className="font-semibold tabular-nums">{format(thisMonthTotal)}</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">Last Month</p>
              <p className="font-semibold tabular-nums">{format(lastMonthTotal)}</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">Daily Avg</p>
              <p className="font-semibold tabular-nums">{format(dailyAvg)}/day</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">Monthly Pace</p>
              <p
                className={cn(
                  "font-semibold tabular-nums",
                  paceVsLast > 10
                    ? "text-expense"
                    : paceVsLast < -10
                      ? "text-income"
                      : "text-foreground",
                )}
              >
                → {format(monthlyPace)}
              </p>
            </div>
          </div>
        </section>
      </BlurFade>

      {/* ================================================================= */}
      {/* Tabbed Content                                                    */}
      {/* ================================================================= */}
      <BlurFade delay={0.08}>
        <Tabs defaultValue="breakdown">
          <TabsList variant="line">
            <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
            <TabsTrigger value="records">Records</TabsTrigger>
            <TabsTrigger value="trends">Trends & Insights</TabsTrigger>
          </TabsList>

          {/* -------------------------------------------------------------- */}
          {/* Tab 1: Breakdown                                                */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="breakdown" className="space-y-6 pt-4">
            {/* Date range + actions */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <DateRangeFilter
                value={datePreset}
                customRange={customRange}
                onChange={handleDateRangeChange}
              />
              <div className="flex gap-2 shrink-0">
                <ManageCategoriesDialog
                  customCategories={customCategories}
                  onAdd={addCategory}
                  onRemove={removeCategory}
                  usedCategoryIds={usedCategoryIds}
                  trigger={
                    <Button variant="ghost" size="sm">
                      <Tags className="h-3.5 w-3.5 mr-1" />
                      Categories
                    </Button>
                  }
                />
                <RecurringDialog
                  templates={templates}
                  onAdd={addTemplate}
                  onUpdate={updateTemplate}
                  onDelete={deleteTemplate}
                  onToggle={toggleTemplate}
                  categoryTypes={categoryTypes}
                  categoryLabels={categoryLabels}
                  trigger={
                    <Button variant="ghost" size="sm">
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Recurring
                    </Button>
                  }
                />
                <ExpenseDialog
                  onSave={handleSave}
                  onCreateRecurring={addTemplate}
                  categoryTypes={categoryTypes}
                  categoryLabels={categoryLabels}
                  trigger={
                    <Button size="sm">
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add Expense
                    </Button>
                  }
                />
              </div>
            </div>

            {/* Donut + progress bars */}
            {breakdownByType.length === 0 ? (
              <div className="finance-card flex flex-col items-center justify-center py-16 text-center">
                <Receipt className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No expenses in this period.
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
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>

                  {/* Progress bars with income ratio */}
                  <div className="flex flex-col justify-center gap-2.5">
                    {breakdownByType.map((item) => {
                      const pct =
                        dateFilteredTotal > 0
                          ? (item.value / dateFilteredTotal) * 100
                          : 0;
                      const incomeRatio =
                        dateFilteredIncome > 0
                          ? (item.value / dateFilteredIncome) * 100
                          : null;
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
                              {incomeRatio !== null && (
                                <span className="ml-1.5 text-muted-foreground/60">
                                  · {incomeRatio.toFixed(1)}% of income
                                </span>
                              )}
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

                    {/* Expense-to-income summary */}
                    {dateFilteredIncome > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">
                          Total: {format(dateFilteredTotal)} of{" "}
                          {format(dateFilteredIncome)} income (
                          {((dateFilteredTotal / dateFilteredIncome) * 100).toFixed(1)}
                          %) — Savings rate:{" "}
                          <span className="text-income font-medium">
                            {(
                              ((dateFilteredIncome - dateFilteredTotal) /
                                dateFilteredIncome) *
                              100
                            ).toFixed(1)}
                            %
                          </span>
                        </p>
                      </div>
                    )}
                    {dateFilteredIncome === 0 && dateFilteredTotal > 0 && (
                      <p className="text-xs text-muted-foreground/60 mt-2 pt-2 border-t border-border/50">
                        Add income data for ratio analysis.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Payment method breakdown */}
            {dateFilteredEntries.some((e) => e.paymentMethod && e.paymentMethod !== "other") && (
              <div className="finance-card p-6">
                <PaymentMethodBreakdown entries={dateFilteredEntries} />
              </div>
            )}
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Tab 2: Records                                                  */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="records" className="space-y-4 pt-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by description or vendor..."
                className="pl-9"
              />
            </div>

            {/* Type filter pills (smart — only types with data) */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setTypeFilter("all")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  typeFilter === "all"
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                )}
              >
                All
              </button>
              {typesPresent.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    typeFilter === t
                      ? "bg-foreground text-background"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  {getLabel(t)}
                </button>
              ))}
            </div>

            {/* Payment method filter pills */}
            {methodsPresent.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setMethodFilter("all")}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    methodFilter === "all"
                      ? "bg-foreground text-background"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  All Methods
                </button>
                {methodsPresent.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethodFilter(m)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      methodFilter === m
                        ? "bg-foreground text-background"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                    )}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            )}

            {/* Add expense button */}
            <div className="flex justify-end">
              <ExpenseDialog
                onSave={handleSave}
                onCreateRecurring={addTemplate}
                categoryTypes={categoryTypes}
                categoryLabels={categoryLabels}
                trigger={
                  <Button size="sm">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add Expense
                  </Button>
                }
              />
            </div>

            {/* Table */}
            {filteredEntries.length === 0 ? (
              <div className="finance-card flex flex-col items-center justify-center py-12 text-center">
                <Receipt className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No records found.</p>
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
                        <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                          Description
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
                          Vendor
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground text-right">
                          Amount
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">
                          Method
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
                              {entry.isRecurring && (
                                <RefreshCw className="h-3 w-3 text-muted-foreground" />
                              )}
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor: getColor(entry.type),
                                }}
                              />
                              {getLabel(entry.type)}
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className="line-clamp-1">
                              {entry.description}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
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
                          <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                            {PAYMENT_METHOD_LABELS[entry.paymentMethod ?? "other"]}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {entry.images && entry.images.length > 0 && (
                                <ImageViewer
                                  images={entry.images}
                                  description={entry.description}
                                />
                              )}
                              <ExpenseDialog
                                entry={entry}
                                onSave={handleSave}
                                categoryTypes={categoryTypes}
                                categoryLabels={categoryLabels}
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
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Tab 3: Trends & Insights                                        */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="trends" className="space-y-6 pt-4">
            <div className="finance-card p-6">
              <SpendingTrend entries={entries} getLabel={getLabel} getColor={getColor} />
            </div>

            <div className="finance-card p-6">
              <CumulativePaceChart entries={entries} />
            </div>

            <div className="finance-card p-6">
              <ComparisonView
                entries={entries}
                monthA={compMonthA}
                monthB={compMonthB}
                onMonthAChange={setCompMonthA}
                onMonthBChange={setCompMonthB}
                getLabel={getLabel}
                getColor={getColor}
              />
            </div>
          </TabsContent>
        </Tabs>
      </BlurFade>

      {/* ================================================================= */}
      {/* Delete Confirmation Dialog                                         */}
      {/* ================================================================= */}
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
