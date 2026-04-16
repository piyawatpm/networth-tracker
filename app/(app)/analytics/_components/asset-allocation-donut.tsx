"use client";

import { useMemo, useRef, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { getPieBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import type { HoldingPnl } from "@/lib/utils/pnl";

interface AssetAllocationDonutProps {
  holdings: HoldingPnl[];
  format: (amount: number) => string;
  symbol: string;
}

interface SliceItem {
  name: string;
  value: number;
  color: string;
}

export function AssetAllocationDonut({
  holdings,
  format,
  symbol,
}: AssetAllocationDonutProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartRef = useRef<ReactECharts>(null);

  const { slices, total } = useMemo(() => {
    const sorted = [...holdings]
      .filter((h) => h.currentValue > 0)
      .sort((a, b) => b.currentValue - a.currentValue);

    const top = sorted.slice(0, 10);
    const rest = sorted.slice(10);
    const restValue = rest.reduce((sum, h) => sum + h.currentValue, 0);
    const totalValue = sorted.reduce((sum, h) => sum + h.currentValue, 0);

    const items: SliceItem[] = top.map((h, i) => ({
      name: h.name,
      value: h.currentValue,
      color: ECHARTS_COLORS[i % ECHARTS_COLORS.length],
    }));

    if (restValue > 0) {
      items.push({
        name: "Other",
        value: restValue,
        color: ECHARTS_COLORS[10 % ECHARTS_COLORS.length],
      });
    }

    return { slices: items, total: totalValue };
  }, [holdings]);

  const bgColor = isDark ? "#1a1a1a" : "#f4f3ed";

  const chartOption = useMemo(() => {
    const base = getPieBaseOption(isDark, symbol);
    return {
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["50%", "75%"],
          center: ["50%", "50%"],
          padAngle: 2,
          data: slices.map((s) => ({
            name: s.name,
            value: s.value,
            itemStyle: {
              color: s.color,
              borderRadius: 4,
              borderColor: bgColor,
              borderWidth: 2,
            },
          })),
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 12,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.35)",
            },
          },
          animationType: "scale" as const,
          animationEasing: "cubicOut" as const,
        },
      ],
    };
  }, [slices, isDark, symbol, bgColor]);

  const handleHover = useCallback((name: string) => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) {
      instance.dispatchAction({ type: "downplay" });
      instance.dispatchAction({ type: "highlight", name });
    }
  }, []);

  const handleLeave = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) instance.dispatchAction({ type: "downplay" });
  }, []);

  return (
    <div className="finance-card p-5 h-full">
      <div className="mb-4 flex items-center justify-between">
        <p className="label-mono">Asset Allocation</p>
        <span className="font-mono text-sm tabular-nums font-semibold">
          {format(total)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr] md:items-start">
        {/* Donut chart */}
        <div className="relative mx-auto h-[200px] w-[200px]">
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{ height: 200, width: 200 }}
            opts={{ renderer: "svg" }}
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Total
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {format(total)}
            </span>
          </div>
        </div>

        {/* Legend list */}
        <div className="max-h-[200px] space-y-1 overflow-y-auto pr-1">
          {slices.map((slice) => {
            const pct = total > 0 ? (slice.value / total) * 100 : 0;
            return (
              <div
                key={slice.name}
                onMouseEnter={() => handleHover(slice.name)}
                onMouseLeave={handleLeave}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="text-xs font-medium truncate">
                    {slice.name}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 shrink-0 font-mono tabular-nums">
                  <span className="text-[11px] text-muted-foreground">
                    {pct.toFixed(1)}%
                  </span>
                  <span className="text-xs">{format(slice.value)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
