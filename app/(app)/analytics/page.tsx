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
  computePnlAnalysis,
  reconstructStockSnapshots,
  reconstructCryptoSnapshots,
  computeDailyPnlSeries,
} from "@/lib/utils/pnl";
import type { HoldingPnl } from "@/lib/utils/pnl";
import type { PortfolioHolding, PortfolioTransaction, AnalyticsBaseline, CryptoDeposit } from "@/lib/utils/types";
import {
  depositsByDay,
  computeTwrSeries,
  holdingPnlSinceBaseline,
  type TwrPoint,
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
import { RebuildHistoryButton } from "./_components/rebuild-history-button";

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

  // Per-day EOD USD values (portfolio + crypto combined) from snapshots.
  // The cron writes every 15 min, so there are up to ~96 ticks per day per
  // table. Take the LAST tick of each day per table (sort asc, set by day
  // → last write wins), then sum portfolio + crypto per day.
  const dailyValuesUsd = useMemo(() => {
    const lastByDay = (rows: { date: string; value: number; valueWithSuper?: number }[], pickSuper: boolean) => {
      const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const m = new Map<string, number>();
      for (const r of sorted) {
        const day = r.date.slice(0, 10);
        const v = pickSuper ? (r.valueWithSuper ?? r.value) : r.value;
        m.set(day, v);
      }
      return m;
    };
    const port = lastByDay(portfolioSnapshots as { date: string; value: number; valueWithSuper?: number }[], true);
    const crypto = lastByDay(cryptoSnapshots as { date: string; value: number }[], false);
    const out = new Map<string, number>();
    for (const d of new Set([...port.keys(), ...crypto.keys()])) {
      out.set(d, (port.get(d) ?? 0) + (crypto.get(d) ?? 0));
    }
    return out;
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

  const pctByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of twrSeries) m.set(p.date, p.rDay * 100);
    return m;
  }, [twrSeries]);

  // Pre-computed per-tick performance rows from the cron (15-min resolution).
  // Drives the hero chart directly — no client-side TWR recompute for the chart.
  const [perfSnapshots, setPerfSnapshots] = useState<{
    timestamp: string;
    portfolioPct: number | null;
    spyPct: number | null;
    btcPct: number | null;
  }[]>([]);
  useEffect(() => {
    if (!baseline) return;
    fetch("/api/analytics/performance-snapshots")
      .then((r) => r.json())
      .then((j) => setPerfSnapshots(j.snapshots ?? []))
      .catch(() => setPerfSnapshots([]));
  }, [baseline]);

  // Live-override for the chart's trailing portfolio point so it tracks moves
  // between cron ticks. Uses the same TWR point we already compute for the
  // PnlHeader (latest cumulativePct).
  const livePortfolioPct = useMemo(() => {
    if (twrSeries.length === 0) return null;
    return twrSeries[twrSeries.length - 1].cumulativePct;
  }, [twrSeries]);

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

  const todayTwrPoint = twrSeries.length > 0 ? twrSeries[twrSeries.length - 1] : null;
  const prevTwrPoint = twrSeries.length > 1 ? twrSeries[twrSeries.length - 2] : null;
  const todayPnl = convert(todayTwrPoint ? todayTwrPoint.valueUsd - (prevTwrPoint?.valueUsd ?? baseline?.totals.combinedUsd ?? 0) - todayTwrPoint.depositsUsd : 0, "USD");
  const todayPnlPct = todayTwrPoint ? todayTwrPoint.rDay * 100 : 0;

  const rangePnls = useMemo<Record<"week" | "month" | "year" | "all", { value: number; pct: number }>>(() => {
    if (!baseline || twrSeries.length === 0) {
      return { week: { value: 0, pct: 0 }, month: { value: 0, pct: 0 }, year: { value: 0, pct: 0 }, all: { value: 0, pct: 0 } };
    }
    const weekCutoff = new Date(); weekCutoff.setDate(weekCutoff.getDate() - 7);
    const weekStart = weekCutoff.toISOString().slice(0, 10);
    const yearStart = today.slice(0, 4) + "-01-01";
    const last = twrSeries[twrSeries.length - 1];

    // "Since baseline" = the accumulated delta/cumulative % at the latest point.
    // Not a difference across rangeBetween — the baseline day IS the anchor,
    // so subtracting s.delta=end.delta would zero out same-day PnL.
    const since = (startDay: string): { value: number; pct: number } => {
      const clamped = startDay < baseline.date ? baseline.date : startDay;
      if (clamped <= baseline.date) {
        return { value: convert(last.deltaUsd, "USD"), pct: last.cumulativePct };
      }
      // Post-baseline start: find the point whose date is just < clamped.
      // That's the "prior" anchor; subtract its delta and divide cumFactors.
      let priorDelta = 0;
      let priorCumFactor = 1;
      for (const p of twrSeries) {
        if (p.date < clamped) {
          priorDelta = p.deltaUsd;
          priorCumFactor *= 1 + p.rDay;
        } else break;
      }
      const value = convert(last.deltaUsd - priorDelta, "USD");
      const endCumFactor = last.cumulativePct / 100 + 1;
      const rangeFactor = priorCumFactor > 0 ? endCumFactor / priorCumFactor : 1;
      return { value, pct: (rangeFactor - 1) * 100 };
    };

    return {
      week: since(weekStart),
      month: since(monthStart),
      year: since(yearStart),
      all: since(baseline.date),
    };
  }, [twrSeries, baseline, today, monthStart, convert]);



  // Last 30 days filter
  const last30 = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return dailyPnl.filter((d) => d.date >= cutoffStr);
  }, [dailyPnl]);

  const pnlByProduct = useMemo(() => {
    if (!baseline) return { portfolio: 0, crypto: 0 };
    // Portfolio side: sum(currentValue − baseline_value − stock deposits since baseline)
    const portfolioDepositsUsd = portfolioTransactions
      .filter((t) => t.date.slice(0, 10) > baseline.date)
      .reduce((s, t) => s + (t.type === "buy" ? 1 : -1) * convert(t.totalAmount, t.currency, "USD"), 0);
    const portfolioCurrentUsd = livePortfolioHoldings.reduce(
      (s, h) => s + convert(h.currentValue, h.currency, "USD"), 0,
    );
    const portfolioBaselineUsd = baseline.totals.portfolioUsd;
    const portfolio = portfolioCurrentUsd - portfolioBaselineUsd - portfolioDepositsUsd;

    const cryptoDepositsUsd = cryptoDeposits
      .filter((d) => d.date.slice(0, 10) > baseline.date)
      .reduce((s, d) => s + d.usdValueAtDeposit, 0);
    const cryptoCurrentUsd = cryptoHoldings.reduce((s, h) => s + h.currentValueUsd, 0);
    const cryptoBaselineUsd = baseline.totals.cryptoUsd;
    const crypto = cryptoCurrentUsd - cryptoBaselineUsd - cryptoDepositsUsd;

    return { portfolio: convert(portfolio, "USD"), crypto: convert(crypto, "USD") };
  }, [baseline, portfolioTransactions, livePortfolioHoldings, cryptoDeposits, cryptoHoldings, convert]);

  // Holdings PnL (baseline-aware)
  const holdingsPnl = useMemo(() => {
    if (!baseline) return [];
    const result: HoldingPnl[] = [];

    for (const h of livePortfolioHoldings) {
      const baseEntry = baseline.portfolio[h.id];
      const baseValueUsd = baseEntry?.valueUsd ?? 0;
      const currentUsd = convert(h.currentValue, h.currency, "USD");
      const depositsUsd = portfolioTransactions
        .filter((t) => t.holdingId === h.id && t.date.slice(0, 10) > baseline.date)
        .reduce((s, t) => s + (t.type === "buy" ? 1 : -1) * convert(t.totalAmount, t.currency, "USD"), 0);
      const { pnlUsd, pnlPct } = holdingPnlSinceBaseline({
        baselineValueUsd: baseValueUsd, currentValueUsd: currentUsd, depositsToHoldingUsd: depositsUsd,
      });
      result.push({
        name: h.name, ticker: h.ticker, type: "stock", units: h.units,
        currentValue: convert(currentUsd, "USD"),
        costBasis: convert(baseValueUsd + depositsUsd, "USD"),
        pnl: convert(pnlUsd, "USD"),
        pnlPct,
        currency: h.currency,
      });
    }

    for (const h of cryptoHoldings) {
      const baseEntry = baseline.crypto[h.token];
      const baseValueUsd = baseEntry?.valueUsd ?? 0;
      const depositsUsd = cryptoDeposits
        .filter((d) => d.token === h.token && d.date.slice(0, 10) > baseline.date)
        .reduce((s, d) => s + d.usdValueAtDeposit, 0);
      const { pnlUsd, pnlPct } = holdingPnlSinceBaseline({
        baselineValueUsd: baseValueUsd, currentValueUsd: h.currentValueUsd, depositsToHoldingUsd: depositsUsd,
      });
      result.push({
        name: h.token, ticker: h.token, type: "crypto", units: h.amount,
        currentValue: convert(h.currentValueUsd, "USD"),
        costBasis: convert(baseValueUsd + depositsUsd, "USD"),
        pnl: convert(pnlUsd, "USD"),
        pnlPct,
        currency: "USD",
      });
    }
    return result;
  }, [baseline, livePortfolioHoldings, portfolioTransactions, cryptoHoldings, cryptoDeposits, convert]);

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
        <RebuildHistoryButton
          baselineDate={baseline.date}
          onRebuilt={() => {
            // Backfill replaces baseline AND perf snapshots; refetch both.
            fetch("/api/analytics/baseline")
              .then((r) => r.json())
              .then((j) => {
                if (j.baseline) setBaseline(j.baseline);
              })
              .catch(() => {});
            fetch("/api/analytics/performance-snapshots")
              .then((r) => r.json())
              .then((j) => setPerfSnapshots(j.snapshots ?? []))
              .catch(() => {});
          }}
        />
      </div>

      <BlurFade delay={0}>
        <ComparisonChart
          snapshots={perfSnapshots}
          baselineDate={baseline.date}
          livePortfolioPct={livePortfolioPct}
        />
      </BlurFade>

      <BlurFade delay={D}>
        <PnlHeader
          todayPnl={todayPnl}
          todayPnlPct={todayPnlPct}
          rangePnls={rangePnls}
          estimatedBalance={estimatedBalance}
          format={format}
          symbol={symbol}
        />
      </BlurFade>

      <BlurFade delay={D * 1.5}>
        <DailyCalendar dailyPnl={dailyPnl} format={format} symbol={symbol} baselineDate={baseline.date} pctByDate={pctByDate} />
      </BlurFade>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <BlurFade delay={D * 2}>
          <PnlByProduct
            portfolioPnl={pnlByProduct.portfolio}
            cryptoPnl={pnlByProduct.crypto}
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
