"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import {
  parseAndComputeHoldings,
  getTotalCryptoValueUsd,
  getTotalCryptoCostUsd,
  getCashValueUsd,
} from "@/lib/utils/crypto-csv";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PieChart, Pie, Cell } from "recharts";
import { CHART_COLORS } from "@/lib/utils/constants";
import { Upload, FileText, X, Bitcoin } from "lucide-react";

export default function CryptoPage() {
  const [csvText, setCsvText] = useLocalStorage<string>("crypto_csv_text", "");
  const { format, convert, symbol } = useCurrency();
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const holdings = useMemo(
    () => (csvText ? parseAndComputeHoldings(csvText) : []),
    [csvText]
  );

  const totalValueUsd = useMemo(
    () => getTotalCryptoValueUsd(holdings),
    [holdings]
  );
  const totalCostUsd = useMemo(
    () => getTotalCryptoCostUsd(holdings),
    [holdings]
  );
  const cashUsd = useMemo(() => getCashValueUsd(holdings), [holdings]);
  const pnlUsd = totalValueUsd - totalCostUsd;

  const totalValueConverted = convert(totalValueUsd, "USD");
  const totalCostConverted = convert(totalCostUsd, "USD");
  const pnlConverted = convert(pnlUsd, "USD");
  const cashConverted = convert(cashUsd, "USD");

  // Chart data: exclude tiny holdings (< 1% of total)
  const chartData = useMemo(() => {
    if (totalValueUsd === 0) return [];
    return holdings
      .filter((h) => h.currentValueUsd / totalValueUsd >= 0.01)
      .map((h, i) => ({
        token: h.token,
        value: h.currentValueUsd,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [holdings, totalValueUsd]);

  const chartConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    chartData.forEach((d) => {
      config[d.token] = { label: d.token, color: d.fill };
    });
    return config;
  }, [chartData]);

  const handleFile = useCallback(
    (file: File) => {
      setUploadStatus("Reading file...");
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text && text.trim().length > 0) {
          setCsvText(text);
          const h = parseAndComputeHoldings(text);
          if (h.length > 0) {
            setUploadStatus(`Loaded ${h.length} holdings`);
          } else {
            setUploadStatus("Could not parse holdings. Check CSV format.");
          }
        } else {
          setUploadStatus("File was empty");
        }
      };
      reader.onerror = () => {
        setUploadStatus("Error reading file");
      };
      reader.readAsText(file);
    },
    [setCsvText]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (e.target) e.target.value = "";
    },
    [handleFile]
  );

  const clearCsv = useCallback(() => {
    setCsvText("");
    setUploadStatus(null);
  }, [setCsvText]);

  const hasData = csvText.length > 0 && holdings.length > 0;

  // ── Empty state: CSV upload zone ──────────────────────────
  if (!hasData) {
    return (
      <div className="space-y-8">
        <BlurFade delay={0}>
          <div>
            <p className="label-mono mb-2">CRYPTO PORTFOLIO</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Import your crypto data
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Upload a CSV export from your exchange to track holdings,
              allocations, and profit/loss.
            </p>
          </div>
        </BlurFade>

        <BlurFade delay={0.08}>
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "finance-card flex flex-col items-center justify-center gap-4 p-12 md:p-20 cursor-pointer border-2 border-dashed transition-colors",
              isDragOver
                ? "border-accent bg-accent/5"
                : "border-border/60 hover:border-muted-foreground/30"
            )}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                Drop your CSV file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Accepts .csv files from crypto exchanges
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
              onChange={onFileSelect}
              className="hidden"
            />
          </div>
          {uploadStatus && (
            <p className="text-xs text-muted-foreground text-center mt-2">{uploadStatus}</p>
          )}
        </BlurFade>
      </div>
    );
  }

  // ── Portfolio view ────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Hero */}
      <BlurFade delay={0}>
        <div className="flex items-start justify-between">
          <div>
            <p className="label-mono mb-2">CRYPTO PORTFOLIO</p>
            <div className="display-number">
              {symbol}
              <NumberTicker value={totalValueConverted} decimalPlaces={2} />
            </div>
          </div>
          <button
            onClick={() => replaceInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <FileText className="h-3.5 w-3.5" />
            Replace CSV
          </button>
          <input
            ref={replaceInputRef}
            type="file"
            accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
      </BlurFade>

      {/* Metrics tile */}
      <BlurFade delay={0.06}>
        <div className="finance-card flex flex-col divide-y divide-border/60 sm:flex-row sm:divide-x sm:divide-y-0">
          <MetricCell
            label="Total Value"
            value={format(totalValueUsd, "USD")}
          />
          <MetricCell
            label="Total Cost"
            value={format(totalCostUsd, "USD")}
          />
          <MetricCell
            label="P&L"
            value={format(Math.abs(pnlUsd), "USD")}
            prefix={pnlUsd >= 0 ? "+" : "-"}
            className={pnlUsd >= 0 ? "text-income" : "text-expense"}
          />
          <MetricCell
            label="Cash"
            value={format(cashUsd, "USD")}
          />
        </div>
      </BlurFade>

      {/* Chart + Table */}
      <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
        {/* Donut chart */}
        <BlurFade delay={0.12}>
          <div className="finance-card p-6">
            <p className="label-mono mb-4">ALLOCATION</p>
            {chartData.length > 0 && (
              <ChartContainer
                config={chartConfig}
                className="mx-auto aspect-square max-h-[260px]"
              >
                <PieChart>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        nameKey="token"
                        formatter={(value) => {
                          const num = typeof value === "number" ? value : Number(value);
                          return format(num, "USD");
                        }}
                      />
                    }
                  />
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="token"
                    innerRadius={60}
                    outerRadius={100}
                    strokeWidth={2}
                    stroke="var(--background)"
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.token} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
              {chartData.map((d) => (
                <div key={d.token} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: d.fill }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {d.token}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </BlurFade>

        {/* Holdings table */}
        <BlurFade delay={0.18}>
          <div className="finance-card overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <p className="label-mono">HOLDINGS</p>
              <button
                onClick={clearCsv}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th className="px-6 pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Token
                    </th>
                    <th className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Amount
                    </th>
                    <th className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Value
                    </th>
                    <th className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Cost
                    </th>
                    <th className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      P&L
                    </th>
                    <th className="px-6 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      % Port
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => {
                    const rowPnl = h.currentValueUsd - h.totalCostUsd;
                    const pctOfPort =
                      totalValueUsd > 0
                        ? (h.currentValueUsd / totalValueUsd) * 100
                        : 0;
                    const isCash = h.token === "CASH";

                    return (
                      <tr
                        key={h.token}
                        className={cn(
                          "border-b border-border/40 transition-colors hover:bg-secondary/40",
                          i === holdings.length - 1 && "border-b-0"
                        )}
                      >
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                              style={{
                                backgroundColor:
                                  CHART_COLORS[i % CHART_COLORS.length],
                                opacity: 0.15,
                              }}
                            >
                              <Bitcoin
                                className="h-3 w-3"
                                style={{
                                  color:
                                    CHART_COLORS[i % CHART_COLORS.length],
                                }}
                              />
                            </div>
                            <span className="font-medium">{h.token}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-xs text-muted-foreground">
                          {formatCryptoAmount(h.amount)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-sm">
                          {format(h.currentValueUsd, "USD")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-xs text-muted-foreground">
                          {format(h.totalCostUsd, "USD")}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right tabular-nums font-mono text-xs",
                            isCash
                              ? "text-muted-foreground/40"
                              : rowPnl >= 0
                                ? "text-income"
                                : "text-expense"
                          )}
                        >
                          {isCash
                            ? "--"
                            : `${rowPnl >= 0 ? "+" : "-"}${format(Math.abs(rowPnl), "USD")}`}
                        </td>
                        <td className="px-6 py-3 text-right tabular-nums font-mono text-xs text-muted-foreground">
                          {pctOfPort.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </BlurFade>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function MetricCell({
  label,
  value,
  prefix,
  className,
}: {
  label: string;
  value: string;
  prefix?: string;
  className?: string;
}) {
  return (
    <div className="flex-1 px-5 py-4 sm:px-6 sm:py-5">
      <p className="label-mono mb-1">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", className)}>
        {prefix}
        {value}
      </p>
    </div>
  );
}

function formatCryptoAmount(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (Math.abs(amount) >= 1) {
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  if (Math.abs(amount) >= 0.0001) {
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    });
  }
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  });
}
