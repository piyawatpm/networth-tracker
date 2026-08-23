package com.piyawatpm.vesta.core

import java.time.LocalDate
import java.time.YearMonth

/** One month's total for a money flow (income or spend). */
data class MonthFlow(
    val key: String, // "2026-08"
    val label: String, // "Aug"
    val total: Double, // display currency
    val isCurrent: Boolean, // partial — drawn dimmer, labelled "so far"
)

/** One category's slice of one month's bar. */
data class CategorySlice(
    val monthKey: String,
    val monthLabel: String,
    val category: String,
    val total: Double,
    val isCurrent: Boolean,
    /** Topmost segment in its month — it carries the month's total label. */
    val isTop: Boolean,
) {
    val id: String get() = "$monthKey|$category"
}

/** A day's worth of records, with its own subtotal. */
data class DayGroup<T>(
    val id: String, // "2026-08-05"
    val label: String, // "Wed 5 Aug"
    val total: Double,
    val items: List<T>,
)

/**
 * Month arithmetic for the insight cards — pure string/int math, no
 * formatters in loops. Port of ios FlowInsights.swift's FlowMath.
 */
object FlowMath {
    /** The last `count` month keys, oldest → newest, ending at the current month. */
    fun monthKeys(back: Int): List<String> {
        val current = SydneyTime.currentMonthKey()
        val year = current.take(4).toIntOrNull() ?: return listOf(current)
        val month = current.takeLast(2).toIntOrNull() ?: return listOf(current)
        return (back - 1 downTo 0).map { offset ->
            var y = year
            var m = month - offset
            while (m < 1) {
                m += 12
                y -= 1
            }
            "%04d-%02d".format(y, m)
        }
    }

    fun label(key: String): String {
        val m = key.takeLast(2).toIntOrNull() ?: return key
        if (m < 1 || m > 12) return key
        return SydneyTime.monthShortName(m)
    }

    fun dayOfMonth(): Int = SydneyTime.today().takeLast(2).toIntOrNull() ?: 1

    fun daysInCurrentMonth(): Int {
        val today = SydneyTime.today()
        val y = today.take(4).toIntOrNull() ?: return 30
        val m = today.substring(5, 7).toIntOrNull() ?: return 30
        return YearMonth.of(y, m).lengthOfMonth()
    }

    /** Monthly totals over the trailing `months`, from pre-converted rows. */
    fun flows(rows: List<Pair<String, Double>>, months: Int): List<MonthFlow> {
        val byMonth = HashMap<String, Double>()
        for ((date, value) in rows) {
            val key = date.take(7)
            byMonth[key] = (byMonth[key] ?: 0.0) + value
        }
        val current = SydneyTime.currentMonthKey()
        return monthKeys(months).map { key ->
            MonthFlow(
                key = key, label = label(key),
                total = byMonth[key] ?: 0.0,
                isCurrent = key == current,
            )
        }
    }

    /**
     * This month so far vs LAST MONTH THROUGH THE SAME DAY — the honest
     * mid-month comparison. Against last month's full total, every month
     * would start out "down 97%".
     */
    fun pace(rows: List<Pair<String, Double>>): Pair<Double, Double>? {
        val keys = monthKeys(2)
        if (keys.size != 2) return null
        val previous = keys[0]
        val current = keys[1]
        val day = dayOfMonth()

        var currentTotal = 0.0
        var previousTotal = 0.0
        for ((date, value) in rows) {
            val month = date.take(7)
            if (month == current) {
                currentTotal += value
            } else if (month == previous && (date.takeLast(2).toIntOrNull() ?: 32) <= day) {
                previousTotal += value
            }
        }
        if (previousTotal <= 0.01) return null
        return currentTotal to previousTotal
    }

    // MARK: - Search

    /**
     * Does a record match a typed query, dates included? Dates match in every
     * shape a person actually types: "2026-08-05", "5 Aug", "Aug", "August",
     * "2026-08", and the weekday ("Wed").
     */
    fun matches(query: String, fields: List<String>, date: String): Boolean {
        val q = query.lowercase().trim()
        if (q.isEmpty()) return true
        // Every term must hit something — "aug food" narrows, it doesn't widen.
        return q.split(" ").filter { it.isNotEmpty() }.all { term ->
            if (fields.any { it.lowercase().contains(term) }) true
            else dateTokens(date).any { it.contains(term) }
        }
    }

    /** Every string form of a record's date, lowercased. */
    fun dateTokens(date: String): List<String> {
        val day = date.take(10)
        val tokens = mutableListOf(day, day.take(7))
        val parts = day.split("-")
        if (parts.size == 3) {
            val month = parts[1].toIntOrNull()
            if (month != null && month in 1..12) {
                val short = label(day.take(7))
                val dayNumber = parts[2].toIntOrNull()?.toString() ?: parts[2]
                tokens.add(short)
                tokens.add(fullMonthName(month))
                tokens.add("$dayNumber $short")
                SnapshotDate.weekdayIndex(day)?.let { tokens.add(weekdayName(it)) }
            }
        }
        return tokens.map { it.lowercase() }
    }

    // MARK: - Category composition per month

    const val OTHER_CATEGORY = "Other"

    /**
     * Monthly totals split by category, ready to stack. Ranks categories over
     * the WHOLE window and keeps the top `maxCategories`, folding the tail
     * into "Other" — so a category keeps its colour and stacking position as
     * months change.
     */
    fun categoryFlows(
        rows: List<Triple<String, String, Double>>, // (date, category, value)
        months: Int,
        maxCategories: Int = 5,
    ): Pair<List<CategorySlice>, List<String>> {
        val keys = monthKeys(months)
        val window = keys.toSet()
        val byMonthCategory = HashMap<String, HashMap<String, Double>>()
        val overall = HashMap<String, Double>()

        for ((date, category, value) in rows) {
            val month = date.take(7)
            if (month !in window) continue
            val bucket = byMonthCategory.getOrPut(month) { HashMap() }
            bucket[category] = (bucket[category] ?: 0.0) + value
            overall[category] = (overall[category] ?: 0.0) + value
        }

        val ranked = overall.filter { it.value > 0.005 }
            .entries.sortedByDescending { it.value }
            .map { it.key }
        val kept = ranked.take(maxCategories)
        val keptSet = kept.toSet()
        val hasOther = ranked.size > kept.size
        val order = kept + if (hasOther) listOf(OTHER_CATEGORY) else emptyList()

        val current = SydneyTime.currentMonthKey()
        val slices = mutableListOf<CategorySlice>()
        for (key in keys) {
            val totals = HashMap<String, Double>()
            for ((category, value) in byMonthCategory[key] ?: emptyMap()) {
                val bucket = if (category in keptSet) category else OTHER_CATEGORY
                totals[bucket] = (totals[bucket] ?: 0.0) + value
            }
            // Topmost = last non-empty category in stacking order.
            val present = order.filter { (totals[it] ?: 0.0) > 0.005 }
            for (category in present) {
                slices.add(
                    CategorySlice(
                        monthKey = key,
                        monthLabel = label(key),
                        category = category,
                        total = totals[category] ?: 0.0,
                        isCurrent = key == current,
                        isTop = category == present.lastOrNull(),
                    )
                )
            }
        }
        return slices to order
    }

    // MARK: - Day grouping

    private val weekdayNames = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

    /** "2026-08-05" → "Wed 5 Aug". Integer weekday math, no formatter. */
    fun dayLabel(ymd: String): String {
        val day = ymd.take(10)
        val parts = day.split("-")
        if (parts.size != 3) return day
        val d = parts[2].toIntOrNull() ?: return day
        val weekday = SnapshotDate.weekdayIndex(day) ?: return day
        return "${weekdayNames[weekday]} $d ${label(day.take(7))}"
    }

    fun weekdayName(index: Int): String = weekdayNames[index.coerceIn(0, 6)]

    /**
     * How many times each weekday occurred between two days, inclusive —
     * the denominator for a per-weekday average. The current month stops at
     * today, so a Monday that hasn't happened yet isn't counted against you.
     */
    fun weekdayOccurrences(from: String, to: String): List<Int> {
        val counts = IntArray(7)
        var date = try { LocalDate.parse(from.take(10)) } catch (_: Exception) { return counts.toList() }
        val last = try { LocalDate.parse(to.take(10)) } catch (_: Exception) { return counts.toList() }
        if (date.isAfter(last)) return counts.toList()
        while (!date.isAfter(last)) {
            SnapshotDate.weekdayIndex(date.toString())?.let { counts[it] += 1 }
            date = date.plusDays(1)
        }
        return counts.toList()
    }

    /** Last day of a month key ("2026-08" → "2026-08-31"). */
    fun lastDay(ofMonth: String): String {
        val year = ofMonth.take(4).toIntOrNull() ?: return ofMonth
        val month = ofMonth.takeLast(2).toIntOrNull() ?: return ofMonth
        val lengths = intArrayOf(31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
        var days = lengths[(month - 1).coerceIn(0, 11)]
        if (month == 2 && ((year % 4 == 0 && year % 100 != 0) || year % 400 == 0)) days = 29
        return "%s-%02d".format(ofMonth, days)
    }

    /**
     * Bucket records into days, newest first, each with a subtotal — turns an
     * endless feed into something scannable.
     */
    fun <T> groupByDay(
        items: List<T>,
        date: (T) -> String,
        value: (T) -> Double,
    ): List<DayGroup<T>> {
        val buckets = HashMap<String, MutableList<T>>()
        for (item in items) {
            buckets.getOrPut(date(item).take(10)) { mutableListOf() }.add(item)
        }
        return buckets.keys.sortedDescending().map { day ->
            val rows = buckets[day] ?: emptyList()
            DayGroup(
                id = day,
                label = dayLabel(day),
                total = rows.sumOf { value(it) },
                items = rows,
            )
        }
    }
}
