"use client";

import { useMemo } from "react";
import { ReactECharts } from "@/components/ui/lazy-echarts";
import { getCartesianBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";

export interface BenchmarkSeries {
  name: string;
  color: string;
  dashType: "dashed" | "dotted";
  series: { date: string; index: number }[];
}

export function GrowthChart({
  twrSeries,
  benchmarks,
  isDark,
}: {
  twrSeries: { date: string; index: number }[];
  benchmarks: BenchmarkSeries[];
  isDark: boolean;
}) {
  // Align each benchmark onto the TWR date axis: carry the latest index at or
  // before each TWR date (benchmarks have no weekend closes; snapshots do).
  const alignedAll = useMemo(
    () =>
      benchmarks.map((b) => {
        if (b.series.length === 0) return null;
        let si = -1;
        let level: number | null = null;
        return twrSeries.map((p) => {
          while (si + 1 < b.series.length && b.series[si + 1].date <= p.date) {
            si++;
            level = b.series[si].index;
          }
          return level;
        });
      }),
    [twrSeries, benchmarks],
  );

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
        ...benchmarks.flatMap((b, i) => {
          const aligned = alignedAll[i];
          if (!aligned) return [];
          return [
            {
              name: b.name,
              type: "line" as const,
              color: b.color,
              data: aligned.map((v) => (v == null ? null : Math.round(v * 100) / 100)),
              smooth: true,
              showSymbol: false,
              lineStyle: { width: 1.5, type: b.dashType },
            },
          ];
        }),
      ],
    };
  }, [twrSeries, benchmarks, alignedAll, isDark]);

  return (
    <BlurFade delay={0.15}>
      <div className="finance-card p-6">
        <p className="label-mono mb-1">GROWTH OF 100</p>
        <p className="text-xs text-muted-foreground mb-4">
          Deposit timing removed (time-weighted). Above a benchmark line = you beat it.
          History starts where your transaction log begins.
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
