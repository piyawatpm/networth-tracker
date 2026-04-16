"use client";

import { useState, useMemo } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HoldingPnl } from "@/lib/utils/pnl";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TopGainersLosersProps {
  holdings: HoldingPnl[];
  format: (amount: number) => string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Tab = "gainers" | "losers";

export function TopGainersLosers({
  holdings,
  format,
}: TopGainersLosersProps) {
  const [tab, setTab] = useState<Tab>("gainers");

  const sorted = useMemo(
    () => [...holdings].sort((a, b) => b.pnlPct - a.pnlPct),
    [holdings],
  );

  const gainers = useMemo(
    () => sorted.filter((h) => h.pnl > 0).slice(0, 10),
    [sorted],
  );

  const losers = useMemo(
    () => sorted.filter((h) => h.pnl < 0).reverse().slice(0, 10),
    [sorted],
  );

  const list = tab === "gainers" ? gainers : losers;

  return (
    <div className="finance-card p-5">
      {/* ---- Header ---- */}
      <div className="mb-4 flex items-center justify-between">
        <p className="label-mono">
          {tab === "gainers" ? "Top 10 Gainers" : "Top 10 Losers"}
        </p>

        {/* Tab toggle */}
        <div className="flex items-center gap-1 rounded-full bg-secondary/40 p-1">
          {(["gainers", "losers"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium capitalize transition-colors",
                tab === t
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ---- List ---- */}
      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No {tab} found.
        </p>
      ) : (
        <div className="space-y-1">
          {list.map((h, i) => {
            const isGain = h.pnl > 0;

            return (
              <div
                key={h.ticker + h.type}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/40 transition-colors"
              >
                {/* Rank */}
                <span className="w-5 text-right text-[11px] font-mono tabular-nums text-muted-foreground">
                  {i + 1}
                </span>

                {/* Ticker + type */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold truncate">
                      {h.ticker}
                    </span>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground rounded bg-secondary px-1 py-px leading-none">
                      {h.type}
                    </span>
                  </div>
                </div>

                {/* PnL amount + PnL% + arrow */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="text-right">
                    <p
                      className={cn(
                        "text-xs font-medium font-mono tabular-nums",
                        isGain ? "text-income" : "text-expense",
                      )}
                    >
                      {isGain ? "+" : ""}
                      {format(h.pnl)}
                    </p>
                    <p
                      className={cn(
                        "text-[10px] font-mono tabular-nums",
                        isGain ? "text-income" : "text-expense",
                      )}
                    >
                      {isGain ? "+" : ""}
                      {h.pnlPct.toFixed(1)}%
                    </p>
                  </div>
                  {isGain ? (
                    <ArrowUpRight className="h-4 w-4 text-income" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4 text-expense" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
