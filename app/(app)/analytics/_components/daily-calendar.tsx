"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSydneyDateString } from "@/lib/utils/timezone";
import {
  getMonthDays,
  getISOWeekday,
  type DailyPnlEntry,
} from "@/lib/utils/pnl";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DailyCalendarProps {
  dailyPnl: DailyPnlEntry[];
  format: (amount: number) => string;
  symbol: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Format large numbers compactly with currency symbol: 1234 -> "+฿1.2k". */
function compactPnl(value: number, symbol: string): string {
  if (value === 0) return `${symbol}0`;
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : "-";
  if (abs >= 1000) return `${sign}${symbol}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${symbol}${Math.round(abs)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DailyCalendar({ dailyPnl, format, symbol }: DailyCalendarProps) {
  const todayStr = getSydneyDateString();
  const [todayYear, todayMonth] = todayStr.split("-").map(Number);

  const [year, setYear] = useState(todayYear);
  const [month, setMonth] = useState(todayMonth);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Build lookup map: date string -> DailyPnlEntry
  const pnlMap = useMemo(() => {
    const map = new Map<string, DailyPnlEntry>();
    for (const entry of dailyPnl) {
      map.set(entry.date, entry);
    }
    return map;
  }, [dailyPnl]);

  // Days in the current viewed month + offset for first day
  const days = useMemo(() => getMonthDays(year, month), [year, month]);
  const firstDayOffset = useMemo(
    () => (days.length > 0 ? getISOWeekday(days[0]) : 0),
    [days],
  );

  // Month navigation
  const isCurrentMonth = year === todayYear && month === todayMonth;

  function goToPrevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
    setSelectedDay(null);
  }

  function goToNextMonth() {
    if (isCurrentMonth) return;
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
    setSelectedDay(null);
  }

  // Selected day data
  const selectedEntry = selectedDay ? pnlMap.get(selectedDay) : null;

  return (
    <div className="finance-card p-5">
      {/* ---- Header ---- */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <p className="label-mono">Daily Breakdown</p>
          {/* Fixed-height slot prevents layout shift when a day is selected. */}
          <p
            className={cn(
              "text-lg font-bold tabular-nums font-mono leading-7 h-7 flex items-baseline gap-2",
              !selectedEntry && "opacity-0 select-none",
              selectedEntry && selectedEntry.totalPnl >= 0
                ? "text-income"
                : "text-expense",
            )}
          >
            <span>{format(selectedEntry?.totalPnl ?? 0)}</span>
            {selectedEntry && (
              <span className="text-xs text-muted-foreground">
                {selectedEntry.totalPnlPct >= 0 ? "+" : ""}
                {selectedEntry.totalPnlPct.toFixed(2)}%
              </span>
            )}
          </p>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-secondary transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="min-w-[7rem] text-center text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {MONTH_LABELS[month - 1]} {year}
          </span>
          <button
            onClick={goToNextMonth}
            disabled={isCurrentMonth}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              isCurrentMonth
                ? "opacity-30 cursor-not-allowed"
                : "hover:bg-secondary",
            )}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* ---- Weekday row ---- */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-mono uppercase tracking-wider text-muted-foreground py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* ---- Calendar grid ---- */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells before first day */}
        {Array.from({ length: firstDayOffset }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {/* Day cells */}
        {days.map((dateStr) => {
          const entry = pnlMap.get(dateStr);
          const isFuture = dateStr > todayStr;
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDay;
          const hasData = !!entry;
          const pnl = entry?.totalPnl ?? 0;

          return (
            <button
              key={dateStr}
              disabled={isFuture}
              onClick={() =>
                setSelectedDay(isSelected ? null : dateStr)
              }
              className={cn(
                "rounded-md min-h-[3.5rem] flex flex-col items-center justify-center gap-0.5 transition-colors",
                // PnL coloring
                hasData && pnl > 0 && "bg-income/8 hover:bg-income/15",
                hasData && pnl < 0 && "bg-expense/8 hover:bg-expense/15",
                hasData && pnl === 0 && "bg-secondary/50 hover:bg-secondary",
                // States
                isFuture && "opacity-30 cursor-not-allowed",
                !hasData && !isFuture && "opacity-40",
                isSelected && "ring-2 ring-foreground/30",
              )}
            >
              <span className="text-[11px] font-mono text-muted-foreground">
                {isToday ? "Today" : parseInt(dateStr.slice(8), 10)}
              </span>
              {hasData && (
                <span
                  className={cn(
                    "text-[10px] font-mono tabular-nums",
                    pnl > 0
                      ? "text-income"
                      : pnl < 0
                        ? "text-expense"
                        : "text-muted-foreground",
                  )}
                >
                  {compactPnl(pnl, symbol)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---- Selected day breakdown (always rendered to avoid layout shift) ---- */}
      <div className="mt-4 border-t border-border/60 pt-4">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          {selectedEntry ? `${selectedDay} Breakdown` : "Click a day to see breakdown"}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-secondary/50 p-3">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Stocks PnL
            </p>
            <p
              className={cn(
                "text-sm font-bold tabular-nums font-mono",
                !selectedEntry && "text-muted-foreground/40",
                selectedEntry &&
                  (selectedEntry.portfolioPnl >= 0 ? "text-income" : "text-expense"),
              )}
            >
              {format(selectedEntry?.portfolioPnl ?? 0)}
            </p>
          </div>
          <div className="rounded-md bg-secondary/50 p-3">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Crypto PnL
            </p>
            <p
              className={cn(
                "text-sm font-bold tabular-nums font-mono",
                !selectedEntry && "text-muted-foreground/40",
                selectedEntry &&
                  (selectedEntry.cryptoPnl >= 0 ? "text-income" : "text-expense"),
              )}
            >
              {format(selectedEntry?.cryptoPnl ?? 0)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
