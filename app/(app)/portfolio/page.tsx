"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import type { PortfolioHolding, HoldingType, AccountType, PortfolioTransaction } from "@/lib/utils/types";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { TransactionHistory } from "@/components/portfolio/transaction-history";
import { derivePosition } from "@/lib/utils/portfolio-transactions";
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
import { HOSTPLUS_OPTION_BY_TICKER, repriceHostplusHolding } from "@/lib/utils/hostplus";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { HoldingDialog } from "@/components/portfolio/holding-dialog";
import { MarketSessionBadge } from "@/components/portfolio/market-session-badge";
import type { FundAllocations } from "@/components/portfolio/fund-breakdown";
import { Plus, Download } from "lucide-react";
import { useAlpacaWs } from "@/lib/hooks/use-alpaca-ws";
import { getUsMarketSession, pollIntervalForSession } from "@/lib/utils/market-session";
import dynamic from "next/dynamic";
const PerformanceChart = dynamic(
  () => import("@/components/ui/performance-chart").then((m) => m.PerformanceChart),
  { ssr: false },
);

import { PortfolioCharts } from "./_components/portfolio-charts";
import { HoldingsTable } from "./_components/holdings-table";
import { PriceUpdateStatus } from "./_components/price-update-status";
import { HoldingGroups } from "./_components/holding-groups";
import { RealizedPnl, type RealizedHoldingRow } from "./_components/realized-pnl";
import {
  type SortKey,
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
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [priceCache, setPriceCacheState] = useState<PriceCache>({});
  const [isFetching, setIsFetching] = useState(false);
  const [lastFetchStatus, setLastFetchStatus] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState<PriceUpdateLog[]>([]);
  const [logHoldingId, setLogHoldingId] = useState<string | null>(null);
  // Server-side unit-price log the daily cron accumulates (Hostplus) — the
  // localStorage updateLog above only ever sees THIS browser's edits.
  const [hostplusPriceHistory] = useCloudStorage<Record<string, Record<string, number>>>(
    "hostplus_price_history",
    {},
  );
  const [transactions, setTransactions] = useCloudStorage<PortfolioTransaction[]>("portfolio_transactions", []);
  const [txHistoryHoldingId, setTxHistoryHoldingId] = useState<string | null>(null);

  // Ticker → Finnhub logo URL (populated on mount + when new tickers appear)
  const [stockLogos, setStockLogos] = useCloudStorage<Record<string, string>>(
    "portfolio_stock_logos",
    {},
  );

  useEffect(() => {
    setPriceCacheState(getPriceCache());
    setUpdateLog(getUpdateLog());
  }, []);

  // Fetch missing Finnhub logos for holdings with a ticker
  useEffect(() => {
    const buildLookupSymbol = (h: PortfolioHolding) => {
      if (!h.ticker) return null;
      const upper = h.ticker.toUpperCase();
      return h.country?.toUpperCase() === "AU" ? `${upper}.AX` : upper;
    };

    const missing: string[] = [];
    const seen = new Set<string>();
    for (const h of holdings) {
      const key = buildLookupSymbol(h);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!stockLogos[key]) missing.push(key);
    }
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/stock-logos?symbols=${encodeURIComponent(missing.join(","))}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { logos: Record<string, string> };
        if (cancelled || Object.keys(data.logos ?? {}).length === 0) return;
        setStockLogos((prev) => {
          const next = { ...prev };
          for (const [sym, url] of Object.entries(data.logos)) {
            if (!next[sym]) next[sym] = url;
          }
          return next;
        });
      } catch {
        // silent — table falls back to placeholder icons
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [holdings, stockLogos, setStockLogos]);

  // `includeHostplus` is false on the frequent intraday poll — Hostplus only
  // publishes a daily unit price, so it's fetched on manual refresh / mount,
  // not every poll tick.
  const fetchPrices = useCallback(
    async (force = false, includeHostplus = true) => {
      const autoHoldings = holdings.filter(
        (h) => h.ticker && canAutoUpdate(h.ticker)
      );
      if (autoHoldings.length === 0) return;

      const isHostplus = (t: string) => !!HOSTPLUS_OPTION_BY_TICKER[t.toUpperCase()];
      const stockHoldings = autoHoldings.filter((h) => !isHostplus(h.ticker));
      const hostplusHoldings = includeHostplus
        ? autoHoldings.filter((h) => isHostplus(h.ticker))
        : [];

      const tickers = autoHoldings.map((h) => h.ticker.toUpperCase());
      if (!force && !anyCacheStale(tickers)) return;

      setIsFetching(true);
      setLastFetchStatus(null);

      const cache = getPriceCache();
      const updatedHoldings = [...holdings];
      let attempted = 0;
      let updatedCount = 0;
      let errors = 0;

      try {
        // ── Stocks / ETFs (Yahoo → Finnhub → Alpaca) ──
        if (stockHoldings.length > 0) {
          attempted += stockHoldings.length;
          try {
            const res = await fetch("/api/prices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                holdings: stockHoldings.map((h) => ({ ticker: h.ticker, country: h.country })),
              }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            for (const result of data.prices ?? []) {
              if (result.price == null) {
                errors++;
                continue;
              }
              cache[result.ticker.toUpperCase()] = {
                price: result.price,
                currency: result.currency,
                updatedAt: Date.now(),
              };
              const idx = updatedHoldings.findIndex(
                (h) => h.ticker.toUpperCase() === result.ticker.toUpperCase()
              );
              if (idx >= 0) {
                const h = updatedHoldings[idx];
                // Store currentValue in the PRICE's currency; the display layer
                // converts to the user's preferred currency.
                const newValue = h.units * result.price;
                const newCurrency = result.currency || h.currency;
                if (Math.abs(newValue - h.currentValue) > 0.01) {
                  addUpdateLog({
                    holdingId: h.id,
                    holdingName: h.name,
                    oldValue: h.currentValue,
                    newValue,
                    source: "auto",
                    timestamp: Date.now(),
                  });
                  updatedHoldings[idx] = { ...h, currentValue: newValue, currency: newCurrency };
                  updatedCount++;
                }
              }
            }
          } catch {
            errors += stockHoldings.length;
          }
        }

        // ── Hostplus super (daily unit price; units × price, calibrated once) ──
        if (hostplusHoldings.length > 0) {
          attempted += hostplusHoldings.length;
          try {
            const res = await fetch("/api/hostplus");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const priceByCode = new Map<string, number>(
              (data.options ?? []).map((o: { code: string; price: number }) => [o.code, o.price])
            );
            for (const target of hostplusHoldings) {
              const code = HOSTPLUS_OPTION_BY_TICKER[target.ticker.toUpperCase()];
              const price = priceByCode.get(code);
              if (typeof price !== "number" || price <= 0) {
                errors++;
                continue;
              }
              cache[target.ticker.toUpperCase()] = { price, currency: "AUD", updatedAt: Date.now() };
              const idx = updatedHoldings.findIndex((h) => h.id === target.id);
              if (idx >= 0) {
                const h = updatedHoldings[idx];
                const r = repriceHostplusHolding(h, price);
                if (Math.abs(r.currentValue - h.currentValue) > 0.01 || Math.abs(r.units - h.units) > 1e-6) {
                  addUpdateLog({
                    holdingId: h.id,
                    holdingName: h.name,
                    oldValue: h.currentValue,
                    newValue: r.currentValue,
                    source: "auto",
                    timestamp: Date.now(),
                  });
                  updatedHoldings[idx] = { ...h, units: r.units, currentValue: r.currentValue, currency: "AUD" };
                  updatedCount++;
                }
              }
            }
          } catch {
            errors += hostplusHoldings.length;
          }
        }

        setPriceCache(cache);
        setPriceCacheState({ ...cache });
        if (updatedCount > 0) setHoldings(updatedHoldings);
        setUpdateLog(getUpdateLog());
        setLastFetchStatus(
          `Updated ${updatedCount} of ${attempted} holdings` +
            (errors > 0 ? ` (${errors} failed)` : "")
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

  // Keep a stable ref to fetchPrices so the polling effect doesn't restart
  // every time holdings change (WS trade updates mutate holdings).
  const fetchPricesRef = useRef(fetchPrices);
  useEffect(() => { fetchPricesRef.current = fetchPrices; }, [fetchPrices]);

  // Session-aware polling so pre/post-market moves actually show while
  // the page is open (Finnhub WS free tier doesn't stream extended hours).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (document.visibilityState !== "hidden") {
        fetchPricesRef.current(true, false); // intraday poll: stocks only
      }
      const next = pollIntervalForSession(getUsMarketSession());
      timer = setTimeout(tick, next);
    };

    const initial = pollIntervalForSession(getUsMarketSession());
    timer = setTimeout(tick, initial);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ── Finnhub WebSocket for real-time US stock prices ──
  const wsSymbols = useMemo(() => {
    return holdings
      .filter((h) => h.ticker && canAutoUpdate(h.ticker) && h.country?.toUpperCase() === "US")
      .map((h) => h.ticker.toUpperCase());
  }, [holdings]);

  const { livePrices: finnhubPrices, connected: wsConnected } = useAlpacaWs(wsSymbols);

  // Apply Finnhub live prices to holdings
  useEffect(() => {
    if (Object.keys(finnhubPrices).length === 0) return;

    setHoldings((prev) => {
      let changed = false;
      const updated = prev.map((h) => {
        const ticker = h.ticker?.toUpperCase();
        const trade = finnhubPrices[ticker];
        if (!trade) return h;

        const newValue = h.units * trade.price;
        if (Math.abs(newValue - h.currentValue) < 0.01) return h;

        changed = true;
        return { ...h, currentValue: newValue };
      });
      return changed ? updated : prev;
    });
  }, [finnhubPrices]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Realized P&L = profit/loss locked in by past sells, replayed from the
    // transaction log (average-cost). Disjoint from unrealized P&L, which only
    // covers the units still held, so the two never double-count.
    const realizedPnl = filteredHoldings.reduce((s, h) => {
      const txs = transactions.filter((t) => t.holdingId === h.id);
      if (txs.length === 0) return s;
      const realized = derivePosition(txs, h.currency, convert).realizedPnl;
      return s + convert(realized, h.currency);
    }, 0);
    return {
      totalValue,
      totalInvested,
      pnl,
      pnlPercent,
      realizedPnl,
      count: filteredHoldings.length,
    };
  }, [filteredHoldings, convert, transactions]);

  // Per-holding realized P&L breakdown for the Realized P&L card. Mirrors the
  // crypto page's per-token list: only holdings with a recorded sell appear,
  // sorted biggest gain → biggest loss. Values are pre-converted to the display
  // currency so the card renders them as-is. Its total matches the Realized P&L
  // summary tile (holdings with no sell contribute 0 to both).
  const realizedBreakdown = useMemo(() => {
    const rows = filteredHoldings
      .map((h): RealizedHoldingRow | null => {
        const txs = transactions.filter((t) => t.holdingId === h.id);
        if (txs.length === 0) return null;
        const pos = derivePosition(txs, h.currency, convert);
        if (pos.totalSold <= 0) return null; // bought-only → nothing realized
        return {
          holdingId: h.id,
          name: h.name,
          ticker: h.ticker,
          realizedPnl: convert(pos.realizedPnl, h.currency),
        };
      })
      .filter((r): r is RealizedHoldingRow => r !== null)
      .sort((a, b) => b.realizedPnl - a.realizedPnl);
    const total = rows.reduce((s, r) => s + r.realizedPnl, 0);
    return { rows, total };
  }, [filteredHoldings, transactions, convert]);

  // Portfolio snapshots — no longer auto-saved client-side.
  // Snapshots are created by: manual snapshot button (📷) or daily cron.

  // Snapshots for the new PerformanceChart (raw — chart handles conversion)
  const portfolioChartSnapshots = useMemo(() => {
    return snapshots.map((s) => {
      const ext = s as { valueWithSuper?: number; currency?: string };
      return {
        date: s.date,
        value: includeSuper ? (ext.valueWithSuper ?? s.value) : s.value,
        currency: ext.currency ?? "USD",
      };
    });
  }, [snapshots, includeSuper]);


  // Repair transactions saved by the old transaction dialog, which stamped the
  // user-picked "Paid in" currency onto a totalAmount that was computed in the
  // holding's quote currency (units × quote price). Those records misconvert
  // everywhere (e.g. a USD amount labelled THB shrinks ~33×, inflating realized
  // P&L). The fingerprint is exact — totalAmount still equals units × price and
  // the stamp differs from the holding's currency — so re-stamp with the quote
  // currency. "Initial holding" rows are skipped: their amount is genuinely in
  // the currency chosen at creation, even if a later price fetch re-denominated
  // the holding. Runs until nothing matches, then never writes again.
  useEffect(() => {
    if (holdings.length === 0 || transactions.length === 0) return;
    const quoteCurrencyById = new Map(holdings.map((h) => [h.id, h.currency]));
    let changed = false;
    const repaired = transactions.map((tx) => {
      const quote = quoteCurrencyById.get(tx.holdingId);
      if (!quote || tx.currency === quote) return tx;
      if (tx.notes === "Initial holding") return tx;
      if (Math.abs(tx.totalAmount - tx.units * tx.pricePerUnit) > 0.01) return tx;
      changed = true;
      return { ...tx, currency: quote };
    });
    if (changed) setTransactions(repaired);
  }, [holdings, transactions, setTransactions]);

  // Re-derive a holding's units, cost basis and current value from its
  // transaction log whenever a transaction is added, edited or deleted.
  // Units/cost NOT explained by the log (legacy or manually-set positions) are
  // preserved as an opening baseline, so reconciling never wipes a holding that
  // predates transaction tracking. currentValue is rescaled at the last-known
  // price/unit so unrealized P&L stays correct between price fetches — and
  // forever, for manual holdings that have no live price.
  function reconcileHolding(
    holdingId: string,
    oldTxs: PortfolioTransaction[],
    newTxs: PortfolioTransaction[],
  ) {
    setHoldings((prev) =>
      prev.map((h) => {
        if (h.id !== holdingId) return h;
        const before = derivePosition(oldTxs, h.currency, convert);
        const after = derivePosition(newTxs, h.currency, convert);
        const baseUnits = h.units - before.units;
        const baseCost = h.amountInvested - before.costBasis;
        const pricePerUnit = h.units > 1e-9 ? h.currentValue / h.units : 0;

        let units = baseUnits + after.units;
        let amountInvested = baseCost + after.costBasis;
        if (Math.abs(units) < 1e-9) units = 0;
        if (amountInvested < 1e-9) amountInvested = 0;

        const currentValue =
          units === 0
            ? 0
            : pricePerUnit > 0
              ? pricePerUnit * units
              : h.currentValue;

        return { ...h, units, amountInvested, currentValue };
      }),
    );
  }

  function handleTransaction(tx: PortfolioTransaction) {
    const holdingTxs = transactions.filter((t) => t.holdingId === tx.holdingId);
    setTransactions((prev) => [tx, ...prev]);
    reconcileHolding(tx.holdingId, holdingTxs, [tx, ...holdingTxs]);
  }

  function handleDeleteTransaction(id: string) {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    const holdingTxs = transactions.filter((t) => t.holdingId === tx.holdingId);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    reconcileHolding(
      tx.holdingId,
      holdingTxs,
      holdingTxs.filter((t) => t.id !== id),
    );
  }

  function handleEditTransaction(updated: PortfolioTransaction) {
    const holdingTxs = transactions.filter((t) => t.holdingId === updated.holdingId);
    setTransactions((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    reconcileHolding(
      updated.holdingId,
      holdingTxs,
      holdingTxs.map((t) => (t.id === updated.id ? updated : t)),
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
    <div className="space-y-8 overflow-x-hidden">
      {/* ── Action Bar ── */}
      <BlurFade delay={0}>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <MarketSessionBadge className="mr-auto" />
          <button
            onClick={() => setIncludeSuper(!includeSuper)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground shrink-0"
          >
            <span>Super</span>
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportXls}
            className="gap-1.5 shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          <HoldingDialog
            onSave={handleSave}
            trigger={
              <Button className="gap-1.5 rounded-full px-4 shrink-0">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add Holding</span>
                <span className="sm:hidden">Add</span>
              </Button>
            }
          />
        </div>
      </BlurFade>

      {/* ── Performance Chart ── */}
      <BlurFade delay={DELAY}>
        <PerformanceChart
          label="Portfolio"
          currentValue={totals.totalValue}
          snapshots={portfolioChartSnapshots}
          isLive={wsSymbols.length > 0 && wsConnected}
          defaultPeriod="1D"
        />
      </BlurFade>

      {/* ── Summary Tiles ── */}
      <BlurFade delay={DELAY}>
        <div className="finance-card px-3 py-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-0 md:divide-x md:divide-border">
            <div className="md:pr-6 min-w-0">
              <p className="label-mono mb-1">Total Value</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums truncate">
                {format(totals.totalValue)}
              </p>
            </div>
            <div className="md:px-6 min-w-0">
              <p className="label-mono mb-1">Invested</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums truncate">
                {format(totals.totalInvested)}
              </p>
            </div>
            <div className="md:px-6 min-w-0">
              <p className="label-mono mb-1">Unrealized P&L</p>
              <p
                className={cn(
                  "text-base sm:text-lg font-semibold tabular-nums truncate",
                  totals.pnl >= 0 ? "text-income" : "text-expense"
                )}
              >
                {totals.pnl >= 0 ? "+" : ""}
                {format(totals.pnl)}
                <span className="ml-1 text-xs sm:text-sm font-normal">
                  ({totals.pnl >= 0 ? "+" : ""}
                  {totals.pnlPercent.toFixed(1)}%)
                </span>
              </p>
            </div>
            <div className="md:px-6 min-w-0">
              <p className="label-mono mb-1">Realized P&L</p>
              <p
                className={cn(
                  "text-base sm:text-lg font-semibold tabular-nums truncate",
                  totals.realizedPnl > 0
                    ? "text-income"
                    : totals.realizedPnl < 0
                      ? "text-expense"
                      : "text-muted-foreground"
                )}
              >
                {totals.realizedPnl > 0 ? "+" : ""}
                {format(totals.realizedPnl)}
              </p>
            </div>
            <div className="md:pl-6 min-w-0">
              <p className="label-mono mb-1">Holdings</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums">
                {totals.count}
              </p>
            </div>
          </div>
        </div>
      </BlurFade>

      {/* ── Realized P&L (per-holding breakdown from the transaction log) ── */}
      <RealizedPnl
        total={realizedBreakdown.total}
        byHolding={realizedBreakdown.rows}
        delay={DELAY}
      />

      {/* ── Charts (donuts, broker, look-through) ── */}
      <PortfolioCharts
        filteredHoldings={filteredHoldings}
        totals={totals}
        fundAllocations={fundAllocations}
        format={format}
        convert={convert}
        baseDelay={DELAY}
      />

      {/* ── Custom theme groups ("Quantum", …) — synced with the phone ── */}
      <HoldingGroups holdings={filteredHoldings} format={format} convert={convert} delay={DELAY} />

      {/* ── Filters + Holdings List ── */}
      <HoldingsTable
        holdings={holdings}
        sortedHoldings={sortedHoldings}
        filteredHoldings={filteredHoldings}
        totals={totals}
        fundAllocations={fundAllocations}
        priceCache={priceCache}
        stockLogos={stockLogos}
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
        priceHistory={hostplusPriceHistory}
        logHoldingId={logHoldingId}
        setLogHoldingId={setLogHoldingId}
        format={format}
        onLogChange={() => setUpdateLog(getUpdateLog())}
      />

      {/* ── Transaction History Dialog ── */}
      <TransactionHistory
        holdings={holdings}
        transactions={transactions}
        holdingId={txHistoryHoldingId}
        setHoldingId={setTxHistoryHoldingId}
        format={format}
        convert={convert}
        displayCurrency={currency}
        onDeleteTransaction={handleDeleteTransaction}
        onEditTransaction={handleEditTransaction}
      />
    </div>
  );
}
