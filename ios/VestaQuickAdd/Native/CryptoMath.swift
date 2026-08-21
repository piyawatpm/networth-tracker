import Foundation

// Port of lib/utils/crypto-csv.ts — parser + avg-buy replay. The CSV has
// quoted thousands separators ("10,512.08"); a naive split corrupts every
// number, which is why the quote-aware parser is ported verbatim.

struct CryptoTransaction {
    let date: String
    let token: String
    let type: String // buy | sell | transferIn | transferOut
    let priceUsd: Double?
    let amount: Double
    let totalValueUsd: Double?
    let notes: String
}

struct CryptoHolding: Identifiable {
    let token: String
    let amount: Double
    let totalCostUsd: Double
    let realizedPnlUsd: Double
    var id: String { token }
}

/// One row of the exchange's Portfolio Overview CSV — the authoritative
/// holdings list. Earn/locked coins appear ONLY here, never in the tx CSV, and
/// the stored USD value keeps a token priced even when no live feed knows it.
struct CryptoCsvHolding: Identifiable {
    let token: String
    let amount: Double
    let valueUsd: Double
    let costUsd: Double
    var id: String { token }
}

enum CryptoMath {
    // MARK: CSV parsing

    static func parseLine(_ line: String) -> [String] {
        var fields: [String] = []
        var current = ""
        var inQuotes = false
        for char in line {
            if char == "\"" {
                inQuotes.toggle()
            } else if char == "," && !inQuotes {
                fields.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            } else {
                current.append(char)
            }
        }
        fields.append(current.trimmingCharacters(in: .whitespaces))
        return fields
    }

    static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "\"", with: "").trimmingCharacters(in: .whitespaces)
    }

    static func cleanNumber(_ s: String) -> Double? {
        let cleaned = clean(s)
        if cleaned.isEmpty || cleaned == "--" { return nil }
        return Double(
            cleaned
                .replacingOccurrences(of: ",", with: "")
                .replacingOccurrences(of: "%", with: "")
        )
    }

    /// Transaction History CSV:
    /// Date,Token,Type,Price (USD),Amount,Total value (USD),Fee,Fee Currency,Notes
    static func parseTransactions(_ csvText: String) -> [CryptoTransaction] {
        let lines = csvText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .newlines)
        guard lines.count >= 2 else { return [] }

        var transactions: [CryptoTransaction] = []
        for line in lines.dropFirst() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            let fields = parseLine(trimmed)
            guard fields.count >= 9 else { continue }
            transactions.append(CryptoTransaction(
                date: clean(fields[0]),
                token: clean(fields[1]),
                type: clean(fields[2]),
                priceUsd: cleanNumber(fields[3]),
                amount: cleanNumber(fields[4]) ?? 0,
                totalValueUsd: cleanNumber(fields[5]),
                notes: clean(fields[8])
            ))
        }
        return transactions
    }

    /// Portfolio Overview CSV parse (parsePortfolioOverview port). Rows live
    /// under an "Assets" section header:
    ///   "Name","Price","1h %","24h %","7d %","Holdings (USD)","Amount","Avg Buy","P/L","P/L %"
    static func parsePortfolioOverview(_ csvText: String) -> [CryptoCsvHolding] {
        let lines = csvText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .newlines)
        guard let assetsIndex = lines.firstIndex(where: {
            $0.trimmingCharacters(in: .whitespaces).lowercased() == "assets"
        }) else { return [] }

        var byToken: [String: CryptoCsvHolding] = [:]
        for line in lines.dropFirst(assetsIndex + 2) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            let fields = parseLine(trimmed)
            guard fields.count >= 10 else { continue }
            let name = clean(fields[0])
            guard !name.isEmpty,
                  let valueUsd = cleanNumber(fields[5]),
                  let amount = cleanNumber(fields[6]) else { continue }
            let avgBuy = cleanNumber(fields[7])
            let pnl = cleanNumber(fields[8])
            let cost = avgBuy.map { $0 * amount } ?? (pnl.map { valueUsd - $0 } ?? valueUsd)
            // Duplicate rows (same coin on two exchanges) merge, like the web.
            if let existing = byToken[name] {
                byToken[name] = CryptoCsvHolding(
                    token: name,
                    amount: existing.amount + amount,
                    valueUsd: existing.valueUsd + valueUsd,
                    costUsd: existing.costUsd + max(0, cost)
                )
            } else {
                byToken[name] = CryptoCsvHolding(
                    token: name, amount: amount, valueUsd: valueUsd, costUsd: max(0, cost)
                )
            }
        }
        return byToken.values.sorted { $0.valueUsd > $1.valueUsd }
    }

    /// Does this CSV look like the CoinStats Portfolio Overview export (as
    /// opposed to a transaction history)? Mirrors the web's detectFormat.
    static func isOverviewCsv(_ csvText: String) -> Bool {
        let head = csvText.prefix(200).lowercased()
        if head.contains("last updated") && head.contains("total value") { return true }
        return csvText.contains("\nAssets\n") || csvText.contains("\nAssets\r\n")
    }

    /// The portfolio slot accepts EITHER export: the overview (an "Assets"
    /// section) or a plain transaction history, which the web replays into
    /// holdings via computeHoldings — so the phone must too. (2026-08-21: a
    /// tx-format upload landed in crypto_csv_text and iOS showed zero crypto.)
    /// Tx-derived rows carry cost as their stored value — stables at the $1
    /// peg, coins at avg buy — and the live feeds reprice from there, exactly
    /// like the web.
    static func holdingsFromCsv(_ csvText: String) -> [CryptoCsvHolding] {
        if isOverviewCsv(csvText) { return parsePortfolioOverview(csvText) }
        let txs = parseTransactions(csvText)
        guard !txs.isEmpty else { return parsePortfolioOverview(csvText) }
        return computeHoldings(txs)
            .map {
                CryptoCsvHolding(
                    token: $0.token, amount: $0.amount,
                    valueUsd: $0.totalCostUsd, costUsd: $0.totalCostUsd
                )
            }
            .sorted { $0.valueUsd > $1.valueUsd }
    }

    // MARK: Stablecoin / cash classification (constants.ts + crypto-performance.ts)

    private static let stablecoins: Set<String> = [
        "USDC", "USDT", "USD1", "BUSD", "DAI", "TUSD", "FDUSD", "PYUSD",
    ]
    private static let yieldPrefixes = ["syrup", "aave", "compound", "venus", "morpho"]
    private static let stablecoinNames = [
        "tether", "usdt", "usdc", "busd", "dai", "tusd", "fdusd", "pyusd",
        "world liberty financial usd",
    ]
    private static let peggedExtras: Set<String> = ["USDE", "USDG", "GUSD", "SYRUPUSDC"]

    static func isStablecoin(_ name: String) -> Bool {
        let upper = name.uppercased()
        let lower = name.lowercased()
        // Yield-bearing wrappers contain "usdc" but are investments, not cash.
        if yieldPrefixes.contains(where: { lower.hasPrefix($0) }) { return false }
        if stablecoins.contains(upper) { return true }
        return stablecoinNames.contains { lower.contains($0) || upper == $0 }
    }

    static func isCashLike(_ token: String, tags: [String: Bool]) -> Bool {
        if tags[token] == true { return true }
        if peggedExtras.contains(token.uppercased()) { return true }
        return isStablecoin(token)
    }

    // MARK: Holdings (avg-buy replay, computeHoldings port)

    static func computeHoldings(_ transactions: [CryptoTransaction]) -> [CryptoHolding] {
        let sorted = transactions.sorted { $0.date < $1.date }

        struct State {
            var amount: Double = 0
            var boughtAmount: Double = 0
            var boughtCost: Double = 0
            var realized: Double = 0
        }
        var map: [String: State] = [:]

        for tx in sorted {
            var s = map[tx.token] ?? State()
            switch tx.type {
            case "buy", "transferIn":
                s.amount += tx.amount
                // Valueless transferIns move units only — pricing them at zero
                // would drag the average buy price down on every deposit.
                if let value = tx.totalValueUsd {
                    s.boughtAmount += tx.amount
                    s.boughtCost += value
                }
            case "sell", "transferOut":
                if let value = tx.totalValueUsd, s.boughtAmount > 0 {
                    let avgBuy = s.boughtCost / s.boughtAmount
                    s.realized += value - tx.amount * avgBuy
                }
                s.amount -= tx.amount
            default:
                break
            }
            map[tx.token] = s
        }

        var holdings: [CryptoHolding] = []
        for (token, s) in map {
            guard s.amount > 1e-9 else { continue }
            let stable = isStablecoin(token)
            let avgBuy = s.boughtAmount > 0 ? s.boughtCost / s.boughtAmount : 0
            holdings.append(CryptoHolding(
                token: token,
                amount: s.amount,
                // Stablecoins peg cost to amount ($1/unit) like the web does.
                totalCostUsd: stable ? s.amount : avgBuy * s.amount,
                realizedPnlUsd: stable ? 0 : s.realized
            ))
        }
        return holdings
    }

    // MARK: All-time realized (computeRealizedPnl port — sells AND transferOuts)

    struct RealizedByToken: Identifiable {
        let token: String
        let realizedPnlUsd: Double
        var id: String { token }
    }

    /// The crypto page's "All-Time Realized" card: avg-buy replay across every
    /// token ever traded — fully exited coins included — booking sell AND
    /// transferOut disposals against the running average. Broader on purpose
    /// than realizedSales() below, whose income feed must skip transfers.
    static func computeRealizedPnl(
        _ transactions: [CryptoTransaction]
    ) -> (total: Double, byToken: [RealizedByToken]) {
        let sorted = transactions.sorted { $0.date < $1.date }

        struct State {
            var boughtAmount: Double = 0
            var boughtCost: Double = 0
            var realized: Double = 0
        }
        var map: [String: State] = [:]

        for tx in sorted {
            var s = map[tx.token] ?? State()
            switch tx.type {
            case "buy", "transferIn":
                // Valueless transferIns move units only — pricing them at zero
                // would drag the average buy price down on every deposit.
                if let value = tx.totalValueUsd {
                    s.boughtAmount += tx.amount
                    s.boughtCost += value
                }
            case "sell", "transferOut":
                if let value = tx.totalValueUsd, s.boughtAmount > 0 {
                    s.realized += value - tx.amount * (s.boughtCost / s.boughtAmount)
                }
            default:
                break
            }
            map[tx.token] = s
        }

        var byToken: [RealizedByToken] = []
        var total: Double = 0
        for (token, s) in map {
            if isStablecoin(token) { continue }
            if abs(s.realized) < 0.01 { continue }
            byToken.append(RealizedByToken(token: token, realizedPnlUsd: s.realized))
            total += s.realized
        }
        byToken.sort { $0.realizedPnlUsd > $1.realizedPnlUsd }
        return (total, byToken)
    }

    // MARK: Realized sells (computeRealizedSales port — sells ONLY)

    /// Counts `sell` rows only. transferOut is yield / inter-exchange movement
    /// per crypto-performance.ts — booking it as income would double-count
    /// hand-logged Crypto Yield. Intentionally lower than the crypto page's
    /// "All-Time Realized" card, which includes transfers.
    static func realizedSales(_ transactions: [CryptoTransaction]) -> [RealizedSale] {
        let sorted = transactions.sorted { $0.date < $1.date }
        var cost: [String: (amount: Double, usd: Double)] = [:]
        var seenPerDay: [String: Int] = [:]
        var events: [RealizedSale] = []

        for tx in sorted {
            var s = cost[tx.token] ?? (0, 0)
            if tx.type == "buy" || tx.type == "transferIn" {
                if let value = tx.totalValueUsd {
                    s.amount += tx.amount
                    s.usd += value
                    cost[tx.token] = s
                }
                continue
            }
            guard tx.type == "sell" else { continue }
            guard let value = tx.totalValueUsd, s.amount > 0 else { continue }
            guard !isStablecoin(tx.token) else { continue }

            let realized = value - tx.amount * (s.usd / s.amount)
            guard abs(realized) >= 0.01 else { continue }

            let date = String(tx.date.prefix(10))
            let dayKey = "\(date)-\(tx.token)"
            let ordinal = seenPerDay[dayKey] ?? 0
            seenPerDay[dayKey] = ordinal + 1

            events.append(RealizedSale(
                id: "rp-crypto-\(dayKey)-\(ordinal)",
                source: "crypto",
                date: date,
                label: tx.token,
                ticker: tx.token,
                realized: realized,
                currency: "USD"
            ))
        }
        return events
    }
}
