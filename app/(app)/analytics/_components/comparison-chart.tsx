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
import type { DailyPnlEntry } from "@/lib/utils/pnl";

interface ComparisonChartProps {
  dailyPnl: DailyPnlEntry[];
}

interface ApiPoint {
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
 * Compound daily TWRR returns into a cumulative %.
 * Index 0 is always 0% (the baseline). Each subsequent point compounds the
 * day's pct return so deposits don't distort the result.
 */
function cumulativePortfolio(entries: DailyPnlEntry[]): { date: string; pct: number }[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: { date: string; pct: number }[] = [];
  let factor = 1;
  for (const e of sorted) {
    factor *= 1 + e.totalPnlPct / 100;
    out.push({ date: e.date, pct: (factor - 1) * 100 });
  }
  return out;
}

/** Convert a closing-price series to cumulative % vs the first point. */
function cumulativeFromCloses(map: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const dates = [...map.keys()].sort();
  if (dates.length === 0) return out;
  const base = map.get(dates[0])!;
  for (const d of dates) {
    const close = map.get(d);
    if (close == null || base === 0) continue;
    out.set(d, (close / base - 1) * 100);
  }
  return out;
}

export function ComparisonChart({ dailyPnl }: ComparisonChartProps) {
  const [api, setApi] = useState<ApiPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date range matches whatever days the user has PnL data for.
  const range = useMemo(() => {
    if (dailyPnl.length === 0) return null;
    const dates = dailyPnl.map((d) => d.date).sort();
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [dailyPnl]);

  useEffect(() => {
    if (!range) return;
    setLoading(true);
    setError(null);
    fetch(`/api/comparison?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((j) => setApi(j.data ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fetch failed"))
      .finally(() => setLoading(false));
  }, [range]);

  // Merge portfolio + BTC + SPY into a single date-indexed series.
  const series = useMemo<SeriesPoint[]>(() => {
    const portfolio = cumulativePortfolio(dailyPnl);
    const btcMap = cumulativeFromCloses(
      new Map((api ?? []).filter((p) => p.btc != null).map((p) => [p.date, p.btc as number])),
    );
    const spyMap = cumulativeFromCloses(
      new Map((api ?? []).filter((p) => p.spy != null).map((p) => [p.date, p.spy as number])),
    );

    const dates = new Set<string>();
    for (const p of portfolio) dates.add(p.date);
    for (const d of btcMap.keys()) dates.add(d);
    for (const d of spyMap.keys()) dates.add(d);

    const portMap = new Map(portfolio.map((p) => [p.date, p.pct]));
    return [...dates].sort().map((date) => ({
      date,
      portfolio: portMap.get(date) ?? null,
      btc: btcMap.get(date) ?? null,
      spy: spyMap.get(date) ?? null,
    }));
  }, [api, dailyPnl]);

  // Headline: latest cumulative % per series.
  const latest = useMemo(() => {
    const last = (k: keyof SeriesPoint) => {
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
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="label-mono">Performance vs BTC & S&P 500</p>
        <div className="flex items-center gap-4 text-xs font-mono">
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

      {loading && !api && (
        <div className="flex h-64 items-center justify-center text-xs text-muted-foreground font-mono">
          Loading comparison data…
        </div>
      )}
      {error && (
        <div className="flex h-64 items-center justify-center text-xs text-expense font-mono">
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
