"use client";

import ReactECharts from "echarts-for-react";
import { InteractiveDonut } from "@/components/ui/interactive-donut";
import { BlurFade } from "@/components/ui/blur-fade";
import { formatAxisValue } from "@/lib/utils/echarts";

// ---------------------------------------------------------------------------
// Hardcoded hex colors for ECharts (canvas can't use oklch/CSS vars)
// ---------------------------------------------------------------------------

const CC = {
  income: "#2e8b57",
  expense: "#cd5c5c",
  text: "#968360",
  border: "#c9c3a8",
  fg: "#2c251e",
  tooltipBg: "#f4f3ed",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BarDatum {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

interface AllocationDatum {
  name: string;
  value: number;
  color: string;
}

export interface IncomeExpenseChartsProps {
  barData: BarDatum[];
  allocationData: AllocationDatum[];
  format: (amount: number) => string;
  delayBar: number;
  delayDonut: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IncomeExpenseCharts({
  barData,
  allocationData,
  format,
  delayBar,
  delayDonut,
}: IncomeExpenseChartsProps) {
  const incExpBarOption = {
    backgroundColor: "transparent",
    grid: { top: 12, right: 8, bottom: 28, left: 8, containLabel: true },
    xAxis: {
      type: "category" as const,
      data: barData.map((d) => d.month),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: CC.text, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: CC.text,
        fontSize: 11,
        formatter: (v: number) => formatAxisValue(v),
      },
      splitLine: {
        lineStyle: {
          color: CC.border,
          type: "dashed" as const,
          opacity: 0.5,
        },
      },
    },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: CC.tooltipBg,
      borderColor: CC.border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: CC.fg, fontSize: 12 },
      extraCssText:
        "border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);",
      valueFormatter: (v: number) => format(Math.round(v * 100) / 100),
    },
    series: [
      {
        name: "Income",
        type: "bar" as const,
        data: barData.map((d) => d.income),
        itemStyle: { color: CC.income, borderRadius: [6, 6, 0, 0] },
        barGap: "15%",
      },
      {
        name: "Expenses",
        type: "bar" as const,
        data: barData.map((d) => d.expenses),
        itemStyle: { color: CC.expense, borderRadius: [6, 6, 0, 0] },
      },
    ],
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
      <BlurFade delay={delayBar} className="md:col-span-7">
        <div className="finance-card p-6 h-full">
          <p className="label-mono mb-4">Income vs Expenses (6 months)</p>
          <ReactECharts
            option={incExpBarOption}
            style={{ height: "100%", width: "100%" }}
          />
        </div>
      </BlurFade>

      <BlurFade delay={delayDonut} className="md:col-span-5">
        <InteractiveDonut
          title="Asset Allocation"
          data={allocationData.map((d) => ({
            name: d.name,
            value: d.value,
            color: d.color,
          }))}
          format={format}
        />
      </BlurFade>
    </div>
  );
}
