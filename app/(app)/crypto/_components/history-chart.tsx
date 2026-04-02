"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { cn } from "@/lib/utils";
import { ECHARTS_COLORS, getCartesianBaseOption } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";
import type { PortfolioSnapshot } from "@/lib/utils/crypto-csv";

export function HistoryChart({
  portfolioHistory,
  isDark,
}: {
  portfolioHistory: PortfolioSnapshot[];
  isDark: boolean;
}) {
  const [trendRange, setTrendRange] = useState<"1W" | "1M" | "3M" | "All">("All");

  const filteredHistory = useMemo(() => {
    if (trendRange === "All" || portfolioHistory.length === 0) return portfolioHistory;
    const now = new Date();
    let cutoff: Date;
    switch (trendRange) {
      case "1W":
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "1M":
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "3M":
        cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
    }
    const cutoffStr = cutoff!.toISOString().split("T")[0];
    return portfolioHistory.filter((s) => s.date >= cutoffStr);
  }, [portfolioHistory, trendRange]);

  if (portfolioHistory.length <= 1) return null;

  return (
    <BlurFade delay={0.09}>
      <div className="finance-card p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="label-mono">VALUE TREND</p>
          <div className="flex items-center gap-0.5 rounded-lg bg-secondary p-0.5">
            {(["1W", "1M", "3M", "All"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTrendRange(range)}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                  trendRange === range
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
        {filteredHistory.length > 1 ? (
          <ReactECharts
            option={{
              ...getCartesianBaseOption(isDark),
              xAxis: {
                ...getCartesianBaseOption(isDark).xAxis,
                type: "category" as const,
                data: filteredHistory.map((s) => {
                  const d = new Date(s.date + "T00:00:00");
                  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
                }),
              },
              yAxis: {
                ...getCartesianBaseOption(isDark).yAxis,
                type: "value" as const,
                axisLabel: {
                  ...getCartesianBaseOption(isDark).yAxis.axisLabel,
                  formatter: (v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`,
                },
              },
              series: [
                {
                  name: "Value",
                  type: "line" as const,
                  data: filteredHistory.map((s) => Math.round(s.totalValueUsd * 100) / 100),
                  smooth: true,
                  showSymbol: false,
                  lineStyle: { width: 2, color: ECHARTS_COLORS[0] },
                  areaStyle: { color: ECHARTS_COLORS[0], opacity: 0.08 },
                },
                {
                  name: "Cost",
                  type: "line" as const,
                  data: filteredHistory.map((s) => Math.round(s.totalCostUsd * 100) / 100),
                  smooth: true,
                  showSymbol: false,
                  lineStyle: { width: 1.5, color: ECHARTS_COLORS[3], type: "dashed" as const },
                },
              ],
            }}
            style={{ height: 240, width: "100%" }}
          />
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">
            No data in this range.
          </p>
        )}
      </div>
    </BlurFade>
  );
}
