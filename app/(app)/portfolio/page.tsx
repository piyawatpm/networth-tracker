"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import type { PortfolioHolding, HoldingType, AccountType, PortfolioTransaction } from "@/lib/utils/types";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { TransactionHistory } from "@/components/portfolio/transaction-history";
import {
  getPriceCache,
  setPriceCache,
  anyCacheStale,
  canAutoUpdate,
  addUpdateLog,
  getUpdateLog,
  type PriceCache,
  type PriceUpdateLog,
} from "@/lib/utils/prices";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Button } from "@/components/ui/button";
import { HoldingDialog } from "@/components/portfolio/holding-dialog";
import type { FundAllocations } from "@/components/portfolio/fund-breakdown";
import { Plus, Download } from "lucide-react";

import { PortfolioCharts } from "./_components/portfolio-charts";
import { HoldingsTable } from "./_components/holdings-table";
import { PriceUpdateStatus } from "./_components/price-update-status";
import {
  type SortKey,
  type TrendPeriod,
  type PortfolioSnapshot,
  exportPortfolioXls,
} from "./_components/portfolio-constants";

export default function PortfolioPage() {
  const [holdings, setHoldings] = useCloudStorage<PortfolioHolding[]>(
    "portfolio_holdings",
    []
  );
  const [snapshots, setSnapshots] = useCloudStorage<PortfolioSnapshot[]>(
    "portfolio_snapshots",
    []
  );
  const [fundAllocations] = useCloudStorage<FundAllocations>(
    "fund_allocations",
    {},
  );
  const { format, convert, currency, symbol } = useCurrency();

  // UI state
  const [includeSuper, setIncludeSuper] = useState(true);
  const [typeFilter, setTypeFilter] = useState<HoldingType | "all">("all");
  const [accountFilter, setAccountFilter] = useState<AccountType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("All");
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [priceCache, setPriceCacheState] = useState<PriceCache>({});
  const [isFetching, setIsFetching] = useState(false);
  const [lastFetchStatus, setLastFetchStatus] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState<PriceUpdateLog[]>([]);
  const [logHoldingId, setLogHoldingId] = useState<string | null>(null);
  const [transactions, setTransactions] = useCloudStorage<PortfolioTransaction[]>("portfolio_transactions", []);
  const [txHistoryHoldingId, setTxHistoryHoldingId] = useState<string | null>(null);

  useEffect(() => {
    setPriceCacheState(getPriceCache());
    setUpdateLog(getUpdateLog());
  }, []);

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
              // Price comes in result.currency (usually USD for US stocks)
              // Convert to holding's currency if they differ
              let priceInHoldingCurrency = result.price;
              if (result.currency && h.currency && result.currency !== h.currency) {
                priceInHoldingCurrency = convert(result.price, result.currency);
                // convert() returns value in display currency, we need it in h.currency
                // So: convert price from result.currency to display, then from display to h.currency
                // Actually convert(amount, from) returns in displayCurrency. We need holding currency.
                // Simpler: value in holding currency = price_usd * (rate_holding / rate_usd)
                // But we only have convert(amount, from) → displayCurrency
                // Use: priceInDisplay = convert(price, resultCurrency)
                //      holdingRate = convert(1, holdingCurrency) → 1 unit of holding = X display
                //      priceInHolding = priceInDisplay / holdingRate
                const oneHoldingInDisplay = convert(1, h.currency);
                if (oneHoldingInDisplay > 0) {
                  const priceInDisplay = convert(result.price, result.currency);
                  priceInHoldingCurrency = priceInDisplay / oneHoldingInDisplay;
                }
              }
              const newValue = h.units * priceInHoldingCurrency;
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

  const filteredHoldings = useMemo(() => {
    let result = holdings.filter((h) => h.type !== "savings"); // savings shown on Emergency page
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

  // Portfolio snapshots — no longer auto-saved client-side.
  // Snapshots are created by: manual snapshot button (📷) or daily cron.

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

    return filtered.map((s) => {
      const rawValue = includeSuper ? s.valueWithSuper : s.value;
      const snapCurrency = (s as { currency?: string }).currency ?? "AUD";
      if (snapCurrency !== currency) {
        return { date: s.date.slice(5), value: Math.round(convert(rawValue, snapCurrency) * 100) / 100 };
      }
      return { date: s.date.slice(5), value: rawValue };
    });
  }, [snapshots, includeSuper, trendPeriod, currency, convert]);

  function handleTransaction(tx: PortfolioTransaction) {
    setTransactions((prev) => [tx, ...prev]);
    setHoldings((prev) =>
      prev.map((h) => {
        if (h.id !== tx.holdingId) return h;
        if (tx.type === "buy") {
          return {
            ...h,
            units: h.units + tx.units,
            amountInvested: h.amountInvested + tx.totalAmount,
          };
        }
        const fraction = h.units > 0 ? tx.units / h.units : 1;
        return {
          ...h,
          units: h.units - tx.units,
          amountInvested: h.amountInvested * (1 - fraction),
        };
      }),
    );
  }

  function handleSave(h: PortfolioHolding) {
    const isNew = !holdings.some((p) => p.id === h.id);
    setHoldings((prev) => {
      const idx = prev.findIndex((p) => p.id === h.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = h;
        return updated;
      }
      return [...prev, h];
    });
    if (isNew && h.units > 0 && h.amountInvested > 0) {
      const tx: PortfolioTransaction = {
        id: crypto.randomUUID(),
        holdingId: h.id,
        holdingName: h.name,
        type: "buy",
        units: h.units,
        pricePerUnit: h.amountInvested / h.units,
        totalAmount: h.amountInvested,
        currency: h.currency,
        date: getSydneyDateString(),
        notes: "Initial holding",
        createdAt: Date.now(),
      };
      setTransactions((prev) => [tx, ...prev]);
    }
  }

  function handleDelete(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }

  function handleExportXls() {
    exportPortfolioXls(holdings, convert);
  }

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

      {/* ── Charts (trend, donuts, broker, look-through) ── */}
      <PortfolioCharts
        filteredHoldings={filteredHoldings}
        trendData={trendData}
        trendPeriod={trendPeriod}
        setTrendPeriod={setTrendPeriod}
        totals={totals}
        fundAllocations={fundAllocations}
        format={format}
        convert={convert}
        baseDelay={DELAY}
      />

      {/* ── Filters + Holdings List ── */}
      <HoldingsTable
        holdings={holdings}
        sortedHoldings={sortedHoldings}
        filteredHoldings={filteredHoldings}
        totals={totals}
        fundAllocations={fundAllocations}
        priceCache={priceCache}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sortKey={sortKey}
        setSortKey={setSortKey}
        typeFilter={typeFilter}
        setTypeFilter={(t) => setTypeFilter(t as HoldingType | "all")}
        accountFilter={accountFilter}
        setAccountFilter={(t) => setAccountFilter(t as AccountType | "all")}
        isFetching={isFetching}
        lastFetchStatus={lastFetchStatus}
        format={format}
        convert={convert}
        onSave={handleSave}
        onDelete={handleDelete}
        onRefresh={() => fetchPrices(true)}
        onStartEditValue={startEditValue}
        onSaveEditValue={saveEditValue}
        editingValueId={editingValueId}
        editingValue={editingValue}
        setEditingValue={setEditingValue}
        setEditingValueId={setEditingValueId}
        onShowLog={setLogHoldingId}
        onTransaction={handleTransaction}
        transactions={transactions}
        onShowTxHistory={setTxHistoryHoldingId}
        baseDelay={DELAY}
      />

      {/* ── Per-holding Update Log Dialog ── */}
      <PriceUpdateStatus
        holdings={holdings}
        updateLog={updateLog}
        logHoldingId={logHoldingId}
        setLogHoldingId={setLogHoldingId}
        format={format}
      />

      {/* ── Transaction History Dialog ── */}
      <TransactionHistory
        holdings={holdings}
        transactions={transactions}
        holdingId={txHistoryHoldingId}
        setHoldingId={setTxHistoryHoldingId}
        format={format}
        onDeleteTransaction={(id) => setTransactions((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
