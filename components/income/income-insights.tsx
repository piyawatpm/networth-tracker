"use client";

import { useMemo } from "react";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry } from "@/lib/utils/types";
import { INCOME_TYPE_LABELS } from "@/lib/utils/constants";
import { getLastNMonthKeys, getMonthKey, monthKeyToLabel } from "@/lib/utils/timezone";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Activity, BarChart3 } from "lucide-react";

interface IncomeInsightsProps {
  entries: IncomeEntry[];
}

export function IncomeInsights({ entries }: IncomeInsightsProps) {
  const { convert, format } = useCurrency();

  const monthKeys = useMemo(() => getLastNMonthKeys(6), []);

  // Monthly totals for last 6 months
  const monthlyTotals = useMemo(() => {
    return monthKeys.map((mk) =>
      entries
        .filter((e) => getMonthKey(e.date) === mk)
        .reduce((s, e) => s + convert(e.amount, e.currency), 0),
    );
  }, [entries, convert, monthKeys]);

  // Average monthly income
  const monthsWithData = monthlyTotals.filter((v) => v > 0).length;
  const avgMonthly = monthsWithData > 0
    ? monthlyTotals.reduce((s, v) => s + v, 0) / monthsWithData
    : 0;

  // Rolling 3-month average
  const avg3m = monthlyTotals.slice(-3).filter((v) => v > 0).length > 0
    ? monthlyTotals.slice(-3).reduce((s, v) => s + v, 0) / Math.max(1, monthlyTotals.slice(-3).filter((v) => v > 0).length)
    : 0;

  // Income stability (coefficient of variation) — lower = more stable
  const nonZero = monthlyTotals.filter((v) => v > 0);
  const mean = nonZero.length > 0 ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0;
  const variance = nonZero.length > 1
    ? nonZero.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (nonZero.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;
  const stabilityScore = Math.max(0, Math.min(100, 100 - cv));
  const stabilityLabel = stabilityScore >= 80 ? "Very Stable" : stabilityScore >= 60 ? "Stable" : stabilityScore >= 40 ? "Moderate" : "Volatile";

  // Per-source growth trends (6-month sparklines)
  const sourceGrowth = useMemo(() => {
    const sources: Record<string, number[]> = {};
    for (const mk of monthKeys) {
      const monthEntries = entries.filter((e) => getMonthKey(e.date) === mk);
      const byType: Record<string, number> = {};
      for (const e of monthEntries) {
        byType[e.type] = (byType[e.type] ?? 0) + convert(e.amount, e.currency);
      }
      // Track all types seen
      for (const t of Object.keys(byType)) {
        if (!sources[t]) sources[t] = Array(monthKeys.indexOf(mk)).fill(0);
      }
      for (const t of Object.keys(sources)) {
        sources[t].push(byType[t] ?? 0);
      }
    }
    // Pad shorter arrays
    for (const t of Object.keys(sources)) {
      while (sources[t].length < monthKeys.length) sources[t].push(0);
    }

    return Object.entries(sources)
      .map(([type, values]) => {
        const total = values.reduce((s, v) => s + v, 0);
        const recent = values.slice(-3).reduce((s, v) => s + v, 0);
        const prior = values.slice(0, 3).reduce((s, v) => s + v, 0);
        const growth = prior > 0 ? ((recent - prior) / prior) * 100 : recent > 0 ? 100 : 0;
        return {
          type,
          label: (INCOME_TYPE_LABELS as Record<string, string>)[type] ?? type,
          total,
          values,
          growth,
        };
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [entries, convert, monthKeys]);

  return (
    <div className="space-y-4">
      {/* Top stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-secondary/30 p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Avg Monthly</p>
          <p className="text-sm font-bold tabular-nums">{format(avgMonthly)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">6-month avg</p>
        </div>
        <div className="rounded-lg bg-secondary/30 p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">3-Month Avg</p>
          <p className="text-sm font-bold tabular-nums">{format(avg3m)}</p>
          <p className={cn("text-[10px] mt-0.5", avg3m >= avgMonthly ? "text-income" : "text-expense")}>
            {avg3m >= avgMonthly ? "Above" : "Below"} 6mo avg
          </p>
        </div>
        <div className="rounded-lg bg-secondary/30 p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Activity className="h-3 w-3 text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Stability</p>
          </div>
          <p className={cn(
            "text-sm font-bold tabular-nums",
            stabilityScore >= 60 ? "text-income" : stabilityScore >= 40 ? "text-foreground" : "text-expense",
          )}>
            {Math.round(stabilityScore)}%
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{stabilityLabel}</p>
        </div>
      </div>

      {/* Source growth sparklines */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Income Sources (6-month trend)</p>
        </div>
        <div className="space-y-2">
          {sourceGrowth.slice(0, 6).map((source) => {
            const max = Math.max(...source.values, 1);
            return (
              <div key={source.type} className="flex items-center gap-3">
                <span className="text-xs w-24 truncate text-muted-foreground">{source.label}</span>
                {/* Mini sparkline */}
                <div className="flex items-end gap-px h-5 flex-1">
                  {source.values.map((v, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm bg-income/50 transition-all min-h-[1px]"
                      style={{ height: `${(v / max) * 100}%` }}
                    />
                  ))}
                </div>
                <span className="font-mono text-[11px] tabular-nums w-16 text-right shrink-0">
                  {format(source.total)}
                </span>
                <span className={cn(
                  "font-mono text-[10px] tabular-nums w-14 text-right shrink-0 flex items-center justify-end gap-0.5",
                  source.growth > 5 ? "text-income" : source.growth < -5 ? "text-expense" : "text-muted-foreground",
                )}>
                  {source.growth > 5 ? <TrendingUp className="h-2.5 w-2.5" /> : source.growth < -5 ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                  {Math.abs(source.growth).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
