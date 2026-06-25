import type { CryptoTransaction, CryptoHolding, RealizedPnlResult, RealizedPnlByToken } from "./types";
import { STABLECOINS, YIELD_PREFIXES, KNOWN_EXCHANGES } from "./constants";

// ---------------------------------------------------------------------------
// Detect CSV format
// ---------------------------------------------------------------------------

export type CsvFormat = "transactions" | "portfolio_overview" | "unknown";

export function detectFormat(csvText: string): CsvFormat {
  const first200 = csvText.slice(0, 200).toLowerCase();
  if (first200.includes("last updated") && first200.includes("total value")) {
    return "portfolio_overview";
  }
  if (first200.includes("date") && first200.includes("token") && first200.includes("type")) {
    return "transactions";
  }
  // Fallback: check for Assets section
  if (csvText.includes("\nAssets\n") || csvText.includes("\nAssets\r\n")) {
    return "portfolio_overview";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Parse Portfolio Overview CSV (CoinStats export)
// Format:
//   "Last updated (UTC+11:00)","2026-04-01 12:32:13"
//   "Currency","USD"
//   "Total value (USD)","10,512.08"
//   ...
//   Assets
//   "Name","Price (USD)","1h %","24h %","7d %","Holdings (USD)","Amount","Avg Buy Price (USD)","Profit / Loss (USD)","Profit / Loss %"
//   "syrupUSDC","1.1574",...
// ---------------------------------------------------------------------------

function parsePortfolioOverview(csvText: string): CryptoHolding[] {
  const lines = csvText.trim().split(/\r?\n/);
  const holdings: CryptoHolding[] = [];

  // Find the Assets section header
  let assetsHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === "assets") {
      assetsHeaderIdx = i;
      break;
    }
  }

  if (assetsHeaderIdx === -1) return [];

  // The row after "Assets" is the column header, data starts after that
  const dataStart = assetsHeaderIdx + 2;

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    if (fields.length < 10) continue;

    const name = clean(fields[0]);
    const holdingsUsd = cleanNumber(fields[5]);
    const amount = cleanNumber(fields[6]);
    const avgBuyPrice = cleanNumber(fields[7]);
    const pnlUsd = cleanNumber(fields[8]);

    if (!name || holdingsUsd === null || amount === null) continue;

    const currentValue = holdingsUsd;
    const costBasis = avgBuyPrice !== null && amount !== null
      ? avgBuyPrice * amount
      : (pnlUsd !== null ? currentValue - pnlUsd : currentValue);

    holdings.push({
      token: name,
      amount,
      totalCostUsd: Math.max(0, costBasis),
      currentValueUsd: currentValue,
      exchange: undefined,
    });
  }

  // Merge CASH entries
  const merged = mergeByToken(holdings);
  return merged.sort((a, b) => b.currentValueUsd - a.currentValueUsd);
}

function isStablecoin(name: string): boolean {
  const upper = name.toUpperCase();
  const lower = name.toLowerCase();

  // Yield-bearing tokens are NOT stablecoins even if they contain stablecoin names
  if (YIELD_PREFIXES.some((p) => lower.startsWith(p))) return false;

  if (STABLECOINS.has(upper)) return true;

  // Check common stablecoin names
  const stablecoinNames = [
    "tether", "usdt", "usdc", "busd", "dai", "tusd", "fdusd", "pyusd",
    "world liberty financial usd",
  ];
  return stablecoinNames.some((s) => lower.includes(s) || upper === s);
}

function mergeByToken(holdings: CryptoHolding[]): CryptoHolding[] {
  const map = new Map<string, CryptoHolding>();
  for (const h of holdings) {
    if (map.has(h.token)) {
      const existing = map.get(h.token)!;
      existing.amount += h.amount;
      existing.totalCostUsd += h.totalCostUsd;
      existing.currentValueUsd += h.currentValueUsd;
    } else {
      map.set(h.token, { ...h });
    }
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Parse Transaction History CSV
// Format:
//   Date (UTC+11:00),Token,Type,Price (USD),Amount,Total value (USD),Fee,Fee Currency,Notes
// ---------------------------------------------------------------------------

export function parseCryptoCSV(csvText: string): CryptoTransaction[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const transactions: CryptoTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    if (fields.length < 9) continue;

    const [dateStr, token, type, priceStr, amountStr, totalStr, feeStr, feeCurrency, notes] = fields;

    transactions.push({
      date: clean(dateStr),
      token: clean(token),
      type: clean(type) as CryptoTransaction["type"],
      priceUsd: cleanNumber(priceStr),
      amount: cleanNumber(amountStr) ?? 0,
      totalValueUsd: cleanNumber(totalStr),
      fee: cleanNumber(feeStr),
      feeCurrency: clean(feeCurrency),
      notes: clean(notes),
    });
  }

  return transactions;
}

// ---------------------------------------------------------------------------
// Unified parse: detects format and returns holdings
// ---------------------------------------------------------------------------

export function parseAndComputeHoldings(csvText: string): CryptoHolding[] {
  const format = detectFormat(csvText);

  if (format === "portfolio_overview") {
    return parsePortfolioOverview(csvText);
  }

  if (format === "transactions") {
    const txns = parseCryptoCSV(csvText);
    return computeHoldings(txns);
  }

  // Unknown format — try both parsers
  const overview = parsePortfolioOverview(csvText);
  if (overview.length > 0) return overview;

  const txns = parseCryptoCSV(csvText);
  if (txns.length > 0) return computeHoldings(txns);

  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function clean(s: string): string {
  return s.replace(/"/g, "").trim();
}

function cleanNumber(s: string): number | null {
  const cleaned = clean(s);
  if (!cleaned || cleaned === "--" || cleaned === "") return null;
  // Remove thousand separators and percent signs
  const num = parseFloat(cleaned.replace(/,/g, "").replace(/%/g, ""));
  return isNaN(num) ? null : num;
}

function extractExchange(notes: string): string | undefined {
  if (!notes) return undefined;
  const lower = notes.toLowerCase().trim();
  for (const [keyword, label] of Object.entries(KNOWN_EXCHANGES)) {
    if (lower.includes(keyword)) return label;
  }
  return undefined;
}

export function computeHoldings(transactions: CryptoTransaction[]): CryptoHolding[] {
  // Avg-buy-price method (matches what crypto exchanges report):
  //   avgBuyPrice = totalBoughtCost / totalBoughtAmount  (buys + transferIns only)
  //   on sell: realized += soldAmount × (soldPrice − avgBuyPrice); cost basis
  //   per remaining unit stays at avgBuyPrice instead of drifting.
  // Sorting by date is required so realized PnL uses the avg-buy-price as it
  // stood AT the time of each sell, not the final all-time average.
  const sorted = [...transactions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  interface State {
    amount: number;
    totalBoughtAmount: number;
    totalBoughtCost: number;
    realizedPnl: number;
    exchanges: Set<string>;
  }
  const holdingsMap = new Map<string, State>();

  for (const tx of sorted) {
    const token = tx.token;
    if (!holdingsMap.has(token)) {
      holdingsMap.set(token, {
        amount: 0,
        totalBoughtAmount: 0,
        totalBoughtCost: 0,
        realizedPnl: 0,
        exchanges: new Set(),
      });
    }
    const h = holdingsMap.get(token)!;

    const exchange = extractExchange(tx.notes);
    if (exchange) h.exchanges.add(exchange);

    switch (tx.type) {
      case "buy":
      case "transferIn":
        h.amount += tx.amount;
        // transferIn rows often have totalValueUsd = null; only track cost
        // for rows that carry a USD value, otherwise avg buy price stays put.
        if (tx.totalValueUsd != null) {
          h.totalBoughtAmount += tx.amount;
          h.totalBoughtCost += tx.totalValueUsd;
        }
        break;
      case "sell":
      case "transferOut": {
        h.amount -= tx.amount;
        if (tx.totalValueUsd != null && h.totalBoughtAmount > 0) {
          const avgBuy = h.totalBoughtCost / h.totalBoughtAmount;
          h.realizedPnl += tx.totalValueUsd - tx.amount * avgBuy;
        }
        break;
      }
    }
  }

  const holdings: CryptoHolding[] = [];
  for (const [token, data] of holdingsMap) {
    if (Math.abs(data.amount) < 0.0001) continue;
    const stable = isStablecoin(token);
    const avgBuy =
      data.totalBoughtAmount > 0
        ? data.totalBoughtCost / data.totalBoughtAmount
        : 0;
    // Stablecoin cost-basis drifts on amount-only transferIn/Out rows, so
    // peg cost to current amount → unrealized PnL stays 0 (the peg is $1).
    const totalCostUsd = stable
      ? data.amount
      : Math.max(0, data.amount * avgBuy);
    const currentValueUsd = stable ? data.amount : totalCostUsd;
    holdings.push({
      token,
      amount: data.amount,
      totalCostUsd,
      currentValueUsd,
      realizedPnlUsd: stable ? 0 : data.realizedPnl,
      exchange: data.exchanges.size > 0 ? Array.from(data.exchanges).join(", ") : undefined,
    });
  }

  return holdings.sort((a, b) => b.currentValueUsd - a.currentValueUsd);
}

// ---------------------------------------------------------------------------
// Compute realized PnL per token (includes fully-sold coins)
// ---------------------------------------------------------------------------
// Unlike computeHoldings, this does NOT drop tokens whose current balance is
// ~0 — those are exactly the positions you've fully exited, where realized
// profit matters most. Mirrors the avg-buy-price method (cumulative buys define
// the average; sells realize proceeds − soldAmount × avgBuyPrice) so the number
// stays consistent with the cost basis used elsewhere. Stablecoins and dust
// (<$0.01) are filtered out so the list stays clean.

export function computeRealizedPnl(transactions: CryptoTransaction[]): RealizedPnlResult {
  // Sort by date so each sell uses the avg-buy-price as it stood at that time.
  const sorted = [...transactions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  interface State {
    totalBoughtAmount: number;
    totalBoughtCost: number;
    realizedPnl: number;
  }
  const map = new Map<string, State>();

  for (const tx of sorted) {
    if (!map.has(tx.token)) {
      map.set(tx.token, { totalBoughtAmount: 0, totalBoughtCost: 0, realizedPnl: 0 });
    }
    const s = map.get(tx.token)!;

    switch (tx.type) {
      case "buy":
      case "transferIn":
        // transferIn rows often carry no USD value; only shift the average
        // when the row has a cost, otherwise avg buy price drifts on deposits.
        if (tx.totalValueUsd != null) {
          s.totalBoughtAmount += tx.amount;
          s.totalBoughtCost += tx.totalValueUsd;
        }
        break;
      case "sell":
      case "transferOut":
        // A disposal only realizes PnL when it carries USD proceeds and we have
        // a cost basis to compare against.
        if (tx.totalValueUsd != null && s.totalBoughtAmount > 0) {
          const avgBuy = s.totalBoughtCost / s.totalBoughtAmount;
          s.realizedPnl += tx.totalValueUsd - tx.amount * avgBuy;
        }
        break;
    }
  }

  const byToken: RealizedPnlByToken[] = [];
  let total = 0;
  for (const [token, data] of map) {
    if (isStablecoin(token)) continue;
    if (Math.abs(data.realizedPnl) < 0.01) continue;
    byToken.push({ token, realizedPnlUsd: data.realizedPnl });
    total += data.realizedPnl;
  }

  byToken.sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd);
  return { total, byToken };
}

// ---------------------------------------------------------------------------
// Compute portfolio value history from transaction CSV
// ---------------------------------------------------------------------------

export interface PortfolioSnapshot {
  date: string; // YYYY-MM-DD
  totalValueUsd: number;
  totalCostUsd: number;
}

export function computePortfolioHistory(csvText: string): PortfolioSnapshot[] {
  // Try to detect and parse as transactions
  const format = detectFormat(csvText);
  if (format !== "transactions") return [];

  const transactions = parseCryptoCSV(csvText);
  if (transactions.length === 0) return [];

  // Sort transactions by date ascending
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  // Avg-buy-price method (mirrors computeHoldings). Selling at a profit must
  // not collapse the cost basis of remaining units, so sells only reduce
  // amount — totalBoughtAmount/Cost stay put so avgBuy = cost/amount is stable.
  interface State {
    amount: number;
    totalBoughtAmount: number;
    totalBoughtCost: number;
    lastPriceUsd: number;
  }
  const state = new Map<string, State>();
  const snapshots: PortfolioSnapshot[] = [];

  for (const tx of sorted) {
    const token = tx.token;
    if (!state.has(token)) {
      state.set(token, {
        amount: 0,
        totalBoughtAmount: 0,
        totalBoughtCost: 0,
        lastPriceUsd: tx.priceUsd ?? 0,
      });
    }
    const s = state.get(token)!;

    // Update price if available
    if (tx.priceUsd != null) s.lastPriceUsd = tx.priceUsd;

    switch (tx.type) {
      case "buy":
      case "transferIn":
        s.amount += tx.amount;
        // transferIn rows often have totalValueUsd = null; only shift avg-buy
        // when the row carries USD, otherwise cost drifts on deposits.
        if (tx.totalValueUsd != null) {
          s.totalBoughtAmount += tx.amount;
          s.totalBoughtCost += tx.totalValueUsd;
        }
        break;
      case "sell":
      case "transferOut":
        s.amount -= tx.amount;
        break;
    }

    // Compute total portfolio value at this point
    let totalValue = 0;
    let totalCost = 0;
    for (const [tk, holding] of state) {
      if (Math.abs(holding.amount) < 0.0001) continue;
      // Stablecoins pegged at $1 per unit (cost == value, unrealized PnL = 0)
      const isStable = tk.toUpperCase() === "USDC" || tk.toUpperCase() === "USDT" ||
        tk.toUpperCase() === "BUSD" || tk.toUpperCase() === "DAI" ||
        tk.toUpperCase() === "USD1" || tk.toUpperCase() === "TUSD";
      if (isStable) {
        totalValue += holding.amount;
        totalCost += holding.amount;
      } else {
        const avgBuy = holding.totalBoughtAmount > 0
          ? holding.totalBoughtCost / holding.totalBoughtAmount
          : 0;
        totalValue += holding.amount * holding.lastPriceUsd;
        totalCost += Math.max(0, holding.amount * avgBuy);
      }
    }

    // Extract date (YYYY-MM-DD from "YYYY-MM-DD HH:MM:SS")
    const dateOnly = tx.date.split(" ")[0];

    // Only add snapshot if date changed (avoid duplicates per date, keep last)
    if (snapshots.length > 0 && snapshots[snapshots.length - 1].date === dateOnly) {
      snapshots[snapshots.length - 1] = { date: dateOnly, totalValueUsd: totalValue, totalCostUsd: totalCost };
    } else {
      snapshots.push({ date: dateOnly, totalValueUsd: totalValue, totalCostUsd: totalCost });
    }
  }

  return snapshots;
}

export function getTotalCryptoValueUsd(holdings: CryptoHolding[]): number {
  return holdings.reduce((sum, h) => sum + h.currentValueUsd, 0);
}

export function getTotalCryptoCostUsd(holdings: CryptoHolding[]): number {
  return holdings.reduce((sum, h) => sum + h.totalCostUsd, 0);
}

export function getCashValueUsd(holdings: CryptoHolding[]): number {
  return holdings
    .filter((h) => h.token === "Stablecoin" || isStablecoin(h.token))
    .reduce((sum, h) => sum + h.currentValueUsd, 0);
}

/** Merge user-tagged stablecoins into a single CASH holding */
export function applyStablecoinTags(
  holdings: CryptoHolding[],
  stablecoinTags: Record<string, boolean>,
): CryptoHolding[] {
  const stableTokens = Object.entries(stablecoinTags)
    .filter(([, isStable]) => isStable)
    .map(([token]) => token);

  if (stableTokens.length === 0) return holdings;

  const cashHolding: CryptoHolding = {
    token: "Stablecoin",
    amount: 0,
    totalCostUsd: 0,
    currentValueUsd: 0,
    exchange: undefined,
  };
  const result: CryptoHolding[] = [];

  for (const h of holdings) {
    if (h.token === "Stablecoin" || stableTokens.includes(h.token)) {
      cashHolding.amount += h.amount;
      cashHolding.totalCostUsd += h.totalCostUsd;
      cashHolding.currentValueUsd += h.currentValueUsd;
      if (h.exchange) {
        cashHolding.exchange = cashHolding.exchange
          ? `${cashHolding.exchange}, ${h.exchange}`
          : h.exchange;
      }
    } else {
      result.push(h);
    }
  }

  if (cashHolding.amount > 0.0001) {
    result.push(cashHolding);
  }

  return result.sort((a, b) => b.currentValueUsd - a.currentValueUsd);
}
