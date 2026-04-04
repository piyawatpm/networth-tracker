import type { CryptoTransaction, CryptoHolding } from "./types";
import { STABLECOINS, YIELD_PREFIXES, KNOWN_EXCHANGES } from "./constants";

// ---------------------------------------------------------------------------
// Detect CSV format
// ---------------------------------------------------------------------------

type CsvFormat = "transactions" | "portfolio_overview" | "unknown";

function detectFormat(csvText: string): CsvFormat {
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

    // Group stablecoins as CASH
    const token = isStablecoin(name) ? "Stablecoin" : name;

    holdings.push({
      token,
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
  const holdingsMap = new Map<string, { amount: number; totalCostUsd: number; exchanges: Set<string> }>();

  for (const tx of transactions) {
    // Group stablecoins as CASH
    const token = STABLECOINS.has(tx.token) || isStablecoin(tx.token) ? "Stablecoin" : tx.token;

    if (!holdingsMap.has(token)) {
      holdingsMap.set(token, { amount: 0, totalCostUsd: 0, exchanges: new Set() });
    }

    const h = holdingsMap.get(token)!;

    // Extract exchange from notes
    const exchange = extractExchange(tx.notes);
    if (exchange) h.exchanges.add(exchange);

    switch (tx.type) {
      case "buy":
      case "transferIn":
        h.amount += tx.amount;
        if (tx.totalValueUsd) h.totalCostUsd += tx.totalValueUsd;
        break;
      case "sell":
      case "transferOut":
        h.amount -= tx.amount;
        if (tx.totalValueUsd) h.totalCostUsd -= tx.totalValueUsd;
        break;
    }
  }

  const holdings: CryptoHolding[] = [];
  for (const [token, data] of holdingsMap) {
    if (Math.abs(data.amount) < 0.0001) continue;
    const estimatedValue = token === "Stablecoin" ? data.amount : data.totalCostUsd;
    holdings.push({
      token,
      amount: data.amount,
      totalCostUsd: Math.max(0, data.totalCostUsd),
      currentValueUsd: estimatedValue,
      exchange: data.exchanges.size > 0 ? Array.from(data.exchanges).join(", ") : undefined,
    });
  }

  return holdings.sort((a, b) => b.currentValueUsd - a.currentValueUsd);
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

  // Track cumulative holdings: token → { amount, costUsd, lastPriceUsd }
  const state = new Map<string, { amount: number; costUsd: number; lastPriceUsd: number }>();
  const snapshots: PortfolioSnapshot[] = [];

  for (const tx of sorted) {
    const token = tx.token;
    if (!state.has(token)) {
      state.set(token, { amount: 0, costUsd: 0, lastPriceUsd: tx.priceUsd ?? 0 });
    }
    const s = state.get(token)!;

    // Update price if available
    if (tx.priceUsd != null) s.lastPriceUsd = tx.priceUsd;

    switch (tx.type) {
      case "buy":
      case "transferIn":
        s.amount += tx.amount;
        if (tx.totalValueUsd) s.costUsd += tx.totalValueUsd;
        break;
      case "sell":
      case "transferOut":
        s.amount -= tx.amount;
        if (tx.totalValueUsd) s.costUsd -= tx.totalValueUsd;
        break;
    }

    // Compute total portfolio value at this point
    let totalValue = 0;
    let totalCost = 0;
    for (const [tk, holding] of state) {
      if (Math.abs(holding.amount) < 0.0001) continue;
      // Stablecoins valued at $1 per unit
      const isStable = tk.toUpperCase() === "USDC" || tk.toUpperCase() === "USDT" ||
        tk.toUpperCase() === "BUSD" || tk.toUpperCase() === "DAI" ||
        tk.toUpperCase() === "USD1" || tk.toUpperCase() === "TUSD";
      const price = isStable ? 1 : holding.lastPriceUsd;
      totalValue += holding.amount * price;
      totalCost += Math.max(0, holding.costUsd);
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
  return holdings.find((h) => h.token === "Stablecoin")?.currentValueUsd ?? 0;
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
