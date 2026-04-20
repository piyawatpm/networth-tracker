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
import { parseCryptoCSV } from "@/lib/utils/crypto-csv";
import type { DailyPnlEntry } from "@/lib/utils/pnl";

interface ComparisonChartProps {
  dailyPnl: DailyPnlEntry[];
  cryptoCsvText: string;
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

const STABLES = new Set([
  "USDT", "USDC", "USDE", "USD1", "DAI", "BUSD", "TUSD", "FDUSD", "GUSD", "SYRUPUSDC",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compound a series of daily % returns into a cumulative % series. */
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

/** YYYY-MM-DD strings between from and to inclusive. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Replay CSV txns + historical prices to get daily crypto values + cash flows
 * for the pre-snapshot window. Returns daily TWRR pcts: (Δvalue − cashFlow) / yesterday.
 */
function reconstructCryptoPcts(
  csvText: string,
  historicalPrices: Record<string, { date: string; close: number }[]>,
  from: string,
  to: string,
): { date: string; pct: number }[] {
  const txns = parseCryptoCSV(csvText);
  const days = dateRange(from, to);

  // Per-token close lookup keyed by date
  const priceLookup: Record<string, Map<string, number>> = {};
  for (const [token, closes] of Object.entries(historicalPrices)) {
    const m = new Map<string, number>();
    for (const c of closes) m.set(c.date, c.close);
    priceLookup[token] = m;
  }

  // Replay txns chronologically; for each day collect EOD holdings + USD cash flow.
  const sorted = [...txns].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const holdings = new Map<string, number>();
  let txIdx = 0;
  const dailyValues: { date: string; value: number; cashFlow: number }[] = [];
  // Carry-forward last seen close per token for days when a token didn't trade.
  const lastClose = new Map<string, number>();

  for (const day of days) {
    let cashFlow = 0;
    while (txIdx < sorted.length && sorted[txIdx].date.slice(0, 10) <= day) {
      const tx = sorted[txIdx];
      if (tx.date.slice(0, 10) === day) {
        if (tx.type === "buy" || tx.type === "transferIn") {
          if (tx.totalValueUsd != null) cashFlow += tx.totalValueUsd;
          holdings.set(tx.token, (holdings.get(tx.token) ?? 0) + tx.amount);
        } else {
          if (tx.totalValueUsd != null) cashFlow -= tx.totalValueUsd;
          holdings.set(tx.token, (holdings.get(tx.token) ?? 0) - tx.amount);
        }
      } else if (tx.date.slice(0, 10) < day) {
        // Pre-window txn: still apply to opening holdings.
        if (tx.type === "buy" || tx.type === "transferIn") {
          holdings.set(tx.token, (holdings.get(tx.token) ?? 0) + tx.amount);
        } else {
          holdings.set(tx.token, (holdings.get(tx.token) ?? 0) - tx.amount);
        }
      }
      txIdx++;
    }

    let value = 0;
    for (const [token, amount] of holdings) {
      if (Math.abs(amount) < 1e-8) continue;
      const upper = token.toUpperCase();
      if (STABLES.has(upper)) {
        value += amount;
        continue;
      }
      const closes = priceLookup[token] ?? priceLookup[upper];
      const close = closes?.get(day) ?? lastClose.get(token);
      if (close != null) {
        lastClose.set(token, close);
        value += amount * close;
      }
    }
    dailyValues.push({ date: day, value, cashFlow });
  }

  // Daily TWRR pcts
  const out: { date: string; pct: number }[] = [];
  for (let i = 0; i < dailyValues.length; i++) {
    const today = dailyValues[i];
    if (i === 0) {
      out.push({ date: today.date, pct: 0 });
      continue;
    }
    const yesterday = dailyValues[i - 1];
    if (yesterday.value <= 0) {
      out.push({ date: today.date, pct: 0 });
      continue;
    }
    const pct = ((today.value - yesterday.value - today.cashFlow) / yesterday.value) * 100;
    out.push({ date: today.date, pct });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComparisonChart({ dailyPnl, cryptoCsvText }: ComparisonChartProps) {
  const [bench, setBench] = useState<BenchmarkPoint[] | null>(null);
  const [historical, setHistorical] = useState<Record<string, { date: string; close: number }[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Earliest crypto txn date — that's where the chart should start.
  const cryptoTxns = useMemo(
    () => (cryptoCsvText ? parseCryptoCSV(cryptoCsvText) : []),
    [cryptoCsvText],
  );
  const earliestCryptoDate = useMemo(() => {
    if (cryptoTxns.length === 0) return null;
    return cryptoTxns
      .map((t) => t.date.slice(0, 10))
      .sort()
      .at(0)!;
  }, [cryptoTxns]);

  const range = useMemo(() => {
    const dailyDates = dailyPnl.map((d) => d.date).sort();
    const lastDailyDate = dailyDates.at(-1);
    const firstDailyDate = dailyDates.at(0);
    if (!lastDailyDate && !earliestCryptoDate) return null;
    const from = earliestCryptoDate ?? firstDailyDate!;
    const to = lastDailyDate ?? new Date().toISOString().slice(0, 10);
    return { from, to };
  }, [dailyPnl, earliestCryptoDate]);

  // First snapshot day for crypto — we reconstruct only BEFORE this date,
  // and use dailyPnl pcts from this date onward.
  const firstSnapshotDate = useMemo(() => {
    return dailyPnl.map((d) => d.date).sort().at(0) ?? null;
  }, [dailyPnl]);

  const uniqueTokens = useMemo(() => {
    const set = new Set<string>();
    for (const t of cryptoTxns) set.add(t.token);
    return [...set];
  }, [cryptoTxns]);

  // Fetch BTC/SPY benchmark data
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

  // Fetch historical prices for tokens — only if we have a pre-snapshot gap to fill.
  useEffect(() => {
    if (!range || !firstSnapshotDate || uniqueTokens.length === 0) return;
    if (range.from >= firstSnapshotDate) {
      setHistorical({});
      return;
    }
    const tokens = uniqueTokens.join(",");
    fetch(`/api/historical-prices?from=${range.from}&to=${firstSnapshotDate}&tokens=${tokens}`)
      .then((r) => r.json())
      .then((j) => setHistorical(j.data ?? {}))
      .catch(() => setHistorical({}));
  }, [range, firstSnapshotDate, uniqueTokens]);

  // Build the merged series.
  const series = useMemo<SeriesPoint[]>(() => {
    if (!range) return [];

    // Stocks: only from dailyPnl entries (snapshots start Apr 7).
    const stockPcts = dailyPnl
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((d) => ({ date: d.date, pct: d.portfolioPnlPct }));
    const stocksCum = new Map(cumulativeFromPcts(stockPcts).map((p) => [p.date, p.cum]));

    // Crypto: reconstructed pre-snapshot + dailyPnl from snapshots onward.
    let cryptoPcts: { date: string; pct: number }[] = [];
    if (historical && firstSnapshotDate && range.from < firstSnapshotDate) {
      const reconDays = dateRange(range.from, firstSnapshotDate);
      // Trim the last reconstructed day; dailyPnl will own that day going forward.
      const recon = reconstructCryptoPcts(
        cryptoCsvText,
        historical,
        range.from,
        reconDays.at(-2) ?? range.from,
      );
      cryptoPcts.push(...recon);
    }
    cryptoPcts.push(
      ...dailyPnl
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((d) => ({ date: d.date, pct: d.cryptoPnlPct })),
    );
    const cryptoCum = new Map(cumulativeFromPcts(cryptoPcts).map((p) => [p.date, p.cum]));

    // Benchmarks
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
  }, [bench, dailyPnl, historical, cryptoCsvText, range, firstSnapshotDate]);

  // Latest cumulative % per series.
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
