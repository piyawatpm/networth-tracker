"use client";

import { cn } from "@/lib/utils";

interface PnlByProductProps {
  portfolioPnl: number;
  cryptoPnl: number;
  format: (amount: number) => string;
}

const PRODUCTS = [
  { key: "stocks", label: "Stocks", color: "#4d7cc7" },
  { key: "crypto", label: "Crypto", color: "#d4a033" },
] as const;

export function PnlByProduct({
  portfolioPnl,
  cryptoPnl,
  format,
}: PnlByProductProps) {
  const values: Record<string, number> = {
    stocks: portfolioPnl,
    crypto: cryptoPnl,
  };

  const maxAbs = Math.max(
    Math.abs(portfolioPnl),
    Math.abs(cryptoPnl),
    1, // avoid division by zero
  );

  return (
    <div className="finance-card p-5 h-full">
      <div className="mb-4 flex items-center justify-between">
        <p className="label-mono">PnL by Product</p>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Since baseline
        </span>
      </div>

      <div className="space-y-4">
        {PRODUCTS.map((product) => {
          const value = values[product.key];
          const isPositive = value >= 0;
          const barPct = (Math.abs(value) / maxAbs) * 100;

          return (
            <div key={product.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: product.color }}
                  />
                  <span className="text-sm font-medium">{product.label}</span>
                </div>
                <span
                  className={cn(
                    "font-mono text-sm tabular-nums font-medium",
                    isPositive ? "text-income" : "text-expense",
                  )}
                >
                  {isPositive ? "+" : ""}
                  {format(value)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/40">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${barPct}%`,
                    backgroundColor: isPositive
                      ? "var(--income)"
                      : "var(--expense)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
