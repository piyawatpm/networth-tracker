import type { IncomeEntry, ExpenseEntry } from "./types";
import { INCOME_TYPE_LABELS, EXPENSE_TYPE_LABELS } from "./constants";
import { getCurrencySymbol } from "./types";

interface BudgetExportData {
  month: string; // "Jan 2026"
  incomeEntries: IncomeEntry[];
  expenseEntries: ExpenseEntry[];
  creditCardEntries: ExpenseEntry[];
  currencies: string[]; // e.g. ["THB", "GBP"]
  convert: (amount: number, from: string, to: string) => number;
}

export async function exportBudgetToXls(data: BudgetExportData) {
  const {
    month,
    incomeEntries,
    expenseEntries,
    creditCardEntries,
    currencies,
    convert,
  } = data;

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // Build the worksheet data as array of arrays
  const rows: (string | number | null)[][] = [];

  // --- Row 1: Title ---
  const currHeaders = currencies.flatMap((c) => [c, ""]);
  rows.push([
    `Monthly Budget Tracker ${month}`,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ...currencies,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ...currencies,
  ]);

  // --- Row 2: Section headers ---
  const incomeTotal = incomeEntries.reduce((s, e) => s + e.amount, 0);
  const expenseTotal = expenseEntries.reduce((s, e) => s + e.amount, 0);
  const ccTotal = creditCardEntries.reduce((s, e) => s + e.amount, 0);

  rows.push([
    "Income",
    "",
    "",
    "",
    "Expenses",
    "",
    "",
    "",
    "",
    "Total Income",
    ...currencies.map((c) =>
      incomeEntries.reduce((s, e) => s + convert(e.amount, e.currency, c), 0),
    ),
    "",
    "",
    "Credit Card Expenses",
    "",
    "",
    "",
    "",
    "Total CC",
    ...currencies.map((c) =>
      creditCardEntries.reduce((s, e) => s + convert(e.amount, e.currency, c), 0),
    ),
  ]);

  // --- Row 3: Totals ---
  rows.push([
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Total Expense",
    ...currencies.map((c) =>
      expenseEntries.reduce((s, e) => s + convert(e.amount, e.currency, c), 0),
    ),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Total CC Expense",
    ...currencies.map((c) =>
      creditCardEntries.reduce((s, e) => s + convert(e.amount, e.currency, c), 0),
    ),
  ]);

  // --- Row 4: Net ---
  rows.push([
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Net",
    ...currencies.map((c) => {
      const inc = incomeEntries.reduce(
        (s, e) => s + convert(e.amount, e.currency, c),
        0,
      );
      const exp = expenseEntries.reduce(
        (s, e) => s + convert(e.amount, e.currency, c),
        0,
      );
      return inc - exp;
    }),
  ]);

  // --- Blank row ---
  rows.push([]);

  // --- Income entries ---
  rows.push(["Date", "Type", "Description", "Amount", "Currency"]);
  for (const e of incomeEntries) {
    rows.push([
      e.date,
      (INCOME_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type,
      e.description,
      e.amount,
      e.currency,
    ]);
  }

  // --- Blank row ---
  rows.push([]);

  // --- Expense entries ---
  rows.push([
    "",
    "",
    "",
    "",
    "Date",
    "Type",
    "Description",
    "Vendor",
    "Amount",
    "Currency",
    "Payment Method",
  ]);
  for (const e of expenseEntries) {
    rows.push([
      "",
      "",
      "",
      "",
      e.date,
      (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type,
      e.description,
      e.vendor,
      e.amount,
      e.currency,
      e.paymentMethod ?? "other",
    ]);
  }

  // --- Blank row ---
  rows.push([]);

  // --- Expenses Category Summary ---
  rows.push(["", "", "", "", "", "", "", "", "Expenses Category"]);
  const categoryTotals: Record<string, number> = {};
  for (const e of [...expenseEntries, ...creditCardEntries]) {
    const label =
      (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type;
    categoryTotals[label] = (categoryTotals[label] ?? 0) + e.amount;
  }
  for (const [cat, total] of Object.entries(categoryTotals).sort(
    (a, b) => b[1] - a[1],
  )) {
    rows.push(["", "", "", "", "", "", "", "", cat, total]);
  }

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths
  ws["!cols"] = [
    { wch: 12 }, // Date
    { wch: 14 }, // Type
    { wch: 20 }, // Description
    { wch: 10 }, // Amount
    { wch: 12 }, // Date (expenses)
    { wch: 14 }, // Type
    { wch: 20 }, // Description
    { wch: 14 }, // Vendor
    { wch: 12 }, // Amount
    { wch: 14 }, // Label/Currency
    { wch: 12 }, // Currency col 1
    { wch: 12 }, // Currency col 2
  ];

  XLSX.utils.book_append_sheet(wb, ws, month);

  // Download
  XLSX.writeFile(wb, `budget-${month.replace(/\s+/g, "-").toLowerCase()}.xlsx`);
}
