package com.piyawatpm.vesta.core

import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.pow

// Ports of lib/utils/fx.ts, timezone.ts and performance.ts (xirr), matching
// ios/VestaQuickAdd/Native/FinanceMath.swift. Kept as literal translations —
// when a number here disagrees with the web app, the bug is a port
// divergence, so the less creative the Kotlin, the better.

object Money {
    /** ALL_CURRENCIES subset that actually appears in the data. */
    val symbols: Map<String, String> = mapOf(
        "AUD" to "A$", "USD" to "$", "THB" to "฿", "EUR" to "€", "GBP" to "£",
        "JPY" to "¥", "SGD" to "S$", "HKD" to "HK$", "NZD" to "NZ$", "CAD" to "C$",
    )

    fun symbol(currency: String): String = symbols[currency] ?: currency

    /** USD-based cross rates, same as fx.ts: rates[X] = units of X per 1 USD. */
    @Volatile
    var rates: Map<String, Double> = emptyMap()

    fun convert(amount: Double, from: String, to: String): Double {
        if (from == to || rates.isEmpty()) return amount
        val fromRate = rates[from] ?: 1.0
        val toRate = rates[to] ?: 1.0
        return (amount / fromRate) * toRate
    }

    private val decimalFormat: NumberFormat =
        NumberFormat.getNumberInstance(Locale.US).apply {
            minimumFractionDigits = 2
            maximumFractionDigits = 2
        }

    fun format(amount: Double, currency: String, compact: Boolean = false): String {
        val sign = if (amount < 0) "−" else ""
        val abs = abs(amount)
        if (compact && abs >= 1_000_000) {
            return "$sign${symbol(currency)}${"%.1f".format(abs / 1_000_000)}M"
        }
        if (compact && abs >= 1_000) {
            return "$sign${symbol(currency)}${"%.1f".format(abs / 1_000)}K"
        }
        val body = synchronized(decimalFormat) { decimalFormat.format(abs) }
        return "$sign${symbol(currency)}$body"
    }
}

object SydneyTime {
    val zone: ZoneId = ZoneId.of("Australia/Sydney")

    private val dayFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US).withZone(zone)

    fun today(): String = dayFormatter.format(Instant.now())

    /** "yyyy-MM-dd" in Sydney, for any instant. */
    fun dayString(instant: Instant): String = dayFormatter.format(instant)

    fun monthKey(dateString: String): String = dateString.take(7)

    fun currentMonthKey(): String = today().take(7)

    /** "2026-08-04" → "4 Aug" for row display. */
    fun shortLabel(dateString: String): String {
        val day = dateString.take(10)
        return try {
            val date = LocalDate.parse(day)
            "${date.dayOfMonth} ${monthShortName(date.monthValue)}"
        } catch (_: Exception) {
            dateString
        }
    }

    fun monthShortName(month: Int): String = when (month) {
        1 -> "Jan"; 2 -> "Feb"; 3 -> "Mar"; 4 -> "Apr"; 5 -> "May"; 6 -> "Jun"
        7 -> "Jul"; 8 -> "Aug"; 9 -> "Sep"; 10 -> "Oct"; 11 -> "Nov"; else -> "Dec"
    }
}

/**
 * Fast parser for snapshot timestamps — "yyyy-MM-dd HH:mm:ss",
 * "yyyy-MM-dd HH:mm" or bare "yyyy-MM-dd", pinned to Sydney wall time. Port
 * of ios SnapshotDate: DateTimeFormatter costs too much per parse for ~60k
 * cached snapshot rows, so digits are scanned by hand and the calendar math
 * done directly. Returns epoch millis.
 */
object SnapshotDate {
    val zone: ZoneId = SydneyTime.zone

    fun parse(string: String): Long? {
        // Digit runs, in order: y m d [h] [min] [sec]. Separators don't
        // matter, which also tolerates the "yyyy-MM-ddTHH:mm" shape.
        val nums = IntArray(6)
        var index = 0
        var current = 0
        var inNumber = false
        for (ch in string) {
            if (ch in '0'..'9') {
                current = current * 10 + (ch - '0')
                inNumber = true
            } else if (inNumber) {
                if (index < 6) nums[index] = current
                index += 1
                current = 0
                inNumber = false
                if (index >= 6) break
            }
        }
        if (inNumber && index < 6) { nums[index] = current; index += 1 }

        if (index < 3) return null
        val y = nums[0]; val m = nums[1]; val d = nums[2]
        val h = if (index > 3) nums[3] else 0
        val minute = if (index > 4) nums[4] else 0
        val second = if (index > 5) nums[5] else 0
        if (y < 1970 || m < 1 || m > 12 || d < 1 || d > 31 ||
            h >= 24 || minute >= 60 || second >= 60
        ) return null

        // Wall-clock seconds as if the string were UTC…
        val wall = daysFromCivil(y, m, d).toLong() * 86400 +
            (h * 3600 + minute * 60 + second).toLong()
        // …then shift by Sydney's offset at that instant. Two passes converge
        // across a DST boundary.
        val rules = zone.rules
        val first = rules.getOffset(Instant.ofEpochSecond(wall)).totalSeconds.toLong()
        var epoch = wall - first
        val second_ = rules.getOffset(Instant.ofEpochSecond(epoch)).totalSeconds.toLong()
        if (second_ != first) epoch = wall - second_
        return epoch * 1000
    }

    /** Day of week for a "yyyy-MM-dd…" string: 0 = Sunday … 6 = Saturday. */
    fun weekdayIndex(ymd: String): Int? {
        val parts = ymd.take(10).split("-")
        if (parts.size != 3) return null
        val y = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        val d = parts[2].toIntOrNull() ?: return null
        // 1970-01-01 was a Thursday (index 4).
        return ((daysFromCivil(y, m, d) % 7) + 7 + 4) % 7
    }

    /** Days between 1970-01-01 and the given civil date (Howard Hinnant). */
    private fun daysFromCivil(y: Int, m: Int, d: Int): Int {
        val year = if (m <= 2) y - 1 else y
        val era = (if (year >= 0) year else year - 399) / 400
        val yoe = year - era * 400
        val doy = (153 * (m + if (m > 2) -3 else 9) + 2) / 5 + d - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }
}

// MARK: - XIRR (port of lib/utils/performance.ts)

data class CashFlow(
    val date: String, // YYYY-MM-DD
    val amount: Double, // negative = money in, positive = money out/final value
)

/**
 * Annualized money-weighted return. Newton-Raphson from 10%, bisection
 * fallback on [-0.9999, 1e6]. Null when <2 flows, no sign change, span < 30
 * days, or no convergence — same guards as the web.
 */
fun xirr(flows: List<CashFlow>): Double? {
    if (flows.size < 2) return null
    val sorted = flows.sortedBy { it.date }
    if (sorted.none { it.amount > 0 } || sorted.none { it.amount < 0 }) return null

    fun epochDay(date: String): Long? = try {
        LocalDate.parse(date.take(10)).toEpochDay()
    } catch (_: Exception) {
        null
    }

    val t0 = epochDay(sorted[0].date) ?: return null
    val times = sorted.mapNotNull { flow ->
        val d = epochDay(flow.date) ?: return@mapNotNull null
        Pair((d - t0).toDouble() / 365.25, flow.amount)
    }
    if (times.size != sorted.size) return null
    val last = times.lastOrNull() ?: return null
    if (last.first * 365.25 < 30) return null

    fun npv(rate: Double): Double =
        times.sumOf { (years, amount) -> amount / (1 + rate).pow(years) }

    fun derivative(rate: Double): Double =
        times.sumOf { (years, amount) -> -years * amount / (1 + rate).pow(years + 1) }

    var rate = 0.1
    for (i in 0 until 50) {
        val value = npv(rate)
        if (abs(value) < 1e-7) return rate
        val slope = derivative(rate)
        if (abs(slope) < 1e-12) break
        val next = rate - value / slope
        if (next <= -1 || next.isNaN() || next.isInfinite()) break
        if (abs(next - rate) < 1e-9) return next
        rate = next
    }

    var lo = -0.9999
    var hi = 1e6
    var fLo = npv(lo)
    if (fLo * npv(hi) >= 0) return null
    for (i in 0 until 200) {
        val mid = (lo + hi) / 2
        val fMid = npv(mid)
        if (abs(fMid) < 1e-7) return mid
        if (fLo * fMid < 0) { hi = mid } else { lo = mid; fLo = fMid }
    }
    return null
}

/** Epoch millis for "now" — one alias so call sites read like the Swift. */
fun nowMs(): Double = System.currentTimeMillis().toDouble()

/** Sydney "yyyy-MM-dd" for an epoch-millis timestamp. */
fun sydneyDay(ms: Double): String =
    SydneyTime.dayString(Instant.ofEpochMilli(ms.toLong()))

/** Month label "Aug" from a "yyyy-MM" key; falls back to the key. */
fun monthLabel(key: String): String {
    val parts = key.split("-")
    if (parts.size < 2) return key
    val m = parts[1].toIntOrNull() ?: return key
    return SydneyTime.monthShortName(m)
}

/** "August 2026" style label from a "yyyy-MM" key. */
fun fullMonthLabel(key: String): String {
    val parts = key.split("-")
    if (parts.size < 2) return key
    val m = parts[1].toIntOrNull() ?: return key
    return "${fullMonthName(m)} ${parts[0]}"
}

fun fullMonthName(month: Int): String = when (month) {
    1 -> "January"; 2 -> "February"; 3 -> "March"; 4 -> "April"; 5 -> "May"
    6 -> "June"; 7 -> "July"; 8 -> "August"; 9 -> "September"; 10 -> "October"
    11 -> "November"; else -> "December"
}
