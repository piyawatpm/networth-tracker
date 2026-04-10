"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Period = "1D" | "1W" | "1M" | "6M" | "1Y" | "ALL";

export interface SnapshotPoint {
  /** Full date string, e.g. "2026-04-10 12:30" or "2026-04-10" */
  date: string;
  /** Value in the snapshot's source currency */
  value: number;
  /** Source currency, defaults to USD */
  currency?: string;
}

export interface PerformanceChartProps {
  /** Label shown above the value, e.g. "Net Worth", "Portfolio", "Crypto Portfolio" */
  label: string;
  /** Live current value (in user's preferred currency) — used as the displayed total */
  currentValue: number;
  /** Historical snapshots (raw, in their stored currency) */
  snapshots: SnapshotPoint[];
  /** Optional: source currency override for `currentValue` (defaults to user's currency) */
  currentValueCurrency?: string;
  /** Show LIVE indicator */
  isLive?: boolean;
  /** Default period selection */
  defaultPeriod?: Period;
  /** Chart height */
  height?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERIOD_LABELS: Record<Period, string> = {
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  "6M": "6M",
  "1Y": "1Y",
  "ALL": "All",
};

const PNL_LABELS: Record<Period, string> = {
  "1D": "Today's PnL",
  "1W": "7D PnL",
  "1M": "30D PnL",
  "6M": "6M PnL",
  "1Y": "1Y PnL",
  "ALL": "All-time PnL",
};

/** Parse date string "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" → Date object (Sydney-aware) */
function parseSnapshotDate(s: string): Date {
  // Both formats are local-time strings — JS will treat them as local
  // We just need them to be sortable/comparable
  if (s.length <= 10) return new Date(`${s}T00:00:00`);
  return new Date(s.replace(" ", "T"));
}

/** Format x-axis label depending on period */
function formatXLabel(date: string, period: Period): string {
  if (period === "1D") {
    // Show HH:MM
    const t = date.length > 10 ? date.slice(11) : "";
    return t || date.slice(5);
  }
  if (period === "1W" || period === "1M") {
    // Show MM/DD
    return date.slice(5, 10).replace("-", "/");
  }
  // 6M, 1Y, ALL — show MM/YY
  return `${date.slice(5, 7)}/${date.slice(2, 4)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PerformanceChart({
  label,
  currentValue,
  snapshots,
  currentValueCurrency,
  isLive = false,
  defaultPeriod = "1D",
  height = 280,
}: PerformanceChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { format, convert, currency, symbol } = useCurrency();
  const [period, setPeriod] = useState<Period>(defaultPeriod);

  // Convert snapshots to display currency
  const convertedSnapshots = useMemo(() => {
    return snapshots.map((s) => {
      const cur = s.currency ?? "USD";
      const value = cur !== currency
        ? Math.round(convert(s.value, cur) * 100) / 100
        : s.value;
      return { date: s.date, value, parsed: parseSnapshotDate(s.date) };
    }).sort((a, b) => a.parsed.getTime() - b.parsed.getTime());
  }, [snapshots, currency, convert]);

  // Filter by period
  const filteredData = useMemo(() => {
    if (convertedSnapshots.length === 0) return [];
    const now = Date.now();
    let cutoff = 0;
    switch (period) {
      case "1D":
        cutoff = now - 24 * 60 * 60 * 1000;
        break;
      case "1W":
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "1M":
        cutoff = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case "6M":
        cutoff = now - 180 * 24 * 60 * 60 * 1000;
        break;
      case "1Y":
        cutoff = now - 365 * 24 * 60 * 60 * 1000;
        break;
      case "ALL":
        return convertedSnapshots;
    }
    return convertedSnapshots.filter((s) => s.parsed.getTime() >= cutoff);
  }, [convertedSnapshots, period]);

  // Compute PnL stats — first vs last (or vs current value if live)
  const stats = useMemo(() => {
    if (filteredData.length === 0) return null;
    const first = filteredData[0].value;
    // Use the live current value as "now" for PnL calculation
    const last = currentValue || filteredData[filteredData.length - 1].value;
    const change = last - first;
    const changePct = first > 0 ? (change / first) * 100 : 0;
    const high = Math.max(...filteredData.map((d) => d.value), last);
    const low = Math.min(...filteredData.map((d) => d.value), last);
    return { first, last, change, changePct, high, low };
  }, [filteredData, currentValue]);

  const isPositive = (stats?.change ?? 0) >= 0;

  // Chart line color
  const lineColor = isPositive
    ? (isDark ? "#4ade80" : "#2e8b57")
    : (isDark ? "#f87171" : "#c95f3f");

  // Chart series — append the live current value as the last point
  const chartData = useMemo(() => {
    if (filteredData.length === 0) return [];
    const data = filteredData.map((d) => ({ date: d.date, value: d.value }));
    // Append live current value as the most recent point
    if (currentValue > 0) {
      const lastDate = data[data.length - 1].date;
      const now = new Date();
      const liveDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (liveDate !== lastDate) {
        data.push({ date: liveDate, value: currentValue });
      } else {
        data[data.length - 1] = { date: lastDate, value: currentValue };
      }
    }
    return data;
  }, [filteredData, currentValue]);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    return {
      ...base,
      grid: { top: 24, right: 12, bottom: 28, left: 8, containLabel: true },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: chartData.map((d) => formatXLabel(d.date, period)),
        boundaryGap: false,
        axisLabel: {
          ...base.xAxis.axisLabel,
          interval: chartData.length > 6 ? Math.floor(chartData.length / 5) : 0,
        },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        position: "right" as const,
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: (v: number) => formatAxisValue(v),
        },
        min: (value: { min: number }) => Math.floor(value.min * 0.995),
        max: (value: { max: number }) => Math.ceil(value.max * 1.005),
      },
      series: [
        {
          name: label,
          type: "line" as const,
          data: chartData.map((d) => d.value),
          smooth: 0.3,
          showSymbol: false,
          lineStyle: { color: lineColor, width: 2 },
          itemStyle: { color: lineColor, borderWidth: 0 },
          areaStyle: {
            color: {
              type: "linear" as const,
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: lineColor + "30" },
                { offset: 1, color: lineColor + "00" },
              ],
            },
          },
          markPoint: stats ? {
            symbol: "pin",
            symbolSize: 0,
            label: {
              fontSize: 10,
              color: isDark ? "#aaa" : "#888",
              formatter: (params: { value: number }) =>
                `${symbol}${Number(params.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            },
            data: [
              { type: "max" as const, name: "high" },
              { type: "min" as const, name: "low" },
            ],
          } : undefined,
        },
      ],
    };
  }, [chartData, isDark, lineColor, label, symbol, stats, period]);

  const periods: Period[] = ["1D", "1W", "1M", "6M", "1Y"];
  const displayValue = currentValueCurrency
    ? convert(currentValue, currentValueCurrency)
    : currentValue;

  return (
    <div className="finance-card px-4 py-5 sm:p-6">
      {/* Header — value + PnL + period selector */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="label-mono">{label}</p>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-income">
                <span className="h-1.5 w-1.5 rounded-full bg-income animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <div className="display-number">
            <NumberTicker value={displayValue} prefix={symbol} decimalPlaces={2} />
          </div>
          {stats && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs text-muted-foreground">{PNL_LABELS[period]}</span>
              <span className={cn(
                "text-xs font-semibold tabular-nums",
                isPositive ? "text-income" : "text-expense",
              )}>
                {isPositive ? "+" : ""}{format(stats.change)}
              </span>
              <span className={cn(
                "text-[10px] font-mono tabular-nums",
                isPositive ? "text-income" : "text-expense",
              )}>
                ({isPositive ? "+" : ""}{stats.changePct.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>

        {/* Period selector */}
        <div className="flex gap-0.5 rounded-full bg-secondary/40 p-0.5 shrink-0">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-mono font-medium rounded-full transition-colors",
                period === p
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 1 ? (
        <ReactECharts
          option={option}
          style={{ height, width: "100%" }}
          notMerge
          opts={{ renderer: "svg" }}
        />
      ) : (
        <div className="flex items-center justify-center" style={{ height }}>
          <p className="text-sm text-muted-foreground/50">
            {snapshots.length === 0
              ? "No data yet — snapshots will appear once cron starts collecting"
              : `Not enough ${PERIOD_LABELS[period]} data — try a longer period`}
          </p>
        </div>
      )}
    </div>
  );
}
