"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ExpenseEntry } from "@/lib/utils/types";
import { EXPENSE_TYPE_LABELS } from "@/lib/utils/constants";
import { getLastNMonthKeys, getMonthKey, monthKeyToLabel } from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Activity, BarChart3, Store } from "lucide-react";

// Fixed = predictable recurring costs. Variable = discretionary.
const FIXED_TYPES = new Set(["rent", "utilities", "insurance", "subscriptions", "health", "education"]);

interface ExpenseInsightsProps {
  entries: ExpenseEntry[];
  getLabel: (type: string) => string;
  getColor: (type: string) => string;
}

export function ExpenseInsights({ entries, getLabel, getColor }: ExpenseInsightsProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, format, symbol } = useCurrency();

  const monthKeys = useMemo(() => getLastNMonthKeys(6), []);

  // ── Monthly totals ──
  const monthlyTotals = useMemo(() =>
    monthKeys.map((mk) =>
      entries
        .filter((e) => getMonthKey(e.date) === mk)
        .reduce((s, e) => s + convert(e.amount, e.currency), 0),
    ),
  [entries, convert, monthKeys]);

  const monthsWithData = monthlyTotals.filter((v) => v > 0).length;
  const avgMonthly = monthsWithData > 0 ? monthlyTotals.reduce((s, v) => s + v, 0) / monthsWithData : 0;
  const avg3m = monthlyTotals.slice(-3).filter((v) => v > 0).length > 0
    ? monthlyTotals.slice(-3).reduce((s, v) => s + v, 0) / Math.max(1, monthlyTotals.slice(-3).filter((v) => v > 0).length)
    : 0;

  // Stability score
  const nonZero = monthlyTotals.filter((v) => v > 0);
  const mean = nonZero.length > 0 ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0;
  const variance = nonZero.length > 1 ? nonZero.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (nonZero.length - 1) : 0;
  const cv = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0;
  const stabilityScore = Math.max(0, Math.min(100, 100 - cv));
  const stabilityLabel = stabilityScore >= 80 ? "Predictable" : stabilityScore >= 60 ? "Stable" : stabilityScore >= 40 ? "Moderate" : "Volatile";

  // ── Fixed vs Variable (12 months) ──
  const monthKeys12 = useMemo(() => getLastNMonthKeys(12), []);

  const fixedVsVariable = useMemo(() => {
    return monthKeys12.map((mk) => {
      const monthEntries = entries.filter((e) => getMonthKey(e.date) === mk);
      let fixed = 0;
      let variable = 0;
      for (const e of monthEntries) {
        const v = convert(e.amount, e.currency);
        if (FIXED_TYPES.has(e.type)) fixed += v;
        else variable += v;
      }
      return { fixed: Math.round(fixed * 100) / 100, variable: Math.round(variable * 100) / 100 };
    });
  }, [entries, convert, monthKeys12]);

  const totalFixed = fixedVsVariable.reduce((s, d) => s + d.fixed, 0);
  const totalVariable = fixedVsVariable.reduce((s, d) => s + d.variable, 0);
  const totalAll = totalFixed + totalVariable;
  const fixedPct = totalAll > 0 ? (totalFixed / totalAll) * 100 : 0;

  const fvChartOption = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    return {
      ...base,
      xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys12.map(monthKeyToLabel) },
      yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
      legend: { show: true, bottom: 0, textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 } },
      grid: { ...base.grid, bottom: 40 },
      series: [
        {
          name: "Fixed",
          type: "bar" as const,
          stack: "total",
          data: fixedVsVariable.map((d) => d.fixed),
          barMaxWidth: 24,
          itemStyle: { color: isDark ? "#708090" : "#5f6b80" },
        },
        {
          name: "Variable",
          type: "bar" as const,
          stack: "total",
          data: fixedVsVariable.map((d) => d.variable),
          barMaxWidth: 24,
          itemStyle: { color: isDark ? "#e09770" : "#c95f3f", borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }, [fixedVsVariable, isDark, monthKeys12, symbol]);

  // ── Top Vendors ──
  const topVendors = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    for (const e of entries) {
      const vendor = (e.vendor ?? "").trim();
      if (!vendor) continue;
      if (!map[vendor]) map[vendor] = { total: 0, count: 0 };
      map[vendor].total += convert(e.amount, e.currency);
      map[vendor].count += 1;
    }
    return Object.entries(map)
      .map(([vendor, data]) => ({ vendor, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [entries, convert]);

  const maxVendorTotal = topVendors.length > 0 ? topVendors[0].total : 1;

  // ── Per-category sparklines ──
  const categoryGrowth = useMemo(() => {
    const sources: Record<string, number[]> = {};
    for (const mk of monthKeys) {
      const monthEntries = entries.filter((e) => getMonthKey(e.date) === mk);
      const byType: Record<string, number> = {};
      for (const e of monthEntries) {
        byType[e.type] = (byType[e.type] ?? 0) + convert(e.amount, e.currency);
      }
      for (const t of Object.keys(byType)) {
        if (!sources[t]) sources[t] = Array(monthKeys.indexOf(mk)).fill(0);
      }
      for (const t of Object.keys(sources)) {
        sources[t].push(byType[t] ?? 0);
      }
    }
    for (const t of Object.keys(sources)) {
      while (sources[t].length < monthKeys.length) sources[t].push(0);
    }
    return Object.entries(sources)
      .map(([type, values]) => {
        const total = values.reduce((s, v) => s + v, 0);
        const recent = values.slice(-3).reduce((s, v) => s + v, 0);
        const prior = values.slice(0, 3).reduce((s, v) => s + v, 0);
        const growth = prior > 0 ? ((recent - prior) / prior) * 100 : recent > 0 ? 100 : 0;
        return { type, label: getLabel(type), total, values, growth };
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [entries, convert, monthKeys, getLabel]);

  return (
    <div className="space-y-6">
      {/* ── Stats row ── */}
      <div className="finance-card p-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-secondary/30 p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Avg Monthly</p>
            <p className="text-sm font-bold tabular-nums">{format(avgMonthly)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">6-month avg</p>
          </div>
          <div className="rounded-lg bg-secondary/30 p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">3-Month Avg</p>
            <p className="text-sm font-bold tabular-nums">{format(avg3m)}</p>
            <p className={cn("text-[10px] mt-0.5", avg3m <= avgMonthly ? "text-income" : "text-expense")}>
              {avg3m <= avgMonthly ? "Below" : "Above"} 6mo avg
            </p>
          </div>
          <div className="rounded-lg bg-secondary/30 p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Stability</p>
            </div>
            <p className={cn("text-sm font-bold tabular-nums", stabilityScore >= 60 ? "text-income" : stabilityScore >= 40 ? "text-foreground" : "text-expense")}>
              {Math.round(stabilityScore)}%
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{stabilityLabel}</p>
          </div>
        </div>
      </div>

      {/* ── Fixed vs Variable ── */}
      <div className="finance-card p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="label-mono">Fixed vs Variable Spending</p>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isDark ? "#708090" : "#5f6b80" }} />
              Fixed {format(totalFixed)} ({fixedPct.toFixed(0)}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isDark ? "#e09770" : "#c95f3f" }} />
              Variable {format(totalVariable)} ({(100 - fixedPct).toFixed(0)}%)
            </span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">
          Fixed: rent, utilities, insurance, subscriptions, health, education. Variable: everything else.
        </p>
        <ReactECharts option={fvChartOption} style={{ height: "220px" }} />
      </div>

      {/* ── Top Vendors ── */}
      <div className="finance-card p-5">
        <div className="flex items-center gap-1.5 mb-4">
          <Store className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="label-mono">Top Vendors</p>
        </div>
        {topVendors.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No vendor data — add vendors to your expenses</p>
        ) : (
          <div className="space-y-2">
            {topVendors.map((v) => (
              <div key={v.vendor} className="flex items-center gap-3">
                <span className="text-xs w-28 truncate font-medium">{v.vendor}</span>
                <div className="flex-1 h-2 rounded-full bg-secondary/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-expense/60 transition-all"
                    style={{ width: `${(v.total / maxVendorTotal) * 100}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] tabular-nums w-20 text-right shrink-0">
                  {format(v.total)}
                </span>
                <span className="text-[10px] text-muted-foreground w-12 text-right shrink-0">
                  {v.count}x
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Category Sparklines ── */}
      <div className="finance-card p-5">
        <div className="flex items-center gap-1.5 mb-4">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="label-mono">Category Trends (6-month)</p>
        </div>
        <div className="space-y-2">
          {categoryGrowth.slice(0, 8).map((cat) => {
            const max = Math.max(...cat.values, 1);
            return (
              <div key={cat.type} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 w-24 shrink-0">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: getColor(cat.type) }} />
                  <span className="text-xs truncate text-muted-foreground">{cat.label}</span>
                </div>
                <div className="flex items-end gap-px h-5 flex-1">
                  {cat.values.map((v, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm transition-all min-h-[1px]"
                      style={{ height: `${(v / max) * 100}%`, backgroundColor: getColor(cat.type) + "80" }}
                    />
                  ))}
                </div>
                <span className="font-mono text-[11px] tabular-nums w-16 text-right shrink-0">
                  {format(cat.total)}
                </span>
                <span className={cn(
                  "font-mono text-[10px] tabular-nums w-14 text-right shrink-0 flex items-center justify-end gap-0.5",
                  cat.growth > 5 ? "text-expense" : cat.growth < -5 ? "text-income" : "text-muted-foreground",
                )}>
                  {cat.growth > 5 ? <TrendingUp className="h-2.5 w-2.5" /> : cat.growth < -5 ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                  {Math.abs(cat.growth).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
