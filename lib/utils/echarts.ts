// Shared ECharts configuration — matches our design tokens

export const ECHARTS_COLORS = [
  "#4d7cc7", // blue
  "#2ea598", // teal
  "#d4a033", // amber
  "#c9503f", // terracotta-red
  "#4da8b8", // cyan
  "#7ec44e", // lime
  "#d47633", // orange
  "#8b5cf6", // purple
  "#e06090", // rose
  "#7c5cc9", // violet
  "#4daa8b", // muted-teal
  "#4565c9", // deep-blue
  "#d4603a", // red-orange
  "#c050b0", // magenta
  "#5090c0", // steel
];

function getColors(isDark: boolean) {
  return {
    text: isDark ? "#888888" : "#968360",
    border: isDark ? "#454545" : "#c9c3a8",
    fg: isDark ? "#f6f6f6" : "#2c251e",
    tooltipBg: isDark ? "#2a2a2a" : "#f4f3ed",
  };
}

function tooltipConfig(isDark: boolean) {
  const c = getColors(isDark);
  return {
    backgroundColor: c.tooltipBg,
    borderColor: c.border,
    borderWidth: 1,
    textStyle: {
      color: c.fg,
      fontSize: 12,
    },
    padding: [8, 12],
    extraCssText: "border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);",
  };
}

// For bar/line/area charts (has xAxis, yAxis, grid)
export function getCartesianBaseOption(isDark: boolean, currencySymbol?: string) {
  const c = getColors(isDark);
  const sym = currencySymbol ?? "";
  return {
    backgroundColor: "transparent",
    color: ECHARTS_COLORS,
    textStyle: { color: c.text },
    grid: {
      top: 12,
      right: 12,
      bottom: 32,
      left: 48,
      containLabel: false,
    },
    xAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.text, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.text, fontSize: 11 },
      splitLine: {
        lineStyle: { color: c.border, type: "dashed" as const, opacity: 0.5 },
      },
    },
    tooltip: {
      ...tooltipConfig(isDark),
      trigger: "axis" as const,
      ...(sym ? { valueFormatter: (v: number) => `${sym}${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` } : {}),
    },
  };
}

// For pie/donut charts (NO xAxis, yAxis, grid)
export function getPieBaseOption(isDark: boolean, currencySymbol?: string) {
  const sym = currencySymbol ?? "";
  return {
    backgroundColor: "transparent",
    color: ECHARTS_COLORS,
    tooltip: {
      ...tooltipConfig(isDark),
      trigger: "item" as const,
      formatter: sym
        ? (params: { name: string; value: number; percent: number }) =>
            `${params.name}: ${sym}${Number(params.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${params.percent}%)`
        : "{b}: {c} ({d}%)",
    },
  };
}

// Legacy alias — use getCartesianBaseOption or getPieBaseOption instead
export function getEchartsBaseOption(isDark: boolean) {
  return getCartesianBaseOption(isDark);
}

// Format large numbers for axis labels
export function formatAxisValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}
