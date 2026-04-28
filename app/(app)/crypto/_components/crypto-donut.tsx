"use client";

import { useMemo } from "react";
import { ReactECharts, type EChartsReact } from "@/components/ui/lazy-echarts";
import { getPieBaseOption } from "@/lib/utils/echarts";
import { useCurrency } from "@/components/providers/currency-provider";

export interface DonutChartItem {
  token: string;
  value: number;
  fill: string;
}

export function CryptoDonut({
  chartData,
  isDark,
  chartRef,
}: {
  chartData: DonutChartItem[];
  isDark: boolean;
  chartRef: React.RefObject<EChartsReact | null>;
}) {
  const { symbol } = useCurrency();
  const base = getPieBaseOption(isDark, symbol);
  const option = useMemo(
    () => ({
      ...base,
      legend: { show: false },
      series: [
        {
          type: "pie" as const,
          radius: ["46%", "76%"],
          center: ["50%", "50%"],
          padAngle: 2,
          data: chartData.map((d) => ({
            name: d.token,
            value: d.value,
            itemStyle: { color: d.fill },
          })),
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.3)",
            },
          },
        },
      ],
    }),
    [base, chartData],
  );

  return (
    <div className="w-full overflow-hidden">
      <ReactECharts
        ref={chartRef}
        option={option}
        style={{ height: 260, width: "100%" }}
        opts={{ renderer: "svg" }}
      />
    </div>
  );
}
