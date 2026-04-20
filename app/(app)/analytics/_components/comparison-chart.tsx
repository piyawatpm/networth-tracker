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

interface BenchmarkPoint {
  date: string;
  btc: number | null;
  spy: number | null;
}

interface SeriesPoint {
  date: string;
  stocks: number | null;
  crypto: number | null;
  btc: number | null;
  spy: number | null;
}

const config: ChartConfig = {
  stocks: { label: "My Stocks", color: "hsl(220 90% 60%)" },
  crypto: { label: "My Crypto", color: "hsl(280 80% 60%)" },
  btc: { label: "BTC", color: "hsl(35 95% 55%)" },
  spy: { label: "S&P 500", color: "hsl(140 60% 45%)" },
};

/**
 * TWRR — Time-Weighted Rate of Return.
 *
 * For each day:   r_t = (V_t − V_{t-1} − F_t) / V_{t-1}
 * Cumulative:     R = ∏(1 + r_t) − 1
 *
 * Subtracting the day's net cash flow (F_t) before dividing by yesterday's
 * value strips out the effect of deposits/withdrawals, which is exactly
 * how indices like BTC and SPY are quoted (no user cash flows). That makes
 * "My Stocks +5%" directly comparable to "BTC +12%" over the same window.
 */
function cumulativeFromPcts(entries: { date: string; pct: number }[]): { date: string; cum: number }[] {
  const out: { date: string; cum: number }[] = [];
  let factor = 1;
  for (const e of entries) {
    factor *= 1 + e.pct / 100;
    out.push({ date: e.date, cum: (factor - 1) * 100 });
  }
  return out;
}

/** Convert closing-price series → cumulative % vs the first point. */
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

export function ComparisonChart({ dailyPnl }: ComparisonChartProps) {
  const [bench, setBench] = useState<BenchmarkPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Range is whatever dailyPnl spans — both reconstructions in pnl.ts now
  // extend back to the earliest stock/crypto transaction.
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
      .then((j) => setBench(j.data ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fetch failed"))
      .finally(() => setLoading(false));
  }, [range]);

  const series = useMemo<SeriesPoint[]>(() => {
    const sorted = [...dailyPnl].sort((a, b) => (a.date < b.date ? -1 : 1));

    const stocksCum = new Map(
      cumulativeFromPcts(sorted.map((d) => ({ date: d.date, pct: d.portfolioPnlPct }))).map(
        (p) => [p.date, p.cum],
      ),
    );
    const cryptoCum = new Map(
      cumulativeFromPcts(sorted.map((d) => ({ date: d.date, pct: d.cryptoPnlPct }))).map(
        (p) => [p.date, p.cum],
      ),
    );

    const btcMap = cumulativeFromCloses(
      new Map((bench ?? []).filter((p) => p.btc != null).map((p) => [p.date, p.btc as number])),
    );
    const spyMap = cumulativeFromCloses(
      new Map((bench ?? []).filter((p) => p.spy != null).map((p) => [p.date, p.spy as number])),
    );

    const dates = new Set<string>([
      ...stocksCum.keys(),
      ...cryptoCum.keys(),
      ...btcMap.keys(),
      ...spyMap.keys(),
    ]);
    return [...dates].sort().map((date) => ({
      date,
      stocks: stocksCum.get(date) ?? null,
      crypto: cryptoCum.get(date) ?? null,
      btc: btcMap.get(date) ?? null,
      spy: spyMap.get(date) ?? null,
    }));
  }, [bench, dailyPnl]);

  const latest = useMemo(() => {
    const last = (k: keyof Omit<SeriesPoint, "date">) => {
      for (let i = series.length - 1; i >= 0; i--) {
        const v = series[i][k];
        if (v != null && typeof v === "number") return v;
      }
      return null;
    };
    return {
      stocks: last("stocks"),
      crypto: last("crypto"),
      btc: last("btc"),
      spy: last("spy"),
    };
  }, [series]);

  const fmtPct = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

  return (
    <div className="finance-card p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="label-mono">Performance — TWRR (deposit-adjusted)</p>
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          {(["stocks", "crypto", "btc", "spy"] as const).map((k) => {
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
              dataKey="stocks"
              stroke="var(--color-stocks)"
              strokeWidth={2.5}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="crypto"
              stroke="var(--color-crypto)"
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
