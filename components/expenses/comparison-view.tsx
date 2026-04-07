"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
// Using generic ComparisonEntry interface instead of ExpenseEntry
import {
  getMonthKey,
  getMonthKeysFromEntries,
  monthKeyToFullLabel,
} from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

// Distinct series colors that work in both themes
const SERIES_COLORS = [
  { light: "#c95f3f", dark: "#e09770" },
  { light: "#4d7cc7", dark: "#4da8b8" },
  { light: "#2e8b57", dark: "#5ec48e" },
  { light: "#d4a033", dark: "#e8bd60" },
  { light: "#9e5e8e", dark: "#c48eb8" },
  { light: "#708090", dark: "#98a8b8" },
];

interface ComparisonEntry {
  date: string;
  type: string;
  amount: number;
  currency: string;
}

interface ComparisonViewProps {
  entries: ComparisonEntry[];
  initialMonths: string[];
  getLabel: (type: string) => string;
  getColor: (type: string) => string;
  /** For income: up is good (green). For expenses: up is bad (red). Default: expenses */
  upIsGood?: boolean;
}

type ChartMode = "bar" | "radar";

export function ComparisonView({
  entries,
  initialMonths,
  getLabel,
  getColor,
  upIsGood = false,
}: ComparisonViewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, format: formatCur, symbol } = useCurrency();

  const availableMonths = useMemo(() => getMonthKeysFromEntries(entries), [entries]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>(initialMonths);
  const [chartMode, setChartMode] = useState<ChartMode>("bar");

  function toggleMonth(mk: string) {
    setSelectedMonths((prev) => {
      if (prev.includes(mk)) {
        if (prev.length <= 1) return prev; // keep at least 1
        return prev.filter((m) => m !== mk);
      }
      if (prev.length >= 6) return prev; // max 6
      return [...prev, mk].sort((a, b) => a.localeCompare(b));
    });
  }

  // Per-month totals + per-category breakdown
  const { monthTotals, categories, categoryMonthData } = useMemo(() => {
    const totals: Record<string, number> = {};
    const catMap: Record<string, Record<string, number>> = {};

    for (const mk of selectedMonths) {
      totals[mk] = 0;
      const monthEntries = entries.filter((e) => getMonthKey(e.date) === mk);
      for (const e of monthEntries) {
        const v = convert(e.amount, e.currency);
        totals[mk] += v;
        catMap[e.type] = catMap[e.type] ?? {};
        catMap[e.type][mk] = (catMap[e.type][mk] ?? 0) + v;
      }
    }

    // Sort categories by max value across all months
    const cats = Object.keys(catMap)
      .map((type) => ({
        type,
        maxVal: Math.max(...selectedMonths.map((mk) => catMap[type][mk] ?? 0)),
      }))
      .sort((a, b) => b.maxVal - a.maxVal)
      .slice(0, 10)
      .map((c) => c.type);

    return { monthTotals: totals, categories: cats, categoryMonthData: catMap };
  }, [entries, selectedMonths, convert]);

  // Bar chart option
  const barOption = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    const catLabels = categories.map((t) => getLabel(t));

    return {
      ...base,
      grid: { ...base.grid, left: 80, bottom: 40 },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: catLabels,
        axisLabel: { ...base.xAxis.axisLabel, rotate: categories.length > 5 ? 30 : 0 },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) },
      },
      legend: {
        show: true,
        bottom: 0,
        textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 },
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis" as const,
      },
      series: selectedMonths.map((mk, i) => ({
        name: monthKeyToFullLabel(mk),
        type: "bar" as const,
        data: categories.map((t) => Math.round((categoryMonthData[t]?.[mk] ?? 0) * 100) / 100),
        barGap: "10%",
        itemStyle: {
          color: SERIES_COLORS[i % SERIES_COLORS.length][isDark ? "dark" : "light"],
          borderRadius: [3, 3, 0, 0],
        },
      })),
    };
  }, [categories, categoryMonthData, selectedMonths, isDark, getLabel]);

  // Radar chart option
  const radarOption = useMemo(() => {
    const c = isDark
      ? { text: "#888", border: "#454545", fg: "#f6f6f6", tooltipBg: "#2a2a2a" }
      : { text: "#968360", border: "#c9c3a8", fg: "#2c251e", tooltipBg: "#f4f3ed" };

    // Find max value per category for radar scale
    const maxVals = categories.map((t) =>
      Math.max(...selectedMonths.map((mk) => categoryMonthData[t]?.[mk] ?? 0), 1),
    );

    const indicator = categories.map((t, i) => ({
      name: getLabel(t),
      max: maxVals[i] * 1.2,
    }));

    return {
      backgroundColor: "transparent",
      tooltip: {
        backgroundColor: c.tooltipBg,
        borderColor: c.border,
        borderWidth: 1,
        textStyle: { color: c.fg, fontSize: 12 },
        padding: [8, 12],
        extraCssText: "border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);",
      },
      legend: {
        show: true,
        bottom: 0,
        textStyle: { color: c.text, fontSize: 10 },
      },
      radar: {
        indicator,
        shape: "polygon" as const,
        splitNumber: 4,
        axisName: { color: c.text, fontSize: 10 },
        splitLine: { lineStyle: { color: c.border, opacity: 0.5 } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: c.border, opacity: 0.3 } },
      },
      series: [
        {
          type: "radar" as const,
          data: selectedMonths.map((mk, i) => ({
            name: monthKeyToFullLabel(mk),
            value: categories.map((t) => Math.round((categoryMonthData[t]?.[mk] ?? 0) * 100) / 100),
            lineStyle: {
              width: 2,
              color: SERIES_COLORS[i % SERIES_COLORS.length][isDark ? "dark" : "light"],
            },
            itemStyle: {
              color: SERIES_COLORS[i % SERIES_COLORS.length][isDark ? "dark" : "light"],
            },
            areaStyle: {
              color: SERIES_COLORS[i % SERIES_COLORS.length][isDark ? "dark" : "light"],
              opacity: 0.1,
            },
          })),
        },
      ],
    };
  }, [categories, categoryMonthData, selectedMonths, isDark, getLabel]);

  // First month is "baseline" for delta calculations
  const baseMonth = selectedMonths[0];
  const baseTotal = monthTotals[baseMonth] ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="label-mono">Compare Months</p>
        <div className="flex gap-1">
          {(["bar", "radar"] as ChartMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setChartMode(mode)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors capitalize",
                chartMode === mode
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Month selector chips */}
      <div className="flex flex-wrap gap-1.5">
        {availableMonths.map((mk) => {
          const isSelected = selectedMonths.includes(mk);
          return (
            <button
              key={mk}
              onClick={() => toggleMonth(mk)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                isSelected
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {monthKeyToFullLabel(mk)}
            </button>
          );
        })}
      </div>

      {/* Summary cards */}
      <div className={cn("grid gap-2", selectedMonths.length <= 3 ? `grid-cols-${selectedMonths.length}` : "grid-cols-2 sm:grid-cols-3")}>
        {selectedMonths.map((mk, i) => {
          const total = monthTotals[mk] ?? 0;
          const pct = i > 0 && baseTotal > 0 ? ((total - baseTotal) / baseTotal) * 100 : null;
          return (
            <div key={mk} className="finance-card p-3 text-center">
              <p className="label-mono mb-1">{monthKeyToFullLabel(mk)}</p>
              <p className="text-lg font-semibold tabular-nums">{formatCur(total)}</p>
              {pct !== null && (
                <span className={cn(
                  "inline-flex items-center gap-0.5 text-xs mt-1",
                  pct > 0 ? (upIsGood ? "text-income" : "text-expense") : pct < 0 ? (upIsGood ? "text-expense" : "text-income") : "text-muted-foreground",
                )}>
                  {pct > 0 ? <ArrowUpRight className="h-3 w-3" /> : pct < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  {Math.abs(pct).toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Chart */}
      {categories.length > 0 && (
        <ReactECharts
          key={`${chartMode}-${selectedMonths.join(",")}`}
          option={chartMode === "bar" ? barOption : radarOption}
          style={{ height: chartMode === "radar" ? "340px" : "280px" }}
        />
      )}

      {/* Per-category delta table (vs first selected month) */}
      {categories.length > 0 && selectedMonths.length >= 2 && (
        <div className="space-y-1">
          <p className="label-mono mb-2">
            Category Changes vs {monthKeyToFullLabel(baseMonth)}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-1.5 font-medium text-muted-foreground">Category</th>
                  {selectedMonths.map((mk) => (
                    <th key={mk} className="text-right py-1.5 font-medium text-muted-foreground px-2">
                      {monthKeyToFullLabel(mk)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((t) => {
                  const baseVal = categoryMonthData[t]?.[baseMonth] ?? 0;
                  return (
                    <tr key={t} className="border-b border-border/30 last:border-0">
                      <td className="py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getColor(t) }} />
                          {getLabel(t)}
                        </span>
                      </td>
                      {selectedMonths.map((mk, i) => {
                        const val = categoryMonthData[t]?.[mk] ?? 0;
                        const delta = i > 0 && baseVal > 0 ? ((val - baseVal) / baseVal) * 100 : null;
                        return (
                          <td key={mk} className="text-right py-1.5 tabular-nums px-2">
                            <span>{formatCur(val)}</span>
                            {delta !== null && (
                              <span className={cn(
                                "ml-1.5",
                                delta > 0 ? (upIsGood ? "text-income" : "text-expense") : delta < 0 ? (upIsGood ? "text-expense" : "text-income") : "text-muted-foreground",
                              )}>
                                {delta > 0 ? "↑" : delta < 0 ? "↓" : "—"}{Math.abs(delta).toFixed(0)}%
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
