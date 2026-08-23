package com.piyawatpm.vesta.data

import android.content.Context
import com.piyawatpm.vesta.core.nowMs
import com.piyawatpm.vesta.core.sydneyDay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit

// Direct Supabase REST + GoTrue client, port of ios SupabaseAPI.swift.
// Deliberately dependency-free beyond OkHttp: the three endpoints this app
// needs (password grant, token refresh, app_data reads/writes) don't justify
// an SDK.
//
// The publishable key is public by design — it ships in the web bundle today.
// Access control comes from the user JWT once RLS is applied; this client
// already authenticates every data request, so the native app keeps working
// the day the anon door closes.

object SupabaseConfig {
    const val URL = "https://aqxxshuiyyqbnpscoqxz.supabase.co"
    const val PUBLISHABLE_KEY = "sb_publishable_HlxRYJjza0p7nSoS2F7DKg_m7p76xdO"

    // Baked-in owner credentials so the app never shows a login screen.
    // Single-user app on the owner's own device: the phone's lock screen is
    // the real gate. If the password ever changes, the sign-in form
    // reappears as a fallback rather than bricking the app. (Same convention
    // as the iOS app — see ios SupabaseAPI.swift.)
    const val OWNER_EMAIL = "redacted@example.com"
    const val OWNER_PASSWORD = "ROTATED-AND-REDACTED"
}

@Serializable
data class AuthSession(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_at") val expiresAt: Double, // unix seconds
)

class SupabaseException(val code: Int, message: String) : IOException(message)
class NotSignedInException : IOException("Signed out.")
class BadCredentialsException(message: String) : IOException(message)

/** A queued quick-add expense — mirrors ios PendingExpense. */
@Serializable
data class PendingExpense(
    val clientId: String = newId(),
    val amount: Double,
    val type: String,
    val vendor: String = "",
    val note: String = "",
    val currency: String = "AUD",
    val createdAt: Double = nowMs(),
) {
    val dateString: String get() = sydneyDay(createdAt)
}

class SupabaseApi(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMedia = "application/json".toMediaType()

    @Volatile
    private var session: AuthSession? = null
    private val sessionLock = Mutex()

    // MARK: - Session persistence (app-private file; excluded from backup
    // via dataExtractionRules — the Android stand-in for the iOS Keychain).

    private val sessionFile: File get() = File(context.filesDir, "vesta-session.json")

    private fun persistSession() {
        val current = session
        try {
            if (current == null) {
                sessionFile.delete()
            } else {
                sessionFile.writeText(json.encodeToString(AuthSession.serializer(), current))
            }
        } catch (_: Exception) {
        }
    }

    fun restoreSession(): Boolean {
        return try {
            val stored = json.decodeFromString(
                AuthSession.serializer(), sessionFile.readText()
            )
            session = stored
            true
        } catch (_: Exception) {
            false
        }
    }

    fun signOut() {
        session = null
        sessionFile.delete()
    }

    val isSignedIn: Boolean get() = session != null

    // MARK: - Auth

    suspend fun signIn(email: String, password: String) = withContext(Dispatchers.IO) {
        val url = "${SupabaseConfig.URL}/auth/v1/token".toHttpUrl().newBuilder()
            .addQueryParameter("grant_type", "password")
            .build()
        val body = buildJsonObject {
            put("email", email)
            put("password", password)
        }.toString().toRequestBody(jsonMedia)
        val request = Request.Builder()
            .url(url)
            .post(body)
            .header("apikey", SupabaseConfig.PUBLISHABLE_KEY)
            .header("Content-Type", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            val text = response.body?.string() ?: ""
            if (!response.isSuccessful) {
                val detail = try {
                    json.parseToJsonElement(text)
                } catch (_: Exception) {
                    null
                }
                val message = detail?.let {
                    val obj = it as? kotlinx.serialization.json.JsonObject
                    (obj?.get("error_description") ?: obj?.get("msg"))
                        ?.toString()?.trim('"')
                } ?: "Sign-in failed (${response.code})."
                throw BadCredentialsException(message)
            }
            session = json.decodeFromString(AuthSession.serializer(), text)
            persistSession()
        }
    }

    private suspend fun refreshIfNeeded() {
        val current = session ?: throw NotSignedInException()
        // 60s of slack so a token that expires mid-request gets renewed first.
        if (current.expiresAt - System.currentTimeMillis() / 1000.0 >= 60) return

        sessionLock.withLock {
            val locked = session ?: throw NotSignedInException()
            if (locked.expiresAt - System.currentTimeMillis() / 1000.0 >= 60) return

            withContext(Dispatchers.IO) {
                val url = "${SupabaseConfig.URL}/auth/v1/token".toHttpUrl().newBuilder()
                    .addQueryParameter("grant_type", "refresh_token")
                    .build()
                val body = buildJsonObject {
                    put("refresh_token", locked.refreshToken)
                }.toString().toRequestBody(jsonMedia)
                val request = Request.Builder()
                    .url(url)
                    .post(body)
                    .header("apikey", SupabaseConfig.PUBLISHABLE_KEY)
                    .header("Content-Type", "application/json")
                    .build()
                client.newCall(request).execute().use { response ->
                    val text = response.body?.string() ?: ""
                    if (!response.isSuccessful) {
                        // Refresh token burned (revoked / already used) — force
                        // re-login rather than looping on a dead session.
                        signOut()
                        throw NotSignedInException()
                    }
                    session = json.decodeFromString(AuthSession.serializer(), text)
                    persistSession()
                }
            }
        }
    }

    // MARK: - REST

    private suspend fun restRequest(
        method: String,
        path: String,
        query: List<Pair<String, String>>,
        body: String? = null,
    ): String {
        refreshIfNeeded()
        val current = session ?: throw NotSignedInException()

        val urlBuilder: HttpUrl.Builder =
            "${SupabaseConfig.URL}/rest/v1/$path".toHttpUrl().newBuilder()
        for ((name, value) in query) urlBuilder.addQueryParameter(name, value)

        val builder = Request.Builder()
            .url(urlBuilder.build())
            .header("apikey", SupabaseConfig.PUBLISHABLE_KEY)
            .header("Authorization", "Bearer ${current.accessToken}")
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post((body ?: "").toRequestBody(jsonMedia))
            "PATCH" -> builder.patch((body ?: "").toRequestBody(jsonMedia))
            else -> throw IllegalArgumentException("method $method")
        }

        return withContext(Dispatchers.IO) {
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string() ?: ""
                if (!response.isSuccessful) {
                    throw SupabaseException(response.code, "Server error ${response.code}: $text")
                }
                text
            }
        }
    }

    /** One blob without pulling the whole table. */
    suspend fun fetchAppDataValue(key: String): String? {
        val data = restRequest(
            "GET", "app_data",
            listOf("key" to "eq.$key", "select" to "value"),
        )
        @Serializable
        data class Row(val value: String? = null)
        return json.decodeFromString<List<Row>>(data).firstOrNull()?.value
    }

    /** Ensure a usable session: restored from disk, else the baked owner sign-in. */
    suspend fun ensureSession() {
        if (session != null || restoreSession()) return
        signIn(SupabaseConfig.OWNER_EMAIL, SupabaseConfig.OWNER_PASSWORD)
    }

    /**
     * Append one quick-add expense straight to the blob — the token-free
     * replacement for the /api/quick-expense endpoint. Same idempotency
     * contract: a replayed clientId is acknowledged, never double-added.
     */
    suspend fun appendExpense(pending: PendingExpense) {
        ensureSession()

        var entries: List<ExpenseEntry> = emptyList()
        fetchAppDataValue("expense_entries")?.let { raw ->
            entries = try {
                VestaJson.decodeFromString(raw)
            } catch (_: Exception) {
                emptyList()
            }
        }
        if (entries.any { it.clientId == pending.clientId }) return

        val updated = entries + ExpenseEntry(
            type = pending.type,
            description = pending.note,
            amount = Math.round(pending.amount * 100.0) / 100.0,
            currency = pending.currency,
            vendor = pending.vendor,
            date = pending.dateString,
            paymentMethod = "other",
            clientId = pending.clientId,
            source = "android",
        )
        writeAppData("expense_entries", VestaJson.encodeToString(updated))
    }

    /**
     * KV blobs — ALL of them when `since` is null, otherwise only rows whose
     * updated_at moved past it. Returns the newest updated_at seen, to thread
     * into the next call.
     */
    suspend fun fetchAppData(since: String? = null): Pair<Map<String, String>, String?> {
        // A "+00:00" offset in a query string decodes to a SPACE server-side.
        // Normalize to the Z suffix; a watermark that still carries a "+"
        // after that can't be sent safely — drop it and fetch everything.
        fun urlSafe(stamp: String): String? {
            val z = stamp.replace("+00:00", "Z")
            return if (z.contains("+")) null else z
        }

        val query = mutableListOf("select" to "key,value,updated_at")
        if (since != null) {
            urlSafe(since)?.let { query.add("updated_at" to "gt.$it") }
        }
        val data = restRequest("GET", "app_data", query)

        @Serializable
        data class Row(
            val key: String,
            val value: String? = null,
            @SerialName("updated_at") val updatedAt: String? = null,
        )

        val rows = json.decodeFromString<List<Row>>(data)
        val result = HashMap<String, String>()
        var maxStamp: String? = since
        for (row in rows) {
            result[row.key] = row.value ?: ""
            val stamp = row.updatedAt
            if (stamp != null && stamp > (maxStamp ?: "")) maxStamp = stamp
        }
        // Store the watermark pre-normalized so the cache never holds a "+".
        return result to maxStamp?.let { urlSafe(it) }
    }

    /** Read-modify-write of one blob. Same last-write-wins semantics the web
     *  app's own debounced persist has. */
    suspend fun writeAppData(key: String, value: String) {
        val iso = Instant.now().toString()
        val body = buildJsonObject {
            put("value", value)
            put("updated_at", iso)
        }.toString()
        val returned = restRequest(
            "PATCH", "app_data",
            listOf("key" to "eq.$key"),
            body,
        )
        // Zero rows patched = the key doesn't exist yet — insert it.
        val wasEmpty = try {
            json.parseToJsonElement(returned).let {
                (it as? kotlinx.serialization.json.JsonArray)?.isEmpty() ?: false
            }
        } catch (_: Exception) {
            false
        }
        if (wasEmpty) {
            val insert = buildJsonObject {
                put("key", key)
                put("value", value)
                put("updated_at", iso)
            }.toString()
            restRequest("POST", "app_data", emptyList(), insert)
        }
    }

    /**
     * Raw snapshot rows, intraday granularity, ascending (values are USD).
     * The cron writes a snapshot every few MINUTES — so page newest-first
     * until history is exhausted or `since` is passed; an incremental refresh
     * usually costs one page.
     */
    suspend fun fetchSnapshotsRaw(
        type: String,
        since: String?,
        maxPages: Int = 30,
    ): List<SnapshotPoint> {
        @Serializable
        data class Row(
            val date: String,
            val value: Double,
            @SerialName("value_with_super") val valueWithSuper: Double? = null,
            @SerialName("value_no_super") val valueNoSuper: Double? = null,
            val portfolio: Double? = null,
            val crypto: Double? = null,
        )

        val all = mutableListOf<SnapshotPoint>()
        for (page in 0 until maxPages) {
            val data = restRequest(
                "GET", "snapshots",
                listOf(
                    "type" to "eq.$type",
                    "select" to "date,value,value_with_super,value_no_super,portfolio,crypto",
                    "order" to "date.desc",
                    "limit" to "1000",
                    "offset" to (page * 1000).toString(),
                ),
            )
            val rows = json.decodeFromString<List<Row>>(data)
            all.addAll(rows.map {
                SnapshotPoint(
                    date = it.date, value = it.value,
                    valueWithSuper = it.valueWithSuper, valueNoSuper = it.valueNoSuper,
                    portfolio = it.portfolio, crypto = it.crypto,
                )
            })
            if (rows.size < 1000) break
            val oldest = rows.lastOrNull()?.date
            if (since != null && oldest != null && oldest <= since) break
        }
        val filtered = if (since != null) all.filter { it.date > since } else all
        return filtered.sortedBy { it.date }
    }

    /** Daily closes — one point per day, last reading of the day wins. */
    suspend fun fetchSnapshots(type: String): List<SnapshotPoint> {
        val raw = fetchSnapshotsRaw(type, since = null)
        val byDay = LinkedHashMap<String, Double>()
        for (row in raw) byDay[row.date.take(10)] = row.value
        return byDay.map { SnapshotPoint(date = it.key, value = it.value) }
            .sortedBy { it.date }
    }

    /** FX rates, same source as the web (open.er-api.com, USD-based). */
    suspend fun fetchFxRates(): Map<String, Double> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("https://open.er-api.com/v6/latest/USD")
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string() ?: throw IOException("no body")
            @Serializable
            data class ResponseBody(val rates: Map<String, Double>)
            json.decodeFromString<ResponseBody>(text).rates
        }
    }

    /**
     * Live spot prices from Binance's public bulk ticker, token → USD.
     * The `crypto_prices` blob is only as fresh as the last web session —
     * live quotes fix that. Unknown symbols just miss; the holdings CSV's
     * stored value covers them.
     */
    suspend fun fetchBinancePrices(
        tokens: List<String>,
        mappings: Map<String, String>,
    ): Map<String, Double> = withContext(Dispatchers.IO) {
        if (tokens.isEmpty()) return@withContext emptyMap()
        val symbolToToken = HashMap<String, String>()
        for (token in tokens) {
            // Mappings resolve display names to BASE symbols ("Hyperliquid" →
            // "HYPE"); the USDT pair suffix is added here, never by the blob.
            val base = (mappings[token] ?: token).uppercase().replace(" ", "")
            if (base.length in 2..12 && base.all { it.isLetterOrDigit() }) {
                symbolToToken["${base}USDT"] = token
            }
        }
        if (symbolToToken.isEmpty()) return@withContext emptyMap()

        @Serializable
        data class Ticker(val symbol: String, val price: String)

        val list = symbolToToken.keys.sorted()
            .joinToString(",") { "%22$it%22" }
        var tickers: List<Ticker> = emptyList()

        fun fetch(url: String): List<Ticker>? = try {
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (response.code != 200) null
                else response.body?.string()?.let { json.decodeFromString<List<Ticker>>(it) }
            }
        } catch (_: Exception) {
            null
        }

        // Binance 400s the WHOLE request if ANY symbol is unknown, so fall
        // back to fetching everything and filtering — one extra round trip,
        // but immune to a bad ticker mapping poisoning the batch.
        tickers = fetch("https://api.binance.com/api/v3/ticker/price?symbols=%5B$list%5D")
            ?: (fetch("https://api.binance.com/api/v3/ticker/price")
                ?.filter { symbolToToken.containsKey(it.symbol) }
                ?: emptyList())

        val result = HashMap<String, Double>()
        for (ticker in tickers) {
            val token = symbolToToken[ticker.symbol] ?: continue
            ticker.price.toDoubleOrNull()?.let { result[token] = it }
        }
        result
    }
}
