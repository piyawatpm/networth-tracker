package com.piyawatpm.vesta.core

import com.piyawatpm.vesta.data.ForecastAssumptions
import com.piyawatpm.vesta.data.NetworthGoal
import com.piyawatpm.vesta.data.VestaStore
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.abs
import kotlin.math.pow

// Compound net-worth forecast — line-for-line port of lib/utils/forecast.ts
// (which carries the test suite). One monthly simulation answers every
// question: forward ("when do I get there?") and inverse ("what saving /
// return would get me there by then?", by bisection over the same walk), so
// the answers can never disagree with each other.

data class ForecastInputs(
    val netWorth: Double,
    val monthlySaving: Double,
    val annualReturnPct: Double,
    val contributionGrowthPct: Double,
)

object ForecastMath {
    const val MAX_MONTHS = 100 * 12

    fun monthlyRate(annualPct: Double): Double = (1 + annualPct / 100).pow(1.0 / 12) - 1

    /** Net worth after each month (index 0 = today) with and without growth. */
    fun projectPath(inputs: ForecastInputs, months: Int): Pair<List<Double>, List<Double>> {
        val r = monthlyRate(inputs.annualReturnPct)
        val withGrowth = ArrayList<Double>(months + 1).apply { add(inputs.netWorth) }
        val savingsOnly = ArrayList<Double>(months + 1).apply { add(inputs.netWorth) }
        var nw = inputs.netWorth
        var flat = inputs.netWorth
        var saving = inputs.monthlySaving
        for (m in 1..months) {
            if (m > 1 && (m - 1) % 12 == 0) saving *= 1 + inputs.contributionGrowthPct / 100
            nw = nw * (1 + r) + saving
            flat += saving
            withGrowth.add(nw)
            savingsOnly.add(flat)
        }
        return withGrowth to savingsOnly
    }

    /** Months until `target` is first reached; 0 if already there; null if
     *  the path never gets there inside the horizon. */
    fun monthsToReach(inputs: ForecastInputs, target: Double): Int? {
        if (inputs.netWorth >= target) return 0
        val r = monthlyRate(inputs.annualReturnPct)
        var nw = inputs.netWorth
        var saving = inputs.monthlySaving
        for (m in 1..MAX_MONTHS) {
            if (m > 1 && (m - 1) % 12 == 0) saving *= 1 + inputs.contributionGrowthPct / 100
            nw = nw * (1 + r) + saving
            if (nw >= target) return m
        }
        return null
    }

    fun requiredMonthlySaving(
        netWorth: Double,
        annualReturnPct: Double,
        contributionGrowthPct: Double,
        target: Double,
        months: Int,
    ): Double? {
        if (months <= 0) return null
        fun reaches(saving: Double): Boolean {
            val inputs = ForecastInputs(netWorth, saving, annualReturnPct, contributionGrowthPct)
            return (monthsToReach(inputs, target) ?: Int.MAX_VALUE) <= months
        }
        if (reaches(0.0)) return 0.0
        var lo = 0.0
        var hi = maxOf(1.0, target)
        if (!reaches(hi)) return null
        repeat(60) {
            val mid = (lo + hi) / 2
            if (reaches(mid)) hi = mid else lo = mid
        }
        return hi
    }

    fun requiredAnnualReturn(
        netWorth: Double,
        monthlySaving: Double,
        contributionGrowthPct: Double,
        target: Double,
        months: Int,
    ): Double? {
        if (months <= 0) return null
        fun reaches(pct: Double): Boolean {
            val inputs = ForecastInputs(netWorth, monthlySaving, pct, contributionGrowthPct)
            return (monthsToReach(inputs, target) ?: Int.MAX_VALUE) <= months
        }
        var lo = -50.0
        var hi = 100.0
        if (reaches(lo)) return lo
        if (!reaches(hi)) return null
        repeat(60) {
            val mid = (lo + hi) / 2
            if (reaches(mid)) hi = mid else lo = mid
        }
        return hi
    }

    fun describe(months: Int): String {
        if (months <= 0) return "now"
        val y = months / 12
        val m = months % 12
        if (y == 0) return "$m month${if (m == 1) "" else "s"}"
        if (m == 0) return "$y year${if (y == 1) "" else "s"}"
        return "${y}y ${m}m"
    }

    /** Growth of net worth beyond deposits, annualized; null under 90 days. */
    fun measuredAnnualPacePct(
        nwStart: Double,
        nwEnd: Double,
        netSavings: Double,
        windowDays: Double,
    ): Double? {
        if (windowDays < 90) return null
        val avg = (nwStart + nwEnd) / 2
        if (avg <= 0) return null
        val pct = (nwEnd - nwStart - netSavings) / avg * (365 / windowDays) * 100
        return if (pct.isFinite()) pct else null
    }

    /** Only months with BOTH income and expenses logged count — a month with
     *  income and zero expenses predates expense tracking and would inflate
     *  the pace. Falls back to income months when fewer than two qualify. */
    fun measuredMonthlySaving(monthly: List<Pair<Double, Double>>): Double? {
        val complete = monthly.filter { it.first > 0 && it.second > 0 }
        val pool = if (complete.size >= 2) complete else monthly.filter { it.first > 0 }
        if (pool.isEmpty()) return null
        return pool.sumOf { it.first - it.second } / pool.size
    }

    const val FALLBACK_RETURN_PCT = 7.0

    data class Preset(val label: String, val pct: Double, val note: String)

    val presets = listOf(
        Preset("Cautious", 4.0, "bonds-heavy, or a rough decade"),
        Preset("Balanced", 7.0, "long-run diversified equities"),
        Preset("Aggressive", 10.0, "all-in growth, in a good era"),
    )

    fun addMonths(months: Int): LocalDate = LocalDate.now(SydneyTime.zone).plusMonths(months.toLong())

    fun monthYear(date: LocalDate): String =
        "${SydneyTime.monthShortName(date.monthValue)} ${date.year}"

    fun monthsUntil(ymd: String): Int? {
        val target = try { LocalDate.parse(ymd.take(10)) } catch (_: Exception) { return null }
        val today = LocalDate.now(SydneyTime.zone)
        return (YearMonth.from(target).let { t ->
            val base = YearMonth.from(today)
            (t.year - base.year) * 12 + (t.monthValue - base.monthValue)
        })
    }
}

// MARK: - Measured inputs from the store (ios DataStore extension port)

data class MeasuredPace(
    val monthlySaving: Double?,
    val pacePct: Double?,
    val paceDays: Double,
)

/** The measured pace is a trustworthy DEFAULT only once a full year is
 *  behind it — four months of a crypto dip annualised would otherwise
 *  headline a 15-year forecast. */
const val MEASURED_PACE_MIN_DAYS = 365.0

/** The honest inputs: saving from the ledgers, pace from the net-worth
 *  history — both in the display currency. Same definitions as the web. */
val VestaStore.measuredPace: MeasuredPace
    get() {
        // Last six complete months (exclude the current, partial one).
        val months = FlowMath.monthKeys(7).dropLast(1)
        val monthly = months.map { key ->
            monthTotal(income, key) to monthTotalExpenses(key)
        }
        val saving = ForecastMath.measuredMonthlySaving(monthly)

        // Pace: latest reading vs ~180 days back (or as far as history goes).
        var pace: Double? = null
        var days = 0.0
        val series = networthParsed
        val last = series.lastOrNull()
        if (last != null && series.size > 1) {
            val wanted = last.date - 180L * 86400_000L
            val start = series.firstOrNull { it.date >= wanted } ?: series[0]
            days = (last.date - start.date) / 86400_000.0
            val startKey = sydneyDay(start.date.toDouble())
            val endKey = sydneyDay(last.date.toDouble())
            val earned = income
                .filter { it.date >= startKey && it.date <= endKey }
                .sumOf { convert(it.amount, it.currency) }
            val spent = expenses
                .filter { it.date >= startKey && it.date <= endKey }
                .sumOf { convert(it.amount, it.currency) }
            pace = ForecastMath.measuredAnnualPacePct(
                nwStart = convert(start.valueUsd, "USD"),
                nwEnd = convert(last.valueUsd, "USD"),
                netSavings = earned - spent,
                windowDays = days,
            )
        }
        return MeasuredPace(saving, pace, days)
    }

/** Full net worth incl. super — a decades-scale forecast should count
 *  everything owned, whatever the Invest tab's toggle says today. */
val VestaStore.forecastNetWorth: Double
    get() = stocksValue + cryptoValue + debtNet

/** The effective levers: overrides win, measured values fill the gaps,
 *  the balanced preset is the last resort. */
val VestaStore.forecastInputs: ForecastInputs
    get() {
        val measured = measuredPace
        val a: ForecastAssumptions = forecastAssumptions
        val measuredDefault =
            if (measured.paceDays >= MEASURED_PACE_MIN_DAYS) measured.pacePct else null
        return ForecastInputs(
            netWorth = forecastNetWorth,
            monthlySaving = a.monthlySaving ?: measured.monthlySaving ?: 0.0,
            annualReturnPct = a.annualReturnPct ?: measuredDefault
                ?: ForecastMath.FALLBACK_RETURN_PCT,
            contributionGrowthPct = a.contributionGrowthPct,
        )
    }

/** The goal the forecast is aimed at: the nearest active one. */
val VestaStore.forecastGoal: NetworthGoal?
    get() = goals.filter { it.achievedAt == null }
        .minByOrNull { convert(it.amount, it.currency) }

/** Is the current return input exactly the measured pace? */
fun VestaStore.usingMeasuredReturn(inputs: ForecastInputs, measured: MeasuredPace): Boolean {
    val pace = measured.pacePct ?: return false
    return abs(inputs.annualReturnPct - pace) < 0.0001
}
