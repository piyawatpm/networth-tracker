"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface PerformancePoint {
  timestamp: string;
  portfolioPct: number | null;
  spyPct: number | null;
  btcPct: number | null;
}

interface ComparisonChartProps {
  /** Per-tick performance rows from `performance_snapshots`, ordered ascending. */
  snapshots: PerformancePoint[];
  /** Baseline date — chart starts here at 0% across all series. */
  baselineDate: string;
  /** Optional live overrides for the trailing point (from WS / live value). */
  livePortfolioPct?: number | null;
}

interface SeriesPoint {
  timestamp: string;       // ISO
  label: string;           // "MM-DD HH:MM" for x-axis
  portfolio: number | null;
  btc: number | null;
  spy: number | null;
}

const config: ChartConfig = {
  portfolio: { label: "My Portfolio", color: "hsl(220 90% 60%)" },
  btc: { label: "BTC", color: "hsl(35 95% 55%)" },
  spy: { label: "S&P 500", color: "hsl(140 60% 45%)" },
};

function fmtAxis(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export function ComparisonChart({ snapshots, baselineDate, livePortfolioPct }: ComparisonChartProps) {
  const series = useMemo<SeriesPoint[]>(() => {
    const anchor: SeriesPoint = {
      timestamp: `${baselineDate}T00:00:00Z`,
      label: fmtAxis(`${baselineDate}T00:00:00Z`),
      portfolio: 0,
      btc: 0,
      spy: 0,
    };
    const body: SeriesPoint[] = snapshots.map((s) => ({
      timestamp: s.timestamp,
      label: fmtAxis(s.timestamp),
      portfolio: s.portfolioPct,
      btc: s.btcPct,
      spy: s.spyPct,
    }));
    // Overlay live portfolio % on the trailing point so the chart tracks
    // real-time moves between cron ticks.
    if (livePortfolioPct != null && body.length > 0) {
      body[body.length - 1] = { ...body[body.length - 1], portfolio: livePortfolioPct };
    }
    return [anchor, ...body];
  }, [snapshots, baselineDate, livePortfolioPct]);

  const latest = useMemo(() => {
    const last = (k: "portfolio" | "btc" | "spy") => {
      for (let i = series.length - 1; i >= 0; i--) {
        const v = series[i][k];
        if (v != null && typeof v === "number") return v;
      }
      return null;
    };
    return { portfolio: last("portfolio"), btc: last("btc"), spy: last("spy") };
  }, [series]);

  const fmtPct = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

  return (
    <div className="finance-card p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="label-mono">Performance — since baseline</p>
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          {(["portfolio", "btc", "spy"] as const).map((k) => {
            const v = latest[k];
            const positive = (v ?? 0) >= 0;
            return (
              <div key={k} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: config[k].color as string }}
                />
                <span className="text-muted-foreground">{config[k].label}</span>
                <span className={positive ? "text-income" : "text-expense"}>
                  {fmtPct(v)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {series.length > 1 && (
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <LineChart data={series} margin={{ left: 8, right: 12, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={40}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
              width={52}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="2 2" />
            <ChartTooltip
              cursor={{ strokeDasharray: "2 2" }}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => [
                    `${(value as number) >= 0 ? "+" : ""}${(value as number).toFixed(2)}%`,
                    config[name as keyof typeof config]?.label ?? name,
                  ]}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="portfolio"
              stroke="var(--color-portfolio)"
              strokeWidth={2.5}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="btc"
              stroke="var(--color-btc)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="spy"
              stroke="var(--color-spy)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ChartContainer>
      )}
    </div>
  );
}
