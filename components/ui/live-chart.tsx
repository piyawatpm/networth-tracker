"use client";

import { useEffect, useRef, useCallback } from "react";
import { createChart, ColorType, LineSeries, LastPriceAnimationMode, type IChartApi, type ISeriesApi, type SeriesType } from "lightweight-charts";
import { useTheme } from "next-themes";

interface LiveChartProps {
  /** Current total value — chart updates when this changes */
  value: number;
  /** Update interval in ms (how often to push a new point) */
  interval?: number;
  /** Chart height */
  height?: number;
  /** Currency symbol for price axis */
  symbol?: string;
  /** Line color override */
  lineColor?: string;
}

export function LiveChart({
  value,
  interval = 5000,
  height = 220,
  symbol = "$",
  lineColor,
}: LiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const firstValueRef = useRef<number | null>(null);
  const lastPushRef = useRef<number>(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Determine line color based on P&L direction
  const isUp = firstValueRef.current !== null ? value >= firstValueRef.current : true;
  const autoColor = isUp
    ? (isDark ? "#4ade80" : "#2e8b57")
    : (isDark ? "#f87171" : "#c95f3f");
  const color = lineColor ?? autoColor;

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const bgColor = isDark ? "#1a1a1a" : "#efeee5";
    const textColor = isDark ? "#888888" : "#968360";
    const gridColor = isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)";

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor,
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: gridColor, visible: true },
        horzLines: { color: gridColor, visible: true },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)",
          labelBackgroundColor: isDark ? "#333" : "#dedbca",
        },
        horzLine: {
          color: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)",
          labelBackgroundColor: isDark ? "#333" : "#dedbca",
        },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: false },
      handleScale: false,
    });

    chartRef.current = chart;

    const series = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
      priceLineVisible: false,
      crosshairMarkerRadius: 4,
    });
    seriesRef.current = series;

    // Push initial point
    const now = Math.floor(Date.now() / 1000);
    series.setData([{ time: now as any, value: valueRef.current }]);
    firstValueRef.current = valueRef.current;
    lastPushRef.current = now;

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      firstValueRef.current = null;
    };
  }, [isDark, height]); // recreate on theme change

  // Push data points at interval
  useEffect(() => {
    const timer = setInterval(() => {
      if (!seriesRef.current) return;

      const now = Math.floor(Date.now() / 1000);
      // Ensure time always advances (lightweight-charts requires ascending time)
      const time = Math.max(now, lastPushRef.current + 1);
      lastPushRef.current = time;

      seriesRef.current.update({ time: time as any, value: valueRef.current });
      chartRef.current?.timeScale().scrollToRealTime();
    }, interval);

    return () => clearInterval(timer);
  }, [interval]);

  // Update line color when P&L direction changes
  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.applyOptions({ color });
    }
  }, [color]);

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height }}
    />
  );
}
