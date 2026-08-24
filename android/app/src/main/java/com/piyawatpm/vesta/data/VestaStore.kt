package com.piyawatpm.vesta.data

import android.content.Context
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SnapshotDate
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.core.monthLabel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File
import java.time.Instant
import kotlin.math.abs

/**
 * Everything needed to boot offline, snapshotted to one file after each
 * successful refresh. Blobs stay raw strings so the cache can't drift from
 * the decode logic — decode always runs the same path, cache or network.
 * Port of ios DiskCache (DataStore.swift).
 */
@Serializable
data class DiskCache(
    val version: Int,
    val blobs: Map<String, String>,
    val networthHistory: List<SnapshotPoint>,
    val portfolioHistory: List<SnapshotPoint>,
    val cryptoHistory: List<SnapshotPoint>,
    val fxRates: Map<String, Double>,
    val livePrices: Map<String, Double>,
    val savedAt: Double,
    /** updated_at watermark for delta blob fetches (null → full fetch). */
    val blobsSyncedAt: String? = null,
) {
    companion object {
        /** Bump when the cache's SEMANTICS change, not just its shape —
         *  history merges are append-only, so rows deleted server-side
         *  linger until a version bump forces a clean refetch. Matches the
         *  iOS numbering so the two caches share one changelog. */
        const val CURRENT_VERSION = 6

        fun fileFor(context: Context): File = File(context.filesDir, "vesta-cache.json")

        fun load(context: Context): DiskCache? = try {
            val cache = VestaJson.decodeFromString<DiskCache>(fileFor(context).readText())
            if (cache.version == CURRENT_VERSION) cache else null
        } catch (_: Exception) {
            null
        }
    }

    fun save(context: Context) {
        try {
            val tmp = File(context.filesDir, "vesta-cache.json.tmp")
            tmp.writeText(VestaJson.encodeToString(this))
            tmp.renameTo(fileFor(context))
        } catch (_: Exception) {
        }
    }
}

/** A dated USD reading, ms epoch — the parsed row shape every chart consumes. */
data class ParsedPoint(val date: Long, val valueUsd: Double)

data class MonthlyGrowthEntry(
    val key: String,
    val label: String,
    val deltaUsd: Double,
    val partial: Boolean,
)

data class CryptoDisplayRow(
    val token: String,
    val amount: Double,
    val valueUsd: Double,
    val costUsd: Double,
    val isCash: Boolean,
    val isLive: Boolean,
) {
    val pnlUsd: Double get() = valueUsd - costUsd
}

/**
 * The app's single source of truth, mirroring the web's DataProvider and the
 * iOS DataStore: load every KV blob once, decode, expose typed collections;
 * writes re-encode the whole array back to its blob (the same convention the
 * web app uses, so the clients can't corrupt each other's shape).
 */
@Stable
class VestaStore(private val context: Context) {

    val api = SupabaseApi(context)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // MARK: State

    var isSignedIn by mutableStateOf(false)
    var isLoading by mutableStateOf(false)
    var loadError by mutableStateOf<String?>(null)
    var needsManualSignIn by mutableStateOf(false)

    /** Drives the Invest toolbar spinner while Hostplus prices are fetched. */
    var isRefreshingHostplus by mutableStateOf(false)

    /** Unix seconds of the last successful network refresh (0 = never). */
    var lastRefreshed by mutableStateOf(0.0)

    var income by mutableStateOf<List<IncomeEntry>>(emptyList())
        private set
    var expenses by mutableStateOf<List<ExpenseEntry>>(emptyList())
        private set
    var holdings by mutableStateOf<List<PortfolioHolding>>(emptyList())
        private set
    var portfolioTxs by mutableStateOf<List<PortfolioTransaction>>(emptyList())
        private set
    var debts by mutableStateOf<List<DebtRecord>>(emptyList())
        private set
    var debtTxs by mutableStateOf<List<DebtTransaction>>(emptyList())
        private set
    var customIncomeCategories by mutableStateOf<List<CustomCategory>>(emptyList())
        private set
    var customExpenseCategories by mutableStateOf<List<CustomCategory>>(emptyList())
        private set
    var cryptoTxs by mutableStateOf<List<CryptoTransaction>>(emptyList())
        private set
    var cryptoCsvHoldings by mutableStateOf<List<CryptoCsvHolding>>(emptyList())
        private set
    var cryptoPrices by mutableStateOf<Map<String, Double>>(emptyMap())
        private set
    var livePrices by mutableStateOf<Map<String, Double>>(emptyMap())
        private set
    var tickerMappings by mutableStateOf<Map<String, String>>(emptyMap())
        private set
    var stablecoinTags by mutableStateOf<Map<String, Boolean>>(emptyMap())
        private set

    /** token → exchange name, hand-set on the web crypto page. */
    var exchangeOverrides by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    /** The web's Dry Powder definition — cash-TAGGED tokens (the user's list
     *  includes BTC on purpose). Never re-infer this from stablecoin-ness. */
    var cryptoCashTags by mutableStateOf<Map<String, Boolean>>(emptyMap())
        private set

    /** Earn events the user manually removed — synced via app_data so they
     *  survive CSV re-uploads and reinstalls. */
    var earnExclusions by mutableStateOf<Set<String>>(emptySet())
        private set

    /** Option code → (yyyy-MM-dd → unit price), accumulated by the cron. */
    var hostplusPriceHistory by mutableStateOf<Map<String, Map<String, Double>>>(emptyMap())
        private set
    var goals by mutableStateOf<List<NetworthGoal>>(emptyList())
        private set
    var portfolioGroups by mutableStateOf<List<PortfolioGroup>>(emptyList())
        private set
    var forecastAssumptions by mutableStateOf(ForecastAssumptions.default)
        private set

    /** display-name → CoinGecko image URL (maintained by the web app). */
    var coinImages by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    /** ticker → Finnhub logo URL. */
    var stockLogos by mutableStateOf<Map<String, String>>(emptyMap())
        private set
    var recurringIncome by mutableStateOf<List<RecurringTemplate>>(emptyList())
        private set
    var recurringExpenses by mutableStateOf<List<RecurringTemplate>>(emptyList())
        private set
    var realizedIncomeEnabled by mutableStateOf(true)
        private set
    var displayCurrency by mutableStateOf("AUD")
        private set
    var fxLoaded by mutableStateOf(false)

    /** Raw INTRADAY snapshots (USD), full history, ascending. */
    var networthHistory by mutableStateOf<List<SnapshotPoint>>(emptyList())
        private set
    var portfolioHistory by mutableStateOf<List<SnapshotPoint>>(emptyList())
        private set
    var cryptoHistory by mutableStateOf<List<SnapshotPoint>>(emptyList())
        private set

    /** Same rows with dates parsed once — string→Date parses per chart
     *  render would jank the scrubber. */
    var networthParsed by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set
    var networthParsedNoSuper by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set
    var overlayPortfolio by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set
    var overlaySuperDelta by mutableStateOf<Map<Long, Double>>(emptyMap())
        private set
    var overlayCrypto by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set
    var overlayDebt by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set
    var portfolioParsed by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set
    var portfolioParsedWithSuper by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set
    var cryptoParsed by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set

    /** Live trade prices from the Alpaca socket, ticker → USD. */
    var liveStockPrices by mutableStateOf<Map<String, Double>>(emptyMap())
        private set

    /** FX epoch — bumped when rates land so derived values recompose. */
    var fxEpoch by mutableStateOf(0)
        private set

    var includeSuperStocks by mutableStateOf(Settings.includeSuperStocks)
        private set

    fun setIncludeSuper(value: Boolean) {
        includeSuperStocks = value
        Settings.includeSuperStocks = value
        recomputeDerived()
    }

    private val sockets = PriceSocketCenter()

    // MARK: Cached derivations — pure functions of the stored data, computed
    // once per data change instead of per render (see ios DataStore).

    var derivedRealizedIncome by mutableStateOf<List<IncomeEntry>>(emptyList())
        private set
    var allIncome by mutableStateOf<List<IncomeEntry>>(emptyList())
        private set
    var monthlyGrowth by mutableStateOf<List<MonthlyGrowthEntry>>(emptyList())
        private set
    var cryptoExternalEvents by mutableStateOf<List<CryptoSplit.ExternalFlowEvent>>(emptyList())
        private set
    var freedomPassive by mutableStateOf(0.0)
        private set
    var freedomExpenses by mutableStateOf(0.0)
        private set
    var freedomCoverage by mutableStateOf(0.0)
        private set

    /** Stocks overlay with the super delta already removed when the toggle is off. */
    var overlayStocksAdjusted by mutableStateOf<List<ParsedPoint>>(emptyList())
        private set

    fun recomputeDerived() {
        derivedRealizedIncome = computeDerivedRealizedIncome()
        allIncome = income + derivedRealizedIncome
        monthlyGrowth = computeMonthlyGrowth()
        cryptoExternalEvents = CryptoSplit.externalFlowEvents(cryptoTxs, stablecoinTags)
        computeFreedom()
        overlayStocksAdjusted = overlayPortfolio.map { point ->
            val delta = overlaySuperDelta[point.date]
            if (!includeSuperStocks && delta != null) {
                ParsedPoint(point.date, maxOf(0.0, point.valueUsd - delta))
            } else {
                point
            }
        }
    }

    // MARK: Price-tick coalescing — feeds push far faster than a screen
    // needs to update; buffer and flush a few times a second instead.

    private val pendingCrypto = HashMap<String, Double>()
    private val pendingStocks = HashMap<String, Double>()
    private var flushJob: Job? = null

    private fun queueCrypto(token: String, price: Double) {
        synchronized(pendingCrypto) { pendingCrypto[token] = price }
        schedulePriceFlush()
    }

    private fun queueStock(ticker: String, price: Double) {
        synchronized(pendingStocks) { pendingStocks[ticker] = price }
        schedulePriceFlush()
    }

    private fun schedulePriceFlush() {
        if (flushJob != null) return
        flushJob = scope.launch {
            delay(400)
            flushJob = null
            val cryptoBatch = synchronized(pendingCrypto) {
                if (pendingCrypto.isEmpty()) null
                else HashMap(pendingCrypto).also { pendingCrypto.clear() }
            }
            val stockBatch = synchronized(pendingStocks) {
                if (pendingStocks.isEmpty()) null
                else HashMap(pendingStocks).also { pendingStocks.clear() }
            }
            cryptoBatch?.let { livePrices = livePrices + it }
            stockBatch?.let { liveStockPrices = liveStockPrices + it }
        }
    }

    companion object {
        fun parseRows(rows: List<SnapshotPoint>, withSuper: Boolean = false): List<ParsedPoint> =
            rows.mapNotNull { row ->
                val date = SnapshotDate.parse(row.date) ?: return@mapNotNull null
                ParsedPoint(date, if (withSuper) (row.valueWithSuper ?: row.value) else row.value)
            }

        fun parseRowsNoSuper(rows: List<SnapshotPoint>): List<ParsedPoint> =
            rows.mapNotNull { row ->
                val date = SnapshotDate.parse(row.date) ?: return@mapNotNull null
                ParsedPoint(date, row.valueNoSuper ?: row.value)
            }
    }

    private fun setHistory(type: String, rows: List<SnapshotPoint>) {
        when (type) {
            "portfolio" -> {
                portfolioHistory = rows
                portfolioParsed = parseRows(rows)
                portfolioParsedWithSuper = parseRows(rows, withSuper = true)
            }
            "crypto" -> {
                cryptoHistory = rows
                cryptoParsed = parseRows(rows)
            }
            else -> {
                networthHistory = rows
                networthParsed = parseRows(rows)
                networthParsedNoSuper = parseRowsNoSuper(rows)
                rebuildOverlays()
            }
        }
    }

    /**
     * Component series at the SAME INTRADAY resolution as the net-worth
     * series, so every line shares timestamps and buckets identically. Debt
     * only moves on logged transactions, so its daily replay is forward-
     * filled onto each row.
     */
    private fun rebuildOverlays() {
        val createdDays = debts.map { sydneyDayOf(it.createdAt) }

        // Replay debt once per distinct day, not once per intraday row.
        val debtByDay = HashMap<String, Double>()
        for (row in networthHistory) {
            val day = row.date.take(10)
            if (day !in debtByDay) {
                debtByDay[day] = debtNetUsdAt(day, createdDays)
            }
        }

        val portfolio = mutableListOf<ParsedPoint>()
        val crypto = mutableListOf<ParsedPoint>()
        val debt = mutableListOf<ParsedPoint>()
        val superDelta = HashMap<Long, Double>()

        for (row in networthHistory) {
            val date = SnapshotDate.parse(row.date) ?: continue
            row.portfolio?.let { portfolio.add(ParsedPoint(date, it)) }
            row.crypto?.let { crypto.add(ParsedPoint(date, it)) }
            row.valueNoSuper?.let { superDelta[date] = row.value - it }
            debtByDay[row.date.take(10)]?.let { debt.add(ParsedPoint(date, it)) }
        }

        overlayPortfolio = portfolio
        overlayCrypto = crypto
        overlayDebt = debt
        overlaySuperDelta = superDelta
    }

    private fun sydneyDayOf(ms: Double): String =
        SydneyTime.dayString(Instant.ofEpochMilli(ms.toLong()))

    /** Signed net debt (USD) as it stood at end of `day` — records created by
     *  then, transactions dated by then. Overpaid ledgers flip sides. */
    private fun debtNetUsdAt(day: String, createdDays: List<String>): Double {
        var net = 0.0
        for ((debt, createdDay) in debts.zip(createdDays)) {
            if (createdDay > day) continue
            val paid = debtTxs
                .filter { it.debtId == debt.id && it.date.take(10) <= day }
                .sumOf { it.amount }
            val balance = debt.originalAmount - paid
            val signed = if (debt.direction == "owed_to_me") balance else -balance
            net += Money.convert(signed, debt.currency, "USD")
        }
        return net
    }

    private fun history(type: String): List<SnapshotPoint> = when (type) {
        "portfolio" -> portfolioHistory
        "crypto" -> cryptoHistory
        else -> networthHistory
    }

    /** Incremental merge: fetch rows newer than the cached max, append. */
    private suspend fun mergeHistory(type: String) {
        val current = history(type)
        val fresh = try {
            api.fetchSnapshotsRaw(type, since = current.lastOrNull()?.date)
        } catch (_: Exception) {
            return
        }
        if (fresh.isEmpty()) return
        val known = current.mapTo(HashSet()) { it.date }
        val merged = (current + fresh.filter { it.date !in known }).sortedBy { it.date }
        setHistory(type, merged)
    }

    /** Raw blobs from the last load — kept so cache saves exactly what came in. */
    private var rawBlobs = HashMap<String, String>()
    private var blobsSyncedAt: String? = null

    /** Coalesces overlapping refresh triggers into one network pass. */
    private var refreshInFlight = false

    // MARK: Session

    suspend fun bootstrap() {
        // 1. Paint from the disk cache — file read + JSON decode + date
        //    parsing off the main thread; the main thread only assigns.
        val prepared = withContext(Dispatchers.Default) {
            DiskCache.load(context)?.let { cache ->
                BootPayload(
                    cache = cache,
                    networthParsed = parseRows(cache.networthHistory),
                    networthParsedNoSuper = parseRowsNoSuper(cache.networthHistory),
                    portfolioParsed = parseRows(cache.portfolioHistory),
                    portfolioParsedWithSuper = parseRows(cache.portfolioHistory, withSuper = true),
                    cryptoParsed = parseRows(cache.cryptoHistory),
                )
            }
        }
        if (prepared != null) {
            // Blob decode + overlays + derived sums stay off the main thread
            // too — snapshot state writes are thread-safe.
            withContext(Dispatchers.Default) {
                val p = prepared
                rawBlobs = HashMap(p.cache.blobs)
                blobsSyncedAt = p.cache.blobsSyncedAt
                if (p.cache.fxRates.isNotEmpty()) {
                    Money.rates = p.cache.fxRates
                    fxLoaded = true
                    fxEpoch += 1
                }
                livePrices = p.cache.livePrices
                lastRefreshed = p.cache.savedAt
                // decode FIRST: rebuildOverlays needs `debts`/`debtTxs`.
                decode(p.cache.blobs)
                networthHistory = p.cache.networthHistory
                networthParsed = p.networthParsed
                networthParsedNoSuper = p.networthParsedNoSuper
                portfolioHistory = p.cache.portfolioHistory
                portfolioParsed = p.portfolioParsed
                portfolioParsedWithSuper = p.portfolioParsedWithSuper
                cryptoHistory = p.cache.cryptoHistory
                cryptoParsed = p.cryptoParsed
                rebuildOverlays()
                recomputeDerived()
            }
        }

        // 2. Session: disk restore, else silent owner sign-in. The login
        //    screen only exists as a fallback for a changed password.
        if (api.restoreSession()) {
            isSignedIn = true
        } else {
            try {
                api.signIn(SupabaseConfig.OWNER_EMAIL, SupabaseConfig.OWNER_PASSWORD)
                isSignedIn = true
            } catch (_: Exception) {
                needsManualSignIn = true
                return
            }
        }

        // 3. Fresh data behind the cached paint.
        refresh()
    }

    private data class BootPayload(
        val cache: DiskCache,
        val networthParsed: List<ParsedPoint>,
        val networthParsedNoSuper: List<ParsedPoint>,
        val portfolioParsed: List<ParsedPoint>,
        val portfolioParsedWithSuper: List<ParsedPoint>,
        val cryptoParsed: List<ParsedPoint>,
    )

    suspend fun signIn(email: String, password: String) {
        api.signIn(email, password)
        isSignedIn = true
        needsManualSignIn = false
        refresh()
    }

    fun signOut() {
        api.signOut()
        isSignedIn = false
        needsManualSignIn = true
    }

    // MARK: Load / refresh

    /** Refresh only when the data is older than `maxAgeSeconds` — the
     *  "update regularly, not all the time" policy. */
    suspend fun refreshIfStale(maxAgeSeconds: Double) {
        if (System.currentTimeMillis() / 1000.0 - lastRefreshed <= maxAgeSeconds) return
        refresh()
    }

    suspend fun refresh() {
        if (!isSignedIn || refreshInFlight) return
        refreshInFlight = true
        try {
            isLoading = rawBlobs.isEmpty() // skeletons only when there's no cache
            loadError = null
            // The whole fetch+decode pass runs off the main thread — Compose
            // snapshot state is safe to write from any thread, and the 6MB
            // blob decode on main was the exact jank the iOS boot fixed.
            withContext(Dispatchers.Default) {
            try {
                // Delta fetch: only blobs whose updated_at moved since last sync.
                val (changed, stamp) = api.fetchAppData(since = blobsSyncedAt)
                blobsSyncedAt = stamp
                if (changed.isNotEmpty()) {
                    rawBlobs.putAll(changed)
                    decode(HashMap(rawBlobs))
                    rebuildOverlays()
                }

                try {
                    val rates = api.fetchFxRates()
                    if (rates.isNotEmpty()) {
                        Money.rates = rates
                        fxLoaded = true
                        fxEpoch += 1
                    }
                } catch (_: Exception) {
                }

                // First load pulls each pot's whole snapshot history (~20
                // pages); afterwards only rows newer than what's cached.
                mergeHistory("networth")
                mergeHistory("portfolio")
                mergeHistory("crypto")
                recomputeDerived()

                // Live prices for whatever the holdings CSV says we own.
                val tokens = cryptoCsvHoldings
                    .filter { !CryptoMath.isCashLike(it.token, stablecoinTags) }
                    .map { it.token }
                val live = api.fetchBinancePrices(tokens, tickerMappings)
                if (live.isNotEmpty()) livePrices = live

                // Symbol set may have changed — resubscribe.
                startLive()

                lastRefreshed = System.currentTimeMillis() / 1000.0
                val cacheSnapshot = DiskCache(
                    version = DiskCache.CURRENT_VERSION,
                    blobs = HashMap(rawBlobs),
                    networthHistory = networthHistory,
                    portfolioHistory = portfolioHistory,
                    cryptoHistory = cryptoHistory,
                    fxRates = Money.rates,
                    livePrices = livePrices,
                    savedAt = lastRefreshed,
                    blobsSyncedAt = blobsSyncedAt,
                )
                scope.launch(Dispatchers.IO) { cacheSnapshot.save(context) }
            } catch (e: Exception) {
                loadError = e.message
            }
            }
            isLoading = false
        } finally {
            refreshInFlight = false
        }
    }

    /**
     * Manually pull the latest Hostplus super unit price and reprice the
     * holding as units × price. The daily cron does this automatically; this
     * is the on-demand button.
     */
    suspend fun refreshHostplus() {
        if (!isSignedIn || isRefreshingHostplus) return
        val targets = holdings.withIndex().filter { (_, h) ->
            HostplusApi.optionNameByTicker[h.ticker.uppercase()] != null && h.units > 0
        }
        if (targets.isEmpty()) return

        isRefreshingHostplus = true
        try {
            val prices = HostplusApi.latestPrices()
            var changed = false
            val updated = holdings.toMutableList()
            for ((idx, holding) in targets) {
                val name = HostplusApi.optionNameByTicker[holding.ticker.uppercase()] ?: continue
                val price = prices[name] ?: continue
                if (price <= 0) continue
                val (units, currentValue) = HostplusApi.reprice(
                    holding.units, holding.currentValue, price
                )
                if (abs(currentValue - holding.currentValue) > 0.01 ||
                    abs(units - holding.units) > 1e-6
                ) {
                    updated[idx] = holding.copy(
                        units = units, currentValue = currentValue, currency = "AUD"
                    )
                    changed = true
                }
            }
            if (!changed) return
            holdings = updated
            val value = VestaJson.encodeToString(updated.toList())
            api.writeAppData("portfolio_holdings", value)
            rawBlobs["portfolio_holdings"] = value
            recomputeDerived()
        } catch (e: Exception) {
            loadError = e.message
        } finally {
            isRefreshingHostplus = false
        }
    }

    private var decodeSource: Map<String, String> = emptyMap()

    /** One blob decoded leniently; kept as one path so cache and network
     *  can't drift. */
    private inline fun <reified T> blob(key: String): T? {
        val text = decodeSource[key] ?: return null
        return try {
            VestaJson.decodeFromString<T>(text)
        } catch (_: Exception) {
            null
        }
    }

    private fun decode(blobs: Map<String, String>) {
        decodeSource = blobs

        income = blob<List<IncomeEntry>>("income_entries") ?: emptyList()
        expenses = blob<List<ExpenseEntry>>("expense_entries") ?: emptyList()
        holdings = blob<List<PortfolioHolding>>("portfolio_holdings") ?: emptyList()
        portfolioTxs = blob<List<PortfolioTransaction>>("portfolio_transactions") ?: emptyList()
        debts = blob<List<DebtRecord>>("debt_records") ?: emptyList()
        debtTxs = blob<List<DebtTransaction>>("debt_transactions") ?: emptyList()
        customIncomeCategories = blob<List<CustomCategory>>("custom_income_categories") ?: emptyList()
        customExpenseCategories = blob<List<CustomCategory>>("custom_expense_categories") ?: emptyList()
        cryptoPrices = blob<CryptoPricesBlob>("crypto_prices")?.prices ?: emptyMap()
        tickerMappings = blob<Map<String, String>>("crypto_ticker_mappings") ?: emptyMap()
        stablecoinTags = blob<Map<String, Boolean>>("crypto_stablecoin_tags") ?: emptyMap()
        exchangeOverrides = blob<Map<String, String>>("crypto_exchange_overrides") ?: emptyMap()
        cryptoCashTags = blob<Map<String, Boolean>>("crypto_cash_tags") ?: emptyMap()
        earnExclusions = (blob<List<String>>("earn_exclusions") ?: emptyList()).toSet()
        hostplusPriceHistory =
            blob<Map<String, Map<String, Double>>>("hostplus_price_history") ?: emptyMap()
        goals = blob<List<NetworthGoal>>("networth_goals") ?: emptyList()
        portfolioGroups = blob<List<PortfolioGroup>>("portfolio_groups") ?: emptyList()
        forecastAssumptions =
            blob<ForecastAssumptions>("forecast_assumptions") ?: ForecastAssumptions.default
        coinImages = blob<Map<String, String>>("crypto_coin_images") ?: emptyMap()
        stockLogos = blob<Map<String, String>>("portfolio_stock_logos") ?: emptyMap()
        recurringIncome = blob<List<RecurringTemplate>>("recurring_income_templates") ?: emptyList()
        recurringExpenses = blob<List<RecurringTemplate>>("recurring_expense_templates") ?: emptyList()
        realizedIncomeEnabled = blob<Boolean>("realized_income_enabled") ?: true
        displayCurrency = blob<String>("preferred_currency") ?: "AUD"

        // Both CSVs are raw string blobs, not JSON-of-array.
        val txCsv = blob<String>("crypto_tx_csv_text")
        cryptoTxs = if (!txCsv.isNullOrEmpty()) CryptoMath.parseTransactions(txCsv) else emptyList()

        val holdingsCsv = blob<String>("crypto_csv_text")
        if (!holdingsCsv.isNullOrEmpty()) {
            cryptoCsvHoldings = CryptoMath.holdingsFromCsv(holdingsCsv)
            // The two slots carry the same ledger uploaded at different
            // times. When the portfolio slot holds the FRESHER transaction
            // file (more rows), realized/earn/splits replay that one instead.
            if (!CryptoMath.isOverviewCsv(holdingsCsv)) {
                val alt = CryptoMath.parseTransactions(holdingsCsv)
                if (alt.size > cryptoTxs.size) cryptoTxs = alt
            }
        } else {
            cryptoCsvHoldings = emptyList()
        }
    }

    // MARK: Writes (whole-blob, like the web)

    private suspend fun persistJson(key: String, json: String) {
        api.writeAppData(key, json)
        rawBlobs[key] = json
    }

    suspend fun saveIncome(entry: IncomeEntry) {
        income = income.filter { it.id != entry.id } + entry
        recomputeDerived()
        persistJson("income_entries", VestaJson.encodeToString(income))
    }

    suspend fun deleteIncome(id: String) {
        income = income.filter { it.id != id }
        recomputeDerived()
        persistJson("income_entries", VestaJson.encodeToString(income))
    }

    suspend fun saveExpense(entry: ExpenseEntry) {
        expenses = expenses.filter { it.id != entry.id } + entry
        recomputeDerived()
        persistJson("expense_entries", VestaJson.encodeToString(expenses))
    }

    suspend fun deleteExpense(id: String) {
        expenses = expenses.filter { it.id != id }
        recomputeDerived()
        persistJson("expense_entries", VestaJson.encodeToString(expenses))
    }

    suspend fun savePortfolioTx(tx: PortfolioTransaction) {
        val before = PortfolioMath.derivePosition(
            portfolioTxs.filter { it.holdingId == tx.holdingId }
        )
        portfolioTxs = portfolioTxs + tx

        // Reconcile the holding exactly like the web page does: units and
        // cost move by the replay delta, keeping any baseline the log doesn't
        // explain, and value rescales at the last-known price per unit.
        val index = holdings.indexOfFirst { it.id == tx.holdingId }
        if (index >= 0) {
            val after = PortfolioMath.derivePosition(
                portfolioTxs.filter { it.holdingId == tx.holdingId }
            )
            val holding = holdings[index]
            val baseUnits = holding.units - before.units
            val baseCost = holding.amountInvested - before.costBasis
            val pricePerUnit =
                if (holding.units > 1e-9) holding.currentValue / holding.units else 0.0

            var units = baseUnits + after.units
            var amountInvested = baseCost + after.costBasis
            if (abs(units) < 1e-9) units = 0.0
            if (amountInvested < 1e-9) amountInvested = 0.0

            val newValue = when {
                units == 0.0 -> 0.0
                pricePerUnit > 0 -> pricePerUnit * units
                else -> holding.currentValue
            }
            holdings = holdings.toMutableList().also {
                it[index] = holding.copy(
                    units = units,
                    amountInvested = amountInvested,
                    currentValue = newValue,
                )
            }
            persistJson("portfolio_holdings", VestaJson.encodeToString(holdings))
        }

        recomputeDerived()
        persistJson("portfolio_transactions", VestaJson.encodeToString(portfolioTxs))
    }

    /** Flip one crypto token in/out of the dry-powder set (crypto_cash_tags). */
    suspend fun setCryptoCash(token: String, isCash: Boolean) {
        cryptoCashTags = cryptoCashTags + (token to isCash)
        try {
            persistJson("crypto_cash_tags", VestaJson.encodeToString(cryptoCashTags))
        } catch (e: Exception) {
            loadError = e.message
        }
    }

    /** Flip a holding's cash flag and persist the holdings blob. */
    suspend fun setHoldingCash(holdingId: String, isCash: Boolean) {
        val index = holdings.indexOfFirst { it.id == holdingId }
        if (index < 0) return
        holdings = holdings.toMutableList().also {
            it[index] = it[index].copy(isCash = isCash)
        }
        try {
            persistJson("portfolio_holdings", VestaJson.encodeToString(holdings))
        } catch (e: Exception) {
            loadError = e.message
        }
    }

    /** Replace the group list and persist — small blob, whole-list writes. */
    suspend fun savePortfolioGroups(groups: List<PortfolioGroup>) {
        portfolioGroups = groups
        try {
            persistJson("portfolio_groups", VestaJson.encodeToString(groups))
        } catch (e: Exception) {
            loadError = e.message
        }
    }

    /** Upsert a net-worth goal — same blob the web's GoalSection edits. */
    suspend fun saveGoal(goal: NetworthGoal) {
        goals = goals.filter { it.id != goal.id } + goal
        persistJson("networth_goals", VestaJson.encodeToString(goals))
    }

    /** Forecast levers; local flip first so the page answers instantly. */
    suspend fun saveForecastAssumptions(next: ForecastAssumptions) {
        forecastAssumptions = next
        try {
            persistJson("forecast_assumptions", VestaJson.encodeToString(next))
        } catch (e: Exception) {
            loadError = e.message
        }
    }

    /** Flip one earn event in or out of the excluded set and persist. */
    suspend fun setEarnExcluded(key: String, excluded: Boolean) {
        earnExclusions = if (excluded) earnExclusions + key else earnExclusions - key
        try {
            persistJson("earn_exclusions", VestaJson.encodeToString(earnExclusions.sorted()))
        } catch (e: Exception) {
            loadError = e.message
        }
    }

    suspend fun saveDebt(debt: DebtRecord) {
        debts = debts.filter { it.id != debt.id } + debt
        recomputeDerived()
        persistJson("debt_records", VestaJson.encodeToString(debts))
    }

    /** Removes the record AND its ledger — orphan transactions would
     *  silently distort net worth forever. */
    suspend fun deleteDebt(id: String) {
        debts = debts.filter { it.id != id }
        debtTxs = debtTxs.filter { it.debtId != id }
        recomputeDerived()
        persistJson("debt_records", VestaJson.encodeToString(debts))
        persistJson("debt_transactions", VestaJson.encodeToString(debtTxs))
    }

    suspend fun saveDebtTx(tx: DebtTransaction) {
        debtTxs = debtTxs + tx
        recomputeDerived()
        persistJson("debt_transactions", VestaJson.encodeToString(debtTxs))
    }

    suspend fun deleteDebtTx(id: String) {
        debtTxs = debtTxs.filter { it.id != id }
        recomputeDerived()
        persistJson("debt_transactions", VestaJson.encodeToString(debtTxs))
    }

    /** Display currency, synced through the same `preferred_currency` blob
     *  the web reads — switch on the phone and the website follows. */
    fun updateDisplayCurrency(code: String) {
        displayCurrency = code
        recomputeDerived() // `freedom` is denominated in the display currency
        scope.launch {
            try {
                persistJson("preferred_currency", VestaJson.encodeToString(code))
            } catch (_: Exception) {
            }
        }
    }

    // MARK: Derived — money

    fun convert(amount: Double, from: String): Double =
        Money.convert(amount, from, displayCurrency)

    fun format(amount: Double, compact: Boolean = false): String =
        Money.format(amount, displayCurrency, compact)

    // MARK: Derived — categories

    fun incomeLabel(type: String): String =
        Categories.incomeLabels.firstOrNull { it.first == type }?.second
            ?: customIncomeCategories.firstOrNull { it.id == type }?.label
            ?: type

    fun expenseLabel(type: String): String =
        Categories.expenseLabels.firstOrNull { it.first == type }?.second
            ?: customExpenseCategories.firstOrNull { it.id == type }?.label
            ?: type

    fun incomeColor(type: String): androidx.compose.ui.graphics.Color {
        com.piyawatpm.vesta.ui.theme.Ledger.let { ledger ->
            Categories.incomeColorIndex[type]?.let { return ledger.chartColor(it) }
            customIncomeCategories.firstOrNull { it.id == type }?.let {
                return ledger.colorFromHex(it.color)
            }
            return ledger.hashedColor(type)
        }
    }

    fun expenseColor(type: String): androidx.compose.ui.graphics.Color {
        com.piyawatpm.vesta.ui.theme.Ledger.let { ledger ->
            Categories.expenseColorIndex[type]?.let { return ledger.chartColor(it) }
            customExpenseCategories.firstOrNull { it.id == type }?.let {
                return ledger.colorFromHex(it.color)
            }
            return ledger.hashedColor(type)
        }
    }

    fun incomeColorForLabel(label: String): androidx.compose.ui.graphics.Color {
        val type = Categories.incomeLabels.firstOrNull { it.second == label }?.first
            ?: customIncomeCategories.firstOrNull { it.label == label }?.id
            ?: return com.piyawatpm.vesta.ui.theme.Ledger.hashedColor(label)
        return incomeColor(type)
    }

    fun expenseColorForLabel(label: String): androidx.compose.ui.graphics.Color {
        val type = Categories.expenseLabels.firstOrNull { it.second == label }?.first
            ?: customExpenseCategories.firstOrNull { it.label == label }?.id
            ?: return com.piyawatpm.vesta.ui.theme.Ledger.hashedColor(label)
        return expenseColor(type)
    }

    // MARK: Derived — realized income (parity with the web income page)

    private fun computeDerivedRealizedIncome(): List<IncomeEntry> {
        if (!realizedIncomeEnabled) return emptyList()
        val tickers = holdings.associate { it.id to it.ticker }
        val stocks = PortfolioMath.realizedSales(portfolioTxs) { tickers[it] }
        val crypto = CryptoMath.realizedSales(cryptoTxs)
        return (stocks + crypto).map { sale ->
            IncomeEntry(
                id = sale.id,
                type = if (sale.source == "stocks") "realized_stocks" else "realized_crypto",
                description = "${if (sale.realized >= 0) "Gain on" else "Loss on"} ${sale.label} sell",
                amount = sale.realized,
                currency = sale.currency,
                date = sale.date,
                source = sale.ticker,
                isPassive = true,
                createdAt = 0.0,
                derived = true,
            )
        }
    }

    // MARK: Derived — net worth pieces (all in display currency)

    /** Web's canAutoUpdate rule: real ticker, not the SUPER placeholder, not
     *  an IFM- internal code — and Alpaca only quotes USD listings. */
    private fun liveEligible(holding: PortfolioHolding): Boolean =
        holding.ticker.isNotEmpty() && holding.ticker != "SUPER" &&
            !holding.ticker.startsWith("IFM-") && holding.currency == "USD"

    /** Current value with the live trade price applied where one exists. */
    fun holdingLiveValue(holding: PortfolioHolding): Double {
        if (liveEligible(holding) && holding.units > 0) {
            liveStockPrices[holding.ticker]?.let { return holding.units * it }
        }
        return holding.currentValue
    }

    val stocksValue: Double
        get() = holdings.sumOf { convert(holdingLiveValue(it), it.currency) }

    /** Invest-tab figure, honoring the super toggle. */
    val stocksValueVisible: Double
        get() = holdings
            .filter { includeSuperStocks || it.accountType != "super" }
            .sumOf { convert(holdingLiveValue(it), it.currency) }

    // MARK: Live sockets

    /** (Re)connect the three price feeds for whatever we currently hold. */
    fun startLive() {
        if (!isSignedIn) return
        val tokens = cryptoCsvHoldings
            .filter { !CryptoMath.isCashLike(it.token, stablecoinTags) }
            .map { it.token }
        val binanceMap = HashMap<String, String>()
        val gateMap = HashMap<String, String>()
        for (token in tokens) {
            // The mappings blob resolves display names to BASE symbols
            // ("Hyperliquid" → "HYPE"), never to exchange pairs.
            val base = (tickerMappings[token] ?: token).uppercase().replace(" ", "")
            if (base.length !in 2..12 || !base.all { it.isLetterOrDigit() }) continue
            binanceMap["${base}USDT"] = token
            // Gate covers what Binance doesn't list (GT, OFC…); harmless
            // double-subscription otherwise — same number wins either way.
            gateMap["${base}_USDT"] = token
        }
        val stockSymbols = holdings.filter { liveEligible(it) }.map { it.ticker }

        sockets.start(
            binanceMap = binanceMap,
            gateMap = gateMap,
            stockSymbols = stockSymbols,
            onCrypto = { token, price -> queueCrypto(token, price) },
            onStock = { ticker, price -> queueStock(ticker, price) },
        )
    }

    fun stopLive() {
        sockets.stop()
    }

    val cryptoHoldings: List<CryptoHolding>
        get() = CryptoMath.computeHoldings(cryptoTxs)

    /** Best available USD price for a token: live Binance beats the web's
     *  stored blob beats nothing. */
    fun priceUsd(token: String): Double? = livePrices[token] ?: cryptoPrices[token]

    /**
     * A token's current USD value, holdings-CSV row. The CSV's stored value
     * is the FLOOR of knowledge (it priced every coin at upload time,
     * including Earn/locked ones no feed quotes); a live price refreshes it
     * when one exists. Never price-by-feed-or-zero.
     */
    fun csvHoldingValueUsd(holding: CryptoCsvHolding): Double {
        if (CryptoMath.isCashLike(holding.token, stablecoinTags)) {
            return holding.amount // pegged $1/unit, same as the web
        }
        priceUsd(holding.token)?.let { return holding.amount * it }
        return holding.valueUsd
    }

    val cryptoValue: Double
        get() {
            // The holdings CSV is authoritative when present (it includes
            // coins the tx log never saw). Tx replay is the fresh-setup fallback.
            val usd: Double = if (cryptoCsvHoldings.isNotEmpty()) {
                cryptoCsvHoldings.sumOf { csvHoldingValueUsd(it) }
            } else {
                cryptoHoldings.sumOf { holding ->
                    if (CryptoMath.isCashLike(holding.token, stablecoinTags)) {
                        holding.amount
                    } else {
                        holding.amount * (priceUsd(holding.token) ?: 0.0)
                    }
                }
            }
            return convert(usd, "USD")
        }

    fun coinImageURL(token: String): String? {
        coinImages[token]?.let { return it }
        // Blob keys are display names; tolerate case drift.
        val lower = token.lowercase()
        return coinImages.entries.firstOrNull { it.key.lowercase() == lower }?.value
    }

    fun stockLogoURL(ticker: String): String? = stockLogos[ticker]

    /** What the Crypto tab renders: holdings CSV first (authoritative,
     *  includes Earn/locked coins), tx replay only as a fresh-setup fallback. */
    val cryptoDisplayRows: List<CryptoDisplayRow>
        get() {
            val rows: List<CryptoDisplayRow> = if (cryptoCsvHoldings.isNotEmpty()) {
                cryptoCsvHoldings.map { holding ->
                    val cash = CryptoMath.isCashLike(holding.token, stablecoinTags)
                    CryptoDisplayRow(
                        token = holding.token,
                        amount = holding.amount,
                        valueUsd = csvHoldingValueUsd(holding),
                        costUsd = if (cash) holding.amount else holding.costUsd,
                        isCash = cash,
                        isLive = livePrices.containsKey(holding.token),
                    )
                }
            } else {
                cryptoHoldings.map { holding ->
                    val cash = CryptoMath.isCashLike(holding.token, stablecoinTags)
                    CryptoDisplayRow(
                        token = holding.token,
                        amount = holding.amount,
                        valueUsd = if (cash) holding.amount
                        else holding.amount * (priceUsd(holding.token) ?: 0.0),
                        costUsd = holding.totalCostUsd,
                        isCash = cash,
                        isLive = livePrices.containsKey(holding.token),
                    )
                }
            }
            return rows.filter { it.valueUsd > 0.5 }.sortedByDescending { it.valueUsd }
        }

    val debtNet: Double
        get() {
            var net = 0.0
            for (debt in debts) {
                val paid = debtTxs.filter { it.debtId == debt.id }.sumOf { it.amount }
                val balance = debt.originalAmount - paid
                val signed = if (debt.direction == "owed_to_me") balance else -balance
                net += convert(signed, debt.currency)
            }
            return net
        }

    /** Honors the app-wide super toggle — dashboard, goal and chart all agree. */
    val netWorth: Double get() = stocksValueVisible + cryptoValue + debtNet

    /** Transactions whose holding still exists. Deleting a holding is how a
     *  mistaken entry gets erased, but its transactions linger in the blob —
     *  orphans would otherwise pollute the invested-per-month split. */
    val livePortfolioTxs: List<PortfolioTransaction>
        get() {
            val ids = holdings.mapTo(HashSet()) { it.id }
            return portfolioTxs.filter { it.holdingId in ids }
        }

    /**
     * External money into the tracked pots in one month, display currency:
     * stock & super net buys + crypto deposits − withdrawals. Coin buys/sells
     * inside the crypto pot are conversions of money already counted.
     */
    fun investedInMonth(key: String): Double {
        val stocks = livePortfolioTxs
            .filter { SydneyTime.monthKey(it.date) == key }
            .sumOf { tx ->
                convert(if (tx.type == "buy") tx.totalAmount else -tx.totalAmount, tx.currency)
            }
        val crypto = cryptoExternalEvents
            .filter { it.month == key }
            .sumOf { convert(it.usd, "USD") }
        return stocks + crypto
    }

    /** Deployable cash, the web dashboard's "Dry Powder". */
    val dryPowder: Double get() = dryPowder(includeSuper = true)

    fun dryPowder(includeSuper: Boolean): Double {
        val cryptoCashUsd = cryptoCsvHoldings
            .filter { cryptoCashTags[it.token] == true }
            .sumOf { csvHoldingValueUsd(it) }
        val holdingCash = holdings
            .filter {
                (it.isCash == true || it.type == "savings") &&
                    (includeSuper || it.accountType != "super")
            }
            .sumOf { convert(holdingLiveValue(it), it.currency) }
        return convert(cryptoCashUsd, "USD") + holdingCash
    }

    /** Month-over-month net-worth CHANGE, USD, oldest first. The last entry
     *  is the current (partial) month, flagged so the UI can say so. */
    private fun computeMonthlyGrowth(): List<MonthlyGrowthEntry> {
        val firstPerMonth = LinkedHashMap<String, SnapshotPoint>()
        for (row in networthHistory) {
            val month = row.date.take(7)
            if (month !in firstPerMonth) firstPerMonth[month] = row
        }
        val months = firstPerMonth.keys.sorted().takeLast(13)
        if (months.size < 2) return emptyList()

        fun value(row: SnapshotPoint): Double =
            if (includeSuperStocks) row.value else (row.valueNoSuper ?: row.value)

        val out = mutableListOf<MonthlyGrowthEntry>()
        for (index in 1 until months.size) {
            val prev = firstPerMonth[months[index - 1]] ?: continue
            val curr = firstPerMonth[months[index]] ?: continue
            // The delta BELONGS to the month that produced it (prev month).
            out.add(
                MonthlyGrowthEntry(
                    key = months[index - 1],
                    label = monthLabel(months[index - 1]),
                    deltaUsd = value(curr) - value(prev),
                    partial = false,
                )
            )
        }
        // Current month so far: its opening reading vs live net worth.
        months.lastOrNull()?.let { lastMonth ->
            firstPerMonth[lastMonth]?.let { opening ->
                val live = Money.convert(netWorth, displayCurrency, "USD")
                out.add(
                    MonthlyGrowthEntry(
                        key = lastMonth,
                        label = monthLabel(lastMonth),
                        deltaUsd = live - value(opening),
                        partial = true,
                    )
                )
            }
        }
        return out
    }

    /** Average daily net-worth change (USD) over the trailing window — the
     *  pace behind the goal projection. Null when history is too short. */
    fun dailyGrowthUsd(days: Int = 90): Double? {
        val series = if (includeSuperStocks) networthParsed else networthParsedNoSuper
        val last = series.lastOrNull() ?: return null
        val cutoff = last.date - days.toLong() * 86400_000L
        val first = series.firstOrNull { it.date >= cutoff } ?: return null
        val span = (last.date - first.date) / 86400_000.0
        if (span < 7) return null // a week is the floor for a trend
        val live = Money.convert(netWorth, displayCurrency, "USD")
        return (live - first.valueUsd) / span
    }

    /** Passive income vs expenses over the trailing 30 days, in display
     *  currency — "how much of my burn is covered without working". */
    private fun computeFreedom() {
        val cutoff = SydneyTime.dayString(
            Instant.ofEpochMilli(System.currentTimeMillis() - 30L * 86400_000L)
        )
        val passiveTypes = setOf(
            "dividend", "crypto_yield", "interest", "rental",
            "realized_stocks", "realized_crypto",
        )
        val passive = allIncome
            .filter { it.date >= cutoff }
            .filter { it.isPassive == true || it.type in passiveTypes }
            .sumOf { convert(it.amount, it.currency) }
        val spend = expenses
            .filter { it.date >= cutoff }
            .sumOf { convert(it.amount, it.currency) }
        freedomPassive = passive
        freedomExpenses = spend
        freedomCoverage = if (spend > 0) passive / spend else 0.0
    }

    /** Net worth at the START of each month (first snapshot reading), USD,
     *  plus a live "now" sample — the month-over-month trend card. */
    val monthStartNetWorth: List<Triple<String, Double, Boolean>>
        get() {
            val firstPerMonth = LinkedHashMap<String, SnapshotPoint>()
            for (row in networthHistory) {
                val month = row.date.take(7)
                if (month !in firstPerMonth) firstPerMonth[month] = row
            }
            val out = mutableListOf<Triple<String, Double, Boolean>>()
            for (month in firstPerMonth.keys.sorted().takeLast(11)) {
                val row = firstPerMonth[month] ?: continue
                val value = if (includeSuperStocks) row.value else (row.valueNoSuper ?: row.value)
                out.add(Triple(monthLabel(month), value, false))
            }
            out.add(Triple("Now", Money.convert(netWorth, displayCurrency, "USD"), true))
            return out
        }

    // MARK: Derived — month aggregates

    fun monthTotal(entries: List<IncomeEntry>, month: String): Double =
        entries
            .filter { SydneyTime.monthKey(it.date) == month }
            .sumOf { convert(it.amount, it.currency) }

    fun monthTotalExpenses(month: String): Double =
        expenses
            .filter { SydneyTime.monthKey(it.date) == month }
            .sumOf { convert(it.amount, it.currency) }
}
