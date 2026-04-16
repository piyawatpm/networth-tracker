"use client";

import { useMemo, useRef, useCallback, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { getPieBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";
import type { PortfolioHolding, CryptoHolding } from "@/lib/utils/types";

interface CombinedAllocationProps {
  portfolioHoldings: PortfolioHolding[];
  cryptoHoldings: CryptoHolding[];
  convert: (amount: number, currency: string) => number;
  format: (amount: number) => string;
  symbol: string;
  delay: number;
}

interface AllocationItem {
  name: string;
  value: number;
}

export function CombinedAllocation({
  portfolioHoldings,
  cryptoHoldings,
  convert,
  format,
  symbol,
  delay,
}: CombinedAllocationProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartRef = useRef<ReactECharts>(null);
  const [hoveredName, setHoveredName] = useState<string | null>(null);

  const items = useMemo(() => {
    const all: AllocationItem[] = [];

    for (const h of portfolioHoldings) {
      all.push({
        name: h.ticker || h.name,
        value: convert(h.currentValue, h.currency),
      });
    }

    for (const h of cryptoHoldings) {
      all.push({
        name: h.token,
        value: convert(h.currentValueUsd, "USD"),
      });
    }

    const filtered = all.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
    if (filtered.length === 0) return [];

    const top = filtered.slice(0, 10);
    const rest = filtered.slice(10);
    if (rest.length > 0) {
      top.push({
        name: "Other",
        value: rest.reduce((s, i) => s + i.value, 0),
      });
    }

    return top;
  }, [portfolioHoldings, cryptoHoldings, convert]);

  const total = useMemo(() => items.reduce((s, i) => s + i.value, 0), [items]);
  const count = portfolioHoldings.length + cryptoHoldings.length;

  const chartOption = useMemo(() => {
    const base = getPieBaseOption(isDark, symbol);
    const bgColor = isDark ? "#1a1a1a" : "#f4f3ed";
    return {
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["50%", "75%"],
          center: ["50%", "50%"],
          padAngle: 1,
          data: items.map((item, i) => ({
            name: item.name,
            value: item.value,
            itemStyle: {
              color: ECHARTS_COLORS[i % ECHARTS_COLORS.length],
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
  }, [items, isDark, symbol]);

  const handleHover = useCallback(
    (name: string) => {
      setHoveredName(name);
      const instance = chartRef.current?.getEchartsInstance();
      if (instance) {
        instance.dispatchAction({ type: "downplay" });
        instance.dispatchAction({ type: "highlight", name });
      }
    },
    [],
  );

  const handleLeave = useCallback(() => {
    setHoveredName(null);
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) instance.dispatchAction({ type: "downplay" });
  }, []);

  if (items.length === 0) return null;

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <div className="mb-4">
          <p className="label-mono">All Assets</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {count} holdings &middot; {format(total)}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5 md:items-center">
          {/* Donut chart */}
          <div className="relative mx-auto h-[220px] w-[220px]">
            <ReactECharts
              ref={chartRef}
              option={chartOption}
              style={{ height: 220, width: 220 }}
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

          {/* Scrollable legend */}
          <div className="max-h-[220px] overflow-y-auto pr-1 space-y-1">
            {items.map((item, i) => {
              const pct = total > 0 ? (item.value / total) * 100 : 0;
              const color = ECHARTS_COLORS[i % ECHARTS_COLORS.length];
              return (
                <div
                  key={`${item.name}-${i}`}
                  onMouseEnter={() => handleHover(item.name)}
                  onMouseLeave={handleLeave}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors cursor-default",
                    hoveredName === item.name ? "bg-secondary/60" : "hover:bg-secondary/40",
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-medium truncate flex-1 min-w-0">
                    {item.name}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                    {pct.toFixed(1)}%
                  </span>
                  <span className="text-sm font-mono tabular-nums shrink-0">
                    {format(item.value)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
