"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { getPieBaseOption } from "@/lib/utils/echarts";
import { useCurrency } from "@/components/providers/currency-provider";
import {
  WORLD_COLORS,
  WORLD_LABELS,
  type FinancialWorld,
} from "@/lib/utils/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorldDistributionChartProps {
  normalTotal: number;
  cryptoTotal: number;
  superTotal: number;
  format: (amount: number) => string;
  delay: number;
}

interface WorldSegment {
  key: FinancialWorld;
  label: string;
  value: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorldDistributionChart({
  normalTotal,
  cryptoTotal,
  superTotal,
  format,
  delay,
}: WorldDistributionChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { symbol } = useCurrency();
  const chartRef = useRef<ReactECharts>(null);
  const [hidden, setHidden] = useState<Set<FinancialWorld>>(new Set());
  const [hoveredKey, setHoveredKey] = useState<FinancialWorld | null>(null);

  const segments: WorldSegment[] = useMemo(
    () => [
      { key: "normal", label: WORLD_LABELS.normal, value: normalTotal, color: WORLD_COLORS.normal },
      { key: "crypto", label: WORLD_LABELS.crypto, value: cryptoTotal, color: WORLD_COLORS.crypto },
      { key: "super", label: WORLD_LABELS.super, value: superTotal, color: WORLD_COLORS.super },
    ].filter((s) => s.value > 0) as WorldSegment[],
    [normalTotal, cryptoTotal, superTotal],
  );

  const toggle = useCallback((key: FinancialWorld) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Don't allow hiding all segments
        if (next.size >= segments.length - 1) return prev;
        next.add(key);
      }
      return next;
    });
  }, [segments.length]);

  const visibleSegments = useMemo(
    () => segments.filter((s) => !hidden.has(s.key)),
    [segments, hidden],
  );

  const visibleTotal = useMemo(
    () => visibleSegments.reduce((sum, s) => sum + s.value, 0),
    [visibleSegments],
  );

  const chartOption = useMemo(() => {
    const base = getPieBaseOption(isDark, symbol);
    return {
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["55%", "85%"],
          center: ["50%", "50%"],
          padAngle: 2,
          data: visibleSegments.map((s) => ({
            name: s.label,
            value: s.value,
            itemStyle: { color: s.color },
          })),
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.3)",
            },
          },
          animationType: "scale" as const,
          animationEasing: "cubicOut" as const,
        },
      ],
    };
  }, [visibleSegments, isDark]);

  const handleHover = useCallback(
    (label: string) => {
      const instance = chartRef.current?.getEchartsInstance();
      if (instance) instance.dispatchAction({ type: "highlight", name: label });
    },
    [],
  );

  const handleLeave = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) instance.dispatchAction({ type: "downplay" });
  }, []);

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <p className="label-mono mb-4">Asset Distribution</p>

        <div className="flex flex-col items-center gap-3">
          {/* Donut chart */}
          <div style={{ width: 144, height: 144 }} className="shrink-0">
            <ReactECharts
              ref={chartRef}
              option={chartOption}
              style={{ height: 144, width: 144 }}
            />
          </div>

          {/* Custom legend */}
          <div className="w-full space-y-0.5">
            {segments.map((seg) => {
              const isHidden = hidden.has(seg.key);
              const pct =
                !isHidden && visibleTotal > 0
                  ? ((seg.value / visibleTotal) * 100).toFixed(1)
                  : null;

              return (
                <button
                  key={seg.key}
                  onClick={() => toggle(seg.key)}
                  onMouseEnter={() => {
                    setHoveredKey(seg.key);
                    if (!isHidden) handleHover(seg.label);
                  }}
                  onMouseLeave={() => {
                    setHoveredKey(null);
                    handleLeave();
                  }}
                  className={cn(
                    "flex items-center gap-2 w-full text-sm px-1.5 py-1 rounded-md transition-all",
                    isHidden
                      ? "opacity-40 hover:opacity-60"
                      : "hover:bg-secondary/60",
                  )}
                >
                  {/* Color dot */}
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full transition-all",
                      isHidden && "scale-75",
                    )}
                    style={{ backgroundColor: isHidden ? "#aaa" : seg.color }}
                  />

                  {/* World name */}
                  <span
                    className={cn(
                      "truncate text-left",
                      isHidden
                        ? "text-muted-foreground line-through"
                        : "text-muted-foreground",
                    )}
                  >
                    {seg.label}
                  </span>

                  {/* Eye icon on hover */}
                  {hoveredKey === seg.key && (
                    <span className="shrink-0">
                      {isHidden ? (
                        <EyeOff className="h-3 w-3 text-muted-foreground/40" />
                      ) : (
                        <Eye className="h-3 w-3 text-income" />
                      )}
                    </span>
                  )}

                  {/* Formatted value */}
                  <span className="ml-auto font-mono tabular-nums text-xs whitespace-nowrap shrink-0">
                    {isHidden ? "hidden" : format(seg.value)}
                  </span>

                  {/* Percentage */}
                  {pct && (
                    <span className="font-mono tabular-nums text-[10px] text-muted-foreground/60 w-10 text-right shrink-0">
                      {pct}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
