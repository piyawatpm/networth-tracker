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
import { fetchFxRates, convertCurrency, formatCurrency } from "@/lib/utils/fx";

const ENABLED_KEY = "enabled_currencies";

function getEnabledCurrencies(): string[] {
  try {
    const saved = localStorage.getItem(ENABLED_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_CURRENCIES;
}

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
  const [currency, setCurrencyState] = useState<string>("AUD");
  const [enabledCurrencies, setEnabledState] = useState<string[]>(DEFAULT_CURRENCIES);
  const [cachedRates, setCachedRates] = useState<CachedRates | null>(null);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("preferred_currency");
      const enabled = getEnabledCurrencies();
      setEnabledState(enabled);
      if (saved && enabled.includes(saved)) {
        setCurrencyState(saved);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Fetch FX rates
  useEffect(() => {
    fetchFxRates().then((r) => {
      if (r) setCachedRates(r);
    });
  }, []);

  const setCurrency = useCallback((c: string) => {
    setCurrencyState(c);
    try {
      localStorage.setItem("preferred_currency", c);
    } catch {
      // Ignore
    }
  }, []);

  const setEnabledCurrencies = useCallback((currencies: string[]) => {
    setEnabledState(currencies);
    try {
      localStorage.setItem(ENABLED_KEY, JSON.stringify(currencies));
    } catch {
      // Ignore
    }
    // If current currency is no longer enabled, switch to first enabled
    if (!currencies.includes(currency)) {
      setCurrency(currencies[0] ?? "USD");
    }
  }, [currency, setCurrency]);

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
