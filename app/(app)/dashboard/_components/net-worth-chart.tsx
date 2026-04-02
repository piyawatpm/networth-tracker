"use client";

import ReactECharts from "echarts-for-react";
import { BlurFade } from "@/components/ui/blur-fade";
import { formatAxisValue } from "@/lib/utils/echarts";

// ---------------------------------------------------------------------------
// Hardcoded hex colors for ECharts (canvas can't use oklch/CSS vars)
// ---------------------------------------------------------------------------

const CC = {
  accent: "#c95f3f",
  text: "#968360",
  border: "#c9c3a8",
  fg: "#2c251e",
  tooltipBg: "#f4f3ed",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetWorthChartProps {
  nwTrendData: { date: string; value: number }[];
  delay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NetWorthChart({ nwTrendData, delay }: NetWorthChartProps) {
  const nwTrendOption = {
    backgroundColor: "transparent",
    grid: { top: 12, right: 8, bottom: 28, left: 50, containLabel: false },
    xAxis: {
      type: "category" as const,
      data: nwTrendData.map((d) => d.date),
      boundaryGap: false,
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
      formatter: "{b}: {c}",
    },
    series: [
      {
        type: "line" as const,
        data: nwTrendData.map((d) => d.value),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: CC.accent, width: 2 },
        itemStyle: { color: CC.accent },
        areaStyle: {
          color: {
            type: "linear" as const,
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: CC.accent + "33" },
              { offset: 1, color: CC.accent + "00" },
            ],
          },
        },
      },
    ],
  };

  return (
    <BlurFade delay={delay} className="md:col-span-7">
      <div className="finance-card p-5">
        <p className="label-mono mb-3">Net Worth Trend</p>
        {nwTrendData.length > 1 ? (
          <ReactECharts
            option={nwTrendOption}
            style={{ height: 144, width: "100%" }}
          />
        ) : (
          <div className="flex h-36 items-center justify-center">
            <p className="text-sm text-muted-foreground/50">
              {nwTrendData.length === 1
                ? "Come back tomorrow for trend data"
                : "Trend will appear as data accumulates"}
            </p>
          </div>
        )}
      </div>
    </BlurFade>
  );
}
