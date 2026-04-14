"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { CachedRates } from "@/lib/utils/types";
import { getCurrencySymbol, DEFAULT_CURRENCIES } from "@/lib/utils/types";
import { fetchFxRates, readFxRatesSync, convertCurrency, formatCurrency } from "@/lib/utils/fx";
import { useCloudStorage } from "./data-provider";

interface CurrencyContextValue {
  currency: string;
  setCurrency: (c: string) => void;
  cycleCurrency: () => void;
  enabledCurrencies: string[];
  setEnabledCurrencies: (currencies: string[]) => void;
  rates: Record<string, number> | null;
  ratesLoaded: boolean;
  ratesFetchedAt: number | null;
  convert: (amount: number, from: string, to?: string) => number;
  format: (amount: number, from?: string, compact?: boolean) => string;
  symbol: string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyCloud] = useCloudStorage<string>("preferred_currency", "AUD");
  const [enabledCurrencies, setEnabledCurrenciesCloud] = useCloudStorage<string[]>("enabled_currencies", DEFAULT_CURRENCIES);
  // Seed synchronously from localStorage so the first render already has
  // rates — prevents `convert` from returning raw amounts before the async
  // fetch resolves (which was causing net-worth to jump on page load).
  const [cachedRates, setCachedRates] = useState<CachedRates | null>(() =>
    readFxRatesSync(),
  );

  // Refresh FX rates in the background
  useEffect(() => {
    fetchFxRates().then((r) => {
      if (r) setCachedRates(r);
    });
  }, []);

  const setCurrency = useCallback((c: string) => {
    setCurrencyCloud(c);
  }, [setCurrencyCloud]);

  const setEnabledCurrencies = useCallback((currencies: string[]) => {
    setEnabledCurrenciesCloud(currencies);
    // If current currency is no longer enabled, switch to first enabled
    if (!currencies.includes(currency)) {
      setCurrency(currencies[0] ?? "USD");
    }
  }, [currency, setCurrency, setEnabledCurrenciesCloud]);

  const cycleCurrency = useCallback(() => {
    const idx = enabledCurrencies.indexOf(currency);
    const next = enabledCurrencies[(idx + 1) % enabledCurrencies.length];
    setCurrency(next);
  }, [currency, enabledCurrencies, setCurrency]);

  const convert = useCallback(
    (amount: number, from: string, to?: string) => {
      return convertCurrency(amount, from, to ?? currency, cachedRates?.rates ?? null);
    },
    [currency, cachedRates]
  );

  const format = useCallback(
    (amount: number, from?: string, compact?: boolean) => {
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
        enabledCurrencies,
        setEnabledCurrencies,
        rates: cachedRates?.rates ?? null,
        ratesLoaded: cachedRates !== null,
        ratesFetchedAt: cachedRates?.fetchedAt ?? null,
        convert,
        format,
        symbol: getCurrencySymbol(currency),
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
