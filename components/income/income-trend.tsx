"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry } from "@/lib/utils/types";
import { getLastNMonthKeys, monthKeyToLabel, getMonthKey } from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";

interface IncomeTrendProps {
  entries: IncomeEntry[];
  getLabel: (type: string) => string;
  getColor: (type: string) => string;
}

export function IncomeTrend({ entries, getLabel, getColor }: IncomeTrendProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert } = useCurrency();
  const [byCategory, setByCategory] = useState(false);

  const monthKeys = useMemo(() => getLastNMonthKeys(12), []);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark);

    if (!byCategory) {
      const data = monthKeys.map((mk) =>
        entries
          .filter((e) => getMonthKey(e.date) === mk)
          .reduce((sum, e) => sum + convert(e.amount, e.currency), 0),
      );

      return {
        ...base,
        xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys.map(monthKeyToLabel) },
        yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
        series: [{
          type: "bar" as const,
          data,
          itemStyle: { color: isDark ? "#2e8b57" : "#2e7d5b", borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 32,
        }],
      };
    }

    const categoryTotals: Record<string, number> = {};
    for (const e of entries) {
      categoryTotals[e.type] = (categoryTotals[e.type] ?? 0) + convert(e.amount, e.currency);
    }
    const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5).map(([t]) => t);
    const hasOther = sorted.length > 5;

    const series = top5.map((t) => ({
      name: getLabel(t),
      type: "line" as const,
      stack: "total",
      areaStyle: { opacity: 0.3 },
      lineStyle: { width: 1.5 },
      itemStyle: { color: getColor(t) },
      data: monthKeys.map((mk) =>
        entries
          .filter((e) => getMonthKey(e.date) === mk && e.type === t)
          .reduce((sum, e) => sum + convert(e.amount, e.currency), 0),
      ),
    }));

    if (hasOther) {
      const otherTypes = new Set(sorted.slice(5).map(([t]) => t));
      series.push({
        name: "Other",
        type: "line" as const,
        stack: "total",
        areaStyle: { opacity: 0.2 },
        lineStyle: { width: 1 },
        itemStyle: { color: "#708090" },
        data: monthKeys.map((mk) =>
          entries
            .filter((e) => getMonthKey(e.date) === mk && otherTypes.has(e.type))
            .reduce((sum, e) => sum + convert(e.amount, e.currency), 0),
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
  }, [entries, convert, isDark, monthKeys, byCategory]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="label-mono">Monthly Income (12 months)</p>
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
      <ReactECharts option={option} style={{ height: "280px" }} />
    </div>
  );
}
