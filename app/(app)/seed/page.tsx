"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  IncomeEntry,
  ExpenseEntry,
  PortfolioHolding,
  DebtRecord,
  DebtTransaction,
} from "@/lib/utils/types";

// ---------------------------------------------------------------------------
// Sample Data Generator
// ---------------------------------------------------------------------------

function id() {
  return crypto.randomUUID();
}

function generateSampleData() {
  const now = Date.now();

  // ---- INCOME (4 months: Jan-Apr 2026) ------------------------------------
  const incomeEntries: IncomeEntry[] = [
    // January
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-01-09", notes: "", source: "", createdAt: now },
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-01-23", notes: "", source: "", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super contribution", amount: 540, currency: "AUD", date: "2026-01-23", notes: "12% of salary", source: "", createdAt: now },
    { id: id(), type: "uber", description: "Uber driving income", amount: 380, currency: "AUD", date: "2026-01-31", notes: "Weekend driving", source: "", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena trading bot profit", amount: 145, currency: "USD", date: "2026-01-28", notes: "", source: "", createdAt: now },
    { id: id(), type: "arb_bot", description: "Arb bot profit", amount: 67, currency: "USD", date: "2026-01-30", notes: "", source: "", createdAt: now },

    // February
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-02-06", notes: "", source: "", createdAt: now },
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-02-20", notes: "", source: "", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super contribution", amount: 540, currency: "AUD", date: "2026-02-20", notes: "", source: "", createdAt: now },
    { id: id(), type: "uber", description: "Uber driving income", amount: 520, currency: "AUD", date: "2026-02-28", notes: "Busy month", source: "", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena trading bot profit", amount: 210, currency: "USD", date: "2026-02-25", notes: "", source: "", createdAt: now },
    { id: id(), type: "freelance", description: "Website for friend's cafe", amount: 800, currency: "AUD", date: "2026-02-15", notes: "One-time project", source: "", createdAt: now },
    { id: id(), type: "crypto_yield", description: "syrupUSDC yield", amount: 42, currency: "USD", date: "2026-02-28", notes: "", source: "", createdAt: now },

    // March
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-03-06", notes: "", source: "", createdAt: now },
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-03-20", notes: "", source: "", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super contribution", amount: 540, currency: "AUD", date: "2026-03-20", notes: "", source: "", createdAt: now },
    { id: id(), type: "super_personal", description: "Personal super contribution", amount: 200, currency: "AUD", date: "2026-03-20", notes: "Voluntary", source: "", createdAt: now },
    { id: id(), type: "uber", description: "Uber driving income", amount: 290, currency: "AUD", date: "2026-03-31", notes: "", source: "", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena trading bot profit", amount: 178, currency: "USD", date: "2026-03-28", notes: "", source: "", createdAt: now },
    { id: id(), type: "arb_bot", description: "Arb bot profit", amount: 89, currency: "USD", date: "2026-03-30", notes: "", source: "", createdAt: now },
    { id: id(), type: "dividend", description: "VAS dividend", amount: 125, currency: "AUD", date: "2026-03-15", notes: "Quarterly", source: "", createdAt: now },
    { id: id(), type: "interest", description: "HISA interest", amount: 48, currency: "AUD", date: "2026-03-31", notes: "ING savings", source: "", createdAt: now },

    // April
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-04-01", notes: "", source: "", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super contribution", amount: 540, currency: "AUD", date: "2026-04-01", notes: "", source: "", createdAt: now },
    { id: id(), type: "uber", description: "Uber driving - Easter weekend", amount: 650, currency: "AUD", date: "2026-04-01", notes: "Surge pricing", source: "", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena trading bot profit", amount: 92, currency: "USD", date: "2026-04-01", notes: "", source: "", createdAt: now },
  ];

  // ---- EXPENSES (4 months) ------------------------------------------------
  const expenseEntries: ExpenseEntry[] = [
    // January
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2026-01-01", notes: "Surry Hills apartment", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Woolworths groceries", amount: 145, currency: "AUD", vendor: "Woolworths", date: "2026-01-05", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Weekly groceries", amount: 132, currency: "AUD", vendor: "Coles", date: "2026-01-12", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Dinner with friends", amount: 85, currency: "AUD", vendor: "Thai Pothong", date: "2026-01-18", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "transport", description: "Opal card top-up", amount: 50, currency: "AUD", vendor: "Opal", date: "2026-01-10", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify Premium", amount: 12.99, currency: "AUD", vendor: "Spotify", date: "2026-01-15", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "subscriptions", description: "Netflix", amount: 22.99, currency: "AUD", vendor: "Netflix", date: "2026-01-15", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "utilities", description: "Electricity bill", amount: 180, currency: "AUD", vendor: "AGL", date: "2026-01-20", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "health", description: "Gym membership", amount: 69, currency: "AUD", vendor: "Fitness First", date: "2026-01-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "insurance", description: "Health insurance", amount: 145, currency: "AUD", vendor: "Medibank", date: "2026-01-28", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "entertainment", description: "Movie tickets", amount: 38, currency: "AUD", vendor: "Event Cinemas", date: "2026-01-25", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },

    // February
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2026-02-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 158, currency: "AUD", vendor: "Woolworths", date: "2026-02-03", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 121, currency: "AUD", vendor: "Aldi", date: "2026-02-10", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Coffee beans", amount: 42, currency: "AUD", vendor: "Single O", date: "2026-02-14", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Valentine's dinner", amount: 195, currency: "AUD", vendor: "Quay Restaurant", date: "2026-02-14", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "transport", description: "Opal card", amount: 50, currency: "AUD", vendor: "Opal", date: "2026-02-08", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "transport", description: "Car rego", amount: 380, currency: "AUD", vendor: "Service NSW", date: "2026-02-15", notes: "Annual", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify + Netflix", amount: 35.98, currency: "AUD", vendor: "Various", date: "2026-02-15", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "health", description: "Gym", amount: 69, currency: "AUD", vendor: "Fitness First", date: "2026-02-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "shopping", description: "New running shoes", amount: 189, currency: "AUD", vendor: "Nike", date: "2026-02-20", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "education", description: "Udemy courses", amount: 29.99, currency: "USD", vendor: "Udemy", date: "2026-02-22", notes: "React & TypeScript", images: [], paymentMethod: "debit_card" as const, createdAt: now },

    // March
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2026-03-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 167, currency: "AUD", vendor: "Woolworths", date: "2026-03-02", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 98, currency: "AUD", vendor: "Aldi", date: "2026-03-09", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 143, currency: "AUD", vendor: "Coles", date: "2026-03-16", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 112, currency: "AUD", vendor: "Woolworths", date: "2026-03-23", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Brunch with mates", amount: 65, currency: "AUD", vendor: "Bills Surry Hills", date: "2026-03-15", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "transport", description: "Opal card", amount: 50, currency: "AUD", vendor: "Opal", date: "2026-03-05", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "transport", description: "Petrol", amount: 95, currency: "AUD", vendor: "7-Eleven", date: "2026-03-18", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify + Netflix", amount: 35.98, currency: "AUD", vendor: "Various", date: "2026-03-15", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "utilities", description: "Internet", amount: 79, currency: "AUD", vendor: "Aussie Broadband", date: "2026-03-10", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "health", description: "Gym", amount: 69, currency: "AUD", vendor: "Fitness First", date: "2026-03-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "health", description: "Dentist checkup", amount: 220, currency: "AUD", vendor: "Sydney Dental", date: "2026-03-22", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "insurance", description: "Health insurance", amount: 145, currency: "AUD", vendor: "Medibank", date: "2026-03-28", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "travel", description: "Weekend trip Blue Mountains", amount: 350, currency: "AUD", vendor: "Airbnb", date: "2026-03-28", notes: "2 nights", images: [], paymentMethod: "debit_card" as const, createdAt: now },

    // April
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2026-04-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 135, currency: "AUD", vendor: "Woolworths", date: "2026-04-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "transport", description: "Opal card", amount: 50, currency: "AUD", vendor: "Opal", date: "2026-04-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
    { id: id(), type: "subscriptions", description: "ChatGPT Plus", amount: 20, currency: "USD", vendor: "OpenAI", date: "2026-04-01", notes: "", images: [], paymentMethod: "debit_card" as const, createdAt: now },
  ];

  // ---- PORTFOLIO ----------------------------------------------------------
  const portfolioHoldings: PortfolioHolding[] = [
    { id: id(), name: "Vanguard Australian Shares Index ETF", ticker: "VAS", type: "etf", accountType: "normal", broker: "CommSec", country: "AU", link: "https://www.vanguard.com.au/personal/products/en/detail/8205/overview", units: 52, amountInvested: 4680, currentValue: 5148, currency: "AUD", notes: "", createdAt: now },
    { id: id(), name: "Vanguard Diversified High Growth Index ETF", ticker: "VDHG", type: "etf", accountType: "normal", broker: "CommSec", country: "AU", link: "", units: 35, amountInvested: 2275, currentValue: 2485, currency: "AUD", notes: "Long term hold", createdAt: now },
    { id: id(), name: "BetaShares NASDAQ 100 ETF", ticker: "NDQ", type: "etf", accountType: "normal", broker: "CommSec", country: "AU", link: "", units: 18, amountInvested: 612, currentValue: 684, currency: "AUD", notes: "", createdAt: now },
    { id: id(), name: "Apple Inc", ticker: "AAPL", type: "stock", accountType: "normal", broker: "Interactive Brokers", country: "US", link: "", units: 5, amountInvested: 875, currentValue: 1125, currency: "USD", notes: "", createdAt: now },
    { id: id(), name: "Tesla Inc", ticker: "TSLA", type: "stock", accountType: "normal", broker: "Interactive Brokers", country: "US", link: "", units: 3, amountInvested: 780, currentValue: 690, currency: "USD", notes: "", createdAt: now },
    { id: id(), name: "AustralianSuper High Growth", ticker: "SUPER", type: "fund", accountType: "super", broker: "AustralianSuper", country: "AU", link: "https://www.australiansuper.com", units: 1, amountInvested: 45000, currentValue: 52800, currency: "AUD", notes: "Employer super fund", createdAt: now },
    { id: id(), name: "IFM Australian Infrastructure Fund", ticker: "IFM-INFRA", type: "fund", accountType: "super", broker: "AustralianSuper", country: "AU", link: "", units: 1, amountInvested: 8000, currentValue: 9200, currency: "AUD", notes: "Within super allocation", createdAt: now },
    { id: id(), name: "Australian Government Bond", ticker: "GOVT", type: "bond", accountType: "normal", broker: "CommSec", country: "AU", link: "", units: 10, amountInvested: 1000, currentValue: 1015, currency: "AUD", notes: "Low risk allocation", createdAt: now },
  ];

  // ---- CRYPTO CSV ---------------------------------------------------------
  const cryptoCsvText = `Date (UTC+11:00),Token,Type,Price (USD),Amount,Total value (USD),Fee,Fee Currency,Notes
"2026-04-01 09:35:00","syrupUSDC","buy","1.1578","1,012.39","1,172.15","--","",""
"2026-04-01 09:35:00","USDC","transferOut","--","1,172.16","--","--","",""
"2026-04-01 09:30:00","USDC","transferIn","--","999.38","--","--","",""
"2026-04-01 09:30:00","USDT","transferOut","--","1,000.02","--","--","",""
"2026-03-30 13:45:00","USDC","buy","1.0000","172.78","172.78","--","",""
"2026-03-30 11:45:00","USDC","buy","1.0000","200.22","200.22","--","",""
"2026-03-30 11:00:00","SOL","buy","82.47","1.2164","100.32","--","","okx"
"2026-03-30 11:00:00","ETH","buy","2,056.56","0.2499","514.06","--","","okx"
"2026-03-30 11:00:00","USDC","buy","1.0000","500.68","500.68","--","","okx"
"2026-03-30 11:00:00","OKB","buy","83.26","6.1405","511.25","--","",""
"2026-03-30 11:00:00","USDT","buy","1.0000","589.06","589.06","--","","okx"
"2026-03-30 11:00:00","BTC","buy","67,994.72","0.01155","785.42","--","",""
"2026-03-30 11:00:00","USD1","buy","1.0000","941.69","941.69","--","","rollbit bot1"
"2026-03-30 11:00:00","USDT","buy","1.0000","201.00","201.00","--","","bybit"
"2026-03-30 11:00:00","USDT","buy","1.0000","1,000.23","1,000.23","--","",""
"2026-03-30 11:00:00","syrupUSDC","buy","1.1572","3,888.86","4,500.00","--","",""
"2026-03-27 11:00:00","SOL","buy","86.06","5.8099","500.00","--","","okx"`;

  // ---- DEBTS --------------------------------------------------------------
  const debtCarLoan = id();
  const debtFriendJake = id();
  const debtSisterLoan = id();

  const debtRecords: DebtRecord[] = [
    { id: debtCarLoan, person: "Toyota Finance", direction: "i_owe", reason: "Car loan - Corolla 2024", originalAmount: 15000, currency: "AUD", notes: "Monthly repayments $450", images: [], createdAt: now },
    { id: debtFriendJake, person: "Jake", direction: "owed_to_me", reason: "Lent for concert tickets", originalAmount: 350, currency: "AUD", notes: "Coldplay concert Mar 2026", images: [], createdAt: now },
    { id: debtSisterLoan, person: "Sister (Ploy)", direction: "owed_to_me", reason: "Helped with uni textbooks", originalAmount: 500, currency: "AUD", notes: "", images: [], createdAt: now },
  ];

  const debtTransactions: DebtTransaction[] = [
    // Car loan payments
    { id: id(), debtId: debtCarLoan, amount: 450, date: "2026-01-15", notes: "Monthly repayment", images: [], createdAt: now },
    { id: id(), debtId: debtCarLoan, amount: 450, date: "2026-02-15", notes: "Monthly repayment", images: [], createdAt: now },
    { id: id(), debtId: debtCarLoan, amount: 450, date: "2026-03-15", notes: "Monthly repayment", images: [], createdAt: now },
    // Jake partial repayment
    { id: id(), debtId: debtFriendJake, amount: 200, date: "2026-03-20", notes: "Bank transfer", images: [], createdAt: now },
    // Sister
    { id: id(), debtId: debtSisterLoan, amount: 100, date: "2026-02-10", notes: "Cash", images: [], createdAt: now },
    { id: id(), debtId: debtSisterLoan, amount: 100, date: "2026-03-10", notes: "Cash", images: [], createdAt: now },
  ];

  // ---- NET WORTH SNAPSHOTS (for trend chart) ------------------------------
  const networthSnapshots = [
    { date: "2026-01-01", value: 55000 },
    { date: "2026-01-15", value: 56200 },
    { date: "2026-02-01", value: 57800 },
    { date: "2026-02-15", value: 58100 },
    { date: "2026-03-01", value: 59500 },
    { date: "2026-03-15", value: 60200 },
    { date: "2026-03-22", value: 60800 },
    { date: "2026-03-28", value: 61400 },
    { date: "2026-04-01", value: 62100 },
  ];

  // ---- PORTFOLIO SNAPSHOTS ------------------------------------------------
  const portfolioSnapshots = [
    { date: "2026-01-01", value: 8500, valueWithSuper: 58500 },
    { date: "2026-01-15", value: 8700, valueWithSuper: 59200 },
    { date: "2026-02-01", value: 9100, valueWithSuper: 60100 },
    { date: "2026-02-15", value: 9000, valueWithSuper: 59800 },
    { date: "2026-03-01", value: 9400, valueWithSuper: 61400 },
    { date: "2026-03-15", value: 9600, valueWithSuper: 61800 },
    { date: "2026-03-22", value: 9800, valueWithSuper: 62200 },
    { date: "2026-03-28", value: 10000, valueWithSuper: 62800 },
    { date: "2026-04-01", value: 10100, valueWithSuper: 63100 },
  ];

  // ---- NET WORTH GOAL -----------------------------------------------------
  const networthGoal = {
    amount: 100000,
    currency: "AUD" as const,
    setAt: now,
  };

  return {
    incomeEntries,
    expenseEntries,
    portfolioHoldings,
    cryptoCsvText,
    debtRecords,
    debtTransactions,
    networthSnapshots,
    portfolioSnapshots,
    networthGoal,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SeedPage() {
  const [status, setStatus] = useState<string | null>(null);

  function handleSeed() {
    const data = generateSampleData();

    localStorage.setItem("income_entries", JSON.stringify(data.incomeEntries));
    localStorage.setItem("expense_entries", JSON.stringify(data.expenseEntries));
    localStorage.setItem("portfolio_holdings", JSON.stringify(data.portfolioHoldings));
    localStorage.setItem("crypto_csv_text", JSON.stringify(data.cryptoCsvText));
    localStorage.setItem("debt_records", JSON.stringify(data.debtRecords));
    localStorage.setItem("networth_goal", JSON.stringify(data.networthGoal));
    localStorage.setItem("debt_transactions", JSON.stringify(data.debtTransactions));
    localStorage.setItem("networth_snapshots", JSON.stringify(data.networthSnapshots));
    localStorage.setItem("portfolio_snapshots", JSON.stringify(data.portfolioSnapshots));

    setStatus(
      `Seeded: ${data.incomeEntries.length} income, ${data.expenseEntries.length} expenses, ` +
      `${data.portfolioHoldings.length} holdings, ${data.debtRecords.length} debts, ` +
      `${data.debtTransactions.length} payments, crypto CSV loaded`
    );
  }

  function handleClear() {
    localStorage.clear();
    setStatus("All localStorage cleared");
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Seed Sample Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Populate the app with realistic sample data to test all features.
        </p>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSeed} className="rounded-full px-6">
          Seed Sample Data
        </Button>
        <Button onClick={handleClear} variant="outline" className="rounded-full px-6">
          Clear All Data
        </Button>
      </div>

      {status && (
        <div className="finance-card p-4">
          <p className="text-sm font-mono">{status}</p>
          <p className="text-xs text-muted-foreground mt-2">
            Navigate to other pages to see the data. You may need to refresh.
          </p>
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p>Sample data includes:</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>4 months of income (salary, super, uber, bots, freelance, dividends)</li>
          <li>4 months of expenses (rent, food, transport, subscriptions, health)</li>
          <li>8 portfolio holdings (AU ETFs, US stocks, super fund, bond)</li>
          <li>Crypto portfolio via CSV (BTC, ETH, SOL, OKB, stablecoins)</li>
          <li>3 debts with payment history (car loan, friend, sister)</li>
          <li>Net worth trend snapshots (Jan-Apr 2026)</li>
        </ul>
      </div>
    </div>
  );
}
