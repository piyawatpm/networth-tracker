"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import {
  parseAndComputeHoldings,
  getTotalCryptoValueUsd,
  getTotalCryptoCostUsd,
  getCashValueUsd,
  computePortfolioHistory,
} from "@/lib/utils/crypto-csv";
import {
  fetchCryptoPrices,
  getCachedCryptoPrices,
  isCryptoPricesCacheStale,
  applyLivePrices,
} from "@/lib/utils/crypto-prices";
import { cn } from "@/lib/utils";
import type { CryptoHolding } from "@/lib/utils/types";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import ReactECharts from "echarts-for-react";
import { ECHARTS_COLORS, getPieBaseOption, getCartesianBaseOption } from "@/lib/utils/echarts";
import { Upload, FileText, X, Bitcoin, ArrowUpDown, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";

function CryptoDonut({
  chartData,
  isDark,
}: {
  chartData: { token: string; value: number; fill: string }[];
  isDark: boolean;
}) {
  const base = getPieBaseOption(isDark);
  const option = useMemo(
    () => ({
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["46%", "76%"],
          center: ["50%", "50%"],
          padAngle: 2,
          data: chartData.map((d) => ({
            name: d.token,
            value: d.value,
            itemStyle: { color: d.fill },
          })),
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.3)",
            },
          },
        },
      ],
    }),
    [base, chartData],
  );

  return <ReactECharts option={option} style={{ height: 260, width: "100%" }} />;
}

export default function CryptoPage() {
  const [csvText, setCsvText] = useLocalStorage<string>("crypto_csv_text", "");
  const { format, convert, symbol } = useCurrency();
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Timestamps
  const [csvUploadedAt, setCsvUploadedAt] = useLocalStorage<number | null>(
    "crypto_csv_uploaded_at",
    null,
  );

  // Clear confirmation dialog
  const [showClearDialog, setShowClearDialog] = useState(false);

  // Live prices
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  // Exchange overrides (manual assignments persisted across CSV re-imports)
  const [exchangeOverrides, setExchangeOverrides] = useLocalStorage<Record<string, string>>(
    "crypto_exchange_overrides",
    {},
  );
  const [editingExchange, setEditingExchange] = useState<string | null>(null);
  const [editExchangeValue, setEditExchangeValue] = useState("");

  // Stablecoin tag overrides
  const [stablecoinTags, setStablecoinTags] = useLocalStorage<Record<string, boolean>>(
    "crypto_stablecoin_tags",
    {},
  );
  const [showTagDialog, setShowTagDialog] = useState(false);

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

  // Trend chart range (declared early so filteredHistory can reference it)
  const [trendRange, setTrendRange] = useState<"1W" | "1M" | "3M" | "All">("All");

  const portfolioHistory = useMemo(
    () => (csvText ? computePortfolioHistory(csvText) : []),
    [csvText],
  );

  const filteredHistory = useMemo(() => {
    if (trendRange === "All" || portfolioHistory.length === 0) return portfolioHistory;
    const now = new Date();
    let cutoff: Date;
    switch (trendRange) {
      case "1W":
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "1M":
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "3M":
        cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
    }
    const cutoffStr = cutoff!.toISOString().split("T")[0];
    return portfolioHistory.filter((s) => s.date >= cutoffStr);
  }, [portfolioHistory, trendRange]);

  // Apply stablecoin tags: merge user-tagged stablecoins into CASH
  const taggedHoldings = useMemo(() => {
    const stableTokens = Object.entries(stablecoinTags)
      .filter(([, isStable]) => isStable)
      .map(([token]) => token);

    if (stableTokens.length === 0) return holdings;

    const cashHolding: CryptoHolding = {
      token: "CASH",
      amount: 0,
      totalCostUsd: 0,
      currentValueUsd: 0,
      exchange: undefined,
    };
    const result: CryptoHolding[] = [];

    for (const h of holdings) {
      if (h.token === "CASH" || stableTokens.includes(h.token)) {
        cashHolding.amount += h.amount;
        cashHolding.totalCostUsd += h.totalCostUsd;
        cashHolding.currentValueUsd += h.currentValueUsd;
        // Merge exchanges
        if (h.exchange) {
          cashHolding.exchange = cashHolding.exchange
            ? `${cashHolding.exchange}, ${h.exchange}`
            : h.exchange;
        }
      } else {
        result.push(h);
      }
    }

    if (cashHolding.amount > 0.0001) {
      result.push(cashHolding);
    }

    return result.sort((a, b) => b.currentValueUsd - a.currentValueUsd);
  }, [holdings, stablecoinTags]);

  // Fetch live prices on mount (if stale) and after CSV upload
  useEffect(() => {
    if (taggedHoldings.length === 0) return;
    const tokens = taggedHoldings.map((h) => h.token);

    // Use cache if fresh
    const cached = getCachedCryptoPrices();
    if (cached && !isCryptoPricesCacheStale()) {
      setLivePrices(cached.prices);
      return;
    }

    // Fetch fresh prices
    fetchCryptoPrices(tokens).then((prices) => {
      if (Object.keys(prices).length > 0) {
        setLivePrices(prices);
      }
    });
  }, [taggedHoldings]);

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
  const pnlUsd = totalValueUsd - totalCostUsd;

  const totalValueConverted = convert(totalValueUsd, "USD");
  const totalCostConverted = convert(totalCostUsd, "USD");
  const pnlConverted = convert(pnlUsd, "USD");
  const cashConverted = convert(cashUsd, "USD");

  // Interactive legend — tracks which tokens are visible
  const [selectedTokens, setSelectedTokens] = useState<Record<string, boolean>>({});

  // Table sorting
  type SortField = "token" | "amount" | "value" | "cost" | "pnl" | "pct" | "exchange";
  const [sortField, setSortField] = useState<SortField>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  // Initialize selectedTokens when holdings change
  useEffect(() => {
    if (pricedHoldings.length > 0) {
      setSelectedTokens((prev) => {
        const next: Record<string, boolean> = {};
        for (const h of pricedHoldings) {
          // Keep existing selection, default to true for new tokens
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

  // Chart data: exclude tiny holdings (< 1% of total)
  const chartData = useMemo(() => {
    if (totalValueUsd === 0) return [];
    return pricedHoldings
      .filter((h) => h.currentValueUsd / totalValueUsd >= 0.01)
      .map((h, i) => ({
        token: h.token,
        value: h.currentValueUsd,
        fill: ECHARTS_COLORS[i % ECHARTS_COLORS.length],
      }));
  }, [pricedHoldings, totalValueUsd]);

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

  const sortedHoldings = useMemo(() => {
    const list = [...pricedHoldings];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "token":
          cmp = a.token.localeCompare(b.token);
          break;
        case "amount":
          cmp = a.amount - b.amount;
          break;
        case "value":
          cmp = a.currentValueUsd - b.currentValueUsd;
          break;
        case "cost":
          cmp = a.totalCostUsd - b.totalCostUsd;
          break;
        case "pnl":
          cmp = (a.currentValueUsd - a.totalCostUsd) - (b.currentValueUsd - b.totalCostUsd);
          break;
        case "pct":
          cmp = a.currentValueUsd - b.currentValueUsd; // same as value sort
          break;
        case "exchange":
          cmp = (getExchange(a)).localeCompare(getExchange(b));
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [pricedHoldings, sortField, sortDir, getExchange]);

  const handleFile = useCallback(
    (file: File) => {
      setUploadStatus("Reading file...");
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text && text.trim().length > 0) {
          setCsvText(text);
          setCsvUploadedAt(Date.now());
          const h = parseAndComputeHoldings(text);
          if (h.length > 0) {
            setUploadStatus(`Loaded ${h.length} holdings`);
            // Re-fetch prices for new portfolio
            const tokens = h.map((holding) => holding.token);
            fetchCryptoPrices(tokens).then((prices) => {
              if (Object.keys(prices).length > 0) {
                setLivePrices(prices);
              }
            });
          } else {
            setUploadStatus("Could not parse holdings. Check CSV format.");
          }
        } else {
          setUploadStatus("File was empty");
        }
      };
      reader.onerror = () => {
        setUploadStatus("Error reading file");
      };
      reader.readAsText(file);
    },
    [setCsvText, setCsvUploadedAt],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

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
    setUploadStatus(null);
    setShowClearDialog(false);
  }, [setCsvText, setCsvUploadedAt]);

  const hasData = csvText.length > 0 && holdings.length > 0;

  // ── Empty state: CSV upload zone ──────────────────────────
  if (!hasData) {
    return (
      <div className="space-y-8">
        <BlurFade delay={0}>
          <div>
            <p className="label-mono mb-2">CRYPTO PORTFOLIO</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Import your crypto data
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Upload a CSV export from your exchange to track holdings,
              allocations, and profit/loss.
            </p>
          </div>
        </BlurFade>

        <BlurFade delay={0.08}>
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "finance-card flex flex-col items-center justify-center gap-4 p-12 md:p-20 cursor-pointer border-2 border-dashed transition-colors",
              isDragOver
                ? "border-accent bg-accent/5"
                : "border-border/60 hover:border-muted-foreground/30",
            )}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                Drop your CSV file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Accepts .csv files from crypto exchanges
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
              onChange={onFileSelect}
              className="hidden"
            />
          </div>
          {uploadStatus && (
            <p className="text-xs text-muted-foreground text-center mt-2">{uploadStatus}</p>
          )}
        </BlurFade>
      </div>
    );
  }

  // ── Portfolio view ────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Hero */}
      <BlurFade delay={0}>
        <div className="flex items-start justify-between">
          <div>
            <p className="label-mono mb-2">CRYPTO PORTFOLIO</p>
            <div className="display-number">
              {symbol}
              <NumberTicker value={convert(filteredValueUsd, "USD")} decimalPlaces={2} />
            </div>
            {csvUploadedAt && (
              <p className="text-xs text-muted-foreground mt-2">
                CSV: {new Date(csvUploadedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                {getCachedCryptoPrices()?.fetchedAt && (
                  <>
                    {" · Prices: "}
                    {new Date(getCachedCryptoPrices()!.fetchedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                  </>
                )}
              </p>
            )}
          </div>
          <button
            onClick={() => replaceInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <FileText className="h-3.5 w-3.5" />
            Replace CSV
          </button>
          <input
            ref={replaceInputRef}
            type="file"
            accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
      </BlurFade>

      {/* Metrics tile */}
      <BlurFade delay={0.06}>
        <div className="finance-card flex flex-col divide-y divide-border/60 sm:flex-row sm:divide-x sm:divide-y-0">
          <MetricCell label="Total Value" value={format(filteredValueUsd, "USD")} />
          <MetricCell label="Total Cost" value={format(filteredCostUsd, "USD")} />
          <MetricCell
            label="P&L"
            value={`${format(Math.abs(filteredPnlUsd), "USD")} (${filteredCostUsd > 0 ? ((filteredPnlUsd / filteredCostUsd) * 100).toFixed(1) : "0.0"}%)`}
            prefix={filteredPnlUsd >= 0 ? "+" : "-"}
            className={filteredPnlUsd >= 0 ? "text-income" : "text-expense"}
          />
          <MetricCell label="Cash" value={format(filteredCashUsd, "USD")} />
          <MetricCell label="Holdings" value={String(pricedHoldings.length)} />
        </div>
      </BlurFade>

      {!allSelected && (
        <p className="text-xs text-muted-foreground">
          Showing {filteredHoldings.length} of {pricedHoldings.length} tokens ·{" "}
          <button
            onClick={() => {
              const all: Record<string, boolean> = {};
              pricedHoldings.forEach((h) => { all[h.token] = true; });
              setSelectedTokens(all);
            }}
            className="underline hover:text-foreground cursor-pointer"
          >
            Show all
          </button>
        </p>
      )}

      {/* Value Trend */}
      {portfolioHistory.length > 1 && (
        <BlurFade delay={0.09}>
          <div className="finance-card p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="label-mono">VALUE TREND</p>
              <div className="flex items-center gap-0.5 rounded-lg bg-secondary p-0.5">
                {(["1W", "1M", "3M", "All"] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTrendRange(range)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                      trendRange === range
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
            {filteredHistory.length > 1 ? (
              <ReactECharts
                option={{
                  ...getCartesianBaseOption(isDark),
                  xAxis: {
                    ...getCartesianBaseOption(isDark).xAxis,
                    type: "category" as const,
                    data: filteredHistory.map((s) => {
                      const d = new Date(s.date + "T00:00:00");
                      return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
                    }),
                  },
                  yAxis: {
                    ...getCartesianBaseOption(isDark).yAxis,
                    type: "value" as const,
                    axisLabel: {
                      ...getCartesianBaseOption(isDark).yAxis.axisLabel,
                      formatter: (v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`,
                    },
                  },
                  series: [
                    {
                      name: "Value",
                      type: "line" as const,
                      data: filteredHistory.map((s) => Math.round(s.totalValueUsd * 100) / 100),
                      smooth: true,
                      showSymbol: false,
                      lineStyle: { width: 2, color: ECHARTS_COLORS[0] },
                      areaStyle: { color: ECHARTS_COLORS[0], opacity: 0.08 },
                    },
                    {
                      name: "Cost",
                      type: "line" as const,
                      data: filteredHistory.map((s) => Math.round(s.totalCostUsd * 100) / 100),
                      smooth: true,
                      showSymbol: false,
                      lineStyle: { width: 1.5, color: ECHARTS_COLORS[3], type: "dashed" as const },
                    },
                  ],
                }}
                style={{ height: 240, width: "100%" }}
              />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">
                No data in this range.
              </p>
            )}
          </div>
        </BlurFade>
      )}

      {/* Chart + Table */}
      <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
        {/* Donut chart */}
        <BlurFade delay={0.12}>
          <div className="finance-card p-6">
            <p className="label-mono mb-4">ALLOCATION</p>
            {chartData.length > 0 && (
              <CryptoDonut chartData={chartData} isDark={isDark} />
            )}
            {/* Clickable legend */}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
              {chartData.map((d) => {
                const isSelected = selectedTokens[d.token] !== false;
                return (
                  <button
                    key={d.token}
                    onClick={() =>
                      setSelectedTokens((prev) => ({
                        ...prev,
                        [d.token]: !isSelected,
                      }))
                    }
                    className={cn(
                      "flex items-center gap-1.5 transition-opacity cursor-pointer",
                      !isSelected && "opacity-30",
                    )}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: d.fill }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {d.token}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </BlurFade>

        {/* Holdings table */}
        <BlurFade delay={0.18}>
          <div className="finance-card overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <p className="label-mono">HOLDINGS</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowTagDialog(true)}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Tags className="h-3 w-3" />
                  Tag
                </button>
                <button
                  onClick={() => setShowClearDialog(true)}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th
                      className="px-6 pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("token")}
                    >
                      <span className="inline-flex items-center gap-1">
                        Token
                        {sortField === "token" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("amount")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Amount
                        {sortField === "amount" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("value")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Value
                        {sortField === "value" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("cost")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Cost
                        {sortField === "cost" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("pnl")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        P&L
                        {sortField === "pnl" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("exchange")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Exchange
                        {sortField === "exchange" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-6 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("pct")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        % Port
                        {sortField === "pct" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map((h, i) => {
                    const rowPnl = h.currentValueUsd - h.totalCostUsd;
                    const pctOfPort =
                      totalValueUsd > 0
                        ? (h.currentValueUsd / totalValueUsd) * 100
                        : 0;

                    return (
                      <tr
                        key={h.token}
                        className={cn(
                          "border-b border-border/40 transition-colors hover:bg-secondary/40",
                          i === sortedHoldings.length - 1 && "border-b-0",
                          selectedTokens[h.token] === false && "opacity-40",
                        )}
                      >
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                              style={{
                                backgroundColor:
                                  ECHARTS_COLORS[i % ECHARTS_COLORS.length],
                                opacity: 0.15,
                              }}
                            >
                              <Bitcoin
                                className="h-3 w-3"
                                style={{
                                  color:
                                    ECHARTS_COLORS[i % ECHARTS_COLORS.length],
                                }}
                              />
                            </div>
                            <span className="font-medium">{h.token}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-xs text-muted-foreground">
                          {formatCryptoAmount(h.amount)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-sm">
                          {format(h.currentValueUsd, "USD")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-xs text-muted-foreground">
                          {format(h.totalCostUsd, "USD")}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right tabular-nums font-mono text-xs",
                            rowPnl >= 0 ? "text-income" : "text-expense",
                          )}
                        >
                          {`${rowPnl >= 0 ? "+" : "-"}${format(Math.abs(rowPnl), "USD")}`}
                          {h.totalCostUsd > 0 && (
                            <span className="ml-1 text-[10px] opacity-70">
                              {rowPnl >= 0 ? "+" : ""}{((rowPnl / h.totalCostUsd) * 100).toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {editingExchange === h.token ? (
                            <input
                              autoFocus
                              className="w-20 bg-transparent border-b border-border text-right text-xs outline-none"
                              value={editExchangeValue}
                              onChange={(e) => setEditExchangeValue(e.target.value)}
                              onBlur={() => saveExchange(h.token, editExchangeValue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveExchange(h.token, editExchangeValue);
                                if (e.key === "Escape") setEditingExchange(null);
                              }}
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setEditingExchange(h.token);
                                setEditExchangeValue(getExchange(h));
                              }}
                              className="hover:text-foreground transition-colors cursor-pointer"
                            >
                              {getExchange(h) || "\u2014"}
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right tabular-nums font-mono text-xs text-muted-foreground">
                          {pctOfPort.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </BlurFade>
      </div>

      {/* Exchange Allocation */}
      {exchangeData.length > 1 && (
        <BlurFade delay={0.24}>
          <div className="finance-card p-6">
            <p className="label-mono mb-4">BY EXCHANGE</p>
            <div className="space-y-2.5">
              {exchangeData.map((item) => {
                const pct = totalValueUsd > 0 ? (item.value / totalValueUsd) * 100 : 0;
                return (
                  <div key={item.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: item.fill }}
                        />
                        <span>{item.name}</span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {format(item.value, "USD")} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: item.fill,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </BlurFade>
      )}

      {/* Clear confirmation dialog */}
      <Dialog
        open={showClearDialog}
        onOpenChange={(open) => !open && setShowClearDialog(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear Crypto Data</DialogTitle>
            <DialogDescription>
              This will remove all crypto holdings data. You can re-import a CSV
              anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button variant="destructive" onClick={clearCsv}>
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stablecoin tag dialog */}
      <Dialog
        open={showTagDialog}
        onOpenChange={(open) => !open && setShowTagDialog(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tag as Stablecoin</DialogTitle>
            <DialogDescription>
              Tokens tagged as stablecoin will be grouped into CASH.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto py-2">
            {holdings
              .filter((h) => h.token !== "CASH")
              .map((h) => (
                <label
                  key={h.token}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-secondary/50 cursor-pointer"
                >
                  <span className="text-sm font-medium">{h.token}</span>
                  <input
                    type="checkbox"
                    checked={stablecoinTags[h.token] === true}
                    onChange={(e) =>
                      setStablecoinTags((prev) => ({
                        ...prev,
                        [h.token]: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-border accent-foreground"
                  />
                </label>
              ))}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Done
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function MetricCell({
  label,
  value,
  prefix,
  className,
}: {
  label: string;
  value: string;
  prefix?: string;
  className?: string;
}) {
  return (
    <div className="flex-1 px-5 py-4 sm:px-6 sm:py-5">
      <p className="label-mono mb-1">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", className)}>
        {prefix}
        {value}
      </p>
    </div>
  );
}

function formatCryptoAmount(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (Math.abs(amount) >= 1) {
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  if (Math.abs(amount) >= 0.0001) {
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    });
  }
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  });
}
