package com.piyawatpm.vesta.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import kotlin.math.abs

/**
 * Hostplus publishes a daily unit price for each investment option behind its
 * public "investment returns" page — no member login required. Same endpoints
 * the web app uses (see `lib/utils/hostplus.ts`). There is no official
 * developer API, and member balances/units are NOT reachable — only the
 * public unit prices. Flow:
 *   1. GET …investment-returns.irm.auth.json      → short-lived Bearer JWT
 *   2. GET …investment-returns.irm.returns.json   → 5 days of "$1.2345" prices
 * ProductId 13 = Superannuation; frequencyType 1 = daily unit pricing.
 */
object HostplusApi {
    /** Maps a holding's `ticker` to the Hostplus option NAME it tracks. */
    val optionNameByTicker: Map<String, String> = mapOf(
        "HOSTPLUS" to "International Shares - Indexed",
    )

    /** Option CODE per ticker — the key the cron's rolling price-history
     *  blob (`hostplus_price_history`) is stored under. */
    val optionCodeByTicker: Map<String, String> = mapOf(
        "HOSTPLUS" to "HC21A",
    )

    private const val BASE =
        "https://hostplus.com.au/content/hostplus-program/home/members/our-products-and-services/investment-options/investment-returns"

    private const val USER_AGENT =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class ReturnsResponse(val msg: Msg? = null) {
        @Serializable
        data class Msg(val DailyData: List<Section>? = null)

        @Serializable
        data class Section(val Items: List<Item>? = null)

        @Serializable
        data class Item(
            val currentOptionName: String? = null,
            val price: List<String>? = null,
        )
    }

    /** Latest daily unit price (AUD) for every option, keyed by trimmed name. */
    suspend fun latestPrices(productId: Int = 13): Map<String, Double> =
        withContext(Dispatchers.IO) {
            val token = fetchToken()

            val request = Request.Builder()
                .url("$BASE.irm.returns.json?ProductId=$productId&frequencyType=1")
                .header("irm-authorization", "Bearer $token")
                .header("Accept", "application/json")
                .header("User-Agent", USER_AGENT)
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("Hostplus returned HTTP ${response.code}")
                }
                val decoded = json.decodeFromString(
                    ReturnsResponse.serializer(), response.body?.string() ?: ""
                )
                val out = HashMap<String, Double>()
                for (section in decoded.msg?.DailyData.orEmpty()) {
                    for (item in section.Items.orEmpty()) {
                        val name = item.currentOptionName?.trim() ?: continue
                        val last = item.price?.lastOrNull() ?: continue // last = most recent
                        val value = parsePrice(last) ?: continue
                        out[name] = value
                    }
                }
                out
            }
        }

    private fun fetchToken(): String {
        val request = Request.Builder()
            .url("$BASE.irm.auth.json")
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Hostplus returned HTTP ${response.code}")
            }
            val text = response.body?.string() ?: ""
            // The endpoint returns a bare JSON string (the JWT).
            return try {
                json.decodeFromString<String>(text)
            } catch (_: Exception) {
                text.trim('"', '\n', ' ')
            }
        }
    }

    private fun parsePrice(raw: String): Double? =
        raw.replace("$", "").replace(",", "").toDoubleOrNull()

    /**
     * Reprice a holding to `units × price`, calibrating the unit count on
     * first use. Mirrors `repriceHostplusHolding()` in `lib/utils/hostplus.ts`:
     * when `units × price` is >20% off the stored value the units are treated
     * as untrustworthy and back-solved from the value (keeps today's balance);
     * normal daily moves (<5%) never trip it, so it effectively runs once.
     */
    fun reprice(units: Double, currentValue: Double, price: Double): Pair<Double, Double> {
        var u = units
        val implied = u * price
        if (currentValue > 0 && abs(implied - currentValue) / currentValue > 0.2) {
            u = currentValue / price
        }
        return u to u * price
    }
}
