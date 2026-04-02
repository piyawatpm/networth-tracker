"use client";

import type { PortfolioHolding } from "@/lib/utils/types";
import { formatTimeAgo, type PriceUpdateLog } from "@/lib/utils/prices";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Zap, Hand } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PriceUpdateStatusProps {
  holdings: PortfolioHolding[];
  updateLog: PriceUpdateLog[];
  logHoldingId: string | null;
  setLogHoldingId: (id: string | null) => void;
  format: (value: number, currency?: string) => string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PriceUpdateStatus({
  holdings,
  updateLog,
  logHoldingId,
  setLogHoldingId,
  format,
}: PriceUpdateStatusProps) {
  return (
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
  );
}
