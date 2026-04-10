"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type MouseEventParams,
  type Time,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
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
  /** Optional: source currency override for `currentValue` */
  currentValueCurrency?: string;
  /** Show LIVE indicator */
  isLive?: boolean;
  /** Default period selection */
  defaultPeriod?: Period;
  /** Chart height */
  height?: number;
}

// ---------------------------------------------------------------------------
// Constants
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" → Unix seconds (UTCTimestamp) */
function parseToTimestamp(s: string): UTCTimestamp {
  if (s.length <= 10) {
    return Math.floor(new Date(`${s}T00:00:00`).getTime() / 1000) as UTCTimestamp;
  }
  return Math.floor(new Date(s.replace(" ", "T")).getTime() / 1000) as UTCTimestamp;
}

/** Format a hovered timestamp based on the active period granularity. */
function formatHoverTime(time: UTCTimestamp, period: Period): string {
  const date = new Date((time as number) * 1000);
  if (period === "1D") {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (period === "1W" || period === "1M") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
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
  const [hoverInfo, setHoverInfo] = useState<{
    value: number;
    time: UTCTimestamp;
    x: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  // Convert + sort + dedupe snapshots (lightweight-charts requires strictly ascending time)
  const convertedSnapshots = useMemo(() => {
    const byTime = new Map<UTCTimestamp, number>();
    for (const s of snapshots) {
      const cur = s.currency ?? "USD";
      const value = cur !== currency
        ? Math.round(convert(s.value, cur) * 100) / 100
        : s.value;
      // Last write wins for duplicate timestamps
      byTime.set(parseToTimestamp(s.date), value);
    }
    return Array.from(byTime, ([time, value]) => ({ time, value }))
      .sort((a, b) => a.time - b.time);
  }, [snapshots, currency, convert]);

  // Filter by period
  const filteredData = useMemo(() => {
    if (convertedSnapshots.length === 0) return [];
    const nowSec = Math.floor(Date.now() / 1000);
    let cutoff = 0;
    switch (period) {
      case "1D":
        cutoff = nowSec - 24 * 60 * 60;
        break;
      case "1W":
        cutoff = nowSec - 7 * 24 * 60 * 60;
        break;
      case "1M":
        cutoff = nowSec - 30 * 24 * 60 * 60;
        break;
      case "6M":
        cutoff = nowSec - 180 * 24 * 60 * 60;
        break;
      case "1Y":
        cutoff = nowSec - 365 * 24 * 60 * 60;
        break;
      case "ALL":
        return convertedSnapshots;
    }
    return convertedSnapshots.filter((s) => s.time >= cutoff);
  }, [convertedSnapshots, period]);

  // Append the live current value as the latest data point
  const chartData = useMemo(() => {
    if (filteredData.length === 0) return [];
    const data = [...filteredData];
    if (currentValue > 0) {
      const liveTime = Math.floor(Date.now() / 1000) as UTCTimestamp;
      const last = data[data.length - 1];
      // Avoid duplicate timestamps (lightweight-charts requires strictly increasing)
      if (liveTime > last.time) {
        data.push({ time: liveTime, value: currentValue });
      } else {
        data[data.length - 1] = { time: last.time, value: currentValue };
      }
    }
    return data;
  }, [filteredData, currentValue]);

  // Compute PnL stats
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const first = chartData[0].value;
    const last = chartData[chartData.length - 1].value;
    const change = last - first;
    const changePct = first > 0 ? (change / first) * 100 : 0;
    return { first, last, change, changePct };
  }, [chartData]);

  const isPositive = (stats?.change ?? 0) >= 0;

  // Chart colors based on PnL direction
  const lineColor = isPositive
    ? (isDark ? "#4ade80" : "#2e8b57")
    : (isDark ? "#f87171" : "#c95f3f");
  const topColor = isPositive
    ? (isDark ? "rgba(74, 222, 128, 0.30)" : "rgba(46, 139, 87, 0.30)")
    : (isDark ? "rgba(248, 113, 113, 0.30)" : "rgba(201, 95, 63, 0.30)");
  const bottomColor = isPositive
    ? (isDark ? "rgba(74, 222, 128, 0.0)" : "rgba(46, 139, 87, 0.0)")
    : (isDark ? "rgba(248, 113, 113, 0.0)" : "rgba(201, 95, 63, 0.0)");

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#888" : "#968360",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: {
        visible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: isDark ? "#a3e635" : "#65a30d",
          width: 1,
          style: LineStyle.Solid,
          labelVisible: false,
        },
        horzLine: {
          visible: false,
          labelVisible: false,
        },
      },
      handleScale: false,
      handleScroll: false,
      width: containerRef.current.clientWidth,
      height,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor,
      bottomColor,
      lineWidth: 2,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Crosshair tracking — drives the header value swap + time overlay
    const handleCrosshair = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.point) {
        setHoverInfo(null);
        return;
      }
      const seriesInstance = seriesRef.current;
      if (!seriesInstance) return;
      const data = param.seriesData.get(seriesInstance);
      if (!data || !("value" in data) || typeof data.value !== "number") {
        setHoverInfo(null);
        return;
      }
      setHoverInfo({
        value: data.value,
        time: param.time as UTCTimestamp,
        x: param.point.x,
      });
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, height]);

  // Update colors when PnL direction changes
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.applyOptions({ lineColor, topColor, bottomColor });
  }, [lineColor, topColor, bottomColor]);

  // Clear stale hover info when switching periods
  useEffect(() => {
    setHoverInfo(null);
  }, [period]);

  // Set data when chartData changes
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    if (chartData.length === 0) {
      seriesRef.current.setData([]);
      return;
    }
    seriesRef.current.setData(chartData);
    chartRef.current.timeScale().fitContent();
  }, [chartData]);

  const periods: Period[] = ["1D", "1W", "1M", "6M", "1Y"];
  const liveValue = currentValueCurrency
    ? convert(currentValue, currentValueCurrency)
    : currentValue;
  // When hovering, display the value at the crosshair; the hover value comes
  // from the already-converted series data so no extra conversion is needed.
  const displayValue = hoverInfo ? hoverInfo.value : liveValue;
  const hoverTimeLabel = hoverInfo ? formatHoverTime(hoverInfo.time, period) : null;

  return (
    <div className="finance-card px-4 py-5 sm:p-6">
      {/* Header */}
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
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="display-number">
              {hoverInfo ? (
                <span>
                  {symbol}
                  {displayValue.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              ) : (
                <NumberTicker value={displayValue} prefix={symbol} decimalPlaces={2} />
              )}
            </div>
            <span className="text-sm font-mono uppercase tracking-wide text-muted-foreground">
              {currency}
            </span>
          </div>
          {hoverInfo ? (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {hoverTimeLabel}
              </span>
            </div>
          ) : (
            stats && (
              <div className="flex items-center gap-1.5 mt-1.5">
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
            )
          )}
        </div>

        {/* Desktop period selector — top-right */}
        <div className="hidden sm:flex gap-0.5 rounded-full bg-secondary/40 p-0.5 shrink-0">
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

      {/* Chart container */}
      {chartData.length > 1 ? (
        <div className="relative">
          <div ref={containerRef} style={{ height, width: "100%" }} />
          {hoverInfo && hoverTimeLabel && (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-mono text-foreground backdrop-blur-sm"
              style={{
                left: hoverInfo.x,
                transform: "translateX(-50%)",
              }}
            >
              {hoverTimeLabel}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center" style={{ height }}>
          <p className="text-sm text-muted-foreground/50">
            {snapshots.length === 0
              ? "No data yet — snapshots will appear once cron starts collecting"
              : `Not enough ${PERIOD_LABELS[period]} data — try a longer period`}
          </p>
        </div>
      )}

      {/* Mobile period selector — below chart, OKX-style pill */}
      <div className="mt-4 flex sm:hidden items-center justify-around">
        {periods.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              "px-4 py-1.5 text-xs font-mono font-medium rounded-full transition-colors",
              period === p
                ? "bg-foreground/90 text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
