"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry } from "@/lib/utils/types";
import { getLastNMonthKeys, monthKeyToLabel, getMonthKey } from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";

const PASSIVE_TYPES = new Set(["dividend", "crypto_yield", "interest", "rental"]);

interface PassiveVsActiveChartProps {
  entries: IncomeEntry[];
}

export function PassiveVsActiveChart({ entries }: PassiveVsActiveChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, symbol, format } = useCurrency();

  const monthKeys = useMemo(() => getLastNMonthKeys(12), []);

  const { activeColor, passiveColor } = {
    activeColor: isDark ? "#4ade80" : "#2e8b57",
    passiveColor: isDark ? "#d4a033" : "#b8860b",
  };

  const { monthlyData, totalActive, totalPassive } = useMemo(() => {
    let tActive = 0;
    let tPassive = 0;
    const data = monthKeys.map((mk) => {
      const monthEntries = entries.filter((e) => getMonthKey(e.date) === mk);
      let active = 0;
      let passive = 0;
      for (const e of monthEntries) {
        const v = convert(e.amount, e.currency);
        const isPassive = (e as IncomeEntry & { isPassive?: boolean }).isPassive === true
          || ((e as IncomeEntry & { isPassive?: boolean }).isPassive === undefined && PASSIVE_TYPES.has(e.type));
        if (isPassive) { passive += v; tPassive += v; }
        else { active += v; tActive += v; }
      }
      return {
        active: Math.round(active * 100) / 100,
        passive: Math.round(passive * 100) / 100,
      };
    });
    return { monthlyData: data, totalActive: tActive, totalPassive: tPassive };
  }, [entries, convert, monthKeys]);

  const total = totalActive + totalPassive;
  const passivePct = total > 0 ? (totalPassive / total) * 100 : 0;

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    return {
      ...base,
      xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys.map(monthKeyToLabel) },
      yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
      legend: { show: true, bottom: 0, textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 } },
      grid: { ...base.grid, bottom: 40 },
      series: [
        {
          name: "Active",
          type: "bar" as const,
          stack: "total",
          data: monthlyData.map((d) => d.active),
          barMaxWidth: 24,
          itemStyle: { color: activeColor, borderRadius: [0, 0, 0, 0] },
        },
        {
          name: "Passive",
          type: "bar" as const,
          stack: "total",
          data: monthlyData.map((d) => d.passive),
          barMaxWidth: 24,
          itemStyle: { color: passiveColor, borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }, [monthlyData, isDark, monthKeys, activeColor, passiveColor, symbol]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="label-mono">Passive vs Active Income</p>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activeColor }} />
            Active {format(totalActive)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: passiveColor }} />
            Passive {format(totalPassive)} ({passivePct.toFixed(0)}%)
          </span>
        </div>
      </div>
      <ReactECharts option={option} style={{ height: "240px" }} />
    </div>
  );
}
