"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { getSydneyDateString } from "@/lib/utils/timezone";

interface DailyPnlStripProps {
  nwSnapshots: { date: string; value: number }[];
  format: (amount: number) => string;
  delay: number;
}

export function DailyPnlStrip({ nwSnapshots, format, delay }: DailyPnlStripProps) {
  const { todayPnl, todayPct, monthPnl, monthPct } = useMemo(() => {
    if (nwSnapshots.length < 2) return { todayPnl: 0, todayPct: 0, monthPnl: 0, monthPct: 0 };

    // Build a daily map: day -> last snapshot value (last-write-wins from hourly snapshots)
    const dailyMap = new Map<string, number>();
    for (const s of nwSnapshots) {
      const day = s.date.slice(0, 10);
      dailyMap.set(day, s.value);
    }

    const sortedDays = Array.from(dailyMap.keys()).sort();
    const today = getSydneyDateString();
    const todayVal = dailyMap.get(today) ?? 0;

    // Find previous day value (the day before today that has data)
    let prevDayVal = 0;
    for (let i = sortedDays.length - 1; i >= 0; i--) {
      if (sortedDays[i] < today) {
        prevDayVal = dailyMap.get(sortedDays[i])!;
        break;
      }
    }

    // Find pre-month value (last snapshot before this month started)
    const monthPrefix = today.slice(0, 7); // YYYY-MM
    let preMonthVal = 0;
    for (let i = sortedDays.length - 1; i >= 0; i--) {
      if (sortedDays[i] < `${monthPrefix}-01`) {
        preMonthVal = dailyMap.get(sortedDays[i])!;
        break;
      }
    }

    const tPnl = todayVal - prevDayVal;
    const tPct = prevDayVal !== 0 ? (tPnl / Math.abs(prevDayVal)) * 100 : 0;
    const mPnl = todayVal - preMonthVal;
    const mPct = preMonthVal !== 0 ? (mPnl / Math.abs(preMonthVal)) * 100 : 0;

    return { todayPnl: tPnl, todayPct: tPct, monthPnl: mPnl, monthPct: mPct };
  }, [nwSnapshots]);

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
