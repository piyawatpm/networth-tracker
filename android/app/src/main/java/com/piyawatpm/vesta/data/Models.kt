package com.piyawatpm.vesta.data

import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.core.nowMs
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.json.Json
import java.time.LocalDate
import java.util.UUID

// Mirrors lib/utils/types.ts and ios Models.swift. Decoding is lenient (old
// rows lack new fields — same reason the web has normalizeIncomeEntry), but
// encoding writes every known field so a round-trip through the native app
// never strips data the web app relies on.

/** One shared Json config: lenient in, full-fidelity out. */
val VestaJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
    isLenient = true
    coerceInputValues = true
}

fun newId(): String = UUID.randomUUID().toString()

@Serializable
data class IncomeEntry(
    val id: String = newId(),
    val type: String = "other",
    val description: String = "",
    val amount: Double = 0.0,
    val currency: String = "AUD",
    val date: String = "",
    val source: String = "",
    val notes: String = "",
    val isPassive: Boolean? = null,
    val isRecurring: Boolean? = null,
    val recurringId: String? = null,
    val createdAt: Double = nowMs(),
    /** Local-only marker for rows projected from the transaction logs.
     *  Must never reach storage — those rows are recomputed, not kept. */
    @Transient val derived: Boolean? = null,
)

@Serializable
data class ExpenseEntry(
    val id: String = newId(),
    val type: String = "other",
    val description: String = "",
    val amount: Double = 0.0,
    val currency: String = "AUD",
    val vendor: String = "",
    val date: String = "",
    val notes: String = "",
    val images: List<String> = emptyList(),
    val createdAt: Double = nowMs(),
    val paymentMethod: String = "other",
    val isRecurring: Boolean? = null,
    val recurringId: String? = null,
    val isOneOff: Boolean? = null,
    /** Written by the quick-add endpoint; preserved so replay dedupe survives edits. */
    val clientId: String? = null,
    val source: String? = null,
)

@Serializable
data class PortfolioHolding(
    val id: String = newId(),
    val name: String = "",
    val ticker: String = "",
    val type: String = "stock",
    val accountType: String = "normal",
    val broker: String = "",
    val country: String = "",
    val link: String = "",
    val units: Double = 0.0,
    val amountInvested: Double = 0.0,
    val currentValue: Double = 0.0,
    val currency: String = "AUD",
    val notes: String = "",
    val createdAt: Double = 0.0,
    val isEmergencyFund: Boolean? = null,
    val isCash: Boolean? = null,
)

@Serializable
data class PortfolioTransaction(
    val id: String = newId(),
    val holdingId: String = "",
    val holdingName: String = "",
    val type: String = "buy", // "buy" | "sell"
    val units: Double = 0.0,
    val pricePerUnit: Double = 0.0,
    val totalAmount: Double = 0.0,
    val currency: String = "AUD",
    val date: String = "",
    val notes: String = "",
    val createdAt: Double = nowMs(),
)

@Serializable
data class DebtRecord(
    val id: String = newId(),
    val person: String = "",
    val direction: String = "i_owe", // "i_owe" | "owed_to_me"
    val reason: String = "",
    val originalAmount: Double = 0.0,
    val currency: String = "AUD",
    val notes: String = "",
    val images: List<String> = emptyList(),
    val createdAt: Double = nowMs(),
)

@Serializable
data class DebtTransaction(
    val id: String = newId(),
    val debtId: String = "",
    val amount: Double = 0.0, // positive = repayment, negative = borrowed more
    val date: String = "",
    val notes: String = "",
    val images: List<String> = emptyList(),
    val createdAt: Double = nowMs(),
)

@Serializable
data class CustomCategory(
    val id: String = newId(),
    val label: String = "",
    val color: String = "#708090",
)

@Serializable
data class CryptoPricesBlob(val prices: Map<String, Double> = emptyMap())

@Serializable
data class NetworthGoal(
    val id: String = newId(),
    val name: String = "",
    val amount: Double = 0.0,
    val currency: String = "AUD",
    val setAt: Double = nowMs(),
    val achievedAt: Double? = null,
    /** Optional deadline (yyyy-MM-dd) — with one set, the forecast page turns
     *  from "when will I get there?" into "what would it take by then?". */
    val targetDate: String? = null,
)

/**
 * A user-defined basket of holdings — "Quantum", "AI", "Dividends" — synced
 * via app_data `portfolio_groups`. Ticker-keyed on purpose: holdings get
 * deleted and re-created (imports), tickers persist.
 */
@Serializable
data class PortfolioGroup(
    val id: String = newId(),
    val name: String = "",
    val tickers: List<String> = emptyList(),
    val createdAt: Double = nowMs(),
)

/** Synced forecast levers (app_data `forecast_assumptions`); null means
 *  "use the measured value". Mirrors lib/utils/forecast.ts. */
@Serializable
data class ForecastAssumptions(
    val annualReturnPct: Double? = null,
    val monthlySaving: Double? = null,
    val contributionGrowthPct: Double = 0.0,
) {
    companion object {
        val default = ForecastAssumptions()
    }
}

/** Recurring income/expense template — enough of it to project the next
 *  occurrence for the "Upcoming" card. Generation stays server-side (cron). */
@Serializable
data class RecurringTemplate(
    val id: String = newId(),
    val description: String = "",
    val amount: Double = 0.0,
    val currency: String = "AUD",
    val frequency: String = "monthly", // weekly | fortnightly | monthly | yearly
    val startDate: String = "",
    val endDate: String? = null,
    val active: Boolean = true,
) {
    /** First occurrence on/after `today`, stepping from startDate. Null when
     *  inactive, expired, or the date string is unparseable. */
    fun nextOccurrence(onOrAfter: String): String? {
        if (!active || startDate.length < 10) return null
        val start = try { LocalDate.parse(startDate.take(10)) } catch (_: Exception) { return null }
        val target = try { LocalDate.parse(onOrAfter.take(10)) } catch (_: Exception) { return null }

        var cursor = start
        // Bounded walk — a weekly template from years back is still < 1e4 steps.
        repeat(10_000) {
            if (!cursor.isBefore(target)) {
                val day = cursor.toString()
                val end = endDate
                if (!end.isNullOrEmpty() && day > end) return null
                return day
            }
            cursor = when (frequency) {
                "weekly" -> cursor.plusDays(7)
                "fortnightly" -> cursor.plusDays(14)
                "yearly" -> cursor.plusYears(1)
                else -> cursor.plusMonths(1)
            }
        }
        return null
    }
}

@Serializable
data class SnapshotPoint(
    val date: String = "",
    val value: Double = 0.0,
    /** Portfolio snapshots only: `value` is EX-super, this includes super —
     *  same split the web's dailySnapshotValues reads. */
    @SerialName("valueWithSuper") val valueWithSuper: Double? = null,
    /** Networth snapshots only: total excluding super. */
    @SerialName("valueNoSuper") val valueNoSuper: Double? = null,
    /** Networth snapshots only: component breakdown (USD). */
    val portfolio: Double? = null,
    val crypto: Double? = null,
)

// MARK: - Category labels/colors (mirrors constants.ts exactly)

object Categories {
    val incomeLabels: List<Pair<String, String>> = listOf(
        "salary" to "Salary", "super_employer" to "Super (Employer)",
        "super_personal" to "Super (Personal)", "arena_bot" to "Arena Bot",
        "arb_bot" to "Arb Bot", "uber" to "Uber", "freelance" to "Freelance",
        "dividend" to "Dividend", "crypto_yield" to "Crypto Yield",
        "interest" to "Interest", "rental" to "Rental", "bonus" to "Bonus",
        "realized_stocks" to "Realized · Stocks",
        "realized_crypto" to "Realized · Crypto", "other" to "Other",
    )

    val expenseLabels: List<Pair<String, String>> = listOf(
        "food" to "Food", "transport" to "Transport", "rent" to "Rent",
        "utilities" to "Utilities", "entertainment" to "Entertainment",
        "shopping" to "Shopping", "health" to "Health", "insurance" to "Insurance",
        "subscriptions" to "Subscriptions", "education" to "Education",
        "travel" to "Travel", "gifts" to "Gifts", "other" to "Other",
    )

    val incomeColorIndex: Map<String, Int> = mapOf(
        "salary" to 0, "super_employer" to 1, "super_personal" to 2, "arena_bot" to 3,
        "arb_bot" to 4, "uber" to 5, "freelance" to 6, "dividend" to 7,
        "crypto_yield" to 8, "interest" to 9, "rental" to 10, "bonus" to 11,
        "realized_stocks" to 13, "realized_crypto" to 14, "other" to 12,
    )

    val expenseColorIndex: Map<String, Int> = mapOf(
        "food" to 0, "transport" to 1, "rent" to 2, "utilities" to 3, "entertainment" to 4,
        "shopping" to 5, "health" to 6, "insurance" to 7, "subscriptions" to 8,
        "education" to 9, "travel" to 10, "gifts" to 11, "other" to 12,
    )

    /** Derived categories can't be hand-picked — they're projected from logs. */
    val derivedIncomeTypes: Set<String> = setOf("realized_stocks", "realized_crypto")

    val paymentMethods: List<Pair<String, String>> = listOf(
        "cash" to "Cash", "debit_card" to "Debit", "credit_card" to "Credit",
        "bank_transfer" to "Transfer", "other" to "Other",
    )
}

/** Today's Sydney date — small alias so form defaults read cleanly. */
fun sydneyToday(): String = SydneyTime.today()
