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
  TickMarkType,
} from "lightweight-charts";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
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
  /** Optional per-category components in the same source currency (for stacked view) */
  components?: Record<string, number>;
}

/** Definition of a category for stacked-area rendering (bottom → top order). */
export interface StackedCategory {
  /** Key matching `SnapshotPoint.components` */
  key: string;
  /** Display label (used in the tooltip/legend) */
  label: string;
  /** Area/line color in light mode */
  colorLight: string;
  /** Area/line color in dark mode */
  colorDark: string;
}

export interface BreakdownRow {
  key: string;
  label: string;
  /** Value in the user's preferred currency (already converted) */
  value: number;
  /** Render as a negative/expense-colored row */
  negative?: boolean;
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
  /**
   * Live per-category component values (same currency as `currentValue`).
   * When provided, the overlay lines append this as the latest point so they
   * stay in sync with the main live total instead of lagging behind cron
   * snapshots.
   */
  liveComponents?: Record<string, number>;
  /** Show LIVE indicator */
  isLive?: boolean;
  /** Default period selection */
  defaultPeriod?: Period;
  /** Chart height */
  height?: number;
  /** Optional breakdown rows revealed via a chevron toggle at the bottom */
  breakdownRows?: BreakdownRow[];
  /** Label above the breakdown list (defaults to "Holdings") */
  breakdownLabel?: string;
  /**
   * Render as a stacked-area chart: one translucent area per category,
   * ordered bottom-to-top. The chart still renders a single total line
   * for PnL / hover tracking. Snapshots must include a `components` map.
   */
  stackedCategories?: StackedCategory[];
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

/** Convert a #rrggbb hex color to an rgba() string with the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Format a hovered timestamp based on the active period granularity. */
function formatHoverTime(time: UTCTimestamp, period: Period): string {
  const date = new Date((time as number) * 1000);
  if (period === "1D") {
    // e.g. "Sat, Apr 25 · 14:30"
    const datePart = date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const timePart = date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${datePart} · ${timePart}`;
  }
  if (period === "1W" || period === "1M") {
    // e.g. "Sat, Apr 25"
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  // 6M / 1Y / ALL — include year for clarity
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Build an x-axis tick formatter that adapts to the active period.
 * For 1D we want time labels; for everything else we want date labels
 * (the lib otherwise leans on time when `timeVisible` is true).
 */
function getTickMarkFormatter(period: Period) {
  return (time: Time, tickType: TickMarkType): string => {
    const date = new Date((time as number) * 1000);

    if (period === "1D") {
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }

    switch (tickType) {
      case TickMarkType.Year:
        return date.getFullYear().toString();
      case TickMarkType.Month:
        return date.toLocaleDateString("en-US", { month: "short" });
      case TickMarkType.DayOfMonth:
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      case TickMarkType.Time:
      case TickMarkType.TimeWithSeconds:
        // Non-1D periods should never show time on the axis — fall back to date
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return "";
  };
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
  breakdownRows,
  breakdownLabel = "Holdings",
  stackedCategories,
  liveComponents,
}: PerformanceChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { format, convert, currency, symbol } = useCurrency();
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true); // toggle category overlay lines
  const [hoverInfo, setHoverInfo] = useState<{
    value: number;
    components?: Record<string, number>;
    time: UTCTimestamp;
    x: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  // When stacked, one extra series per category (ordered top → bottom for draw order).
  const stackedSeriesRefs = useRef<ISeriesApi<"Area">[]>([]);

  const hasStackedProp = Boolean(stackedCategories && stackedCategories.length > 0);

  // Convert + sort + dedupe snapshots (lightweight-charts requires strictly ascending time)
  const convertedSnapshots = useMemo(() => {
    type Entry = { value: number; components?: Record<string, number> };
    const byTime = new Map<UTCTimestamp, Entry>();
    for (const s of snapshots) {
      const cur = s.currency ?? "USD";
      const needsConvert = cur !== currency;
      const value = needsConvert
        ? Math.round(convert(s.value, cur) * 100) / 100
        : s.value;
      let components: Record<string, number> | undefined;
      if (s.components) {
        components = {};
        for (const [k, v] of Object.entries(s.components)) {
          components[k] = needsConvert
            ? Math.round(convert(v, cur) * 100) / 100
            : v;
        }
      }
      // Last write wins for duplicate timestamps
      byTime.set(parseToTimestamp(s.date), { value, components });
    }
    return Array.from(byTime, ([time, entry]) => ({
      time,
      value: entry.value,
      components: entry.components,
    })).sort((a, b) => a.time - b.time);
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

  // Compute the single live data point once — reused by the main line, the
  // overlay lines, and the hover lookup so every series reflects the same
  // "now" instead of diverging (main line live, overlays stuck at last cron).
  const livePoint = useMemo(() => {
    if (filteredData.length === 0) return null;
    const liveTime = Math.floor(Date.now() / 1000) as UTCTimestamp;
    const last = filteredData[filteredData.length - 1];
    const time = (liveTime > last.time ? liveTime : last.time) as UTCTimestamp;
    return { time, value: currentValue, components: liveComponents };
  }, [currentValue, filteredData, liveComponents]);

  // Append the live current value as the latest data point
  const chartData = useMemo(() => {
    if (filteredData.length === 0) return [];
    const data = filteredData.map((s) => ({ time: s.time, value: s.value }));
    if (livePoint) {
      const last = data[data.length - 1];
      // Avoid duplicate timestamps (lightweight-charts requires strictly increasing)
      if (livePoint.time > last.time) {
        data.push({ time: livePoint.time, value: livePoint.value });
      } else {
        data[data.length - 1] = { time: last.time, value: livePoint.value };
      }
    }
    return data;
  }, [filteredData, livePoint]);

  // Per-category % change series (all on a shared hidden scale so they're comparable).
  // Each category is normalised to % change from its first value in the period.
  const stackedChartData = useMemo(() => {
    if (!hasStackedProp || !stackedCategories) return null;
    return stackedCategories.map((cat) => {
      const raw: { time: UTCTimestamp; value: number }[] = [];
      for (const snap of filteredData) {
        if (!snap.components) continue;
        const val = snap.components[cat.key] ?? 0;
        if (val <= 0) continue;
        raw.push({ time: snap.time, value: val });
      }
      // Append live point so overlays move with the main line in real-time.
      if (livePoint?.components) {
        const liveVal = livePoint.components[cat.key] ?? 0;
        if (liveVal > 0) {
          const lastRaw = raw[raw.length - 1];
          if (!lastRaw) {
            raw.push({ time: livePoint.time, value: liveVal });
          } else if (livePoint.time > lastRaw.time) {
            raw.push({ time: livePoint.time, value: liveVal });
          } else {
            raw[raw.length - 1] = { time: lastRaw.time, value: liveVal };
          }
        }
      }
      if (raw.length === 0) return [];
      const base = raw[0].value;
      if (base === 0) return [];
      return raw.map((pt) => ({
        time: pt.time,
        value: ((pt.value - base) / base) * 100, // % change
      }));
    });
  }, [filteredData, stackedCategories, hasStackedProp, livePoint]);

  // Latest raw values + % change per category (for the legend display)
  const stackedLatestValues = useMemo(() => {
    if (!hasStackedProp || !stackedCategories) return null;
    return stackedCategories.map((cat) => {
      let first = 0;
      let last = 0;
      for (const snap of filteredData) {
        if (!snap.components) continue;
        const val = snap.components[cat.key] ?? 0;
        if (val > 0) {
          if (first === 0) first = val;
          last = val;
        }
      }
      if (livePoint?.components) {
        const liveVal = livePoint.components[cat.key] ?? 0;
        if (liveVal > 0) {
          if (first === 0) first = liveVal;
          last = liveVal;
        }
      }
      const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
      return { value: last, changePct };
    });
  }, [filteredData, stackedCategories, hasStackedProp, livePoint]);

  // Time → full row lookup for the hover tooltip (main value + per-category).
  const hoverLookup = useMemo(() => {
    const map = new Map<number, { value: number; components?: Record<string, number> }>();
    for (const s of filteredData) {
      map.set(s.time as number, { value: s.value, components: s.components });
    }
    if (livePoint) {
      const existing = map.get(livePoint.time as number);
      map.set(livePoint.time as number, {
        value: livePoint.value,
        components: livePoint.components ?? existing?.components,
      });
    }
    return map;
  }, [filteredData, livePoint]);

  // Keep a ref in sync so the crosshair handler (captured by useEffect) can
  // always read the current lookup without re-binding the subscription.
  const hoverLookupRef = useRef(hoverLookup);
  useEffect(() => {
    hoverLookupRef.current = hoverLookup;
  }, [hoverLookup]);

  // Only render stacked mode when toggled ON and snapshots have component data
  const hasStacked = showOverlay && hasStackedProp && Boolean(
    stackedChartData && stackedChartData.some((band) => band.length > 0),
  );

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

  // Chart colors based on PnL direction (OKX-style vibrant green / pink)
  const lineColor = isPositive
    ? (isDark ? "#22c55e" : "#16a34a")
    : (isDark ? "#f43f5e" : "#e11d48");
  const topColor = isPositive
    ? (isDark ? "rgba(34, 197, 94, 0.30)" : "rgba(22, 163, 74, 0.25)")
    : (isDark ? "rgba(244, 63, 94, 0.30)" : "rgba(225, 29, 72, 0.25)");
  const bottomColor = isPositive
    ? (isDark ? "rgba(34, 197, 94, 0.0)" : "rgba(22, 163, 74, 0.0)")
    : (isDark ? "rgba(244, 63, 94, 0.0)" : "rgba(225, 29, 72, 0.0)");

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
        horzLines: {
          color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
          style: LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.02 },
      },
      localization: {
        priceFormatter: (price: number) => {
          const abs = Math.abs(price);
          if (abs >= 10_000_000) return `${(price / 1_000_000).toFixed(0)}M`;
          if (abs >= 1_000_000) return `${(price / 1_000_000).toFixed(1)}M`;
          if (abs >= 1_000) return `${(price / 1_000).toFixed(0)}k`;
          return price.toFixed(0);
        },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: period === "1D",
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: getTickMarkFormatter(period),
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)",
          width: 1,
          style: LineStyle.Solid,
          labelVisible: false,
        },
        horzLine: {
          color: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)",
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: false,
        },
      },
      handleScale: false,
      handleScroll: false,
      width: containerRef.current.clientWidth,
      height,
    });

    // Category lines show % change on a shared scale (comparable trends).
    if (hasStacked && stackedCategories) {
      const refs: ISeriesApi<"Area">[] = [];
      for (const cat of stackedCategories) {
        const color = isDark ? cat.colorDark : cat.colorLight;
        const stackSeries = chart.addSeries(AreaSeries, {
          lineColor: color,
          topColor: hexToRgba(color, 0.10),
          bottomColor: hexToRgba(color, 0),
          lineWidth: 2,
          priceScaleId: "pct",
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: {
            type: "custom" as const,
            formatter: (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`,
            minMove: 0.1,
          },
        });
        refs.push(stackSeries);
      }
      // % change axis visible on the right in overlay mode; main $ axis hidden.
      chart.priceScale("pct").applyOptions({
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });
      chart.priceScale("right").applyOptions({ visible: false });
      stackedSeriesRefs.current = refs;
    }

    // Main net-worth series. In overlay mode the line and area are hidden so
    // only the % category lines are visible, but the series still exists so
    // the crosshair can read its value for the header.
    const series = chart.addSeries(AreaSeries, {
      lineColor: hasStacked ? "rgba(0,0,0,0)" : lineColor,
      topColor: hasStacked ? "rgba(0,0,0,0)" : topColor,
      bottomColor: hasStacked ? "rgba(0,0,0,0)" : bottomColor,
      lineWidth: 2,
      priceFormat: {
        type: "price" as const,
        precision: 0,
        minMove: 10000,
      },
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: !hasStacked,
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
      const lookup = hoverLookupRef.current.get(param.time as number);
      setHoverInfo({
        value: data.value,
        components: lookup?.components,
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
      stackedSeriesRefs.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, height, hasStacked, stackedCategories?.map((c) => c.key).join("|")]);

  // Update colors when PnL direction changes (keep main line colored; fills transparent when stacked)
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.applyOptions({
      lineColor,
      topColor: hasStacked ? "rgba(0,0,0,0)" : topColor,
      bottomColor: hasStacked ? "rgba(0,0,0,0)" : bottomColor,
    });
  }, [lineColor, topColor, bottomColor, hasStacked]);

  // Clear stale hover info when switching periods
  useEffect(() => {
    setHoverInfo(null);
  }, [period]);

  // Re-apply x-axis formatting when period changes (chart isn't recreated).
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      timeScale: {
        timeVisible: period === "1D",
        tickMarkFormatter: getTickMarkFormatter(period),
      },
    });
  }, [period]);

  // Set data when chartData changes (both main + stacked series)
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    if (chartData.length === 0) {
      seriesRef.current.setData([]);
      for (const s of stackedSeriesRefs.current) s.setData([]);
      return;
    }
    seriesRef.current.setData(chartData);
    // Each category series is independently scaled (1:1 with stackedCategories)
    if (stackedChartData && stackedCategories) {
      for (let i = 0; i < stackedCategories.length; i++) {
        const ref = stackedSeriesRefs.current[i];
        if (ref) ref.setData(stackedChartData[i]);
      }
    }
    chartRef.current.timeScale().fitContent();
  }, [chartData, stackedChartData, stackedCategories]);

  const periods: Period[] = ["1D", "1W", "1M", "6M", "1Y"];

  // Visible breakdown rows + percentage shares (denominator: positive-only total)
  const visibleBreakdown = useMemo(() => {
    if (!breakdownRows || breakdownRows.length === 0) return [];
    const visible = breakdownRows.filter((r) => r.value !== 0 || r.negative);
    const positiveTotal = visible
      .filter((r) => !r.negative && r.value > 0)
      .reduce((sum, r) => sum + r.value, 0);
    return visible.map((r) => ({
      ...r,
      sharePct: positiveTotal > 0 && !r.negative ? (r.value / positiveTotal) * 100 : 0,
    }));
  }, [breakdownRows]);

  const hasBreakdown = visibleBreakdown.length > 0;

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

        {/* Desktop period selector + overlay toggle — top-right */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {hasStackedProp && (
            <button
              onClick={() => setShowOverlay((v) => !v)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-mono font-medium rounded-full transition-colors",
                showOverlay
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground/50 hover:text-foreground",
              )}
              title={showOverlay ? "Hide category lines" : "Show category lines"}
            >
              {showOverlay ? "Overlay" : "Overlay"}
            </button>
          )}
          <div className="flex gap-0.5 rounded-full bg-secondary/40 p-0.5">
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
      </div>

      {/* Stacked legend — shown only in stacked mode */}
      {hasStacked && stackedCategories && chartData.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {stackedCategories.map((cat, idx) => {
            const color = isDark ? cat.colorDark : cat.colorLight;
            const entry = stackedLatestValues?.[idx];
            const lastBand = entry?.value ?? 0;
            const pct = entry?.changePct ?? 0;
            const pctPositive = pct >= 0;
            return (
              <div
                key={cat.key}
                className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground"
              >
                <span
                  className="h-2 w-2 rounded-sm shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="uppercase tracking-wide">{cat.label}</span>
                {lastBand > 0 && (
                  <>
                    <span className="tabular-nums text-foreground/80">
                      {format(lastBand)}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums",
                        pctPositive ? "text-income" : "text-expense",
                      )}
                    >
                      {pctPositive ? "+" : ""}
                      {pct.toFixed(2)}%
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Chart container */}
      {chartData.length > 1 ? (
        <div className="relative">
          <div ref={containerRef} style={{ height, width: "100%" }} />
          {hoverInfo && hoverTimeLabel && (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-md bg-background/95 px-2 py-1.5 text-[10px] font-mono text-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-sm"
              style={{
                left: hoverInfo.x,
                transform: "translateX(-50%)",
                minWidth: 140,
              }}
            >
              <div className="text-muted-foreground">{hoverTimeLabel}</div>
              <div className="mt-0.5 flex items-center justify-between gap-3">
                <span className="uppercase tracking-wide text-muted-foreground/80">
                  {label}
                </span>
                <span className="tabular-nums font-semibold">
                  {symbol}
                  {hoverInfo.value.toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>
              {hasStackedProp &&
                stackedCategories &&
                hoverInfo.components &&
                stackedCategories.map((cat) => {
                  const val = hoverInfo.components?.[cat.key] ?? 0;
                  if (val <= 0) return null;
                  const color = isDark ? cat.colorDark : cat.colorLight;
                  return (
                    <div
                      key={cat.key}
                      className="mt-0.5 flex items-center justify-between gap-3"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-sm"
                          style={{ backgroundColor: color }}
                        />
                        <span className="uppercase tracking-wide text-muted-foreground/80">
                          {cat.label}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {symbol}
                        {val.toLocaleString("en-US", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    </div>
                  );
                })}
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

      {/* Mobile period selector — below chart */}
      <div className="mt-4 flex sm:hidden items-center justify-around">
        {hasStackedProp && (
          <button
            onClick={() => setShowOverlay((v) => !v)}
            className={cn(
              "px-3 py-1.5 text-xs font-mono font-medium rounded-full transition-colors",
              showOverlay
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground/50 hover:text-foreground",
            )}
          >
            Overlay
          </button>
        )}
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

      {/* Breakdown reveal — Binance-style chevron at card bottom */}
      {hasBreakdown && (
        <>
          <AnimatePresence initial={false}>
            {breakdownOpen && (
              <motion.div
                key="breakdown"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-5 pt-4 border-t border-border/60">
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="label-mono">{breakdownLabel}</p>
                    <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/70">
                      {visibleBreakdown.length} {visibleBreakdown.length === 1 ? "asset" : "assets"}
                    </p>
                  </div>
                  <ul className="space-y-0.5">
                    {visibleBreakdown.map((row, i) => {
                      const barColor = row.negative
                        ? (isDark ? "#f43f5e" : "#e11d48")
                        : (isDark ? "#22c55e" : "#16a34a");
                      return (
                        <motion.li
                          key={row.key}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: 0.03 * i }}
                          className="group relative flex items-center justify-between gap-4 py-2.5 px-2 -mx-2 rounded-md hover:bg-secondary/40 transition-colors"
                        >
                          {/* Share bar (absolute, full-width behind content) */}
                          {!row.negative && row.sharePct > 0 && (
                            <span
                              className="pointer-events-none absolute inset-y-2 left-2 rounded-sm opacity-[0.08] group-hover:opacity-[0.14] transition-opacity"
                              style={{
                                width: `calc(${Math.min(100, row.sharePct)}% - 1rem)`,
                                backgroundColor: barColor,
                              }}
                            />
                          )}
                          <div className="relative flex items-center gap-2.5 min-w-0">
                            <span
                              className="h-1.5 w-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: barColor }}
                            />
                            <span className="text-sm font-medium truncate">{row.label}</span>
                          </div>
                          <div className="relative flex items-baseline gap-2 shrink-0">
                            <span
                              className={cn(
                                "font-mono text-sm tabular-nums",
                                row.negative ? "text-expense" : "text-foreground",
                              )}
                            >
                              {row.negative ? "-" : ""}
                              {format(Math.abs(row.value))}
                            </span>
                            {!row.negative && row.sharePct > 0 && (
                              <span className="text-[10px] font-mono tabular-nums text-muted-foreground/70 w-10 text-right">
                                {row.sharePct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </motion.li>
                      );
                    })}
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setBreakdownOpen((v) => !v)}
              aria-expanded={breakdownOpen}
              aria-label={breakdownOpen ? "Hide breakdown" : "Show breakdown"}
              className="group flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-muted-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <span>{breakdownOpen ? "Hide" : "Breakdown"}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-300",
                  breakdownOpen && "rotate-180",
                )}
              />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
