"use client";

import { useMemo } from "react";
import { ReactECharts } from "@/components/ui/lazy-echarts";
import { getCartesianBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";

export function GrowthChart({
  twrSeries,
  spySeries,
  isDark,
}: {
  twrSeries: { date: string; index: number }[];
  spySeries: { date: string; index: number }[] | null;
  isDark: boolean;
}) {
  // Align SPY onto the TWR date axis: carry the latest SPY index at or
  // before each TWR date (SPY has no weekend closes; snapshots do).
  const aligned = useMemo(() => {
    if (!spySeries || spySeries.length === 0) return null;
    let si = -1;
    let level: number | null = null;
    return twrSeries.map((p) => {
      while (si + 1 < spySeries.length && spySeries[si + 1].date <= p.date) {
        si++;
        level = spySeries[si].index;
      }
      return level;
    });
  }, [twrSeries, spySeries]);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    return {
      ...base,
      grid: { ...base.grid, top: 28, left: 44, right: 8 },
      legend: {
        show: true,
        top: 0,
        right: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 3,
        textStyle: { color: isDark ? "#888888" : "#968360", fontSize: 11 },
      },
      tooltip: {
        ...base.tooltip,
        valueFormatter: (v: number | null) => (v == null ? "—" : Number(v).toFixed(1)),
      },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: twrSeries.map((p) => {
          const dt = new Date(p.date + "T00:00:00");
          return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
        }),
        axisLabel: {
          ...base.xAxis.axisLabel,
          interval: Math.max(0, Math.floor(twrSeries.length / 6) - 1),
        },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        scale: true,
        axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => v.toFixed(0) },
      },
      series: [
        {
          name: "Your portfolio",
          type: "line" as const,
          // Series-level color keeps the legend swatch in sync with the line.
          color: ECHARTS_COLORS[0],
          data: twrSeries.map((p) => Math.round(p.index * 100) / 100),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
        },
        ...(aligned
          ? [
              {
                name: "S&P 500",
                type: "line" as const,
                color: ECHARTS_COLORS[6],
                data: aligned.map((v) => (v == null ? null : Math.round(v * 100) / 100)),
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 1.5, type: "dashed" as const },
              },
            ]
          : []),
      ],
    };
  }, [twrSeries, aligned, isDark]);

  return (
    <BlurFade delay={0.15}>
      <div className="finance-card p-6">
        <p className="label-mono mb-1">GROWTH OF 100 — YOU VS S&P 500</p>
        <p className="text-xs text-muted-foreground mb-4">
          Deposit timing removed (time-weighted). Above the S&P line = your picks beat the
          index. History starts where your transaction log begins.
        </p>
        {twrSeries.length > 1 ? (
          <div className="w-full overflow-hidden">
            <ReactECharts
              option={option}
              style={{ height: 260, width: "100%" }}
              opts={{ renderer: "svg" }}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">
            Needs at least two daily snapshots in this period.
          </p>
        )}
      </div>
    </BlurFade>
  );
}
