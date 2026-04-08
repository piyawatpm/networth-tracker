"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { BlurFade } from "@/components/ui/blur-fade";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/components/providers/currency-provider";
import { TrendingUp, TrendingDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Range = "7d" | "30d" | "90d" | "all";

export interface NetWorthChartProps {
  nwTrendData: { date: string; value: number; portfolio?: number; crypto?: number }[];
  format: (amount: number, from?: string, compact?: boolean) => string;
  includeSuper?: boolean;
  delay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NetWorthChart({ nwTrendData, format, includeSuper = true, delay }: NetWorthChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { symbol } = useCurrency();
  const [range, setRange] = useState<Range>("all");
  const [showBreakdown, setShowBreakdown] = useState(false);

  const ranges: { key: Range; label: string }[] = [
    { key: "7d", label: "1W" },
    { key: "30d", label: "1M" },
    { key: "90d", label: "3M" },
    { key: "all", label: "All" },
  ];

  // Filter data by range
  const filteredData = useMemo(() => {
    if (range === "all" || nwTrendData.length === 0) return nwTrendData;
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    return nwTrendData.slice(-days);
  }, [nwTrendData, range]);

  // Calculate change stats
  const stats = useMemo(() => {
    if (filteredData.length < 2) return null;
    const first = filteredData[0].value;
    const last = filteredData[filteredData.length - 1].value;
    const change = last - first;
    const changePct = first > 0 ? (change / first) * 100 : 0;
    const high = Math.max(...filteredData.map((d) => d.value));
    const low = Math.min(...filteredData.map((d) => d.value));
    return { first, last, change, changePct, high, low };
  }, [filteredData]);

  const isPositive = (stats?.change ?? 0) >= 0;

  // Chart colors
  const lineColor = isPositive
    ? (isDark ? "#4ade80" : "#2e8b57")
    : (isDark ? "#f87171" : "#c95f3f");

  // Check if we have breakdown data
  const hasBreakdownData = filteredData.some((d) => d.portfolio != null || d.crypto != null);

  const portfolioColor = isDark ? "#4d7cc7" : "#2e5ea5";
  const cryptoColor = isDark ? "#d4a033" : "#b8860b";

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);

    const series: Record<string, unknown>[] = [
      {
        name: "Net Worth",
        type: "line" as const,
        data: filteredData.map((d) => d.value),
        smooth: 0.3,
        showSymbol: filteredData.length <= 14,
        symbolSize: 4,
        lineStyle: { color: lineColor, width: 2.5 },
        itemStyle: { color: lineColor, borderWidth: 0 },
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
      },
    ];

    if (showBreakdown && hasBreakdownData) {
      series.push(
        {
          name: "Portfolio",
          type: "line" as const,
          data: filteredData.map((d) => d.portfolio ?? null),
          smooth: 0.3,
          showSymbol: false,
          lineStyle: { color: portfolioColor, width: 1.5, type: "dashed" as const },
          itemStyle: { color: portfolioColor },
        },
        {
          name: "Crypto",
          type: "line" as const,
          data: filteredData.map((d) => d.crypto ?? null),
          smooth: 0.3,
          showSymbol: false,
          lineStyle: { color: cryptoColor, width: 1.5, type: "dashed" as const },
          itemStyle: { color: cryptoColor },
        },
      );
    }

    return {
      ...base,
      grid: { top: showBreakdown ? 10 : 12, right: 4, bottom: showBreakdown ? 38 : 24, left: 44, containLabel: false },
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
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: (v: number) => formatAxisValue(v),
        },
        min: (value: { min: number }) => Math.floor(value.min * 0.95),
      },
      legend: showBreakdown ? {
        show: true,
        bottom: 0,
        textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 },
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 3,
      } : { show: false },
      series,
    };
  }, [filteredData, isDark, lineColor, format, showBreakdown, hasBreakdownData, portfolioColor, cryptoColor, symbol]);

  return (
    <BlurFade delay={delay}>
      <div className="finance-card px-3 py-4 sm:p-5">
        {/* Header row */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="flex items-center gap-2">
              <p className="label-mono">Net Worth Trend</p>
              {!includeSuper && (
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                  excl. super
                </span>
              )}
              {hasBreakdownData && (
                <button
                  onClick={() => setShowBreakdown((v) => !v)}
                  className={cn(
                    "text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors",
                    showBreakdown
                      ? "bg-foreground text-background"
                      : "bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  Breakdown
                </button>
              )}
            </div>
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

          {/* Range selector */}
          {nwTrendData.length > 7 && (
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

        {/* High / Low pills */}
        {stats && (
          <div className="flex gap-3 mb-2">
            <span className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
              H {format(stats.high, undefined, true)}
            </span>
            <span className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
              L {format(stats.low, undefined, true)}
            </span>
          </div>
        )}

        {/* Chart */}
        {filteredData.length > 1 ? (
          <ReactECharts
            option={option}
            style={{ height: 240, width: "100%" }}
            className="!-mx-1 sm:!mx-0"
            opts={{ renderer: "svg" }}
          />
        ) : (
          <div className="flex h-44 items-center justify-center">
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
