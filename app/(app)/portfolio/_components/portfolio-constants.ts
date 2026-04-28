import type { PortfolioHolding, HoldingType, AccountType } from "@/lib/utils/types";
import { CHART_COLORS, HOLDING_TYPE_LABELS } from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";

// "savings" excluded — managed on the Emergency Fund page
export const HOLDING_TYPES: HoldingType[] = ["stock", "etf", "fund", "bond", "other"];
export const ACCOUNT_TYPES: AccountType[] = ["normal", "super"];

export const HOLDING_TYPE_COLOR_MAP: Record<HoldingType, string> = {
  stock: CHART_COLORS[0],
  etf: CHART_COLORS[1],
  fund: CHART_COLORS[2],
  bond: CHART_COLORS[3],
  savings: CHART_COLORS[7],
  other: CHART_COLORS[4],
};

/** Types that don't need price fetching (value = balance, not units * price) */
export const BALANCE_TYPES = new Set<HoldingType>(["savings"]);

export type SortKey = "value" | "pnl" | "name" | "invested";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "value", label: "Value \u2193" },
  { value: "pnl", label: "P&L% \u2193" },
  { value: "name", label: "Name A\u2192Z" },
  { value: "invested", label: "Invested \u2193" },
];

export type TrendPeriod = "1W" | "1M" | "3M" | "All";

export interface PortfolioSnapshot {
  date: string;
  value: number;
  valueWithSuper: number;
}

export interface PortfolioTotals {
  totalValue: number;
  totalInvested: number;
  pnl: number;
  pnlPercent: number;
  count: number;
}

export async function exportPortfolioXls(
  holdings: PortfolioHolding[],
  convert: (value: number, currency: string) => number,
) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const rows: (string | number | null)[][] = [];

  rows.push(["Name", "Ticker", "Type", "Account", "Broker", "Country", "Currency", "Units", "Invested", "Value", "P&L", "P&L %"]);

  for (const h of holdings) {
    const inv = convert(h.amountInvested, h.currency);
    const cur = convert(h.currentValue, h.currency);
    const pnl = cur - inv;
    const pnlPct = inv > 0 ? ((pnl / inv) * 100) : 0;

    rows.push([
      h.name, h.ticker, HOLDING_TYPE_LABELS[h.type],
      h.accountType === "super" ? "Super" : "Normal",
      h.broker || "", h.country || "", h.currency, h.units,
      Math.round(inv * 100) / 100, Math.round(cur * 100) / 100,
      Math.round(pnl * 100) / 100, Math.round(pnlPct * 10) / 10,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [24, 10, 8, 8, 14, 8, 8, 12, 12, 12, 12, 8].map((wch) => ({ wch }));

  XLSX.utils.book_append_sheet(wb, ws, "Portfolio");
  XLSX.writeFile(wb, `portfolio-${getSydneyDateString()}.xlsx`);
}
