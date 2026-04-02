"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getMonthKey,
  getDaysInMonth,
  monthKeyToFullLabel,
} from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";

interface CumulativePaceChartProps {
  entries: { date: string; amount: number; currency: string }[];
  title: string;
  currentColor: { dark: string; light: string };
}

export function CumulativePaceChart({
  entries,
  title,
  currentColor,
}: CumulativePaceChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert } = useCurrency();

  const currentMonth = getCurrentMonthKey();
  const lastMonth = getLastMonthKey();

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    const daysInCurrent = getDaysInMonth(currentMonth);
    const daysInLast = getDaysInMonth(lastMonth);
    const maxDays = Math.max(daysInCurrent, daysInLast);

    function buildCumulative(monthKey: string, maxDay: number): (number | null)[] {
      const monthEntries = entries.filter((e) => getMonthKey(e.date) === monthKey);
      const dailyTotals: number[] = Array(maxDay).fill(0);

      for (const e of monthEntries) {
        const day = parseInt(e.date.split("-")[2], 10);
        if (day >= 1 && day <= maxDay) {
          dailyTotals[day - 1] += convert(e.amount, e.currency);
        }
      }

      const cumulative: (number | null)[] = [];
      let running = 0;
      for (let i = 0; i < maxDay; i++) {
        running += dailyTotals[i];
        cumulative.push(Math.round(running * 100) / 100);
      }
      return cumulative;
    }

    const currentData = buildCumulative(currentMonth, daysInCurrent);
    const lastData = buildCumulative(lastMonth, daysInLast);
    const days = Array.from({ length: maxDays }, (_, i) => i + 1);

    return {
      ...base,
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: days,
        axisLabel: { ...base.xAxis.axisLabel, interval: 4 },
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
      grid: { ...base.grid, bottom: 40 },
      series: [
        {
          name: monthKeyToFullLabel(currentMonth),
          type: "line" as const,
          data: currentData,
          smooth: true,
          lineStyle: { width: 2.5 },
          showSymbol: false,
          itemStyle: { color: isDark ? currentColor.dark : currentColor.light },
        },
        {
          name: monthKeyToFullLabel(lastMonth),
          type: "line" as const,
          data: lastData,
          smooth: true,
          lineStyle: { width: 1.5, type: "dashed" as const },
          showSymbol: false,
          itemStyle: { color: isDark ? "#666" : "#aaa" },
        },
      ],
    };
  }, [entries, convert, isDark, currentMonth, lastMonth, currentColor]);

  return (
    <div className="space-y-3">
      <p className="label-mono">{title}</p>
      <ReactECharts option={option} style={{ height: "240px" }} />
    </div>
  );
}
