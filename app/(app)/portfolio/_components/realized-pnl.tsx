"use client";

import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { Receipt } from "lucide-react";

/** One holding's locked-in gain/loss, already converted to the display currency. */
export interface RealizedHoldingRow {
  holdingId: string;
  name: string;
  ticker: string;
  realizedPnl: number;
}

/**
 * Portfolio twin of the crypto Realized P&L card. Same visual language —
 * all-time total header + a per-position breakdown — but sourced from the
 * buy/sell transaction log (replayed average-cost) instead of a CSV upload.
 */
export function RealizedPnl({
  total,
  byHolding,
  delay = 0.06,
}: {
  total: number;
  byHolding: RealizedHoldingRow[];
  delay?: number;
}) {
  const { format } = useCurrency();

  // ── Empty state — nothing sold yet, so nothing realized ──
  if (byHolding.length === 0) {
    return (
      <BlurFade delay={delay}>
        <div className="finance-card flex flex-col items-center gap-3 px-4 py-8 text-center sm:flex-row sm:gap-4 sm:text-left">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary shrink-0">
            <Receipt className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Track realized profit</p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
              Realized gains and losses show up here once you log a sell — including
              holdings you&apos;ve fully exited.
            </p>
          </div>
        </div>
      </BlurFade>
    );
  }

  return (
    <BlurFade delay={delay}>
      <div className="finance-card overflow-hidden">
        {/* ── Header: all-time realized total ── */}
        <div className="flex items-start justify-between px-4 py-4 sm:px-5">
          <div>
            <p className="label-mono mb-1">All-Time Realized</p>
            <p
              className={cn(
                "text-xl sm:text-2xl font-semibold tabular-nums",
                total >= 0 ? "text-income" : "text-expense",
              )}
            >
              {total >= 0 ? "+" : "-"}
              {format(Math.abs(total))}
            </p>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            {byHolding.length} {byHolding.length === 1 ? "position" : "positions"}
          </span>
        </div>

        {/* ── Per-holding breakdown ── */}
        <ul className="border-t border-border/60 divide-y divide-border/40">
          {byHolding.map((r) => (
            <li
              key={r.holdingId}
              className="flex items-center justify-between px-4 py-2.5 sm:px-5"
            >
              <span className="text-sm font-medium truncate pr-3">
                {r.name}
                {r.ticker && (
                  <span className="ml-1.5 text-xs font-mono text-muted-foreground">
                    {r.ticker}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums shrink-0",
                  r.realizedPnl >= 0 ? "text-income" : "text-expense",
                )}
              >
                {r.realizedPnl >= 0 ? "+" : "-"}
                {format(Math.abs(r.realizedPnl))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </BlurFade>
  );
}
