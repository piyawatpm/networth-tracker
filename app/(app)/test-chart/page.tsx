"use client";

import { useState } from "react";
import ReactECharts from "echarts-for-react";

export default function TestChartPage() {
  const option = {
    title: {
      text: "Test Pie Chart",
      subtext: "Hover & click to test interaction",
      x: "center",
    },
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b} : {c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      left: "left",
      data: ["Direct", "Email", "Ads", "Video", "Search"],
    },
    series: [
      {
        name: "Traffic Source",
        type: "pie",
        radius: "55%",
        center: ["50%", "60%"],
        data: [
          { value: 335, name: "Direct" },
          { value: 310, name: "Email" },
          { value: 234, name: "Ads" },
          { value: 135, name: "Video" },
          { value: 1548, name: "Search" },
        ],
        itemStyle: {
          emphasis: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };

  const [count, setCount] = useState(0);

  function onChartReady(echarts: unknown) {
    console.log("echarts is ready", echarts);
  }

  function onChartClick(param: unknown) {
    console.log(param);
    setCount((c) => c + 1);
  }

  function onChartLegendselectchanged(param: unknown) {
    console.log(param);
  }

  return (
    <div>
      <ReactECharts
        option={option}
        style={{ height: 400 }}
        onChartReady={onChartReady}
        onEvents={{
          click: onChartClick,
          legendselectchanged: onChartLegendselectchanged,
        }}
      />
      <div className="p-4 text-center">
        <p>Click Count: {count}</p>
        <p className="text-sm text-muted-foreground">
          Open console, see the log detail.
        </p>
      </div>
    </div>
  );
}
