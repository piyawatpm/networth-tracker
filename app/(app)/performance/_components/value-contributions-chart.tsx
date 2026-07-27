"use client";

import { useMemo } from "react";
import { ReactECharts } from "@/components/ui/lazy-echarts";
import { getCartesianBaseOption, formatAxisValue, ECHARTS_COLORS } from "@/lib/utils/echarts";
import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";

export function ValueContributionsChart({
  values,
  contributions,
  isDark,
}: {
  values: { date: string; value: number }[];
  contributions: { date: string; contributed: number }[];
  isDark: boolean;
}) {
  const { symbol, convert } = useCurrency();

  // Forward-fill cumulative contributions onto each snapshot date, so a
  // contribution made before the window's first snapshot is already in the
  // first point's level.
  const data = useMemo(() => {
    let ci = -1;
    let level = 0;
    return values.map((v) => {
      while (ci + 1 < contributions.length && contributions[ci + 1].date <= v.date) {
        ci++;
        level = contributions[ci].contributed;
      }
      return {
        date: v.date,
        value: convert(v.value, "USD"),
        contributed: convert(level, "USD"),
      };
    });
  }, [values, contributions, convert]);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    return {
      ...base,
      grid: { ...base.grid, top: 28, left: 56, right: 8 },
      legend: {
        show: true,
        top: 0,
        right: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 3,
        textStyle: { color: isDark ? "#888888" : "#968360", fontSize: 11 },
      },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: data.map((d) => {
          const dt = new Date(d.date + "T00:00:00");
          return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
        }),
        axisLabel: {
          ...base.xAxis.axisLabel,
          interval: Math.max(0, Math.floor(data.length / 6) - 1),
        },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        scale: true,
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: (v: number) => `${symbol}${formatAxisValue(v)}`,
        },
      },
      series: [
        {
          name: "Value",
          type: "line" as const,
          // Series-level color keeps the legend swatch in sync with the line.
          color: ECHARTS_COLORS[0],
          data: data.map((d) => Math.round(d.value * 100) / 100),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 },
        },
        {
          name: "Net contributions",
          type: "line" as const,
          color: ECHARTS_COLORS[3],
          data: data.map((d) => Math.round(d.contributed * 100) / 100),
          step: "end" as const,
          showSymbol: false,
          lineStyle: { width: 1.5, type: "dashed" as const },
        },
      ],
    };
  }, [data, isDark, symbol]);

  return (
    <BlurFade delay={0.12}>
      <div className="finance-card p-6">
        <p className="label-mono mb-1">VALUE VS WHAT YOU PUT IN</p>
        <p className="text-xs text-muted-foreground mb-4">
          The gap between the lines is money your investments actually made.
        </p>
        {data.length > 1 ? (
          <div className="w-full overflow-hidden">
            <ReactECharts
              option={option}
              style={{ height: 260, width: "100%" }}
              opts={{ renderer: "svg" }}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">
            Not enough snapshot history in this period yet — the daily cron builds this chart
            over time.
          </p>
        )}
      </div>
    </BlurFade>
  );
}
