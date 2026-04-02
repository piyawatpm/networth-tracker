"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  IncomeEntry,
  ExpenseEntry,
  PortfolioHolding,
  DebtRecord,
  DebtTransaction,
  RecurringIncome,
  RecurringExpense,
} from "@/lib/utils/types";

function id() { return crypto.randomUUID(); }

export function generateSampleData() {
  const now = Date.now();

  // ---- INCOME (6 months: Nov 2025 - Apr 2026) --------------------------------
  const incomeEntries: IncomeEntry[] = [
    // November 2025
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2025-11-07", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2025-11-21", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super", amount: 540, currency: "AUD", date: "2025-11-21", notes: "", source: "AustralianSuper", createdAt: now },
    { id: id(), type: "uber", description: "Uber driving", amount: 310, currency: "AUD", date: "2025-11-30", notes: "", source: "Uber", createdAt: now },
    { id: id(), type: "arb_bot", description: "Arb bot profit", amount: 55, currency: "USD", date: "2025-11-28", notes: "", source: "", createdAt: now },
    // December 2025
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2025-12-05", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2025-12-19", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super", amount: 540, currency: "AUD", date: "2025-12-19", notes: "", source: "AustralianSuper", createdAt: now },
    { id: id(), type: "bonus", description: "Christmas bonus", amount: 2000, currency: "AUD", date: "2025-12-20", notes: "Annual bonus", source: "Employer", createdAt: now },
    { id: id(), type: "uber", description: "Uber holiday surge", amount: 720, currency: "AUD", date: "2025-12-31", notes: "NYE driving", source: "Uber", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena bot profit", amount: 190, currency: "USD", date: "2025-12-28", notes: "", source: "", createdAt: now },
    { id: id(), type: "crypto_yield", description: "syrupUSDC yield", amount: 38, currency: "USD", date: "2025-12-31", notes: "", source: "Maple", createdAt: now },
    // January 2026
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-01-09", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-01-23", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super", amount: 540, currency: "AUD", date: "2026-01-23", notes: "", source: "AustralianSuper", createdAt: now },
    { id: id(), type: "uber", description: "Uber driving", amount: 380, currency: "AUD", date: "2026-01-31", notes: "", source: "Uber", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena bot profit", amount: 145, currency: "USD", date: "2026-01-28", notes: "", source: "", createdAt: now },
    { id: id(), type: "arb_bot", description: "Arb bot profit", amount: 67, currency: "USD", date: "2026-01-30", notes: "", source: "", createdAt: now },
    { id: id(), type: "rental", description: "Spare room Airbnb", amount: 450, currency: "AUD", date: "2026-01-15", notes: "Guest stayed 3 nights", source: "Airbnb", createdAt: now },
    // February 2026
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-02-06", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-02-20", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super", amount: 540, currency: "AUD", date: "2026-02-20", notes: "", source: "AustralianSuper", createdAt: now },
    { id: id(), type: "uber", description: "Uber driving", amount: 520, currency: "AUD", date: "2026-02-28", notes: "Busy month", source: "Uber", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena bot profit", amount: 210, currency: "USD", date: "2026-02-25", notes: "", source: "", createdAt: now },
    { id: id(), type: "freelance", description: "Website for cafe", amount: 800, currency: "AUD", date: "2026-02-15", notes: "One-time project", source: "Direct client", createdAt: now },
    { id: id(), type: "crypto_yield", description: "syrupUSDC yield", amount: 42, currency: "USD", date: "2026-02-28", notes: "", source: "Maple", createdAt: now },
    { id: id(), type: "interest", description: "Savings interest", amount: 35, currency: "AUD", date: "2026-02-28", notes: "", source: "ING", createdAt: now },
    // March 2026
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-03-06", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-03-20", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super", amount: 540, currency: "AUD", date: "2026-03-20", notes: "", source: "AustralianSuper", createdAt: now },
    { id: id(), type: "super_personal", description: "Personal super top-up", amount: 200, currency: "AUD", date: "2026-03-20", notes: "Voluntary", source: "AustralianSuper", createdAt: now },
    { id: id(), type: "uber", description: "Uber driving", amount: 290, currency: "AUD", date: "2026-03-31", notes: "", source: "Uber", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena bot profit", amount: 178, currency: "USD", date: "2026-03-28", notes: "", source: "", createdAt: now },
    { id: id(), type: "arb_bot", description: "Arb bot profit", amount: 89, currency: "USD", date: "2026-03-30", notes: "", source: "", createdAt: now },
    { id: id(), type: "dividend", description: "VAS dividend", amount: 125, currency: "AUD", date: "2026-03-15", notes: "Quarterly", source: "CommSec", createdAt: now },
    { id: id(), type: "interest", description: "HISA interest", amount: 48, currency: "AUD", date: "2026-03-31", notes: "", source: "ING", createdAt: now },
    { id: id(), type: "other", description: "Tax refund (partial)", amount: 1200, currency: "AUD", date: "2026-03-10", notes: "FY25 amendment", source: "ATO", createdAt: now },
    // April 2026
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", date: "2026-04-01", notes: "", source: "Employer", createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super", amount: 540, currency: "AUD", date: "2026-04-01", notes: "", source: "AustralianSuper", createdAt: now },
    { id: id(), type: "uber", description: "Uber Easter weekend", amount: 650, currency: "AUD", date: "2026-04-01", notes: "Surge pricing", source: "Uber", createdAt: now },
    { id: id(), type: "arena_bot", description: "Arena bot profit", amount: 92, currency: "USD", date: "2026-04-01", notes: "", source: "", createdAt: now },
    { id: id(), type: "freelance", description: "Logo design", amount: 15000, currency: "THB", date: "2026-04-02", notes: "Thai client", source: "Fiverr", createdAt: now },
  ];

  // ---- EXPENSES (6 months, diverse payment methods) --------------------------
  const pm = (m: string) => m as "cash" | "debit_card" | "credit_card" | "bank_transfer" | "other";
  const expenseEntries: ExpenseEntry[] = [
    // November 2025
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2025-11-01", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 165, currency: "AUD", vendor: "Woolworths", date: "2025-11-05", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 120, currency: "AUD", vendor: "Aldi", date: "2025-11-12", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "transport", description: "Opal card", amount: 50, currency: "AUD", vendor: "Opal", date: "2025-11-10", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify + Netflix", amount: 35.98, currency: "AUD", vendor: "Various", date: "2025-11-15", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "health", description: "Gym", amount: 69, currency: "AUD", vendor: "Fitness First", date: "2025-11-01", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    // December 2025
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2025-12-01", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 210, currency: "AUD", vendor: "Woolworths", date: "2025-12-03", notes: "Christmas shopping", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "gifts", description: "Christmas gifts", amount: 450, currency: "AUD", vendor: "Various", date: "2025-12-20", notes: "Family gifts", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "travel", description: "Flight to Melbourne", amount: 280, currency: "AUD", vendor: "Jetstar", date: "2025-12-22", notes: "Christmas trip", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "entertainment", description: "NYE party", amount: 120, currency: "AUD", vendor: "Various", date: "2025-12-31", notes: "", images: [], paymentMethod: pm("cash"), createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify + Netflix", amount: 35.98, currency: "AUD", vendor: "Various", date: "2025-12-15", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "health", description: "Gym", amount: 69, currency: "AUD", vendor: "Fitness First", date: "2025-12-01", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    // January 2026
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2026-01-01", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "food", description: "Woolworths groceries", amount: 145, currency: "AUD", vendor: "Woolworths", date: "2026-01-05", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "food", description: "Weekly groceries", amount: 132, currency: "AUD", vendor: "Coles", date: "2026-01-12", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "food", description: "Dinner with friends", amount: 85, currency: "AUD", vendor: "Thai Pothong", date: "2026-01-18", notes: "", images: [], paymentMethod: pm("cash"), createdAt: now },
    { id: id(), type: "transport", description: "Opal card top-up", amount: 50, currency: "AUD", vendor: "Opal", date: "2026-01-10", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify Premium", amount: 12.99, currency: "AUD", vendor: "Spotify", date: "2026-01-15", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "subscriptions", description: "Netflix", amount: 22.99, currency: "AUD", vendor: "Netflix", date: "2026-01-15", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "utilities", description: "Electricity bill", amount: 180, currency: "AUD", vendor: "AGL", date: "2026-01-20", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "health", description: "Gym membership", amount: 69, currency: "AUD", vendor: "Fitness First", date: "2026-01-01", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "insurance", description: "Health insurance", amount: 145, currency: "AUD", vendor: "Medibank", date: "2026-01-28", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "entertainment", description: "Movie tickets", amount: 38, currency: "AUD", vendor: "Event Cinemas", date: "2026-01-25", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    // February 2026
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2026-02-01", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 158, currency: "AUD", vendor: "Woolworths", date: "2026-02-03", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "food", description: "Valentine's dinner", amount: 195, currency: "AUD", vendor: "Quay Restaurant", date: "2026-02-14", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "transport", description: "Car rego", amount: 380, currency: "AUD", vendor: "Service NSW", date: "2026-02-15", notes: "Annual", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify + Netflix", amount: 35.98, currency: "AUD", vendor: "Various", date: "2026-02-15", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "health", description: "Gym", amount: 69, currency: "AUD", vendor: "Fitness First", date: "2026-02-01", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "shopping", description: "New running shoes", amount: 189, currency: "AUD", vendor: "Nike", date: "2026-02-20", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "education", description: "Udemy courses", amount: 29.99, currency: "USD", vendor: "Udemy", date: "2026-02-22", notes: "React & TypeScript", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    // March 2026
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2026-03-01", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 167, currency: "AUD", vendor: "Woolworths", date: "2026-03-02", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 98, currency: "AUD", vendor: "Aldi", date: "2026-03-09", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 143, currency: "AUD", vendor: "Coles", date: "2026-03-16", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "food", description: "Brunch with mates", amount: 65, currency: "AUD", vendor: "Bills Surry Hills", date: "2026-03-15", notes: "", images: [], paymentMethod: pm("cash"), createdAt: now },
    { id: id(), type: "transport", description: "Opal card", amount: 50, currency: "AUD", vendor: "Opal", date: "2026-03-05", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "transport", description: "Petrol", amount: 95, currency: "AUD", vendor: "7-Eleven", date: "2026-03-18", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify + Netflix", amount: 35.98, currency: "AUD", vendor: "Various", date: "2026-03-15", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "utilities", description: "Internet", amount: 79, currency: "AUD", vendor: "Aussie Broadband", date: "2026-03-10", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "health", description: "Gym", amount: 69, currency: "AUD", vendor: "Fitness First", date: "2026-03-01", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "health", description: "Dentist checkup", amount: 220, currency: "AUD", vendor: "Sydney Dental", date: "2026-03-22", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "insurance", description: "Health insurance", amount: 145, currency: "AUD", vendor: "Medibank", date: "2026-03-28", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "travel", description: "Blue Mountains", amount: 350, currency: "AUD", vendor: "Airbnb", date: "2026-03-28", notes: "2 nights", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "education", description: "Thai lessons", amount: 3500, currency: "THB", vendor: "iTalki", date: "2026-03-20", notes: "10 lessons pack", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    // April 2026
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", date: "2026-04-01", notes: "", images: [], paymentMethod: pm("bank_transfer"), createdAt: now },
    { id: id(), type: "food", description: "Groceries", amount: 135, currency: "AUD", vendor: "Woolworths", date: "2026-04-01", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "food", description: "Lunch", amount: 28, currency: "AUD", vendor: "Guzman y Gomez", date: "2026-04-02", notes: "", images: [], paymentMethod: pm("cash"), createdAt: now },
    { id: id(), type: "transport", description: "Opal card", amount: 50, currency: "AUD", vendor: "Opal", date: "2026-04-01", notes: "", images: [], paymentMethod: pm("debit_card"), createdAt: now },
    { id: id(), type: "subscriptions", description: "ChatGPT Plus", amount: 20, currency: "USD", vendor: "OpenAI", date: "2026-04-01", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "subscriptions", description: "Claude Pro", amount: 20, currency: "USD", vendor: "Anthropic", date: "2026-04-01", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
    { id: id(), type: "shopping", description: "AirPods Pro", amount: 399, currency: "AUD", vendor: "Apple Store", date: "2026-04-02", notes: "", images: [], paymentMethod: pm("credit_card"), createdAt: now },
  ];

  // ---- PORTFOLIO ----------------------------------------------------------
  const portfolioHoldings: PortfolioHolding[] = [
    { id: id(), name: "Vanguard Australian Shares Index ETF", ticker: "VAS", type: "etf", accountType: "normal", broker: "CommSec", country: "AU", link: "", units: 52, amountInvested: 4680, currentValue: 5148, currency: "AUD", notes: "", createdAt: now },
    { id: id(), name: "Vanguard Diversified High Growth Index ETF", ticker: "VDHG", type: "etf", accountType: "normal", broker: "CommSec", country: "AU", link: "", units: 35, amountInvested: 2275, currentValue: 2485, currency: "AUD", notes: "Long term hold", createdAt: now },
    { id: id(), name: "BetaShares NASDAQ 100 ETF", ticker: "NDQ", type: "etf", accountType: "normal", broker: "CommSec", country: "AU", link: "", units: 18, amountInvested: 612, currentValue: 684, currency: "AUD", notes: "", createdAt: now },
    { id: id(), name: "Apple Inc", ticker: "AAPL", type: "stock", accountType: "normal", broker: "Interactive Brokers", country: "US", link: "", units: 5, amountInvested: 875, currentValue: 1125, currency: "USD", notes: "", createdAt: now },
    { id: id(), name: "Tesla Inc", ticker: "TSLA", type: "stock", accountType: "normal", broker: "Interactive Brokers", country: "US", link: "", units: 3, amountInvested: 780, currentValue: 690, currency: "USD", notes: "Volatile", createdAt: now },
    { id: id(), name: "Microsoft Corp", ticker: "MSFT", type: "stock", accountType: "normal", broker: "Interactive Brokers", country: "US", link: "", units: 2, amountInvested: 800, currentValue: 920, currency: "USD", notes: "", createdAt: now },
    { id: id(), name: "AustralianSuper High Growth", ticker: "SUPER", type: "fund", accountType: "super", broker: "AustralianSuper", country: "AU", link: "", units: 1, amountInvested: 45000, currentValue: 52800, currency: "AUD", notes: "Employer super", createdAt: now },
    { id: id(), name: "IFM Infrastructure Fund", ticker: "IFM-INFRA", type: "fund", accountType: "super", broker: "AustralianSuper", country: "AU", link: "", units: 1, amountInvested: 8000, currentValue: 9200, currency: "AUD", notes: "Within super", createdAt: now },
    { id: id(), name: "Australian Government Bond", ticker: "GOVT", type: "bond", accountType: "normal", broker: "CommSec", country: "AU", link: "", units: 10, amountInvested: 1000, currentValue: 1015, currency: "AUD", notes: "Low risk", createdAt: now },
    { id: id(), name: "Bangkok Land Fund", ticker: "BKKLAND", type: "other", accountType: "normal", broker: "SCB Securities", country: "TH", link: "", units: 1000, amountInvested: 150000, currentValue: 165000, currency: "THB", notes: "Thai property fund", createdAt: now },
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

  // ---- DEBTS (5 debts: mix of directions, 1 fully paid) -------------------
  const debtCarLoan = id();
  const debtFriendJake = id();
  const debtSisterLoan = id();
  const debtPhoneLoan = id();
  const debtCoworkerLunch = id();

  const debtRecords: DebtRecord[] = [
    { id: debtCarLoan, person: "Toyota Finance", direction: "i_owe", reason: "Car loan - Corolla 2024", originalAmount: 15000, currency: "AUD", notes: "Monthly repayments $450", images: [], createdAt: now },
    { id: debtFriendJake, person: "Jake", direction: "owed_to_me", reason: "Lent for concert tickets", originalAmount: 350, currency: "AUD", notes: "Coldplay concert Mar 2026", images: [], createdAt: now },
    { id: debtSisterLoan, person: "Sister (Ploy)", direction: "owed_to_me", reason: "Helped with uni textbooks", originalAmount: 500, currency: "AUD", notes: "", images: [], createdAt: now },
    { id: debtPhoneLoan, person: "Afterpay", direction: "i_owe", reason: "iPhone 16 Pro", originalAmount: 1999, currency: "AUD", notes: "4 instalments", images: [], createdAt: now },
    { id: debtCoworkerLunch, person: "Mike (coworker)", direction: "owed_to_me", reason: "Covered his lunch", originalAmount: 25, currency: "AUD", notes: "Paid back in full", images: [], createdAt: now },
  ];

  const debtTransactions: DebtTransaction[] = [
    // Car loan
    { id: id(), debtId: debtCarLoan, amount: 450, date: "2026-01-15", notes: "Monthly repayment", images: [], createdAt: now },
    { id: id(), debtId: debtCarLoan, amount: 450, date: "2026-02-15", notes: "Monthly repayment", images: [], createdAt: now },
    { id: id(), debtId: debtCarLoan, amount: 450, date: "2026-03-15", notes: "Monthly repayment", images: [], createdAt: now },
    // Jake partial
    { id: id(), debtId: debtFriendJake, amount: 200, date: "2026-03-20", notes: "Bank transfer", images: [], createdAt: now },
    // Sister
    { id: id(), debtId: debtSisterLoan, amount: 100, date: "2026-02-10", notes: "Cash", images: [], createdAt: now },
    { id: id(), debtId: debtSisterLoan, amount: 100, date: "2026-03-10", notes: "Cash", images: [], createdAt: now },
    // Sister negative adjustment (she borrowed more)
    { id: id(), debtId: debtSisterLoan, amount: -50, date: "2026-03-25", notes: "Borrowed more for groceries", images: [], createdAt: now },
    // Afterpay
    { id: id(), debtId: debtPhoneLoan, amount: 499.75, date: "2026-01-20", notes: "Instalment 1/4", images: [], createdAt: now },
    { id: id(), debtId: debtPhoneLoan, amount: 499.75, date: "2026-02-20", notes: "Instalment 2/4", images: [], createdAt: now },
    { id: id(), debtId: debtPhoneLoan, amount: 499.75, date: "2026-03-20", notes: "Instalment 3/4", images: [], createdAt: now },
    // Mike — fully paid back
    { id: id(), debtId: debtCoworkerLunch, amount: 25, date: "2026-03-05", notes: "Paid back cash", images: [], createdAt: now },
  ];

  // ---- RECURRING TEMPLATES -----------------------------------------------
  const recurringIncomeTemplates: RecurringIncome[] = [
    { id: id(), type: "salary", description: "Fortnightly salary", amount: 4500, currency: "AUD", source: "Employer", notes: "", frequency: "fortnightly", startDate: "2025-01-09", active: true, createdAt: now },
    { id: id(), type: "super_employer", description: "Employer super", amount: 540, currency: "AUD", source: "AustralianSuper", notes: "12% of salary", frequency: "fortnightly", startDate: "2025-01-09", active: true, createdAt: now },
    { id: id(), type: "uber", description: "Uber driving income", amount: 400, currency: "AUD", source: "Uber", notes: "Varies monthly", frequency: "monthly", startDate: "2025-06-01", active: true, createdAt: now },
    { id: id(), type: "interest", description: "HISA interest", amount: 45, currency: "AUD", source: "ING", notes: "", frequency: "monthly", startDate: "2025-01-31", active: true, createdAt: now },
  ];

  const recurringExpenseTemplates: RecurringExpense[] = [
    { id: id(), type: "rent", description: "Monthly rent", amount: 2200, currency: "AUD", vendor: "REA Group", paymentMethod: "bank_transfer", notes: "Surry Hills apartment", frequency: "monthly", startDate: "2024-06-01", active: true, createdAt: now },
    { id: id(), type: "health", description: "Gym membership", amount: 69, currency: "AUD", vendor: "Fitness First", paymentMethod: "debit_card", notes: "", frequency: "monthly", startDate: "2024-01-01", active: true, createdAt: now },
    { id: id(), type: "subscriptions", description: "Spotify Premium", amount: 12.99, currency: "AUD", vendor: "Spotify", paymentMethod: "credit_card", notes: "", frequency: "monthly", startDate: "2023-03-15", active: true, createdAt: now },
    { id: id(), type: "subscriptions", description: "Netflix", amount: 22.99, currency: "AUD", vendor: "Netflix", paymentMethod: "credit_card", notes: "", frequency: "monthly", startDate: "2023-06-15", active: true, createdAt: now },
    { id: id(), type: "subscriptions", description: "ChatGPT Plus", amount: 20, currency: "USD", vendor: "OpenAI", paymentMethod: "credit_card", notes: "", frequency: "monthly", startDate: "2025-06-01", active: true, createdAt: now },
    { id: id(), type: "insurance", description: "Health insurance", amount: 145, currency: "AUD", vendor: "Medibank", paymentMethod: "bank_transfer", notes: "", frequency: "monthly", startDate: "2024-01-28", active: true, createdAt: now },
    { id: id(), type: "utilities", description: "Internet", amount: 79, currency: "AUD", vendor: "Aussie Broadband", paymentMethod: "bank_transfer", notes: "", frequency: "monthly", startDate: "2024-06-10", active: true, createdAt: now },
    { id: id(), type: "transport", description: "Opal auto top-up", amount: 50, currency: "AUD", vendor: "Opal", paymentMethod: "debit_card", notes: "", frequency: "weekly", startDate: "2025-01-06", active: false, createdAt: now },
  ];

  // ---- NET WORTH SNAPSHOTS (wider range) ----------------------------------
  const networthSnapshots = [
    { date: "2025-10-01", value: 48000 },
    { date: "2025-10-15", value: 49200 },
    { date: "2025-11-01", value: 50500 },
    { date: "2025-11-15", value: 51800 },
    { date: "2025-12-01", value: 53200 },
    { date: "2025-12-15", value: 54100 },
    { date: "2026-01-01", value: 55000 },
    { date: "2026-01-15", value: 56200 },
    { date: "2026-02-01", value: 57800 },
    { date: "2026-02-15", value: 58100 },
    { date: "2026-03-01", value: 59500 },
    { date: "2026-03-08", value: 59900 },
    { date: "2026-03-15", value: 60200 },
    { date: "2026-03-22", value: 60800 },
    { date: "2026-03-28", value: 61400 },
    { date: "2026-04-01", value: 62100 },
    { date: "2026-04-02", value: 62300 },
  ];

  // ---- PORTFOLIO SNAPSHOTS ------------------------------------------------
  const portfolioSnapshots = [
    { date: "2025-10-01", value: 7200, valueWithSuper: 52200 },
    { date: "2025-11-01", value: 7800, valueWithSuper: 54800 },
    { date: "2025-12-01", value: 8200, valueWithSuper: 57200 },
    { date: "2026-01-01", value: 8500, valueWithSuper: 58500 },
    { date: "2026-01-15", value: 8700, valueWithSuper: 59200 },
    { date: "2026-02-01", value: 9100, valueWithSuper: 60100 },
    { date: "2026-02-15", value: 9000, valueWithSuper: 59800 },
    { date: "2026-03-01", value: 9400, valueWithSuper: 61400 },
    { date: "2026-03-15", value: 9600, valueWithSuper: 61800 },
    { date: "2026-03-22", value: 9800, valueWithSuper: 62200 },
    { date: "2026-03-28", value: 10000, valueWithSuper: 62800 },
    { date: "2026-04-01", value: 10100, valueWithSuper: 63100 },
    { date: "2026-04-02", value: 10200, valueWithSuper: 63400 },
  ];

  // ---- NET WORTH GOALS (multiple, 1 achieved) ----------------------------
  const networthGoals = [
    { id: id(), name: "First 50K", amount: 50000, currency: "AUD", setAt: now - 180 * 86400000, achievedAt: now - 60 * 86400000 },
    { id: id(), name: "Emergency Fund", amount: 20000, currency: "AUD", setAt: now - 120 * 86400000, achievedAt: now - 30 * 86400000 },
    { id: id(), name: "100K Club", amount: 100000, currency: "AUD", setAt: now, achievedAt: null },
    { id: id(), name: "House Deposit", amount: 200000, currency: "AUD", setAt: now, achievedAt: null },
    { id: id(), name: "Quarter Million", amount: 250000, currency: "AUD", setAt: now, achievedAt: null },
  ];

  // ---- PRICE UPDATE LOG ---------------------------------------------------
  const priceUpdateLog = [
    { holdingId: "vas-mock", holdingName: "VAS", oldValue: 5000, newValue: 5148, source: "auto" as const, timestamp: now - 86400000 },
    { holdingId: "aapl-mock", holdingName: "Apple Inc", oldValue: 1050, newValue: 1125, source: "auto" as const, timestamp: now - 86400000 },
    { holdingId: "tsla-mock", holdingName: "Tesla Inc", oldValue: 720, newValue: 690, source: "auto" as const, timestamp: now - 86400000 },
    { holdingId: "super-mock", holdingName: "AustralianSuper", oldValue: 51500, newValue: 52800, source: "manual" as const, timestamp: now - 172800000 },
  ];

  return {
    incomeEntries,
    expenseEntries,
    portfolioHoldings,
    cryptoCsvText,
    debtRecords,
    debtTransactions,
    networthSnapshots,
    portfolioSnapshots,
    networthGoals,
    recurringIncomeTemplates,
    recurringExpenseTemplates,
    priceUpdateLog,
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
    localStorage.setItem("debt_transactions", JSON.stringify(data.debtTransactions));
    localStorage.setItem("networth_snapshots", JSON.stringify(data.networthSnapshots));
    localStorage.setItem("portfolio_snapshots", JSON.stringify(data.portfolioSnapshots));
    localStorage.setItem("networth_goals", JSON.stringify(data.networthGoals));
    localStorage.removeItem("networth_goal"); // clean old single goal
    localStorage.setItem("recurring_income_templates", JSON.stringify(data.recurringIncomeTemplates));
    localStorage.setItem("recurring_expense_templates", JSON.stringify(data.recurringExpenseTemplates));
    localStorage.setItem("price_update_log", JSON.stringify(data.priceUpdateLog));
    localStorage.setItem("enabled_currencies", JSON.stringify(["AUD", "USD", "THB", "EUR"]));

    setStatus(
      `Seeded: ${data.incomeEntries.length} income, ${data.expenseEntries.length} expenses, ` +
      `${data.portfolioHoldings.length} holdings, ${data.debtRecords.length} debts, ` +
      `${data.debtTransactions.length} payments, ` +
      `${data.recurringIncomeTemplates.length} recurring income, ` +
      `${data.recurringExpenseTemplates.length} recurring expenses, ` +
      `crypto CSV loaded, goal set to A$100K`
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
          Populate the app with comprehensive sample data to test all features.
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
        <p>Comprehensive sample data includes:</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>6 months of income — 42 entries (salary, super, uber, bots, freelance, dividends, rental, interest, bonus, THB income)</li>
          <li>6 months of expenses — 52 entries (rent, food, transport, subs, health, insurance, gifts, travel, shopping, education, USD + THB expenses)</li>
          <li>All payment methods used: cash, debit card, credit card, bank transfer</li>
          <li>10 portfolio holdings (AU ETFs, US stocks, super fund, bond, Thai property fund)</li>
          <li>Crypto portfolio via CSV (BTC, ETH, SOL, OKB, stablecoins)</li>
          <li>5 debts: car loan, friend, sister (with negative adjustment), Afterpay, fully paid coworker</li>
          <li>4 recurring income templates (salary, super, uber, interest)</li>
          <li>8 recurring expense templates (rent, gym, spotify, netflix, chatgpt, insurance, internet, opal — 1 inactive)</li>
          <li>17 net worth snapshots (Oct 2025 - Apr 2026)</li>
          <li>13 portfolio snapshots with super toggle data</li>
          <li>Net worth goal: A$100,000</li>
          <li>4 price update log entries (auto + manual)</li>
          <li>4 currencies enabled: AUD, USD, THB, EUR</li>
        </ul>
      </div>
    </div>
  );
}
