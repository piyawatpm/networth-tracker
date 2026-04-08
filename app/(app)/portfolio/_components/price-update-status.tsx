"use client";

import type { PortfolioHolding } from "@/lib/utils/types";
import { formatTimeAgo, deleteUpdateLogEntry, clearUpdateLogForHolding, getUpdateLog, type PriceUpdateLog } from "@/lib/utils/prices";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Zap, Hand, Trash2 } from "lucide-react";

interface PriceUpdateStatusProps {
  holdings: PortfolioHolding[];
  updateLog: PriceUpdateLog[];
  logHoldingId: string | null;
  setLogHoldingId: (id: string | null) => void;
  format: (value: number, currency?: string) => string;
  onLogChange?: () => void;
}

export function PriceUpdateStatus({
  holdings,
  updateLog,
  logHoldingId,
  setLogHoldingId,
  format,
  onLogChange,
}: PriceUpdateStatusProps) {
  const holding = holdings.find((h) => h.id === logHoldingId);
  const entries = updateLog.filter((e) => e.holdingId === logHoldingId);

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

        {entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No price updates recorded yet.
          </div>
        ) : (
          <>
            <div className="flex justify-end">
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
                      <span className="text-muted-foreground">{format(entry.oldValue)}</span>
                      <span className="text-muted-foreground/40">→</span>
                      <span className={cn("font-medium", entry.newValue >= entry.oldValue ? "text-income" : "text-expense")}>
                        {format(entry.newValue)}
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
