"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry, PortfolioHolding, PortfolioTransaction } from "@/lib/utils/types";
import {
  buildContributionSeries,
  computeTwr,
  costBasisDrift,
  dailySnapshotValues,
  netFlowsByDay,
  perHoldingStats,
  xirr,
  type CashFlow,
  type SnapshotLike,
} from "@/lib/utils/performance";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { PerfStats } from "./_components/perf-stats";
import { ValueContributionsChart } from "./_components/value-contributions-chart";
import { GrowthChart } from "./_components/growth-chart";
import { HoldingsPerformanceTable } from "./_components/holdings-performance-table";

type Period = "3M" | "6M" | "1Y" | "All";
const PERIODS: Period[] = ["3M", "6M", "1Y", "All"];
const PERIOD_DAYS: Record<Exclude<Period, "All">, number> = { "3M": 90, "6M": 180, "1Y": 365 };

interface SpyCache {
  fetchedAt: number;
  prices: { date: string; close: number }[];
}

export default function PerformancePage() {
  const [holdings] = useCloudStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [transactions] = useCloudStorage<PortfolioTransaction[]>("portfolio_transactions", []);
  const [snapshots] = useCloudStorage<SnapshotLike[]>("portfolio_snapshots", []);
  const [incomeEntries] = useCloudStorage<IncomeEntry[]>("income_entries", []);
  const { convert, format } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [period, setPeriod] = useState<Period>("All");
  const [includeSuper, setIncludeSuper] = useState(true);
  // Transactions of deleted holdings ("removed"). Real exits belong in the
  // stats, but in practice deleted holdings are mostly renames/experiments
  // whose buys have no matching sell — they'd read as pure losses. Default
  // them OUT of the stats; the table still shows the aggregate row.
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [spy, setSpy] = useState<SpyCache["prices"] | null>(null);

  const today = getSydneyDateString();
  const toUsd = useMemo(
    () => (amount: number, from: string) => convert(amount, from, "USD"),
    [convert],
  );

  // ── SPY history: localStorage-cached 12h; benchmark UI hides on failure ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem("benchmark_spy_cache");
        if (raw) {
          const cached = JSON.parse(raw) as SpyCache;
          if (Date.now() - cached.fetchedAt < 12 * 3600_000 && cached.prices?.length) {
            setSpy(cached.prices);
            return;
          }
        }
      } catch {
        // fall through to refetch
      }
      try {
        const res = await fetch("/api/benchmark?from=2020-01-01");
        if (!res.ok) return;
        const data = (await res.json()) as { prices: SpyCache["prices"] };
        if (cancelled || !data.prices?.length) return;
        setSpy(data.prices);
        localStorage.setItem(
          "benchmark_spy_cache",
          JSON.stringify({ fetchedAt: Date.now(), prices: data.prices } satisfies SpyCache),
        );
      } catch {
        // benchmark stays hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Core derived data (all USD) ──
  const superIds = useMemo(
    () => new Set(holdings.filter((h) => h.accountType === "super").map((h) => h.id)),
    [holdings],
  );
  const knownIds = useMemo(() => new Set(holdings.map((h) => h.id)), [holdings]);
  const holdingFilter = useMemo(() => {
    if (includeSuper && includeRemoved) return undefined;
    return (id: string) =>
      (includeSuper || !superIds.has(id)) && (includeRemoved || knownIds.has(id));
  }, [includeSuper, includeRemoved, superIds, knownIds]);

  const flows = useMemo(
    () => netFlowsByDay(transactions, toUsd, holdingFilter),
    [transactions, toUsd, holdingFilter],
  );
  const contributions = useMemo(() => buildContributionSeries(flows), [flows]);
  const values = useMemo(
    () => dailySnapshotValues(snapshots, includeSuper),
    [snapshots, includeSuper],
  );

  const periodStart = useMemo(() => {
    if (period === "All") return "0000-00-00";
    const todayMs = Date.parse(today + "T00:00:00Z");
    return new Date(todayMs - PERIOD_DAYS[period] * 86400000).toISOString().slice(0, 10);
  }, [period, today]);

  // TWR is only meaningful where valuations correspond to logged capital —
  // snapshots that predate the first transaction (e.g. seeded/demo history)
  // would chain phantom returns into the index, so the window starts at the
  // first flow.
  const firstFlowDate = flows[0]?.date ?? "0000-00-00";
  const periodValues = useMemo(
    () => values.filter((v) => v.date >= periodStart && v.date >= firstFlowDate),
    [values, periodStart, firstFlowDate],
  );
  const twr = useMemo(() => computeTwr(periodValues, flows), [periodValues, flows]);

  const currentValueUsd = useMemo(
    () =>
      holdings
        .filter((h) => h.type !== "savings" && (includeSuper || h.accountType !== "super"))
        .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency), 0),
    [holdings, includeSuper, toUsd],
  );

  // Money-weighted return over the whole investing life (not period-scoped —
  // XIRR answers "what has MY money earned per year", which only makes sense
  // across every flow; TWR + benchmark are the period-scoped numbers).
  const xirrAllTime = useMemo(() => {
    const cf: CashFlow[] = flows.map((f) => ({ date: f.date, amount: -f.amount }));
    if (currentValueUsd > 0) cf.push({ date: today, amount: currentValueUsd });
    return xirr(cf);
  }, [flows, currentValueUsd, today]);

  const netContributedUsd = useMemo(() => flows.reduce((s, f) => s + f.amount, 0), [flows]);
  const netGainUsd = currentValueUsd - netContributedUsd;

  const dividendsUsd = useMemo(
    () =>
      incomeEntries
        .filter((e) => e.type === "dividend")
        .reduce((s, e) => s + toUsd(e.amount, e.currency), 0),
    [incomeEntries, toUsd],
  );

  // ── SPY indexed to 100 over the SAME window TWR covers ──
  const spyStats = useMemo(() => {
    if (!spy || spy.length === 0 || twr.series.length < 2) return null;
    const start = twr.series[0].date;
    const end = twr.series[twr.series.length - 1].date;
    const inWindow = spy.filter((p) => p.date >= start && p.date <= end);
    if (inWindow.length < 2) return null;
    const base = inWindow[0].close;
    return {
      series: inWindow.map((p) => ({ date: p.date, index: (p.close / base) * 100 })),
      totalReturn: inWindow[inWindow.length - 1].close / base - 1,
    };
  }, [spy, twr.series]);

  const drift = useMemo(
    () => costBasisDrift(holdings, transactions, toUsd),
    [holdings, transactions, toUsd],
  );

  const holdingRows = useMemo(() => {
    const visibleHoldings = includeSuper
      ? holdings
      : holdings.filter((h) => h.accountType !== "super");
    // Orphan txs always pass through (they can't be super-classified); txs of
    // filtered-out super holdings are excluded so their rows don't reappear.
    const visibleTxs = holdingFilter
      ? transactions.filter(
          (t) => holdingFilter(t.holdingId) || !holdings.some((h) => h.id === t.holdingId),
        )
      : transactions;
    return perHoldingStats(visibleHoldings, visibleTxs, toUsd, today);
  }, [holdings, transactions, toUsd, today, includeSuper, holdingFilter]);

  return (
    <div className="space-y-6">
      {/* ── Header + controls ── */}
      <BlurFade>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Performance</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              What your money earned — top-ups stripped out. Stocks only for now.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIncludeSuper((v) => !v)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                includeSuper
                  ? "bg-secondary text-foreground border-transparent"
                  : "text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {includeSuper ? "Super: in" : "Super: out"}
            </button>
            <button
              onClick={() => setIncludeRemoved((v) => !v)}
              title="Transactions of deleted holdings"
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                includeRemoved
                  ? "bg-secondary text-foreground border-transparent"
                  : "text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {includeRemoved ? "Removed: in" : "Removed: out"}
            </button>
            <div className="flex items-center gap-0.5 rounded-lg bg-secondary p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                    period === p
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </BlurFade>

      {/* ── Data-quality banner ── */}
      {drift.length > 0 && (
        <BlurFade delay={0.03}>
          <div className="finance-card border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium mb-0.5">
                {drift.length} {drift.length === 1 ? "holding is" : "holdings are"} missing buy
                history
              </p>
              <p className="text-muted-foreground">
                {drift
                  .map(
                    (d) =>
                      `${d.name} (invested ${format(convert(d.investedUsd, "USD"))} vs logged ${format(convert(d.txCostUsd, "USD"))})`,
                  )
                  .join(", ")}
                . XIRR and TWR only count logged transactions — add the missing buys on the
                Portfolio page to keep these numbers honest.
              </p>
            </div>
          </div>
        </BlurFade>
      )}

      {/* ── Stats ── */}
      <PerfStats
        xirrPct={xirrAllTime}
        twrPct={twr.totalReturn}
        twrLabel={period === "All" ? "ALL" : period}
        netGainUsd={netGainUsd}
        dividendsUsd={dividendsUsd}
        vsSpyPct={
          twr.totalReturn != null && spyStats ? twr.totalReturn - spyStats.totalReturn : null
        }
      />

      {/* ── Charts ── */}
      <ValueContributionsChart
        values={periodValues}
        contributions={contributions}
        isDark={isDark}
      />
      <GrowthChart twrSeries={twr.series} spySeries={spyStats?.series ?? null} isDark={isDark} />

      {/* ── Per-holding table ── */}
      <HoldingsPerformanceTable rows={holdingRows} removedExcluded={!includeRemoved} />
    </div>
  );
}
