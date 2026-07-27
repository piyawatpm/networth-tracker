"use client";

import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import type { HoldingPerfRow } from "@/lib/utils/performance";

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const p = v * 100;
  if (Math.abs(p) < 0.05) return "0.0%";
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 text-[10px] font-mono text-muted-foreground border border-border rounded px-1 py-px whitespace-nowrap">
      {children}
    </span>
  );
}

export function HoldingsPerformanceTable({
  rows,
  removedExcluded,
}: {
  rows: HoldingPerfRow[];
  removedExcluded: boolean;
}) {
  const { format, convert } = useCurrency();
  if (rows.length === 0) return null;

  return (
    <BlurFade delay={0.18}>
      <div className="finance-card overflow-hidden">
        <div className="px-4 py-4 sm:px-5">
          <p className="label-mono">WHICH PICKS ARE EARNING</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sorted by annualized return. Gain includes locked-in profit from sells.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-border/60 text-left">
                <th className="px-4 sm:px-5 py-2 label-mono font-normal">Holding</th>
                <th className="px-3 py-2 label-mono font-normal text-right">Invested</th>
                <th className="px-3 py-2 label-mono font-normal text-right">Value</th>
                <th className="px-3 py-2 label-mono font-normal text-right">Gain</th>
                <th className="px-3 py-2 label-mono font-normal text-right">Return</th>
                <th className="px-4 sm:px-5 py-2 label-mono font-normal text-right">XIRR/yr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r) => (
                <tr key={r.holdingId} className={cn(r.closed && "opacity-70")}>
                  <td className="px-4 sm:px-5 py-2.5">
                    <span className="font-medium">{r.name}</span>
                    {r.ticker && (
                      <span className="ml-1.5 text-xs font-mono text-muted-foreground">
                        {r.ticker}
                      </span>
                    )}
                    {r.closed && !r.isOrphan && <Chip>CLOSED</Chip>}
                    {r.accountType === "super" && <Chip>SUPER</Chip>}
                    {r.isOrphan && removedExcluded && <Chip>NOT IN STATS</Chip>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {r.investedUsd > 0 ? format(convert(r.investedUsd, "USD")) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.valueUsd > 0 ? format(convert(r.valueUsd, "USD")) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right tabular-nums font-medium",
                      r.gainUsd >= 0 ? "text-income" : "text-expense",
                    )}
                  >
                    {r.gainUsd >= 0 ? "+" : "-"}
                    {format(Math.abs(convert(r.gainUsd, "USD")))}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right tabular-nums",
                      r.returnPct == null
                        ? "text-muted-foreground"
                        : r.returnPct >= 0
                          ? "text-income"
                          : "text-expense",
                    )}
                  >
                    {fmtPct(r.returnPct)}
                  </td>
                  <td
                    className={cn(
                      "px-4 sm:px-5 py-2.5 text-right tabular-nums font-semibold",
                      r.xirrPct == null
                        ? "text-muted-foreground"
                        : r.xirrPct >= 0
                          ? "text-income"
                          : "text-expense",
                    )}
                  >
                    {fmtPct(r.xirrPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </BlurFade>
  );
}
