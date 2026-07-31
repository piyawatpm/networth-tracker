"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useTheme } from "next-themes";
import { ReactECharts, type EChartsReact } from "@/components/ui/lazy-echarts";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import { useRecurringEntries } from "@/hooks/use-recurring-entries";
import { useCategories } from "@/hooks/use-categories";
import { useRealizedIncome } from "@/hooks/use-realized-income";
import type { IncomeEntry, IncomeType, RecurringIncome, ExpenseEntry } from "@/lib/utils/types";
import {
  normalizeIncomeEntry,
  CURRENCY_SYMBOLS,
  DERIVED_INCOME_TYPES,
} from "@/lib/utils/types";
import {
  INCOME_TYPE_LABELS,
  INCOME_TYPE_COLORS,
} from "@/lib/utils/constants";
import { sumConverted, filterByDateRange } from "@/lib/utils/entry-helpers";
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
  Search,
  RefreshCw,
  TrendingUp,
  Tags,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Link2,
} from "lucide-react";

// Feature components
import { IncomeDialog } from "@/components/income/income-dialog";
import { RecurringIncomeDialog } from "@/components/income/recurring-dialog";
import { PassiveVsActiveChart } from "@/components/income/passive-vs-active-chart";
import { IncomeInsights } from "@/components/income/income-insights";
import { ManageCategoriesDialog } from "@/components/shared/manage-categories-dialog";
import {
  DateRangeFilter,
  getPresetRange,
  type DatePreset,
  type DateRange,
} from "@/components/expenses/date-range-filter";
import { MonthlyTrendChart } from "@/components/shared/monthly-trend-chart";
import { CumulativePaceChart } from "@/components/shared/cumulative-pace-chart";
import { ComparisonView } from "@/components/expenses/comparison-view";

// ---------------------------------------------------------------------------
// Recurring income entry factory
// ---------------------------------------------------------------------------

const RECURRING_INCOME_CONFIG = {
  storageKey: "recurring_income_templates",
  createEntry: (template: RecurringIncome, date: string): IncomeEntry => ({
    id: crypto.randomUUID(),
    type: template.type,
    description: template.description,
    amount: template.amount,
    currency: template.currency,
    source: template.source,
    date,
    notes: template.notes,
    createdAt: Date.now(),
    isRecurring: true,
    recurringId: template.id,
  }),
};

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IncomePage() {
  const [rawEntries, setEntries] = useCloudStorage<IncomeEntry[]>(
    "income_entries",
    [],
  );
  const entries = useMemo(
    () => rawEntries.map((e) => normalizeIncomeEntry(e as unknown as Record<string, unknown>)),
    [rawEntries],
  );

  // Realized sells projected from the portfolio + crypto transaction logs.
  // Read-only: merged into `allEntries` for display and totals, but every
  // save/delete below still targets `entries`, so these never hit storage.
  const {
    entries: derivedEntries,
    hasSource: hasRealizedSource,
    enabled: realizedEnabled,
    setEnabled: setRealizedEnabled,
  } = useRealizedIncome();
  const allEntries = useMemo(
    () => [...entries, ...derivedEntries],
    [entries, derivedEntries],
  );

  const [expenseEntries] = useCloudStorage<ExpenseEntry[]>("expense_entries", []);
  const { currency, format, convert, symbol } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Recurring income
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTemplate,
  } = useRecurringEntries(entries, setEntries, RECURRING_INCOME_CONFIG);

  // Dynamic income categories
  const {
    allTypes: categoryTypes,
    allLabels: categoryLabels,
    customCategories,
    addCategory,
    removeCategory,
    getLabel,
    getColor,
  } = useCategories({
    storageKey: "custom_income_categories",
    defaultLabels: INCOME_TYPE_LABELS,
    defaultColors: INCOME_TYPE_COLORS,
  });

  // Category ids in use
  const usedCategoryIds = useMemo(
    () => new Set(allEntries.map((e) => e.type)),
    [allEntries],
  );

  // Realized categories are projected from the transaction logs, so they must
  // not be selectable when adding income by hand — that would double-count.
  const manualCategoryTypes = useMemo(
    () => categoryTypes.filter((t) => !DERIVED_INCOME_TYPES.includes(t)),
    [categoryTypes],
  );

  // ---- State ----------------------------------------------------------------

  // Records tab
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

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
  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<IncomeEntry | null>(null);

  // Pie chart interactive legend
  const pieRef = useRef<EChartsReact>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) { next.delete(type); } else { next.add(type); }
      return next;
    });
  }, []);
  const highlightSlice = useCallback((name: string) => {
    pieRef.current?.getEchartsInstance()?.dispatchAction({ type: "highlight", name });
  }, []);
  const downplayAll = useCallback(() => {
    pieRef.current?.getEchartsInstance()?.dispatchAction({ type: "downplay" });
  }, []);

  // ---- Derived data ---------------------------------------------------------

  const thisMonthEntries = useMemo(
    () => allEntries.filter((e) => getMonthKey(e.date ?? "") === currentMonth),
    [allEntries, currentMonth],
  );
  const lastMonthEntries = useMemo(
    () => allEntries.filter((e) => getMonthKey(e.date ?? "") === lastMonth),
    [allEntries, lastMonth],
  );

  const thisMonthTotal = sumConverted(thisMonthEntries, convert);
  const lastMonthTotal = sumConverted(lastMonthEntries, convert);

  // Weekly avg & pace
  const daysElapsed = getSydneyDayOfMonth();
  const weeksElapsed = Math.max(1, daysElapsed / 7);
  const weeklyAvg = thisMonthTotal / weeksElapsed;
  const daysInMonth = getDaysInMonth(currentMonth);
  const dailyAvg = daysElapsed > 0 ? thisMonthTotal / daysElapsed : 0;
  const monthlyPace = dailyAvg * daysInMonth;
  // For income: up is GOOD (green), down is BAD (red)
  const paceVsLast =
    lastMonthTotal > 0 ? ((monthlyPace - lastMonthTotal) / lastMonthTotal) * 100 : 0;

  // Breakdown by type (date-range-filtered)
  const dateFilteredEntries = useMemo(
    () => filterByDateRange(allEntries, activeDateRange),
    [allEntries, activeDateRange],
  );

  // Realized losses can push a category net-negative, so keep every non-zero
  // category here (the hero total must stay truthful) and let the donut alone
  // drop the negatives — a pie can't draw a negative arc.
  const breakdownByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of dateFilteredEntries) {
      map[e.type] = (map[e.type] ?? 0) + convert(e.amount, e.currency);
    }
    return Object.entries(map)
      .filter(([, v]) => Math.abs(v) >= 0.005)
      .map(([t, value]) => ({
        type: t,
        label: getLabel(t),
        value,
        color: getColor(t),
      }))
      .sort((a, b) => b.value - a.value);
  }, [dateFilteredEntries, convert, getLabel, getColor]);

  // Total reflects only categories visible in the donut (legend toggles affect it).
  const dateFilteredTotal = useMemo(
    () =>
      breakdownByType
        .filter((item) => !hiddenTypes.has(item.type))
        .reduce((sum, item) => sum + item.value, 0),
    [breakdownByType, hiddenTypes],
  );

  // Realized share of the selected period, for the opt-out banner.
  const realizedInPeriod = useMemo(
    () =>
      sumConverted(
        filterByDateRange(derivedEntries, activeDateRange),
        convert,
      ),
    [derivedEntries, activeDateRange, convert],
  );

  // Expenses for savings ratio
  const dateFilteredExpenses = useMemo(() => {
    return expenseEntries
      .filter((e) => e.date >= activeDateRange.from && e.date <= activeDateRange.to)
      .reduce((sum, e) => sum + convert(e.amount, e.currency), 0);
  }, [expenseEntries, activeDateRange, convert]);

  // Pie chart
  const pieOption = useMemo(() => {
    const base = getPieBaseOption(isDark, symbol);
    return {
      ...base,
      legend: { show: false },
      series: [{
        type: "pie" as const,
        radius: ["60%", "85%"],
        center: ["50%", "50%"],
        padAngle: 2,
        data: breakdownByType
          .filter((item) => !hiddenTypes.has(item.type) && item.value > 0)
          .map((item) => ({
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
      }],
    };
  }, [breakdownByType, isDark, hiddenTypes]);

  // Records tab filters
  const typesPresent = useMemo(() => {
    const set = new Set<string>();
    allEntries.forEach((e) => set.add(e.type));
    return Array.from(set);
  }, [allEntries]);

  const filteredEntries = useMemo(() => {
    let result = [...allEntries];
    if (typeFilter !== "all") result = result.filter((e) => e.type === typeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          (e.source ?? "").toLowerCase().includes(q) ||
          (e.notes ?? "").toLowerCase().includes(q),
      );
    }
    result.sort((a, b) => {
      if (sortField === "date") {
        const cmp = (a.date ?? "").localeCompare(b.date ?? "");
        return sortDir === "desc" ? -cmp : cmp;
      }
      const aVal = convert(a.amount, a.currency);
      const bVal = convert(b.amount, b.currency);
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [allEntries, typeFilter, searchQuery, sortField, sortDir, convert]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const pagedEntries = filteredEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [typeFilter, searchQuery, sortField, sortDir]);

  // ---- Handlers -------------------------------------------------------------

  function handleSave(saved: IncomeEntry) {
    setEntries((prev: IncomeEntry[]) => {
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
    setEntries((prev: IncomeEntry[]) => prev.filter((e) => e.id !== id));
    setDeleteTarget(null);
  }

  function handleDateRangeChange(preset: DatePreset, range: DateRange) {
    setDatePreset(preset);
    setCustomRange(range);
  }

  function toggleSort(field: "date" | "amount") {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ================================================================= */}
      {/* Hero Section                                                       */}
      {/* ================================================================= */}
      <BlurFade delay={0}>
        <section className="space-y-4">
          <p className="label-mono mb-2">
            {datePreset === "this_month" ? "This Month\u2019s Income"
              : datePreset === "last_month" ? "Last Month\u2019s Income"
              : datePreset === "last_90" ? "Last 90 Days Income"
              : datePreset === "ytd" ? "Year to Date Income"
              : "Custom Period Income"}
          </p>
          <div className="display-number text-income">
            <NumberTicker
              value={dateFilteredTotal}
              prefix={symbol}
              decimalPlaces={2}
            />
          </div>

          {/* Summary tiles */}
          <div className="finance-card p-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-0 md:divide-x md:divide-border">
              <div className="md:pr-6">
                <p className="label-mono mb-1">Selected Period</p>
                <p className="text-lg font-semibold tabular-nums">{format(dateFilteredTotal)}</p>
              </div>
              <div className="md:px-6">
                <p className="label-mono mb-1">Entries</p>
                <p className="text-lg font-semibold tabular-nums">{dateFilteredEntries.length}</p>
              </div>
              <div className="md:px-6">
                <p className="label-mono mb-1">This Month</p>
                <p className="text-lg font-semibold tabular-nums">{format(thisMonthTotal)}</p>
              </div>
              <div className="md:pl-6">
                <p className="label-mono mb-1">Monthly Pace</p>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    paceVsLast > 10
                      ? "text-income"
                      : paceVsLast < -10
                        ? "text-expense"
                        : "text-foreground",
                  )}
                >
                  → {format(monthlyPace)}
                </p>
              </div>
            </div>
          </div>

          {/* Realized-gains projection: opt-out + provenance note */}
          {hasRealizedSource && (
            <div className="finance-card flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <Link2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm">
                    Realized profit from your transaction logs
                    {realizedEnabled && (
                      <span
                        className={cn(
                          "ml-1.5 font-mono text-xs tabular-nums",
                          realizedInPeriod < 0 ? "text-expense" : "text-income",
                        )}
                      >
                        {realizedInPeriod < 0 ? "−" : "+"}
                        {format(Math.abs(realizedInPeriod))} this period
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    One row per sell, priced against average cost. Crypto
                    transfers are excluded — log those as Crypto Yield.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRealizedEnabled(!realizedEnabled)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors self-start sm:self-auto",
                  realizedEnabled
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                )}
              >
                {realizedEnabled ? "Included" : "Excluded"}
              </button>
            </div>
          )}
        </section>
      </BlurFade>

      {/* ================================================================= */}
      {/* Tabbed Content                                                     */}
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
                  title="Manage Income Categories"
                  customCategories={customCategories}
                  defaultLabels={INCOME_TYPE_LABELS}
                  onAdd={addCategory}
                  onRemove={removeCategory}
                  usedCategoryIds={usedCategoryIds}
                  placeholder="e.g. Side Hustle, Royalties, Grants"
                  trigger={
                    <Button variant="ghost" size="sm">
                      <Tags className="h-3.5 w-3.5 mr-1" />
                      Categories
                    </Button>
                  }
                />
                <RecurringIncomeDialog
                  templates={templates}
                  onAdd={addTemplate}
                  onUpdate={updateTemplate}
                  onDelete={deleteTemplate}
                  onToggle={toggleTemplate}
                  trigger={
                    <Button variant="ghost" size="sm">
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Recurring
                    </Button>
                  }
                />
                <IncomeDialog
                  categoryTypes={manualCategoryTypes} categoryLabels={categoryLabels} onSave={handleSave}
                  onCreateRecurring={addTemplate}
                  trigger={
                    <Button size="sm">
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add Income
                    </Button>
                  }
                />
              </div>
            </div>

            {/* Donut + progress bars */}
            {breakdownByType.length === 0 ? (
              <div className="finance-card flex flex-col items-center justify-center py-16 text-center">
                <TrendingUp className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No income in this period.
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Tap &ldquo;Add Income&rdquo; to get started.
                </p>
              </div>
            ) : (
              <div className="finance-card p-6">
                <div className="grid gap-6 md:grid-cols-[240px_1fr]">
                  <div className="mx-auto aspect-square w-full max-w-[240px]">
                    <ReactECharts
                      ref={pieRef}
                      option={pieOption}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>

                  <div className="flex flex-col justify-center gap-2">
                    {breakdownByType.map((item) => {
                      const isHidden = hiddenTypes.has(item.type);
                      // A net-negative category (realized losses outweighing
                      // gains) has no slice and no share of the total — show
                      // the amount in red and skip the bar.
                      const isNegative = item.value < 0;
                      const pct = !isHidden && !isNegative && dateFilteredTotal > 0
                        ? (item.value / dateFilteredTotal) * 100
                        : 0;
                      return (
                        <button
                          key={item.type}
                          onClick={() => toggleType(item.type)}
                          onMouseEnter={() => !isHidden && highlightSlice(item.label)}
                          onMouseLeave={downplayAll}
                          className={cn(
                            "text-left rounded-lg px-2 py-1.5 transition-all",
                            isHidden ? "opacity-40 hover:opacity-60" : "hover:bg-secondary/50"
                          )}
                        >
                          <div className="flex items-center justify-between text-sm mb-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn("inline-block h-2.5 w-2.5 rounded-full transition-transform", isHidden && "scale-75")}
                                style={{ backgroundColor: isHidden ? "#aaa" : item.color }}
                              />
                              <span className={cn(isHidden && "line-through text-muted-foreground")}>{item.label}</span>
                            </div>
                            <span
                              className={cn(
                                "font-mono text-xs tabular-nums",
                                !isHidden && isNegative
                                  ? "text-expense"
                                  : "text-muted-foreground",
                              )}
                            >
                              {isHidden
                                ? "—"
                                : isNegative
                                  ? `−${format(Math.abs(item.value))} net loss`
                                  : `${format(item.value)} (${pct.toFixed(1)}%)`}
                            </span>
                          </div>
                          {!isHidden && !isNegative && (
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: item.color }}
                              />
                            </div>
                          )}
                        </button>
                      );
                    })}

                    {/* Savings summary */}
                    {dateFilteredExpenses > 0 && dateFilteredTotal > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">
                          Earned {format(dateFilteredTotal)} — Spent{" "}
                          {format(dateFilteredExpenses)} — Saved{" "}
                          <span className="text-income font-medium">
                            {format(dateFilteredTotal - dateFilteredExpenses)} (
                            {(
                              ((dateFilteredTotal - dateFilteredExpenses) /
                                dateFilteredTotal) *
                              100
                            ).toFixed(1)}
                            %)
                          </span>
                        </p>
                      </div>
                    )}
                    {dateFilteredExpenses === 0 && dateFilteredTotal > 0 && (
                      <p className="text-xs text-muted-foreground/60 mt-2 pt-2 border-t border-border/50">
                        Add expense data for savings analysis.
                      </p>
                    )}
                  </div>
                </div>
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
                placeholder="Search by description, source, or notes..."
                className="pl-9"
              />
            </div>

            {/* Type filter pills */}
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

            {/* Add income button */}
            <div className="flex justify-end">
              <IncomeDialog
                categoryTypes={manualCategoryTypes}
                categoryLabels={categoryLabels}
                onSave={handleSave}
                onCreateRecurring={addTemplate}
                trigger={
                  <Button size="sm">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add Income
                  </Button>
                }
              />
            </div>

            {/* Table */}
            {filteredEntries.length === 0 ? (
              <div className="finance-card flex flex-col items-center justify-center py-12 text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No records found.</p>
              </div>
            ) : (
              <div className="finance-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left">
                        <th
                          className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                          onClick={() => toggleSort("date")}
                        >
                          <span className="inline-flex items-center gap-1">
                            Date
                            {sortField === "date" && (
                              <ArrowUpDown className="h-3 w-3" />
                            )}
                          </span>
                        </th>
                        <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          Type
                        </th>
                        <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium hidden md:table-cell">
                          Source
                        </th>
                        <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium hidden sm:table-cell">
                          Description
                        </th>
                        <th
                          className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-right cursor-pointer select-none"
                          onClick={() => toggleSort("amount")}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Amount
                            {sortField === "amount" && (
                              <ArrowUpDown className="h-3 w-3" />
                            )}
                          </span>
                        </th>
                        <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEntries.map((entry) => (
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
                              {entry.derived && (
                                <Link2
                                  className="h-3 w-3 text-muted-foreground"
                                  aria-label="Derived from your transaction log"
                                />
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
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                            {entry.source || "\u2014"}
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <div>
                              <span className="line-clamp-1">{entry.description}</span>
                              {entry.notes && (
                                <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                  {entry.notes}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span
                              className={cn(
                                "font-mono tabular-nums",
                                entry.amount < 0 ? "text-expense" : "text-income",
                              )}
                            >
                              {entry.amount < 0 && "−"}
                              {CURRENCY_SYMBOLS[entry.currency]}
                              {Math.abs(entry.amount).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                            {entry.currency !== currency && (
                              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                                ({entry.amount < 0 && "−"}
                                {format(Math.abs(entry.amount), entry.currency)})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {entry.derived ? (
                              <span className="text-[10px] font-mono text-muted-foreground/60">
                                from log
                              </span>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                <IncomeDialog
                                  entry={entry}
                                  categoryTypes={manualCategoryTypes} categoryLabels={categoryLabels} onSave={handleSave}
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
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-border/40 px-4 py-3">
                    <p className="text-xs text-muted-foreground">
                      {filteredEntries.length} records · Page {page + 1} of {totalPages}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Tab 3: Trends & Insights                                        */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="trends" className="space-y-6 pt-4">
            <div className="finance-card p-6">
              <MonthlyTrendChart entries={allEntries} title="Monthly Income (12 months)" getLabel={getLabel} getColor={getColor} defaultChartType="bar" defaultBarColor={{ dark: "#2e8b57", light: "#2e7d5b" }} />
            </div>

            <div className="finance-card p-6">
              <PassiveVsActiveChart entries={allEntries} />
            </div>

            <div className="finance-card p-6">
              <CumulativePaceChart entries={allEntries} title="Cumulative Income" currentColor={{ dark: "#4ade80", light: "#2e8b57" }} />
            </div>

            <div className="finance-card p-6">
              <IncomeInsights entries={allEntries} />
            </div>

            <div className="finance-card p-6">
              <ComparisonView
                entries={allEntries}
                initialMonths={[lastMonth, currentMonth]}
                getLabel={getLabel}
                getColor={getColor}
                upIsGood
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
            <DialogTitle>Delete Income Entry</DialogTitle>
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
