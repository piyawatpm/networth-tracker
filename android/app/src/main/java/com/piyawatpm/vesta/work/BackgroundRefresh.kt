package com.piyawatpm.vesta.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.piyawatpm.vesta.data.DiskCache
import com.piyawatpm.vesta.data.SupabaseApi
import com.piyawatpm.vesta.data.SupabaseConfig
import java.util.concurrent.TimeUnit

/**
 * Headless refresh — the Android stand-in for the iOS BGAppRefreshTask
 * (BackgroundRefresher.run): fetch deltas, merge snapshot history, write the
 * disk cache, exit. No UI state is touched — the app picks the fresh cache up
 * on its next launch, so opening the app shows current numbers instantly.
 */
class BackgroundRefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val api = SupabaseApi(applicationContext)
        try {
            if (!api.restoreSession()) {
                api.signIn(SupabaseConfig.OWNER_EMAIL, SupabaseConfig.OWNER_PASSWORD)
            }
            val cached = DiskCache.load(applicationContext)
            val (changed, stamp) = api.fetchAppData(since = cached?.blobsSyncedAt)
            val blobs = HashMap(cached?.blobs ?: emptyMap())
            blobs.putAll(changed)

            val rates = try {
                api.fetchFxRates()
            } catch (_: Exception) {
                cached?.fxRates ?: emptyMap()
            }

            suspend fun merged(
                type: String,
                current: List<com.piyawatpm.vesta.data.SnapshotPoint>,
            ): List<com.piyawatpm.vesta.data.SnapshotPoint> {
                val fresh = try {
                    api.fetchSnapshotsRaw(type, since = current.lastOrNull()?.date)
                } catch (_: Exception) {
                    emptyList()
                }
                val known = current.mapTo(HashSet()) { it.date }
                return (current + fresh.filter { it.date !in known }).sortedBy { it.date }
            }

            val history = merged("networth", cached?.networthHistory ?: emptyList())
            val portfolioHistory = merged("portfolio", cached?.portfolioHistory ?: emptyList())
            val cryptoHistory = merged("crypto", cached?.cryptoHistory ?: emptyList())

            DiskCache(
                version = DiskCache.CURRENT_VERSION,
                blobs = blobs,
                networthHistory = history,
                portfolioHistory = portfolioHistory,
                cryptoHistory = cryptoHistory,
                fxRates = rates,
                livePrices = cached?.livePrices ?: emptyMap(),
                savedAt = System.currentTimeMillis() / 1000.0,
                blobsSyncedAt = stamp,
            ).save(applicationContext)
            return Result.success()
        } catch (_: Exception) {
            return Result.retry()
        }
    }
}

object BackgroundRefresh {
    /** Every ~2 hours when online — mirrors the iOS earliestBeginDate policy. */
    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<BackgroundRefreshWorker>(2, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "vesta-refresh",
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}
