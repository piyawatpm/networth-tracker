import type { IncomeType, ExpenseType, HoldingType, Currency, PaymentMethod, RecurringFrequency } from "./types";

export const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  salary: "Salary",
  super_employer: "Super (Employer)",
  super_personal: "Super (Personal)",
  arena_bot: "Arena Bot",
  arb_bot: "Arb Bot",
  uber: "Uber",
  freelance: "Freelance",
  dividend: "Dividend",
  crypto_yield: "Crypto Yield",
  interest: "Interest",
  rental: "Rental",
  bonus: "Bonus",
  other: "Other",
};

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  food: "Food",
  transport: "Transport",
  rent: "Rent",
  utilities: "Utilities",
  entertainment: "Entertainment",
  shopping: "Shopping",
  health: "Health",
  insurance: "Insurance",
  subscriptions: "Subscriptions",
  education: "Education",
  travel: "Travel",
  gifts: "Gifts",
  other: "Other",
};

export const HOLDING_TYPE_LABELS: Record<HoldingType, string> = {
  stock: "Stock",
  etf: "ETF",
  fund: "Fund",
  bond: "Bond",
  savings: "Savings / Emergency",
  other: "Other",
};

// This is now just the fallback. Actual list comes from localStorage "enabled_currencies"
export const CURRENCIES: string[] = ["AUD", "USD", "THB"];

export const STABLECOINS = new Set([
  "USDC",
  "USDT",
  "USD1",
  "BUSD",
  "DAI",
  "TUSD",
  "FDUSD",
  "PYUSD",
]);

// Yield-bearing token prefixes — NOT stablecoins even if they contain "usdc"/"usdt"
export const YIELD_PREFIXES = ["syrup", "aave", "compound", "venus", "morpho"];

// Known exchange keywords for auto-parsing from CSV notes
export const KNOWN_EXCHANGES: Record<string, string> = {
  okx: "OKX",
  bybit: "Bybit",
  binance: "Binance",
  coinbase: "Coinbase",
  kraken: "Kraken",
  rollbit: "Rollbit",
  maple: "Maple",
  kucoin: "KuCoin",
  gateio: "Gate.io",
  bitget: "Bitget",
  mexc: "MEXC",
};

// Map token symbols to CoinGecko IDs
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  OKB: "okb",
  HYPE: "hyperliquid",
  ONDO: "ondo-finance",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  UNI: "uniswap",
  ATOM: "cosmos",
  ARB: "arbitrum",
  OP: "optimism",
  APT: "aptos",
  SUI: "sui",
  SEI: "sei-network",
  TIA: "celestia",
  NEAR: "near",
  FTM: "fantom",
  INJ: "injective-protocol",
  RENDER: "render-token",
  FET: "fetch-ai",
  syrupUSDC: "syrup-usdc",
};

// Chart color palette — hex values (canvas-compatible, NOT oklch)
export const CHART_COLORS = [
  "#b8860b",  // amber
  "#2e8b57",  // sage
  "#cd5c5c",  // coral
  "#8b5e3c",  // sienna
  "#6b8e23",  // olive
  "#708090",  // steel
  "#9e5e8e",  // mauve
  "#c4a35a",  // sand
  "#2e7d5b",  // forest
  "#c05040",  // rust
  "#5f6b80",  // slate
  "#c4943a",  // gold
  "#2e7d7b",  // teal
];

export const INCOME_TYPE_COLORS: Record<IncomeType, string> = {
  salary: CHART_COLORS[0],
  super_employer: CHART_COLORS[1],
  super_personal: CHART_COLORS[2],
  arena_bot: CHART_COLORS[3],
  arb_bot: CHART_COLORS[4],
  uber: CHART_COLORS[5],
  freelance: CHART_COLORS[6],
  dividend: CHART_COLORS[7],
  crypto_yield: CHART_COLORS[8],
  interest: CHART_COLORS[9],
  rental: CHART_COLORS[10],
  bonus: CHART_COLORS[11],
  other: CHART_COLORS[12],
};

export const EXPENSE_TYPE_COLORS: Record<ExpenseType, string> = {
  food: CHART_COLORS[0],
  transport: CHART_COLORS[1],
  rent: CHART_COLORS[2],
  utilities: CHART_COLORS[3],
  entertainment: CHART_COLORS[4],
  shopping: CHART_COLORS[5],
  health: CHART_COLORS[6],
  insurance: CHART_COLORS[7],
  subscriptions: CHART_COLORS[8],
  education: CHART_COLORS[9],
  travel: CHART_COLORS[10],
  gifts: CHART_COLORS[11],
  other: CHART_COLORS[12],
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  debit_card: "Debit Card",
  credit_card: "Credit Card",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

export const PAYMENT_METHOD_COLORS: Record<PaymentMethod, string> = {
  cash: "#2e8b57",
  debit_card: "#4d7cc7",
  credit_card: "#c9503f",
  bank_transfer: "#d4a033",
  other: "#708090",
};

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export type FinancialWorld = "normal" | "crypto" | "super";

export const INCOME_WORLD_MAP: Record<string, FinancialWorld> = {
  salary: "normal",
  super_employer: "super",
  super_personal: "super",
  arena_bot: "crypto",
  arb_bot: "crypto",
  uber: "normal",
  freelance: "normal",
  dividend: "normal",
  crypto_yield: "crypto",
  interest: "normal",
  rental: "normal",
  bonus: "normal",
  other: "normal",
};

export const WORLD_LABELS: Record<FinancialWorld, string> = {
  normal: "Traditional",
  crypto: "Crypto",
  super: "Super",
};

export const WORLD_COLORS: Record<FinancialWorld, string> = {
  normal: "#b8860b",
  crypto: "#2e8b57",
  super: "#4d7cc7",
};
