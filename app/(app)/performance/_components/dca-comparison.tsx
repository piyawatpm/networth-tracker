"use client";

import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import type { DcaOutcome } from "@/lib/utils/dca-benchmark";

export interface DcaRow {
  name: string;
  color: string;
  /** Null when the index has no price coverage for the window. */
  outcome: DcaOutcome | null;
  /** The portfolio's own row — highlighted, and the baseline others differ from. */
  isYou?: boolean;
}

function signedPct(v: number | null): string {
  if (v == null) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

/**
 * "Same capital, same dates, different asset."
 *
 * Every row deploys identical money on identical days, so the P&L column is
 * directly comparable — which is the whole point. Contributions are excluded
 * from P&L on both sides, so a big deposit month never reads as a good month.
 */
export function DcaComparison({
  rows,
  start,
  end,
  onStartChange,
  unavailableReason,
  caveats = [],
  delay = 0.14,
}: {
  rows: DcaRow[];
  start: string;
  end: string;
  onStartChange: (date: string) => void;
  unavailableReason?: string;
  /** Reasons the "You" row may not be a clean read — shown above the table. */
  caveats?: string[];
  delay?: number;
}) {
  const { format, convert } = useCurrency();
  const money = (usd: number) => {
    const v = convert(usd, "USD");
    return `${v >= 0 ? "+" : "−"}${format(Math.abs(v))}`;
  };

  const you = rows.find((r) => r.isYou)?.outcome ?? null;

  return (
    <BlurFade delay={delay}>
      <div className="finance-card overflow-hidden">
        {/* ── Header ── */}
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div>
            <p className="label-mono mb-1">If I Had Just Bought The Index</p>
            <p className="text-xs text-muted-foreground max-w-md">
              Same capital, same dates — your money replayed into each index.
              Profit and loss only; deposits are stripped out of every row.
            </p>
          </div>
          <label className="flex items-center gap-2 shrink-0 self-start">
            <span className="label-mono">Since</span>
            <input
              type="date"
              value={start}
              max={end}
              onChange={(e) => e.target.value && onStartChange(e.target.value)}
              className="rounded-lg border border-border bg-transparent px-2 py-1 text-xs font-mono tabular-nums"
            />
          </label>
        </div>

        {unavailableReason ? (
          <div className="flex items-start gap-2.5 border-t border-border/60 px-4 py-5 sm:px-5">
            <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">{unavailableReason}</p>
          </div>
        ) : (
          <>
            {caveats.length > 0 && (
              <div className="border-t border-border/60 bg-expense/5 px-4 py-3 sm:px-5">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-expense shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-medium">
                      Your row is overstated — the index rows are not
                    </p>
                    {caveats.map((c) => (
                      <p key={c} className="text-xs text-muted-foreground">
                        {c}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          <div className="overflow-x-auto border-t border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium sm:px-5">
                    Strategy
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-right">
                    Invested
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-right">
                    P&amp;L
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-right">
                    Return
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-right sm:px-5">
                    vs You
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const o = r.outcome;
                  const diff =
                    !r.isYou && o && you ? o.pnl - you.pnl : null;
                  return (
                    <tr
                      key={r.name}
                      className={cn(
                        "border-t border-border/40",
                        r.isYou && "bg-secondary/40",
                      )}
                    >
                      <td className="px-4 py-3 whitespace-nowrap sm:px-5">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: r.color }}
                          />
                          <span className={cn(r.isYou && "font-semibold")}>
                            {r.name}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                        {o ? format(convert(o.invested, "USD")) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap",
                          !o
                            ? "text-muted-foreground"
                            : o.pnl >= 0
                              ? "text-income"
                              : "text-expense",
                          r.isYou && "font-semibold",
                        )}
                      >
                        {o ? money(o.pnl) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap",
                          !o || o.pnlPct == null
                            ? "text-muted-foreground"
                            : o.pnlPct >= 0
                              ? "text-income"
                              : "text-expense",
                        )}
                      >
                        {o ? signedPct(o.pnlPct) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-xs whitespace-nowrap sm:px-5">
                        {diff == null ? (
                          <span className="text-muted-foreground">
                            {r.isYou ? "—" : "—"}
                          </span>
                        ) : (
                          <span
                            className={cn(
                              diff >= 0 ? "text-income" : "text-expense",
                            )}
                          >
                            {money(diff)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {/* ── Provenance ── */}
        {!unavailableReason && (
          <p className="border-t border-border/60 px-4 py-2.5 text-[10px] font-mono text-muted-foreground/70 sm:px-5">
            Index rows use adjusted closes (dividends reinvested). Return is P&amp;L
            over capital deployed, not annualized.
          </p>
        )}
      </div>
    </BlurFade>
  );
}
