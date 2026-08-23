package com.piyawatpm.vesta.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.data.ParsedPoint
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.financeCard
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Same period set, cutoffs and downsampling as the web dashboard's
 * performance-chart: 1D every intraday point, then hourly / 4-hourly /
 * 12-hourly / daily closes. Keep first point + each bucket's close.
 */
enum class ChartPeriod(val label: String) {
    D1("1D"), W1("1W"), M1("1M"), M6("6M"), Y1("1Y"), ALL("All");

    val cutoffSeconds: Long?
        get() = when (this) {
            D1 -> 86400L
            W1 -> 7 * 86400L
            M1 -> 30 * 86400L
            M6 -> 180 * 86400L
            Y1 -> 365 * 86400L
            ALL -> null
        }

    val bucketSeconds: Long
        get() = when (this) {
            D1 -> 0L // every point
            W1 -> 3600L
            M1 -> 4 * 3600L
            M6 -> 12 * 3600L
            Y1, ALL -> 24 * 3600L
        }

    /** Same wording as the web's PnL badge. */
    val pnlLabel: String
        get() = when (this) {
            D1 -> "Today"; W1 -> "7D"; M1 -> "30D"; M6 -> "6M"; Y1 -> "1Y"; ALL -> "All-time"
        }
}

/** How the plot resolves series of different magnitudes: raw currency, or
 *  every series re-based to 0% at the window's start. */
enum class ChartMode { VALUE, INDEXED }

/** A component of net worth drawn alongside it. */
data class ChartOverlay(
    val name: String,
    val color: Color,
    val points: List<ParsedPoint>,
    val form: Form = Form.LINE,
) {
    enum class Form {
        /** A peer line on the main plot. */
        LINE,

        /** A balance that holds flat between discrete events, an order of
         *  magnitude smaller: its own step-area strip beneath the main plot.
         *  Debt is the case this exists for — interpolation, scale, and
         *  polarity all break when it's drawn as a peer line. */
        STEP_STRIP,
    }
}

private data class ChartPoint(val date: Long, val value: Double)

/**
 * One pot's value-over-time card: scrub-aware hero number, neon hero line,
 * optional component lines with a per-series legend, desktop-parity periods.
 * Port of ios HistoryChartCard.
 */
@Composable
fun HistoryChartCard(
    store: VestaStore,
    title: String,
    parsed: List<ParsedPoint>,
    liveValue: Double,
    heroSize: TextUnit = 34.sp,
    showUpdatedStamp: Boolean = false,
    overlays: List<ChartOverlay> = emptyList(),
) {
    var period by rememberSaveable(title) { mutableStateOf(ChartPeriod.D1) }
    var scrubDate by remember { mutableStateOf<Long?>(null) }
    var hiddenOverlays by rememberSaveable(title) { mutableStateOf(setOf<String>()) }
    var modeOverride by remember { mutableStateOf<ChartMode?>(null) }

    // The window's points, recomputed when inputs change — the Compose
    // equivalent of the atomic RenderState swap.
    val heroRaw by remember(parsed, period, store.lastRefreshed, store.displayCurrency, store.fxEpoch) {
        derivedStateOf {
            val now = System.currentTimeMillis()
            var hero = bucketed(store, parsed, period, now)
            val last = hero.lastOrNull()
            hero = when {
                last == null -> hero
                now > last.date -> hero + ChartPoint(now, liveValue)
                else -> hero.dropLast(1) + ChartPoint(last.date, liveValue)
            }
            hero
        }
    }
    val overlayPoints by remember(overlays, period, store.lastRefreshed, store.displayCurrency, store.fxEpoch) {
        derivedStateOf {
            val now = System.currentTimeMillis()
            overlays.associate { it.name to bucketed(store, it.points, period, now) }
        }
    }

    // Hero with the last value pinned to the CURRENT live value.
    val syncedHero = run {
        val last = heroRaw.lastOrNull()
        if (last == null || last.value == liveValue) heroRaw
        else heroRaw.dropLast(1) + ChartPoint(last.date, liveValue)
    }

    val visibleOverlays = overlays.filter {
        it.form == ChartOverlay.Form.LINE && it.name !in hiddenOverlays &&
            (overlayPoints[it.name] ?: emptyList()).isNotEmpty()
    }
    val visibleStrips = overlays.filter { overlay ->
        overlay.form == ChartOverlay.Form.STEP_STRIP && overlay.name !in hiddenOverlays &&
            (overlayPoints[overlay.name] ?: emptyList()).any { abs(it.value) > 0.01 }
    }

    /** Absolute values are only readable with a single series on the plot;
     *  past that, indexing is the honest default. An explicit toggle wins. */
    val mode = modeOverride ?: if (visibleOverlays.isEmpty()) ChartMode.VALUE else ChartMode.INDEXED

    fun indexed(points: List<ChartPoint>): List<ChartPoint> {
        val base = points.firstOrNull()?.value ?: return emptyList()
        if (abs(base) <= 0.01) return emptyList()
        return points.map { ChartPoint(it.date, (it.value - base) / abs(base) * 100) }
    }

    fun rendered(points: List<ChartPoint>): List<ChartPoint> =
        if (mode == ChartMode.INDEXED) indexed(points) else points

    fun nearest(points: List<ChartPoint>, date: Long?): ChartPoint? {
        if (points.isEmpty()) return null
        if (date == null) return points.last()
        return points.minByOrNull { abs(it.date - date) }
    }

    val scrubbedPoint = scrubDate?.let { nearest(syncedHero, it) }
    val current = scrubbedPoint?.value ?: liveValue
    val first = syncedHero.firstOrNull()?.value
    val delta = first?.let { current - it }
    val deltaPct = first?.takeIf { it > 0 }?.let { (delta ?: 0.0) / it * 100 }
    val deltaTint = if ((delta ?: 0.0) >= 0) Ledger.income else Ledger.expense

    Column(
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(18.dp),
    ) {
        // Header
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono(if (scrubbedPoint == null) title else "$title · past")
            Spacer(Modifier.weight(1f))
            if (store.isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 1.5.dp,
                    color = Ledger.subtle,
                )
            } else if (showUpdatedStamp) {
                updatedStamp(store)?.let {
                    Text(
                        it, fontSize = 9.sp, fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.35f),
                    )
                }
            }
        }

        MoneyText(
            amount = current,
            currency = store.displayCurrency,
            fontSize = heroSize,
            fontWeight = FontWeight.Bold,
        )

        // Subtitle: scrub timestamp, else the window delta.
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val point = scrubbedPoint
            if (point != null) {
                Text(
                    formatScrubDate(point.date, period),
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.6f),
                )
            } else if (delta != null && deltaPct != null) {
                Text(
                    "${if (delta >= 0) "↗" else "↘"} ${store.format(delta)} (${if (deltaPct >= 0) "+" else ""}${"%.1f".format(deltaPct)}%) · ${period.pnlLabel}",
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    color = deltaTint,
                )
            }
        }

        // Chart
        if (rendered(syncedHero).size < 2) {
            Box(
                Modifier.fillMaxWidth().height(160.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Snapshots build this chart as they accumulate.",
                    fontSize = 13.sp,
                    color = Color.White.copy(alpha = 0.6f),
                )
            }
        } else {
            val hero = rendered(syncedHero)
            val series = visibleOverlays.map { it to rendered(overlayPoints[it.name] ?: emptyList()) }
            val textMeasurer = rememberTextMeasurer()
            val chartHeight = if (visibleStrips.isEmpty()) 210.dp else 176.dp

            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(chartHeight)
                    .padding(top = 8.dp)
                    .pointerInput(period, hero.size) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { offset ->
                                scrubDate = dateAtX(offset.x, size.width.toFloat(), hero)
                            },
                            onDrag = { change, _ ->
                                scrubDate = dateAtX(change.position.x, size.width.toFloat(), hero)
                            },
                            onDragEnd = { scrubDate = null },
                            onDragCancel = { scrubDate = null },
                        )
                    }
                    .pointerInput(period, hero.size) {
                        detectTapGestures(
                            onPress = { offset ->
                                scrubDate = dateAtX(offset.x, size.width.toFloat(), hero)
                                tryAwaitRelease()
                                scrubDate = null
                            },
                        )
                    },
            ) {
                drawMainPlot(
                    hero = hero,
                    series = series,
                    mode = mode,
                    scrubbed = scrubDate?.let { nearest(hero, it) },
                    store = store,
                    textMeasurer = textMeasurer,
                )
            }

            for (overlay in visibleStrips) {
                StepStrip(
                    store = store,
                    overlay = overlay,
                    points = overlayPoints[overlay.name] ?: emptyList(),
                    heroDomain = syncedHero.firstOrNull()?.date to syncedHero.lastOrNull()?.date,
                    scrubDate = scrubDate,
                )
            }

            // Time labels for the whole stack.
            val domainStart = syncedHero.firstOrNull()?.date ?: 0L
            val domainEnd = syncedHero.lastOrNull()?.date ?: 0L
            Row(Modifier.fillMaxWidth()) {
                for (fraction in listOf(0.10, 0.5, 0.88)) {
                    val tick = domainStart + ((domainEnd - domainStart) * fraction).toLong()
                    Text(
                        formatTick(tick, period),
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.35f),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        // Legend — identity by swatch, value in ink (never color-only).
        if (overlays.isNotEmpty()) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 8.dp),
            ) {
                val heroValue = scrubDate.let { date ->
                    nearest(rendered(syncedHero), date)?.value
                }
                LegendChip(
                    name = title.split(" · ").first(),
                    color = Ledger.income,
                    hidden = false,
                    value = heroValue,
                    asPercent = mode == ChartMode.INDEXED,
                    store = store,
                ) {}
                for (overlay in overlays) {
                    val strip = overlay.form == ChartOverlay.Form.STEP_STRIP
                    val points = overlayPoints[overlay.name] ?: emptyList()
                    val value = nearest(if (strip) points else rendered(points), scrubDate)?.value
                    LegendChip(
                        name = overlay.name,
                        color = overlay.color,
                        hidden = overlay.name in hiddenOverlays,
                        value = value,
                        asPercent = !strip && mode == ChartMode.INDEXED,
                        store = store,
                    ) {
                        hiddenOverlays = if (overlay.name in hiddenOverlays) {
                            hiddenOverlays - overlay.name
                        } else {
                            hiddenOverlays + overlay.name
                        }
                        modeOverride = null // let the mode follow the series count
                    }
                }
            }
            // The axis changes meaning between modes — say which, and make
            // the note itself the switch.
            Text(
                text = if (mode == ChartMode.INDEXED) {
                    "% change from window start · tap for values"
                } else {
                    "$ absolute values · tap to compare"
                },
                fontSize = 9.sp,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.35f),
                modifier = Modifier.clickable {
                    modeOverride = if (mode == ChartMode.INDEXED) ChartMode.VALUE else ChartMode.INDEXED
                },
            )
        }

        // Period picker
        SegmentedControl(
            options = ChartPeriod.entries.map { it.label },
            selectedIndex = ChartPeriod.entries.indexOf(period),
            modifier = Modifier.padding(top = 8.dp).fillMaxWidth(),
        ) { period = ChartPeriod.entries[it] }
    }
}

@Composable
private fun LegendChip(
    name: String,
    color: Color,
    hidden: Boolean,
    value: Double?,
    asPercent: Boolean,
    store: VestaStore,
    onClick: () -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier
            .background(
                Color.White.copy(alpha = if (hidden) 0.03f else 0.08f),
                RoundedCornerShape(10.dp),
            )
            .clickable { onClick() }
            .padding(horizontal = 9.dp, vertical = 6.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Box(Modifier.size(7.dp).background(color.copy(alpha = if (hidden) 0.45f else 1f), CircleShape))
            Text(
                name,
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White.copy(alpha = if (hidden) 0.45f else 1f),
                maxLines = 1,
            )
        }
        if (value != null && !hidden) {
            Text(
                if (asPercent) "${if (value >= 0) "+" else ""}${"%.1f".format(value)}%"
                else Money.format(value, store.displayCurrency, compact = true),
                fontSize = 9.sp,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.6f),
            )
        }
    }
}

/** A balance's own strip: a step sparkline of where the ledger moved. The
 *  scale is fitted to the data, NOT anchored at zero — level and change are
 *  different questions, and the strip is given entirely to the change. */
@Composable
private fun StepStrip(
    store: VestaStore,
    overlay: ChartOverlay,
    points: List<ChartPoint>,
    heroDomain: Pair<Long?, Long?>,
    scrubDate: Long?,
) {
    if (points.isEmpty()) return
    val values = points.map { it.value }
    val low = values.min()
    val high = values.max()
    val current = scrubDate?.let { date -> points.minByOrNull { abs(it.date - date) }?.value }
        ?: values.last()
    val change = values.last() - values.first()

    Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.padding(top = 7.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Box(Modifier.size(6.dp).background(overlay.color, CircleShape))
            Text(
                overlay.name.uppercase(),
                fontSize = 9.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.6f),
            )
            Text(
                Money.format(current, store.displayCurrency, compact = true),
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Color.White,
            )
            Spacer(Modifier.weight(1f))
            // The question a debt strip exists to answer.
            if (abs(change) > 0.01) {
                Text(
                    "${if (change > 0) "↓" else "↑"}${Money.format(abs(change), store.displayCurrency, compact = true)} ${if (change > 0) "paid" else "added"}",
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    color = if (change > 0) Ledger.income else Ledger.expense,
                )
            }
        }

        val textMeasurer = rememberTextMeasurer()
        Canvas(Modifier.fillMaxWidth().height(56.dp)) {
            val pad = maxOf((high - low) * 0.22, maxOf(abs(high), 1.0) * 0.02)
            val floor = low - pad
            val ceil = high + pad
            val domainStart = heroDomain.first ?: points.first().date
            val domainEnd = heroDomain.second ?: points.last().date
            val span = maxOf((domainEnd - domainStart).toDouble(), 1.0)
            val gutter = 46.dp.toPx()
            val plotWidth = size.width - gutter

            fun x(date: Long): Float = ((date - domainStart) / span * plotWidth).toFloat()
            fun y(value: Double): Float =
                (size.height - (value - floor) / (ceil - floor) * size.height).toFloat()

            // Step area + line.
            val line = Path()
            val area = Path()
            points.forEachIndexed { index, point ->
                val px = x(point.date)
                val py = y(point.value)
                if (index == 0) {
                    line.moveTo(px, py)
                    area.moveTo(px, size.height)
                    area.lineTo(px, py)
                } else {
                    // stepEnd: hold the previous value until this timestamp.
                    val prevY = y(points[index - 1].value)
                    line.lineTo(px, prevY)
                    line.lineTo(px, py)
                    area.lineTo(px, prevY)
                    area.lineTo(px, py)
                }
            }
            area.lineTo(x(points.last().date), size.height)
            area.close()
            drawPath(
                area,
                brush = Brush.verticalGradient(
                    listOf(overlay.color.copy(alpha = 0.28f), overlay.color.copy(alpha = 0.02f)),
                ),
            )
            drawPath(
                line,
                color = overlay.color,
                style = Stroke(width = 1.8.dp.toPx(), join = StrokeJoin.Round),
            )

            // Zero rule only when the ledger genuinely crosses it.
            if (low <= 0 && high >= 0) {
                drawLine(
                    color = Color.White.copy(alpha = 0.3f),
                    start = Offset(0f, y(0.0)),
                    end = Offset(plotWidth, y(0.0)),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 6f)),
                )
            }

            // The events themselves — the days money actually moved.
            for (index in 1 until points.size) {
                if (abs(points[index].value - points[index - 1].value) > 0.005) {
                    drawCircle(
                        overlay.color,
                        radius = 2.4.dp.toPx(),
                        center = Offset(x(points[index].date), y(points[index].value)),
                    )
                }
            }

            // Scrub marker follows the shared instant.
            scrubDate?.let { date ->
                points.minByOrNull { abs(it.date - date) }?.let { point ->
                    val px = x(point.date)
                    drawLine(
                        color = Color.White.copy(alpha = 0.5f),
                        start = Offset(px, 0f),
                        end = Offset(px, size.height),
                        strokeWidth = 1.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
                    )
                    drawCircle(Color.White, radius = 3.5.dp.toPx(), center = Offset(px, y(point.value)))
                }
            }

            // BOTH ends of the fitted scale, in the gutter.
            val labels = if ((high - low) > maxOf(abs(high), 1.0) * 0.001) {
                listOf(low, high)
            } else {
                listOf(high)
            }
            for (value in labels) {
                val text = Money.format(value, store.displayCurrency, compact = true)
                val layout = textMeasurer.measure(
                    text,
                    TextStyle(
                        fontSize = 8.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.35f),
                    ),
                )
                drawText(
                    layout,
                    topLeft = Offset(
                        size.width - layout.size.width,
                        (y(value) - layout.size.height / 2).coerceIn(0f, size.height - layout.size.height),
                    ),
                )
            }
        }
    }
}

// MARK: - Pure helpers

private fun bucketed(
    store: VestaStore,
    rows: List<ParsedPoint>,
    period: ChartPeriod,
    nowMs: Long,
): List<ChartPoint> {
    val cutoff = period.cutoffSeconds?.let { nowMs - it * 1000 }
    val inRange = if (cutoff != null) rows.filter { it.date >= cutoff } else rows
    val bucket = period.bucketSeconds * 1000
    val kept = if (bucket <= 0 || inRange.isEmpty()) {
        inRange
    } else {
        val out = ArrayList<ParsedPoint>()
        for (index in inRange.indices) {
            val row = inRange[index]
            val slot = row.date / bucket
            val lastInBucket = index + 1 >= inRange.size || inRange[index + 1].date / bucket != slot
            if (index == 0 || lastInBucket) out.add(row)
        }
        out
    }
    return kept.map { ChartPoint(it.date, store.convert(it.valueUsd, "USD")) }
}

private fun dateAtX(x: Float, width: Float, hero: List<ChartPoint>): Long? {
    if (hero.isEmpty() || width <= 0) return null
    val start = hero.first().date
    val end = hero.last().date
    val fraction = (x / width).coerceIn(0f, 1f)
    return start + ((end - start) * fraction).toLong()
}

private fun updatedStamp(store: VestaStore): String? {
    if (store.lastRefreshed <= 0) return null
    val age = System.currentTimeMillis() / 1000.0 - store.lastRefreshed
    return when {
        age < 90 -> "live"
        age < 3600 -> "${(age / 60).toInt()}m ago"
        else -> "${(age / 3600).toInt()}h ago"
    }
}

private val scrubShortFormat = DateTimeFormatter.ofPattern("EEE d MMM HH:mm", Locale.US)
private val scrubLongFormat = DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.US)
private val tickTimeFormat = DateTimeFormatter.ofPattern("HH:mm", Locale.US)
private val tickDayFormat = DateTimeFormatter.ofPattern("d MMM", Locale.US)
private val tickMonthFormat = DateTimeFormatter.ofPattern("MMM yy", Locale.US)

private fun zoned(ms: Long): ZonedDateTime =
    ZonedDateTime.ofInstant(Instant.ofEpochMilli(ms), com.piyawatpm.vesta.core.SydneyTime.zone)

private fun formatScrubDate(ms: Long, period: ChartPeriod): String =
    if (period == ChartPeriod.D1 || period == ChartPeriod.W1) {
        scrubShortFormat.format(zoned(ms))
    } else {
        scrubLongFormat.format(zoned(ms))
    }

private fun formatTick(ms: Long, period: ChartPeriod): String = when (period) {
    ChartPeriod.D1 -> tickTimeFormat.format(zoned(ms))
    ChartPeriod.M6, ChartPeriod.Y1, ChartPeriod.ALL -> tickMonthFormat.format(zoned(ms))
    else -> tickDayFormat.format(zoned(ms))
}

/** Neon line: three stacked strokes that read as bloom, optionally over a
 *  dot-matrix fill (value mode only). */
private fun DrawScope.drawNeonLine(
    points: List<Offset>,
    tint: Color,
    dimmed: Boolean,
    weight: Float = 1f,
) {
    if (points.size < 2) return
    val path = Path().apply {
        moveTo(points[0].x, points[0].y)
        for (index in 1 until points.size) lineTo(points[index].x, points[index].y)
    }
    drawPath(
        path, color = tint.copy(alpha = if (dimmed) 0.04f else 0.10f),
        style = Stroke(11.dp.toPx() * weight, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
    drawPath(
        path, color = tint.copy(alpha = if (dimmed) 0.08f else 0.22f),
        style = Stroke(5.dp.toPx() * weight, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
    drawPath(
        path, color = tint.copy(alpha = if (dimmed) 0.3f else 1f),
        style = Stroke(2.2.dp.toPx() * weight, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
}

private fun DrawScope.drawMainPlot(
    hero: List<ChartPoint>,
    series: List<Pair<ChartOverlay, List<ChartPoint>>>,
    mode: ChartMode,
    scrubbed: ChartPoint?,
    store: VestaStore,
    textMeasurer: androidx.compose.ui.text.TextMeasurer,
) {
    val heroValues = hero.map { it.value }
    val allValues = heroValues + series.flatMap { it.second.map { p -> p.value } }
    val low = allValues.minOrNull() ?: 0.0
    val high = allValues.maxOrNull() ?: 1.0
    val span = maxOf(high - low, 0.0001)
    val filled = mode == ChartMode.VALUE
    val yBase = if (filled) low - span * 0.06 else low - span * 0.08
    val yTop = high + span * 0.10
    val rising = (heroValues.lastOrNull() ?: 0.0) >= (heroValues.firstOrNull() ?: 0.0)
    val tint = if (rising) Ledger.income else Ledger.expense

    val domainStart = hero.first().date
    val domainEnd = hero.last().date
    val domainSpan = maxOf((domainEnd - domainStart).toDouble(), 1.0)

    fun x(date: Long): Float = ((date - domainStart) / domainSpan * size.width).toFloat()
    fun y(value: Double): Float =
        (size.height - (value - yBase) / (yTop - yBase) * size.height).toFloat()

    // Zero line anchors the indexed view — "did it beat flat?"
    if (mode == ChartMode.INDEXED) {
        drawLine(
            color = Color.White.copy(alpha = 0.18f),
            start = Offset(0f, y(0.0)),
            end = Offset(size.width, y(0.0)),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(3f, 6f)),
        )
    }

    val heroOffsets = hero.map { Offset(x(it.date), y(it.value)) }

    // Halftone dot fill under the hero line (value mode).
    if (filled) {
        val areaPath = Path().apply {
            moveTo(heroOffsets.first().x, size.height)
            for (offset in heroOffsets) lineTo(offset.x, offset.y)
            lineTo(heroOffsets.last().x, size.height)
            close()
        }
        clipPath(areaPath) {
            val step = 7.dp.toPx()
            var yy = 0f
            while (yy < size.height) {
                var xx = 0f
                while (xx < size.width) {
                    drawCircle(
                        tint.copy(alpha = 0.4f),
                        radius = 1.dp.toPx(),
                        center = Offset(xx + step / 2, yy + step / 2),
                    )
                    xx += step
                }
                yy += step
            }
        }
    }

    // Scrub splits the hero line: lit up to the finger, dim after.
    val splitIndex = scrubbed?.let { selected -> hero.indexOfFirst { it.date == selected.date } }
        ?.takeIf { it >= 0 }
    if (splitIndex != null) {
        drawNeonLine(heroOffsets.subList(0, splitIndex + 1), tint, dimmed = false)
        if (splitIndex < hero.size - 1) {
            drawNeonLine(heroOffsets.subList(splitIndex, hero.size), tint, dimmed = true)
        }
    } else {
        drawNeonLine(heroOffsets, tint, dimmed = false)
    }

    // Component lines get the same neon treatment and the same scrub split.
    for ((overlay, points) in series) {
        if (points.isEmpty()) continue
        val offsets = points.map { Offset(x(it.date), y(it.value)) }
        val cut = scrubbed?.let { selected -> points.indexOfFirst { it.date >= selected.date } }
            ?.takeIf { it >= 0 }
        if (cut != null) {
            drawNeonLine(offsets.subList(0, cut + 1), overlay.color, dimmed = false, weight = 0.72f)
            if (cut < points.size - 1) {
                drawNeonLine(offsets.subList(cut, points.size), overlay.color, dimmed = true, weight = 0.72f)
            }
        } else {
            drawNeonLine(offsets, overlay.color, dimmed = false, weight = 0.72f)
        }
        drawCircle(overlay.color, radius = 3.dp.toPx(), center = offsets.last())
    }

    // Peak / trough of the HERO series only — only when far enough apart
    // that compact formatting doesn't print the same string twice.
    val extremesDistinct = (heroValues.max()) - (heroValues.min()) > abs(heroValues.max()) * 0.02
    if (mode == ChartMode.VALUE && extremesDistinct) {
        val heroHigh = hero.first { it.value == heroValues.max() }
        val heroLow = hero.first { it.value == heroValues.min() }
        val labelStyle = TextStyle(
            fontSize = 9.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.6f),
        )
        drawCircle(tint, radius = 2.3.dp.toPx(), center = Offset(x(heroHigh.date), y(heroHigh.value)))
        val highLayout = textMeasurer.measure(
            Money.format(heroHigh.value, store.displayCurrency, compact = true), labelStyle
        )
        drawText(
            highLayout,
            topLeft = Offset(
                (x(heroHigh.date) - highLayout.size.width / 2)
                    .coerceIn(0f, size.width - highLayout.size.width),
                maxOf(0f, y(heroHigh.value) - highLayout.size.height - 4.dp.toPx()),
            ),
        )
        if (heroLow.date != heroHigh.date) {
            drawCircle(
                Ledger.expense.copy(alpha = 0.75f),
                radius = 2.3.dp.toPx(),
                center = Offset(x(heroLow.date), y(heroLow.value)),
            )
            val lowLayout = textMeasurer.measure(
                Money.format(heroLow.value, store.displayCurrency, compact = true), labelStyle
            )
            drawText(
                lowLayout,
                topLeft = Offset(
                    (x(heroLow.date) - lowLayout.size.width / 2)
                        .coerceIn(0f, size.width - lowLayout.size.width),
                    minOf(size.height - lowLayout.size.height, y(heroLow.value) + 4.dp.toPx()),
                ),
            )
        }
    }

    // Scrub rule + double point.
    scrubbed?.let { point ->
        val px = x(point.date)
        drawLine(
            color = Color.White.copy(alpha = 0.5f),
            start = Offset(px, 0f),
            end = Offset(px, size.height),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
        )
        drawCircle(Color.White, radius = 4.8.dp.toPx(), center = Offset(px, y(point.value)))
        drawCircle(tint, radius = 2.6.dp.toPx(), center = Offset(px, y(point.value)))
    }
}
