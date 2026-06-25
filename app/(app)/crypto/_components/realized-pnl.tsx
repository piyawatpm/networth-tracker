"use client";

import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { Receipt, Upload } from "lucide-react";
import type { RealizedPnlResult } from "@/lib/utils/types";

export function RealizedPnl({
  realized,
  onUpload,
  uploadedAt,
  onClear,
}: {
  realized: RealizedPnlResult | null;
  onUpload: () => void;
  uploadedAt: number | null;
  onClear: () => void;
}) {
  const { format } = useCurrency();

  // ── Empty state — no transaction CSV uploaded yet ──
  if (!realized) {
    return (
      <BlurFade delay={0.06}>
        <div className="finance-card flex flex-col items-center gap-3 px-4 py-8 text-center sm:flex-row sm:justify-between sm:gap-4 sm:text-left">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary shrink-0">
              <Receipt className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Track realized profit</p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                Upload your Transaction History CSV to see the gains you&apos;ve locked
                in from selling — including coins you&apos;ve fully exited.
              </p>
            </div>
          </div>
          <button
            onClick={onUpload}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 shrink-0"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Transactions
          </button>
        </div>
      </BlurFade>
    );
  }

  const { total, byToken } = realized;

  return (
    <BlurFade delay={0.06}>
      <div className="finance-card overflow-hidden">
        {/* ── Header: all-time realized total ── */}
        <div className="flex items-start justify-between px-4 py-4 sm:px-5">
          <div>
            <p className="label-mono mb-1">All-Time Realized</p>
            <p
              className={cn(
                "text-xl sm:text-2xl font-semibold tabular-nums",
                total >= 0 ? "text-income" : "text-expense",
              )}
            >
              {total >= 0 ? "+" : "-"}
              {format(Math.abs(total), "USD")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {uploadedAt && (
              <span className="text-[10px] font-mono text-muted-foreground">
                {new Date(uploadedAt).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            )}
            <button
              onClick={onClear}
              className="text-[10px] font-mono text-muted-foreground/60 underline hover:text-foreground cursor-pointer"
            >
              clear
            </button>
          </div>
        </div>

        {/* ── Per-coin breakdown ── */}
        {byToken.length === 0 ? (
          <div className="border-t border-border/60 px-4 py-6 text-center sm:px-5">
            <p className="text-xs text-muted-foreground">
              No realized sells yet — locked-in gains show up here once you sell.
            </p>
          </div>
        ) : (
          <ul className="border-t border-border/60 divide-y divide-border/40">
            {byToken.map((r) => (
              <li
                key={r.token}
                className="flex items-center justify-between px-4 py-2.5 sm:px-5"
              >
                <span className="text-sm font-medium truncate pr-3">{r.token}</span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums shrink-0",
                    r.realizedPnlUsd >= 0 ? "text-income" : "text-expense",
                  )}
                >
                  {r.realizedPnlUsd >= 0 ? "+" : "-"}
                  {format(Math.abs(r.realizedPnlUsd), "USD")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BlurFade>
  );
}
