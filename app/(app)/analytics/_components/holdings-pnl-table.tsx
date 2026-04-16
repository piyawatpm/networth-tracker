"use client";

import { useState, useMemo } from "react";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HoldingPnl } from "@/lib/utils/pnl";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HoldingsPnlTableProps {
  holdings: HoldingPnl[];
  format: (amount: number) => string;
  symbol: string;
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey = "name" | "units" | "value" | "pnl" | "pnlPct";

function accessor(h: HoldingPnl, key: SortKey): number | string {
  switch (key) {
    case "name":
      return h.ticker.toLowerCase();
    case "units":
      return h.units;
    case "value":
      return h.currentValue;
    case "pnl":
      return h.pnl;
    case "pnlPct":
      return h.pnlPct;
  }
}

function compare(a: HoldingPnl, b: HoldingPnl, key: SortKey, asc: boolean): number {
  const av = accessor(a, key);
  const bv = accessor(b, key);
  let cmp: number;
  if (typeof av === "string" && typeof bv === "string") {
    cmp = av.localeCompare(bv);
  } else {
    cmp = (av as number) - (bv as number);
  }
  return asc ? cmp : -cmp;
}

// ---------------------------------------------------------------------------
// Column config
// ---------------------------------------------------------------------------

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Asset" },
  { key: "units", label: "Units" },
  { key: "value", label: "Value" },
  { key: "pnl", label: "PnL" },
  { key: "pnlPct", label: "PnL%" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HoldingsPnlTable({
  holdings,
  format,
  symbol,
}: HoldingsPnlTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("pnl");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(
    () => [...holdings].sort((a, b) => compare(a, b, sortKey, sortAsc)),
    [holdings, sortKey, sortAsc],
  );

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function formatUnits(units: number): string {
    if (units < 1) return units.toPrecision(4);
    return units.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  return (
    <div className="finance-card p-5">
      {/* ---- Header ---- */}
      <p className="label-mono mb-4">Holdings PnL</p>

      {/* ---- Table ---- */}
      <div className="max-h-[28rem] overflow-y-auto">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_5rem_5rem_5rem_4rem] sm:grid-cols-[1fr_6rem_7rem_7rem_5rem] gap-x-1 px-2 pb-2 border-b border-border/40 sticky top-0 bg-card z-10">
          {COLUMNS.map((col) => (
            <button
              key={col.key}
              onClick={() => handleSort(col.key)}
              className={cn(
                "flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider transition-colors",
                sortKey === col.key
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                col.key !== "name" && "justify-end",
              )}
            >
              {col.label}
              <ArrowUpDown
                className={cn(
                  "h-3 w-3 shrink-0",
                  sortKey === col.key ? "opacity-100" : "opacity-30",
                )}
              />
            </button>
          ))}
        </div>

        {/* Data rows */}
        {sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No holdings.
          </p>
        ) : (
          <div className="divide-y divide-border/20">
            {sorted.map((h) => (
              <div
                key={h.ticker + h.type}
                className="grid grid-cols-[1fr_5rem_5rem_5rem_4rem] sm:grid-cols-[1fr_6rem_7rem_7rem_5rem] gap-x-1 items-center px-2 py-2 hover:bg-secondary/30 transition-colors"
              >
                {/* Asset */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold truncate">
                      {h.ticker}
                    </span>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground rounded bg-secondary px-1 py-px leading-none shrink-0">
                      {h.type}
                    </span>
                  </div>
                </div>

                {/* Units */}
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground text-right">
                  {formatUnits(h.units)}
                </span>

                {/* Value */}
                <span className="text-xs font-mono tabular-nums text-right">
                  {format(h.currentValue)}
                </span>

                {/* PnL */}
                <span
                  className={cn(
                    "text-xs font-mono tabular-nums text-right font-medium",
                    h.pnl > 0 && "text-income",
                    h.pnl < 0 && "text-expense",
                    h.pnl === 0 && "text-muted-foreground",
                  )}
                >
                  {h.pnl > 0 ? "+" : ""}
                  {format(h.pnl)}
                </span>

                {/* PnL% */}
                <span
                  className={cn(
                    "text-[11px] font-mono tabular-nums text-right",
                    h.pnl > 0 && "text-income",
                    h.pnl < 0 && "text-expense",
                    h.pnl === 0 && "text-muted-foreground",
                  )}
                >
                  {h.pnlPct > 0 ? "+" : ""}
                  {h.pnlPct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
