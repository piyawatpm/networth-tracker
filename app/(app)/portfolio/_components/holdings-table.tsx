"use client";

import { useState } from "react";
import type { PortfolioHolding, HoldingType, AccountType, PortfolioTransaction } from "@/lib/utils/types";
import { HOLDING_TYPE_LABELS } from "@/lib/utils/constants";
import { canAutoUpdate, formatTimeAgo, type PriceCache } from "@/lib/utils/prices";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import { HoldingDialog } from "@/components/portfolio/holding-dialog";
import { FundBreakdown, type FundAllocations } from "@/components/portfolio/fund-breakdown";
import { TransactionDialog } from "@/components/portfolio/transaction-dialog";
import {
  Plus, Pencil, Trash2, Briefcase, ExternalLink, RefreshCw,
  Check, Zap, History, Search, ArrowRightLeft, X, ChevronDown,
} from "lucide-react";
import {
  HOLDING_TYPES, ACCOUNT_TYPES, SORT_OPTIONS,
  HOLDING_TYPE_COLOR_MAP, type SortKey, type PortfolioTotals,
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
  typeFilter: HoldingType | "all";
  setTypeFilter: (t: string) => void;
  accountFilter: AccountType | "all";
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
  onShowTxHistory: (id: string) => void;
  baseDelay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HoldingsTable({
  holdings, sortedHoldings, filteredHoldings, totals, fundAllocations,
  priceCache, searchQuery, setSearchQuery, sortKey, setSortKey,
  typeFilter, setTypeFilter, accountFilter, setAccountFilter,
  isFetching, lastFetchStatus, format, convert,
  onSave, onDelete, onRefresh,
  onStartEditValue, onSaveEditValue, editingValueId, editingValue, setEditingValue, setEditingValueId,
  onShowLog, onTransaction, transactions, onShowTxHistory, baseDelay,
}: HoldingsTableProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function handleDelete(id: string) {
    onDelete(id);
    setDeleteConfirmId(null);
  }

  return (
    <BlurFade delay={baseDelay * 6}>
      <div className="space-y-4">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="label-mono">Holdings ({filteredHoldings.length})</p>
            {lastFetchStatus && <span className="text-[10px] text-muted-foreground">{lastFetchStatus}</span>}
            <Button variant="ghost" size="icon-xs" onClick={onRefresh} disabled={isFetching}
              className={cn(isFetching && "animate-spin")}><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..." className="pl-8 h-8 text-xs" />
            </div>
            <Select value={sortKey} onValueChange={(v) => v && setSortKey(v as SortKey)}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SORT_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Filter pills (single row) ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", ...HOLDING_TYPES] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                typeFilter === t ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-secondary/80")}>
              {t === "all" ? "All" : HOLDING_TYPE_LABELS[t]}
            </button>
          ))}
          <span className="w-px h-4 bg-border mx-0.5" />
          {(["all", ...ACCOUNT_TYPES] as const).map((t) => (
            <button key={t} onClick={() => setAccountFilter(t)}
              className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors capitalize",
                accountFilter === t ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-secondary/80")}>
              {t === "all" ? "All" : t}
            </button>
          ))}
        </div>

        {/* ── Holdings list ── */}
        {filteredHoldings.length === 0 ? (
          <div className="finance-card flex flex-col items-center justify-center gap-3 py-16">
            <Briefcase className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No holdings found.</p>
            <HoldingDialog onSave={onSave} trigger={
              <Button variant="outline" className="rounded-full gap-1.5"><Plus className="h-4 w-4" />Add Holding</Button>
            } />
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortedHoldings.map((h) => {
              const invested = convert(h.amountInvested, h.currency);
              const current = convert(h.currentValue, h.currency);
              const pnl = current - invested;
              const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
              const isExpanded = expandedId === h.id;
              const typeColor = HOLDING_TYPE_COLOR_MAP[h.type] ?? "#708090";

              return (
                <div key={h.id} className={cn("finance-card overflow-hidden transition-shadow", isExpanded && "ring-1 ring-border")}>
                  {/* ── Collapsed row — tap to expand ── */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : h.id)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors"
                  >
                    {/* Icon */}
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: typeColor + "15" }}>
                      <span className="text-[10px] font-bold font-mono leading-none" style={{ color: typeColor }}>
                        {h.ticker ? h.ticker.slice(0, 4) : h.name.slice(0, 2).toUpperCase()}
                      </span>
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate">{h.name}</span>
                        {h.accountType === "super" && (
                          <span className="text-[8px] font-mono uppercase tracking-widest px-1 py-px rounded bg-secondary text-muted-foreground leading-none">Super</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                        {h.ticker && <span className="font-mono">{h.ticker}</span>}
                        <span>·</span>
                        <span>{HOLDING_TYPE_LABELS[h.type]}</span>
                        {h.broker && <><span>·</span><span>{h.broker}</span></>}
                        {canAutoUpdate(h.ticker) && <Zap className="h-2.5 w-2.5 text-accent ml-0.5" />}
                      </div>
                    </div>

                    {/* Value + P&L */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{format(current)}</p>
                      <p className={cn("text-[11px] tabular-nums font-medium", pnl >= 0 ? "text-income" : "text-expense")}>
                        {pnl >= 0 ? "+" : ""}{format(pnl)}
                        <span className="ml-1 opacity-70">({pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)</span>
                      </p>
                    </div>

                    <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/30 shrink-0 transition-transform", isExpanded && "rotate-180")} />
                  </button>

                  {/* ── Expanded panel ── */}
                  {isExpanded && (
                    <div className="border-t border-border/40">
                      {/* Stats grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/30">
                        {[
                          { label: "Current Value", val: format(h.currentValue, h.currency), edit: true },
                          { label: "Invested", val: format(h.amountInvested, h.currency) },
                          { label: "Units", val: h.units.toLocaleString("en-US", { maximumFractionDigits: 6 }) },
                          { label: "Currency", val: h.currency },
                        ].map((m) => (
                          <div key={m.label} className="px-4 py-2.5">
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
                            {m.edit && editingValueId === h.id ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                <Input type="number" value={editingValue} onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") onSaveEditValue(h); if (e.key === "Escape") setEditingValueId(null); }}
                                  className="h-6 w-20 text-xs tabular-nums px-1" autoFocus />
                                <Button variant="ghost" size="icon-xs" onClick={() => onSaveEditValue(h)}><Check className="h-2.5 w-2.5 text-income" /></Button>
                                <Button variant="ghost" size="icon-xs" onClick={() => setEditingValueId(null)}><X className="h-2.5 w-2.5" /></Button>
                              </div>
                            ) : (
                              <p className="text-xs font-medium tabular-nums mt-0.5 flex items-center gap-1">
                                {m.val}
                                {m.edit && (
                                  <button onClick={(e) => { e.stopPropagation(); onStartEditValue(h); }}
                                    className="h-4 w-4 rounded bg-secondary hover:bg-secondary/80 inline-flex items-center justify-center transition-colors">
                                    <Pencil className="h-2 w-2" />
                                  </button>
                                )}
                              </p>
                            )}
                            {m.edit && priceCache[h.ticker?.toUpperCase()] && (
                              <p className="text-[8px] text-muted-foreground/40 mt-0.5">{formatTimeAgo(priceCache[h.ticker.toUpperCase()].updatedAt)}</p>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-between px-4 py-2 border-t border-border/30 bg-muted/10">
                        <div className="flex items-center gap-1">
                          <TransactionDialog holding={h} onSave={onTransaction} trigger={
                            <Button variant="outline" size="xs" className="gap-1 text-[10px] h-7">
                              <ArrowRightLeft className="h-3 w-3" />Buy/Sell
                            </Button>
                          } />
                          <Button variant="ghost" size="xs" className="gap-1 text-[10px] h-7" onClick={() => onShowTxHistory(h.id)}>
                            <History className="h-3 w-3" />History
                          </Button>
                          <Button variant="ghost" size="xs" className="gap-1 text-[10px] h-7" onClick={() => onShowLog(h.id)}>
                            Price Log
                          </Button>
                          {h.link && (
                            <a href={h.link} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="xs" className="gap-1 text-[10px] h-7"><ExternalLink className="h-3 w-3" /></Button>
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <HoldingDialog holding={h} onSave={onSave} trigger={
                            <Button variant="ghost" size="icon-xs"><Pencil className="h-3 w-3" /></Button>
                          } />
                          {deleteConfirmId === h.id ? (
                            <div className="flex gap-1">
                              <Button variant="destructive" size="xs" className="h-6 text-[10px]" onClick={() => handleDelete(h.id)}>Delete</Button>
                              <Button variant="ghost" size="xs" className="h-6 text-[10px]" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <Button variant="ghost" size="icon-xs" onClick={() => setDeleteConfirmId(h.id)}><Trash2 className="h-3 w-3" /></Button>
                          )}
                        </div>
                      </div>

                      {/* Fund breakdown */}
                      {(h.type === "etf" || h.type === "fund" || fundAllocations[h.id]) && (
                        <div className="px-4 pb-3 border-t border-border/30">
                          <FundBreakdown holdingId={h.id} holdingName={h.name} ticker={h.ticker}
                            country={h.country} holdingType={h.type}
                            portfolioWeight={totals.totalValue > 0 ? (current / totals.totalValue) * 100 : 0} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BlurFade>
  );
}
