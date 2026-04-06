"use client";

import { useCallback, useRef } from "react";
import { useCurrency } from "@/components/providers/currency-provider";
import { getCachedCryptoPrices } from "@/lib/utils/crypto-prices";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { FileText } from "lucide-react";
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
    <div className="flex-1 px-5 py-4 sm:px-6 sm:py-5">
      <p className="label-mono mb-1">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", className)}>
        {prefix}
        {value}
      </p>
    </div>
  );
}

export function PriceStatus({
  filteredValueUsd,
  filteredCostUsd,
  filteredPnlUsd,
  filteredCashUsd,
  pricedHoldings,
  filteredHoldings,
  csvUploadedAt,
  allSelected,
  selectedTokens,
  setSelectedTokens,
  onFileSelect,
}: {
  filteredValueUsd: number;
  filteredCostUsd: number;
  filteredPnlUsd: number;
  filteredCashUsd: number;
  pricedHoldings: CryptoHolding[];
  filteredHoldings: CryptoHolding[];
  csvUploadedAt: number | null;
  allSelected: boolean;
  selectedTokens: Record<string, boolean>;
  setSelectedTokens: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const { format, convert, symbol } = useCurrency();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      {/* Hero */}
      <BlurFade delay={0}>
        <div className="flex items-start justify-between">
          <div>
            <p className="label-mono mb-2">CRYPTO PORTFOLIO</p>
            <div className="display-number">
              {symbol}
              <NumberTicker value={convert(filteredValueUsd, "USD")} decimalPlaces={2} />
            </div>
            {csvUploadedAt && (
              <p className="text-xs text-muted-foreground mt-2">
                CSV: {new Date(csvUploadedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                {getCachedCryptoPrices()?.fetchedAt && (
                  <>
                    {" \u00b7 Prices: "}
                    {new Date(getCachedCryptoPrices()!.fetchedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                  </>
                )}
              </p>
            )}
          </div>
          <button
            onClick={() => replaceInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <FileText className="h-3.5 w-3.5" />
            Replace CSV
          </button>
          <input
            ref={replaceInputRef}
            type="file"
            accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
      </BlurFade>

      {/* Metrics tile */}
      <BlurFade delay={0.06}>
        <div className="finance-card grid grid-cols-2 divide-y divide-border/60 sm:grid-cols-5 sm:divide-y-0 sm:divide-x">
          <MetricCell label="Total Value" value={format(filteredValueUsd, "USD")} />
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
