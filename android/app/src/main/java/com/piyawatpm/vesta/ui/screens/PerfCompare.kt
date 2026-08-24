package com.piyawatpm.vesta.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import com.piyawatpm.vesta.core.FlowMath
import com.piyawatpm.vesta.core.SnapshotDate
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.data.BenchmarkApi
import com.piyawatpm.vesta.data.DcaCompare
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.components.SegmentedControl
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.financeCard
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

/** Growth of the same money: a dollar in this pot vs a dollar in the
 *  benchmark. Port of ios Benchmark + PerfCompareCard. */
data class Benchmark(val symbol: String, val label: String, val color: Color) {
    companion object {
        val sp500 = Benchmark("SPY", "S&P 500", Ledger.seriesStocks)
        val btc = Benchmark("BTC", "BTC", Ledger.seriesCrypto)
    }
}

enum class CompareWindow(val label: String, val days: Int?) {
    W1("1W", 7), M1("1M", 30), M6("6M", 180), Y1("1Y", 365), ALL("All", null),
}

private val scrubFormat = DateTimeFormatter.ofPattern("d MMM", Locale.US)

@Composable
fun PerfCompareCard(
    store: VestaStore,
    allStart: String,
    benchmarks: List<Benchmark>,
    values: List<DcaCompare.DatedValue>,
    flows: List<DcaCompare.DatedValue>,
    footnote: String? = null,
    maskSettling: Boolean = false,
) {
    var selected by remember { mutableStateOf(benchmarks[0]) }
    var window by rememberSaveable { mutableStateOf(CompareWindow.ALL) }
    var prices by remember { mutableStateOf<List<DcaCompare.PricePoint>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var retryToken by remember { mutableStateOf(0) }
    var scrubDate by remember { mutableStateOf<Long?>(null) }

    // The window's opening day — never earlier than the honest clamp.
    val start = run {
        val days = window.days
        if (days == null) allStart
        else {
            val today = SnapshotDate.parse(SydneyTime.today()) ?: return@run allStart
            val from = SydneyTime.dayString(Instant.ofEpochMilli(today - days * 86400_000L))
            maxOf(allStart, from)
        }
    }

    LaunchedEffect(selected.symbol, retryToken) {
        failed = false
        prices = null
        prices = try {
            BenchmarkApi.prices(selected.symbol, allStart)
        } catch (_: Exception) {
            failed = true
            null
        }
    }

    val series = prices?.let {
        DcaCompare.build(values, flows, it, start, maskSettling)
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono("You vs ${selected.label} · since ${FlowMath.dayLabel(start)}")
            Spacer(Modifier.weight(1f))
            if (benchmarks.size > 1) {
                SegmentedControl(
                    options = benchmarks.map { it.label },
                    selectedIndex = benchmarks.indexOf(selected),
                ) { selected = benchmarks[it] }
            }
        }

        when {
            series != null -> PerfCompareContent(
                store, series, selected, window,
                scrubDate = scrubDate,
                onScrub = { scrubDate = it },
                onWindow = { window = it },
                footnote = footnote,
                maskSettling = maskSettling,
            )
            failed -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().padding(vertical = 40.dp),
            ) {
                Text(
                    "Couldn't load ${selected.label} prices.",
                    fontSize = 13.sp,
                    color = Color.White.copy(alpha = 0.6f),
                )
                Text(
                    "Retry",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ledger.income,
                    modifier = Modifier.clickable { retryToken += 1 },
                )
            }
            prices != null -> Text(
                "Tracked history starts after ${FlowMath.dayLabel(start)} — nothing to compare from.",
                fontSize = 13.sp,
                color = Color.White.copy(alpha = 0.6f),
                modifier = Modifier.padding(vertical = 30.dp),
            )
            else -> Box(
                Modifier.fillMaxWidth().height(120.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = Ledger.subtle,
                )
            }
        }
    }
}

@Composable
private fun PerfCompareContent(
    store: VestaStore,
    series: DcaCompare.Series,
    selected: Benchmark,
    window: CompareWindow,
    scrubDate: Long?,
    onScrub: (Long?) -> Unit,
    onWindow: (CompareWindow) -> Unit,
    footnote: String?,
    maskSettling: Boolean,
) {
    // Hold on the chart → every number on the card reads at that day.
    val at = scrubDate?.let { date ->
        series.dates.indices.minByOrNull { abs(series.dates[it] - date) }
    }
    val minePct = at?.let { series.minePct[it] } ?: (series.minePct.lastOrNull() ?: 0.0)
    val indexPct = at?.let { series.indexPct[it] } ?: (series.indexPct.lastOrNull() ?: 0.0)
    val lead = minePct - indexPct
    val ahead = lead >= 0

    // Verdict first, in words. Points, not %: the difference of two
    // percentages is percentage points.
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            "${if (ahead) "↗" else "↘"} ${if (ahead) "ahead of" else "behind"} ${selected.label} by ${"%.1f".format(abs(lead))} pts",
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = if (ahead) Ledger.income else Ledger.expense,
        )
        at?.let {
            Text(
                "· ${scrubFormat.format(ZonedDateTime.ofInstant(Instant.ofEpochMilli(series.dates[it]), SydneyTime.zone))}",
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.6f),
            )
        }
    }

    // Y-domain from the bulk of the data (2nd–98th pct): one artifact day
    // must not flatten the story the other ~95 days are telling.
    val allPct = (series.minePct + series.indexPct).sorted()
    val lo = allPct[((allPct.size - 1) * 0.02).toInt()]
    val hi = allPct[((allPct.size - 1) * 0.98).toInt()]
    val span = maxOf(hi - lo, 1.0)
    val yLow = minOf(lo - span * 0.25, -1.0)
    val yHigh = maxOf(hi + span * 0.25, 1.0)

    val textMeasurer = rememberTextMeasurer()
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(170.dp)
            .pointerInput(series.dates.size) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { offset ->
                        onScrub(dateAt(offset.x, size.width.toFloat(), series.dates))
                    },
                    onDrag = { change, _ ->
                        onScrub(dateAt(change.position.x, size.width.toFloat(), series.dates))
                    },
                    onDragEnd = { onScrub(null) },
                    onDragCancel = { onScrub(null) },
                )
            },
    ) {
        val gutter = 40.dp.toPx()
        val plotWidth = size.width - gutter
        val domainStart = series.dates.first()
        val domainSpan = maxOf((series.dates.last() - domainStart).toDouble(), 1.0)

        fun x(date: Long): Float = ((date - domainStart) / domainSpan * plotWidth).toFloat()
        fun y(pct: Double): Float =
            (size.height - (pct - yLow) / (yHigh - yLow) * size.height).toFloat()
                .coerceIn(0f, size.height)

        // Flat rule at 0%.
        drawLine(
            Color.White.copy(alpha = 0.18f),
            Offset(0f, y(0.0)),
            Offset(plotWidth, y(0.0)),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(3f, 6f)),
        )

        // Y labels (3 marks).
        for (i in 0..2) {
            val value = yLow + (yHigh - yLow) * i / 2
            val layout = textMeasurer.measure(
                "${if (value >= 0) "+" else ""}${"%.0f".format(value)}%",
                TextStyle(
                    fontSize = 8.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.4f),
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

        fun drawSeries(pcts: List<Double>, color: Color, width: Float) {
            val path = Path()
            series.dates.forEachIndexed { index, date ->
                val px = x(date)
                val py = y(pcts[index])
                if (index == 0) path.moveTo(px, py) else path.lineTo(px, py)
            }
            drawPath(
                path, color,
                style = Stroke(width.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }

        drawSeries(series.indexPct, selected.color, 1.8f)
        drawSeries(series.minePct, Ledger.income, 2.2f)

        at?.let { index ->
            val px = x(series.dates[index])
            drawLine(
                Color.White.copy(alpha = 0.5f),
                Offset(px, 0f),
                Offset(px, size.height),
                strokeWidth = 1.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
            )
            drawCircle(Color.White, 4.2.dp.toPx(), Offset(px, y(series.minePct[index])))
            drawCircle(Ledger.income, 2.4.dp.toPx(), Offset(px, y(series.minePct[index])))
            drawCircle(Color.White, 4.2.dp.toPx(), Offset(px, y(series.indexPct[index])))
            drawCircle(selected.color, 2.4.dp.toPx(), Offset(px, y(series.indexPct[index])))
        }

        // Hand-placed time ticks at 10%/50%/88%.
        for (fraction in listOf(0.10, 0.5, 0.88)) {
            val tick = domainStart + (domainSpan * fraction).toLong()
            val layout = textMeasurer.measure(
                scrubFormat.format(ZonedDateTime.ofInstant(Instant.ofEpochMilli(tick), SydneyTime.zone)),
                TextStyle(
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.4f),
                ),
            )
            drawText(
                layout,
                topLeft = Offset(
                    (x(tick) - layout.size.width / 2).coerceIn(0f, plotWidth - layout.size.width),
                    size.height - layout.size.height,
                ),
            )
        }
    }

    val mineMoney = store.convert(at?.let { series.mineUsd[it] } ?: (series.mineUsd.lastOrNull() ?: 0.0), "USD")
    val indexMoney = store.convert(at?.let { series.indexUsd[it] } ?: (series.indexUsd.lastOrNull() ?: 0.0), "USD")

    SegmentedControl(
        options = CompareWindow.entries.map { it.label },
        selectedIndex = CompareWindow.entries.indexOf(window),
        modifier = Modifier.fillMaxWidth(),
    ) { onWindow(CompareWindow.entries[it]) }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CompareChip(store, "You", minePct, mineMoney, Ledger.income)
        CompareChip(store, selected.label, indexPct, indexMoney, selected.color)
    }

    com.piyawatpm.vesta.ui.components.FinePrint(
        "P&L as % of capital deployed · same money, same days into the benchmark — so the benchmark line follows YOUR deposit schedule and shifts when scope or the super toggle changes it · dividends in S&P 500${if (maskSettling) " · days right after big deposits hidden while marks settle" else ""}",
    )
    footnote?.let {
        Text(
            "⚠ $it",
            fontSize = 8.sp,
            fontFamily = FontFamily.Monospace,
            color = Ledger.seriesCrypto,
        )
    }
}

@Composable
private fun CompareChip(store: VestaStore, name: String, pctValue: Double, money: Double, color: Color) {
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(9.dp))
            .padding(horizontal = 9.dp, vertical = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Box(Modifier.size(7.dp).background(color, CircleShape))
            Text(name, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 1)
        }
        Text(
            "${if (pctValue >= 0) "+" else ""}${"%.1f".format(pctValue)}%",
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            color = if (pctValue >= 0) Ledger.income else Ledger.expense,
        )
        // The baht question, answered next to the percent one.
        Text(
            "${if (money >= 0) "+" else ""}${store.format(money, compact = true)}",
            fontSize = 9.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.6f),
        )
    }
}

private fun dateAt(x: Float, width: Float, dates: List<Long>): Long? {
    if (dates.isEmpty() || width <= 0) return null
    val start = dates.first()
    val end = dates.last()
    val fraction = (x / width).coerceIn(0f, 1f)
    return start + ((end - start) * fraction).toLong()
}
