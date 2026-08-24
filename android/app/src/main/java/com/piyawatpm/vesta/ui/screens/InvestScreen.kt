package com.piyawatpm.vesta.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CurrencyBitcoin
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.data.CryptoMath
import com.piyawatpm.vesta.data.DerivedPosition
import com.piyawatpm.vesta.data.HostplusApi
import com.piyawatpm.vesta.data.PortfolioHolding
import com.piyawatpm.vesta.data.PortfolioMath
import com.piyawatpm.vesta.data.PortfolioTransaction
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.TabReselect
import com.piyawatpm.vesta.ui.components.AllocationDonutCard
import com.piyawatpm.vesta.ui.components.AllocationSlice
import com.piyawatpm.vesta.ui.components.BreakdownBar
import com.piyawatpm.vesta.ui.components.BreakdownBarsCard
import com.piyawatpm.vesta.ui.components.FxChip
import com.piyawatpm.vesta.ui.components.HistoryChartCard
import com.piyawatpm.vesta.ui.components.HoldingGroupsCard
import com.piyawatpm.vesta.ui.components.MoneyText
import com.piyawatpm.vesta.ui.components.RecentTradesCard
import com.piyawatpm.vesta.ui.components.SegmentedControl
import com.piyawatpm.vesta.ui.components.SubtleDivider
import com.piyawatpm.vesta.ui.components.SuperChip
import com.piyawatpm.vesta.ui.components.launch2
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.LogoCircle
import com.piyawatpm.vesta.ui.theme.financeCard
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

/**
 * Stocks and crypto under one roof, matching the web's mental model of two
 * pots. Port of ios InvestView + PortfolioSection + CryptoSection.
 */
@Composable
fun InvestScreen(store: VestaStore, reselect: TabReselect) {
    val pagerState = rememberPagerState(pageCount = { 2 })
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var detailHolding by remember { mutableStateOf<PortfolioHolding?>(null) }

    val hasHostplus = store.holdings.any {
        HostplusApi.optionNameByTicker[it.ticker.uppercase()] != null
    }

    detailHolding?.let { holding ->
        // Keep the detail bound to the store's current copy of the holding.
        val live = store.holdings.firstOrNull { it.id == holding.id } ?: holding
        BackHandler { detailHolding = null }
        HoldingDetailScreen(store, live) { detailHolding = null }
        return
    }

    LaunchedEffect(reselect) {
        if (reselect.tab == 3 && reselect.count > 0) pagerState.animateScrollToPage(0)
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch {
                store.refresh()
                if (pagerState.currentPage == 0) store.refreshHostplus()
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize().background(Ledger.background),
    ) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text("Invest", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Spacer(Modifier.width(8.dp))
                if (hasHostplus) {
                    if (store.isRefreshingHostplus) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Ledger.subtle,
                        )
                    } else {
                        Icon(
                            Icons.Filled.Refresh,
                            contentDescription = "Update Hostplus super price",
                            tint = Color.White.copy(alpha = 0.6f),
                            modifier = Modifier
                                .size(20.dp)
                                .clickable { store.scope.launch2 { store.refreshHostplus() } },
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                SuperChip(store)
                Spacer(Modifier.width(8.dp))
                FxChip(store)
            }

            TotalStrip(store)

            SegmentedControl(
                options = listOf("Stocks", "Crypto"),
                selectedIndex = pagerState.currentPage,
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp).fillMaxWidth(),
            ) { scope.launch { pagerState.animateScrollToPage(it) } }

            // Real pager: swipe between pots, picker stays in sync.
            HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
                when (page) {
                    0 -> PortfolioSection(store) { detailHolding = it }
                    else -> CryptoSection(store)
                }
            }
        }
    }
}

/** Stocks + crypto as one figure, with each pot's share underneath. */
@Composable
private fun TotalStrip(store: VestaStore) {
    val stocks = store.stocksValueVisible
    val crypto = store.cryptoValue
    val total = stocks + crypto

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .padding(horizontal = 16.dp)
            .padding(bottom = 10.dp)
            .fillMaxWidth()
            .financeCard()
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                LabelMono("Total Portfolio")
                Text(
                    store.format(total),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    style = com.piyawatpm.vesta.ui.components.MoneyStyle,
                    color = Color.White,
                )
            }
            Spacer(Modifier.weight(1f))
            if (!store.includeSuperStocks) {
                Text(
                    "ex-super",
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.4f),
                )
            }
        }

        if (total > 0) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                modifier = Modifier.fillMaxWidth().height(6.dp),
            ) {
                Box(
                    Modifier
                        .weight((stocks / total).toFloat().coerceAtLeast(0.02f))
                        .height(6.dp)
                        .background(Ledger.seriesStocks, RoundedCornerShape(50)),
                )
                Box(
                    Modifier
                        .weight((crypto / total).toFloat().coerceAtLeast(0.02f))
                        .height(6.dp)
                        .background(Ledger.seriesCrypto, RoundedCornerShape(50)),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PotLegend(store, "Stocks", stocks, total, Ledger.seriesStocks)
                PotLegend(store, "Crypto", crypto, total, Ledger.seriesCrypto)
            }
        }
    }
}

@Composable
private fun PotLegend(store: VestaStore, label: String, value: Double, total: Double, tint: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.size(7.dp).background(tint, CircleShape))
        Text(label, fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f))
        Text(
            store.format(value, compact = true),
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            color = Color.White,
        )
        Text(
            "%.0f%%".format(if (total > 0) value / total * 100 else 0.0),
            fontSize = 9.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.4f),
        )
    }
}

// MARK: - Stocks

private val typeLabels = mapOf(
    "stock" to "Stocks", "etf" to "ETFs", "fund" to "Funds",
    "bond" to "Bonds", "other" to "Other",
)
private val typeColorIndex = mapOf(
    "stock" to 0, "etf" to 1, "fund" to 2, "bond" to 3, "other" to 4,
)

@Composable
private fun PortfolioSection(store: VestaStore, onOpenHolding: (PortfolioHolding) -> Unit) {
    val rows = store.holdings
        .filter { it.type != "savings" }
        .filter { store.includeSuperStocks || it.accountType != "super" }
        .map { holding ->
            holding to PortfolioMath.derivePosition(
                store.portfolioTxs.filter { it.holdingId == holding.id }
            )
        }
        .sortedByDescending { (h, _) -> store.convert(store.holdingLiveValue(h), h.currency) }

    fun displayValue(holding: PortfolioHolding): Double =
        store.convert(store.holdingLiveValue(holding), holding.currency)

    // Web parity: holding-level invested vs live value, display currency.
    val investedTotal = rows.sumOf { store.convert(it.first.amountInvested, it.first.currency) }
    val unrealizedTotal = rows.sumOf {
        store.convert(store.holdingLiveValue(it.first) - it.first.amountInvested, it.first.currency)
    }

    // The web's realizedBreakdown: only holdings with a recorded sell appear.
    val realizedRows = rows.mapNotNull { (holding, position) ->
        if (position.totalSold <= 0) return@mapNotNull null
        RealizedRow(
            holding.id, holding.name, holding.ticker,
            store.convert(position.realizedPnl, holding.currency),
        )
    }.sortedByDescending { it.value }

    val allocationModes = run {
        val byType = HashMap<String, Double>()
        val byCountry = HashMap<String, Double>()
        for ((holding, _) in rows) {
            byType[holding.type] = (byType[holding.type] ?: 0.0) + displayValue(holding)
            val country = holding.country.ifEmpty { "Unknown" }
            byCountry[country] = (byCountry[country] ?: 0.0) + displayValue(holding)
        }
        val typeSlices = byType.map { (type, value) ->
            AllocationSlice(
                typeLabels[type] ?: type, value,
                Ledger.chartColor(typeColorIndex[type] ?: 4),
            )
        }.sortedByDescending { it.value }

        val sorted = rows.sortedByDescending { displayValue(it.first) }
        val holdingSlices = sorted.take(6).mapIndexed { index, (holding, _) ->
            AllocationSlice(
                holding.ticker.ifEmpty { holding.name },
                displayValue(holding),
                Ledger.chartColor(index),
            )
        }.toMutableList()
        val rest = sorted.drop(6).sumOf { displayValue(it.first) }
        if (rest > 0) holdingSlices.add(AllocationSlice("Other", rest, Ledger.chartColor(6)))

        val countrySlices = byCountry.entries
            .sortedByDescending { it.value }
            .mapIndexed { index, entry ->
                AllocationSlice(entry.key, entry.value, Ledger.chartColor(index))
            }

        listOf("Type" to typeSlices, "Holdings" to holdingSlices, "Country" to countrySlices)
    }

    val brokerBars = rows
        .groupBy { it.first.broker.ifEmpty { "Unknown" } }
        .map { (name, members) ->
            BreakdownBar(name, members.size, members.sumOf { displayValue(it.first) })
        }
        .sortedByDescending { it.value }

    val visibleIds = rows.map { it.first.id }.toSet()
    val recentTrades = store.portfolioTxs
        .filter { it.holdingId in visibleIds }
        .sortedWith(compareByDescending<PortfolioTransaction> { it.date }.thenByDescending { it.createdAt })
        .take(8)

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp, end = 16.dp, bottom = 110.dp,
        ),
        modifier = Modifier.fillMaxSize(),
    ) {
        item {
            // Chart + value follow the toggle: the snapshot table stores both
            // series (value = ex-super, value_with_super = with), same as web.
            HistoryChartCard(
                store = store,
                title = if (store.includeSuperStocks) "Stocks & Funds" else "Stocks · ex-super",
                parsed = if (store.includeSuperStocks) store.portfolioParsedWithSuper
                else store.portfolioParsed,
                liveValue = store.stocksValueVisible,
                heroSize = 32.sp,
            )
        }

        item {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().financeCard().padding(14.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text("Invested", fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f))
                    Text(
                        store.format(investedTotal, compact = true),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White,
                    )
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(
                        "${if (unrealizedTotal >= 0) "+" else ""}${store.format(unrealizedTotal, compact = true)}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace,
                        color = if (unrealizedTotal >= 0) Ledger.income else Ledger.expense,
                    )
                    Text(
                        if (investedTotal > 0) {
                            "unrealized ${if (unrealizedTotal >= 0) "+" else ""}${"%.1f".format(unrealizedTotal / investedTotal * 100)}%"
                        } else "unrealized",
                        fontSize = 8.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.4f),
                    )
                }
            }
        }

        if (rows.size > 1) {
            item { AllocationDonutCard(store, "Allocation", allocationModes, "holdings") }
        }

        item { HoldingGroupsCard(store, rows.map { it.first }) }

        item {
            RealizedPnlCard(
                store = store,
                rows = realizedRows,
                countNoun = "position",
                emptyHint = "Realized gains and losses show up here once you log a sell — including holdings you've fully exited.",
            )
        }

        if (brokerBars.size > 1) {
            item { BreakdownBarsCard(store, "By broker", brokerBars) }
        }

        items(rows.size, key = { rows[it].first.id }) { index ->
            val (holding, position) = rows[index]
            HoldingCard(store, holding, position) { onOpenHolding(holding) }
        }

        if (recentTrades.isNotEmpty()) {
            item { RecentTradesCard(store, recentTrades) }
        }
    }
}

@Composable
private fun HoldingCard(
    store: VestaStore,
    holding: PortfolioHolding,
    position: DerivedPosition,
    onOpen: () -> Unit,
) {
    // Unrealized gain in the holding's own currency: live value − cost basis
    // remaining after sells (average-cost, same as the web table).
    val liveValue = store.holdingLiveValue(holding)
    val base = if (position.costBasis > 0) position.costBasis else holding.amountInvested
    val gain = liveValue - base
    val pct = if (base > 0) gain / base * 100 else 0.0
    val isLive = store.liveStockPrices.containsKey(holding.ticker)
    val units = if (position.units > 0) position.units else holding.units

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().clickable { onOpen() }.padding(14.dp),
    ) {
        LogoCircle(
            url = store.stockLogoURL(holding.ticker),
            fallback = holding.ticker.ifEmpty { holding.name },
        )
        Column(verticalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.weight(1f)) {
            Text(
                holding.name,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = Color.White,
                maxLines = 1,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (holding.ticker.isNotEmpty()) {
                    Text(
                        holding.ticker,
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White,
                        modifier = Modifier
                            .background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(50))
                            .padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                }
                if (isLive) {
                    // Ticking from the Alpaca socket right now.
                    Box(Modifier.size(5.dp).background(Ledger.income, CircleShape))
                }
                if (holding.accountType == "super") {
                    Text(
                        "SUPER",
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White,
                        modifier = Modifier
                            .background(Ledger.chartColor(1).copy(alpha = 0.15f), RoundedCornerShape(50))
                            .padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                }
                if (units > 0) {
                    Text(
                        "${store.format(store.convert(liveValue / units, holding.currency), compact = true)}/u",
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                store.format(store.convert(liveValue, holding.currency)),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Color.White,
            )
            Text(
                "${if (gain >= 0) "+" else ""}${store.format(store.convert(gain, holding.currency), compact = true)} (${if (gain >= 0) "+" else ""}${"%.1f".format(pct)}%)",
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                fontFamily = FontFamily.Monospace,
                color = if (gain >= 0) Ledger.income else Ledger.expense,
            )
        }
    }
}

data class RealizedRow(val id: String, val name: String, val ticker: String, val value: Double)

/** The web's "All-Time Realized" card, shared by both pots. */
@Composable
fun RealizedPnlCard(
    store: VestaStore,
    rows: List<RealizedRow>,
    countNoun: String,
    emptyHint: String,
    zeroHeaderWhenEmpty: Boolean = false,
) {
    val total = rows.sumOf { it.value }

    if (rows.isEmpty() && !zeroHeaderWhenEmpty) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth().financeCard().padding(14.dp),
        ) {
            Icon(
                Icons.Filled.Receipt,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.6f),
                modifier = Modifier.size(22.dp),
            )
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "Track realized profit",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = Color.White,
                )
                Text(emptyHint, fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f))
            }
        }
        return
    }

    Column(modifier = Modifier.fillMaxWidth().financeCard()) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(14.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                LabelMono("All-Time Realized")
                Text(
                    "${if (total >= 0) "+" else ""}${store.format(total)}",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    color = if (total >= 0) Ledger.income else Ledger.expense,
                )
            }
            Spacer(Modifier.weight(1f))
            if (rows.isNotEmpty()) {
                Text(
                    "${rows.size} $countNoun${if (rows.size == 1) "" else "s"}",
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.6f),
                )
            }
        }
        SubtleDivider()
        if (rows.isEmpty()) {
            Text(
                "No realized sells yet — locked-in gains show up here once you sell.",
                fontSize = 10.sp,
                color = Color.White.copy(alpha = 0.6f),
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 16.dp).fillMaxWidth(),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        } else {
            rows.forEachIndexed { index, row ->
                if (index > 0) SubtleDivider()
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                ) {
                    Text(
                        row.name,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = Color.White,
                        maxLines = 1,
                    )
                    if (row.ticker.isNotEmpty() && row.ticker != row.name) {
                        Text(
                            row.ticker,
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${if (row.value >= 0) "+" else ""}${store.format(row.value, compact = true)}",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace,
                        color = if (row.value >= 0) Ledger.income else Ledger.expense,
                    )
                }
            }
        }
    }
}

// MARK: - Crypto

private val priceFormatter: NumberFormat =
    NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }

@Composable
private fun CryptoSection(store: VestaStore) {
    val rows = store.cryptoDisplayRows
    val investedRows = rows.filter { !it.isCash }
    val cashRows = rows.filter { it.isCash }
    val portTotal = rows.sumOf { it.valueUsd }

    val coinSlices = run {
        val sorted = rows.sortedByDescending { it.valueUsd }
        val slices = sorted.take(6).mapIndexed { index, row ->
            AllocationSlice(row.token, store.convert(row.valueUsd, "USD"), Ledger.chartColor(index))
        }.toMutableList()
        val rest = sorted.drop(6).sumOf { it.valueUsd }
        if (rest > 0) {
            slices.add(AllocationSlice("Other", store.convert(rest, "USD"), Ledger.chartColor(6)))
        }
        slices
    }

    // Value per exchange — rendered only once at least one token has an
    // exchange assigned; an all-Unassigned card says nothing.
    val exchangeBars = run {
        var assigned = false
        val byExchange = HashMap<String, Pair<Double, Int>>()
        for (row in rows) {
            val name = store.exchangeOverrides[row.token]?.trim() ?: ""
            if (name.isNotEmpty()) assigned = true
            val key = name.ifEmpty { "Unassigned" }
            val entry = byExchange[key] ?: (0.0 to 0)
            byExchange[key] = (entry.first + store.convert(row.valueUsd, "USD")) to (entry.second + 1)
        }
        if (!assigned) emptyList()
        else byExchange.map { BreakdownBar(it.key, it.value.second, it.value.first) }
            .sortedByDescending { it.value }
    }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp, end = 16.dp, bottom = 110.dp,
        ),
        modifier = Modifier.fillMaxSize(),
    ) {
        item {
            HistoryChartCard(
                store = store,
                title = "Crypto",
                parsed = store.cryptoParsed,
                liveValue = store.cryptoValue,
                heroSize = 32.sp,
            )
        }

        item {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(14.dp),
            ) {
                PotBadge(store, "Invested", investedRows.sumOf { it.valueUsd }, Ledger.chartColor(12))
                PotBadge(store, "Cash (stables)", cashRows.sumOf { it.valueUsd }, Ledger.chartColor(5))
                Spacer(Modifier.weight(1f))
                val pnl = investedRows.sumOf { it.pnlUsd }
                val cost = investedRows.sumOf { it.costUsd }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(
                        "${if (pnl >= 0) "+" else ""}${store.format(store.convert(pnl, "USD"), compact = true)}",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace,
                        color = if (pnl >= 0) Ledger.income else Ledger.expense,
                    )
                    Text(
                        if (cost > 0) "unrealized ${if (pnl >= 0) "+" else ""}${"%.1f".format(pnl / cost * 100)}%"
                        else "unrealized",
                        fontSize = 8.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.4f),
                    )
                }
            }
        }

        if (rows.size > 1) {
            item { AllocationDonutCard(store, "Allocation", listOf("Coins" to coinSlices), "coins") }
        }

        if (store.cryptoTxs.isNotEmpty()) {
            item {
                val (_, byToken) = CryptoMath.computeRealizedPnl(store.cryptoTxs)
                RealizedPnlCard(
                    store = store,
                    rows = byToken.map {
                        RealizedRow(it.token, it.token, "", store.convert(it.realizedPnlUsd, "USD"))
                    },
                    countNoun = "token",
                    emptyHint = "",
                    zeroHeaderWhenEmpty = true,
                )
            }
        }

        if (rows.isEmpty()) {
            item {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().financeCard().padding(24.dp),
                ) {
                    Icon(
                        Icons.Filled.CurrencyBitcoin,
                        contentDescription = null,
                        tint = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.size(34.dp),
                    )
                    Text(
                        "Upload your transaction CSV on the web app to populate this.",
                        fontSize = 13.sp,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
            }
        }

        items(rows.size, key = { rows[it].token }) { index ->
            val row = rows[index]
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(14.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    LogoCircle(url = store.coinImageURL(row.token), fallback = row.token)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(
                                row.token,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color.White,
                            )
                            if (row.isCash) {
                                Text(
                                    "CASH",
                                    fontSize = 9.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color.White,
                                    modifier = Modifier
                                        .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(50))
                                        .padding(horizontal = 5.dp, vertical = 2.dp),
                                )
                            } else if (row.isLive) {
                                // Priced by Binance seconds ago, not the CSV.
                                Box(Modifier.size(5.dp).background(Ledger.income, CircleShape))
                            }
                        }
                        Text(
                            amountLine(row),
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                    }
                    Text(
                        store.format(store.convert(row.valueUsd, "USD"), compact = true),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (!row.isCash && row.costUsd > 0) {
                        Text(
                            "${if (row.pnlUsd >= 0) "+" else ""}${store.format(store.convert(row.pnlUsd, "USD"), compact = true)}  ${if (row.pnlUsd >= 0) "+" else ""}${"%.1f".format(row.pnlUsd / row.costUsd * 100)}%",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            fontFamily = FontFamily.Monospace,
                            color = if (row.pnlUsd >= 0) Ledger.income else Ledger.expense,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    if (portTotal > 0) {
                        Text(
                            "%.1f%% of port".format(row.valueUsd / portTotal * 100),
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.4f),
                        )
                    }
                }
            }
        }

        if (exchangeBars.isNotEmpty()) {
            item { BreakdownBarsCard(store, "By exchange", exchangeBars) }
        }
    }
}

@Composable
private fun PotBadge(store: VestaStore, label: String, usd: Double, tint: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(7.dp).background(tint, CircleShape))
        Text(label, fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f))
        Text(
            store.format(store.convert(usd, "USD"), compact = true),
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            color = Color.White,
        )
    }
}

/** "0.5182 @ $3,421.55" — sub-$1 tokens keep four decimals so meme-coin
 *  prices don't collapse to $0.00. */
private fun amountLine(row: com.piyawatpm.vesta.data.CryptoDisplayRow): String {
    val amount = "%.6g".format(row.amount)
    if (row.amount <= 0 || row.isCash) return amount
    val price = row.valueUsd / row.amount
    val priceText = if (price < 1) "$%.4f".format(price)
    else "$" + synchronized(priceFormatter) { priceFormatter.format(price) }
    return "$amount @ $priceText"
}

// MARK: - Holding detail + tx form

@Composable
fun HoldingDetailScreen(store: VestaStore, holding: PortfolioHolding, onBack: () -> Unit) {
    var addingTx by remember { mutableStateOf(false) }

    val transactions = store.portfolioTxs
        .filter { it.holdingId == holding.id }
        .sortedByDescending { it.date }
    val position = PortfolioMath.derivePosition(
        store.portfolioTxs.filter { it.holdingId == holding.id }
    )

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = Color.White,
                modifier = Modifier.clickable { onBack() }.padding(8.dp).size(22.dp),
            )
            Text(
                holding.ticker.ifEmpty { holding.name },
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White,
            )
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { addingTx = true }) {
                Text("+ Log", color = Ledger.income, fontWeight = FontWeight.SemiBold)
            }
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
            ) {
                MoneyText(
                    store.convert(holding.currentValue, holding.currency),
                    store.displayCurrency,
                )
                val units = if (position.units > 0) position.units else holding.units
                val cost = if (position.costBasis > 0) position.costBasis else holding.amountInvested
                val unrealized = holding.currentValue - cost
                Row {
                    StatTile("Units", "%.4g".format(units), Modifier.weight(1f))
                    StatTile(
                        "Price / u",
                        if (units > 0) store.format(
                            store.convert(holding.currentValue / units, holding.currency),
                            compact = true,
                        ) else "—",
                        Modifier.weight(1f),
                    )
                    StatTile(
                        "Cost",
                        store.format(store.convert(cost, holding.currency), compact = true),
                        Modifier.weight(1f),
                    )
                }
                SubtleDivider()
                Row {
                    StatTile(
                        "Realized",
                        store.format(store.convert(position.realizedPnl, holding.currency), compact = true),
                        Modifier.weight(1f),
                        if (position.realizedPnl >= 0) Ledger.income else Ledger.expense,
                    )
                    StatTile(
                        "Unrealized",
                        store.format(store.convert(unrealized, holding.currency), compact = true),
                        Modifier.weight(1f),
                        if (unrealized >= 0) Ledger.income else Ledger.expense,
                    )
                }
            }

            // The Hostplus unit-price log — proof the daily auto-reprice is
            // alive, since the balance alone moves too quietly to see.
            val code = HostplusApi.optionCodeByTicker[holding.ticker.uppercase()]
            val history = code?.let { store.hostplusPriceHistory[it] }
            if (!history.isNullOrEmpty()) {
                val days = history.entries.sortedByDescending { it.key }.take(7)
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
                ) {
                    LabelMono("Unit price · Hostplus feed")
                    days.forEachIndexed { index, (date, price) ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                SydneyTime.shortLabel(date),
                                fontSize = 12.sp,
                                color = Color.White,
                            )
                            Spacer(Modifier.weight(1f))
                            if (index + 1 < days.size) {
                                val previous = days[index + 1].value
                                val deltaPct = if (previous > 0) (price - previous) / previous * 100 else 0.0
                                Text(
                                    "${if (deltaPct >= 0) "+" else ""}${"%.2f".format(deltaPct)}%",
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = if (deltaPct >= 0) Ledger.income else Ledger.expense,
                                )
                            }
                            Text(
                                "$%.4f".format(price),
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = FontFamily.Monospace,
                                color = Color.White,
                                modifier = Modifier.width(70.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.End,
                            )
                        }
                    }
                    com.piyawatpm.vesta.ui.components.FinePrint(
                        "auto-updated by the daily server job · Hostplus publishes each day's price the next business day ~6pm Sydney · balance = units × price",
                    )
                }
            }

            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
            ) {
                LabelMono("Transactions")
                if (transactions.isEmpty()) {
                    Text(
                        "No buys or sells logged yet.",
                        fontSize = 13.sp,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
                for (tx in transactions) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (tx.type == "buy") Icons.Filled.ArrowDownward else Icons.Filled.ArrowUpward,
                            contentDescription = null,
                            tint = if (tx.type == "buy") Ledger.income else Ledger.expense,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                "${if (tx.type == "buy") "Buy" else "Sell"} ${"%.4g".format(tx.units)}",
                                fontSize = 14.sp,
                                color = Color.White,
                            )
                            Text(
                                SydneyTime.shortLabel(tx.date),
                                fontSize = 10.sp,
                                color = Color.White.copy(alpha = 0.6f),
                            )
                        }
                        Text(
                            store.format(store.convert(tx.totalAmount, tx.currency)),
                            fontSize = 13.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White,
                        )
                    }
                }
            }
            com.piyawatpm.vesta.ui.components.BottomSpacer()
        }
    }

    if (addingTx) {
        PortfolioTxFormSheet(store, holding) { addingTx = false }
    }
}

@Composable
private fun StatTile(label: String, value: String, modifier: Modifier, tint: Color = Color.White) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
        modifier = modifier,
    ) {
        LabelMono(label)
        Text(
            value,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = tint,
        )
    }
}

/** Log a buy/sell against a holding — same fields as the web dialog. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PortfolioTxFormSheet(store: VestaStore, holding: PortfolioHolding, onDismiss: () -> Unit) {
    var type by remember { mutableStateOf("buy") }
    var units by remember { mutableStateOf("") }
    var total by remember { mutableStateOf("") }
    var dateString by remember { mutableStateOf(SydneyTime.today()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val parsedUnits = units.replace(",", "").toDoubleOrNull()
    val parsedTotal = total.replace(",", "").toDoubleOrNull()

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.background) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    holding.ticker.ifEmpty { holding.name },
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = {
                        val u = parsedUnits ?: return@TextButton
                        val t = parsedTotal ?: return@TextButton
                        if (u <= 0 || t <= 0) return@TextButton
                        saving = true
                        store.scope.launch2 {
                            try {
                                // Currency invariant: every leg is stamped with
                                // the HOLDING's quote currency — the "Paid in"
                                // mislabel bug came from breaking exactly this.
                                store.savePortfolioTx(
                                    PortfolioTransaction(
                                        holdingId = holding.id,
                                        holdingName = holding.name,
                                        type = type,
                                        units = u,
                                        pricePerUnit = t / u,
                                        totalAmount = t,
                                        currency = holding.currency,
                                        date = dateString,
                                    )
                                )
                                onDismiss()
                            } catch (e: Exception) {
                                error = e.message
                            }
                            saving = false
                        }
                    },
                    enabled = parsedUnits != null && parsedTotal != null && !saving,
                ) {
                    Text("Save", color = Ledger.income, fontWeight = FontWeight.Bold)
                }
            }
            SegmentedControl(
                options = listOf("Buy", "Sell"),
                selectedIndex = if (type == "buy") 0 else 1,
                modifier = Modifier.fillMaxWidth(),
            ) { type = if (it == 0) "buy" else "sell" }

            val fieldColors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Ledger.income,
                unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
            )
            androidx.compose.material3.OutlinedTextField(
                value = units,
                onValueChange = { units = it },
                placeholder = { Text("Units", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            androidx.compose.material3.OutlinedTextField(
                value = total,
                onValueChange = { total = it },
                placeholder = { Text("Total ${holding.currency}", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            androidx.compose.material3.OutlinedTextField(
                value = dateString,
                onValueChange = { dateString = it },
                placeholder = { Text("yyyy-MM-dd", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true,
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            if (parsedUnits != null && parsedTotal != null && parsedUnits > 0) {
                Row {
                    Text("Price / unit", fontSize = 13.sp, color = Color.White.copy(alpha = 0.6f))
                    Spacer(Modifier.weight(1f))
                    Text(
                        Money.format(parsedTotal / parsedUnits, holding.currency),
                        fontSize = 13.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White,
                    )
                }
            }
            error?.let { Text(it, fontSize = 13.sp, color = Ledger.expense) }
        }
    }
}
