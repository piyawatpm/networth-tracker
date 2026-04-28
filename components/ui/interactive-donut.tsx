"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { ReactECharts, type EChartsReact } from "@/components/ui/lazy-echarts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  /** Max items to show in compact view before "View all" */
  maxVisible?: number;
}

// Shared legend row component
function LegendRow({
  item,
  isHidden,
  pct,
  format,
  onToggle,
  onHover,
  onLeave,
}: {
  item: DonutItem;
  isHidden: boolean;
  pct: string | null;
  format: (v: number, f?: string, c?: boolean) => string;
  onToggle: () => void;
  onHover: () => void;
  onLeave: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={cn(
        "flex items-center gap-2 w-full text-sm px-1.5 py-1 rounded-md transition-all",
        isHidden ? "opacity-40 hover:opacity-60" : "hover:bg-secondary/60",
      )}
    >
      <span
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full transition-all", isHidden && "scale-75")}
        style={{ backgroundColor: isHidden ? "#aaa" : item.color }}
      />
      <span className={cn("truncate text-left", isHidden ? "text-muted-foreground line-through" : "text-muted-foreground")}>
        {item.name}
      </span>
      <span className="ml-auto font-mono tabular-nums text-xs whitespace-nowrap shrink-0">
        {isHidden ? "—" : format(item.value, undefined, true)}
      </span>
      {pct && (
        <span className="font-mono tabular-nums text-[10px] text-muted-foreground/60 w-10 text-right shrink-0">
          {pct}%
        </span>
      )}
    </button>
  );
}

export function InteractiveDonut({
  title,
  data,
  format,
  size = 144,
  maxVisible = 6,
}: InteractiveDonutProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const chartRef = useRef<EChartsReact>(null);
  const modalChartRef = useRef<EChartsReact>(null);

  const toggle = useCallback((name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        if (next.size >= data.length - 1) return prev;
        next.add(name);
      }
      return next;
    });
  }, [data.length]);

  const visibleData = useMemo(
    () => data.filter((d) => !hidden.has(d.name)),
    [data, hidden],
  );

  const visibleTotal = useMemo(
    () => visibleData.reduce((s, d) => s + d.value, 0),
    [visibleData],
  );

  const chartOption = useMemo(() => ({
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
  }), [visibleData]);

  const makeHoverHandlers = useCallback((ref: React.RefObject<EChartsReact | null>) => ({
    onHover: (name: string) => {
      const instance = ref.current?.getEchartsInstance();
      if (instance) instance.dispatchAction({ type: "highlight", name });
    },
    onLeave: () => {
      const instance = ref.current?.getEchartsInstance();
      if (instance) instance.dispatchAction({ type: "downplay" });
    },
  }), []);

  const compactHandlers = makeHoverHandlers(chartRef);
  const modalHandlers = makeHoverHandlers(modalChartRef);

  const hasMore = data.length > maxVisible;
  const compactData = hasMore ? data.slice(0, maxVisible) : data;
  const hiddenCount = data.length - maxVisible;

  if (data.length === 0) {
    return (
      <div className="finance-card p-5 h-full">
        <p className="label-mono mb-4">{title}</p>
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No data</div>
      </div>
    );
  }

  return (
    <>
      <div className="finance-card p-5 h-full">
        <p className="label-mono mb-4">{title}</p>
        <div className="flex flex-col items-center gap-3">
          <div style={{ width: size, height: size }} className="shrink-0">
            <ReactECharts
              ref={chartRef}
              option={chartOption}
              style={{ height: size, width: size }}
            />
          </div>
          <div className="w-full space-y-0.5">
            {compactData.map((d) => {
              const isHidden = hidden.has(d.name);
              const pct = !isHidden && visibleTotal > 0
                ? ((d.value / visibleTotal) * 100).toFixed(1)
                : null;
              return (
                <LegendRow
                  key={d.name}
                  item={d}
                  isHidden={isHidden}
                  pct={pct}
                  format={format}
                  onToggle={() => toggle(d.name)}
                  onHover={() => !isHidden && compactHandlers.onHover(d.name)}
                  onLeave={compactHandlers.onLeave}
                />
              );
            })}
            {hasMore && (
              <button
                onClick={() => setModalOpen(true)}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1.5 transition-colors"
              >
                +{hiddenCount} more — View all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Full modal with all items */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Click items to show/hide from the chart. Hover to highlight.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <div style={{ width: 200, height: 200 }} className="shrink-0">
              <ReactECharts
                ref={modalChartRef}
                option={chartOption}
                style={{ height: 200, width: 200 }}
              />
            </div>
            <div className="w-full space-y-0.5">
              {data.map((d) => {
                const isHidden = hidden.has(d.name);
                const pct = !isHidden && visibleTotal > 0
                  ? ((d.value / visibleTotal) * 100).toFixed(1)
                  : null;
                return (
                  <LegendRow
                    key={d.name}
                    item={d}
                    isHidden={isHidden}
                    pct={pct}
                    format={format}
                    onToggle={() => toggle(d.name)}
                    onHover={() => !isHidden && modalHandlers.onHover(d.name)}
                    onLeave={modalHandlers.onLeave}
                  />
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
