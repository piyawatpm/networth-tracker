"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import type { PortfolioHolding, HoldingType } from "@/lib/utils/types";
import { HOLDING_TYPE_LABELS, CHART_COLORS } from "@/lib/utils/constants";
import { BlurFade } from "@/components/ui/blur-fade";
import { InteractiveDonut } from "@/components/ui/interactive-donut";
import ReactECharts from "echarts-for-react";
import {
  ECHARTS_COLORS,
  formatAxisValue,
  getCartesianBaseOption,
} from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";
import { LookThroughView } from "@/components/portfolio/look-through-view";
import type { FundAllocations } from "@/components/portfolio/fund-breakdown";
import { HOLDING_TYPE_COLOR_MAP, type TrendPeriod, type PortfolioTotals } from "./portfolio-constants";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PortfolioChartsProps {
  filteredHoldings: PortfolioHolding[];
  trendData: { date: string; value: number }[];
  trendPeriod: TrendPeriod;
  setTrendPeriod: (p: TrendPeriod) => void;
  totals: PortfolioTotals;
  fundAllocations: FundAllocations;
  format: (value: number, currency?: string) => string;
  convert: (value: number, currency: string) => number;
  baseDelay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortfolioCharts({
  filteredHoldings,
  trendData,
  trendPeriod,
  setTrendPeriod,
  totals,
  fundAllocations,
  format,
  convert,
  baseDelay,
}: PortfolioChartsProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // ── Trend chart option ──
  const trendChartOption = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    return {
      ...base,
      grid: { ...base.grid, left: 56 },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: trendData.map((d) => d.date),
        boundaryGap: false,
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: formatAxisValue,
        },
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis" as const,
        formatter: "{b}: {c}",
      },
      series: [
        {
          type: "line" as const,
          data: trendData.map((d) => d.value),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: ECHARTS_COLORS[0] },
          itemStyle: { color: ECHARTS_COLORS[0] },
          areaStyle: {
            opacity: 0.15,
            color: {
              type: "linear" as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: ECHARTS_COLORS[0] },
                { offset: 1, color: "transparent" },
              ],
            },
          },
        },
      ],
    };
  }, [trendData, isDark]);

  // ── Allocation by type ──
  const allocationData = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const h of filteredHoldings) {
      byType[h.type] =
        (byType[h.type] ?? 0) + convert(h.currentValue, h.currency);
    }
    return Object.entries(byType)
      .map(([type, value]) => ({
        name: HOLDING_TYPE_LABELS[type as HoldingType],
        value,
        type: type as HoldingType,
        fill: HOLDING_TYPE_COLOR_MAP[type as HoldingType],
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  // ── Top holdings ──
  const topHoldingsData = useMemo(() => {
    const items = filteredHoldings
      .map((h) => ({
        name: h.ticker || h.name,
        value: convert(h.currentValue, h.currency),
      }))
      .sort((a, b) => b.value - a.value);

    if (items.length <= 7) return items;

    const top6 = items.slice(0, 6);
    const otherValue = items.slice(6).reduce((s, i) => s + i.value, 0);
    return [...top6, { name: "Other", value: otherValue }];
  }, [filteredHoldings, convert]);

  // ── Country allocation ──
  const countryData = useMemo(() => {
    const byCountry: Record<string, number> = {};
    for (const h of filteredHoldings) {
      const key = h.country || "Unknown";
      byCountry[key] = (byCountry[key] ?? 0) + convert(h.currentValue, h.currency);
    }
    return Object.entries(byCountry)
      .map(([country, value]) => ({ name: country, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  // ── Broker breakdown ──
  const brokerBreakdown = useMemo(() => {
    const byBroker: Record<string, { value: number; count: number }> = {};
    for (const h of filteredHoldings) {
      const name = h.broker || "Unknown";
      if (!byBroker[name]) byBroker[name] = { value: 0, count: 0 };
      byBroker[name].value += convert(h.currentValue, h.currency);
      byBroker[name].count += 1;
    }
    return Object.entries(byBroker)
      .map(([broker, d]) => ({ broker, ...d }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  return (
    <>
      {/* ── Value Trend Chart ── */}
      <BlurFade delay={baseDelay * 2}>
        <div className="finance-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="label-mono">Value Trend</p>
            <div className="flex items-center gap-1">
              {(["1W", "1M", "3M", "All"] as TrendPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setTrendPeriod(p)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                    trendPeriod === p
                      ? "bg-foreground/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {trendData.length > 1 ? (
            <ReactECharts
              option={trendChartOption}
              style={{ height: 192, width: "100%" }}
            />
          ) : (
            <div className="flex h-48 items-center justify-center">
              <p className="text-sm text-muted-foreground/50">
                {trendData.length === 1
                  ? "Come back tomorrow to see your trend line"
                  : "Add holdings to start tracking value over time"}
              </p>
            </div>
          )}
        </div>
      </BlurFade>

      {/* ── Charts Section (3-column) ── */}
      {filteredHoldings.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Allocation by Type */}
          <BlurFade delay={baseDelay * 4}>
            <InteractiveDonut
              title="Allocation by Type"
              data={allocationData.map((d) => ({ name: d.name, value: d.value, color: d.fill }))}
              format={format}
            />
          </BlurFade>

          {/* Top Holdings */}
          <BlurFade delay={baseDelay * 4.5}>
            <InteractiveDonut
              title="Top Holdings"
              data={topHoldingsData.map((d, i) => ({ name: d.name, value: d.value, color: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }))}
              format={format}
            />
          </BlurFade>

          {/* Country / Region */}
          <BlurFade delay={baseDelay * 5}>
            <InteractiveDonut
              title="By Country"
              data={countryData.map((d, i) => ({ name: d.name, value: d.value, color: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }))}
              format={format}
            />
          </BlurFade>
        </div>
      )}

      {/* ── Broker Breakdown ── */}
      {brokerBreakdown.length > 0 && (
        <BlurFade delay={baseDelay * 5.5}>
          <div className="finance-card p-6">
            <p className="label-mono mb-4">By Broker</p>
            <div className="space-y-2.5">
              {brokerBreakdown.map((b, i) => {
                const pct = totals.totalValue > 0 ? (b.value / totals.totalValue) * 100 : 0;
                const color = CHART_COLORS[i % CHART_COLORS.length];
                return (
                  <div key={b.broker} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span>{b.broker}</span>
                        <span className="text-xs text-muted-foreground">
                          {b.count} holding{b.count !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {format(b.value)} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </BlurFade>
      )}

      {/* ── Look-Through Exposure ── */}
      {filteredHoldings.length > 0 && (
        <BlurFade delay={baseDelay * 6}>
          <LookThroughView holdings={filteredHoldings} allocations={fundAllocations} />
        </BlurFade>
      )}
    </>
  );
}
