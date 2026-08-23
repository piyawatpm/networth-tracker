package com.piyawatpm.vesta.ui.theme

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * OKX-style palette: pure black stage, elevated near-black cards, volt lime
 * for money-up, hot pink for money-down. Dark-only by design — MainActivity
 * pins the scheme so every system control matches. Mirrors ios Theme.swift.
 */
object Ledger {
    val background = Color(0xFF000000)
    val card = Color(0xFF1A1A1D)
    val income = Color(0xFFCDF546) // volt
    val expense = Color(0xFFFB3D7B) // hot pink
    val subtle = Color.White.copy(alpha = 0.55f)

    // Chart series identity — categorical slots validated all-pairs for CVD
    // against this dark surface. Deliberately NOT volt/pink: those carry
    // polarity (gain/loss).
    val seriesStocks = Color(0xFF3987E5) // blue
    val seriesCrypto = Color(0xFFD95926) // orange
    val seriesDebt = Color(0xFF199E70) // aqua

    /** CHART_COLORS from lib/utils/constants.ts, same order — category colors
     *  must match the web app or the same donut tells two different stories. */
    val chartHex: List<String> = listOf(
        "#b8860b", "#2e8b57", "#cd5c5c", "#8b5e3c", "#6b8e23", "#708090",
        "#9e5e8e", "#c4a35a", "#2e7d5b", "#c05040", "#5f6b80", "#c4943a",
        "#2e7d7b", "#4f7cac", "#8f6bb0",
    )

    fun chartColor(index: Int): Color =
        colorFromHex(chartHex[((index % chartHex.size) + chartHex.size) % chartHex.size])

    /** Same deterministic fallback as the web's useCategories (hashCode % n),
     *  so custom categories keep their color across platforms. */
    fun hashedColor(id: String): Color {
        var hash = 0
        for (scalar in id) {
            hash = (hash shl 5) - hash + scalar.code
        }
        return chartColor(if (hash == Int.MIN_VALUE) 0 else kotlin.math.abs(hash))
    }

    fun colorFromHex(hex: String): Color {
        val cleaned = hex.filter { it.isLetterOrDigit() }
        val value = cleaned.toLongOrNull(16) ?: 0L
        return Color(
            red = ((value shr 16) and 0xFF).toInt() / 255f,
            green = ((value shr 8) and 0xFF).toInt() / 255f,
            blue = (value and 0xFF).toInt() / 255f,
        )
    }
}

/** OKX-style elevated card: near-black rounded surface on the pure-black stage. */
fun Modifier.financeCard(cornerRadius: Dp = 20.dp): Modifier =
    this
        .clip(RoundedCornerShape(cornerRadius))
        .background(Ledger.card)
        .border(1.dp, Color.White.copy(alpha = 0.05f), RoundedCornerShape(cornerRadius))

/** The web app's `label-mono`: small uppercase mono section labels. */
@Composable
fun LabelMono(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        modifier = modifier,
        fontSize = 10.sp,
        fontWeight = FontWeight.Medium,
        fontFamily = FontFamily.Monospace,
        letterSpacing = 0.8.sp,
        color = Ledger.subtle,
    )
}

/** Decoded logos kept in memory across renders — AsyncImage-per-render
 *  re-decoded ~19 logos on every price tick on iOS; same reasoning here. */
object LogoCache {
    private val cache = LruCache<String, ImageBitmap>(160)
    private val inFlight = HashSet<String>()
    private val lock = Mutex()
    private val client = OkHttpClient()

    fun image(url: String): ImageBitmap? = cache.get(url)

    suspend fun load(url: String): ImageBitmap? {
        cache.get(url)?.let { return it }
        lock.withLock {
            if (url in inFlight) return null
            inFlight.add(url)
        }
        try {
            return withContext(Dispatchers.IO) {
                try {
                    val response = client.newCall(
                        Request.Builder().url(url).build()
                    ).execute()
                    response.use {
                        if (!it.isSuccessful) return@withContext null
                        val bytes = it.body?.bytes() ?: return@withContext null
                        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                            ?: return@withContext null
                        val image = bitmap.asImageBitmap()
                        cache.put(url, image)
                        image
                    }
                } catch (_: Exception) {
                    null
                }
            }
        } finally {
            lock.withLock { inFlight.remove(url) }
        }
    }
}

/**
 * Circular asset logo with a monogram fallback, so rows never show a blank
 * hole while the image loads (or when a token has no image yet).
 */
@Composable
fun LogoCircle(url: String?, fallback: String, size: Dp = 26.dp) {
    val image by produceState<ImageBitmap?>(initialValue = url?.let { LogoCache.image(it) }, url) {
        if (url != null && value == null) {
            value = LogoCache.load(url)
        }
    }
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(Ledger.hashedColor(fallback).copy(alpha = 0.22f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = fallback.take(2).uppercase(),
            fontSize = (size.value * 0.34f).sp,
            fontWeight = FontWeight.Bold,
            color = Ledger.hashedColor(fallback),
        )
        image?.let {
            Image(
                bitmap = it,
                contentDescription = null,
                modifier = Modifier.size(size).clip(CircleShape),
                contentScale = ContentScale.Crop,
            )
        }
    }
}
