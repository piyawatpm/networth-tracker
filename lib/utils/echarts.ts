// Shared ECharts configuration — matches our design tokens
// All charts should use these defaults for consistent styling

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

export function getEchartsBaseOption(isDark: boolean) {
  const textColor = isDark ? "#888888" : "#968360";
  const borderColor = isDark ? "#454545" : "#c9c3a8";
  const bgColor = "transparent";

  return {
    backgroundColor: bgColor,
    textStyle: {
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      color: textColor,
    },
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
      axisLabel: {
        color: textColor,
        fontSize: 11,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      },
      splitLine: { show: false },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: textColor,
        fontSize: 11,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      },
      splitLine: {
        lineStyle: {
          color: borderColor,
          type: "dashed" as const,
          opacity: 0.5,
        },
      },
    },
    tooltip: {
      backgroundColor: isDark ? "#2a2a2a" : "#f4f3ed",
      borderColor: borderColor,
      borderWidth: 1,
      textStyle: {
        color: isDark ? "#f6f6f6" : "#2c251e",
        fontSize: 12,
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      },
      padding: [8, 12],
      extraCssText: "border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);",
    },
    color: ECHARTS_COLORS,
  };
}

// Format large numbers for axis labels
export function formatAxisValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}
