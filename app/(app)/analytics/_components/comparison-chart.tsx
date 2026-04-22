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

interface ComparisonChartProps {
  twr: { date: string; cumulativePct: number }[];
  spy: { date: string; cumulativePct: number }[];
  btc: { date: string; cumulativePct: number }[];
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

export function ComparisonChart({ twr, spy, btc }: ComparisonChartProps) {
  const series = useMemo<SeriesPoint[]>(() => {
    const portMap = new Map(twr.map((p) => [p.date, p.cumulativePct]));
    const btcMap = new Map(btc.map((p) => [p.date, p.cumulativePct]));
    const spyMap = new Map(spy.map((p) => [p.date, p.cumulativePct]));
    const dates = new Set<string>([...portMap.keys(), ...btcMap.keys(), ...spyMap.keys()]);
    return [...dates].sort().map((date) => ({
      date,
      portfolio: portMap.get(date) ?? null,
      btc: btcMap.get(date) ?? null,
      spy: spyMap.get(date) ?? null,
    }));
  }, [twr, btc, spy]);

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

      {series.length > 0 && (
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
