"use client";

import { useMemo } from "react";
import { ReactECharts } from "@/components/ui/lazy-echarts";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { PortfolioHolding } from "@/lib/utils/types";
import { getPieBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import type { FundAllocations } from "./fund-breakdown";

interface LookThroughViewProps {
  holdings: PortfolioHolding[];
  allocations: FundAllocations;
}

interface ExposureEntry {
  symbol: string;
  name: string;
  /** Total exposure in display currency */
  value: number;
  /** Percentage of total portfolio */
  weight: number;
  /** Which holdings contribute to this exposure */
  sources: { holdingName: string; contribution: number }[];
}

export function LookThroughView({ holdings, allocations }: LookThroughViewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, format: formatCur, symbol } = useCurrency();

  const totalPortfolioValue = useMemo(
    () => holdings.reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
    [holdings, convert],
  );

  // Build look-through exposure map
  const { exposures, hasData } = useMemo(() => {
    const map: Record<
      string,
      { name: string; value: number; sources: { holdingName: string; contribution: number }[] }
    > = {};

    for (const h of holdings) {
      const holdingValue = convert(h.currentValue, h.currency);
      const alloc = allocations[h.id];

      if (alloc && alloc.holdings.length > 0) {
        // Distribute this holding's value across its underlying holdings
        const totalAllocWeight = alloc.holdings.reduce((s, a) => s + a.weight, 0);
        const unallocated = Math.max(0, 100 - totalAllocWeight);

        for (const underlying of alloc.holdings) {
          const key = underlying.symbol || underlying.name;
          const contribution = holdingValue * (underlying.weight / 100);
          if (!map[key]) {
            map[key] = { name: underlying.name || underlying.symbol, value: 0, sources: [] };
          }
          map[key].value += contribution;
          map[key].sources.push({ holdingName: h.name, contribution });
        }

        // Track unallocated portion
        if (unallocated > 1) {
          const key = `_other_${h.id}`;
          map[key] = {
            name: `${h.name} (other)`,
            value: holdingValue * (unallocated / 100),
            sources: [{ holdingName: h.name, contribution: holdingValue * (unallocated / 100) }],
          };
        }
      } else {
        // No breakdown — the holding itself is the exposure
        const key = h.ticker || h.name;
        if (!map[key]) {
          map[key] = { name: h.name, value: 0, sources: [] };
        }
        map[key].value += holdingValue;
        map[key].sources.push({ holdingName: h.name, contribution: holdingValue });
      }
    }

    const entries: ExposureEntry[] = Object.entries(map)
      .map(([symbol, data]) => ({
        symbol,
        name: data.name,
        value: data.value,
        weight: totalPortfolioValue > 0 ? (data.value / totalPortfolioValue) * 100 : 0,
        sources: data.sources,
      }))
      .sort((a, b) => b.value - a.value);

    const hasBreakdownData = Object.keys(allocations).some(
      (id) => allocations[id]?.holdings?.length > 0,
    );

    return { exposures: entries, hasData: hasBreakdownData };
  }, [holdings, allocations, convert, totalPortfolioValue]);

  // Top 10 for chart, rest as "Other"
  const chartData = useMemo(() => {
    const top = exposures.slice(0, 10);
    const otherValue = exposures.slice(10).reduce((s, e) => s + e.value, 0);
    const result = top.map((e) => ({
      name: e.name.length > 20 ? e.name.slice(0, 18) + "..." : e.name,
      value: Math.round(e.value * 100) / 100,
    }));
    if (otherValue > 0) {
      result.push({ name: "Other", value: Math.round(otherValue * 100) / 100 });
    }
    return result;
  }, [exposures]);

  const chartOption = useMemo(() => {
    const base = getPieBaseOption(isDark, symbol);
    return {
      ...base,
      color: ECHARTS_COLORS,
      legend: { show: false },
      series: [
        {
          type: "pie" as const,
          radius: ["50%", "80%"],
          center: ["50%", "50%"],
          padAngle: 1,
          data: chartData.map((d, i) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: ECHARTS_COLORS[i % ECHARTS_COLORS.length] },
          })),
          label: { show: false },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.3)" },
          },
        },
      ],
    };
  }, [chartData, isDark]);

  if (!hasData) {
    return (
      <div className="finance-card p-5">
        <p className="label-mono mb-2">Look-Through Exposure</p>
        <p className="text-xs text-muted-foreground text-center py-6">
          Add fund breakdowns to holdings to see your true underlying exposure across the portfolio.
        </p>
      </div>
    );
  }

  return (
    <div className="finance-card p-5 space-y-4">
      <p className="label-mono">Look-Through Exposure</p>

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        {/* Donut */}
        <div className="mx-auto w-full max-w-[200px] aspect-square">
          <ReactECharts option={chartOption} style={{ width: "100%", height: "100%" }} />
        </div>

        {/* Top exposures list */}
        <div className="space-y-1.5 overflow-y-auto max-h-64">
          {exposures.slice(0, 15).map((e, i) => (
            <div key={e.symbol} className="flex items-center justify-between text-xs group">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }}
                />
                <span className="truncate">
                  {e.name}
                  {e.symbol && e.symbol !== e.name && !e.symbol.startsWith("_") && (
                    <span className="ml-1 text-muted-foreground font-mono">{e.symbol}</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 tabular-nums">
                <span className="text-muted-foreground">{e.weight.toFixed(1)}%</span>
                <span className="font-medium">{formatCur(e.value)}</span>
              </div>
            </div>
          ))}
          {exposures.length > 15 && (
            <p className="text-[10px] text-muted-foreground text-center pt-1">
              +{exposures.length - 15} more
            </p>
          )}
        </div>
      </div>

      {/* Multi-source exposures */}
      {exposures.filter((e) => e.sources.length > 1).length > 0 && (
        <div className="border-t border-border/50 pt-3">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Multi-Source Exposures
          </p>
          <div className="space-y-1.5">
            {exposures
              .filter((e) => e.sources.length > 1)
              .slice(0, 10)
              .map((e) => (
                <div key={e.symbol} className="text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{e.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {e.weight.toFixed(1)}% total
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground/70 mt-0.5">
                    {e.sources.map((s, i) => (
                      <span key={i}>
                        via {s.holdingName}: {formatCur(s.contribution)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
