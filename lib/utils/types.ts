export type Currency = string;

// All supported currencies with symbols
export const ALL_CURRENCIES: Record<string, string> = {
  AUD: "A$",
  USD: "$",
  THB: "฿",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  KRW: "₩",
  SGD: "S$",
  HKD: "HK$",
  CAD: "C$",
  NZD: "NZ$",
  CHF: "CHF",
  SEK: "kr",
  INR: "₹",
  MYR: "RM",
  IDR: "Rp",
  PHP: "₱",
  TWD: "NT$",
  BRL: "R$",
  ZAR: "R",
  AED: "د.إ",
};

// Default enabled currencies
export const DEFAULT_CURRENCIES = ["AUD", "USD", "THB"];

// Get symbol for any currency (fallback to code)
export function getCurrencySymbol(code: string): string {
  return ALL_CURRENCIES[code] ?? code;
}

// Legacy compat — maps to ALL_CURRENCIES for existing code
export const CURRENCY_SYMBOLS = ALL_CURRENCIES;

export type IncomeType =
  | "salary"
  | "super_employer"
  | "super_personal"
  | "arena_bot"
  | "arb_bot"
  | "uber"
  | "freelance"
  | "dividend"
  | "crypto_yield"
  | "interest"
  | "rental"
  | "bonus"
  | "other";

export type ExpenseType =
  | "food"
  | "transport"
  | "rent"
  | "utilities"
  | "entertainment"
  | "shopping"
  | "health"
  | "insurance"
  | "subscriptions"
  | "education"
  | "travel"
  | "gifts"
  | "other";

export type PaymentMethod = "cash" | "debit_card" | "credit_card" | "bank_transfer" | "other";

export type RecurringFrequency = "weekly" | "fortnightly" | "monthly" | "yearly";

export type HoldingType = "stock" | "etf" | "fund" | "bond" | "other";
export type AccountType = "normal" | "super";
export type DebtDirection = "i_owe" | "owed_to_me";

export interface IncomeEntry {
  id: string;
  type: string; // IncomeType or custom category id
  description: string;
  amount: number;
  currency: Currency;
  date: string;
  source: string;
  notes: string;
  isRecurring?: boolean;
  recurringId?: string;
  createdAt: number;
}

export interface CustomIncomeCategory {
  id: string;
  label: string;
  color: string;
}

export interface RecurringIncome {
  id: string;
  type: string; // IncomeType or custom category id
  description: string;
  amount: number;
  currency: Currency;
  source: string;
  notes: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate?: string;
  lastGeneratedDate?: string;
  active: boolean;
  createdAt: number;
}

export interface CustomExpenseCategory {
  id: string;        // kebab-case key, e.g. "pet-care"
  label: string;     // display name, e.g. "Pet Care"
  color: string;     // hex color
}

export interface ExpenseEntry {
  id: string;
  type: string;      // ExpenseType or custom category id
  description: string;
  amount: number;
  currency: Currency;
  vendor: string;
  date: string; // YYYY-MM-DD
  notes: string;
  images: string[]; // base64 data URLs
  createdAt: number;
  paymentMethod: PaymentMethod;
  isRecurring?: boolean;
  recurringId?: string;
}

export interface RecurringExpense {
  id: string;
  type: string;      // ExpenseType or custom category id
  description: string;
  amount: number;
  currency: Currency;
  vendor: string;
  paymentMethod: PaymentMethod;
  notes: string;
  frequency: RecurringFrequency;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  lastGeneratedDate?: string; // YYYY-MM-DD
  active: boolean;
  createdAt: number;
}

export interface PortfolioHolding {
  id: string;
  name: string;
  ticker: string;
  type: HoldingType;
  accountType: AccountType;
  broker: string;
  country: string;
  link: string;
  units: number;
  amountInvested: number;
  currentValue: number;
  currency: Currency;
  notes: string;
  createdAt: number;
}

export interface PortfolioTransaction {
  id: string;
  holdingId: string;
  holdingName: string;
  type: "buy" | "sell";
  units: number;
  pricePerUnit: number;
  totalAmount: number;
  currency: Currency;
  date: string; // YYYY-MM-DD
  notes: string;
  createdAt: number;
}

export interface DebtRecord {
  id: string;
  person: string;
  direction: DebtDirection;
  reason: string;
  originalAmount: number;
  currency: Currency;
  notes: string;
  images: string[];
  createdAt: number;
}

export interface DebtTransaction {
  id: string;
  debtId: string;
  amount: number; // positive = reduce debt, negative = add more
  date: string; // YYYY-MM-DD
  notes: string;
  images: string[];
  createdAt: number;
}

export interface CryptoHolding {
  token: string;
  amount: number;
  totalCostUsd: number;
  currentValueUsd: number;
  exchange?: string;  // auto-parsed from CSV notes or manually set
}

export interface CryptoTransaction {
  date: string;
  token: string;
  type: "buy" | "sell" | "transferIn" | "transferOut";
  priceUsd: number | null;
  amount: number;
  totalValueUsd: number | null;
  fee: number | null;
  feeCurrency: string;
  notes: string;
}

export interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: number; // unix timestamp ms
}

/** Normalize old IncomeEntry records that lack new fields */
export function normalizeIncomeEntry(e: Record<string, unknown>): IncomeEntry {
  return {
    id: e.id as string,
    type: (e.type as IncomeType) ?? "other",
    description: (e.description as string) ?? "",
    amount: (e.amount as number) ?? 0,
    currency: (e.currency as Currency) ?? "AUD",
    date: (e.date as string) ?? "",
    source: (e.source as string) ?? "",
    notes: (e.notes as string) ?? "",
    isRecurring: (e.isRecurring as boolean) ?? false,
    recurringId: e.recurringId as string | undefined,
    createdAt: (e.createdAt as number) ?? Date.now(),
  };
}

/** Normalize old ExpenseEntry records that lack new fields */
export function normalizeExpenseEntry(e: Record<string, unknown>): ExpenseEntry {
  return {
    id: e.id as string,
    type: (e.type as string) ?? "other",
    description: (e.description as string) ?? "",
    amount: (e.amount as number) ?? 0,
    currency: (e.currency as Currency) ?? "AUD",
    vendor: (e.vendor as string) ?? "",
    date: (e.date as string) ?? "",
    notes: (e.notes as string) ?? "",
    images: (e.images as string[]) ?? [],
    createdAt: (e.createdAt as number) ?? Date.now(),
    paymentMethod: (e.paymentMethod as PaymentMethod) ?? "other",
    isRecurring: (e.isRecurring as boolean) ?? false,
    recurringId: e.recurringId as string | undefined,
  };
}
