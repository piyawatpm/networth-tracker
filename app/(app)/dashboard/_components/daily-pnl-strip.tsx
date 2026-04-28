"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { useCurrency } from "@/components/providers/currency-provider";

interface DailyPnlStripProps {
  nwSnapshots: { date: string; value: number; currency?: string }[];
  format: (amount: number) => string;
  /** Live total in the user's display currency — anchors "today" to the live header. */
  currentValue?: number;
  delay: number;
}

export function DailyPnlStrip({ nwSnapshots, format, currentValue, delay }: DailyPnlStripProps) {
  const { convert } = useCurrency();

  const { todayPnl, todayPct, monthPnl, monthPct } = useMemo(() => {
    if (nwSnapshots.length === 0 && currentValue == null) {
      return { todayPnl: 0, todayPct: 0, monthPnl: 0, monthPct: 0 };
    }

    // Day → last snapshot value, converted to the user's display currency so
    // PnL reacts to currency switches and uses the same units as the chart.
    const dailyMap = new Map<string, number>();
    for (const s of nwSnapshots) {
      const day = s.date.slice(0, 10);
      const cur = s.currency ?? "USD";
      dailyMap.set(day, convert(s.value, cur));
    }

    const sortedDays = Array.from(dailyMap.keys()).sort();
    const today = getSydneyDateString();
    // Prefer the live value (already in user's currency) so this strip stays
    // in lockstep with the live header instead of lagging the last cron tick.
    const todayVal = currentValue ?? dailyMap.get(today) ?? 0;

    // Yesterday's close — last snapshot before today.
    let prevDayVal = 0;
    for (let i = sortedDays.length - 1; i >= 0; i--) {
      if (sortedDays[i] < today) {
        prevDayVal = dailyMap.get(sortedDays[i])!;
        break;
      }
    }

    // Pre-month close — last snapshot before this month started. If none
    // exists (new account, history doesn't reach back far enough), anchor on
    // the first snapshot of the current month so the percentage isn't stuck
    // at 0% while the absolute number reads as the whole current balance.
    const monthPrefix = today.slice(0, 7);
    let preMonthVal = 0;
    for (let i = sortedDays.length - 1; i >= 0; i--) {
      if (sortedDays[i] < `${monthPrefix}-01`) {
        preMonthVal = dailyMap.get(sortedDays[i])!;
        break;
      }
    }
    if (preMonthVal === 0) {
      const firstThisMonth = sortedDays.find((d) => d.startsWith(monthPrefix));
      if (firstThisMonth) preMonthVal = dailyMap.get(firstThisMonth)!;
    }

    // Without a prior reference, treat PnL as 0 instead of displaying the
    // entire current balance as a fake "PnL" with 0% change.
    const tPnl = prevDayVal !== 0 ? todayVal - prevDayVal : 0;
    const tPct = prevDayVal !== 0 ? (tPnl / Math.abs(prevDayVal)) * 100 : 0;
    const mPnl = preMonthVal !== 0 ? todayVal - preMonthVal : 0;
    const mPct = preMonthVal !== 0 ? (mPnl / Math.abs(preMonthVal)) * 100 : 0;

    return { todayPnl: tPnl, todayPct: tPct, monthPnl: mPnl, monthPct: mPct };
  }, [nwSnapshots, currentValue, convert]);

  if (todayPnl === 0 && monthPnl === 0) return null;

  return (
    <BlurFade delay={delay}>
      <div className="finance-card px-5 py-4">
        <div className="flex items-center gap-5">
          {/* Today's PnL */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Today
            </p>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-lg font-semibold font-mono tabular-nums",
                  todayPnl > 0 ? "text-income" : todayPnl < 0 ? "text-expense" : "text-foreground",
                )}
              >
                {todayPnl > 0 ? "+" : todayPnl < 0 ? "-" : ""}{format(Math.abs(todayPnl))}
              </span>
              <span
                className={cn(
                  "text-xs font-mono tabular-nums",
                  todayPnl > 0 ? "text-income/70" : todayPnl < 0 ? "text-expense/70" : "text-muted-foreground",
                )}
              >
                {todayPct >= 0 ? "+" : ""}{todayPct.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="w-px h-10 bg-border/60 shrink-0" />

          {/* This Month's PnL */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              This Month
            </p>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-lg font-semibold font-mono tabular-nums",
                  monthPnl > 0 ? "text-income" : monthPnl < 0 ? "text-expense" : "text-foreground",
                )}
              >
                {monthPnl > 0 ? "+" : monthPnl < 0 ? "-" : ""}{format(Math.abs(monthPnl))}
              </span>
              <span
                className={cn(
                  "text-xs font-mono tabular-nums",
                  monthPnl > 0 ? "text-income/70" : monthPnl < 0 ? "text-expense/70" : "text-muted-foreground",
                )}
              >
                {monthPct >= 0 ? "+" : ""}{monthPct.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </BlurFade>
  );
}
