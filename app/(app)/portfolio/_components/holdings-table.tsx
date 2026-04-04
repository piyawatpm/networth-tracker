"use client";

import { useState } from "react";
import type { PortfolioHolding, PortfolioTransaction } from "@/lib/utils/types";
import { HOLDING_TYPE_LABELS } from "@/lib/utils/constants";
import { canAutoUpdate, formatTimeAgo, type PriceCache } from "@/lib/utils/prices";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
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
import { HoldingDialog } from "@/components/portfolio/holding-dialog";
import { TransactionDialog } from "@/components/portfolio/transaction-dialog";
import { FundBreakdown, type FundAllocations } from "@/components/portfolio/fund-breakdown";
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
  ArrowRightLeft,
} from "lucide-react";
import {
  HOLDING_TYPES,
  ACCOUNT_TYPES,
  SORT_OPTIONS,
  type SortKey,
  type PortfolioTotals,
} from "./portfolio-constants";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HoldingsTableProps {
  holdings: PortfolioHolding[];
  sortedHoldings: PortfolioHolding[];
  filteredHoldings: PortfolioHolding[];
  totals: PortfolioTotals;
  fundAllocations: FundAllocations;
  priceCache: PriceCache;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
  typeFilter: string;
  setTypeFilter: (t: string) => void;
  accountFilter: string;
  setAccountFilter: (t: string) => void;
  isFetching: boolean;
  lastFetchStatus: string | null;
  format: (value: number, currency?: string) => string;
  convert: (value: number, currency: string) => number;
  onSave: (h: PortfolioHolding) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onStartEditValue: (h: PortfolioHolding) => void;
  onSaveEditValue: (h: PortfolioHolding) => void;
  editingValueId: string | null;
  editingValue: string;
  setEditingValue: (v: string) => void;
  setEditingValueId: (id: string | null) => void;
  onShowLog: (id: string) => void;
  onTransaction: (tx: PortfolioTransaction) => void;
  transactions: PortfolioTransaction[];
  onShowTxHistory: (holdingId: string) => void;
  baseDelay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HoldingsTable({
  holdings,
  sortedHoldings,
  filteredHoldings,
  totals,
  fundAllocations,
  priceCache,
  searchQuery,
  setSearchQuery,
  sortKey,
  setSortKey,
  typeFilter,
  setTypeFilter,
  accountFilter,
  setAccountFilter,
  isFetching,
  lastFetchStatus,
  format,
  convert,
  onSave,
  onDelete,
  onRefresh,
  onStartEditValue,
  onSaveEditValue,
  editingValueId,
  editingValue,
  setEditingValue,
  setEditingValueId,
  onShowLog,
  onTransaction,
  transactions,
  onShowTxHistory,
  baseDelay,
}: HoldingsTableProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  function handleDelete(id: string) {
    onDelete(id);
    setDeleteConfirmId(null);
  }

  return (
    <>
      {/* ── Filters + Search + Sort ── */}
      <BlurFade delay={baseDelay * 3}>
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

      {/* ── Holdings List ── */}
      <BlurFade delay={baseDelay * 6}>
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
                onClick={onRefresh}
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
                  onSave={onSave}
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
                  <BlurFade key={h.id} delay={baseDelay * 6 + i * 0.03}>
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
                                    if (e.key === "Enter") onSaveEditValue(h);
                                    if (e.key === "Escape")
                                      setEditingValueId(null);
                                  }}
                                  className="h-6 w-24 text-xs tabular-nums px-1.5"
                                  autoFocus
                                />
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => onSaveEditValue(h)}
                                >
                                  <Check className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <p
                                className="text-sm font-semibold tabular-nums cursor-pointer hover:text-accent transition-colors"
                                onClick={() => onStartEditValue(h)}
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
                            <TransactionDialog
                              holding={h}
                              onSave={onTransaction}
                              trigger={
                                <Button variant="ghost" size="icon-xs" title="Log Buy/Sell">
                                  <ArrowRightLeft className="h-3.5 w-3.5" />
                                </Button>
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              title="Transaction History"
                              onClick={() => onShowTxHistory(h.id)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              title="Price Update Log"
                              onClick={() => onShowLog(h.id)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <HoldingDialog
                              holding={h}
                              onSave={onSave}
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
    </>
  );
}
