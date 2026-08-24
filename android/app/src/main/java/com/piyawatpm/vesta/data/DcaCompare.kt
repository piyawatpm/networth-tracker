package com.piyawatpm.vesta.data

import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SnapshotDate
import com.piyawatpm.vesta.core.SydneyTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.time.Instant
import kotlin.math.abs

/**
 * "Would I be richer if the same money had gone into the index on the same
 * days?" — the shadow-portfolio comparison, ported from the web's
 * dca-benchmark (via ios PerfCompare.swift) so the platforms can't disagree
 * on method. Both sides are PROFIT AND LOSS, not ending value.
 */
object DcaCompare {
    @Serializable
    data class PricePoint(val date: String, val close: Double)

    data class Series(
        val dates: List<Long>, // epoch ms
        val minePct: List<Double>, // your P&L, % of capital deployed to date
        val indexPct: List<Double>, // same flows into the benchmark, same base
        val mineUsd: List<Double>, // the baht question, USD at source
        val indexUsd: List<Double>,
    )

    data class DatedValue(val date: String, val value: Double)

    /** The honest "all time" opening: no earlier than the first LOGGED flow —
     *  hand-seeded estimates predate any transaction, and starting there
     *  reads estimated contributions as market profit. */
    fun clampedStart(values: List<DatedValue>, flows: List<DatedValue>): String? {
        val firstValue = values.firstOrNull()?.date ?: return null
        val firstFlow = flows.firstOrNull()?.date ?: return firstValue
        return maxOf(firstValue, firstFlow)
    }

    /** Latest value at or before `day` (forward-fill over weekends/holidays). */
    fun asOf(rows: List<DatedValue>, day: String): Double? = asOfRow(rows, day)?.value

    /** Same forward-fill, but keeps the reading's own date. */
    fun asOfRow(rows: List<DatedValue>, day: String): DatedValue? {
        var lo = 0
        var hi = rows.size - 1
        var found: DatedValue? = null
        while (lo <= hi) {
            val mid = (lo + hi) / 2
            if (rows[mid].date <= day) {
                found = rows[mid]; lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        return found
    }

    /** Net buys − sells per day in USD, ascending. Positive = money in. */
    fun flowsByDay(txs: List<PortfolioTransaction>): List<DatedValue> {
        val byDay = HashMap<String, Double>()
        for (tx in txs) {
            val usd = Money.convert(tx.totalAmount, tx.currency, "USD")
            val day = tx.date.take(10)
            byDay[day] = (byDay[day] ?: 0.0) + if (tx.type == "buy") usd else -usd
        }
        return byDay.filterValues { abs(it) > 0.005 }
            .map { DatedValue(it.key, it.value) }
            .sortedBy { it.date }
    }

    /** Daily closes of a snapshot series: last reading per day, USD. */
    fun dailyValues(parsed: List<ParsedPoint>): List<DatedValue> {
        val byDay = LinkedHashMap<String, Double>()
        for (row in parsed) {
            byDay[SydneyTime.dayString(Instant.ofEpochMilli(row.date))] = row.valueUsd
        }
        return byDay.map { DatedValue(it.key, it.value) }.sortedBy { it.date }
    }

    /** Two pots as one: union of days, each side forward-filled. Starts only
     *  once BOTH pots have a reading — summing one pot with the other's zero
     *  would draw a fake cliff at the join. */
    fun combinedDaily(a: List<DatedValue>, b: List<DatedValue>): List<DatedValue> {
        val days = (a.map { it.date } + b.map { it.date }).toSortedSet()
        return days.mapNotNull { day ->
            val va = asOf(a, day) ?: return@mapNotNull null
            val vb = asOf(b, day) ?: return@mapNotNull null
            DatedValue(day, va + vb)
        }
    }

    /** Flow schedules merged by day. */
    fun mergedFlows(a: List<DatedValue>, b: List<DatedValue>): List<DatedValue> {
        val byDay = HashMap<String, Double>()
        for (flow in a + b) byDay[flow.date] = (byDay[flow.date] ?: 0.0) + flow.value
        return byDay.filterValues { abs(it) > 0.005 }
            .map { DatedValue(it.key, it.value) }
            .sortedBy { it.date }
    }

    /**
     * Same money, same days: your pot's P&L vs the same flows into the
     * benchmark, both as a percent of capital deployed to date. P&L, not
     * time-weighted, ON PURPOSE — hand-marked values lag logged buys, and
     * TWR multiplies each lag pair into a permanent fake loss.
     */
    fun build(
        values: List<DatedValue>,
        flows: List<DatedValue>,
        prices: List<PricePoint>,
        start: String,
        maskSettling: Boolean = false,
    ): Series? {
        val priceRows = prices.map { DatedValue(it.date, it.close) }
        val today = SydneyTime.today()
        val readings = values.filter { it.date in start..today }
        val openingRow = asOfRow(values, start) ?: return null
        val startPrice = asOf(priceRows, start)?.takeIf { it > 0 } ?: return null
        if (readings.size < 2) return null
        val opening = openingRow.value

        // Start-day flow rule: flows dated ON the start day count when the
        // opening reading is older than the start day itself, OR the day's
        // buys exceed the entire opening reading (money that big cannot
        // plausibly already be inside it) — both +143% and +58.8% bugs.
        val startDayBuys = flows.filter { it.date == start && it.value > 0 }.sumOf { it.value }
        val startDayCounts = openingRow.date < start || startDayBuys > openingRow.value * 1.5

        var invested = opening
        var units = opening / startPrice
        val inWindow = flows
            .filter { (it.date > start || (startDayCounts && it.date == start)) && it.date <= today }
            .sortedBy { it.date }
        var flowIndex = 0

        // Settling windows of LARGE flows: readings inside [flow − 1d,
        // flow + 4d] are dropped FROM THE DRAWING when the flow is ≥4% of
        // capital — pure sampling; endpoints always survive.
        val settling = mutableListOf<Pair<Long, Long>>()
        if (maskSettling) {
            var probe = opening
            for (flow in inWindow) {
                val big = abs(flow.value) >= maxOf(500.0, 0.04 * maxOf(abs(probe), 1.0))
                probe += flow.value
                if (big) {
                    SnapshotDate.parse(flow.date)?.let { day ->
                        settling.add((day - 86400_000L) to (day + 4 * 86400_000L))
                    }
                }
            }
        }

        var dates = mutableListOf<Long>()
        var minePct = mutableListOf<Double>()
        var indexPct = mutableListOf<Double>()
        var mineUsd = mutableListOf<Double>()
        var indexUsd = mutableListOf<Double>()

        for (reading in readings) {
            while (flowIndex < inWindow.size && inWindow[flowIndex].date <= reading.date) {
                val flow = inWindow[flowIndex]
                invested += flow.value
                asOf(priceRows, flow.date)?.takeIf { it > 0 }?.let { px ->
                    units = maxOf(0.0, units + flow.value / px)
                }
                flowIndex += 1
            }
            val date = SnapshotDate.parse(reading.date) ?: continue
            val price = asOf(priceRows, reading.date) ?: continue
            if (abs(invested) <= 1e-9) continue
            val mine = reading.value - invested
            val bench = units * price - invested
            dates.add(date)
            mineUsd.add(mine)
            indexUsd.add(bench)
            minePct.add(mine / abs(invested) * 100)
            indexPct.add(bench / abs(invested) * 100)
        }
        if (dates.size < 2) return null

        if (settling.isNotEmpty()) {
            val kept = dates.indices.filter { index ->
                val isEdge = index == 0 || index == dates.size - 1
                val masked = settling.any { dates[index] in it.first..it.second }
                isEdge || !masked
            }
            if (kept.size >= 2) {
                dates = kept.mapTo(mutableListOf()) { dates[it] }
                minePct = kept.mapTo(mutableListOf()) { minePct[it] }
                indexPct = kept.mapTo(mutableListOf()) { indexPct[it] }
                mineUsd = kept.mapTo(mutableListOf()) { mineUsd[it] }
                indexUsd = kept.mapTo(mutableListOf()) { indexUsd[it] }
            }
        }

        return Series(dates, minePct, indexPct, mineUsd, indexUsd)
    }

    // MARK: Crypto scope (port of crypto-performance.ts) — the crypto
    // investment pot is the NON-cash tokens; transfers are zero-flow.

    /** Net non-cash buys − sells per day, USD. */
    fun cryptoFlowsByDay(
        txs: List<CryptoTransaction>,
        isCash: (String) -> Boolean,
    ): List<DatedValue> {
        val byDay = HashMap<String, Double>()
        for (tx in txs) {
            if (tx.type != "buy" && tx.type != "sell") continue
            if (isCash(tx.token)) continue
            val usd = tx.totalValueUsd ?: continue
            if (!usd.isFinite()) continue
            val day = tx.date.take(10)
            byDay[day] = (byDay[day] ?: 0.0) + if (tx.type == "buy") usd else -usd
        }
        return byDay.filterValues { abs(it) > 0.005 }
            .map { DatedValue(it.key, it.value) }
            .sortedBy { it.date }
    }

    /** Snapshot value minus the forward-filled stable balance ($1/unit,
     *  floored at 0) — the pot the flows above deposit into. */
    fun cryptoPotValues(
        snapshots: List<DatedValue>,
        txs: List<CryptoTransaction>,
        isCash: (String) -> Boolean,
    ): List<DatedValue> {
        val deltaByDay = HashMap<String, Double>()
        for (tx in txs) {
            if (!isCash(tx.token)) continue
            val sign = if (tx.type == "buy" || tx.type == "transferIn") 1.0 else -1.0
            val day = tx.date.take(10)
            deltaByDay[day] = (deltaByDay[day] ?: 0.0) + sign * tx.amount
        }
        var balance = 0.0
        val stableDays = deltaByDay.keys.sorted().map { day ->
            balance = maxOf(0.0, balance + (deltaByDay[day] ?: 0.0))
            day to balance
        }

        var si = -1
        var level = 0.0
        val out = mutableListOf<DatedValue>()
        for (snap in snapshots) {
            while (si + 1 < stableDays.size && stableDays[si + 1].first <= snap.date) {
                si += 1
                level = stableDays[si].second
            }
            val v = snap.value - level
            if (v > 0) out.add(DatedValue(snap.date, v))
        }
        return out
    }
}

/** Fetches index closes from the app's own /api/benchmark (adjusted close). */
object BenchmarkApi {
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class Payload(val prices: List<DcaCompare.PricePoint>)

    suspend fun prices(symbol: String, from: String): List<DcaCompare.PricePoint> =
        withContext(Dispatchers.IO) {
            val base = Settings.endpointBase ?: throw IOException("no base url")
            val url = "$base/api/benchmark".toHttpUrl().newBuilder()
                .addQueryParameter("symbol", symbol)
                .addQueryParameter("from", from)
                .build()
            val request = Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .build()
            client.newCall(request).execute().use { response ->
                if (response.code != 200) throw IOException("benchmark ${response.code}")
                json.decodeFromString(Payload.serializer(), response.body?.string() ?: "").prices
            }
        }
}
