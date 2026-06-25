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
  detectFormat,
  parseCryptoCSV,
  computeRealizedPnl,
} from "@/lib/utils/crypto-csv";
import {
  fetchCryptoPrices,
  getCachedCryptoPrices,
  isCryptoPricesCacheStale,
  applyLivePrices,
} from "@/lib/utils/crypto-prices";
import { resolveTokens, fetchCoinImages } from "@/lib/utils/crypto-symbol-resolver";
import type { CryptoHolding } from "@/lib/utils/types";
import { ECHARTS_COLORS } from "@/lib/utils/echarts";
import dynamic from "next/dynamic";
import { ReactECharts, type EChartsReact } from "@/components/ui/lazy-echarts";

import { Settings2, Wifi, WifiOff, FileText, RefreshCw, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { useBinanceWs } from "@/lib/hooks/use-binance-ws";
const PerformanceChart = dynamic(
  () => import("@/components/ui/performance-chart").then((m) => m.PerformanceChart),
  { ssr: false },
);
import { UploadSection } from "./_components/upload-section";
import { PriceStatus } from "./_components/price-status";
import { HistoryChart } from "./_components/history-chart";
import { CryptoDonut } from "./_components/crypto-donut";
import { HoldingsBreakdown } from "./_components/holdings-breakdown";
import { TickerMappingDialog } from "./_components/ticker-mapping-dialog";
import { RealizedPnl } from "./_components/realized-pnl";

export default function CryptoPage() {
  const [csvText, setCsvText] = useCloudStorage<string>("crypto_csv_text", "");
  const { convert } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Timestamps
  const [csvUploadedAt, setCsvUploadedAt] = useCloudStorage<number | null>(
    "crypto_csv_uploaded_at",
    null,
  );

  // Transaction History CSV (separate from the holdings CSV) — drives realized PnL
  const [txCsvText, setTxCsvText] = useCloudStorage<string>("crypto_tx_csv_text", "");
  const [txUploadedAt, setTxUploadedAt] = useCloudStorage<number | null>(
    "crypto_tx_uploaded_at",
    null,
  );

  // Live prices
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  // Chart ref for highlight/downplay
  const donutRef = useRef<EChartsReact>(null);
  // Hidden file input for Replace CSV action
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // Hidden file input for the Transaction History upload
  const txInputRef = useRef<HTMLInputElement>(null);
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

  // Emergency fund tag overrides
  const [emergencyTags, setEmergencyTags] = useCloudStorage<Record<string, boolean>>(
    "crypto_emergency_tags",
    {},
  );

  // Cash / dry-powder tag overrides
  const [cashTags, setCashTags] = useCloudStorage<Record<string, boolean>>(
    "crypto_cash_tags",
    {},
  );

  // Ticker mappings: CSV token name → Binance ticker symbol
  const [tickerMappings, setTickerMappings] = useCloudStorage<Record<string, string>>(
    "crypto_ticker_mappings",
    {},
  );

  // CSV token name → CoinGecko logo URL (populated by auto-resolver)
  const [coinImages, setCoinImages] = useCloudStorage<Record<string, string>>(
    "crypto_coin_images",
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

  // Build Binance WS symbols from ticker mappings
  const rawHoldings = useMemo(
    () => (csvText ? parseAndComputeHoldings(csvText) : []),
    [csvText],
  );

  // Auto-resolve ticker symbols + logos from CoinGecko for tokens missing info.
  // Runs when there are new unmapped tokens; ambiguous names pick by market cap.
  useEffect(() => {
    if (rawHoldings.length === 0) return;
    const skipStable = new Set(["CASH", "USD", "USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD"]);
    const needsResolve = rawHoldings
      .map((h) => h.token)
      .filter((token) => {
        if (stablecoinTags[token]) return false;
        if (skipStable.has(token.toUpperCase())) return false;
        return !tickerMappings[token] || !coinImages[token];
      });
    if (needsResolve.length === 0) return;

    let cancelled = false;
    (async () => {
      const resolved = await resolveTokens(needsResolve);
      if (cancelled || Object.keys(resolved).length === 0) return;

      setTickerMappings((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [token, info] of Object.entries(resolved)) {
          if (!next[token]) {
            next[token] = info.symbol;
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // Fetch logos only for tokens that don't already have one
      const idsToFetch: string[] = [];
      const tokenByIdForFetch = new Map<string, string>();
      for (const [token, info] of Object.entries(resolved)) {
        if (!coinImages[token]) {
          idsToFetch.push(info.id);
          tokenByIdForFetch.set(info.id, token);
        }
      }
      if (idsToFetch.length === 0) return;

      const images = await fetchCoinImages(idsToFetch);
      if (cancelled || Object.keys(images).length === 0) return;

      setCoinImages((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, url] of Object.entries(images)) {
          const token = tokenByIdForFetch.get(id);
          if (token && !next[token]) {
            next[token] = url;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [rawHoldings, tickerMappings, coinImages, stablecoinTags, setTickerMappings, setCoinImages]);

  const wsSymbols = useMemo(() => {
    if (rawHoldings.length === 0) return [];
    const symbols: string[] = [];
    const skip = new Set(["CASH", "USD", "USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD"]);
    for (const h of rawHoldings) {
      // Skip stablecoin-tagged tokens
      if (stablecoinTags[h.token]) continue;
      // Use ticker mapping if available; skip tokens without a mapping
      // (raw CSV names like "Bitcoin" aren't valid Binance symbols)
      const mapped = tickerMappings[h.token];
      if (!mapped) continue;
      const upper = mapped.toUpperCase();
      if (skip.has(upper)) continue;
      const sym = `${upper}USDT`;
      if (!symbols.includes(sym)) {
        symbols.push(sym);
      }
    }
    return symbols;
  }, [rawHoldings, tickerMappings, stablecoinTags]);

  const { livePrices: wsLivePrices, connected: wsConnected } = useBinanceWs(wsSymbols);

  // Merge WS prices into token-name keyed prices
  useEffect(() => {
    if (Object.keys(wsLivePrices).length === 0) return;
    const mapped: Record<string, number> = {};
    for (const h of rawHoldings) {
      const ticker = tickerMappings[h.token] ?? h.token;
      const sym = `${ticker.toUpperCase()}USDT`;
      if (wsLivePrices[sym]) {
        mapped[h.token] = wsLivePrices[sym].price;
      }
    }
    if (Object.keys(mapped).length > 0) {
      setLivePrices((prev) => ({ ...prev, ...mapped }));
    }
  }, [wsLivePrices, rawHoldings, tickerMappings]);

  const holdings = rawHoldings;

  const portfolioHistory = useMemo(
    () => (csvText ? computePortfolioHistory(csvText) : []),
    [csvText],
  );

  // Realized PnL from the (separate) Transaction History CSV — null until uploaded
  const realizedPnl = useMemo(
    () => (txCsvText ? computeRealizedPnl(parseCryptoCSV(txCsvText)) : null),
    [txCsvText],
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

  // Crypto snapshots — no longer auto-saved client-side.
  // Snapshots are created by: manual snapshot button (📷) or daily cron.

  // Snapshots for PerformanceChart (raw — chart handles conversion)
  const cryptoChartSnapshots = useMemo(() => {
    return cryptoSnapshots.map((s) => ({
      date: s.date,
      value: s.value,
      currency: s.currency ?? "USD",
    }));
  }, [cryptoSnapshots]);

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
  const [replaceStatus, setReplaceStatus] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const handleFile = useCallback(
    (file: File) => {
      setReplaceStatus("Reading file…");
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text || text.trim().length === 0) {
          setReplaceStatus("File was empty");
          return;
        }
        const format = detectFormat(text);
        const h = parseAndComputeHoldings(text);
        if (h.length === 0) {
          setReplaceStatus("Could not parse holdings — check CSV format");
          return;
        }
        setCsvText(text);
        setCsvUploadedAt(Date.now());
        const formatLabel =
          format === "transactions"
            ? "Transaction History"
            : format === "portfolio_overview"
              ? "Portfolio Overview"
              : "Unknown format";
        setReplaceStatus(`Loaded ${h.length} holdings (${formatLabel}) — snapshotting…`);
        // Use ticker mapping if set, otherwise the raw token name (which is
        // already a valid Binance ticker for Transaction-format exports).
        const mappedTokens = h.map((holding) => tickerMappings[holding.token] ?? holding.token);
        fetchCryptoPrices(mappedTokens).then((prices) => {
          const remapped: Record<string, number> = {};
          for (const holding of h) {
            const ticker = tickerMappings[holding.token] ?? holding.token;
            if (prices[ticker] != null) remapped[holding.token] = prices[ticker];
          }
          if (Object.keys(remapped).length > 0) setLivePrices(remapped);
        });
        // Auto-trigger /api/snapshot so the cron's next read isn't stale.
        // Wait for setCsvText's debounced KV write (~500ms) before snapshotting.
        window.setTimeout(() => {
          fetch("/api/snapshot", { method: "POST" })
            .then(async (r) => {
              if (r.ok) {
                setReplaceStatus(`Loaded ${h.length} holdings (${formatLabel}) — snapshot updated`);
              } else {
                setReplaceStatus(`Loaded ${h.length} holdings (${formatLabel}) — snapshot failed`);
              }
            })
            .catch(() => {
              setReplaceStatus(`Loaded ${h.length} holdings (${formatLabel}) — snapshot failed`);
            })
            .finally(() => {
              window.setTimeout(() => setReplaceStatus(null), 3000);
            });
        }, 600);
      };
      reader.readAsText(file);
    },
    [setCsvText, setCsvUploadedAt, tickerMappings],
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (e.target) e.target.value = "";
    },
    [handleFile],
  );

  // Transaction History upload — realized PnL only, no holdings/snapshot impact
  const handleTxFile = useCallback(
    (file: File) => {
      setTxStatus("Reading file…");
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text || text.trim().length === 0) {
          setTxStatus("File was empty");
          window.setTimeout(() => setTxStatus(null), 4000);
          return;
        }
        if (detectFormat(text) !== "transactions") {
          setTxStatus(
            "Not a Transaction History export — this slot needs the transactions CSV (buy/sell rows), not Portfolio Overview.",
          );
          window.setTimeout(() => setTxStatus(null), 6000);
          return;
        }
        const result = computeRealizedPnl(parseCryptoCSV(text));
        setTxCsvText(text);
        setTxUploadedAt(Date.now());
        setTxStatus(`Loaded — realized PnL across ${result.byToken.length} coins`);
        window.setTimeout(() => setTxStatus(null), 4000);
      };
      reader.onerror = () => setTxStatus("Error reading file");
      reader.readAsText(file);
    },
    [setTxCsvText, setTxUploadedAt],
  );

  const onTxFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleTxFile(file);
      if (e.target) e.target.value = "";
    },
    [handleTxFile],
  );

  const clearTx = useCallback(() => {
    setTxCsvText("");
    setTxUploadedAt(null);
  }, [setTxCsvText, setTxUploadedAt]);

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
      {/* ── Action Bar ── */}
      <BlurFade delay={0}>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <button
            onClick={refreshPrices}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            <span className="hidden sm:inline">{isRefreshing ? "Fetching..." : "Refresh Prices"}</span>
            <span className="sm:hidden">{isRefreshing ? "..." : "Refresh"}</span>
          </button>
          <button
            onClick={() => replaceInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 shrink-0"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Replace CSV</span>
            <span className="sm:hidden">CSV</span>
          </button>
          <button
            onClick={() => txInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 shrink-0"
          >
            <Receipt className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Upload Transactions</span>
            <span className="sm:hidden">Txns</span>
          </button>
          <TickerMappingDialog
            tokens={taggedHoldings.map((h) => h.token)}
            mappings={tickerMappings}
            onSave={setTickerMappings}
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5 text-xs shrink-0">
                <Settings2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Ticker Mapping</span>
                <span className="sm:hidden">Tickers</span>
              </Button>
            }
          />
          <input
            ref={replaceInputRef}
            type="file"
            accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
            onChange={onFileSelect}
            className="hidden"
          />
          <input
            ref={txInputRef}
            type="file"
            accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
            onChange={onTxFileSelect}
            className="hidden"
          />
          {replaceStatus && (
            <span className="text-[10px] font-mono text-muted-foreground basis-full text-right">
              {replaceStatus}
            </span>
          )}
          {txStatus && (
            <span className="text-[10px] font-mono text-muted-foreground basis-full text-right">
              {txStatus}
            </span>
          )}
        </div>
      </BlurFade>

      {/* ── Performance Chart (single source of the total value) ── */}
      <BlurFade delay={0.05}>
        <PerformanceChart
          label="Crypto Portfolio"
          currentValue={totalValueConverted}
          snapshots={cryptoChartSnapshots}
          isLive={wsSymbols.length > 0}
          defaultPeriod="1D"
        />
      </BlurFade>

      {/* ── Summary Tiles ── */}
      <PriceStatus
        filteredCostUsd={filteredCostUsd}
        filteredPnlUsd={filteredPnlUsd}
        filteredCashUsd={filteredCashUsd}
        pricedHoldings={pricedHoldings}
        filteredHoldings={filteredHoldings}
        allSelected={allSelected}
        setSelectedTokens={setSelectedTokens}
      />

      {/* ── Realized P&L (from Transaction History CSV) ── */}
      <RealizedPnl
        realized={realizedPnl}
        onUpload={() => txInputRef.current?.click()}
        uploadedAt={txUploadedAt}
        onClear={clearTx}
      />

      {/* ── Live WebSocket Status (moved below overview) ── */}
      <BlurFade delay={0.1}>
        <div className="finance-card px-3 py-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3">
            <p className="label-mono">Live Prices</p>
            <span className={cn(
              "flex items-center gap-1 text-[10px] font-mono",
              wsConnected ? "text-income" : "text-muted-foreground/50",
            )}>
              {wsConnected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
              {wsConnected ? "LIVE" : "Connecting..."}
            </span>
            {csvUploadedAt && (
              <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                CSV · {new Date(csvUploadedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {rawHoldings
              .filter((h) => !stablecoinTags[h.token])
              .map((h) => {
                const mapped = tickerMappings[h.token];
                const sym = mapped ? `${mapped.toUpperCase()}USDT` : null;
                const isLive = sym ? !!wsLivePrices[sym] : false;
                const hasMapping = !!mapped;
                return (
                  <span
                    key={h.token}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono",
                      isLive
                        ? "bg-income/10 text-income"
                        : hasMapping
                          ? "bg-accent/10 text-accent"
                          : "bg-muted text-muted-foreground/50",
                    )}
                  >
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      isLive ? "bg-income animate-pulse" : hasMapping ? "bg-accent" : "bg-muted-foreground/30",
                    )} />
                    {mapped?.toUpperCase() ?? h.token.slice(0, 6)}
                  </span>
                );
              })}
          </div>
        </div>
      </BlurFade>

      <HistoryChart
        portfolioHistory={portfolioHistory}
        isDark={isDark}
      />

      <HoldingsBreakdown
        pricedHoldings={pricedHoldings}
        holdings={holdings}
        totalValueUsd={totalValueUsd}
        livePrices={livePrices}
        coinImages={coinImages}
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
        emergencyTags={emergencyTags}
        setEmergencyTags={setEmergencyTags}
        cashTags={cashTags}
        setCashTags={setCashTags}
        clearCsv={clearCsv}
      />
    </div>
  );
}
