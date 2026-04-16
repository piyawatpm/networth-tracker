"use client";

import { cn } from "@/lib/utils";
import type { PnlAnalysis } from "@/lib/utils/pnl";

interface PnlAnalysisCardProps {
  analysis: PnlAnalysis;
  format: (amount: number) => string;
}

export function PnlAnalysisCard({ analysis, format }: PnlAnalysisCardProps) {
  const totalDays = analysis.winDays + analysis.lossDays;
  const winPct = totalDays > 0 ? (analysis.winDays / totalDays) * 100 : 0;
  const lossPct = totalDays > 0 ? (analysis.lossDays / totalDays) * 100 : 0;
  const isNetPositive = analysis.totalPnl >= 0;

  return (
    <div className="finance-card p-5 h-full">
      <div className="mb-4 flex items-center justify-between">
        <p className="label-mono">PnL Analysis</p>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Past 30 days
        </span>
      </div>

      {/* Win rate visual bar */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>Win Rate</span>
          <span className="font-mono tabular-nums">
            {winPct.toFixed(1)}%
          </span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          {winPct > 0 && (
            <div
              className="h-full bg-income transition-all duration-700 ease-out"
              style={{ width: `${winPct}%` }}
            />
          )}
          {lossPct > 0 && (
            <div
              className="h-full bg-expense transition-all duration-700 ease-out"
              style={{ width: `${lossPct}%` }}
            />
          )}
          {totalDays === 0 && (
            <div className="h-full w-full bg-secondary/40" />
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-income" />
            <span className="font-mono tabular-nums">{analysis.winDays}</span> win
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono tabular-nums">{analysis.lossDays}</span> loss
            <span className="h-2 w-2 rounded-full bg-expense" />
          </span>
        </div>
      </div>

      {/* PnL rows */}
      <div className="space-y-2.5">
        {/* Cumulative Profit */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Cumulative Profit
          </span>
          <span className="font-mono text-sm tabular-nums font-medium text-income">
            +{format(analysis.cumulativeProfit)}
          </span>
        </div>

        {/* Cumulative Loss */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Cumulative Loss
          </span>
          <span className="font-mono text-sm tabular-nums font-medium text-expense">
            {format(analysis.cumulativeLoss)}
          </span>
        </div>

        {/* Net PnL */}
        <div className="border-t border-border/60 pt-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Net PnL</span>
            <span
              className={cn(
                "font-mono text-sm tabular-nums font-bold",
                isNetPositive ? "text-income" : "text-expense",
              )}
            >
              {isNetPositive ? "+" : ""}
              {format(analysis.totalPnl)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
