package com.piyawatpm.vesta.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * The offline quick-add queue — port of ios PendingQueue.swift. Enqueue to
 * disk BEFORE touching the network (the old order silently lost expenses
 * when the process was killed), then try the upload with a hard 6s budget.
 */
class PendingQueue(private val context: Context, private val api: SupabaseApi) {

    private val lock = Mutex()
    private val file: File get() = File(context.filesDir, "pending-expenses.json")

    private fun load(): MutableList<PendingExpense> = try {
        VestaJson.decodeFromString(
            ListSerializer(PendingExpense.serializer()), file.readText()
        ).toMutableList()
    } catch (_: Exception) {
        mutableListOf()
    }

    private fun save(queue: List<PendingExpense>) {
        try {
            file.writeText(VestaJson.encodeToString(ListSerializer(PendingExpense.serializer()), queue))
        } catch (_: Exception) {
        }
    }

    suspend fun count(): Int = lock.withLock { load().size }

    /**
     * Queue the expense durably, then try to deliver it. Returns true when
     * it reached Supabase now; false = saved locally, will sync later.
     */
    suspend fun submit(expense: PendingExpense): Boolean {
        lock.withLock {
            val queue = load()
            queue.add(expense)
            save(queue)
        }
        return try {
            withTimeout(6_000) { api.appendExpense(expense) }
            lock.withLock {
                val queue = load()
                queue.removeAll { it.clientId == expense.clientId }
                save(queue)
            }
            // Opportunistically drain anything older that's still waiting.
            flush()
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Deliver queued expenses oldest-first, stopping at the first failure. */
    suspend fun flush(): Int = withContext(Dispatchers.IO) {
        var delivered = 0
        while (true) {
            val next = lock.withLock { load().firstOrNull() } ?: break
            try {
                withTimeout(10_000) { api.appendExpense(next) }
                lock.withLock {
                    val queue = load()
                    queue.removeAll { it.clientId == next.clientId }
                    save(queue)
                }
                delivered += 1
            } catch (_: Exception) {
                break
            }
        }
        delivered
    }
}

/**
 * The legacy /api/quick-expense client — survives for the Settings screen's
 * "Test connection" round-trip probe (live writes go straight to Supabase).
 * Port of ios QuickExpenseClient.swift.
 */
object QuickExpenseClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    sealed class TestResult {
        data class Ok(val detail: String) : TestResult()
        data class Failed(val reason: String) : TestResult()
    }

    /** GET the endpoint with the bearer token: 200 = configured correctly. */
    suspend fun testConnection(): TestResult = withContext(Dispatchers.IO) {
        val endpoint = Settings.endpoint
            ?: return@withContext TestResult.Failed("No server URL set.")
        val token = Settings.token
            ?: return@withContext TestResult.Failed("No token set — paste QUICK_ADD_TOKEN.")
        try {
            val request = Request.Builder()
                .url(endpoint)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .build()
            client.newCall(request).execute().use { response ->
                when {
                    response.isSuccessful ->
                        TestResult.Ok("Connected — server accepted the token.")
                    response.code == 401 ->
                        TestResult.Failed("Token rejected (401) — check QUICK_ADD_TOKEN.")
                    else ->
                        TestResult.Failed("Server error ${response.code}.")
                }
            }
        } catch (e: Exception) {
            TestResult.Failed(e.message ?: "Network error.")
        }
    }
}
