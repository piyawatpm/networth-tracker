"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type PnlRange = "week" | "month" | "year" | "all";

interface PnlHeaderProps {
  todayPnl: number;
  rangePnls: Record<PnlRange, number>;
  estimatedBalance: number;
  format: (amount: number) => string;
  symbol: string;
}

const RANGE_LABELS: Record<PnlRange, string> = {
  week: "Week",
  month: "Month",
  year: "Year",
  all: "All",
};

const RANGE_FULL: Record<PnlRange, string> = {
  week: "This Week",
  month: "This Month",
  year: "This Year",
  all: "All-time",
};

export function PnlHeader({
  todayPnl,
  rangePnls,
  estimatedBalance,
  format,
  symbol,
}: PnlHeaderProps) {
  const [range, setRange] = useState<PnlRange>("month");
  const rangePnl = rangePnls[range];

  return (
    <div className="finance-card px-3 py-4 sm:p-5">
      <div className="grid grid-cols-3 gap-4">
        {/* Today's PnL */}
        <div>
          <p className="label-mono mb-1">Today&apos;s PnL</p>
          <p
            className={cn(
              "text-lg sm:text-xl font-semibold font-mono tabular-nums",
              todayPnl > 0 && "text-income",
              todayPnl < 0 && "text-expense",
              todayPnl === 0 && "text-muted-foreground",
            )}
          >
            {todayPnl > 0 ? "+" : todayPnl < 0 ? "-" : ""}
            {format(Math.abs(todayPnl))}
          </p>
        </div>

        {/* Range PnL with selector */}
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            <p className="label-mono truncate">{RANGE_FULL[range]}</p>
            <div className="ml-auto flex rounded-md bg-secondary p-0.5">
              {(Object.keys(RANGE_LABELS) as PnlRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    "px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded transition-colors",
                    range === r
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {RANGE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
          <p
            className={cn(
              "text-lg sm:text-xl font-semibold font-mono tabular-nums",
              rangePnl > 0 && "text-income",
              rangePnl < 0 && "text-expense",
              rangePnl === 0 && "text-muted-foreground",
            )}
          >
            {rangePnl > 0 ? "+" : rangePnl < 0 ? "-" : ""}
            {format(Math.abs(rangePnl))}
          </p>
        </div>

        {/* Estimated Balance */}
        <div>
          <p className="label-mono mb-1">Est. Balance</p>
          <p className="text-lg sm:text-xl font-semibold font-mono tabular-nums">
            {symbol}
            {format(estimatedBalance).replace(/^[^0-9]*/, "")}
          </p>
        </div>
      </div>
    </div>
  );
}
