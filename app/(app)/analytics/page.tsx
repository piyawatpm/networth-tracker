"use client";

import { useMemo, useState, useEffect, useCallback } from "react";

import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { getSydneyDateString } from "@/lib/utils/timezone";
import {
  parseCryptoCSV,
  parseAndComputeHoldings,
  getTotalCryptoValueUsd,
} from "@/lib/utils/crypto-csv";
import {
  applyLivePrices,
  fetchCryptoPrices,
  getCachedCryptoPrices,
  isCryptoPricesCacheStale,
} from "@/lib/utils/crypto-prices";
import { applyStablecoinTags } from "@/lib/utils/crypto-csv";
import { canAutoUpdate } from "@/lib/utils/prices";
import { useAlpacaWs } from "@/lib/hooks/use-alpaca-ws";
import { useBinanceWs } from "@/lib/hooks/use-binance-ws";
import {
  computeDailyPnl,
  computeHoldingsPnl,
  computePnlAnalysis,
  reconstructStockSnapshots,
  reconstructCryptoSnapshots,
  computeDailyPnlSeries,
} from "@/lib/utils/pnl";
import type { PortfolioHolding, PortfolioTransaction, AnalyticsBaseline, CryptoDeposit } from "@/lib/utils/types";
import {
  depositsByDay,
  computeTwrSeries,
  computeBenchmarkSeries,
  type TwrPoint,
  type BenchmarkPoint,
} from "@/lib/utils/analytics-baseline";

// Sub-components (some don't exist yet — other tasks will create them)
import { PnlHeader } from "./_components/pnl-header";
import { DailyCalendar } from "./_components/daily-calendar";
import { ComparisonChart } from "./_components/comparison-chart";
import { PnlByProduct } from "./_components/pnl-by-product";
import { PnlAnalysisCard } from "./_components/pnl-analysis";
import { HoldingsPnlTable } from "./_components/holdings-pnl-table";
import { TopGainersLosers } from "./_components/top-gainers-losers";
import { AssetAllocationDonut } from "./_components/asset-allocation-donut";
import { NoBaselineEmpty } from "./_components/no-baseline-empty";
import { ResetBaselineButton } from "./_components/reset-baseline-button";

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

interface Snapshot {
  date: string;
  value: number;
  valueWithSuper?: number; // portfolio_snapshots only — total incl super
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  // ---- Data sources -------------------------------------------------------
  const [portfolioHoldings] = useCloudStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [portfolioTransactions] = useCloudStorage<PortfolioTransaction[]>("portfolio_transactions", []);
  const [portfolioSnapshots] = useCloudStorage<Snapshot[]>("portfolio_snapshots", []);
  const [cryptoSnapshots] = useCloudStorage<Snapshot[]>("crypto_snapshots", []);
  const [cryptoCsvText] = useCloudStorage<string>("crypto_csv_text", "");
  const [stablecoinTags] = useCloudStorage<Record<string, boolean>>("crypto_stablecoin_tags", {});
  const [tickerMappings] = useCloudStorage<Record<string, string>>("crypto_ticker_mappings", {});

  const [baseline, setBaseline] = useState<AnalyticsBaseline | null>(null);
  const [cryptoDeposits, setCryptoDeposits] = useState<CryptoDeposit[]>([]);

  useEffect(() => {
    fetch("/api/analytics/baseline").then((r) => r.json()).then((j) => setBaseline(j.baseline ?? null)).catch(() => {});
    fetch("/api/crypto/deposits").then((r) => r.json()).then((j) => setCryptoDeposits(j.deposits ?? [])).catch(() => {});
  }, []);

  const { convert, format, symbol } = useCurrency();

  // ---- Real-time prices via WebSocket ------------------------------------

  // Alpaca WS for US stocks
  const stockWsSymbols = useMemo(() => {
    return portfolioHoldings
      .filter((h) => h.ticker && canAutoUpdate(h.ticker) && h.country?.toUpperCase() === "US")
      .map((h) => h.ticker.toUpperCase());
  }, [portfolioHoldings]);
  const { livePrices: finnhubPrices } = useAlpacaWs(stockWsSymbols);

  // Binance WS for crypto
  const rawCryptoHoldings = useMemo(
    () => (cryptoCsvText ? parseAndComputeHoldings(cryptoCsvText) : []),
    [cryptoCsvText],
  );
  const cryptoWsSymbols = useMemo(() => {
    const skip = new Set(["CASH", "USD", "USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD"]);
    const syms: string[] = [];
    for (const h of rawCryptoHoldings) {
      if (stablecoinTags[h.token]) continue;
      const mapped = tickerMappings[h.token];
      if (!mapped) continue;
      const upper = mapped.toUpperCase();
      if (skip.has(upper)) continue;
      const sym = `${upper}USDT`;
      if (!syms.includes(sym)) syms.push(sym);
    }
    return syms;
  }, [rawCryptoHoldings, tickerMappings, stablecoinTags]);
  const { livePrices: binancePrices } = useBinanceWs(cryptoWsSymbols);

  // Merge Binance WS prices into crypto holdings
  const [cryptoLivePrices, setCryptoLivePrices] = useState<Record<string, number>>({});
  useEffect(() => {
    if (Object.keys(binancePrices).length === 0) return;
    const mapped: Record<string, number> = {};
    for (const h of rawCryptoHoldings) {
      const ticker = tickerMappings[h.token] ?? h.token;
      const sym = `${ticker.toUpperCase()}USDT`;
      if (binancePrices[sym]) mapped[h.token] = binancePrices[sym].price;
    }
    if (Object.keys(mapped).length > 0) {
      setCryptoLivePrices((prev) => ({ ...prev, ...mapped }));
    }
  }, [binancePrices, rawCryptoHoldings, tickerMappings]);

  // Seed prices from REST cache so PnL is correct before the WS connects.
  // Without this, holdings render with currentValueUsd = totalCostUsd → 0 PnL.
  useEffect(() => {
    if (rawCryptoHoldings.length === 0) return;
    const mapTickers = (prices: Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const h of rawCryptoHoldings) {
        const ticker = tickerMappings[h.token] ?? h.token;
        if (prices[ticker]) out[h.token] = prices[ticker];
      }
      return out;
    };

    const cached = getCachedCryptoPrices();
    if (cached && !isCryptoPricesCacheStale()) {
      const mapped = mapTickers(cached.prices);
      if (Object.keys(mapped).length > 0) {
        setCryptoLivePrices((prev) => ({ ...mapped, ...prev }));
      }
      return;
    }

    const tokens = rawCryptoHoldings.map((h) => tickerMappings[h.token] ?? h.token);
    fetchCryptoPrices(tokens).then((prices) => {
      const mapped = mapTickers(prices);
      if (Object.keys(mapped).length > 0) {
        setCryptoLivePrices((prev) => ({ ...mapped, ...prev }));
      }
    });
  }, [rawCryptoHoldings, tickerMappings]);

  // Live portfolio holdings with Alpaca prices applied
  const livePortfolioHoldings = useMemo(() => {
    if (Object.keys(finnhubPrices).length === 0) return portfolioHoldings;
    return portfolioHoldings.map((h) => {
      const trade = finnhubPrices[h.ticker?.toUpperCase()];
      if (!trade) return h;
      const newValue = h.units * trade.price;
      if (Math.abs(newValue - h.currentValue) < 0.01) return h;
      return { ...h, currentValue: newValue };
    });
  }, [portfolioHoldings, finnhubPrices]);

  // Crypto holdings with stablecoin tags and live prices
  const cryptoHoldings = useMemo(() => {
    const tagged = applyStablecoinTags(rawCryptoHoldings, stablecoinTags);
    return applyLivePrices(tagged, cryptoLivePrices);
  }, [rawCryptoHoldings, stablecoinTags, cryptoLivePrices]);

  // Crypto transactions
  const cryptoTxns = useMemo(
    () => (cryptoCsvText ? parseCryptoCSV(cryptoCsvText) : []),
    [cryptoCsvText],
  );

  // ---- Derived analytics --------------------------------------------------

  const today = getSydneyDateString();
  const monthStart = today.slice(0, 7) + "-01";

  // portfolio_snapshots stores the no-super value, so we must exclude super
  // transactions from the cash-flow adjustment — otherwise super buys get
  // subtracted without ever showing up in the snapshot, creating phantom losses.
  const superHoldingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const h of portfolioHoldings) {
      if (h.accountType === "super") ids.add(h.id);
    }
    return ids;
  }, [portfolioHoldings]);

  const nonSuperTxns = useMemo(
    () => portfolioTransactions.filter((tx) => !superHoldingIds.has(tx.holdingId)),
    [portfolioTransactions, superHoldingIds],
  );

  // Reconstruct stock snapshots from transactions + Alpaca historical bars,
  // bypassing portfolio_snapshots' drift from backdated CSV/holding edits.
  const [stockHistory, setStockHistory] = useState<Record<string, { date: string; close: number }[]>>({});

  const stockTickers = useMemo(() => {
    const ids = new Set<string>();
    for (const h of portfolioHoldings) {
      if (h.accountType !== "super" && h.ticker) ids.add(h.ticker.toUpperCase());
    }
    return [...ids];
  }, [portfolioHoldings]);

  const stockTxnRange = useMemo(() => {
    const dates = portfolioTransactions
      .filter((t) => !superHoldingIds.has(t.holdingId))
      .map((t) => t.date.slice(0, 10))
      .sort();
    if (dates.length === 0) return null;
    return { from: dates[0], to: today };
  }, [portfolioTransactions, superHoldingIds, today]);

  useEffect(() => {
    if (stockTickers.length === 0 || !stockTxnRange) return;
    fetch(
      `/api/stock-history?tickers=${stockTickers.join(",")}&from=${stockTxnRange.from}&to=${stockTxnRange.to}`,
    )
      .then((r) => r.json())
      .then((j) => setStockHistory(j.data ?? {}))
      .catch(() => setStockHistory({}));
  }, [stockTickers, stockTxnRange]);

  const reconstructedStockSnapshots = useMemo(() => {
    if (!stockTxnRange || Object.keys(stockHistory).length === 0) return portfolioSnapshots;
    return reconstructStockSnapshots(
      portfolioTransactions,
      portfolioHoldings,
      stockHistory,
      stockTxnRange.from,
      stockTxnRange.to,
    );
  }, [stockHistory, stockTxnRange, portfolioTransactions, portfolioHoldings, portfolioSnapshots]);

  // Same reconstruction strategy for crypto: txns + Binance historical closes
  // → daily values. Bypasses cron snapshots that drift on backdated CSV uploads.
  const [cryptoHistory, setCryptoHistory] = useState<Record<string, { date: string; close: number }[]>>({});

  const cryptoTokens = useMemo(() => {
    const set = new Set<string>();
    for (const t of cryptoTxns) set.add(t.token);
    return [...set];
  }, [cryptoTxns]);

  const cryptoTxnRange = useMemo(() => {
    if (cryptoTxns.length === 0) return null;
    const dates = cryptoTxns.map((t) => t.date.slice(0, 10)).sort();
    return { from: dates[0], to: today };
  }, [cryptoTxns, today]);

  useEffect(() => {
    if (cryptoTokens.length === 0 || !cryptoTxnRange) return;
    fetch(
      `/api/historical-prices?tokens=${cryptoTokens.join(",")}&from=${cryptoTxnRange.from}&to=${cryptoTxnRange.to}`,
    )
      .then((r) => r.json())
      .then((j) => setCryptoHistory(j.data ?? {}))
      .catch(() => setCryptoHistory({}));
  }, [cryptoTokens, cryptoTxnRange]);

  const reconstructedCryptoSnapshots = useMemo(() => {
    if (!cryptoTxnRange || cryptoTxns.length === 0) return cryptoSnapshots;
    return reconstructCryptoSnapshots(
      cryptoTxns,
      cryptoHistory,
      cryptoTxnRange.from,
      cryptoTxnRange.to,
    );
  }, [cryptoTxns, cryptoHistory, cryptoTxnRange, cryptoSnapshots]);

  const dailyPnl = useMemo(
    () => computeDailyPnl(
      reconstructedStockSnapshots,
      reconstructedCryptoSnapshots,
      nonSuperTxns,
      cryptoTxns,
      convert,
    ),
    [reconstructedStockSnapshots, reconstructedCryptoSnapshots, nonSuperTxns, cryptoTxns, convert],
  );

  const todayPnl = dailyPnl.find((d) => d.date === today)?.totalPnl ?? 0;

  // Daily total-PnL series using avg-buy-price method (matches CMC).
  // For each day: stockPnl + cryptoPnl + superPnl, all in USD.
  // Range PnL = series[end] − series[start]; daily PnL = series[t] − series[t-1].
  const pnlSeries = useMemo(() => {
    const dates = [
      ...portfolioTransactions.map((t) => t.date.slice(0, 10)),
      ...cryptoTxns.map((t) => t.date.slice(0, 10)),
    ].sort();
    if (dates.length === 0) return [];
    return computeDailyPnlSeries({
      fromDate: dates[0],
      toDate: today,
      portfolioTxns: portfolioTransactions,
      cryptoTxns,
      portfolioHoldings,
      // Use rawCryptoHoldings (stable) instead of cryptoHoldings (live).
      // The series only reads amount/totalCostUsd/realizedPnlUsd — fields that
      // come from txn replay and don't change on WS price ticks. Using the
      // live-priced version causes pnlSeries to recompute on every WS tick,
      // which cascades into the comparison chart re-rendering constantly.
      cryptoHoldings: rawCryptoHoldings,
      stockBars: stockHistory,
      cryptoBars: cryptoHistory,
      cronPortfolioSnaps: portfolioSnapshots,
      fxToUsd: (amount, currency) => convert(amount, currency, "USD"),
    });
  }, [
    portfolioTransactions,
    cryptoTxns,
    portfolioHoldings,
    rawCryptoHoldings,
    stockHistory,
    cryptoHistory,
    portfolioSnapshots,
    convert,
    today,
  ]);

  // Per-day EOD USD values (portfolio + crypto combined) from snapshots
  const dailyValuesUsd = useMemo(() => {
    const map = new Map<string, number>();
    const take = (rows: { date: string; value: number; valueWithSuper?: number }[], kind: "port" | "crypto") => {
      for (const r of rows) {
        const day = r.date.slice(0, 10);
        const v = kind === "port" ? (r.valueWithSuper ?? r.value) : r.value;
        map.set(day, (map.get(day) ?? 0) + v);
      }
    };
    take(portfolioSnapshots as { date: string; value: number; valueWithSuper?: number }[], "port");
    take(cryptoSnapshots as { date: string; value: number }[], "crypto");
    return map;
  }, [portfolioSnapshots, cryptoSnapshots]);

  const depositsMap = useMemo(() => {
    if (!baseline) return new Map<string, number>();
    return depositsByDay({
      portfolioTxns: portfolioTransactions,
      cryptoDeposits,
      baselineDate: baseline.date,
      fxToUsd: (amount, currency) => convert(amount, currency, "USD"),
    });
  }, [baseline, portfolioTransactions, cryptoDeposits, convert]);

  const liveCombinedUsd = useMemo(() => {
    const portfolioTotal = livePortfolioHoldings.reduce(
      (s, h) => s + convert(h.currentValue, h.currency, "USD"), 0,
    );
    const cryptoTotal = cryptoHoldings.reduce((s, h) => s + h.currentValueUsd, 0);
    return portfolioTotal + cryptoTotal;
  }, [livePortfolioHoldings, cryptoHoldings, convert]);

  const twrSeries = useMemo<TwrPoint[]>(() => {
    if (!baseline) return [];
    return computeTwrSeries({
      baseline, dailyValuesUsd, deposits: depositsMap, today, liveValueUsd: liveCombinedUsd,
    });
  }, [baseline, dailyValuesUsd, depositsMap, today, liveCombinedUsd]);

  const [benchBars, setBenchBars] = useState<{ date: string; btc: number | null; spy: number | null }[]>([]);
  useEffect(() => {
    if (!baseline) return;
    fetch(`/api/comparison?from=${baseline.date}&to=${today}`)
      .then((r) => r.json())
      .then((j) => setBenchBars(j.data ?? []))
      .catch(() => setBenchBars([]));
  }, [baseline, today]);

  const spySeries = useMemo<BenchmarkPoint[]>(() => {
    if (!baseline) return [];
    return computeBenchmarkSeries({
      baselineDate: baseline.date,
      baselinePrice: baseline.benchmarks.spy,
      bars: benchBars.filter((b) => b.spy != null).map((b) => ({ date: b.date, close: b.spy as number })),
      today,
    });
  }, [baseline, benchBars, today]);

  const btcSeries = useMemo<BenchmarkPoint[]>(() => {
    if (!baseline) return [];
    return computeBenchmarkSeries({
      baselineDate: baseline.date,
      baselinePrice: baseline.benchmarks.btc,
      bars: benchBars.filter((b) => b.btc != null).map((b) => ({ date: b.date, close: b.btc as number })),
      today,
    });
  }, [baseline, benchBars, today]);

  const pnlAtDate = useCallback(
    (target: string): number => {
      // Find latest series point on/before target. If target is before all data → 0.
      let result = 0;
      for (const p of pnlSeries) {
        if (p.date <= target) result = p.totalUsd;
        else break;
      }
      return convert(result, "USD");
    },
    [pnlSeries, convert],
  );

  const rangePnls = useMemo(() => {
    const weekCutoff = new Date();
    weekCutoff.setDate(weekCutoff.getDate() - 7);
    const weekStart = weekCutoff.toISOString().slice(0, 10);
    const yearStart = today.slice(0, 4) + "-01-01";
    const todayPnl = pnlAtDate(today);

    // All-time: HoldingsPnl approach (current value − cost basis + realized).
    // The pnlSeries replay diverges from current holdings whenever the user's
    // txn ledger doesn't perfectly track every buy/sell — e.g. adjusting
    // holdings.units down without recording the sell, or setting an
    // amountInvested higher than the sum of buy txns. HoldingsPnl is the
    // source of truth for "current state" so we anchor All-time to it.
    let allTime = 0;
    for (const h of livePortfolioHoldings) {
      allTime += convert(h.currentValue, h.currency) - convert(h.amountInvested, h.currency);
    }
    for (const h of cryptoHoldings) {
      const realized = h.realizedPnlUsd ?? 0;
      allTime += convert(h.currentValueUsd - h.totalCostUsd + realized, "USD");
    }

    return {
      week: todayPnl - pnlAtDate(weekStart),
      month: todayPnl - pnlAtDate(monthStart),
      year: todayPnl - pnlAtDate(yearStart),
      all: allTime,
    };
  }, [pnlAtDate, monthStart, today, livePortfolioHoldings, cryptoHoldings, convert]);



  // Last 30 days filter
  const last30 = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return dailyPnl.filter((d) => d.date >= cutoffStr);
  }, [dailyPnl]);

  const portfolioPnl30d = useMemo(
    () => last30.reduce((s, d) => s + d.portfolioPnl, 0),
    [last30],
  );

  const cryptoPnl30d = useMemo(
    () => last30.reduce((s, d) => s + d.cryptoPnl, 0),
    [last30],
  );

  // Holdings PnL
  const holdingsPnl = useMemo(
    () => computeHoldingsPnl(livePortfolioHoldings, cryptoHoldings, convert),
    [livePortfolioHoldings, cryptoHoldings, convert],
  );

  // PnL analysis (win rate, cumulative profit/loss)
  const pnlAnalysis = useMemo(() => computePnlAnalysis(last30), [last30]);

  // Estimated balance = sum of all portfolio + crypto values
  const estimatedBalance = useMemo(() => {
    const portfolioTotal = livePortfolioHoldings.reduce(
      (s, h) => s + convert(h.currentValue, h.currency),
      0,
    );
    const cryptoTotal = convert(getTotalCryptoValueUsd(cryptoHoldings), "USD");
    return portfolioTotal + cryptoTotal;
  }, [livePortfolioHoldings, cryptoHoldings, convert]);

  // ---- Render -------------------------------------------------------------

  const D = 0.05;

  if (!baseline) {
    return (
      <div className="p-5">
        <NoBaselineEmpty onCreated={() => fetch("/api/analytics/baseline").then((r) => r.json()).then((j) => setBaseline(j.baseline))} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex justify-end">
        <ResetBaselineButton
          baselineDate={baseline.date}
          onReset={() => fetch("/api/analytics/baseline").then((r) => r.json()).then((j) => setBaseline(j.baseline))}
        />
      </div>

      <BlurFade delay={0}>
        <PnlHeader
          todayPnl={todayPnl}
          rangePnls={rangePnls}
          estimatedBalance={estimatedBalance}
          format={format}
          symbol={symbol}
        />
      </BlurFade>

      <BlurFade delay={D}>
        <DailyCalendar dailyPnl={dailyPnl} format={format} symbol={symbol} />
      </BlurFade>

      <BlurFade delay={D * 1.5}>
        <ComparisonChart pnlSeries={pnlSeries} />
      </BlurFade>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <BlurFade delay={D * 2}>
          <PnlByProduct
            portfolioPnl={portfolioPnl30d}
            cryptoPnl={cryptoPnl30d}
            format={format}
          />
        </BlurFade>
        <BlurFade delay={D * 3}>
          <PnlAnalysisCard analysis={pnlAnalysis} format={format} />
        </BlurFade>
      </div>

      <BlurFade delay={D * 4}>
        <AssetAllocationDonut
          holdings={holdingsPnl}
          format={format}
          symbol={symbol}
        />
      </BlurFade>

      <BlurFade delay={D * 5}>
        <TopGainersLosers holdings={holdingsPnl} format={format} />
      </BlurFade>

      <BlurFade delay={D * 6}>
        <HoldingsPnlTable
          holdings={holdingsPnl}
          format={format}
          symbol={symbol}
        />
      </BlurFade>
    </div>
  );
}
