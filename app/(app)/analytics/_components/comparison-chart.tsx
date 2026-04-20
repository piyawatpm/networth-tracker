"use client";

import { useEffect, useMemo, useState } from "react";
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
import type { DailyPnlPoint } from "@/lib/utils/pnl";

interface ComparisonChartProps {
  /** Per-day PnL series anchored to current holdings (from computeDailyPnlSeries). */
  pnlSeries: DailyPnlPoint[];
}

interface BenchmarkPoint {
  date: string;
  btc: number | null;
  spy: number | null;
}

interface SeriesPoint {
  date: string;
  portfolio: number | null;
  btc: number | null;
  spy: number | null;
}

const config: ChartConfig = {
  portfolio: { label: "My Portfolio", color: "hsl(220 90% 60%)" },
  btc: { label: "BTC", color: "hsl(35 95% 55%)" },
  spy: { label: "S&P 500", color: "hsl(140 60% 45%)" },
};

/**
 * Convert a closing-price series → cumulative % vs the first non-null point.
 * BTC and SPY have no user cash flows so this is just (close_t/close_first − 1).
 */
function cumulativeFromCloses(map: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const dates = [...map.keys()].sort();
  if (dates.length === 0) return out;
  const base = map.get(dates[0])!;
  if (base === 0) return out;
  for (const d of dates) {
    const close = map.get(d);
    if (close == null) continue;
    out.set(d, (close / base - 1) * 100);
  }
  return out;
}

export function ComparisonChart({ pnlSeries }: ComparisonChartProps) {
  const [bench, setBench] = useState<BenchmarkPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Depend on the from/to strings, not the range object reference, so an
  // upstream pnlSeries reference change with identical dates doesn't refire
  // the benchmark fetch.
  const rangeFrom = pnlSeries[0]?.date ?? null;
  const rangeTo = pnlSeries[pnlSeries.length - 1]?.date ?? null;

  useEffect(() => {
    if (!rangeFrom || !rangeTo) return;
    setLoading(true);
    setError(null);
    fetch(`/api/comparison?from=${rangeFrom}&to=${rangeTo}`)
      .then((r) => r.json())
      .then((j) => setBench(j.data ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fetch failed"))
      .finally(() => setLoading(false));
  }, [rangeFrom, rangeTo]);

  // Portfolio % each day = total PnL / cost basis active that day × 100.
  // Same denominator as HoldingsPnl% on the latest day, so the rightmost
  // point of the chart matches your All-time PnL%.
  const series = useMemo<SeriesPoint[]>(() => {
    const portMap = new Map<string, number>();
    for (const p of pnlSeries) {
      portMap.set(p.date, p.costUsd > 0 ? (p.totalUsd / p.costUsd) * 100 : 0);
    }
    const btcMap = cumulativeFromCloses(
      new Map((bench ?? []).filter((p) => p.btc != null).map((p) => [p.date, p.btc as number])),
    );
    const spyMap = cumulativeFromCloses(
      new Map((bench ?? []).filter((p) => p.spy != null).map((p) => [p.date, p.spy as number])),
    );

    const dates = new Set<string>([
      ...portMap.keys(),
      ...btcMap.keys(),
      ...spyMap.keys(),
    ]);
    return [...dates].sort().map((date) => ({
      date,
      portfolio: portMap.get(date) ?? null,
      btc: btcMap.get(date) ?? null,
      spy: spyMap.get(date) ?? null,
    }));
  }, [bench, pnlSeries]);

  const latest = useMemo(() => {
    const last = (k: keyof Omit<SeriesPoint, "date">) => {
      for (let i = series.length - 1; i >= 0; i--) {
        const v = series[i][k];
        if (v != null && typeof v === "number") return v;
      }
      return null;
    };
    return {
      portfolio: last("portfolio"),
      btc: last("btc"),
      spy: last("spy"),
    };
  }, [series]);

  const fmtPct = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

  return (
    <div className="finance-card p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="label-mono">Performance — ROI vs cost basis</p>
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

      {loading && !bench && (
        <div className="flex h-72 items-center justify-center text-xs text-muted-foreground font-mono">
          Loading comparison data…
        </div>
      )}
      {error && (
        <div className="flex h-72 items-center justify-center text-xs text-expense font-mono">
          {error}
        </div>
      )}
      {!loading && !error && series.length > 0 && (
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <LineChart data={series} margin={{ left: 8, right: 12, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={28}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
              width={48}
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
