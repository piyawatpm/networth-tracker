"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import { getLastNMonthKeys, monthKeyToLabel, getMonthKey } from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";

type DefaultChartType = "line" | "bar";

interface MonthlyTrendChartProps {
  entries: { date: string; amount: number; currency: string; type: string }[];
  title: string;
  getLabel: (type: string) => string;
  getColor: (type: string) => string;
  defaultChartType?: DefaultChartType;
  defaultBarColor?: { dark: string; light: string };
}

export function MonthlyTrendChart({
  entries,
  title,
  getLabel,
  getColor,
  defaultChartType = "line",
  defaultBarColor,
}: MonthlyTrendChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, symbol } = useCurrency();
  const [byCategory, setByCategory] = useState(false);

  const monthKeys = useMemo(() => getLastNMonthKeys(12), []);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);

    if (!byCategory) {
      const data = monthKeys.map((mk) =>
        Math.round(
          entries
            .filter((e) => getMonthKey(e.date) === mk)
            .reduce((sum, e) => sum + convert(e.amount, e.currency), 0) * 100,
        ) / 100,
      );

      if (defaultChartType === "bar") {
        return {
          ...base,
          xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys.map(monthKeyToLabel) },
          yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
          series: [{
            type: "bar" as const,
            data,
            itemStyle: {
              color: isDark ? (defaultBarColor?.dark ?? "#2e8b57") : (defaultBarColor?.light ?? "#2e7d5b"),
              borderRadius: [4, 4, 0, 0],
            },
            barMaxWidth: 32,
          }],
        };
      }

      return {
        ...base,
        xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys.map(monthKeyToLabel) },
        yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
        series: [{
          type: "line" as const,
          data,
          smooth: true,
          areaStyle: { opacity: 0.15 },
          lineStyle: { width: 2 },
        }],
      };
    }

    // Stacked bar by category (top 5 + other)
    const categoryTotals: Record<string, number> = {};
    for (const e of entries) {
      categoryTotals[e.type] = (categoryTotals[e.type] ?? 0) + convert(e.amount, e.currency);
    }
    const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5).map(([t]) => t);
    const hasOther = sorted.length > 5;

    const series = top5.map((t, idx) => ({
      name: getLabel(t),
      type: "bar" as const,
      stack: "total",
      barMaxWidth: 28,
      itemStyle: { color: getColor(t), borderRadius: idx === top5.length - 1 && !hasOther ? [4, 4, 0, 0] : [0, 0, 0, 0] },
      data: monthKeys.map((mk) =>
        Math.round(
          entries
            .filter((e) => getMonthKey(e.date) === mk && e.type === t)
            .reduce((sum, e) => sum + convert(e.amount, e.currency), 0) * 100,
        ) / 100,
      ),
    }));

    if (hasOther) {
      const otherTypes = new Set(sorted.slice(5).map(([t]) => t));
      series.push({
        name: "Other",
        type: "bar" as const,
        stack: "total",
        barMaxWidth: 28,
        itemStyle: { color: "#708090", borderRadius: [4, 4, 0, 0] },
        data: monthKeys.map((mk) =>
          Math.round(
            entries
              .filter((e) => getMonthKey(e.date) === mk && otherTypes.has(e.type))
              .reduce((sum, e) => sum + convert(e.amount, e.currency), 0) * 100,
          ) / 100,
        ),
      });
    }

    return {
      ...base,
      xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys.map(monthKeyToLabel) },
      yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
      legend: { show: true, bottom: 0, textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 } },
      grid: { ...base.grid, bottom: 48 },
      series,
    };
  }, [entries, convert, isDark, monthKeys, byCategory, getLabel, getColor, defaultChartType, defaultBarColor]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="label-mono">{title}</p>
        <button
          onClick={() => setByCategory((v) => !v)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            byCategory
              ? "bg-foreground text-background"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
        >
          By Category
        </button>
      </div>
      <ReactECharts key={byCategory ? "stacked" : "single"} option={option} style={{ height: "280px" }} />
    </div>
  );
}
