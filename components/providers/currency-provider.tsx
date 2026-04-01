"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Currency, CachedRates } from "@/lib/utils/types";
import { CURRENCY_SYMBOLS } from "@/lib/utils/types";
import { fetchFxRates, convertCurrency, formatCurrency } from "@/lib/utils/fx";
import { CURRENCIES } from "@/lib/utils/constants";

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  cycleCurrency: () => void;
  rates: Record<string, number> | null;
  ratesLoaded: boolean;
  ratesFetchedAt: number | null;
  convert: (amount: number, from: Currency, to?: Currency) => number;
  format: (amount: number, from?: Currency, compact?: boolean) => string;
  symbol: string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("AUD");
  const [cachedRates, setCachedRates] = useState<CachedRates | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("preferred_currency");
      if (saved && CURRENCIES.includes(saved as Currency)) {
        setCurrencyState(saved as Currency);
      }
    } catch {
      // Ignore
    }
    setHydrated(true);
  }, []);

  // Fetch FX rates
  useEffect(() => {
    fetchFxRates().then((r) => {
      if (r) setCachedRates(r);
    });
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem("preferred_currency", c);
    } catch {
      // Ignore
    }
  }, []);

  const cycleCurrency = useCallback(() => {
    setCurrency(
      currency === "AUD" ? "USD" : currency === "USD" ? "THB" : "AUD"
    );
  }, [currency, setCurrency]);

  const convert = useCallback(
    (amount: number, from: Currency, to?: Currency) => {
      return convertCurrency(amount, from, to ?? currency, cachedRates?.rates ?? null);
    },
    [currency, cachedRates]
  );

  const format = useCallback(
    (amount: number, from?: Currency, compact?: boolean) => {
      const converted = from ? convert(amount, from) : amount;
      return formatCurrency(converted, currency, compact);
    },
    [convert, currency]
  );

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        cycleCurrency,
        rates: cachedRates?.rates ?? null,
        ratesLoaded: cachedRates !== null,
        ratesFetchedAt: cachedRates?.fetchedAt ?? null,
        convert,
        format,
        symbol: CURRENCY_SYMBOLS[currency],
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return context;
}
