package com.piyawatpm.vesta.data

import com.piyawatpm.vesta.core.SnapshotDate
import kotlin.math.abs

/**
 * The crypto pot's P&L, separated into the three stories that were tangled
 * in one number: what the bots/Earn PAID you (stable transfers in), what
 * trading LOCKED IN (sell realized), and what the bags are doing on paper.
 * Port of ios CryptoSplit.swift (math half; the cards live in ui/).
 */
object CryptoSplit {
    data class Split(
        var yieldInUsd: Double = 0.0, // stable transfers in
        var yieldOutUsd: Double = 0.0, // stable transfers out (redeploys/withdrawals)
        var realizedUsd: Double = 0.0, // avg-cost realized on sells
        var unrealizedUsd: Double = 0.0, // bags at live/last-known prices
        var unpriced: MutableList<String> = mutableListOf(), // tokens with no price anywhere
    ) {
        val netYieldUsd: Double get() = yieldInUsd - yieldOutUsd
        val netUsd: Double get() = netYieldUsd + realizedUsd + unrealizedUsd
    }

    data class YieldEvent(
        val date: String, // yyyy-MM-dd
        val token: String,
        val usd: Double, // signed: + arrived, − left
        val notes: String,
        /** The date|token|amount identity used for manual exclusion — stable
         *  across CSV re-uploads, which row ids would not be. */
        val key: String,
    ) {
        val id: String get() = key + usd.toString()
    }

    /** A stable transfer's USD value: the CSV usually leaves `totalValueUsd`
     *  empty on transfers, so fall back to amount × price, then to the $1 peg. */
    private fun stableValue(tx: CryptoTransaction): Double =
        tx.totalValueUsd ?: ((tx.priceUsd ?: 1.0) * tx.amount)

    /**
     * The day the Notes-column convention started. From here on, earn is
     * opt-in: "E" (or anything containing "earn") in the note, nothing else.
     * BEFORE it, the user's CMC habit was the opposite — earn was recorded
     * AS a transferIn — so pre-era transfer-ins count by default, with two
     * guards: venue moves (an in that bounces straight back out) are
     * auto-excluded, and a lone "x" note vetoes a row that was actually
     * the user's own capital arriving.
     */
    const val markerEpoch = "2026-08-05"

    /** Is this transfer explicitly marked as earn income? ("E" / "earn") */
    fun isEarnMarked(tx: CryptoTransaction): Boolean {
        val note = tx.notes.trim().lowercase()
        return note == "e" || note.contains("earn")
    }

    /** Pre-era opt-out: "x" (or "not earn") says this arrival was capital. */
    fun isOptedOut(tx: CryptoTransaction): Boolean {
        val note = tx.notes.trim().lowercase()
        return note == "x" || note == "not earn"
    }

    /** The stable identity of a transfer for pairing and manual exclusion. */
    fun earnKey(tx: CryptoTransaction): String =
        "${tx.date.take(10)}|${tx.token}|${tx.amount}"

    private fun pairKey(tx: CryptoTransaction): String = earnKey(tx)

    /**
     * Pre-era transfer-ins that bounce back out — same token, within 3 days,
     * amount within 12% — are the user's own money hopping venues, not
     * income. Greedy one-to-one matching, oldest first; returns a multiset
     * of pair keys so duplicate-looking rows only cancel once each.
     */
    private fun internalMoveKeys(txs: List<CryptoTransaction>): MutableMap<String, Int> {
        val pre = txs.filter { it.date.take(10) < markerEpoch }
        val ins = pre.filter { it.type == "transferIn" }.sortedBy { it.date }
        data class OutRow(val tx: CryptoTransaction, var used: Boolean = false)
        val outs = pre.filter { it.type == "transferOut" }.sortedBy { it.date }
            .map { OutRow(it) }
        val keys = HashMap<String, Int>()
        for (arrival in ins) {
            if (arrival.amount <= 0) continue
            val inDate = SnapshotDate.parse(arrival.date) ?: continue
            for (candidate in outs) {
                if (candidate.used) continue
                val out = candidate.tx
                if (out.token != arrival.token) continue
                val outDate = SnapshotDate.parse(out.date) ?: continue
                if (abs(outDate - inDate) > 3 * 86400_000L) continue
                if (abs(out.amount - arrival.amount) / arrival.amount >= 0.12) continue
                candidate.used = true
                keys[pairKey(arrival)] = (keys[pairKey(arrival)] ?: 0) + 1
                break
            }
        }
        return keys
    }

    /**
     * The one earn decision, shared by every computation in this file so the
     * card, the per-coin page, and the ledger can never disagree: marked rows
     * always count; pre-era transfer-ins count unless vetoed ("x") or
     * recognized as a venue move. Stateful because the venue-move multiset is
     * consumed as rows match — instantiate one per pass.
     */
    class EarnRule(txs: List<CryptoTransaction>, private val excluded: Set<String> = emptySet()) {
        private val internalMoves = internalMoveKeys(txs)

        fun countsAsEarn(tx: CryptoTransaction): Boolean {
            // Manual veto beats everything, marked rows included — the user
            // taps "not earn" in the ledger and the row stops counting.
            if (earnKey(tx) in excluded) return false
            if (isEarnMarked(tx)) return true
            if (tx.type != "transferIn") return false
            if (tx.date.take(10) >= markerEpoch) return false
            if (isOptedOut(tx)) return false
            val key = pairKey(tx)
            val count = internalMoves[key]
            if (count != null && count > 0) {
                internalMoves[key] = count - 1
                return false
            }
            return true
        }
    }

    /**
     * The token's logged price nearest in time to `date` — how a coin
     * transfer (Earn interest paid in ETH, bot rewards in kind) gets valued
     * at ARRIVAL, since the CSV leaves transfers priceless.
     */
    fun nearestPrices(txs: List<CryptoTransaction>): (String, String) -> Double? {
        val points = HashMap<String, MutableList<Pair<Long, Double>>>()
        for (tx in txs) {
            val p = tx.priceUsd
            if (p != null && p > 0) {
                SnapshotDate.parse(tx.date)?.let { d ->
                    points.getOrPut(tx.token) { mutableListOf() }.add(d to p)
                }
            }
        }
        return lookup@{ token, dateString ->
            val candidates = points[token] ?: return@lookup null
            val date = SnapshotDate.parse(dateString) ?: return@lookup null
            candidates.minByOrNull { abs(it.first - date) }?.second
        }
    }

    fun compute(
        txs: List<CryptoTransaction>,
        tags: Map<String, Boolean>,
        livePrice: (String) -> Double?,
        exclusions: Set<String> = emptySet(),
    ): Split {
        val split = Split()
        val arrivalPrice = nearestPrices(txs)
        val earnRule = EarnRule(txs, exclusions)

        // Trading replay with earn transfers booked as INCOME AT ARRIVAL
        // VALUE — Earn pays in kind (ETH, BTC…) as well as USDT. A
        // transferred coin gets its arrival value as cost basis, so the
        // trading rows measure only what happened AFTER it arrived.
        val lastPrice = HashMap<String, Double>()
        val bags = HashMap<String, DoubleArray>() // token -> [amount, cost]
        for (tx in txs.sortedBy { it.date }) {
            tx.priceUsd?.let { if (it > 0) lastPrice[tx.token] = it }
            if (CryptoMath.isCashLike(tx.token, tags)) {
                if (!earnRule.countsAsEarn(tx)) continue // else cash management
                if (tx.type == "transferIn") split.yieldInUsd += stableValue(tx)
                if (tx.type == "transferOut") split.yieldOutUsd += stableValue(tx)
                continue
            }
            val bag = bags.getOrPut(tx.token) { doubleArrayOf(0.0, 0.0) }
            when (tx.type) {
                "buy" -> {
                    bag[0] += tx.amount
                    bag[1] += tx.totalValueUsd ?: 0.0
                }
                "transferIn" -> {
                    bag[0] += tx.amount
                    arrivalPrice(tx.token, tx.date)?.let { px ->
                        val value = tx.amount * px
                        bag[1] += value // arrival basis either way
                        if (earnRule.countsAsEarn(tx)) split.yieldInUsd += value
                    }
                }
                "sell", "transferOut" -> {
                    if (bag[0] > 1e-9) {
                        val take = minOf(tx.amount, bag[0])
                        val avg = bag[1] / bag[0]
                        if (tx.type == "sell") {
                            tx.totalValueUsd?.let { value ->
                                split.realizedUsd += value - avg * take
                            }
                        } else if (earnRule.countsAsEarn(tx)) {
                            arrivalPrice(tx.token, tx.date)?.let { px ->
                                split.yieldOutUsd += take * px
                            }
                        }
                        bag[0] -= take
                        bag[1] -= avg * take
                    }
                }
            }
        }
        for ((token, bag) in bags) {
            if (bag[0] <= 1e-9) continue
            val price = livePrice(token) ?: lastPrice[token]
            if (price != null) {
                split.unrealizedUsd += bag[0] * price - bag[1]
            } else {
                split.unpriced.add(token)
            }
        }
        return split
    }

    data class CoinPnl(
        val token: String,
        val earnedUsd: Double, // transfers valued at arrival — Earn/bot in kind
        val realizedUsd: Double,
        val unrealizedUsd: Double,
        val heldAmount: Double,
        val priced: Boolean,
    ) {
        // Trading only — earn lives on the Earn income page.
        val netUsd: Double get() = realizedUsd + unrealizedUsd
    }

    /** Net earn per coin — earned (transfers at arrival value) + realized +
     *  bag. Exited coins stay listed; that is the point of the question. */
    fun perCoin(
        txs: List<CryptoTransaction>,
        tags: Map<String, Boolean>,
        livePrice: (String) -> Double?,
        exclusions: Set<String> = emptySet(),
    ): List<CoinPnl> {
        val arrivalPrice = nearestPrices(txs)
        val earnRule = EarnRule(txs, exclusions)
        val lastPrice = HashMap<String, Double>()
        val bags = HashMap<String, DoubleArray>()
        val realized = HashMap<String, Double>()
        val earned = HashMap<String, Double>()
        for (tx in txs.sortedBy { it.date }) {
            tx.priceUsd?.let { if (it > 0) lastPrice[tx.token] = it }
            if (CryptoMath.isCashLike(tx.token, tags)) continue
            val bag = bags.getOrPut(tx.token) { doubleArrayOf(0.0, 0.0) }
            when (tx.type) {
                "buy" -> {
                    bag[0] += tx.amount
                    bag[1] += tx.totalValueUsd ?: 0.0
                }
                "transferIn" -> {
                    bag[0] += tx.amount
                    arrivalPrice(tx.token, tx.date)?.let { px ->
                        val value = tx.amount * px
                        bag[1] += value
                        if (earnRule.countsAsEarn(tx)) {
                            earned[tx.token] = (earned[tx.token] ?: 0.0) + value
                        }
                    }
                }
                "sell", "transferOut" -> {
                    if (bag[0] > 1e-9) {
                        val take = minOf(tx.amount, bag[0])
                        val avg = bag[1] / bag[0]
                        if (tx.type == "sell") {
                            tx.totalValueUsd?.let { value ->
                                realized[tx.token] = (realized[tx.token] ?: 0.0) +
                                    (value - avg * take)
                            }
                        } else if (earnRule.countsAsEarn(tx)) {
                            arrivalPrice(tx.token, tx.date)?.let { px ->
                                earned[tx.token] = (earned[tx.token] ?: 0.0) - take * px
                            }
                        }
                        bag[0] -= take
                        bag[1] -= avg * take
                    }
                }
            }
        }
        val out = mutableListOf<CoinPnl>()
        for (token in bags.keys.union(realized.keys).union(earned.keys)) {
            val bag = bags[token] ?: doubleArrayOf(0.0, 0.0)
            val held = bag[0] > 1e-9
            val price = livePrice(token) ?: lastPrice[token]
            val unreal = if (held) (price?.let { bag[0] * it - bag[1] } ?: 0.0) else 0.0
            val r = realized[token] ?: 0.0
            val e = earned[token] ?: 0.0
            if (abs(r) < 0.5 && (!held || abs(unreal) < 0.5)) continue // no trading story
            out.add(
                CoinPnl(
                    token = token,
                    earnedUsd = e,
                    realizedUsd = r,
                    unrealizedUsd = unreal,
                    heldAmount = bag[0],
                    priced = !held || price != null,
                )
            )
        }
        return out.sortedByDescending { it.netUsd }
    }

    data class ExternalFlowEvent(
        val month: String,
        val date: String,
        val token: String,
        val usd: Double,
    )

    /**
     * EVERY transfer in/out, valued at arrival (stables $1, coins nearest
     * logged price) — the external funding of the crypto pot. Venue-move
     * pairs cancel in any monthly sum by construction. Distinct from earn:
     * this is capital movement, no marker semantics at all.
     */
    fun externalFlowEvents(
        txs: List<CryptoTransaction>,
        tags: Map<String, Boolean>,
    ): List<ExternalFlowEvent> {
        val arrivalPrice = nearestPrices(txs)
        val events = mutableListOf<ExternalFlowEvent>()
        for (tx in txs) {
            if (tx.type != "transferIn" && tx.type != "transferOut") continue
            val value: Double = if (CryptoMath.isCashLike(tx.token, tags)) {
                stableValue(tx)
            } else {
                arrivalPrice(tx.token, tx.date)?.let { tx.amount * it } ?: continue
            }
            val day = tx.date.take(10)
            events.add(
                ExternalFlowEvent(
                    month = day.take(7),
                    date = day,
                    token = tx.token,
                    usd = if (tx.type == "transferIn") value else -value,
                )
            )
        }
        return events
    }

    fun yieldEvents(
        txs: List<CryptoTransaction>,
        tags: Map<String, Boolean>,
        exclusions: Set<String> = emptySet(),
    ): List<YieldEvent> {
        val arrivalPrice = nearestPrices(txs)
        val earnRule = EarnRule(txs, exclusions)
        val events = mutableListOf<YieldEvent>()
        // Date order so the venue-move multiset consumes rows the same way
        // compute() does.
        for (tx in txs.sortedBy { it.date }) {
            if (tx.type != "transferIn" && tx.type != "transferOut") continue
            if (!earnRule.countsAsEarn(tx)) continue
            val value: Double = if (CryptoMath.isCashLike(tx.token, tags)) {
                stableValue(tx)
            } else {
                // no price anywhere — cannot state a value honestly
                arrivalPrice(tx.token, tx.date)?.let { tx.amount * it } ?: continue
            }
            events.add(
                YieldEvent(
                    date = tx.date.take(10),
                    token = tx.token,
                    usd = if (tx.type == "transferIn") value else -value,
                    notes = tx.notes,
                    key = earnKey(tx),
                )
            )
        }
        return events.sortedByDescending { it.date }
    }
}
