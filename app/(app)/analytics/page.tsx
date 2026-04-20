"use client";

import { useMemo, useState, useEffect } from "react";

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
} from "@/lib/utils/pnl";
import type { PortfolioHolding, PortfolioTransaction } from "@/lib/utils/types";

// Sub-components (some don't exist yet — other tasks will create them)
import { PnlHeader } from "./_components/pnl-header";
import { DailyCalendar } from "./_components/daily-calendar";
import { ComparisonChart } from "./_components/comparison-chart";
import { PnlByProduct } from "./_components/pnl-by-product";
import { PnlAnalysisCard } from "./_components/pnl-analysis";
import { HoldingsPnlTable } from "./_components/holdings-pnl-table";
import { TopGainersLosers } from "./_components/top-gainers-losers";
import { AssetAllocationDonut } from "./_components/asset-allocation-donut";

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

interface Snapshot {
  date: string;
  value: number;
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

  const dailyPnl = useMemo(
    () => computeDailyPnl(portfolioSnapshots, cryptoSnapshots, nonSuperTxns, cryptoTxns, convert),
    [portfolioSnapshots, cryptoSnapshots, nonSuperTxns, cryptoTxns, convert],
  );

  const todayPnl = dailyPnl.find((d) => d.date === today)?.totalPnl ?? 0;

  // PnL totals for several time ranges. Week/Month/Year sum the daily snapshot
  // deltas. All-time uses cost-basis math (current value − cost basis + realized)
  // including super, since summing daily deltas accumulates phantoms from
  // unbalanced swap entries in the CSV (e.g. "buy syrupUSDC" rows whose matching
  // "sell USDC" leg never got exported). Cost-basis matches the HoldingsPnl table.
  const rangePnls = useMemo(() => {
    const weekCutoff = new Date();
    weekCutoff.setDate(weekCutoff.getDate() - 6); // last 7 days including today
    const weekStart = weekCutoff.toISOString().slice(0, 10);
    const yearStart = today.slice(0, 4) + "-01-01";
    const sumRange = (from: string) =>
      dailyPnl
        .filter((d) => d.date >= from && d.date <= today)
        .reduce((sum, d) => sum + d.totalPnl, 0);

    // All-time: include super by computing across ALL portfolio holdings, not the
    // super-filtered set used for the daily delta calculation.
    let allTime = 0;
    for (const h of livePortfolioHoldings) {
      allTime += convert(h.currentValue, h.currency) - convert(h.amountInvested, h.currency);
    }
    for (const h of cryptoHoldings) {
      const realized = h.realizedPnlUsd ?? 0;
      allTime += convert(h.currentValueUsd - h.totalCostUsd + realized, "USD");
    }

    return {
      week: sumRange(weekStart),
      month: sumRange(monthStart),
      year: sumRange(yearStart),
      all: allTime,
    };
  }, [dailyPnl, monthStart, today, livePortfolioHoldings, cryptoHoldings, convert]);


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

  return (
    <div className="space-y-6 pb-12">
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
        <ComparisonChart dailyPnl={dailyPnl} cryptoCsvText={cryptoCsvText} />
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
