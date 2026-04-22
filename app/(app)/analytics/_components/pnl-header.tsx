"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type PnlRange = "week" | "month" | "year" | "all";

interface PnlHeaderProps {
  todayPnl: number;
  todayPnlPct: number;
  rangePnls: Record<PnlRange, { value: number; pct: number }>;
  estimatedBalance: number;
  format: (amount: number) => string;
  symbol: string;
}

const RANGE_LABELS: Record<PnlRange, string> = { week: "Week", month: "Month", year: "Year", all: "All" };
const RANGE_FULL: Record<PnlRange, string> = { week: "This Week", month: "This Month", year: "This Year", all: "Since baseline" };

function signedPct(p: number) { return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`; }

export function PnlHeader({ todayPnl, todayPnlPct, rangePnls, estimatedBalance, format, symbol }: PnlHeaderProps) {
  const [range, setRange] = useState<PnlRange>("all");
  const rp = rangePnls[range];

  const cellClass = (v: number) =>
    cn("text-lg sm:text-xl font-semibold font-mono tabular-nums",
       v > 0 && "text-income", v < 0 && "text-expense", v === 0 && "text-muted-foreground");

  return (
    <div className="finance-card px-3 py-4 sm:p-5">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="label-mono mb-1">Today&apos;s PnL</p>
          <p className={cellClass(todayPnl)}>
            {todayPnl > 0 ? "+" : todayPnl < 0 ? "-" : ""}{format(Math.abs(todayPnl))}
          </p>
          <p className="text-xs font-mono text-muted-foreground">{signedPct(todayPnlPct)}</p>
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            <p className="label-mono truncate">{RANGE_FULL[range]}</p>
            <div className="ml-auto flex rounded-md bg-secondary p-0.5">
              {(Object.keys(RANGE_LABELS) as PnlRange[]).map((r) => (
                <button key={r} onClick={() => setRange(r)} className={cn(
                  "px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded transition-colors",
                  range === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}>{RANGE_LABELS[r]}</button>
              ))}
            </div>
          </div>
          <p className={cellClass(rp.value)}>
            {rp.value > 0 ? "+" : rp.value < 0 ? "-" : ""}{format(Math.abs(rp.value))}
          </p>
          <p className="text-xs font-mono text-muted-foreground">{signedPct(rp.pct)}</p>
        </div>

        <div>
          <p className="label-mono mb-1">Est. Balance</p>
          <p className="text-lg sm:text-xl font-semibold font-mono tabular-nums">
            {symbol}{format(estimatedBalance).replace(/^[^0-9]*/, "")}
          </p>
        </div>
      </div>
    </div>
  );
}
