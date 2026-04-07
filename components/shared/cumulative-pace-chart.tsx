"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getMonthKey,
  getDaysInMonth,
  getSydneyDateString,
  monthKeyToFullLabel,
  getLastNMonthKeys,
} from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";

type PaceRange = "month" | "quarter" | "ytd" | "year";

interface CumulativePaceChartProps {
  entries: { date: string; amount: number; currency: string }[];
  title: string;
  currentColor: { dark: string; light: string };
  defaultRange?: PaceRange;
}

export function CumulativePaceChart({
  entries,
  title,
  currentColor,
  defaultRange = "ytd",
}: CumulativePaceChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, symbol } = useCurrency();
  const [range, setRange] = useState<PaceRange>(defaultRange);

  const today = getSydneyDateString();
  const currentYear = today.slice(0, 4);
  const currentMonth = getCurrentMonthKey();
  const lastMonth = getLastMonthKey();

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    const color = isDark ? currentColor.dark : currentColor.light;
    const prevColor = isDark ? "#666" : "#aaa";

    if (range === "month") {
      // This month vs last month (daily cumulative, day-of-month on x-axis)
      const daysInCurrent = getDaysInMonth(currentMonth);
      const daysInLast = getDaysInMonth(lastMonth);
      const maxDays = Math.max(daysInCurrent, daysInLast);

      function buildMonthCumulative(monthKey: string, maxDay: number) {
        const monthEntries = entries.filter((e) => getMonthKey(e.date) === monthKey);
        const daily: number[] = Array(maxDay).fill(0);
        for (const e of monthEntries) {
          const day = parseInt(e.date.split("-")[2], 10);
          if (day >= 1 && day <= maxDay) daily[day - 1] += convert(e.amount, e.currency);
        }
        const cum: number[] = [];
        let run = 0;
        for (let i = 0; i < maxDay; i++) { run += daily[i]; cum.push(Math.round(run * 100) / 100); }
        return cum;
      }

      return {
        ...base,
        xAxis: { ...base.xAxis, type: "category" as const, data: Array.from({ length: maxDays }, (_, i) => i + 1), axisLabel: { ...base.xAxis.axisLabel, interval: 4 } },
        yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
        legend: { show: true, bottom: 0, textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 } },
        grid: { ...base.grid, bottom: 40 },
        series: [
          { name: monthKeyToFullLabel(currentMonth), type: "line" as const, data: buildMonthCumulative(currentMonth, daysInCurrent), smooth: true, lineStyle: { width: 2.5 }, showSymbol: false, itemStyle: { color } },
          { name: monthKeyToFullLabel(lastMonth), type: "line" as const, data: buildMonthCumulative(lastMonth, daysInLast), smooth: true, lineStyle: { width: 1.5, type: "dashed" as const }, showSymbol: false, itemStyle: { color: prevColor } },
        ],
      };
    }

    // For quarter, ytd, year — monthly cumulative bars + cumulative line
    let monthKeys: string[];
    let prevMonthKeys: string[];
    let currentLabel: string;
    let prevLabel: string;

    if (range === "quarter") {
      // Last 3 months
      monthKeys = getLastNMonthKeys(3);
      // Previous 3 months
      const all6 = getLastNMonthKeys(6);
      prevMonthKeys = all6.slice(0, 3);
      currentLabel = "This Quarter";
      prevLabel = "Last Quarter";
    } else if (range === "ytd") {
      // All months this year
      const all12 = getLastNMonthKeys(12);
      monthKeys = all12.filter((mk) => mk.startsWith(currentYear));
      // Same months last year
      const lastYear = String(parseInt(currentYear) - 1);
      prevMonthKeys = monthKeys.map((mk) => lastYear + mk.slice(4));
      currentLabel = currentYear;
      prevLabel = lastYear;
    } else {
      // Full year (last 12 months)
      monthKeys = getLastNMonthKeys(12);
      // Previous 12 months
      prevMonthKeys = monthKeys.map((mk) => {
        const [y, m] = mk.split("-").map(Number);
        return `${y - 1}-${String(m).padStart(2, "0")}`;
      });
      currentLabel = "Last 12 mo";
      prevLabel = "Prior 12 mo";
    }

    const labels = monthKeys.map((mk) => mk.slice(5)); // "MM" or use short month

    function buildMonthlyCumulative(keys: string[]) {
      const cum: number[] = [];
      let run = 0;
      for (const mk of keys) {
        const monthTotal = entries
          .filter((e) => getMonthKey(e.date) === mk)
          .reduce((s, e) => s + convert(e.amount, e.currency), 0);
        run += monthTotal;
        cum.push(Math.round(run * 100) / 100);
      }
      return cum;
    }

    const currentData = buildMonthlyCumulative(monthKeys);
    const prevData = buildMonthlyCumulative(prevMonthKeys);

    // Monthly (non-cumulative) for bars
    const monthlyData = monthKeys.map((mk) =>
      Math.round(
        entries
          .filter((e) => getMonthKey(e.date) === mk)
          .reduce((s, e) => s + convert(e.amount, e.currency), 0) * 100,
      ) / 100,
    );

    const monthLabels = monthKeys.map((mk) => {
      const [, m] = mk.split("-");
      const d = new Date(2026, parseInt(m) - 1);
      return d.toLocaleDateString("en-AU", { month: "short" });
    });

    return {
      ...base,
      xAxis: { ...base.xAxis, type: "category" as const, data: monthLabels },
      yAxis: [
        { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
        { ...base.yAxis, type: "value" as const, show: false },
      ],
      legend: { show: true, bottom: 0, textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 } },
      grid: { ...base.grid, bottom: 40 },
      series: [
        {
          name: "Monthly",
          type: "bar" as const,
          yAxisIndex: 0,
          data: monthlyData,
          barMaxWidth: 24,
          itemStyle: { color: color, opacity: 0.3, borderRadius: [3, 3, 0, 0] },
        },
        {
          name: currentLabel,
          type: "line" as const,
          yAxisIndex: 1,
          data: currentData,
          smooth: true,
          lineStyle: { width: 2.5 },
          showSymbol: true,
          symbolSize: 6,
          itemStyle: { color },
        },
        {
          name: prevLabel,
          type: "line" as const,
          yAxisIndex: 1,
          data: prevData,
          smooth: true,
          lineStyle: { width: 1.5, type: "dashed" as const },
          showSymbol: false,
          itemStyle: { color: prevColor },
        },
      ],
    };
  }, [entries, convert, isDark, range, currentMonth, lastMonth, currentYear, currentColor]);

  const ranges: { key: PaceRange; label: string }[] = [
    { key: "month", label: "Month" },
    { key: "quarter", label: "Quarter" },
    { key: "ytd", label: "YTD" },
    { key: "year", label: "12M" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="label-mono">{title}</p>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                range === r.key
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <ReactECharts key={range} option={option} style={{ height: "240px" }} />
    </div>
  );
}
