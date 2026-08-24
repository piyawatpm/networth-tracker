package com.piyawatpm.vesta.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.SouthWest
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.activity.compose.BackHandler
import com.piyawatpm.vesta.core.FlowMath
import com.piyawatpm.vesta.core.ForecastMath
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.core.forecastGoal
import com.piyawatpm.vesta.core.forecastInputs
import com.piyawatpm.vesta.data.NetworthGoal
import com.piyawatpm.vesta.data.ParsedPoint
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.TabReselect
import com.piyawatpm.vesta.ui.components.ChartOverlay
import com.piyawatpm.vesta.ui.components.FloatingScopePill
import com.piyawatpm.vesta.ui.components.FxChip
import com.piyawatpm.vesta.ui.components.HistoryChartCard
import com.piyawatpm.vesta.ui.components.SegmentedControl
import com.piyawatpm.vesta.ui.components.StatChip
import com.piyawatpm.vesta.ui.components.SuperChip
import com.piyawatpm.vesta.ui.components.launch2
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.financeCard
import kotlinx.coroutines.launch
import kotlin.math.abs

/** One month of net-worth growth, split the way the perf page splits it. */
data class GrowthSplit(
    val key: String,
    val label: String,
    val delta: Double,
    val deposits: Double?, // null = ledgers incomplete, no honest split
    val partial: Boolean,
) {
    val market: Double? get() = deposits?.let { delta - it }
}

/** One distribution segment, opened as a modal. */
data class SegmentDetail(
    val title: String,
    val tint: Color,
    val rows: List<Triple<String, String?, Double>>,
) {
    val total: Double get() = rows.sumOf { it.third }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(store: VestaStore, reselect: TabReselect) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var segmentDetail by remember { mutableStateOf<SegmentDetail?>(null) }
    var growthDetail by remember { mutableStateOf<GrowthSplit?>(null) }
    var showForecast by rememberSaveable { mutableStateOf(false) }

    // Tapping Home again scrolls back to the top.
    LaunchedEffect(reselect) {
        if (reselect.tab == 0 && reselect.count > 0) {
            if (showForecast) showForecast = false
            else listState.animateScrollToItem(0)
        }
    }

    if (showForecast) {
        BackHandler { showForecast = false }
        ForecastScreen(store, onBack = { showForecast = false })
        return
    }

    val scrolledPastHero by remember {
        derivedStateOf {
            listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 500
        }
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch {
                store.refresh()
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize().background(Ledger.background),
    ) {
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp, end = 16.dp, bottom = 110.dp,
            ),
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
        ) {
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                ) {
                    Text(
                        "Dashboard",
                        fontSize = 30.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                    Spacer(Modifier.weight(1f))
                    SuperChip(store)
                    Spacer(Modifier.width(8.dp))
                    FxChip(store)
                }
            }

            item {
                HistoryChartCard(
                    store = store,
                    title = if (store.includeSuperStocks) "Net Worth" else "Net Worth · ex-super",
                    parsed = if (store.includeSuperStocks) store.networthParsed
                    else store.networthParsedNoSuper,
                    liveValue = store.netWorth,
                    heroSize = 40.sp,
                    showUpdatedStamp = true,
                    overlays = componentOverlays(store),
                )
            }

            item { MonthlyGrowthCard(store) { growthDetail = it } }
            item { AssetBreakdownCard(store) { segmentDetail = it } }
            item { MonthFlowCard(store) }

            store.forecastGoal?.let { goal ->
                item { GoalCard(store, goal) { showForecast = true } }
            }

            val upcoming = upcomingItems(store)
            if (upcoming.isNotEmpty()) {
                item { UpcomingCard(store, upcoming) }
            }
            item { RecentActivityCard(store) }
        }

        // The number this whole app exists for, kept in sight while the rest
        // of the dashboard scrolls by — still live-ticking.
        if (scrolledPastHero) {
            Box(
                Modifier.fillMaxWidth().statusBarsPadding().padding(top = 4.dp),
                contentAlignment = Alignment.TopCenter,
            ) {
                FloatingScopePill(
                    title = if (store.includeSuperStocks) "Net Worth" else "Net Worth · ex-super",
                    total = store.format(store.netWorth),
                    tint = Ledger.income,
                    isFiltered = false,
                ) {}
            }
        }
    }

    segmentDetail?.let { detail ->
        SegmentDetailSheet(store, detail) { segmentDetail = null }
    }
    growthDetail?.let { split ->
        GrowthMonthSheet(store, split) { growthDetail = null }
    }
}

/** Every factor of net worth as an overlay: stocks (super-adjusted per the
 *  toggle), crypto, and the replayed signed debt as a step strip. */
private fun componentOverlays(store: VestaStore): List<ChartOverlay> {
    val superOn = store.includeSuperStocks
    val stocks = store.overlayPortfolio.map { point ->
        val delta = store.overlaySuperDelta[point.date]
        if (!superOn && delta != null) {
            ParsedPoint(point.date, maxOf(0.0, point.valueUsd - delta))
        } else {
            point
        }
    }
    return listOf(
        ChartOverlay("Stocks", Ledger.seriesStocks, stocks),
        ChartOverlay("Crypto", Ledger.seriesCrypto, store.overlayCrypto),
        ChartOverlay("Debt", Ledger.seriesDebt, store.overlayDebt, ChartOverlay.Form.STEP_STRIP),
    )
}

private fun growthSplits(store: VestaStore): List<GrowthSplit> =
    store.monthlyGrowth.map { row ->
        // "Invested" = external money INTO the tracked pots. April 2026 is
        // the seeding month — splits start with the first fully-tracked month.
        val invested = store.investedInMonth(row.key)
        val hasTx = row.key >= "2026-05"
        GrowthSplit(
            key = row.key, label = row.label,
            delta = store.convert(row.deltaUsd, "USD"),
            deposits = if (hasTx) invested else null,
            partial = row.partial,
        )
    }

/**
 * Month-over-month CHANGE, not the absolute level — split into invested
 * (external money in) vs market (what the assets did). Tap a bar for its
 * entry-level detail sheet.
 */
@Composable
private fun MonthlyGrowthCard(store: VestaStore, onOpenDetail: (GrowthSplit) -> Unit) {
    var growthWindow by rememberSaveable { mutableIntStateOf(12) }
    var showMoney by rememberSaveable { mutableStateOf(true) }
    var showMarket by rememberSaveable { mutableStateOf(true) }
    var selectedKey by remember { mutableStateOf<String?>(null) }

    val splits = growthSplits(store).takeLast(growthWindow + 1)
    val selected = splits.firstOrNull { it.key == selectedKey } ?: splits.lastOrNull()
    val maxKey = splits.filter { !it.partial }.maxByOrNull { abs(it.delta) }?.key

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono("Monthly Growth")
            Spacer(Modifier.weight(1f))
            SegmentedControl(
                options = listOf("6M", "1Y"),
                selectedIndex = if (growthWindow == 6) 0 else 1,
            ) { growthWindow = if (it == 0) 6 else 12 }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GrowthToggle("invested", Ledger.seriesStocks, showMoney) {
                if (showMoney && !showMarket) showMarket = true
                showMoney = !showMoney
            }
            GrowthToggle("market", Ledger.income, showMarket) {
                if (showMarket && !showMoney) showMoney = true
                showMarket = !showMarket
            }
        }

        // Readout: the touched month (else the latest), decomposed.
        Box(Modifier.height(15.dp)) {
            selected?.let { sel ->
                val deposits = sel.deposits
                val market = sel.market
                if (deposits != null && market != null) {
                    Text(
                        "${sel.label}${if (sel.partial) " so far" else ""} · ${store.format(deposits, compact = true)} invested · ${if (market >= 0) "+" else ""}${store.format(market, compact = true)} market · = ${if (sel.delta >= 0) "+" else ""}${store.format(sel.delta, compact = true)}",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.6f),
                        maxLines = 1,
                    )
                } else {
                    Text(
                        "${sel.label} · ${if (sel.delta >= 0) "+" else ""}${store.format(sel.delta, compact = true)} — before transaction tracking, no split",
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.4f),
                        maxLines = 1,
                    )
                }
            }
        }

        if (splits.size < 2) {
            Text(
                "Needs two months of snapshots to compare.",
                fontSize = 13.sp,
                color = Color.White.copy(alpha = 0.6f),
            )
        } else {
            // Value labels above the bars (max month + live month only when crowded).
            Row(Modifier.fillMaxWidth().height(14.dp)) {
                for (split in splits) {
                    val shown = buildList {
                        val deposits = split.deposits
                        val market = split.market
                        if (deposits != null && market != null) {
                            if (showMoney) add(deposits)
                            if (showMarket) add(market)
                        } else {
                            add(split.delta)
                        }
                    }
                    val labelValue = shown.sum()
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        if (splits.size <= 8 || split.partial || split.key == maxKey) {
                            Text(
                                store.format(labelValue, compact = true),
                                fontSize = 8.sp,
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = FontFamily.Monospace,
                                color = Color.White.copy(alpha = if (split.partial) 0.4f else 0.6f),
                                maxLines = 1,
                            )
                        }
                    }
                }
            }

            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .pointerInput(splits, showMoney, showMarket) {
                        detectTapGestures(
                            onTap = { offset ->
                                if (splits.isEmpty()) return@detectTapGestures
                                val slot = size.width / splits.size
                                val index = (offset.x / slot).toInt().coerceIn(0, splits.size - 1)
                                onOpenDetail(splits[index])
                            },
                            onLongPress = { offset ->
                                if (splits.isEmpty()) return@detectTapGestures
                                val slot = size.width / splits.size
                                val index = (offset.x / slot).toInt().coerceIn(0, splits.size - 1)
                                selectedKey =
                                    if (selectedKey == splits[index].key) null else splits[index].key
                            },
                        )
                    },
            ) {
                // Stacked ± bars around a shared zero line.
                var maxPos = 0.01
                var maxNeg = 0.01
                for (split in splits) {
                    val deposits = split.deposits
                    val market = split.market
                    val parts = if (deposits != null && market != null) {
                        buildList {
                            if (showMoney) add(deposits)
                            if (showMarket) add(market)
                        }
                    } else {
                        listOf(split.delta)
                    }
                    maxPos = maxOf(maxPos, parts.filter { it > 0 }.sum())
                    maxNeg = maxOf(maxNeg, -parts.filter { it < 0 }.sum())
                }
                val total = maxPos + maxNeg
                val zeroY = (maxPos / total * size.height).toFloat()
                val slot = size.width / splits.size
                val barWidth = slot * 0.55f

                fun h(value: Double): Float = (abs(value) / total * size.height).toFloat()

                splits.forEachIndexed { index, split ->
                    val x = index * slot + (slot - barWidth) / 2
                    val alpha = if (split.partial) 0.5f else 0.95f
                    val deposits = split.deposits
                    val market = split.market
                    var upCursor = zeroY
                    var downCursor = zeroY

                    fun drawPart(value: Double, color: Color) {
                        val ph = h(value)
                        if (value >= 0) {
                            drawRoundRect(
                                color = color.copy(alpha = alpha),
                                topLeft = Offset(x, upCursor - ph),
                                size = Size(barWidth, ph),
                                cornerRadius = CornerRadius(3.dp.toPx()),
                            )
                            upCursor -= ph
                        } else {
                            drawRoundRect(
                                color = color.copy(alpha = alpha),
                                topLeft = Offset(x, downCursor),
                                size = Size(barWidth, ph),
                                cornerRadius = CornerRadius(3.dp.toPx()),
                            )
                            downCursor += ph
                        }
                    }

                    if (deposits != null && market != null) {
                        if (showMoney) drawPart(deposits, Ledger.seriesStocks)
                        if (showMarket) {
                            drawPart(market, if (market >= 0) Ledger.income else Ledger.expense)
                        }
                    } else {
                        drawPart(
                            split.delta,
                            (if (split.delta >= 0) Ledger.income else Ledger.expense)
                                .copy(alpha = 0.55f),
                        )
                    }
                }

                // Zero rule.
                drawLine(
                    Color.White.copy(alpha = 0.15f),
                    Offset(0f, zeroY),
                    Offset(size.width, zeroY),
                    strokeWidth = 1f,
                )
            }

            Row(Modifier.fillMaxWidth()) {
                for (split in splits) {
                    Text(
                        split.label,
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.35f),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            // The window's aggregate — only months WITH a split, so
            // invested + market = Δ holds.
            val splitMonths = splits.filter { it.deposits != null }
            if (splitMonths.isNotEmpty()) {
                val sumIn = splitMonths.sumOf { it.deposits ?: 0.0 }
                val sumMarket = splitMonths.sumOf { it.market ?: 0.0 }
                val sumDelta = splitMonths.sumOf { it.delta }
                Text(
                    "Σ ${splitMonths.first().label}–${splitMonths.last().label} · ${store.format(sumIn, compact = true)} invested · ${if (sumMarket >= 0) "+" else ""}${store.format(sumMarket, compact = true)} market · Δ ${if (sumDelta >= 0) "+" else ""}${store.format(sumDelta, compact = true)}",
                    fontSize = 9.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.6f),
                )
            }
            Text(
                "net-worth change per month · tap a bar for its detail · long-press to read · faded = this month so far",
                fontSize = 9.sp,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.35f),
            )
        }
    }
}

@Composable
private fun GrowthToggle(label: String, color: Color, on: Boolean, onToggle: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .background(
                if (on) color.copy(alpha = 0.14f) else Color.White.copy(alpha = 0.04f),
                RoundedCornerShape(50),
            )
            .clickable { onToggle() }
            .padding(horizontal = 7.dp, vertical = 4.dp),
    ) {
        Box(
            Modifier.size(6.dp).background(
                if (on) color else Color.White.copy(alpha = 0.3f), CircleShape,
            )
        )
        Text(
            label,
            fontSize = 9.sp,
            fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = if (on) 0.6f else 0.35f),
        )
    }
}

/** The web's Asset Distribution — follows the super toggle so every number
 *  on screen describes the same pot. */
@Composable
private fun AssetBreakdownCard(store: VestaStore, onOpenSegment: (SegmentDetail) -> Unit) {
    val includeSuper = store.includeSuperStocks
    val traditional = store.holdings
        .filter { it.accountType != "super" }
        .sumOf { store.convert(store.holdingLiveValue(it), it.currency) }
    val superTotal = store.holdings
        .filter { it.accountType == "super" }
        .sumOf { store.convert(store.holdingLiveValue(it), it.currency) }
    val crypto = store.cryptoValue
    val segments = buildList {
        add(Triple("Traditional", traditional, Ledger.seriesStocks))
        add(Triple("Crypto", crypto, Ledger.seriesCrypto))
        if (includeSuper) add(Triple("Super", superTotal, Ledger.chartColor(1)))
    }
    val portfolioTotal = segments.sumOf { it.second }
    val cash = store.dryPowder(includeSuper)
    val cashPct = if (portfolioTotal > 0) cash / portfolioTotal * 100 else 0.0

    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                LabelMono("Asset Distribution")
                if (!includeSuper) {
                    Text(
                        "ex-super",
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.4f),
                    )
                }
            }
            Text(
                store.format(portfolioTotal),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
            Text(
                "everything you own · debts excluded",
                fontSize = 9.sp,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.4f),
            )
        }

        // One stacked bar — the shares at a glance.
        if (portfolioTotal > 0) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                modifier = Modifier.fillMaxWidth().height(6.dp),
            ) {
                for ((name, value, color) in segments) {
                    val fraction = (value / portfolioTotal).toFloat().coerceAtLeast(0.01f)
                    Box(
                        Modifier
                            .weight(fraction)
                            .height(6.dp)
                            .background(color, RoundedCornerShape(50)),
                    )
                }
            }
        }

        for ((name, value, color) in segments) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenSegment(segmentMembers(store, name, color)) },
            ) {
                Box(Modifier.size(8.dp).background(color, CircleShape))
                Spacer(Modifier.width(8.dp))
                Text(name, fontSize = 14.sp, color = Color.White)
                Spacer(Modifier.width(4.dp))
                Icon(
                    Icons.Filled.ChevronRight,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.4f),
                    modifier = Modifier.size(11.dp),
                )
                Spacer(Modifier.weight(1f))
                Text(
                    store.format(value),
                    fontSize = 13.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.6f),
                )
                Text(
                    "%.1f%%".format(if (portfolioTotal > 0) value / portfolioTotal * 100 else 0.0),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White,
                    modifier = Modifier.width(48.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                )
            }
        }

        com.piyawatpm.vesta.ui.components.SubtleDivider()

        // Deployable cash — the web's Dry Powder.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onOpenSegment(segmentMembers(store, "Cash", Ledger.income)) },
        ) {
            Icon(
                Icons.Filled.Payments,
                contentDescription = null,
                tint = Ledger.income,
                modifier = Modifier.size(13.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text("Cash · dry powder", fontSize = 14.sp, color = Color.White)
            Spacer(Modifier.width(4.dp))
            Icon(
                Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.4f),
                modifier = Modifier.size(11.dp),
            )
            Spacer(Modifier.weight(1f))
            Text(
                store.format(cash),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Color.White,
            )
            Text(
                "%.1f%%".format(cashPct),
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Ledger.income,
                modifier = Modifier.width(48.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.End,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text("Debts (net)", fontSize = 14.sp, color = Color.White.copy(alpha = 0.6f))
            Spacer(Modifier.weight(1f))
            Text(
                store.format(store.debtNet),
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.6f),
            )
        }

        com.piyawatpm.vesta.ui.components.SubtleDivider()

        // The reconciliation: portfolio − what you owe = net worth.
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text("Net worth", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Color.White)
            Spacer(Modifier.weight(1f))
            Text(
                store.format(store.netWorth),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Color.White,
            )
        }
    }
}

/** Members of a distribution segment, display currency, biggest first. */
private fun segmentMembers(store: VestaStore, segment: String, tint: Color): SegmentDetail {
    var rows: List<Triple<String, String?, Double>> = emptyList()
    when (segment) {
        "Traditional" -> rows = store.holdings
            .filter { it.accountType != "super" }
            .map {
                Triple(
                    it.ticker.ifEmpty { it.name },
                    if (it.ticker.isEmpty()) it.broker.ifEmpty { null } else it.name,
                    store.convert(store.holdingLiveValue(it), it.currency),
                )
            }
        "Super" -> rows = store.holdings
            .filter { it.accountType == "super" }
            .map {
                Triple(
                    it.ticker.ifEmpty { it.name },
                    it.name,
                    store.convert(store.holdingLiveValue(it), it.currency),
                )
            }
        "Crypto" -> rows = store.cryptoDisplayRows.map {
            Triple(it.token, if (it.isCash) "cash" else null, store.convert(it.valueUsd, "USD"))
        }
        "Cash" -> {
            rows = store.cryptoCsvHoldings
                .filter { store.cryptoCashTags[it.token] == true }
                .map { Triple(it.token, "crypto", store.convert(store.csvHoldingValueUsd(it), "USD")) } +
                store.holdings
                    .filter {
                        (it.isCash == true || it.type == "savings") &&
                            (store.includeSuperStocks || it.accountType != "super")
                    }
                    .map {
                        Triple(
                            it.name,
                            it.broker.ifEmpty { "account" },
                            store.convert(store.holdingLiveValue(it), it.currency),
                        )
                    }
        }
    }
    return SegmentDetail(
        title = segment,
        tint = tint,
        rows = rows.filter { it.third > 0.005 }.sortedByDescending { it.third },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SegmentDetailSheet(store: VestaStore, detail: SegmentDetail, onDismiss: () -> Unit) {
    var editingCash by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.background) {
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp, end = 16.dp, bottom = 32.dp,
            ),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(9.dp).background(detail.tint, CircleShape))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        store.format(detail.total),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${detail.rows.size} position${if (detail.rows.size == 1) "" else "s"}",
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                    if (detail.title == "Cash") {
                        TextButton(onClick = { editingCash = true }) {
                            Text("Edit", color = Ledger.income)
                        }
                    }
                }
            }
            items(detail.rows.size) { index ->
                val row = detail.rows[index]
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                row.first,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                                color = Color.White,
                            )
                            row.second?.takeIf { it != row.first }?.let {
                                Text(
                                    it,
                                    fontSize = 10.sp,
                                    color = Color.White.copy(alpha = 0.6f),
                                    maxLines = 1,
                                )
                            }
                        }
                        Text(
                            store.format(row.third, compact = true),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White,
                        )
                        Text(
                            "%.1f%%".format(if (detail.total > 0) row.third / detail.total * 100 else 0.0),
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.4f),
                            modifier = Modifier.width(46.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.End,
                        )
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .background(Color.White.copy(alpha = 0.06f), RoundedCornerShape(50)),
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(
                                    (if (detail.total > 0) row.third / detail.total else 0.0)
                                        .toFloat().coerceIn(0.01f, 1f),
                                )
                                .height(4.dp)
                                .background(detail.tint.copy(alpha = 0.85f), RoundedCornerShape(50)),
                        )
                    }
                }
            }
        }
    }

    if (editingCash) {
        CashPickerSheet(store) { editingCash = false }
    }
}

/** "Which of my assets count as cash?" — tokens write crypto_cash_tags;
 *  holdings flip their isCash flag. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CashPickerSheet(store: VestaStore, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.background) {
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp, end = 16.dp, bottom = 32.dp,
            ),
        ) {
            item {
                Text(
                    "What counts as cash",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
            }
            item { LabelMono("Crypto tokens") }
            val tokens = store.cryptoCsvHoldings
                .sortedByDescending { store.csvHoldingValueUsd(it) }
            items(tokens.size) { index ->
                val holding = tokens[index]
                val on = store.cryptoCashTags[holding.token] == true
                CashRow(
                    name = holding.token,
                    value = store.format(
                        store.convert(store.csvHoldingValueUsd(holding), "USD"),
                        compact = true,
                    ),
                    on = on,
                ) { store.scope.launch2 { store.setCryptoCash(holding.token, !on) } }
            }
            item { LabelMono("Holdings") }
            items(store.holdings.size) { index ->
                val holding = store.holdings[index]
                val flagged = holding.isCash == true
                val locked = holding.type == "savings" // savings ARE cash
                CashRow(
                    name = holding.ticker.ifEmpty { holding.name },
                    value = store.format(
                        store.convert(store.holdingLiveValue(holding), holding.currency),
                        compact = true,
                    ),
                    on = flagged || locked,
                ) {
                    if (!locked) {
                        store.scope.launch2 { store.setHoldingCash(holding.id, !flagged) }
                    }
                }
            }
            item {
                com.piyawatpm.vesta.ui.components.FinePrint(
                    "Synced with the web's Cash tags. Savings-type accounts always count.",
                    size = 9.sp,
                )
            }
        }
    }
}

@Composable
private fun CashRow(name: String, value: String, on: Boolean, onToggle: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable { onToggle() },
    ) {
        Text(
            name,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            color = Color.White,
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.6f),
        )
        Spacer(Modifier.width(10.dp))
        Icon(
            if (on) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
            contentDescription = null,
            tint = if (on) Ledger.income else Color.White.copy(alpha = 0.4f),
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun MonthFlowCard(store: VestaStore) {
    val month = SydneyTime.currentMonthKey()
    val earned = store.monthTotal(store.allIncome, month)
    val spent = store.monthTotalExpenses(month)

    Row(modifier = Modifier.fillMaxWidth().financeCard().padding(vertical = 14.dp)) {
        FlowTile("Income", store.format(earned, compact = true), Ledger.income, Modifier.weight(1f))
        FlowTile("Expenses", store.format(spent, compact = true), Ledger.expense, Modifier.weight(1f))
        FlowTile(
            "Saved",
            store.format(earned - spent, compact = true),
            if (earned - spent >= 0) Ledger.income else Ledger.expense,
            Modifier.weight(1f),
        )
    }
}

@Composable
private fun FlowTile(label: String, value: String, tint: Color, modifier: Modifier = Modifier) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = modifier,
    ) {
        LabelMono(label)
        Text(
            value,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            style = com.piyawatpm.vesta.ui.components.MoneyStyle,
            color = tint,
        )
    }
}

/** When the goal lands under the compound forecast — the same walk the
 *  Forecast page draws, so card and page never name different dates. */
@Composable
private fun GoalCard(store: VestaStore, goal: NetworthGoal, onOpen: () -> Unit) {
    val target = store.convert(goal.amount, goal.currency)
    val progress = if (target > 0) (store.netWorth / target).coerceIn(0.0, 1.0) else 0.0
    val eta = ForecastMath.monthsToReach(store.forecastInputs, target)
        ?.takeIf { it > 0 }
        ?.let {
            "${ForecastMath.monthYear(ForecastMath.addMonths(it))} · ${ForecastMath.describe(it)} at this pace"
        }

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().financeCard().clickable { onOpen() }.padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono(goal.name.ifEmpty { "Goal" })
            Spacer(Modifier.weight(1f))
            Text(
                "${(progress * 100).toInt()}%",
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Ledger.income,
            )
            Icon(
                Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.4f),
                modifier = Modifier.size(12.dp),
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(50)),
        ) {
            Box(
                Modifier
                    .fillMaxWidth(progress.toFloat().coerceAtLeast(0.02f))
                    .height(8.dp)
                    .background(Ledger.income, RoundedCornerShape(50)),
            )
        }
        Text(
            "${store.format(store.netWorth, compact = true)} of ${store.format(target, compact = true)} — ${store.format(maxOf(0.0, target - store.netWorth), compact = true)} to go",
            fontSize = 10.sp,
            color = Color.White.copy(alpha = 0.6f),
        )
        eta?.let {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(
                    Icons.Filled.Flag,
                    contentDescription = null,
                    tint = Ledger.income,
                    modifier = Modifier.size(11.dp),
                )
                Text(
                    it,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Medium,
                    fontFamily = FontFamily.Monospace,
                    color = Ledger.income,
                )
            }
        }
    }
}

private data class UpcomingItem(
    val id: String,
    val label: String,
    val amount: Double,
    val currency: String,
    val date: String,
    val isIncome: Boolean,
)

private fun upcomingItems(store: VestaStore): List<UpcomingItem> {
    val today = SydneyTime.today()
    val items = mutableListOf<UpcomingItem>()
    for (template in store.recurringIncome) {
        template.nextOccurrence(today)?.let { next ->
            items.add(
                UpcomingItem(
                    "in-${template.id}", template.description,
                    template.amount, template.currency, next, true,
                )
            )
        }
    }
    for (template in store.recurringExpenses) {
        template.nextOccurrence(today)?.let { next ->
            items.add(
                UpcomingItem(
                    "ex-${template.id}", template.description,
                    -template.amount, template.currency, next, false,
                )
            )
        }
    }
    return items.sortedBy { it.date }.take(4)
}

@Composable
private fun UpcomingCard(store: VestaStore, upcoming: List<UpcomingItem>) {
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono("Upcoming")
        for (item in upcoming) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.CalendarMonth,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.6f),
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.label, fontSize = 14.sp, color = Color.White, maxLines = 1)
                    Text(
                        SydneyTime.shortLabel(item.date),
                        fontSize = 10.sp,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
                Text(
                    Money.format(item.amount, item.currency),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    fontFamily = FontFamily.Monospace,
                    color = if (item.isIncome) Ledger.income else Ledger.expense,
                )
            }
        }
    }
}

@Composable
private fun RecentActivityCard(store: VestaStore) {
    data class ActivityItem(
        val id: String,
        val label: String,
        val amount: Double,
        val currency: String,
        val date: String,
        val isIncome: Boolean,
    )

    val recent = buildList {
        for (entry in store.allIncome) {
            add(
                ActivityItem(
                    entry.id,
                    entry.description.ifEmpty { store.incomeLabel(entry.type) },
                    entry.amount, entry.currency, entry.date, true,
                )
            )
        }
        for (entry in store.expenses) {
            add(
                ActivityItem(
                    entry.id,
                    entry.description.ifEmpty { store.expenseLabel(entry.type) },
                    -entry.amount, entry.currency, entry.date, false,
                )
            )
        }
    }.sortedByDescending { it.date }.take(6)

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono("Recent")
        if (recent.isEmpty()) {
            Text("No activity yet.", fontSize = 13.sp, color = Color.White.copy(alpha = 0.6f))
        }
        for (item in recent) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (item.isIncome) Icons.Filled.SouthWest else Icons.Filled.NorthEast,
                    contentDescription = null,
                    tint = if (item.isIncome) Ledger.income else Ledger.expense,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.label, fontSize = 14.sp, color = Color.White, maxLines = 1)
                    Text(
                        SydneyTime.shortLabel(item.date),
                        fontSize = 10.sp,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
                Text(
                    Money.format(item.amount, item.currency),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    fontFamily = FontFamily.Monospace,
                    color = if (item.amount >= 0) Ledger.income else Ledger.expense,
                )
            }
        }
    }
}

/**
 * The month behind a growth bar, entry by entry: every flow row grouped by
 * pot, with sub-$25 crypto dust collapsed into one expandable line.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GrowthMonthSheet(store: VestaStore, split: GrowthSplit, onDismiss: () -> Unit) {
    var showDust by remember { mutableStateOf(false) }

    data class FlowRowItem(val id: String, val label: String, val sub: String, val value: Double)

    /** Stock/super trades that month, biggest first. */
    fun stockRows(superFund: Boolean): List<FlowRowItem> {
        val superIds = store.holdings.filter { it.accountType == "super" }.map { it.id }.toSet()
        return store.livePortfolioTxs
            .filter {
                SydneyTime.monthKey(it.date) == split.key &&
                    (it.holdingId in superIds) == superFund
            }
            .map { tx ->
                val value = store.convert(tx.totalAmount, tx.currency)
                FlowRowItem(
                    id = tx.id,
                    label = "${if (tx.type == "buy") "Buy" else "Sell"} ${tx.holdingName}",
                    sub = SydneyTime.shortLabel(tx.date),
                    value = if (tx.type == "buy") value else -value,
                )
            }
            .sortedByDescending { abs(it.value) }
    }

    val portfolio = stockRows(superFund = false)
    val superRows = stockRows(superFund = true)
    val crypto = store.cryptoExternalEvents
        .filter { it.month == split.key }
        .map { event ->
            FlowRowItem(
                id = "c-${event.date}-${event.token}-${event.usd}",
                label = "${if (event.usd >= 0) "Deposit" else "Withdraw"} ${event.token}",
                sub = SydneyTime.shortLabel(event.date),
                value = store.convert(event.usd, "USD"),
            )
        }
        .sortedByDescending { abs(it.value) }

    // Bot payouts arrive in $1–$8 pieces; below ~$25 they collapse into one
    // expandable line so the moves that matter stay readable.
    val dustLimit = store.convert(25.0, "USD")
    val bigCrypto = crypto.filter { abs(it.value) >= dustLimit }
    val dust = crypto.filter { abs(it.value) < dustLimit }
    val invested = (portfolio + superRows + crypto).sumOf { it.value }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.background) {
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp, end = 16.dp, bottom = 32.dp,
            ),
        ) {
            item {
                Text(
                    "${com.piyawatpm.vesta.core.fullMonthName(split.key.takeLast(2).toIntOrNull() ?: 1)} ${split.key.take(4)}${if (split.partial) " · so far" else ""}",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatChip(
                        "Invested",
                        "${if (invested >= 0) "+" else ""}${store.format(invested, compact = true)}",
                        Ledger.seriesStocks,
                    )
                    split.market?.let { market ->
                        StatChip(
                            "Market",
                            "${if (market >= 0) "+" else ""}${store.format(market, compact = true)}",
                            if (market >= 0) Ledger.income else Ledger.expense,
                        )
                    }
                    StatChip(
                        "Δ NW",
                        "${if (split.delta >= 0) "+" else ""}${store.format(split.delta, compact = true)}",
                    )
                }
            }

            fun sectionHeader(title: String, tint: Color, net: Double, count: Int) {
                item {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(top = 8.dp),
                    ) {
                        Text(
                            "$title · $count",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = tint,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            "net ${if (net >= 0) "+" else ""}${store.format(net, compact = true)}",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = if (net >= 0) Ledger.income else Ledger.expense,
                        )
                    }
                }
            }

            fun flowRows(rows: List<FlowRowItem>) {
                items(rows.size) { index ->
                    val row = rows[index]
                    FlowEntryRow(store, row.label, row.sub, row.value)
                }
            }

            if (portfolio.isNotEmpty()) {
                sectionHeader("Portfolio", Ledger.seriesStocks, portfolio.sumOf { it.value }, portfolio.size)
                flowRows(portfolio)
            }
            if (superRows.isNotEmpty()) {
                sectionHeader("Super", Ledger.seriesDebt, superRows.sumOf { it.value }, superRows.size)
                flowRows(superRows)
            }
            if (crypto.isNotEmpty()) {
                sectionHeader("Crypto", Ledger.seriesCrypto, crypto.sumOf { it.value }, crypto.size)
                flowRows(bigCrypto)
                if (dust.isNotEmpty()) {
                    val dustNet = dust.sumOf { it.value }
                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth().clickable { showDust = !showDust },
                        ) {
                            Icon(
                                Icons.Filled.ChevronRight,
                                contentDescription = null,
                                tint = Color.White.copy(alpha = 0.4f),
                                modifier = Modifier
                                    .size(14.dp)
                                    .graphicsLayer { rotationZ = if (showDust) 90f else 0f },
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "${dust.size} small moves",
                                fontSize = 14.sp,
                                color = Color.White.copy(alpha = 0.6f),
                            )
                            Spacer(Modifier.weight(1f))
                            Text(
                                "${if (dustNet >= 0) "+" else ""}${store.format(dustNet, compact = true)}",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                fontFamily = FontFamily.Monospace,
                                color = Color.White.copy(alpha = 0.6f),
                            )
                        }
                    }
                    if (showDust) flowRows(dust)
                }
            }

            if (portfolio.isEmpty() && superRows.isEmpty() && crypto.isEmpty()) {
                item {
                    Text(
                        "No investment flows recorded this month.",
                        fontSize = 12.sp,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
            }

            if (split.market != null) {
                item {
                    com.piyawatpm.vesta.ui.components.FinePrint(
                        "Invested = stock & super buys − sells + crypto deposits − withdrawals. Market = the month's net-worth change minus that — what the assets themselves did (debt moves land here too).",
                        size = 9.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun FlowEntryRow(store: VestaStore, label: String, sub: String, value: Double) {
    val inbound = value >= 0
    val tint = if (inbound) Ledger.income else Ledger.expense
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(22.dp).background(tint.copy(alpha = 0.12f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (inbound) Icons.Filled.SouthWest else Icons.Filled.NorthEast,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(10.dp),
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 14.sp, color = Color.White, maxLines = 1)
            Text(sub, fontSize = 10.sp, color = Color.White.copy(alpha = 0.4f))
        }
        Text(
            "${if (inbound) "+" else ""}${store.format(value, compact = true)}",
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            color = tint,
        )
    }
}
