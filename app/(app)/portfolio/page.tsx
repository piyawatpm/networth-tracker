"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import type { PortfolioHolding, HoldingType, AccountType } from "@/lib/utils/types";
import { HOLDING_TYPE_LABELS, CHART_COLORS } from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";
import {
  getPriceCache,
  setPriceCache,
  anyCacheStale,
  canAutoUpdate,
  addUpdateLog,
  getUpdateLog,
  formatTimeAgo,
  type PriceCache,
  type PriceUpdateLog,
} from "@/lib/utils/prices";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { HoldingDialog } from "@/components/portfolio/holding-dialog";
import { FundBreakdown, type FundAllocations } from "@/components/portfolio/fund-breakdown";
import { LookThroughView } from "@/components/portfolio/look-through-view";
import ReactECharts from "echarts-for-react";
import { InteractiveDonut } from "@/components/ui/interactive-donut";
import {
  ECHARTS_COLORS,
  formatAxisValue,
  getCartesianBaseOption,
} from "@/lib/utils/echarts";
import {
  Plus,
  Pencil,
  Trash2,
  Briefcase,
  ExternalLink,
  RefreshCw,
  Check,
  Zap,
  Hand,
  History,
  Search,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOLDING_TYPES: HoldingType[] = ["stock", "etf", "fund", "bond", "other"];
const ACCOUNT_TYPES: AccountType[] = ["normal", "super"];

const HOLDING_TYPE_COLOR_MAP: Record<HoldingType, string> = {
  stock: CHART_COLORS[0],
  etf: CHART_COLORS[1],
  fund: CHART_COLORS[2],
  bond: CHART_COLORS[3],
  other: CHART_COLORS[4],
};

type SortKey = "value" | "pnl" | "name" | "invested";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "value", label: "Value \u2193" },
  { value: "pnl", label: "P&L% \u2193" },
  { value: "name", label: "Name A\u2192Z" },
  { value: "invested", label: "Invested \u2193" },
];

type TrendPeriod = "1W" | "1M" | "3M" | "All";

interface PortfolioSnapshot {
  date: string;
  value: number;
  valueWithSuper: number;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PortfolioPage() {
  const [holdings, setHoldings] = useLocalStorage<PortfolioHolding[]>(
    "portfolio_holdings",
    []
  );
  const [snapshots, setSnapshots] = useLocalStorage<PortfolioSnapshot[]>(
    "portfolio_snapshots",
    []
  );
  const [fundAllocations] = useLocalStorage<FundAllocations>(
    "fund_allocations",
    {},
  );
  const { format, convert, currency, symbol } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // UI state
  const [includeSuper, setIncludeSuper] = useState(true);
  const [typeFilter, setTypeFilter] = useState<HoldingType | "all">("all");
  const [accountFilter, setAccountFilter] = useState<AccountType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("All");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [priceCache, setPriceCacheState] = useState<PriceCache>({});
  const [isFetching, setIsFetching] = useState(false);
  const [lastFetchStatus, setLastFetchStatus] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState<PriceUpdateLog[]>([]);
  const [logHoldingId, setLogHoldingId] = useState<string | null>(null);

  // Load price cache and log on mount
  useEffect(() => {
    setPriceCacheState(getPriceCache());
    setUpdateLog(getUpdateLog());
  }, []);

  // ---------------------------------------------------------------------------
  // Price fetching
  // ---------------------------------------------------------------------------

  const fetchPrices = useCallback(
    async (force = false) => {
      const autoHoldings = holdings.filter(
        (h) => h.ticker && canAutoUpdate(h.ticker)
      );
      if (autoHoldings.length === 0) return;

      const tickers = autoHoldings.map((h) => h.ticker.toUpperCase());
      if (!force && !anyCacheStale(tickers)) return;

      setIsFetching(true);
      setLastFetchStatus(null);

      try {
        const res = await fetch("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holdings: autoHoldings.map((h) => ({
              ticker: h.ticker,
              country: h.country,
            })),
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const cache = getPriceCache();
        let updatedCount = 0;

        const updatedHoldings = [...holdings];

        for (const result of data.prices ?? []) {
          if (result.price !== null) {
            cache[result.ticker.toUpperCase()] = {
              price: result.price,
              currency: result.currency,
              updatedAt: Date.now(),
            };

            const holdingIdx = updatedHoldings.findIndex(
              (h) => h.ticker.toUpperCase() === result.ticker.toUpperCase()
            );
            if (holdingIdx >= 0) {
              const h = updatedHoldings[holdingIdx];
              const newValue = h.units * result.price;
              const oldValue = h.currentValue;

              if (Math.abs(newValue - oldValue) > 0.01) {
                addUpdateLog({
                  holdingId: h.id,
                  holdingName: h.name,
                  oldValue,
                  newValue,
                  source: "auto",
                  timestamp: Date.now(),
                });

                updatedHoldings[holdingIdx] = { ...h, currentValue: newValue };
                updatedCount++;
              }
            }
          }
        }

        setPriceCache(cache);
        setPriceCacheState({ ...cache });

        if (updatedCount > 0) {
          setHoldings(updatedHoldings);
        }

        setUpdateLog(getUpdateLog());
        const errors = (data.prices ?? []).filter(
          (r: { price: number | null }) => r.price === null
        ).length;
        setLastFetchStatus(
          `Updated ${updatedCount} of ${autoHoldings.length} holdings` +
            (errors > 0 ? ` (${errors} failed)` : "")
        );
      } catch (e) {
        setLastFetchStatus(
          `Fetch failed: ${e instanceof Error ? e.message : "Unknown error"}`
        );
      } finally {
        setIsFetching(false);
      }
    },
    [holdings, setHoldings]
  );

  // Auto-fetch on mount (if stale)
  useEffect(() => {
    const autoTickers = holdings
      .filter((h) => h.ticker && canAutoUpdate(h.ticker))
      .map((h) => h.ticker.toUpperCase());
    if (autoTickers.length > 0 && anyCacheStale(autoTickers)) {
      fetchPrices();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Inline value edit
  // ---------------------------------------------------------------------------

  function startEditValue(h: PortfolioHolding) {
    setEditingValueId(h.id);
    setEditingValue(h.currentValue.toString());
  }

  function saveEditValue(h: PortfolioHolding) {
    const newVal = parseFloat(editingValue);
    if (!isNaN(newVal) && newVal >= 0) {
      addUpdateLog({
        holdingId: h.id,
        holdingName: h.name,
        oldValue: h.currentValue,
        newValue: newVal,
        source: "manual",
        timestamp: Date.now(),
      });

      setHoldings((prev) =>
        prev.map((p) => (p.id === h.id ? { ...p, currentValue: newVal } : p))
      );
      setUpdateLog(getUpdateLog());
    }
    setEditingValueId(null);
  }

  // ---------------------------------------------------------------------------
  // Filtering + sorting
  // ---------------------------------------------------------------------------

  const filteredHoldings = useMemo(() => {
    let result = holdings;
    if (!includeSuper) result = result.filter((h) => h.accountType !== "super");
    if (typeFilter !== "all") result = result.filter((h) => h.type === typeFilter);
    if (accountFilter !== "all")
      result = result.filter((h) => h.accountType === accountFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.ticker.toLowerCase().includes(q)
      );
    }
    return result;
  }, [holdings, includeSuper, typeFilter, accountFilter, searchQuery]);

  const sortedHoldings = useMemo(() => {
    const list = [...filteredHoldings];
    switch (sortKey) {
      case "value":
        return list.sort(
          (a, b) =>
            convert(b.currentValue, b.currency) -
            convert(a.currentValue, a.currency)
        );
      case "pnl": {
        const pnlPct = (h: PortfolioHolding) => {
          const inv = convert(h.amountInvested, h.currency);
          const cur = convert(h.currentValue, h.currency);
          return inv > 0 ? ((cur - inv) / inv) * 100 : 0;
        };
        return list.sort((a, b) => pnlPct(b) - pnlPct(a));
      }
      case "name":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "invested":
        return list.sort(
          (a, b) =>
            convert(b.amountInvested, b.currency) -
            convert(a.amountInvested, a.currency)
        );
      default:
        return list;
    }
  }, [filteredHoldings, sortKey, convert]);

  // ---------------------------------------------------------------------------
  // Totals
  // ---------------------------------------------------------------------------

  const totals = useMemo(() => {
    const totalValue = filteredHoldings.reduce(
      (s, h) => s + convert(h.currentValue, h.currency),
      0
    );
    const totalInvested = filteredHoldings.reduce(
      (s, h) => s + convert(h.amountInvested, h.currency),
      0
    );
    const pnl = totalValue - totalInvested;
    const pnlPercent = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
    return {
      totalValue,
      totalInvested,
      pnl,
      pnlPercent,
      count: filteredHoldings.length,
    };
  }, [filteredHoldings, convert]);

  // ---------------------------------------------------------------------------
  // Daily snapshot recording
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (holdings.length === 0) return;
    const today = getSydneyDateString();
    const alreadyRecorded = snapshots.some((s) => s.date === today);
    if (alreadyRecorded) return;

    const valueNoSuper = holdings
      .filter((h) => h.accountType !== "super")
      .reduce((s, h) => s + convert(h.currentValue, h.currency), 0);
    const valueAll = holdings.reduce(
      (s, h) => s + convert(h.currentValue, h.currency),
      0
    );

    setSnapshots((prev) => [
      ...prev.slice(-89),
      { date: today, value: valueNoSuper, valueWithSuper: valueAll },
    ]);
  }, [holdings, snapshots, setSnapshots, convert]);

  // ---------------------------------------------------------------------------
  // Trend chart data (with period filtering)
  // ---------------------------------------------------------------------------

  const trendData = useMemo(() => {
    let filtered = snapshots;

    if (trendPeriod !== "All") {
      const now = new Date();
      let cutoff: Date;
      switch (trendPeriod) {
        case "1W":
          cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "1M":
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "3M":
          cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          cutoff = new Date(0);
      }
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      filtered = snapshots.filter((s) => s.date >= cutoffStr);
    }

    return filtered.map((s) => ({
      date: s.date.slice(5),
      value: includeSuper ? s.valueWithSuper : s.value,
    }));
  }, [snapshots, includeSuper, trendPeriod]);

  // ---------------------------------------------------------------------------
  // Allocation by Type
  // ---------------------------------------------------------------------------

  const allocationData = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const h of filteredHoldings) {
      byType[h.type] =
        (byType[h.type] ?? 0) + convert(h.currentValue, h.currency);
    }
    return Object.entries(byType)
      .map(([type, value]) => ({
        name: HOLDING_TYPE_LABELS[type as HoldingType],
        value,
        type: type as HoldingType,
        fill: HOLDING_TYPE_COLOR_MAP[type as HoldingType],
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  // ---------------------------------------------------------------------------
  // Top Holdings allocation
  // ---------------------------------------------------------------------------

  const topHoldingsData = useMemo(() => {
    const items = filteredHoldings
      .map((h) => ({
        name: h.ticker || h.name,
        value: convert(h.currentValue, h.currency),
      }))
      .sort((a, b) => b.value - a.value);

    if (items.length <= 7) return items;

    const top6 = items.slice(0, 6);
    const otherValue = items.slice(6).reduce((s, i) => s + i.value, 0);
    return [...top6, { name: "Other", value: otherValue }];
  }, [filteredHoldings, convert]);

  // ---------------------------------------------------------------------------
  // Country allocation
  // ---------------------------------------------------------------------------

  const countryData = useMemo(() => {
    const byCountry: Record<string, number> = {};
    for (const h of filteredHoldings) {
      const key = h.country || "Unknown";
      byCountry[key] = (byCountry[key] ?? 0) + convert(h.currentValue, h.currency);
    }
    return Object.entries(byCountry)
      .map(([country, value]) => ({ name: country, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  // ---------------------------------------------------------------------------
  // Chart options (all memoized with theme)
  // ---------------------------------------------------------------------------

  const trendChartOption = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    return {
      ...base,
      grid: { ...base.grid, left: 56 },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: trendData.map((d) => d.date),
        boundaryGap: false,
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: formatAxisValue,
        },
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis" as const,
        formatter: "{b}: {c}",
      },
      series: [
        {
          type: "line" as const,
          data: trendData.map((d) => d.value),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: ECHARTS_COLORS[0] },
          itemStyle: { color: ECHARTS_COLORS[0] },
          areaStyle: {
            opacity: 0.15,
            color: {
              type: "linear" as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: ECHARTS_COLORS[0] },
                { offset: 1, color: "transparent" },
              ],
            },
          },
        },
      ],
    };
  }, [trendData, isDark]);

  // ---------------------------------------------------------------------------
  // Broker breakdown
  // ---------------------------------------------------------------------------

  const brokerBreakdown = useMemo(() => {
    const byBroker: Record<string, { value: number; count: number }> = {};
    for (const h of filteredHoldings) {
      const name = h.broker || "Unknown";
      if (!byBroker[name]) byBroker[name] = { value: 0, count: 0 };
      byBroker[name].value += convert(h.currentValue, h.currency);
      byBroker[name].count += 1;
    }
    return Object.entries(byBroker)
      .map(([broker, d]) => ({ broker, ...d }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleSave(h: PortfolioHolding) {
    setHoldings((prev) => {
      const idx = prev.findIndex((p) => p.id === h.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = h;
        return updated;
      }
      return [...prev, h];
    });
  }

  function handleDelete(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
    setDeleteConfirmId(null);
  }

  // ---------------------------------------------------------------------------
  // XLS Export
  // ---------------------------------------------------------------------------

  function handleExportXls() {
    const wb = XLSX.utils.book_new();
    const rows: (string | number | null)[][] = [];

    rows.push([
      "Name",
      "Ticker",
      "Type",
      "Account",
      "Broker",
      "Country",
      "Currency",
      "Units",
      "Invested",
      "Value",
      "P&L",
      "P&L %",
    ]);

    for (const h of holdings) {
      const inv = convert(h.amountInvested, h.currency);
      const cur = convert(h.currentValue, h.currency);
      const pnl = cur - inv;
      const pnlPct = inv > 0 ? ((pnl / inv) * 100) : 0;

      rows.push([
        h.name,
        h.ticker,
        HOLDING_TYPE_LABELS[h.type],
        h.accountType === "super" ? "Super" : "Normal",
        h.broker || "",
        h.country || "",
        h.currency,
        h.units,
        Math.round(inv * 100) / 100,
        Math.round(cur * 100) / 100,
        Math.round(pnl * 100) / 100,
        Math.round(pnlPct * 10) / 10,
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 24 },
      { wch: 10 },
      { wch: 8 },
      { wch: 8 },
      { wch: 14 },
      { wch: 8 },
      { wch: 8 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 8 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Portfolio");
    XLSX.writeFile(wb, `portfolio-${getSydneyDateString()}.xlsx`);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const DELAY = 0.05;

  return (
    <div className="space-y-8">
      {/* ── Hero ── */}
      <BlurFade delay={0}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-mono mb-2">Portfolio</p>
            <div className="display-number">
              {totals.totalValue > 0 ? (
                <NumberTicker
                  value={totals.totalValue}
                  prefix={symbol}
                  decimalPlaces={0}
                />
              ) : (
                <span>{symbol}0</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Include Super Toggle */}
            <button
              onClick={() => setIncludeSuper(!includeSuper)}
              className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="hidden sm:inline">Include Super</span>
              <span className="sm:hidden">Super</span>
              <span
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                  includeSuper ? "bg-income" : "bg-border"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                    includeSuper ? "translate-x-[18px]" : "translate-x-[3px]"
                  )}
                />
              </span>
            </button>

            {/* Export XLS */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportXls}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export XLS</span>
            </Button>

            {/* Add Holding */}
            <HoldingDialog
              onSave={handleSave}
              trigger={
                <Button className="gap-1.5 rounded-full px-4">
                  <Plus className="h-4 w-4" data-icon="inline-start" />
                  <span className="hidden sm:inline">Add Holding</span>
                  <span className="sm:hidden">Add</span>
                </Button>
              }
            />
          </div>
        </div>
      </BlurFade>

      {/* ── Summary Tiles ── */}
      <BlurFade delay={DELAY}>
        <div className="finance-card p-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-0 md:divide-x md:divide-border">
            <div className="md:pr-6">
              <p className="label-mono mb-1">Total Value</p>
              <p className="text-lg font-semibold tabular-nums">
                {format(totals.totalValue)}
              </p>
            </div>
            <div className="md:px-6">
              <p className="label-mono mb-1">Invested</p>
              <p className="text-lg font-semibold tabular-nums">
                {format(totals.totalInvested)}
              </p>
            </div>
            <div className="md:px-6">
              <p className="label-mono mb-1">P&L</p>
              <p
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  totals.pnl >= 0 ? "text-income" : "text-expense"
                )}
              >
                {totals.pnl >= 0 ? "+" : ""}
                {format(totals.pnl)}
                <span className="ml-1 text-sm font-normal">
                  ({totals.pnl >= 0 ? "+" : ""}
                  {totals.pnlPercent.toFixed(1)}%)
                </span>
              </p>
            </div>
            <div className="md:pl-6">
              <p className="label-mono mb-1">Holdings</p>
              <p className="text-lg font-semibold tabular-nums">
                {totals.count}
              </p>
            </div>
          </div>
        </div>
      </BlurFade>

      {/* ── Value Trend Chart ── */}
      <BlurFade delay={DELAY * 2}>
        <div className="finance-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="label-mono">Value Trend</p>
            <div className="flex items-center gap-1">
              {(["1W", "1M", "3M", "All"] as TrendPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setTrendPeriod(p)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                    trendPeriod === p
                      ? "bg-foreground/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {trendData.length > 1 ? (
            <ReactECharts
              option={trendChartOption}
              style={{ height: 192, width: "100%" }}
            />
          ) : (
            <div className="flex h-48 items-center justify-center">
              <p className="text-sm text-muted-foreground/50">
                {trendData.length === 1
                  ? "Come back tomorrow to see your trend line"
                  : "Add holdings to start tracking value over time"}
              </p>
            </div>
          )}
        </div>
      </BlurFade>

      {/* ── Filters + Search + Sort ── */}
      <BlurFade delay={DELAY * 3}>
        <div className="space-y-3">
          {/* Search + Sort Row */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or ticker..."
                className="pl-9"
              />
            </div>
            <div className="w-40 shrink-0">
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Type filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-mono mr-1">Type</span>
            {(["all", ...HOLDING_TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                  typeFilter === t
                    ? "bg-foreground/[0.06] text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                )}
              >
                {t === "all" ? "All" : HOLDING_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Account filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-mono mr-1">Account</span>
            {(["all", ...ACCOUNT_TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setAccountFilter(t)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors capitalize",
                  accountFilter === t
                    ? "bg-foreground/[0.06] text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                )}
              >
                {t === "all" ? "All" : t === "normal" ? "Normal" : "Super"}
              </button>
            ))}
          </div>
        </div>
      </BlurFade>

      {/* ── Charts Section (3-column) ── */}
      {filteredHoldings.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Allocation by Type */}
          <BlurFade delay={DELAY * 4}>
            <InteractiveDonut
              title="Allocation by Type"
              data={allocationData.map((d) => ({ name: d.name, value: d.value, color: d.fill }))}
              format={format}
            />
          </BlurFade>

          {/* Top Holdings */}
          <BlurFade delay={DELAY * 4.5}>
            <InteractiveDonut
              title="Top Holdings"
              data={topHoldingsData.map((d, i) => ({ name: d.name, value: d.value, color: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }))}
              format={format}
            />
          </BlurFade>

          {/* Country / Region */}
          <BlurFade delay={DELAY * 5}>
            <InteractiveDonut
              title="By Country"
              data={countryData.map((d, i) => ({ name: d.name, value: d.value, color: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }))}
              format={format}
            />
          </BlurFade>

        </div>
      )}

      {/* ── Broker Breakdown ── */}
      {brokerBreakdown.length > 0 && (
        <BlurFade delay={DELAY * 5.5}>
          <div className="finance-card p-5">
            <p className="label-mono mb-4">By Broker</p>
            <div className="divide-y divide-border">
              {brokerBreakdown.map((b) => (
                <div
                  key={b.broker}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">{b.broker}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.count} holding{b.count !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {format(b.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </BlurFade>
      )}

      {/* ── Look-Through Exposure ── */}
      {filteredHoldings.length > 0 && (
        <BlurFade delay={DELAY * 6}>
          <LookThroughView holdings={filteredHoldings} allocations={fundAllocations} />
        </BlurFade>
      )}

      {/* ── Holdings List ── */}
      <BlurFade delay={DELAY * 6}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="label-mono">
              Holdings ({filteredHoldings.length})
            </p>
            <div className="flex items-center gap-2">
              {lastFetchStatus && (
                <span className="text-[10px] text-muted-foreground">
                  {lastFetchStatus}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => fetchPrices(true)}
                disabled={isFetching}
                className={cn(isFetching && "animate-spin")}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {sortedHoldings.length === 0 ? (
            <div className="finance-card flex flex-col items-center justify-center gap-3 py-16">
              <Briefcase className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {holdings.length === 0
                  ? "No holdings yet. Add your first one."
                  : "No holdings match your filters."}
              </p>
              {holdings.length === 0 && (
                <HoldingDialog
                  onSave={handleSave}
                  trigger={
                    <Button
                      variant="outline"
                      className="rounded-full gap-1.5"
                    >
                      <Plus className="h-4 w-4" data-icon="inline-start" />
                      Add Holding
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {sortedHoldings.map((h, i) => {
                const invested = convert(h.amountInvested, h.currency);
                const current = convert(h.currentValue, h.currency);
                const pnl = current - invested;
                const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

                return (
                  <BlurFade key={h.id} delay={DELAY * 6 + i * 0.03}>
                    <div className="finance-card p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-semibold">
                              {h.name}
                            </h3>
                            {h.ticker && (
                              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                {h.ticker}
                              </span>
                            )}
                            {/* Source currency badge */}
                            <Badge
                              variant="outline"
                              className="shrink-0 px-1.5 py-0 text-[10px] font-mono"
                            >
                              {h.currency}
                            </Badge>
                            {h.link && (
                              <a
                                href={h.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary">
                              {HOLDING_TYPE_LABELS[h.type]}
                            </Badge>
                            {h.accountType === "super" && (
                              <Badge variant="outline">Super</Badge>
                            )}
                            {h.broker && (
                              <span className="text-xs text-muted-foreground">
                                {h.broker}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-start gap-6 text-right">
                          <div className="hidden sm:block">
                            <p className="label-mono mb-0.5">Units</p>
                            <p className="text-sm tabular-nums">
                              {h.units.toLocaleString("en-US", {
                                maximumFractionDigits: 4,
                              })}
                            </p>
                          </div>
                          <div className="hidden sm:block">
                            <p className="label-mono mb-0.5">Invested</p>
                            <p className="text-sm tabular-nums">
                              {format(h.amountInvested, h.currency)}
                            </p>
                          </div>
                          <div>
                            <p className="label-mono mb-0.5 flex items-center gap-1">
                              Value
                              {canAutoUpdate(h.ticker) ? (
                                <span title="Auto-updated">
                                  <Zap className="h-2.5 w-2.5 text-accent" />
                                </span>
                              ) : (
                                <span title="Manual update">
                                  <Hand className="h-2.5 w-2.5 text-muted-foreground/50" />
                                </span>
                              )}
                            </p>
                            {editingValueId === h.id ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={editingValue}
                                  onChange={(e) =>
                                    setEditingValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveEditValue(h);
                                    if (e.key === "Escape")
                                      setEditingValueId(null);
                                  }}
                                  className="h-6 w-24 text-xs tabular-nums px-1.5"
                                  autoFocus
                                />
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => saveEditValue(h)}
                                >
                                  <Check className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <p
                                className="text-sm font-semibold tabular-nums cursor-pointer hover:text-accent transition-colors"
                                onClick={() => startEditValue(h)}
                                role="button"
                              >
                                {format(h.currentValue, h.currency)}
                              </p>
                            )}
                            {priceCache[h.ticker?.toUpperCase()] && (
                              <p className="text-[9px] text-muted-foreground/50 mt-0.5">
                                {formatTimeAgo(
                                  priceCache[h.ticker.toUpperCase()].updatedAt
                                )}
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="label-mono mb-0.5">P&L</p>
                            <p
                              className={cn(
                                "text-sm font-semibold tabular-nums",
                                pnl >= 0 ? "text-income" : "text-expense"
                              )}
                            >
                              {pnl >= 0 ? "+" : ""}
                              {format(pnl)}
                              <span className="ml-1 text-xs font-normal">
                                {pnl >= 0 ? "+" : ""}
                                {pnlPct.toFixed(1)}%
                              </span>
                            </p>
                          </div>

                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => setLogHoldingId(h.id)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <HoldingDialog
                              holding={h}
                              onSave={handleSave}
                              trigger={
                                <Button variant="ghost" size="icon-xs">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              }
                            />
                            {deleteConfirmId === h.id ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="destructive"
                                  size="xs"
                                  onClick={() => handleDelete(h.id)}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => setDeleteConfirmId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setDeleteConfirmId(h.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Fund Breakdown (expandable) */}
                      {(h.type === "etf" || h.type === "fund" || fundAllocations[h.id]) && (
                        <FundBreakdown
                          holdingId={h.id}
                          holdingName={h.name}
                          ticker={h.ticker}
                          country={h.country}
                          holdingType={h.type}
                          portfolioWeight={
                            totals.totalValue > 0
                              ? (current / totals.totalValue) * 100
                              : 0
                          }
                        />
                      )}
                    </div>
                  </BlurFade>
                );
              })}
            </div>
          )}
        </div>
      </BlurFade>

      {/* ── Per-holding Update Log Dialog ── */}
      <Dialog
        open={logHoldingId !== null}
        onOpenChange={(open) => {
          if (!open) setLogHoldingId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Price History &mdash;{" "}
              {holdings.find((h) => h.id === logHoldingId)?.name ?? ""}
            </DialogTitle>
            <DialogDescription>
              {holdings.find((h) => h.id === logHoldingId)?.ticker ?? ""} update
              log
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const entries = updateLog.filter(
              (e) => e.holdingId === logHoldingId
            );
            if (entries.length === 0) {
              return (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No price updates recorded yet.
                </div>
              );
            }
            return (
              <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                <div className="divide-y divide-border">
                  {entries.map((entry, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2.5 text-sm"
                    >
                      <div className="flex items-center gap-2.5">
                        {entry.source === "auto" ? (
                          <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                            <Zap className="h-2.5 w-2.5" /> auto
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            <Hand className="h-2.5 w-2.5" /> manual
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 font-mono tabular-nums text-xs">
                        <span className="text-muted-foreground">
                          {format(entry.oldValue)}
                        </span>
                        <span className="text-muted-foreground/40">
                          &rarr;
                        </span>
                        <span
                          className={cn(
                            "font-medium",
                            entry.newValue >= entry.oldValue
                              ? "text-income"
                              : "text-expense"
                          )}
                        >
                          {format(entry.newValue)}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground/50 ml-2 shrink-0">
                        {formatTimeAgo(entry.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
