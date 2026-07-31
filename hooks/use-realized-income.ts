"use client";

import { useMemo } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import { deriveRealizedSales } from "@/lib/utils/portfolio-transactions";
import { parseCryptoCSV, computeRealizedSales } from "@/lib/utils/crypto-csv";
import type {
  IncomeEntry,
  PortfolioHolding,
  PortfolioTransaction,
  RealizedSaleEvent,
} from "@/lib/utils/types";

/** Persisted opt-out for the whole feature. */
export const REALIZED_INCOME_ENABLED_KEY = "realized_income_enabled";

export interface RealizedIncome {
  /** Derived rows to merge for display/totals. Empty when the toggle is off. */
  entries: IncomeEntry[];
  /**
   * Whether the logs contain any realized sells at all, independent of the
   * toggle — so the opt-out control stays on screen after it is switched off.
   */
  hasSource: boolean;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

/**
 * Realized profit, projected onto the income page as read-only entries.
 *
 * These are recomputed from `portfolio_transactions` and the crypto
 * transaction CSV on every render — never written to `income_entries`. Correct
 * a transaction and the matching income row follows on its own, and there is no
 * dedupe key to get wrong because nothing is stored.
 *
 * Callers must keep these separate from the entries they mutate: merge them for
 * display and totals, but always save/delete against the real list.
 */
export function useRealizedIncome(): RealizedIncome {
  const [enabled, setEnabled] = useCloudStorage<boolean>(
    REALIZED_INCOME_ENABLED_KEY,
    true,
  );
  const [transactions] = useCloudStorage<PortfolioTransaction[]>(
    "portfolio_transactions",
    [],
  );
  const [holdings] = useCloudStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [txCsvText] = useCloudStorage<string>("crypto_tx_csv_text", "");
  const { convert } = useCurrency();

  // Tickers live on the holding, not the transaction — used for the Source
  // column. Falls back to the holding name for holdings since deleted.
  const tickerFor = useMemo(() => {
    const map = new Map(holdings.map((h) => [h.id, h.ticker]));
    return (holdingId: string) => map.get(holdingId);
  }, [holdings]);

  const stockSales = useMemo(
    () =>
      transactions.length > 0
        ? deriveRealizedSales(transactions, convert, tickerFor)
        : [],
    [transactions, convert, tickerFor],
  );

  const cryptoSales = useMemo(
    () => (txCsvText ? computeRealizedSales(parseCryptoCSV(txCsvText)) : []),
    [txCsvText],
  );

  const entries = useMemo(
    () =>
      enabled ? [...stockSales, ...cryptoSales].map(toIncomeEntry) : [],
    [enabled, stockSales, cryptoSales],
  );

  return {
    entries,
    hasSource: stockSales.length > 0 || cryptoSales.length > 0,
    enabled,
    setEnabled,
  };
}

function toIncomeEntry(sale: RealizedSaleEvent): IncomeEntry {
  const verb = sale.realized >= 0 ? "Gain on" : "Loss on";
  return {
    id: sale.id,
    type: sale.source === "stocks" ? "realized_stocks" : "realized_crypto",
    description: `${verb} ${sale.label} sell`,
    amount: sale.realized,
    currency: sale.currency,
    date: sale.date,
    source: sale.ticker,
    notes: "",
    isPassive: true,
    isRecurring: false,
    // Sorts last among same-date rows; derived rows have no real creation time.
    createdAt: 0,
    derived: true,
  };
}
