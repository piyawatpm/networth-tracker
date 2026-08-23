package com.piyawatpm.vesta.ui.components

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
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.gestures.detectTapGestures
import com.piyawatpm.vesta.core.CategorySlice
import com.piyawatpm.vesta.core.FlowMath
import com.piyawatpm.vesta.core.MonthFlow
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.financeCard
import kotlin.math.abs

/** Minimal dark segmented control matching the iOS `.segmented` picker. */
@Composable
fun SegmentedControl(
    options: List<String>,
    selectedIndex: Int,
    modifier: Modifier = Modifier,
    onSelect: (Int) -> Unit,
) {
    Row(
        modifier = modifier
            .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(8.dp))
            .padding(2.dp),
    ) {
        options.forEachIndexed { index, option ->
            val active = index == selectedIndex
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .background(
                        if (active) Color.White.copy(alpha = 0.16f) else Color.Transparent,
                        RoundedCornerShape(6.dp),
                    )
                    .clickable { onSelect(index) }
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            ) {
                Text(
                    text = option,
                    fontSize = 11.sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (active) Color.White else Color.White.copy(alpha = 0.55f),
                )
            }
        }
    }
}

/**
 * Six months of a single flow as bars — magnitude over discrete periods is
 * bar territory. The current month is real but incomplete, so it's drawn
 * dimmer with a "so far" annotation. ONE tap on a bar scopes the whole page
 * to that month — tapping the already-scoped bar clears back to All.
 * Port of ios MonthTrendCard (FlowInsights.swift).
 */
@Composable
fun MonthTrendCard(
    title: String,
    flows: List<MonthFlow>,
    tint: Color,
    format: (Double) -> String,
    slices: List<CategorySlice> = emptyList(),
    order: List<String> = emptyList(),
    colorFor: (String) -> Color = { Color.Gray },
    scope: String? = null,
    onScope: ((String?) -> Unit)? = null,
) {
    var showCategories by rememberSaveable(title) { mutableStateOf(false) }
    var selectedKey by remember { mutableStateOf<String?>(null) }

    val maxFlow = flows.filter { !it.isCurrent }.maxByOrNull { it.total }
    val selectedFlow = flows.firstOrNull { it.key == selectedKey }

    fun barOpacity(flow: MonthFlow, resting: Float): Float {
        selectedKey?.let { return if (flow.key == it) 0.95f else 0.28f }
        scope?.let { return if (flow.key == it) 0.95f else 0.28f }
        return resting
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono(title)
            Spacer(Modifier.weight(1f))
            if (slices.isNotEmpty()) {
                SegmentedControl(
                    options = listOf("Total", "Category"),
                    selectedIndex = if (showCategories) 1 else 0,
                ) { showCategories = it == 1 }
            }
        }

        // Readout: the month the page is scoped to (or the bar under the
        // finger) in numbers. Reserved height so the card never jumps.
        val shown = selectedFlow ?: scope?.let { s -> flows.firstOrNull { it.key == s } }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.height(30.dp)) {
            if (shown != null) {
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "${shown.label} · ${format(shown.total)}${if (shown.isCurrent) " so far" else ""}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White,
                        )
                        val index = flows.indexOfFirst { it.key == shown.key }
                        val prev = if (index > 0) flows[index - 1] else null
                        if (prev != null && prev.total > 0.01 && !shown.isCurrent) {
                            val pct = (shown.total - prev.total) / prev.total * 100
                            Text(
                                "${if (pct >= 0) "↑" else "↓"}${"%.0f".format(abs(pct))}% vs ${prev.label}",
                                fontSize = 9.sp,
                                fontFamily = FontFamily.Monospace,
                                color = if (pct >= 0) Ledger.income else Ledger.expense,
                            )
                        }
                    }
                    val top = slices
                        .filter { it.monthKey == shown.key && it.category != FlowMath.OTHER_CATEGORY }
                        .maxByOrNull { it.total }
                    if (top != null) {
                        Text(
                            "top: ${top.category} ${format(top.total)}",
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.4f),
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                if (scope == shown.key && onScope != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                        modifier = Modifier
                            .background(tint, RoundedCornerShape(50))
                            .clickable { onScope(null) }
                            .padding(horizontal = 9.dp, vertical = 5.dp),
                    ) {
                        Text(
                            "× filtered",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.Black,
                        )
                    }
                }
            } else {
                Text(
                    if (onScope != null) "tap a bar — the whole page follows it · tap again for All"
                    else "touch a bar to inspect",
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.35f),
                )
                Spacer(Modifier.weight(1f))
            }
        }

        // The bars themselves — annotation strip on top, canvas below.
        Row(modifier = Modifier.fillMaxWidth().height(14.dp)) {
            for (flow in flows) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    when {
                        flow.isCurrent -> Text(
                            "${format(flow.total)} …",
                            fontSize = 8.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White,
                            maxLines = 1,
                        )
                        flow.key == maxFlow?.key && flow.total > 0 -> Text(
                            format(flow.total),
                            fontSize = 8.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                            maxLines = 1,
                        )
                    }
                }
            }
        }

        val chartHeight = if (showCategories && slices.isNotEmpty()) 150.dp else 110.dp
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(chartHeight)
                .pointerInput(flows, scope) {
                    detectTapGestures { offset ->
                        if (flows.isEmpty()) return@detectTapGestures
                        val slot = size.width / flows.size
                        val index = (offset.x / slot).toInt().coerceIn(0, flows.size - 1)
                        val key = flows[index].key
                        selectedKey = if (selectedKey == key) null else key
                        // One tap scopes the page (tap again = All).
                        if (onScope != null) {
                            onScope(if (scope == key) null else key)
                        }
                    }
                },
        ) {
            if (flows.isEmpty()) return@Canvas
            val maxTotal = maxOf(flows.maxOf { it.total }, 0.01)
            val slot = size.width / flows.size
            val barWidth = slot * 0.55f

            if (showCategories && slices.isNotEmpty()) {
                val byMonth = slices.groupBy { it.monthKey }
                flows.forEachIndexed { index, flow ->
                    val monthSlices = byMonth[flow.key] ?: return@forEachIndexed
                    val dim = if (flow.isCurrent) 0.45f else 1f
                    val emphasis = barOpacity(flow, resting = 1f)
                    var yCursor = size.height
                    for (slice in monthSlices) {
                        val h = (slice.total / maxTotal * size.height).toFloat()
                        val color = if (slice.category == FlowMath.OTHER_CATEGORY) {
                            Color.Gray.copy(alpha = 0.55f)
                        } else {
                            colorFor(slice.category)
                        }
                        drawRoundRect(
                            color = color.copy(alpha = color.alpha * dim * emphasis),
                            topLeft = Offset(index * slot + (slot - barWidth) / 2, yCursor - h),
                            size = Size(barWidth, h),
                            cornerRadius = CornerRadius(2.dp.toPx()),
                        )
                        yCursor -= h
                    }
                }
            } else {
                flows.forEachIndexed { index, flow ->
                    val h = (flow.total / maxTotal * size.height).toFloat()
                    val resting = if (flow.isCurrent) 0.38f else 0.9f
                    drawRoundRect(
                        color = tint.copy(alpha = barOpacity(flow, resting)),
                        topLeft = Offset(index * slot + (slot - barWidth) / 2, size.height - h),
                        size = Size(barWidth, h),
                        cornerRadius = CornerRadius(4.dp.toPx()),
                    )
                }
            }
        }

        // X labels.
        Row(modifier = Modifier.fillMaxWidth()) {
            for (flow in flows) {
                Text(
                    flow.label,
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.35f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        // Category legend.
        if (showCategories && order.isNotEmpty()) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth().wrapContentSize(),
            ) {
                for (category in order) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Box(
                            Modifier.size(7.dp).background(
                                if (category == FlowMath.OTHER_CATEGORY) Color.Gray.copy(alpha = 0.55f)
                                else colorFor(category),
                                CircleShape,
                            )
                        )
                        Text(
                            category,
                            fontSize = 9.sp,
                            color = Color.White.copy(alpha = 0.6f),
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Seven bars, one per weekday — habits show up here that a monthly total
 * hides. Port of ios WeekdayPatternCard.
 */
@Composable
fun WeekdayPatternCard(
    totals: List<Double>, // index 0 = Sunday
    occurrences: List<Int>,
    tint: Color,
    format: (Double) -> String,
) {
    var showAverage by rememberSaveable { mutableStateOf(true) }
    var selectedIndex by remember { mutableStateOf<Int?>(null) }

    /** Average spend per occurrence — the honest "what does a Monday cost me". */
    val values = if (showAverage) {
        totals.mapIndexed { index, total ->
            val count = occurrences.getOrElse(index) { 0 }
            if (count > 0) total / count else 0.0
        }
    } else {
        totals
    }

    val peak = values.withIndex().maxByOrNull { it.value }?.takeIf { it.value > 0 }?.index

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono("By weekday")
            Spacer(Modifier.weight(1f))
            SegmentedControl(
                options = listOf("Avg", "Total"),
                selectedIndex = if (showAverage) 0 else 1,
            ) { showAverage = it == 0 }
        }

        // One line, two jobs: the touched bar's numbers, else the peak finding.
        Box(Modifier.height(14.dp)) {
            val index = selectedIndex
            if (index != null) {
                val count = occurrences.getOrElse(index) { 0 }
                val avg = if (count > 0) totals[index] / count else 0.0
                Text(
                    "${FlowMath.weekdayName(index)} · avg ${format(avg)} · total ${format(totals[index])} · $count day${if (count == 1) "" else "s"}",
                    fontSize = 9.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.6f),
                )
            } else if (peak != null) {
                Text(
                    if (showAverage) "${FlowMath.weekdayName(peak)} costs the most on average · touch a bar"
                    else "Most spent on ${FlowMath.weekdayName(peak)} · touch a bar",
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.35f),
                )
            }
        }

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(70.dp)
                .pointerInput(values) {
                    detectTapGestures { offset ->
                        val slot = size.width / 7
                        val index = (offset.x / slot).toInt().coerceIn(0, 6)
                        selectedIndex = if (selectedIndex == index) null else index
                    }
                },
        ) {
            val maxValue = maxOf(values.maxOrNull() ?: 0.0, 0.01)
            val slot = size.width / 7
            val barWidth = slot * 0.5f
            values.forEachIndexed { index, total ->
                val h = (total / maxValue * size.height).toFloat()
                val alpha = selectedIndex?.let { if (it == index) 0.95f else 0.28f }
                    ?: (if (index == peak) 0.95f else 0.32f)
                drawRoundRect(
                    color = tint.copy(alpha = alpha),
                    topLeft = Offset(index * slot + (slot - barWidth) / 2, size.height - h),
                    size = Size(barWidth, h),
                    cornerRadius = CornerRadius(3.dp.toPx()),
                )
            }
        }

        Row(modifier = Modifier.fillMaxWidth()) {
            for (index in 0 until 7) {
                Text(
                    FlowMath.weekdayName(index),
                    fontSize = 8.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.35f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
