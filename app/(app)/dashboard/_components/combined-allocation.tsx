"use client";

import { useMemo, useRef, useCallback, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { Eye, EyeOff, Layers, Layers2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPieBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";
import { applyStablecoinTags } from "@/lib/utils/crypto-csv";
import type { PortfolioHolding, CryptoHolding } from "@/lib/utils/types";

interface CombinedAllocationProps {
  portfolioHoldings: PortfolioHolding[];
  /** Raw crypto holdings BEFORE stablecoin merge */
  rawCryptoHoldings: CryptoHolding[];
  stablecoinTags: Record<string, boolean>;
  convert: (amount: number, currency: string) => number;
  format: (amount: number) => string;
  symbol: string;
  delay: number;
}

interface AllocationItem {
  name: string;
  value: number;
  type: "stock" | "crypto";
}

export function CombinedAllocation({
  portfolioHoldings,
  rawCryptoHoldings,
  stablecoinTags,
  convert,
  format,
  symbol,
  delay,
}: CombinedAllocationProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartRef = useRef<ReactECharts>(null);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [mergeStables, setMergeStables] = useState(true);
  const [hiddenAssets, setHiddenAssets] = useState<Set<string>>(new Set());

  const hasStableTags = Object.values(stablecoinTags).some(Boolean);

  const toggleHidden = useCallback((name: string) => {
    setHiddenAssets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // Build all items from portfolio + crypto (with optional stablecoin merge)
  const allItems = useMemo(() => {
    const all: AllocationItem[] = [];

    for (const h of portfolioHoldings) {
      all.push({
        name: h.ticker || h.name,
        value: convert(h.currentValue, h.currency),
        type: "stock",
      });
    }

    const cryptoHoldings = mergeStables && hasStableTags
      ? applyStablecoinTags(rawCryptoHoldings, stablecoinTags)
      : rawCryptoHoldings;

    for (const h of cryptoHoldings) {
      all.push({
        name: h.token,
        value: convert(h.currentValueUsd, "USD"),
        type: "crypto",
      });
    }

    return all.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  }, [portfolioHoldings, rawCryptoHoldings, stablecoinTags, mergeStables, hasStableTags, convert]);

  // Visible items (not hidden), used for chart
  const visibleItems = useMemo(
    () => allItems.filter((i) => !hiddenAssets.has(i.name)),
    [allItems, hiddenAssets],
  );

  const visibleTotal = useMemo(() => visibleItems.reduce((s, i) => s + i.value, 0), [visibleItems]);

  // Chart data: top 10 + Other
  const chartSlices = useMemo(() => {
    const top = visibleItems.slice(0, 10);
    const rest = visibleItems.slice(10);
    const data = top.map((item) => ({
      name: item.name,
      value: Math.round(item.value * 100) / 100,
    }));
    if (rest.length > 0) {
      data.push({
        name: "Other",
        value: Math.round(rest.reduce((s, i) => s + i.value, 0) * 100) / 100,
      });
    }
    return data;
  }, [visibleItems]);

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
          data: chartSlices.map((item, i) => ({
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
  }, [chartSlices, isDark, symbol]);

  const handleHover = useCallback((name: string) => {
    setHoveredName(name);
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) {
      instance.dispatchAction({ type: "downplay" });
      instance.dispatchAction({ type: "highlight", name });
    }
  }, []);

  const handleLeave = useCallback(() => {
    setHoveredName(null);
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) instance.dispatchAction({ type: "downplay" });
  }, []);

  if (allItems.length === 0) return null;

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="label-mono">All Assets</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {visibleItems.length} of {allItems.length} holdings &middot; {format(visibleTotal)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasStableTags && (
              <button
                type="button"
                onClick={() => setMergeStables((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-full transition-colors",
                  mergeStables
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground/50 hover:text-foreground",
                )}
                title={mergeStables ? "Stablecoins merged — click to split" : "Stablecoins split — click to merge"}
              >
                {mergeStables ? <Layers className="h-3 w-3" /> : <Layers2 className="h-3 w-3" />}
                <span className="hidden sm:inline">
                  {mergeStables ? "Merged" : "Split"}
                </span>
              </button>
            )}
            {hiddenAssets.size > 0 && (
              <button
                type="button"
                onClick={() => setHiddenAssets(new Set())}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-muted-foreground/60 hover:text-foreground rounded-full transition-colors"
                title="Show all hidden assets"
              >
                <Eye className="h-3 w-3" />
                <span className="hidden sm:inline">Show all</span>
              </button>
            )}
          </div>
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
                {format(visibleTotal)}
              </span>
            </div>
          </div>

          {/* Scrollable legend */}
          <div className="max-h-[280px] overflow-y-auto pr-1 space-y-0.5">
            {allItems.map((item, i) => {
              const isHidden = hiddenAssets.has(item.name);
              const pct = visibleTotal > 0 && !isHidden
                ? (item.value / visibleTotal) * 100
                : 0;
              // Color index matches chartSlices order for visible items
              const visibleIdx = isHidden ? -1 : visibleItems.findIndex((v) => v.name === item.name);
              const color = visibleIdx >= 0 && visibleIdx < 10
                ? ECHARTS_COLORS[visibleIdx % ECHARTS_COLORS.length]
                : ECHARTS_COLORS[i % ECHARTS_COLORS.length];

              return (
                <div
                  key={`${item.name}-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleHidden(item.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleHidden(item.name); }}
                  onMouseEnter={() => !isHidden && handleHover(item.name)}
                  onMouseLeave={handleLeave}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors cursor-pointer select-none",
                    isHidden
                      ? "opacity-40 hover:opacity-60"
                      : hoveredName === item.name
                        ? "bg-secondary/60"
                        : "hover:bg-secondary/40",
                  )}
                  title={isHidden ? `Show ${item.name}` : `Hide ${item.name}`}
                >
                  <span className="shrink-0 text-muted-foreground/40">
                    {isHidden ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </span>

                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: isHidden ? "currentColor" : color }}
                  />
                  <span className={cn(
                    "text-sm font-medium truncate flex-1 min-w-0",
                    isHidden && "line-through",
                  )}>
                    {item.name}
                  </span>
                  {!isHidden && (
                    <>
                      <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                        {pct.toFixed(1)}%
                      </span>
                      <span className="text-sm font-mono tabular-nums shrink-0">
                        {format(item.value)}
                      </span>
                    </>
                  )}
                  {isHidden && (
                    <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                      {format(item.value)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
