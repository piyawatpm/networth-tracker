"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import {
  parseAndComputeHoldings,
  getTotalCryptoValueUsd,
  getTotalCryptoCostUsd,
  getCashValueUsd,
  computePortfolioHistory,
  applyStablecoinTags,
} from "@/lib/utils/crypto-csv";
import {
  fetchCryptoPrices,
  getCachedCryptoPrices,
  isCryptoPricesCacheStale,
  applyLivePrices,
} from "@/lib/utils/crypto-prices";
import type { CryptoHolding } from "@/lib/utils/types";
import { ECHARTS_COLORS } from "@/lib/utils/echarts";
import ReactECharts from "echarts-for-react";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadSection } from "./_components/upload-section";
import { PriceStatus } from "./_components/price-status";
import { HistoryChart } from "./_components/history-chart";
import { CryptoDonut } from "./_components/crypto-donut";
import { HoldingsBreakdown } from "./_components/holdings-breakdown";
import { CryptoValueTrend } from "./_components/crypto-value-trend";
import { TickerMappingDialog } from "./_components/ticker-mapping-dialog";

export default function CryptoPage() {
  const [csvText, setCsvText] = useCloudStorage<string>("crypto_csv_text", "");
  const { convert, currency, symbol, format } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Timestamps
  const [csvUploadedAt, setCsvUploadedAt] = useCloudStorage<number | null>(
    "crypto_csv_uploaded_at",
    null,
  );

  // Live prices
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  // Chart ref for highlight/downplay
  const donutRef = useRef<ReactECharts>(null);
  const highlightSlice = useCallback((name: string) => {
    donutRef.current?.getEchartsInstance()?.dispatchAction({ type: "highlight", name });
  }, []);
  const downplayAll = useCallback(() => {
    donutRef.current?.getEchartsInstance()?.dispatchAction({ type: "downplay" });
  }, []);

  // Exchange overrides (manual assignments persisted across CSV re-imports)
  const [exchangeOverrides, setExchangeOverrides] = useCloudStorage<Record<string, string>>(
    "crypto_exchange_overrides",
    {},
  );
  const [editingExchange, setEditingExchange] = useState<string | null>(null);
  const [editExchangeValue, setEditExchangeValue] = useState("");

  // Stablecoin tag overrides
  const [stablecoinTags, setStablecoinTags] = useCloudStorage<Record<string, boolean>>(
    "crypto_stablecoin_tags",
    {},
  );

  // Ticker mappings: CSV token name → Binance ticker symbol
  const [tickerMappings, setTickerMappings] = useCloudStorage<Record<string, string>>(
    "crypto_ticker_mappings",
    {},
  );

  const getExchange = useCallback(
    (holding: CryptoHolding) => exchangeOverrides[holding.token] ?? holding.exchange ?? "",
    [exchangeOverrides],
  );

  const saveExchange = useCallback(
    (token: string, value: string) => {
      setExchangeOverrides((prev) => ({
        ...prev,
        [token]: value.trim(),
      }));
      setEditingExchange(null);
    },
    [setExchangeOverrides],
  );

  const holdings = useMemo(
    () => (csvText ? parseAndComputeHoldings(csvText) : []),
    [csvText],
  );

  const portfolioHistory = useMemo(
    () => (csvText ? computePortfolioHistory(csvText) : []),
    [csvText],
  );

  // Apply stablecoin tags: merge user-tagged stablecoins into CASH
  const taggedHoldings = useMemo(
    () => applyStablecoinTags(holdings, stablecoinTags),
    [holdings, stablecoinTags],
  );

  // Map token names to Binance tickers for price fetching
  const getMappedTicker = useCallback(
    (token: string) => tickerMappings[token] ?? token,
    [tickerMappings],
  );

  // Fetch live prices on mount (if stale) and after CSV upload
  useEffect(() => {
    if (taggedHoldings.length === 0) return;
    // Use mapped tickers for price fetching
    const mappedTokens = taggedHoldings.map((h) => getMappedTicker(h.token));

    const cached = getCachedCryptoPrices();
    if (cached && !isCryptoPricesCacheStale()) {
      // Map cached prices back to original token names
      const mapped: Record<string, number> = {};
      for (const h of taggedHoldings) {
        const ticker = getMappedTicker(h.token);
        if (cached.prices[ticker]) mapped[h.token] = cached.prices[ticker];
      }
      setLivePrices(mapped);
      return;
    }

    fetchCryptoPrices(mappedTokens).then((prices) => {
      // Map prices back to original token names
      const mapped: Record<string, number> = {};
      for (const h of taggedHoldings) {
        const ticker = getMappedTicker(h.token);
        if (prices[ticker]) mapped[h.token] = prices[ticker];
      }
      if (Object.keys(mapped).length > 0) {
        setLivePrices(mapped);
      }
    });
  }, [taggedHoldings]);

  // Manual refresh prices
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshPrices = useCallback(async () => {
    if (taggedHoldings.length === 0) return;
    setIsRefreshing(true);
    try {
      const mappedTokens = taggedHoldings.map((h) => getMappedTicker(h.token));
      const prices = await fetchCryptoPrices(mappedTokens);
      const mapped: Record<string, number> = {};
      for (const h of taggedHoldings) {
        const ticker = getMappedTicker(h.token);
        if (prices[ticker]) mapped[h.token] = prices[ticker];
      }
      if (Object.keys(mapped).length > 0) {
        setLivePrices(mapped);
      }
    } catch { /* silent */ }
    setIsRefreshing(false);
  }, [taggedHoldings, getMappedTicker]);

  // Apply live prices to holdings
  const pricedHoldings = useMemo(
    () => applyLivePrices(taggedHoldings, livePrices),
    [taggedHoldings, livePrices],
  );

  const totalValueUsd = useMemo(
    () => getTotalCryptoValueUsd(pricedHoldings),
    [pricedHoldings],
  );
  const totalCostUsd = useMemo(
    () => getTotalCryptoCostUsd(pricedHoldings),
    [pricedHoldings],
  );
  const cashUsd = useMemo(() => getCashValueUsd(pricedHoldings), [pricedHoldings]);

  // ── Crypto snapshots (daily value tracking, like portfolio) ──
  const [cryptoSnapshots, setCryptoSnapshots] = useCloudStorage<
    { date: string; value: number; currency: string }[]
  >("crypto_snapshots", []);

  const totalValueConverted = useMemo(() => convert(totalValueUsd, "USD"), [totalValueUsd, convert]);
  // currency, symbol, format already destructured above

  useEffect(() => {
    if (totalValueConverted <= 0) return;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
    const existing = cryptoSnapshots.find((s) => s.date === today);
    if (existing && existing.currency === currency && Math.abs(existing.value - totalValueConverted) < 1) return;
    setCryptoSnapshots((prev) => [
      ...prev.filter((s) => s.date !== today).slice(-89),
      { date: today, value: totalValueConverted, currency },
    ]);
  }, [totalValueConverted, cryptoSnapshots, setCryptoSnapshots, currency]);

  const cryptoTrendData = useMemo(() => {
    return cryptoSnapshots.map((s) => {
      const val = s.currency !== currency ? Math.round(convert(s.value, s.currency) * 100) / 100 : s.value;
      return { date: s.date.slice(5), value: val };
    });
  }, [cryptoSnapshots, currency, convert]);

  // Interactive legend -- tracks which tokens are visible
  const [selectedTokens, setSelectedTokens] = useState<Record<string, boolean>>({});

  // Initialize selectedTokens when holdings change
  useEffect(() => {
    if (pricedHoldings.length > 0) {
      setSelectedTokens((prev) => {
        const next: Record<string, boolean> = {};
        for (const h of pricedHoldings) {
          next[h.token] = prev[h.token] ?? true;
        }
        return next;
      });
    }
  }, [pricedHoldings]);

  // Filtered metrics based on legend selection
  const filteredHoldings = useMemo(
    () => pricedHoldings.filter((h) => selectedTokens[h.token] !== false),
    [pricedHoldings, selectedTokens],
  );
  const filteredValueUsd = useMemo(
    () => getTotalCryptoValueUsd(filteredHoldings),
    [filteredHoldings],
  );
  const filteredCostUsd = useMemo(
    () => getTotalCryptoCostUsd(filteredHoldings),
    [filteredHoldings],
  );
  const filteredCashUsd = useMemo(
    () => getCashValueUsd(filteredHoldings),
    [filteredHoldings],
  );
  const filteredPnlUsd = filteredValueUsd - filteredCostUsd;

  const allSelected = pricedHoldings.length === filteredHoldings.length;

  // Chart data: all tokens for legend, filtered for donut
  const allChartTokens = useMemo(() => {
    if (totalValueUsd === 0) return [];
    return pricedHoldings
      .filter((h) => h.currentValueUsd / totalValueUsd >= 0.01)
      .map((h, i) => ({
        token: h.token,
        value: h.currentValueUsd,
        fill: ECHARTS_COLORS[i % ECHARTS_COLORS.length],
      }));
  }, [pricedHoldings, totalValueUsd]);

  // Donut data: only selected tokens
  const chartData = useMemo(() => {
    return allChartTokens.filter((d) => selectedTokens[d.token] !== false);
  }, [allChartTokens, selectedTokens]);

  // Exchange allocation data
  const exchangeData = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of pricedHoldings) {
      const ex = getExchange(h) || "Unassigned";
      map.set(ex, (map.get(ex) ?? 0) + h.currentValueUsd);
    }
    return Array.from(map.entries())
      .map(([name, value], i) => ({
        name,
        value,
        fill: ECHARTS_COLORS[(i + 5) % ECHARTS_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [pricedHoldings, getExchange]);

  // File handler for Replace CSV
  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text && text.trim().length > 0) {
          setCsvText(text);
          setCsvUploadedAt(Date.now());
          const h = parseAndComputeHoldings(text);
          if (h.length > 0) {
            const tokens = h.map((holding) => holding.token);
            fetchCryptoPrices(tokens).then((prices) => {
              if (Object.keys(prices).length > 0) {
                setLivePrices(prices);
              }
            });
          }
        }
      };
      reader.readAsText(file);
    },
    [setCsvText, setCsvUploadedAt],
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (e.target) e.target.value = "";
    },
    [handleFile],
  );

  const clearCsv = useCallback(() => {
    setCsvText("");
    setCsvUploadedAt(null);
  }, [setCsvText, setCsvUploadedAt]);

  const hasData = csvText.length > 0 && holdings.length > 0;

  // ── Empty state: CSV upload zone ──────────────────────────
  if (!hasData) {
    return (
      <UploadSection
        setCsvText={setCsvText}
        setCsvUploadedAt={setCsvUploadedAt}
        setLivePrices={setLivePrices}
      />
    );
  }

  // ── Portfolio view ────────────────────────────────────────
  return (
    <div className="space-y-8 overflow-x-hidden">
      <PriceStatus
        filteredValueUsd={filteredValueUsd}
        filteredCostUsd={filteredCostUsd}
        filteredPnlUsd={filteredPnlUsd}
        filteredCashUsd={filteredCashUsd}
        pricedHoldings={pricedHoldings}
        filteredHoldings={filteredHoldings}
        csvUploadedAt={csvUploadedAt}
        allSelected={allSelected}
        selectedTokens={selectedTokens}
        setSelectedTokens={setSelectedTokens}
        onFileSelect={onFileSelect}
        onRefreshPrices={refreshPrices}
        isRefreshing={isRefreshing}
      />

      {/* Ticker Mapping button */}
      <div className="flex justify-end">
        <TickerMappingDialog
          tokens={taggedHoldings.map((h) => h.token)}
          mappings={tickerMappings}
          onSave={setTickerMappings}
          trigger={
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Settings2 className="h-3.5 w-3.5" />
              Ticker Mapping
            </Button>
          }
        />
      </div>

      {/* Value Trend — daily snapshots */}
      {cryptoTrendData.length > 0 && (
        <CryptoValueTrend data={cryptoTrendData} isDark={isDark} symbol={symbol} format={format} />
      )}

      <HistoryChart
        portfolioHistory={portfolioHistory}
        isDark={isDark}
      />

      <HoldingsBreakdown
        pricedHoldings={pricedHoldings}
        holdings={holdings}
        totalValueUsd={totalValueUsd}
        selectedTokens={selectedTokens}
        setSelectedTokens={setSelectedTokens}
        allChartTokens={allChartTokens}
        donutNode={
          chartData.length > 0
            ? <CryptoDonut chartData={chartData} isDark={isDark} chartRef={donutRef} />
            : null
        }
        highlightSlice={highlightSlice}
        downplayAll={downplayAll}
        exchangeData={exchangeData}
        getExchange={getExchange}
        editingExchange={editingExchange}
        setEditingExchange={setEditingExchange}
        editExchangeValue={editExchangeValue}
        setEditExchangeValue={setEditExchangeValue}
        saveExchange={saveExchange}
        stablecoinTags={stablecoinTags}
        setStablecoinTags={setStablecoinTags}
        clearCsv={clearCsv}
      />
    </div>
  );
}
