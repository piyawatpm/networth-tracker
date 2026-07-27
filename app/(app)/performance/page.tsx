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
  syntheticSuperSeries,
  xirr,
  type CashFlow,
  type SnapshotLike,
} from "@/lib/utils/performance";
import {
  isCashLikeToken,
  cryptoNetFlowsByDay,
  stableBalanceByDay,
  cryptoPotValues,
  perTokenStats,
  bootstrapCryptoWindow,
  cryptoAllTimePnl,
} from "@/lib/utils/crypto-performance";
import { parseCryptoCSV } from "@/lib/utils/crypto-csv";
import { ECHARTS_COLORS } from "@/lib/utils/echarts";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { PerfStats } from "./_components/perf-stats";
import { ValueContributionsChart } from "./_components/value-contributions-chart";
import { GrowthChart, type BenchmarkSeries } from "./_components/growth-chart";
import { HoldingsPerformanceTable } from "./_components/holdings-performance-table";

type Period = "3M" | "6M" | "1Y" | "All";
const PERIODS: Period[] = ["3M", "6M", "1Y", "All"];
const PERIOD_DAYS: Record<Exclude<Period, "All">, number> = { "3M": 90, "6M": 180, "1Y": 365 };

type Scope = "stocks" | "crypto" | "all";
const SCOPES: { value: Scope; label: string }[] = [
  { value: "stocks", label: "Stocks" },
  { value: "crypto", label: "Crypto" },
  { value: "all", label: "All" },
];

// BTC benchmark line color — ECHARTS_COLORS[13], validated with the dataviz
// palette checker against blue [0] + orange [6] on both app surfaces.
const BTC_COLOR = "#c050b0";

interface BenchCache {
  fetchedAt: number;
  prices: { date: string; close: number }[];
}

async function loadBenchmark(
  symbol: "SPY" | "BTC",
  set: (prices: BenchCache["prices"]) => void,
): Promise<void> {
  const cacheKey = symbol === "SPY" ? "benchmark_spy_cache" : "benchmark_btc_cache";
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw) as BenchCache;
      if (Date.now() - cached.fetchedAt < 12 * 3600_000 && cached.prices?.length) {
        set(cached.prices);
        return;
      }
    }
  } catch {
    // fall through to refetch
  }
  try {
    // no-store: the route's public/s-maxage headers otherwise let the browser
    // heuristically reuse a stale response for this same URL; freshness is
    // already governed by the 12h localStorage cache above.
    const res = await fetch(`/api/benchmark?symbol=${symbol}&from=2020-01-01`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { prices: BenchCache["prices"] };
    if (!data.prices?.length) return;
    set(data.prices);
    localStorage.setItem(
      cacheKey,
      JSON.stringify({ fetchedAt: Date.now(), prices: data.prices } satisfies BenchCache),
    );
  } catch {
    // benchmark stays hidden
  }
}

export default function PerformancePage() {
  const [holdings] = useCloudStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [transactions] = useCloudStorage<PortfolioTransaction[]>("portfolio_transactions", []);
  const [snapshots] = useCloudStorage<SnapshotLike[]>("portfolio_snapshots", []);
  const [incomeEntries] = useCloudStorage<IncomeEntry[]>("income_entries", []);
  const [txCsvText] = useCloudStorage<string>("crypto_tx_csv_text", "");
  const [cryptoSnapshots] = useCloudStorage<SnapshotLike[]>("crypto_snapshots", []);
  const [stablecoinTags] = useCloudStorage<Record<string, boolean>>(
    "crypto_stablecoin_tags",
    {},
  );
  const [tickerMappings] = useCloudStorage<Record<string, string>>(
    "crypto_ticker_mappings",
    {},
  );
  const [cryptoPrices] = useCloudStorage<{ prices: Record<string, number> }>("crypto_prices", {
    prices: {},
  });
  const { convert, format } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [scope, setScope] = useState<Scope>("all");
  const [period, setPeriod] = useState<Period>("All");
  const [includeSuper, setIncludeSuper] = useState(true);
  // Transactions of deleted holdings ("removed"). Real exits belong in the
  // stats, but in practice deleted holdings are mostly renames/experiments
  // whose buys have no matching sell — they'd read as pure losses. Default
  // them OUT of the stats; the table still shows the aggregate row.
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [spy, setSpy] = useState<BenchCache["prices"] | null>(null);
  const [btc, setBtc] = useState<BenchCache["prices"] | null>(null);

  const today = getSydneyDateString();
  const toUsd = useMemo(
    () => (amount: number, from: string) => convert(amount, from, "USD"),
    [convert],
  );

  useEffect(() => {
    let cancelled = false;
    loadBenchmark("SPY", (p) => {
      if (!cancelled) setSpy(p);
    });
    loadBenchmark("BTC", (p) => {
      if (!cancelled) setBtc(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Stock derived data (all USD) ──
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

  const stockFlows = useMemo(
    () => netFlowsByDay(transactions, toUsd, holdingFilter),
    [transactions, toUsd, holdingFilter],
  );
  // Super holdings have no daily price feed — their recorded snapshot value
  // is flat between manual updates, then jumps. Replace the recorded super
  // component with a synthetic series built from logged super contributions
  // × a geometric growth ramp that lands on today's live value.
  const superFlows = useMemo(
    () => netFlowsByDay(transactions, toUsd, (id) => superIds.has(id)),
    [transactions, toUsd, superIds],
  );
  const currentSuperValueUsd = useMemo(
    () =>
      holdings
        .filter((h) => h.type !== "savings" && h.accountType === "super")
        .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency), 0),
    [holdings, toUsd],
  );
  // Clamped at the source to the first logged flow: snapshots that predate
  // any logged capital (seeded/demo history) would otherwise leak into the
  // All-scope merge via forward-fill even though the stocks scope excludes
  // them.
  const stockValues = useMemo(() => {
    const base = dailySnapshotValues(snapshots, false);
    const withSuper = includeSuper
      ? (() => {
          const synth = syntheticSuperSeries(
            base.map((v) => v.date),
            superFlows,
            currentSuperValueUsd,
            today,
          );
          return base.map((v, i) => ({ date: v.date, value: v.value + synth[i].value }));
        })()
      : base;
    const firstStockFlow = stockFlows[0]?.date ?? "0000-00-00";
    return withSuper.filter((v) => v.date >= firstStockFlow);
  }, [snapshots, includeSuper, stockFlows, superFlows, currentSuperValueUsd, today]);
  const stockCurrentValueUsd = useMemo(
    () =>
      holdings
        .filter((h) => h.type !== "savings" && (includeSuper || h.accountType !== "super"))
        .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency), 0),
    [holdings, includeSuper, toUsd],
  );
  const stockRows = useMemo(() => {
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

  const drift = useMemo(
    () => costBasisDrift(holdings, transactions, toUsd),
    [holdings, transactions, toUsd],
  );
  const dividendsUsd = useMemo(
    () =>
      incomeEntries
        .filter((e) => e.type === "dividend")
        .reduce((s, e) => s + toUsd(e.amount, e.currency), 0),
    [incomeEntries, toUsd],
  );

  // ── Crypto derived data (all USD; pot = non-cash tokens) ──
  const cryptoTxs = useMemo(() => (txCsvText ? parseCryptoCSV(txCsvText) : []), [txCsvText]);
  const isCash = useMemo(
    () => (token: string) => isCashLikeToken(token, stablecoinTags),
    [stablecoinTags],
  );
  const cryptoFlowsResult = useMemo(
    () => cryptoNetFlowsByDay(cryptoTxs, isCash),
    [cryptoTxs, isCash],
  );
  // Bootstrap guard: trims partial-coverage onboarding days and turns the
  // first trusted day's pot value into an opening deposit (pre-existing coins
  // entered tracking without logged buys — that's capital, not profit).
  const cryptoWindow = useMemo(() => {
    const snapVals = dailySnapshotValues(cryptoSnapshots, false);
    const pot = cryptoPotValues(snapVals, stableBalanceByDay(cryptoTxs, isCash));
    return bootstrapCryptoWindow(pot, cryptoFlowsResult.flows);
  }, [cryptoSnapshots, cryptoTxs, isCash, cryptoFlowsResult]);
  const cryptoValues = cryptoWindow.values;
  const cryptoFlows = cryptoWindow.flows;
  const cryptoRows = useMemo(
    () => perTokenStats(cryptoTxs, cryptoPrices.prices ?? {}, tickerMappings, isCash, today),
    [cryptoTxs, cryptoPrices, tickerMappings, isCash, today],
  );
  // All-time P&L in the crypto page's convention (unrealized + realized) —
  // shown as the crypto scope's Net Gain so every surface agrees.
  const cryptoPnl = useMemo(
    () => cryptoAllTimePnl(cryptoTxs, cryptoPrices.prices ?? {}, tickerMappings, isCash),
    [cryptoTxs, cryptoPrices, tickerMappings, isCash],
  );
  // Terminal pot value comes from the snapshot-based series, NOT Σ(tx-log
  // tokens × live price): coins held but never transacted (Earn/locked
  // positions) exist only in the holdings CSV → snapshots. Falls back to the
  // per-token sum when no snapshot history exists yet.
  const cryptoCurrentValueUsd = useMemo(() => {
    const lastPot = cryptoValues[cryptoValues.length - 1]?.value;
    if (lastPot != null && lastPot > 0) return lastPot;
    return cryptoRows.reduce((s, r) => s + r.valueUsd, 0);
  }, [cryptoValues, cryptoRows]);

  // ── Scope selection ──
  const scopeFlows = useMemo(() => {
    if (scope === "stocks") return stockFlows;
    if (scope === "crypto") return cryptoFlows;
    const merged = new Map<string, number>();
    for (const f of [...stockFlows, ...cryptoFlows]) {
      merged.set(f.date, (merged.get(f.date) ?? 0) + f.amount);
    }
    return [...merged.entries()]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [scope, stockFlows, cryptoFlows]);

  const scopeValues = useMemo(() => {
    if (scope === "stocks") return stockValues;
    if (scope === "crypto") return cryptoValues;
    // All: union of dates, forward-fill each side once it has appeared; days
    // before BOTH sides exist are dropped so the combined level is honest.
    const dates = [...new Set([...stockValues, ...cryptoValues].map((v) => v.date))].sort();
    const out: { date: string; value: number }[] = [];
    let si = -1;
    let ci = -1;
    let sLevel: number | null = null;
    let cLevel: number | null = null;
    for (const d of dates) {
      while (si + 1 < stockValues.length && stockValues[si + 1].date <= d) {
        si++;
        sLevel = stockValues[si].value;
      }
      while (ci + 1 < cryptoValues.length && cryptoValues[ci + 1].date <= d) {
        ci++;
        cLevel = cryptoValues[ci].value;
      }
      if (sLevel != null && cLevel != null) out.push({ date: d, value: sLevel + cLevel });
    }
    return out;
  }, [scope, stockValues, cryptoValues]);

  const scopeCurrentValueUsd =
    scope === "stocks"
      ? stockCurrentValueUsd
      : scope === "crypto"
        ? cryptoCurrentValueUsd
        : stockCurrentValueUsd + cryptoCurrentValueUsd;

  const scopeRows = useMemo(() => {
    const rows =
      scope === "stocks" ? stockRows : scope === "crypto" ? cryptoRows : [...stockRows, ...cryptoRows];
    return [...rows].sort((a, b) => {
      if (a.isOrphan !== b.isOrphan) return a.isOrphan ? 1 : -1;
      if (a.xirrPct == null && b.xirrPct == null) return b.gainUsd - a.gainUsd;
      if (a.xirrPct == null) return 1;
      if (b.xirrPct == null) return -1;
      return b.xirrPct - a.xirrPct;
    });
  }, [scope, stockRows, cryptoRows]);

  // ── Windowing + core metrics ──
  const contributions = useMemo(() => buildContributionSeries(scopeFlows), [scopeFlows]);
  const periodStart = useMemo(() => {
    if (period === "All") return "0000-00-00";
    const todayMs = Date.parse(today + "T00:00:00Z");
    return new Date(todayMs - PERIOD_DAYS[period] * 86400000).toISOString().slice(0, 10);
  }, [period, today]);

  // TWR is only meaningful where valuations correspond to logged capital —
  // snapshots that predate the first transaction (e.g. seeded/demo history)
  // would chain phantom returns into the index, so the window starts at the
  // first flow.
  const firstFlowDate = scopeFlows[0]?.date ?? "0000-00-00";
  const periodValues = useMemo(
    () => scopeValues.filter((v) => v.date >= periodStart && v.date >= firstFlowDate),
    [scopeValues, periodStart, firstFlowDate],
  );
  const twr = useMemo(() => computeTwr(periodValues, scopeFlows), [periodValues, scopeFlows]);

  // Money-weighted return over the whole investing life (not period-scoped —
  // XIRR answers "what has MY money earned per year", which only makes sense
  // across every flow; TWR + benchmarks are the period-scoped numbers).
  const xirrAllTime = useMemo(() => {
    const cf: CashFlow[] = scopeFlows.map((f) => ({ date: f.date, amount: -f.amount }));
    if (scopeCurrentValueUsd > 0) cf.push({ date: today, amount: scopeCurrentValueUsd });
    return xirr(cf);
  }, [scopeFlows, scopeCurrentValueUsd, today]);

  const netContributedUsd = useMemo(
    () => scopeFlows.reduce((s, f) => s + f.amount, 0),
    [scopeFlows],
  );
  const netGainUsd = scopeCurrentValueUsd - netContributedUsd;

  // ── Benchmarks indexed to the SAME window TWR covers ──
  const benchIndex = (prices: BenchCache["prices"] | null) => {
    if (!prices || prices.length === 0 || twr.series.length < 2) return null;
    const start = twr.series[0].date;
    const end = twr.series[twr.series.length - 1].date;
    const inWindow = prices.filter((p) => p.date >= start && p.date <= end);
    if (inWindow.length < 2) return null;
    const base = inWindow[0].close;
    return {
      series: inWindow.map((p) => ({ date: p.date, index: (p.close / base) * 100 })),
      totalReturn: inWindow[inWindow.length - 1].close / base - 1,
    };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spyStats = useMemo(() => benchIndex(spy), [spy, twr.series]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const btcStats = useMemo(() => benchIndex(btc), [btc, twr.series]);

  const growthBenchmarks = useMemo(() => {
    const list: BenchmarkSeries[] = [];
    if (scope === "crypto" && btcStats)
      list.push({ name: "BTC", color: BTC_COLOR, dashType: "dashed", series: btcStats.series });
    if (spyStats)
      list.push({
        name: "S&P 500",
        color: ECHARTS_COLORS[6],
        dashType: scope === "crypto" ? "dotted" : "dashed",
        series: spyStats.series,
      });
    return list;
  }, [scope, btcStats, spyStats]);

  const vs = useMemo(() => {
    const t = twr.totalReturn;
    if (scope === "crypto") {
      return {
        label: "VS BTC",
        pct: t != null && btcStats ? t - btcStats.totalReturn : null,
        sub:
          t != null && spyStats
            ? `vs S&P ${(t - spyStats.totalReturn) * 100 >= 0 ? "+" : ""}${((t - spyStats.totalReturn) * 100).toFixed(1)}pp`
            : "TWR minus BTC, same period",
      };
    }
    return {
      label: "VS S&P 500",
      pct: t != null && spyStats ? t - spyStats.totalReturn : null,
      sub: "TWR minus SPY, same period",
    };
  }, [scope, twr.totalReturn, btcStats, spyStats]);

  // Gain % — the comparable number: all-time P&L over cost basis for crypto
  // (same denominator as the Crypto page / trackers); gain over net
  // contributions for the flow-based scopes.
  const gainPct =
    scope === "crypto"
      ? cryptoPnl.costBasisUsd > 0
        ? cryptoPnl.totalUsd / cryptoPnl.costBasisUsd
        : null
      : netContributedUsd > 0
        ? netGainUsd / netContributedUsd
        : null;
  const fmtSignedUsd = (v: number) =>
    `${v >= 0 ? "+" : "-"}${format(Math.abs(convert(v, "USD")))}`;
  const gainSub =
    scope === "stocks" && dividendsUsd > 0
      ? `+ ${format(convert(dividendsUsd, "USD"))} dividends received`
      : scope === "crypto"
        ? `unrealized ${fmtSignedUsd(cryptoPnl.unrealizedUsd)} + realized ${fmtSignedUsd(cryptoPnl.realizedUsd)}, all-time`
        : "value − net contributions";

  const showCryptoEmpty = scope !== "stocks" && cryptoTxs.length === 0;

  return (
    <div className="space-y-6">
      {/* ── Header + controls ── */}
      <BlurFade>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Performance</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              What your money earned — top-ups stripped out.
              {scope === "crypto" && " Stablecoins count as cash; transfers count as yield."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg bg-secondary p-0.5">
              {SCOPES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScope(s.value)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                    scope === s.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {scope !== "crypto" && (
              <>
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
              </>
            )}
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

      {/* ── Crypto empty state ── */}
      {showCryptoEmpty && (
        <BlurFade delay={0.03}>
          <div className="finance-card px-4 py-3">
            <p className="text-xs text-muted-foreground">
              No crypto transaction CSV uploaded — the Crypto page&apos;s upload section feeds
              this scope{scope === "all" ? "; showing stocks only for now" : ""}.
            </p>
          </div>
        </BlurFade>
      )}

      {/* ── Data-quality banner (stock holdings) ── */}
      {scope !== "crypto" && drift.length > 0 && (
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
        netGainUsd={scope === "crypto" ? cryptoPnl.totalUsd : netGainUsd}
        gainPct={gainPct}
        gainSub={gainSub}
        vs={vs}
      />

      {/* ── Charts ── */}
      <ValueContributionsChart
        values={periodValues}
        contributions={contributions}
        isDark={isDark}
        subtitle={
          scope === "crypto"
            ? "The gap is market gains + yield your coins generated."
            : "The gap between the lines is money your investments actually made."
        }
      />
      <GrowthChart twrSeries={twr.series} benchmarks={growthBenchmarks} isDark={isDark} />

      {/* ── Per-holding table ── */}
      <HoldingsPerformanceTable
        rows={scopeRows}
        removedExcluded={!includeRemoved}
        footnote={
          scope !== "stocks" && cryptoFlowsResult.skippedUnpriced > 0
            ? `${cryptoFlowsResult.skippedUnpriced} unpriced crypto rows ignored in flows`
            : undefined
        }
      />
    </div>
  );
}
