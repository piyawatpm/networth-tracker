"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import { cn } from "@/lib/utils";

interface DonutItem {
  name: string;
  value: number;
  color: string;
}

interface InteractiveDonutProps {
  title: string;
  data: DonutItem[];
  format: (value: number, from?: string, compact?: boolean) => string;
  size?: number;
}

export function InteractiveDonut({
  title,
  data,
  format,
  size = 144,
}: InteractiveDonutProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const chartRef = useRef<ReactECharts>(null);

  const toggle = useCallback((name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        // Don't hide everything
        if (next.size >= data.length - 1) return prev;
        next.add(name);
      }
      return next;
    });
  }, [data.length]);

  const visibleData = useMemo(
    () => data.filter((d) => !hidden.has(d.name)),
    [data, hidden]
  );

  const visibleTotal = useMemo(
    () => visibleData.reduce((s, d) => s + d.value, 0),
    [visibleData]
  );

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item" as const,
      formatter: "{b}: {d}%",
      backgroundColor: "#f4f3ed",
      borderColor: "#c9c3a8",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#2c251e", fontSize: 12 },
      extraCssText: "border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);",
    },
    series: [{
      type: "pie" as const,
      radius: ["55%", "85%"],
      center: ["50%", "50%"],
      padAngle: 2,
      data: visibleData.map((d) => ({
        name: d.name,
        value: d.value,
        itemStyle: { color: d.color },
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
    }],
  };

  // Highlight on legend hover
  const onLegendHover = useCallback((name: string) => {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    instance.dispatchAction({ type: "highlight", name });
  }, []);

  const onLegendLeave = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    instance.dispatchAction({ type: "downplay" });
  }, []);

  if (data.length === 0) {
    return (
      <div className="finance-card p-5 h-full">
        <p className="label-mono mb-4">{title}</p>
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No data</div>
      </div>
    );
  }

  return (
    <div className="finance-card p-5 h-full">
      <p className="label-mono mb-4">{title}</p>
      <div className="flex flex-col items-center gap-4">
        <div style={{ width: size, height: size }} className="shrink-0">
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: size, width: size }}
          />
        </div>
        <div className="w-full space-y-1">
          {data.map((d) => {
            const isHidden = hidden.has(d.name);
            const pct = !isHidden && visibleTotal > 0
              ? ((d.value / visibleTotal) * 100).toFixed(1)
              : null;
            return (
              <button
                key={d.name}
                onClick={() => toggle(d.name)}
                onMouseEnter={() => !isHidden && onLegendHover(d.name)}
                onMouseLeave={onLegendLeave}
                className={cn(
                  "flex items-center gap-2 w-full text-sm px-1.5 py-1 rounded-md transition-all",
                  isHidden
                    ? "opacity-40 hover:opacity-60"
                    : "hover:bg-secondary/60"
                )}
              >
                <span
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full transition-all", isHidden && "scale-75")}
                  style={{ backgroundColor: isHidden ? "#aaa" : d.color }}
                />
                <span className={cn("truncate text-left", isHidden ? "text-muted-foreground line-through" : "text-muted-foreground")}>
                  {d.name}
                </span>
                <span className="ml-auto font-mono tabular-nums text-xs whitespace-nowrap shrink-0">
                  {isHidden ? "—" : format(d.value, undefined, true)}
                </span>
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
  );
}
