package com.piyawatpm.vesta.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.gestures.detectTapGestures
import com.piyawatpm.vesta.core.SydneyTime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import com.piyawatpm.vesta.data.PortfolioGroup
import com.piyawatpm.vesta.data.PortfolioHolding
import com.piyawatpm.vesta.data.PortfolioTransaction
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.financeCard
import kotlin.math.atan2
import kotlin.math.min

// The Invest tab's insight layer — the web portfolio/crypto pages' section
// cards in the same visual language the income/expenses insights use.
// Port of ios InvestInsights.swift.

data class AllocationSlice(
    val name: String,
    val value: Double,
    val color: Color,
)

/**
 * The web's three side-by-side donuts don't fit a phone, so one card hosts
 * them behind a segmented switch (Type | Holdings | Country). Tap the ring
 * to read a slice.
 */
@Composable
fun AllocationDonutCard(
    store: VestaStore,
    title: String,
    modes: List<Pair<String, List<AllocationSlice>>>,
    centerNoun: String,
) {
    var mode by remember { mutableStateOf(0) }
    var selectedName by remember { mutableStateOf<String?>(null) }

    val slices = if (modes.isEmpty()) emptyList() else modes[min(mode, modes.size - 1)].second
    val total = slices.sumOf { it.value }
    val selectedSlice = slices.firstOrNull { it.name == selectedName }

    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono(title)

        if (modes.size > 1) {
            SegmentedControl(
                options = modes.map { it.first },
                selectedIndex = mode,
            ) { mode = it; selectedName = null }
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Canvas(
                    modifier = Modifier
                        .size(124.dp)
                        .pointerInput(slices) {
                            detectTapGestures { offset ->
                                val center = Offset(size.width / 2f, size.height / 2f)
                                val dx = offset.x - center.x
                                val dy = offset.y - center.y
                                // Angle from 12 o'clock, clockwise, 0..360.
                                var angle = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())) + 90
                                if (angle < 0) angle += 360
                                var running = 0.0
                                var hit: String? = null
                                for (slice in slices) {
                                    running += if (total > 0) slice.value / total * 360 else 0.0
                                    if (angle <= running) { hit = slice.name; break }
                                }
                                selectedName = if (selectedName == hit) null else hit
                            }
                        },
                ) {
                    if (total <= 0) return@Canvas
                    val strokeWidth = size.minDimension * 0.16f
                    val inset = strokeWidth / 2
                    var startAngle = -90f
                    for (slice in slices) {
                        val sweep = (slice.value / total * 360f).toFloat()
                        val dim = selectedSlice != null && selectedSlice.name != slice.name
                        drawArc(
                            color = slice.color.copy(alpha = if (dim) 0.35f else 1f),
                            startAngle = startAngle,
                            sweepAngle = (sweep - 1.5f).coerceAtLeast(0.5f),
                            useCenter = false,
                            topLeft = Offset(inset, inset),
                            size = Size(size.width - strokeWidth, size.height - strokeWidth),
                            style = Stroke(width = strokeWidth),
                        )
                        startAngle += sweep
                    }
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    if (selectedSlice != null) {
                        Text(
                            selectedSlice.name,
                            fontSize = 10.sp,
                            color = Color.White.copy(alpha = 0.6f),
                            maxLines = 1,
                        )
                        Text(
                            store.format(selectedSlice.value, compact = true),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                    } else {
                        Text(
                            "${slices.size}",
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                        Text(centerNoun, fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f))
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.weight(1f)) {
                for (slice in slices) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(7.dp).background(slice.color, CircleShape))
                        Text(
                            slice.name,
                            fontSize = 12.sp,
                            color = Color.White,
                            maxLines = 1,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            store.format(slice.value, compact = true),
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                        if (total > 0) {
                            Text(
                                "%.0f%%".format(slice.value / total * 100),
                                fontSize = 9.sp,
                                fontFamily = FontFamily.Monospace,
                                color = Color.White.copy(alpha = 0.4f),
                                modifier = Modifier.width(30.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.End,
                            )
                        }
                    }
                }
            }
        }
    }
}

data class BreakdownBar(
    val name: String,
    val count: Int?,
    val value: Double,
)

/** The web's "By Broker" / "By Exchange" section: ranked rows with a share
 *  bar, values in the display currency. */
@Composable
fun BreakdownBarsCard(store: VestaStore, title: String, rows: List<BreakdownBar>) {
    val total = rows.sumOf { it.value }
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono(title)
        rows.forEachIndexed { index, row ->
            val pct = if (total > 0) row.value / total else 0.0
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(7.dp).background(Ledger.chartColor(index), CircleShape))
                    Text(row.name, fontSize = 12.sp, color = Color.White, maxLines = 1)
                    row.count?.let {
                        Text(
                            "$it",
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.4f),
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${store.format(row.value, compact = true)}  ${"%.1f%%".format(pct * 100)}",
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .background(Color.White.copy(alpha = 0.06f), RoundedCornerShape(50)),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(pct.toFloat().coerceIn(0.01f, 1f))
                            .height(5.dp)
                            .background(Ledger.chartColor(index), RoundedCornerShape(50)),
                    )
                }
            }
        }
    }
}

/** The web portfolio page's transaction history, phone-sized: the latest
 *  trades across every holding, newest first. */
@Composable
fun RecentTradesCard(store: VestaStore, txs: List<PortfolioTransaction>) {
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono("Latest trades")
        for (tx in txs) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    if (tx.type == "buy") Icons.Filled.ArrowDownward else Icons.Filled.ArrowUpward,
                    contentDescription = null,
                    tint = if (tx.type == "buy") Ledger.income else Ledger.expense,
                    modifier = Modifier.size(16.dp),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        tx.holdingName,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = Color.White,
                        maxLines = 1,
                    )
                    Text(
                        "${if (tx.type == "buy") "Buy" else "Sell"} ${"%.4g".format(tx.units)} · ${SydneyTime.shortLabel(tx.date)}",
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
                Text(
                    store.format(store.convert(tx.totalAmount, tx.currency), compact = true),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    color = if (tx.type == "buy") Color.White else Ledger.income,
                )
            }
        }
    }
}

// MARK: - Custom groups ("Quantum", "AI", …)

/**
 * User-defined baskets of holdings with their allocation — the answer to
 * "how much of my portfolio is the quantum bet?". Groups are ticker sets
 * synced with the web (`portfolio_groups`); a holding may sit in several.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HoldingGroupsCard(store: VestaStore, holdings: List<PortfolioHolding>) {
    var editing by remember { mutableStateOf<PortfolioGroup?>(null) }
    var creating by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(setOf<String>()) }

    fun value(holding: PortfolioHolding): Double =
        store.convert(store.holdingLiveValue(holding), holding.currency)

    val portfolioTotal = holdings.sumOf { value(it) }
    val groupedTickers = store.portfolioGroups
        .flatMap { it.tickers.map { t -> t.uppercase() } }
        .toSet()

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono("Groups")
            Spacer(Modifier.weight(1f))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
                modifier = Modifier.clickable { creating = true },
            ) {
                Icon(
                    Icons.Filled.Add,
                    contentDescription = null,
                    tint = Ledger.income,
                    modifier = Modifier.size(13.dp),
                )
                Text("New", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Ledger.income)
            }
        }

        if (store.portfolioGroups.isEmpty()) {
            Text(
                "Group holdings into themes — “Quantum”, “AI” — and see what share of the portfolio each bet is.",
                fontSize = 12.sp,
                color = Color.White.copy(alpha = 0.6f),
            )
        }

        for (group in store.portfolioGroups) {
            val set = group.tickers.map { it.uppercase() }.toSet()
            val rows = holdings
                .filter { it.ticker.uppercase() in set }
                .sortedByDescending { value(it) }
            val total = rows.sumOf { value(it) }
            val pct = if (portfolioTotal > 0) total / portfolioTotal else 0.0
            val isOpen = group.id in expanded

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                    modifier = Modifier.combinedClickable(
                        onClick = {
                            expanded = if (isOpen) expanded - group.id else expanded + group.id
                        },
                        onLongClick = { editing = group },
                    ),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(
                            if (isOpen) Icons.Filled.ExpandMore else Icons.Filled.ChevronRight,
                            contentDescription = null,
                            tint = Color.White.copy(alpha = 0.4f),
                            modifier = Modifier.size(12.dp),
                        )
                        Text(group.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                        Text(
                            "${rows.size}",
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.4f),
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            "${store.format(total, compact = true)}  ${"%.1f%%".format(pct * 100)}",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White,
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
                                .fillMaxWidth(pct.toFloat().coerceIn(0.01f, 1f))
                                .height(4.dp)
                                .background(Ledger.income.copy(alpha = 0.85f), RoundedCornerShape(50)),
                        )
                    }
                }

                if (isOpen) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(5.dp),
                        modifier = Modifier.padding(start = 15.dp),
                    ) {
                        for (holding in rows) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(
                                    holding.ticker.ifEmpty { holding.name },
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color.White,
                                )
                                Spacer(Modifier.weight(1f))
                                Text(
                                    store.format(value(holding), compact = true),
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color.White.copy(alpha = 0.6f),
                                )
                                Text(
                                    "%.0f%%".format(if (total > 0) value(holding) / total * 100 else 0.0),
                                    fontSize = 9.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color.White.copy(alpha = 0.4f),
                                    modifier = Modifier.width(32.dp),
                                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                                )
                            }
                        }
                        // Members priced at zero (exited/missing) still listed.
                        val missing = group.tickers.map { it.uppercase() }
                            .filter { t -> rows.none { it.ticker.uppercase() == t } }
                        if (missing.isNotEmpty()) {
                            FinePrint("not held: ${missing.joinToString(", ")}")
                        }
                        Row {
                            Text(
                                "Edit group",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color.White.copy(alpha = 0.6f),
                                modifier = Modifier.clickable { editing = group },
                            )
                            Spacer(Modifier.weight(1f))
                            Text(
                                "Delete",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Ledger.expense.copy(alpha = 0.8f),
                                modifier = Modifier.clickable {
                                    store.scope.launch2 {
                                        store.savePortfolioGroups(
                                            store.portfolioGroups.filter { it.id != group.id }
                                        )
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }

        if (store.portfolioGroups.isNotEmpty()) {
            val ungrouped = holdings.filter { it.ticker.uppercase() !in groupedTickers }
            if (ungrouped.isNotEmpty()) {
                val total = ungrouped.sumOf { value(it) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Ungrouped · ${ungrouped.size}",
                        fontSize = 12.sp,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${store.format(total, compact = true)}  ${"%.1f%%".format(if (portfolioTotal > 0) total / portfolioTotal * 100 else 0.0)}",
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.4f),
                    )
                }
            }
        }
    }

    if (creating) {
        GroupEditorSheet(store, group = null, holdings = holdings) { creating = false }
    }
    editing?.let { group ->
        GroupEditorSheet(store, group = group, holdings = holdings) { editing = null }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupEditorSheet(
    store: VestaStore,
    group: PortfolioGroup?,
    holdings: List<PortfolioHolding>,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(group?.name ?: "") }
    var selected by remember {
        mutableStateOf((group?.tickers ?: emptyList()).map { it.uppercase() }.toSet())
    }

    val sortedHoldings = holdings.sortedByDescending {
        store.convert(store.holdingLiveValue(it), it.currency)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Ledger.card,
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (group == null) "New group" else "Edit group",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = {
                        val trimmed = name.trim()
                        if (trimmed.isEmpty() || selected.isEmpty()) return@TextButton
                        val groups = store.portfolioGroups.toMutableList()
                        val index = group?.let { g -> groups.indexOfFirst { it.id == g.id } } ?: -1
                        if (index >= 0) {
                            groups[index] = groups[index].copy(
                                name = trimmed, tickers = selected.sorted()
                            )
                        } else {
                            groups.add(PortfolioGroup(name = trimmed, tickers = selected.sorted()))
                        }
                        store.scope.launch2 { store.savePortfolioGroups(groups) }
                        onDismiss()
                    },
                    enabled = name.trim().isNotEmpty() && selected.isNotEmpty(),
                ) {
                    Text("Save", color = Ledger.income, fontWeight = FontWeight.SemiBold)
                }
            }

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                placeholder = { Text("Group name (e.g. Quantum)") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Ledger.income,
                    unfocusedBorderColor = Color.White.copy(alpha = 0.15f),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            Text(
                "HOLDINGS · ${selected.size} PICKED",
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                color = Ledger.subtle,
            )

            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(sortedHoldings, key = { it.id }) { holding ->
                    val ticker = holding.ticker.uppercase()
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                selected = if (ticker in selected) selected - ticker
                                else selected + ticker
                            },
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                holding.ticker.ifEmpty { holding.name },
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                                color = Color.White,
                            )
                            Text(
                                holding.name,
                                fontSize = 10.sp,
                                color = Color.White.copy(alpha = 0.6f),
                                maxLines = 1,
                            )
                        }
                        Text(
                            store.format(
                                store.convert(store.holdingLiveValue(holding), holding.currency),
                                compact = true,
                            ),
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                        Spacer(Modifier.width(10.dp))
                        Icon(
                            if (ticker in selected) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
                            contentDescription = null,
                            tint = if (ticker in selected) Ledger.income else Color.White.copy(alpha = 0.4f),
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }
        }
    }
}

/** Small helper so composables can fire suspend store writes. */
fun CoroutineScope.launch2(block: suspend () -> Unit): Job = launch {
    try {
        block()
    } catch (_: Exception) {
    }
}
