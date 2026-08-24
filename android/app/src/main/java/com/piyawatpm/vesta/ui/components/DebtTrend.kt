package com.piyawatpm.vesta.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.piyawatpm.vesta.core.FlowMath
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SnapshotDate
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.data.DebtRecord
import com.piyawatpm.vesta.data.DebtTransaction
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.financeCard
import java.time.Instant
import kotlin.math.abs

/** Daily replay of what the debt ledger was worth, for the Debts page trend.
 *  Port of ios DebtTrend.swift. */
object DebtHistory {
    /**
     * Signed net per day (USD) over the trailing `months`: positive = owed to
     * me, negative = I owe. Same sign convention as the dashboard overlay, so
     * the two can't disagree. O(days + payments) walk.
     */
    fun series(
        debts: List<DebtRecord>,
        txs: List<DebtTransaction>,
        months: Int,
    ): List<Pair<Long, Double>> {
        if (debts.isEmpty()) return emptyList()
        val firstMonth = FlowMath.monthKeys(months).firstOrNull() ?: return emptyList()
        val start = SnapshotDate.parse("$firstMonth-01") ?: return emptyList()

        val createdDay = debts.map {
            SydneyTime.dayString(Instant.ofEpochMilli(it.createdAt.toLong()))
        }

        val payments = HashMap<String, MutableList<Pair<String, Double>>>()
        for (tx in txs) {
            payments.getOrPut(tx.debtId) { mutableListOf() }.add(tx.date.take(10) to tx.amount)
        }
        for (list in payments.values) list.sortBy { it.first }

        val cursor = IntArray(debts.size)
        val paid = DoubleArray(debts.size)

        val out = mutableListOf<Pair<Long, Double>>()
        var date = start
        val now = System.currentTimeMillis()
        while (date <= now) {
            val day = SydneyTime.dayString(Instant.ofEpochMilli(date))
            var net = 0.0
            debts.forEachIndexed { index, debt ->
                // Roll this debt's payments forward to `day`.
                payments[debt.id]?.let { schedule ->
                    while (cursor[index] < schedule.size && schedule[cursor[index]].first <= day) {
                        paid[index] += schedule[cursor[index]].second
                        cursor[index] += 1
                    }
                }
                if (createdDay[index] > day) return@forEachIndexed
                val balance = debt.originalAmount - paid[index]
                val signed = if (debt.direction == "owed_to_me") balance else -balance
                net += Money.convert(signed, debt.currency, "USD")
            }
            out.add(date to net)
            date += 86400_000L
        }
        return out
    }
}

/**
 * Net debt over time, as a step area. Step interpolation, not a smooth line:
 * the balance holds flat until a repayment replaces it. The scale is fitted
 * to the data and both ends are labelled rather than anchored at zero —
 * progress is the entire question this card exists to answer.
 */
@Composable
fun DebtTrendCard(
    points: List<Pair<Long, Double>>, // (epoch ms, net USD)
    convert: (Double) -> Double,
    format: (Double) -> String,
) {
    val series = points.map { it.first to convert(it.second) }
    val values = series.map { it.second }
    val low = values.minOrNull() ?: 0.0
    val high = values.maxOrNull() ?: 0.0
    val current = values.lastOrNull() ?: 0.0
    val change = (values.lastOrNull() ?: 0.0) - (values.firstOrNull() ?: 0.0)

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono("Net position · 6 months")
            Spacer(Modifier.weight(1f))
            if (abs(change) > 0.01) {
                // Rising net = the balance owed shrank.
                Text(
                    "${if (change > 0) "↓" else "↑"}${format(abs(change))} ${if (change > 0) "paid down" else "added"}",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    color = if (change > 0) Ledger.income else Ledger.expense,
                )
            }
        }

        Text(
            format(abs(current)),
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            color = if (current < 0) Ledger.expense else Ledger.income,
        )
        Text(
            if (current < 0) "owed by you" else "owed to you",
            fontSize = 9.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.4f),
        )

        val textMeasurer = rememberTextMeasurer()
        Canvas(Modifier.fillMaxWidth().height(130.dp)) {
            if (series.size < 2) return@Canvas
            val pad = maxOf((high - low) * 0.2, maxOf(abs(high), 1.0) * 0.02)
            val floor = low - pad
            val ceil = high + pad
            val gutter = 44.dp.toPx()
            val plotWidth = size.width - gutter
            val start = series.first().first
            val span = maxOf((series.last().first - start).toDouble(), 1.0)

            fun x(date: Long): Float = ((date - start) / span * plotWidth).toFloat()
            fun y(value: Double): Float =
                (size.height - (value - floor) / (ceil - floor) * size.height).toFloat()

            val line = Path()
            val area = Path()
            series.forEachIndexed { index, (date, value) ->
                val px = x(date)
                val py = y(value)
                if (index == 0) {
                    line.moveTo(px, py)
                    area.moveTo(px, size.height)
                    area.lineTo(px, py)
                } else {
                    val prevY = y(series[index - 1].second)
                    line.lineTo(px, prevY)
                    line.lineTo(px, py)
                    area.lineTo(px, prevY)
                    area.lineTo(px, py)
                }
            }
            area.lineTo(x(series.last().first), size.height)
            area.close()
            drawPath(
                area,
                brush = Brush.verticalGradient(
                    listOf(Ledger.seriesDebt.copy(alpha = 0.3f), Ledger.seriesDebt.copy(alpha = 0.02f)),
                ),
            )
            drawPath(
                line,
                color = Ledger.seriesDebt,
                style = Stroke(2.dp.toPx(), join = StrokeJoin.Round),
            )

            if (low <= 0 && high >= 0) {
                drawLine(
                    Color.White.copy(alpha = 0.3f),
                    Offset(0f, y(0.0)),
                    Offset(plotWidth, y(0.0)),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 6f)),
                )
            }

            // Dots mark the events themselves — the days money moved.
            for (index in 1 until series.size) {
                if (abs(series[index].second - series[index - 1].second) > 0.005) {
                    drawCircle(
                        Ledger.seriesDebt,
                        radius = 2.6.dp.toPx(),
                        center = Offset(x(series[index].first), y(series[index].second)),
                    )
                }
            }

            // Both ends of the fitted scale.
            val axisValues = if ((high - low) > maxOf(abs(high), 1.0) * 0.001) {
                listOf(low, high)
            } else {
                listOf(high)
            }
            for (value in axisValues) {
                val layout = textMeasurer.measure(
                    format(value),
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
                        (y(value) - layout.size.height / 2)
                            .coerceIn(0f, size.height - layout.size.height),
                    ),
                )
            }
        }
    }
}
