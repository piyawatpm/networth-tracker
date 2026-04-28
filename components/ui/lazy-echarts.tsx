"use client";

import dynamic from "next/dynamic";
import type { ComponentType, RefAttributes } from "react";
import type EChartsReact from "echarts-for-react";
import type { EChartsReactProps } from "echarts-for-react";

export const ReactECharts = dynamic(
  () => import("echarts-for-react"),
  { ssr: false },
) as ComponentType<EChartsReactProps & RefAttributes<EChartsReact>>;

export type { EChartsReact };
