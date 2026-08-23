package com.piyawatpm.vesta.data

import kotlin.math.abs

// Port of lib/utils/crypto-csv.ts — parser + avg-buy replay, matching ios
// CryptoMath.swift. The CSV has quoted thousands separators ("10,512.08");
// a naive split corrupts every number, which is why the quote-aware parser
// is ported verbatim.

data class CryptoTransaction(
    val date: String,
    val token: String,
    val type: String, // buy | sell | transferIn | transferOut
    val priceUsd: Double?,
    val amount: Double,
    val totalValueUsd: Double?,
    val notes: String,
)

data class CryptoHolding(
    val token: String,
    val amount: Double,
    val totalCostUsd: Double,
    val realizedPnlUsd: Double,
)

/**
 * One row of the exchange's Portfolio Overview CSV — the authoritative
 * holdings list. Earn/locked coins appear ONLY here, never in the tx CSV, and
 * the stored USD value keeps a token priced even when no live feed knows it.
 */
data class CryptoCsvHolding(
    val token: String,
    val amount: Double,
    val valueUsd: Double,
    val costUsd: Double,
)

data class RealizedSale(
    val id: String,
    val source: String, // "stocks" | "crypto"
    val date: String,
    val label: String,
    val ticker: String,
    val realized: Double,
    val currency: String,
)

object CryptoMath {
    // MARK: CSV parsing

    fun parseLine(line: String): List<String> {
        val fields = mutableListOf<String>()
        val current = StringBuilder()
        var inQuotes = false
        for (char in line) {
            when {
                char == '"' -> inQuotes = !inQuotes
                char == ',' && !inQuotes -> {
                    fields.add(current.toString().trim())
                    current.setLength(0)
                }
                else -> current.append(char)
            }
        }
        fields.add(current.toString().trim())
        return fields
    }

    fun clean(s: String): String = s.replace("\"", "").trim()

    fun cleanNumber(s: String): Double? {
        val cleaned = clean(s)
        if (cleaned.isEmpty() || cleaned == "--") return null
        return cleaned.replace(",", "").replace("%", "").toDoubleOrNull()
    }

    /**
     * Transaction History CSV:
     * Date,Token,Type,Price (USD),Amount,Total value (USD),Fee,Fee Currency,Notes
     */
    fun parseTransactions(csvText: String): List<CryptoTransaction> {
        val lines = csvText.trim().lines()
        if (lines.size < 2) return emptyList()

        val transactions = mutableListOf<CryptoTransaction>()
        for (line in lines.drop(1)) {
            val trimmed = line.trim()
            if (trimmed.isEmpty()) continue
            val fields = parseLine(trimmed)
            if (fields.size < 9) continue
            transactions.add(
                CryptoTransaction(
                    date = clean(fields[0]),
                    token = clean(fields[1]),
                    type = clean(fields[2]),
                    priceUsd = cleanNumber(fields[3]),
                    amount = cleanNumber(fields[4]) ?: 0.0,
                    totalValueUsd = cleanNumber(fields[5]),
                    notes = clean(fields[8]),
                )
            )
        }
        return transactions
    }

    /**
     * Portfolio Overview CSV parse (parsePortfolioOverview port). Rows live
     * under an "Assets" section header:
     *   "Name","Price","1h %","24h %","7d %","Holdings (USD)","Amount","Avg Buy","P/L","P/L %"
     */
    fun parsePortfolioOverview(csvText: String): List<CryptoCsvHolding> {
        val lines = csvText.trim().lines()
        val assetsIndex = lines.indexOfFirst { it.trim().lowercase() == "assets" }
        if (assetsIndex < 0) return emptyList()

        val byToken = LinkedHashMap<String, CryptoCsvHolding>()
        for (line in lines.drop(assetsIndex + 2)) {
            val trimmed = line.trim()
            if (trimmed.isEmpty()) continue
            val fields = parseLine(trimmed)
            if (fields.size < 10) continue
            val name = clean(fields[0])
            if (name.isEmpty()) continue
            val valueUsd = cleanNumber(fields[5]) ?: continue
            val amount = cleanNumber(fields[6]) ?: continue
            val avgBuy = cleanNumber(fields[7])
            val pnl = cleanNumber(fields[8])
            val cost = avgBuy?.let { it * amount } ?: (pnl?.let { valueUsd - it } ?: valueUsd)
            // Duplicate rows (same coin on two exchanges) merge, like the web.
            val existing = byToken[name]
            byToken[name] = if (existing != null) {
                CryptoCsvHolding(
                    token = name,
                    amount = existing.amount + amount,
                    valueUsd = existing.valueUsd + valueUsd,
                    costUsd = existing.costUsd + maxOf(0.0, cost),
                )
            } else {
                CryptoCsvHolding(name, amount, valueUsd, maxOf(0.0, cost))
            }
        }
        return byToken.values.sortedByDescending { it.valueUsd }
    }

    /** Does this CSV look like the CoinStats Portfolio Overview export (as
     *  opposed to a transaction history)? Mirrors the web's detectFormat. */
    fun isOverviewCsv(csvText: String): Boolean {
        val head = csvText.take(200).lowercase()
        if (head.contains("last updated") && head.contains("total value")) return true
        return csvText.contains("\nAssets\n") || csvText.contains("\nAssets\r\n")
    }

    /**
     * The portfolio slot accepts EITHER export: the overview (an "Assets"
     * section) or a plain transaction history, which the web replays into
     * holdings via computeHoldings — so the phone must too. Tx-derived rows
     * carry cost as their stored value — stables at the $1 peg, coins at avg
     * buy — and the live feeds reprice from there, exactly like the web.
     */
    fun holdingsFromCsv(csvText: String): List<CryptoCsvHolding> {
        if (isOverviewCsv(csvText)) return parsePortfolioOverview(csvText)
        val txs = parseTransactions(csvText)
        if (txs.isEmpty()) return parsePortfolioOverview(csvText)
        return computeHoldings(txs)
            .map { CryptoCsvHolding(it.token, it.amount, it.totalCostUsd, it.totalCostUsd) }
            .sortedByDescending { it.valueUsd }
    }

    // MARK: Stablecoin / cash classification (constants.ts + crypto-performance.ts)

    private val stablecoins = setOf(
        "USDC", "USDT", "USD1", "BUSD", "DAI", "TUSD", "FDUSD", "PYUSD",
    )
    private val yieldPrefixes = listOf("syrup", "aave", "compound", "venus", "morpho")
    private val stablecoinNames = listOf(
        "tether", "usdt", "usdc", "busd", "dai", "tusd", "fdusd", "pyusd",
        "world liberty financial usd",
    )
    private val peggedExtras = setOf("USDE", "USDG", "GUSD", "SYRUPUSDC")

    fun isStablecoin(name: String): Boolean {
        val upper = name.uppercase()
        val lower = name.lowercase()
        // Yield-bearing wrappers contain "usdc" but are investments, not cash.
        if (yieldPrefixes.any { lower.startsWith(it) }) return false
        if (upper in stablecoins) return true
        return stablecoinNames.any { lower.contains(it) || upper == it }
    }

    fun isCashLike(token: String, tags: Map<String, Boolean>): Boolean {
        if (tags[token] == true) return true
        if (token.uppercase() in peggedExtras) return true
        return isStablecoin(token)
    }

    // MARK: Holdings (avg-buy replay, computeHoldings port)

    fun computeHoldings(transactions: List<CryptoTransaction>): List<CryptoHolding> {
        val sorted = transactions.sortedBy { it.date }

        class State {
            var amount = 0.0
            var boughtAmount = 0.0
            var boughtCost = 0.0
            var realized = 0.0
        }

        val map = LinkedHashMap<String, State>()
        for (tx in sorted) {
            val s = map.getOrPut(tx.token) { State() }
            when (tx.type) {
                "buy", "transferIn" -> {
                    s.amount += tx.amount
                    // Valueless transferIns move units only — pricing them at
                    // zero would drag the average buy price down on every deposit.
                    val value = tx.totalValueUsd
                    if (value != null) {
                        s.boughtAmount += tx.amount
                        s.boughtCost += value
                    }
                }
                "sell", "transferOut" -> {
                    val value = tx.totalValueUsd
                    if (value != null && s.boughtAmount > 0) {
                        val avgBuy = s.boughtCost / s.boughtAmount
                        s.realized += value - tx.amount * avgBuy
                    }
                    s.amount -= tx.amount
                }
            }
        }

        val holdings = mutableListOf<CryptoHolding>()
        for ((token, s) in map) {
            if (s.amount <= 1e-9) continue
            val stable = isStablecoin(token)
            val avgBuy = if (s.boughtAmount > 0) s.boughtCost / s.boughtAmount else 0.0
            holdings.add(
                CryptoHolding(
                    token = token,
                    amount = s.amount,
                    // Stablecoins peg cost to amount ($1/unit) like the web does.
                    totalCostUsd = if (stable) s.amount else avgBuy * s.amount,
                    realizedPnlUsd = if (stable) 0.0 else s.realized,
                )
            )
        }
        return holdings
    }

    // MARK: All-time realized (computeRealizedPnl port — sells AND transferOuts)

    data class RealizedByToken(val token: String, val realizedPnlUsd: Double)

    /**
     * The crypto page's "All-Time Realized" card: avg-buy replay across every
     * token ever traded — fully exited coins included — booking sell AND
     * transferOut disposals against the running average. Broader on purpose
     * than realizedSales() below, whose income feed must skip transfers.
     */
    fun computeRealizedPnl(
        transactions: List<CryptoTransaction>,
    ): Pair<Double, List<RealizedByToken>> {
        val sorted = transactions.sortedBy { it.date }

        class State {
            var boughtAmount = 0.0
            var boughtCost = 0.0
            var realized = 0.0
        }

        val map = LinkedHashMap<String, State>()
        for (tx in sorted) {
            val s = map.getOrPut(tx.token) { State() }
            when (tx.type) {
                "buy", "transferIn" -> {
                    val value = tx.totalValueUsd
                    if (value != null) {
                        s.boughtAmount += tx.amount
                        s.boughtCost += value
                    }
                }
                "sell", "transferOut" -> {
                    val value = tx.totalValueUsd
                    if (value != null && s.boughtAmount > 0) {
                        s.realized += value - tx.amount * (s.boughtCost / s.boughtAmount)
                    }
                }
            }
        }

        val byToken = mutableListOf<RealizedByToken>()
        var total = 0.0
        for ((token, s) in map) {
            if (isStablecoin(token)) continue
            if (abs(s.realized) < 0.01) continue
            byToken.add(RealizedByToken(token, s.realized))
            total += s.realized
        }
        byToken.sortByDescending { it.realizedPnlUsd }
        return total to byToken
    }

    // MARK: Realized sells (computeRealizedSales port — sells ONLY)

    /**
     * Counts `sell` rows only. transferOut is yield / inter-exchange movement
     * per crypto-performance.ts — booking it as income would double-count
     * hand-logged Crypto Yield. Intentionally lower than the crypto page's
     * "All-Time Realized" card, which includes transfers.
     */
    fun realizedSales(transactions: List<CryptoTransaction>): List<RealizedSale> {
        val sorted = transactions.sortedBy { it.date }
        val cost = HashMap<String, Pair<Double, Double>>() // token -> (amount, usd)
        val seenPerDay = HashMap<String, Int>()
        val events = mutableListOf<RealizedSale>()

        for (tx in sorted) {
            var s = cost[tx.token] ?: (0.0 to 0.0)
            if (tx.type == "buy" || tx.type == "transferIn") {
                val value = tx.totalValueUsd
                if (value != null) {
                    s = (s.first + tx.amount) to (s.second + value)
                    cost[tx.token] = s
                }
                continue
            }
            if (tx.type != "sell") continue
            val value = tx.totalValueUsd ?: continue
            if (s.first <= 0) continue
            if (isStablecoin(tx.token)) continue

            val realized = value - tx.amount * (s.second / s.first)
            if (abs(realized) < 0.01) continue

            val date = tx.date.take(10)
            val dayKey = "$date-${tx.token}"
            val ordinal = seenPerDay[dayKey] ?: 0
            seenPerDay[dayKey] = ordinal + 1

            events.add(
                RealizedSale(
                    id = "rp-crypto-$dayKey-$ordinal",
                    source = "crypto",
                    date = date,
                    label = tx.token,
                    ticker = tx.token,
                    realized = realized,
                    currency = "USD",
                )
            )
        }
        return events
    }
}

// MARK: - PortfolioMath (port of lib/utils/portfolio-transactions.ts)

data class DerivedPosition(
    var units: Double = 0.0,
    var costBasis: Double = 0.0,
    var realizedPnl: Double = 0.0,
    var totalBought: Double = 0.0,
    var totalSold: Double = 0.0,
)

object PortfolioMath {
    /** Average-cost replay. Realized on a sell = proceeds − avgCost × sold;
     *  oversells are clamped so a stray log row can't invent a cost basis. */
    fun derivePosition(
        transactions: List<PortfolioTransaction>,
        onSale: ((PortfolioTransaction, Double) -> Unit)? = null,
    ): DerivedPosition {
        val sorted = transactions.sortedWith(
            compareBy({ it.date }, { it.createdAt })
        )
        val p = DerivedPosition()
        for (tx in sorted) {
            if (tx.type == "buy") {
                p.units += tx.units
                p.costBasis += tx.totalAmount
                p.totalBought += tx.units
            } else {
                val soldUnits = if (p.units > 0) minOf(tx.units, p.units) else 0.0
                val avgCost = if (p.units > 0) p.costBasis / p.units else 0.0
                val costOfSold = avgCost * soldUnits
                val gain = tx.totalAmount - costOfSold
                p.realizedPnl += gain
                p.costBasis = maxOf(0.0, p.costBasis - costOfSold)
                p.units -= tx.units
                p.totalSold += tx.units
                onSale?.invoke(tx, gain)
            }
        }
        if (abs(p.units) < 1e-9) p.units = 0.0
        if (p.costBasis < 1e-9) p.costBasis = 0.0
        return p
    }

    /** One realized event per sell, per holding, in the holding's own quote
     *  currency — feeds the income page's derived rows. */
    fun realizedSales(
        transactions: List<PortfolioTransaction>,
        tickerFor: (String) -> String?,
    ): List<RealizedSale> {
        val byHolding = transactions.groupBy { it.holdingId }

        val events = mutableListOf<RealizedSale>()
        for ((holdingId, group) in byHolding) {
            val currency = group.minWithOrNull(
                compareBy({ it.date }, { it.createdAt })
            )?.currency ?: "AUD"
            derivePosition(group) { tx, realized ->
                if (abs(realized) < 0.01) return@derivePosition
                events.add(
                    RealizedSale(
                        id = "rp-stocks-${tx.id}",
                        source = "stocks",
                        date = tx.date,
                        label = tx.holdingName,
                        ticker = tickerFor(holdingId) ?: tx.holdingName,
                        realized = realized,
                        currency = currency,
                    )
                )
            }
        }
        return events
    }
}
