"use client";

import type { PortfolioHolding } from "@/lib/utils/types";
import { formatTimeAgo, deleteUpdateLogEntry, clearUpdateLogForHolding, getUpdateLog, type PriceUpdateLog } from "@/lib/utils/prices";
import { HOSTPLUS_OPTION_BY_TICKER } from "@/lib/utils/hostplus";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Zap, Hand, Trash2 } from "lucide-react";

interface PriceUpdateStatusProps {
  holdings: PortfolioHolding[];
  updateLog: PriceUpdateLog[];
  /** Server-side unit-price history the daily cron accumulates, by option
   * code. The localStorage log only ever contains THIS browser's edits —
   * without this the auto-repricing looks dead from any other device. */
  priceHistory?: Record<string, Record<string, number>>;
  logHoldingId: string | null;
  setLogHoldingId: (id: string | null) => void;
  format: (value: number, currency?: string) => string;
  onLogChange?: () => void;
}

export function PriceUpdateStatus({
  holdings,
  updateLog,
  priceHistory,
  logHoldingId,
  setLogHoldingId,
  format,
  onLogChange,
}: PriceUpdateStatusProps) {
  const holding = holdings.find((h) => h.id === logHoldingId);
  const entries = updateLog.filter((e) => e.holdingId === logHoldingId);

  // Daily unit prices for Hostplus holdings, newest first: [date, price,
  // previous price] — rendered as the server's own auto-update log.
  const optionCode = holding?.ticker ? HOSTPLUS_OPTION_BY_TICKER[holding.ticker] : undefined;
  const dailyPrices: [string, number, number | null][] = (() => {
    const byDate = optionCode ? priceHistory?.[optionCode] : undefined;
    if (!byDate) return [];
    const dates = Object.keys(byDate).sort().reverse();
    return dates.map((d, i) => [d, byDate[d], i + 1 < dates.length ? byDate[dates[i + 1]] : null]);
  })();

  // Find global index for each entry
  function getGlobalIndex(entry: PriceUpdateLog): number {
    return updateLog.indexOf(entry);
  }

  function handleDelete(entry: PriceUpdateLog) {
    const idx = getGlobalIndex(entry);
    if (idx >= 0) {
      deleteUpdateLogEntry(idx);
      onLogChange?.();
    }
  }

  function handleClearAll() {
    if (logHoldingId && confirm("Clear all price history for this holding?")) {
      clearUpdateLogForHolding(logHoldingId);
      onLogChange?.();
    }
  }

  return (
    <Dialog open={logHoldingId !== null} onOpenChange={(open) => { if (!open) setLogHoldingId(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Price History &mdash; {holding?.name ?? ""}</DialogTitle>
          <DialogDescription>{holding?.ticker ?? ""} update log</DialogDescription>
        </DialogHeader>

        {/* ── Server auto-updates: the cron's daily unit prices ── */}
        {dailyPrices.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
              Daily unit price · server auto-update
            </p>
            <div className="max-h-44 overflow-y-auto -mx-1 px-1 divide-y divide-border">
              {dailyPrices.map(([date, price, prev]) => {
                const deltaPct = prev != null && prev > 0 ? ((price - prev) / prev) * 100 : null;
                return (
                  <div key={date} className="flex items-center justify-between py-1.5 text-xs">
                    <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                      <Zap className="h-2.5 w-2.5" /> auto
                    </span>
                    <span className="font-mono tabular-nums">
                      {prev != null && (
                        <span className="text-muted-foreground">${prev.toFixed(4)} <span className="text-muted-foreground/40">→</span> </span>
                      )}
                      <span className={cn("font-medium", deltaPct == null || deltaPct >= 0 ? "text-income" : "text-expense")}>
                        ${price.toFixed(4)}
                      </span>
                      {deltaPct != null && (
                        <span className={cn("ml-1 text-[10px]", deltaPct >= 0 ? "text-income/70" : "text-expense/70")}>
                          {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(2)}%
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">{date}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[9px] text-muted-foreground/50 mt-1.5">
              Hostplus publishes each day&apos;s price the next business day (~6pm Sydney) — weekends have no price. Balance = units × newest price.
            </p>
          </div>
        )}

        {entries.length === 0 && dailyPrices.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No price updates recorded yet.
          </div>
        ) : entries.length === 0 ? null : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Value edits · this browser
              </p>
              <Button variant="ghost" size="xs" className="text-destructive text-[10px]" onClick={handleClearAll}>
                Clear All
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto -mx-1 px-1">
              <div className="divide-y divide-border">
                {entries.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm group">
                    <div className="flex items-center gap-2">
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
                    <div className="flex items-center gap-1.5 font-mono tabular-nums text-xs">
                      {/* Values are recorded in the HOLDING's currency — formatting
                          them without saying so painted AUD numbers with a ฿. */}
                      <span className="text-muted-foreground">{format(entry.oldValue, holding?.currency)}</span>
                      <span className="text-muted-foreground/40">→</span>
                      <span className={cn("font-medium", entry.newValue >= entry.oldValue ? "text-income" : "text-expense")}>
                        {format(entry.newValue, holding?.currency)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-muted-foreground/50">{formatTimeAgo(entry.timestamp)}</span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(entry)}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
