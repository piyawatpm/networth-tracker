"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

type Range = "1W" | "1M" | "3M" | "All";

interface CryptoValueTrendProps {
  data: { date: string; value: number }[];
  isDark: boolean;
  symbol: string;
  format: (amount: number, from?: string, compact?: boolean) => string;
}

export function CryptoValueTrend({ data, isDark, symbol, format }: CryptoValueTrendProps) {
  const [range, setRange] = useState<Range>("All");

  const filteredData = useMemo(() => {
    if (range === "All" || data.length === 0) return data;
    const days = range === "1W" ? 7 : range === "1M" ? 30 : 90;
    return data.slice(-days);
  }, [data, range]);

  const stats = useMemo(() => {
    if (filteredData.length < 2) return null;
    const first = filteredData[0].value;
    const last = filteredData[filteredData.length - 1].value;
    const change = last - first;
    const changePct = first > 0 ? (change / first) * 100 : 0;
    return { change, changePct };
  }, [filteredData]);

  const isPositive = (stats?.change ?? 0) >= 0;
  const lineColor = isPositive ? (isDark ? "#4ade80" : "#2e8b57") : (isDark ? "#f87171" : "#c95f3f");

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    return {
      ...base,
      grid: { top: 12, right: 12, bottom: 28, left: 50, containLabel: false },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: filteredData.map((d) => d.date),
        boundaryGap: false,
        axisLabel: {
          ...base.xAxis.axisLabel,
          interval: Math.max(0, Math.floor(filteredData.length / 5) - 1),
        },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) },
        min: (value: { min: number }) => Math.floor(value.min * 0.95),
      },
      series: [{
        type: "line" as const,
        data: filteredData.map((d) => d.value),
        smooth: 0.3,
        showSymbol: filteredData.length <= 14,
        symbolSize: 4,
        lineStyle: { color: lineColor, width: 2.5 },
        itemStyle: { color: lineColor },
        areaStyle: {
          color: {
            type: "linear" as const,
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: lineColor + "20" },
              { offset: 1, color: lineColor + "00" },
            ],
          },
        },
      }],
    };
  }, [filteredData, isDark, lineColor, symbol]);

  const ranges: { key: Range; label: string }[] = [
    { key: "1W", label: "1W" },
    { key: "1M", label: "1M" },
    { key: "3M", label: "3M" },
    { key: "All", label: "All" },
  ];

  return (
    <BlurFade delay={0.05}>
      <div className="finance-card p-5">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="label-mono">Value Trend</p>
            {stats && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className={cn(
                  "flex items-center gap-0.5 text-xs font-semibold tabular-nums",
                  isPositive ? "text-income" : "text-expense",
                )}>
                  {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {isPositive ? "+" : ""}{format(stats.change, undefined, true)}
                </span>
                <span className={cn(
                  "text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded",
                  isPositive ? "bg-income/10 text-income" : "bg-expense/10 text-expense",
                )}>
                  {isPositive ? "+" : ""}{stats.changePct.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
          {data.length > 7 && (
            <div className="flex gap-0.5 rounded-lg bg-secondary/50 p-0.5">
              {ranges.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-mono font-medium rounded-md transition-colors",
                    range === r.key
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {filteredData.length > 1 ? (
          <ReactECharts option={option} style={{ height: 180, width: "100%" }} />
        ) : (
          <div className="flex h-44 items-center justify-center">
            <p className="text-sm text-muted-foreground/50">
              {data.length === 1 ? "Come back tomorrow for trend data" : "Trend will appear as snapshots accumulate"}
            </p>
          </div>
        )}
      </div>
    </BlurFade>
  );
}
