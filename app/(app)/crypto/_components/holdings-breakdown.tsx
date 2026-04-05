"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/components/providers/currency-provider";
import type { CryptoHolding } from "@/lib/utils/types";
import { ECHARTS_COLORS } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";
import { Bitcoin, ArrowUpDown, X, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import type { DonutChartItem } from "./crypto-donut";

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

type SortField = "token" | "amount" | "value" | "cost" | "pnl" | "pct" | "exchange";

export function HoldingsBreakdown({
  pricedHoldings,
  holdings,
  totalValueUsd,
  selectedTokens,
  setSelectedTokens,
  allChartTokens,
  donutNode,
  highlightSlice,
  downplayAll,
  exchangeData,
  getExchange,
  editingExchange,
  setEditingExchange,
  editExchangeValue,
  setEditExchangeValue,
  saveExchange,
  stablecoinTags,
  setStablecoinTags,
  clearCsv,
}: {
  pricedHoldings: CryptoHolding[];
  holdings: CryptoHolding[];
  totalValueUsd: number;
  selectedTokens: Record<string, boolean>;
  setSelectedTokens: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  allChartTokens: DonutChartItem[];
  donutNode: React.ReactNode;
  highlightSlice: (name: string) => void;
  downplayAll: () => void;
  exchangeData: { name: string; value: number; fill: string }[];
  getExchange: (holding: CryptoHolding) => string;
  editingExchange: string | null;
  setEditingExchange: (token: string | null) => void;
  editExchangeValue: string;
  setEditExchangeValue: (value: string) => void;
  saveExchange: (token: string, value: string) => void;
  stablecoinTags: Record<string, boolean>;
  setStablecoinTags: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  clearCsv: () => void;
}) {
  const { format } = useCurrency();

  const [sortField, setSortField] = useState<SortField>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showTagDialog, setShowTagDialog] = useState(false);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const sortedHoldings = useMemo(() => {
    const list = [...pricedHoldings];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "token":
          cmp = a.token.localeCompare(b.token);
          break;
        case "amount":
          cmp = a.amount - b.amount;
          break;
        case "value":
          cmp = a.currentValueUsd - b.currentValueUsd;
          break;
        case "cost":
          cmp = a.totalCostUsd - b.totalCostUsd;
          break;
        case "pnl":
          cmp = (a.currentValueUsd - a.totalCostUsd) - (b.currentValueUsd - b.totalCostUsd);
          break;
        case "pct":
          cmp = a.currentValueUsd - b.currentValueUsd;
          break;
        case "exchange":
          cmp = (getExchange(a)).localeCompare(getExchange(b));
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [pricedHoldings, sortField, sortDir, getExchange]);

  // Donut data: only selected tokens
  const chartData = useMemo(() => {
    return allChartTokens.filter((d) => selectedTokens[d.token] !== false);
  }, [allChartTokens, selectedTokens]);

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
        {/* Donut chart + legend */}
        <BlurFade delay={0.12}>
          <div className="finance-card p-6">
            <p className="label-mono mb-4">ALLOCATION</p>
            {chartData.length > 0 ? (
              donutNode
            ) : allChartTokens.length > 0 ? (
              <div className="flex items-center justify-center h-[260px] text-sm text-muted-foreground">
                All tokens hidden
              </div>
            ) : null}
            {/* Interactive legend with progress bars */}
            <div className="mt-4 space-y-1">
              {allChartTokens.map((d) => {
                const isSelected = selectedTokens[d.token] !== false;
                const visibleTotal = allChartTokens
                  .filter((t) => selectedTokens[t.token] !== false)
                  .reduce((s, t) => s + t.value, 0);
                const pct = isSelected && visibleTotal > 0
                  ? (d.value / visibleTotal) * 100 : 0;
                return (
                  <button
                    key={d.token}
                    onClick={() =>
                      setSelectedTokens((prev) => ({
                        ...prev,
                        [d.token]: !isSelected,
                      }))
                    }
                    onMouseEnter={() => isSelected && highlightSlice(d.token)}
                    onMouseLeave={downplayAll}
                    className={cn(
                      "flex flex-col w-full text-left rounded-lg px-2 py-1.5 transition-all",
                      isSelected ? "hover:bg-secondary/50" : "opacity-40 hover:opacity-60",
                    )}
                  >
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn("inline-block h-2.5 w-2.5 rounded-full transition-transform", !isSelected && "scale-75")}
                          style={{ backgroundColor: isSelected ? d.fill : "#aaa" }}
                        />
                        <span className={cn("text-xs", !isSelected && "line-through text-muted-foreground")}>{d.token}</span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {isSelected ? `${format(d.value, "USD")} (${pct.toFixed(1)}%)` : "\u2014"}
                      </span>
                    </div>
                    {isSelected && (
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: d.fill }}
                        />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </BlurFade>

        {/* Holdings table */}
        <BlurFade delay={0.18}>
          <div className="finance-card overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <p className="label-mono">HOLDINGS</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowTagDialog(true)}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Tags className="h-3 w-3" />
                  Tag
                </button>
                <button
                  onClick={() => setShowClearDialog(true)}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th
                      className="px-6 pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("token")}
                    >
                      <span className="inline-flex items-center gap-1">
                        Token
                        {sortField === "token" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("amount")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Amount
                        {sortField === "amount" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("value")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Value
                        {sortField === "value" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("cost")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Cost
                        {sortField === "cost" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("pnl")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        P&L
                        {sortField === "pnl" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-4 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("exchange")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        Exchange
                        {sortField === "exchange" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                    <th
                      className="px-6 pb-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer select-none"
                      onClick={() => toggleSort("pct")}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        % Port
                        {sortField === "pct" && <ArrowUpDown className="h-2.5 w-2.5" />}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map((h, i) => {
                    const rowPnl = h.currentValueUsd - h.totalCostUsd;
                    const pctOfPort =
                      totalValueUsd > 0
                        ? (h.currentValueUsd / totalValueUsd) * 100
                        : 0;

                    return (
                      <tr
                        key={h.token}
                        className={cn(
                          "border-b border-border/40 transition-colors hover:bg-secondary/40",
                          i === sortedHoldings.length - 1 && "border-b-0",
                          selectedTokens[h.token] === false && "opacity-40",
                        )}
                      >
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                              style={{
                                backgroundColor:
                                  ECHARTS_COLORS[i % ECHARTS_COLORS.length],
                                opacity: 0.15,
                              }}
                            >
                              <Bitcoin
                                className="h-3 w-3"
                                style={{
                                  color:
                                    ECHARTS_COLORS[i % ECHARTS_COLORS.length],
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
                            rowPnl >= 0 ? "text-income" : "text-expense",
                          )}
                        >
                          {`${rowPnl >= 0 ? "+" : "-"}${format(Math.abs(rowPnl), "USD")}`}
                          {h.totalCostUsd > 0 && (
                            <span className="ml-1 text-[10px] opacity-70">
                              {rowPnl >= 0 ? "+" : ""}{((rowPnl / h.totalCostUsd) * 100).toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {editingExchange === h.token ? (
                            <input
                              autoFocus
                              className="w-20 bg-transparent border-b border-border text-right text-xs outline-none"
                              value={editExchangeValue}
                              onChange={(e) => setEditExchangeValue(e.target.value)}
                              onBlur={() => saveExchange(h.token, editExchangeValue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveExchange(h.token, editExchangeValue);
                                if (e.key === "Escape") setEditingExchange(null);
                              }}
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setEditingExchange(h.token);
                                setEditExchangeValue(getExchange(h));
                              }}
                              className="hover:text-foreground transition-colors cursor-pointer"
                            >
                              {getExchange(h) || "\u2014"}
                            </button>
                          )}
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

      {/* Exchange Allocation */}
      {exchangeData.length > 1 && (
        <BlurFade delay={0.24}>
          <div className="finance-card p-6">
            <p className="label-mono mb-4">BY EXCHANGE</p>
            <div className="space-y-2.5">
              {exchangeData.map((item) => {
                const pct = totalValueUsd > 0 ? (item.value / totalValueUsd) * 100 : 0;
                return (
                  <div key={item.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: item.fill }}
                        />
                        <span>{item.name}</span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {format(item.value, "USD")} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: item.fill,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </BlurFade>
      )}

      {/* Clear confirmation dialog */}
      <Dialog
        open={showClearDialog}
        onOpenChange={(open) => !open && setShowClearDialog(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear Crypto Data</DialogTitle>
            <DialogDescription>
              This will remove all crypto holdings data. You can re-import a CSV
              anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button variant="destructive" onClick={clearCsv}>
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stablecoin tag dialog */}
      <Dialog
        open={showTagDialog}
        onOpenChange={(open) => !open && setShowTagDialog(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tag as Stablecoin</DialogTitle>
            <DialogDescription>
              Tokens tagged as stablecoin will be grouped into &quot;Stablecoin&quot; on the dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto py-2">
            {holdings
              .map((h) => (
                <label
                  key={h.token}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-secondary/50 cursor-pointer"
                >
                  <span className="text-sm font-medium">{h.token}</span>
                  <input
                    type="checkbox"
                    checked={stablecoinTags[h.token] === true}
                    onChange={(e) =>
                      setStablecoinTags((prev) => ({
                        ...prev,
                        [h.token]: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-border accent-foreground"
                  />
                </label>
              ))}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Done
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
