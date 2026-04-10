"use client";

import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import type { CryptoHolding } from "@/lib/utils/types";

function MetricCell({
  label,
  value,
  prefix,
  className,
}: {
  label: string;
  value: string;
  prefix?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5 sm:py-4">
      <p className="label-mono mb-1">{label}</p>
      <p className={cn("text-base sm:text-lg font-semibold tabular-nums truncate", className)}>
        {prefix}
        {value}
      </p>
    </div>
  );
}

export function PriceStatus({
  filteredCostUsd,
  filteredPnlUsd,
  filteredCashUsd,
  pricedHoldings,
  filteredHoldings,
  allSelected,
  setSelectedTokens,
}: {
  filteredCostUsd: number;
  filteredPnlUsd: number;
  filteredCashUsd: number;
  pricedHoldings: CryptoHolding[];
  filteredHoldings: CryptoHolding[];
  allSelected: boolean;
  setSelectedTokens: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const { format } = useCurrency();

  return (
    <>
      <BlurFade delay={0.05}>
        <div className="finance-card grid grid-cols-2 divide-y divide-border/60 sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
          <MetricCell label="Total Cost" value={format(filteredCostUsd, "USD")} />
          <MetricCell
            label="P&L"
            value={`${format(Math.abs(filteredPnlUsd), "USD")} (${filteredCostUsd > 0 ? ((filteredPnlUsd / filteredCostUsd) * 100).toFixed(1) : "0.0"}%)`}
            prefix={filteredPnlUsd >= 0 ? "+" : "-"}
            className={filteredPnlUsd >= 0 ? "text-income" : "text-expense"}
          />
          <MetricCell label="Stablecoin" value={format(filteredCashUsd, "USD")} />
          <MetricCell label="Holdings" value={String(pricedHoldings.length)} />
        </div>
      </BlurFade>

      {!allSelected && (
        <p className="text-xs text-muted-foreground">
          Showing {filteredHoldings.length} of {pricedHoldings.length} tokens ·{" "}
          <button
            onClick={() => {
              const all: Record<string, boolean> = {};
              pricedHoldings.forEach((h) => { all[h.token] = true; });
              setSelectedTokens(all);
            }}
            className="underline hover:text-foreground cursor-pointer"
          >
            Show all
          </button>
        </p>
      )}
    </>
  );
}
