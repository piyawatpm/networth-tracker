"use client";

import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Highlight {
  name: string;
  pnl: number;
  pnlPct: number;
}

export interface TopMoversProps {
  gainers: Highlight[];
  losers: Highlight[];
  format: (amount: number) => string;
  delay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TopMovers({ gainers, losers, format, delay }: TopMoversProps) {
  return (
    <BlurFade delay={delay} className="md:col-span-6">
      <div className="finance-card p-6">
        <p className="label-mono mb-4">Portfolio Highlights</p>
        {gainers.length === 0 && losers.length === 0 ? (
          <p className="text-sm text-muted-foreground/50 py-6">
            No holdings to show
          </p>
        ) : (
          <div className="space-y-4">
            {gainers.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Gainers</p>
                <div className="space-y-2">
                  {gainers.map((h) => (
                    <div
                      key={h.name}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm font-medium truncate mr-3">
                        {h.name}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono tabular-nums text-sm text-income">
                          +{format(h.pnl)}
                        </span>
                        <span className="font-mono tabular-nums text-xs text-income">
                          +{h.pnlPct.toFixed(1)}%
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-income" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {losers.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Losers</p>
                <div className="space-y-2">
                  {losers.map((h) => (
                    <div
                      key={h.name}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm font-medium truncate mr-3">
                        {h.name}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono tabular-nums text-sm text-expense">
                          {format(h.pnl)}
                        </span>
                        <span className="font-mono tabular-nums text-xs text-expense">
                          {h.pnlPct.toFixed(1)}%
                        </span>
                        <ArrowDownRight className="h-3.5 w-3.5 text-expense" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </BlurFade>
  );
}
