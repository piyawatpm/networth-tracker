"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ExpenseEntry, ExpenseType } from "@/lib/utils/types";
import {
  EXPENSE_TYPE_LABELS,
  EXPENSE_TYPE_COLORS,
} from "@/lib/utils/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getMonthKey,
  getMonthKeysFromEntries,
  monthKeyToFullLabel,
} from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface ComparisonViewProps {
  entries: ExpenseEntry[];
  monthA: string;
  monthB: string;
  onMonthAChange: (v: string) => void;
  onMonthBChange: (v: string) => void;
}

export function ComparisonView({
  entries,
  monthA,
  monthB,
  onMonthAChange,
  onMonthBChange,
}: ComparisonViewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, format: formatCur } = useCurrency();

  const monthKeys = useMemo(() => getMonthKeysFromEntries(entries), [entries]);

  const { totalA, totalB, categoryData } = useMemo(() => {
    const entriesA = entries.filter((e) => getMonthKey(e.date) === monthA);
    const entriesB = entries.filter((e) => getMonthKey(e.date) === monthB);

    const tA = entriesA.reduce((s, e) => s + convert(e.amount, e.currency), 0);
    const tB = entriesB.reduce((s, e) => s + convert(e.amount, e.currency), 0);

    const catMap: Record<string, { a: number; b: number }> = {};
    for (const e of entriesA) {
      catMap[e.type] = catMap[e.type] ?? { a: 0, b: 0 };
      catMap[e.type].a += convert(e.amount, e.currency);
    }
    for (const e of entriesB) {
      catMap[e.type] = catMap[e.type] ?? { a: 0, b: 0 };
      catMap[e.type].b += convert(e.amount, e.currency);
    }

    const data = Object.entries(catMap)
      .map(([type, { a, b }]) => ({ type: type as ExpenseType, a, b }))
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b))
      .slice(0, 8);

    return { totalA: tA, totalB: tB, categoryData: data };
  }, [entries, monthA, monthB, convert]);

  const chartOption = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    const categories = categoryData.map((d) => EXPENSE_TYPE_LABELS[d.type]);

    return {
      ...base,
      grid: { ...base.grid, left: 80, bottom: 32 },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: categories,
        axisLabel: { ...base.xAxis.axisLabel, rotate: 30 },
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
      series: [
        {
          name: monthKeyToFullLabel(monthA),
          type: "bar" as const,
          data: categoryData.map((d) => d.a),
          barGap: "10%",
          itemStyle: { color: isDark ? "#e09770" : "#c95f3f", borderRadius: [3, 3, 0, 0] },
        },
        {
          name: monthKeyToFullLabel(monthB),
          type: "bar" as const,
          data: categoryData.map((d) => d.b),
          itemStyle: { color: isDark ? "#4da8b8" : "#4d7cc7", borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [categoryData, monthA, monthB, isDark]);

  const pctChange = totalA > 0 ? ((totalB - totalA) / totalA) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="label-mono">Compare Months</p>
        <div className="flex items-center gap-2">
          <Select value={monthA} onValueChange={(v: string | null) => v && onMonthAChange(v)}>
            <SelectTrigger className="w-[120px]" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthKeys.map((mk) => (
                <SelectItem key={mk} value={mk}>{monthKeyToFullLabel(mk)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">vs</span>
          <Select value={monthB} onValueChange={(v: string | null) => v && onMonthBChange(v)}>
            <SelectTrigger className="w-[120px]" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthKeys.map((mk) => (
                <SelectItem key={mk} value={mk}>{monthKeyToFullLabel(mk)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="finance-card p-3 text-center">
          <p className="label-mono mb-1">{monthKeyToFullLabel(monthA)}</p>
          <p className="text-lg font-semibold tabular-nums">{formatCur(totalA)}</p>
        </div>
        <div className="finance-card p-3 text-center">
          <p className="label-mono mb-1">{monthKeyToFullLabel(monthB)}</p>
          <p className="text-lg font-semibold tabular-nums">{formatCur(totalB)}</p>
          {totalA > 0 && (
            <span className={`inline-flex items-center gap-0.5 text-xs mt-1 ${pctChange > 0 ? "text-expense" : pctChange < 0 ? "text-income" : "text-muted-foreground"}`}>
              {pctChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : pctChange < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {Math.abs(pctChange).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      {categoryData.length > 0 && (
        <ReactECharts option={chartOption} style={{ height: "280px" }} />
      )}

      {/* Per-category deltas */}
      {categoryData.length > 0 && (
        <div className="space-y-1.5">
          {categoryData.map((d) => {
            const delta = d.a > 0 ? ((d.b - d.a) / d.a) * 100 : 0;
            return (
              <div key={d.type} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EXPENSE_TYPE_COLORS[d.type] }} />
                  <span>{EXPENSE_TYPE_LABELS[d.type]}</span>
                </div>
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="text-muted-foreground">{formatCur(d.a)}</span>
                  <span>→</span>
                  <span>{formatCur(d.b)}</span>
                  {d.a > 0 && (
                    <span className={delta > 0 ? "text-expense" : delta < 0 ? "text-income" : "text-muted-foreground"}>
                      {delta > 0 ? "↑" : delta < 0 ? "↓" : "—"} {Math.abs(delta).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
