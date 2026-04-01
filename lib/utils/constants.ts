import type { IncomeType, ExpenseType, HoldingType, Currency } from "./types";

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
  other: "Other",
};

export const CURRENCIES: Currency[] = ["AUD", "USD", "THB"];

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

// Chart color palette — warm, desaturated tones
export const CHART_COLORS = [
  "oklch(0.58 0.09 65)",   // amber
  "oklch(0.55 0.16 155)",  // sage
  "oklch(0.58 0.16 25)",   // coral
  "oklch(0.52 0.08 35)",   // sienna
  "oklch(0.52 0.10 110)",  // olive
  "oklch(0.60 0.06 200)",  // steel
  "oklch(0.55 0.12 340)",  // mauve
  "oklch(0.62 0.08 90)",   // sand
  "oklch(0.48 0.10 145)",  // forest
  "oklch(0.58 0.12 10)",   // rust
  "oklch(0.50 0.06 260)",  // slate
  "oklch(0.62 0.10 50)",   // gold
  "oklch(0.45 0.08 180)",  // teal
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
