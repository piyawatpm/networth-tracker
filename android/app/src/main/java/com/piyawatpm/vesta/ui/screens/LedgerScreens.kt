package com.piyawatpm.vesta.ui.screens

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Numbers
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.SouthEast
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
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.foundation.text.BasicTextField
import com.piyawatpm.vesta.ai.OnDeviceAI
import com.piyawatpm.vesta.ai.stableHash
import com.piyawatpm.vesta.core.FlowMath
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SnapshotDate
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.data.ExpenseEntry
import com.piyawatpm.vesta.data.IncomeEntry
import com.piyawatpm.vesta.data.Settings
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.TabReselect
import com.piyawatpm.vesta.ui.components.FilterChip
import com.piyawatpm.vesta.ui.components.FloatingScopePill
import com.piyawatpm.vesta.ui.components.FxChip
import com.piyawatpm.vesta.ui.components.Insight
import com.piyawatpm.vesta.ui.components.InsightsCard
import com.piyawatpm.vesta.ui.components.MoneyText
import com.piyawatpm.vesta.ui.components.MonthScopeStrip
import com.piyawatpm.vesta.ui.components.MonthTrendCard
import com.piyawatpm.vesta.ui.components.PaceBadge
import com.piyawatpm.vesta.ui.components.StatChip
import com.piyawatpm.vesta.ui.components.WeekdayPatternCard
import com.piyawatpm.vesta.ui.components.launch2
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.financeCard
import kotlinx.coroutines.launch
import kotlin.math.atan2

// The Income and Spend ledger pages — ports of ios IncomeView / ExpensesView.

/** Deterministic on-device blurb card, cached by a stable hash of the facts. */
@Composable
fun AiBlurbCard(facts: String, cacheKey: String) {
    if (facts.isEmpty()) return
    val hash = stableHash(facts)
    val blurb = remember(hash) {
        Settings.blurb(cacheKey)?.takeIf { it.second == hash }?.first
            ?: OnDeviceAI.blurb(facts)?.also { Settings.setBlurb(cacheKey, it, hash) }
    } ?: return

    Column(
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon(
                Icons.Filled.AutoAwesome,
                contentDescription = null,
                tint = Ledger.income,
                modifier = Modifier.size(12.dp),
            )
            LabelMono("At a glance")
        }
        Text(blurb, fontSize = 13.sp, color = Color.White.copy(alpha = 0.85f))
        com.piyawatpm.vesta.ui.components.FinePrint(
            "written on-device from this page's numbers · nothing leaves the phone",
        )
    }
}

/** Search field matching the dark theme. */
@Composable
fun SearchField(value: String, placeholder: String, onChange: (String) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(Ledger.card, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Icon(
            Icons.Filled.Search,
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.4f),
            modifier = Modifier.size(16.dp),
        )
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text(placeholder, fontSize = 14.sp, color = Color.White.copy(alpha = 0.35f))
            }
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp, color = Color.White),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(Ledger.income),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) {
            Text(
                "clear",
                fontSize = 11.sp,
                color = Ledger.income,
                modifier = Modifier.clickable { onChange("") },
            )
        }
    }
}

/** A small tappable donut with a center readout — the income summary ring. */
@Composable
fun InlineDonut(
    store: VestaStore,
    slices: List<Triple<String, Double, Color>>, // (label, value, color)
    centerNoun: String,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    val total = slices.sumOf { it.second }
    Box(contentAlignment = Alignment.Center) {
        Canvas(
            modifier = Modifier
                .size(130.dp)
                .pointerInput(slices) {
                    detectTapGestures { offset ->
                        val center = Offset(size.width / 2f, size.height / 2f)
                        var angle = Math.toDegrees(
                            atan2((offset.y - center.y).toDouble(), (offset.x - center.x).toDouble())
                        ) + 90
                        if (angle < 0) angle += 360
                        var running = 0.0
                        var hit: String? = null
                        for ((label, value, _) in slices) {
                            running += if (total > 0) value / total * 360 else 0.0
                            if (angle <= running) { hit = label; break }
                        }
                        onSelect(if (selected == hit) null else hit)
                    }
                },
        ) {
            if (total <= 0) return@Canvas
            val strokeWidth = size.minDimension * 0.16f
            val inset = strokeWidth / 2
            var startAngle = -90f
            for ((label, value, color) in slices) {
                val sweep = (value / total * 360f).toFloat()
                val dim = selected != null && selected != label
                drawArc(
                    color = color.copy(alpha = if (dim) 0.35f else 1f),
                    startAngle = startAngle,
                    sweepAngle = (sweep - 1.5f).coerceAtLeast(0.5f),
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = Size(size.width - strokeWidth, size.height - strokeWidth),
                    style = Stroke(strokeWidth),
                )
                startAngle += sweep
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            val sel = slices.firstOrNull { it.first == selected }
            if (sel != null) {
                Text(sel.first, fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f), maxLines = 1)
                Text(
                    store.format(sel.second, compact = true),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            } else {
                Text("${slices.size}", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text(centerNoun, fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f))
            }
        }
    }
}

/** Row action sheet (Edit/Delete) — the Compose stand-in for swipe actions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RowActionsSheet(
    title: String,
    canEdit: Boolean,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.card) {
        Column(
            verticalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp),
        ) {
            Text(
                title,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            if (canEdit) {
                TextButton(onClick = { onEdit(); onDismiss() }, modifier = Modifier.fillMaxWidth()) {
                    Text("Edit", color = Color.White, fontSize = 15.sp)
                }
            }
            TextButton(onClick = { onDelete(); onDismiss() }, modifier = Modifier.fillMaxWidth()) {
                Text("Delete", color = Ledger.expense, fontSize = 15.sp)
            }
        }
    }
}

// MARK: - Income

@Composable
fun IncomeScreen(store: VestaStore, reselect: TabReselect) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showAdd by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<IncomeEntry?>(null) }
    var actionsFor by remember { mutableStateOf<IncomeEntry?>(null) }
    var search by rememberSaveable { mutableStateOf("") }
    var monthScope by rememberSaveable { mutableStateOf<String?>(SydneyTime.currentMonthKey()) }
    var categoryFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var donutSelection by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(reselect) {
        if (reselect.tab == 1 && reselect.count > 0) listState.animateScrollToItem(0)
    }

    val month = SydneyTime.currentMonthKey()
    val monthEntries = monthScope?.let { s ->
        store.allIncome.filter { SydneyTime.monthKey(it.date) == s }
    } ?: store.allIncome
    val isCurrentMonth = monthScope == month
    val scopeTitle = when {
        monthScope == null -> "All time"
        isCurrentMonth -> "This month"
        else -> FlowMath.label(monthScope!!)
    }
    val scopedTotal = monthEntries.sumOf { store.convert(it.amount, it.currency) }
    val convertedRows = store.allIncome.map { it.date to store.convert(it.amount, it.currency) }
    val categoryRows = store.allIncome.map {
        Triple(it.date, store.incomeLabel(it.type), store.convert(it.amount, it.currency))
    }

    // Donut slices for this month, positive categories only.
    val slices = monthEntries
        .groupBy { it.type }
        .mapValues { (_, rows) -> rows.sumOf { store.convert(it.amount, it.currency) } }
        .filterValues { it > 0.005 }
        .map { (type, value) -> type to value }
        .sortedByDescending { it.second }

    val listEntries = run {
        val base = if (search.isEmpty()) {
            store.allIncome.filter { monthScope == null || SydneyTime.monthKey(it.date) == monthScope }
        } else {
            store.allIncome // search sweeps everything
        }
        val filtered = categoryFilter?.let { f -> base.filter { it.type == f } } ?: base
        val sorted = filtered.sortedWith(
            compareByDescending<IncomeEntry> { it.date }.thenByDescending { it.createdAt }
        )
        if (search.isEmpty()) sorted
        else sorted.filter {
            FlowMath.matches(
                search,
                listOf(it.description, it.source, store.incomeLabel(it.type)),
                it.date,
            )
        }
    }
    val dayGroups = FlowMath.groupByDay(listEntries, { it.date }, {
        store.convert(it.amount, it.currency)
    })

    // Findings tuned to the actual goal here: replacing wage income.
    val insights = buildList {
        if (store.freedomExpenses > 1) {
            val pct = store.freedomCoverage * 100
            add(
                Insight(
                    Icons.Filled.Shield, "Passive income covers your spending",
                    "${"%.0f".format(pct)}%",
                    if (pct >= 100) Ledger.income else if (pct >= 50) Ledger.seriesDebt else Ledger.expense,
                )
            )
        }
        slices.firstOrNull()?.let { top ->
            if (scopedTotal > 1) {
                val share = top.second / scopedTotal * 100
                add(
                    Insight(
                        Icons.Filled.PieChart,
                        "${store.incomeLabel(top.first)} is your largest source",
                        "${"%.0f".format(share)}%",
                        if (share >= 70) Ledger.seriesCrypto else Color.White,
                    )
                )
            }
        }
        if (monthEntries.isNotEmpty()) {
            add(
                Insight(
                    Icons.Filled.Numbers,
                    "${monthEntries.size} payments · average",
                    store.format(scopedTotal / monthEntries.size, compact = true),
                )
            )
        }
        val complete = FlowMath.flows(convertedRows, 7).dropLast(1).filter { it.total > 0.01 }
        if (complete.size >= 2) {
            add(
                Insight(
                    Icons.Filled.BarChart,
                    "Typical month (last ${complete.size})",
                    store.format(complete.sumOf { it.total } / complete.size, compact = true),
                )
            )
        }
    }

    val aiFacts = if (monthEntries.isEmpty()) "" else buildString {
        appendLine("Income, $scopeTitle: total ${store.format(scopedTotal, compact = true)} across ${monthEntries.size} entries.")
        val sources = slices.take(4)
            .joinToString(", ") { "${store.incomeLabel(it.first)} ${store.format(it.second, compact = true)}" }
        if (sources.isNotEmpty()) appendLine("By source: $sources.")
        for (insight in insights) appendLine("${insight.text}: ${insight.value}.")
    }.trim()

    val flows = FlowMath.flows(convertedRows, 6)
    val (catSlices, catOrder) = FlowMath.categoryFlows(categoryRows, 6)
    val scrolledPastHero = listState.firstVisibleItemIndex > 1

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch { store.refresh(); refreshing = false }
        },
        modifier = Modifier.fillMaxSize().background(Ledger.background),
    ) {
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(8.dp),
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
                    Text("Income", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    Spacer(Modifier.weight(1f))
                    FxChip(store)
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier
                            .size(40.dp)
                            .background(Ledger.income, CircleShape)
                            .clickable { showAdd = true },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Add, contentDescription = "Add", tint = Color.Black)
                    }
                }
            }
            item { SearchField(search, "Search income or a date") { search = it } }

            // Summary header
            item {
                Column(
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        LabelMono(scopeTitle)
                        MoneyText(scopedTotal, store.displayCurrency, tint = Ledger.income)
                        if (isCurrentMonth) {
                            FlowMath.pace(convertedRows)?.let { (current, previous) ->
                                PaceBadge(current, previous, upIsGood = true)
                            }
                        }
                    }
                    if (slices.isNotEmpty()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            InlineDonut(
                                store = store,
                                slices = slices.map {
                                    Triple(store.incomeLabel(it.first), it.second, store.incomeColor(it.first))
                                },
                                centerNoun = "sources",
                                selected = donutSelection,
                                onSelect = { donutSelection = it },
                            )
                            Column(
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.weight(1f),
                            ) {
                                for ((type, value) in slices.take(5)) {
                                    val active = categoryFilter == null || categoryFilter == type
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        modifier = Modifier.clickable {
                                            categoryFilter = if (categoryFilter == type) null else type
                                        },
                                    ) {
                                        Box(
                                            Modifier.size(7.dp).background(store.incomeColor(type), CircleShape)
                                        )
                                        Text(
                                            store.incomeLabel(type),
                                            fontSize = 12.sp,
                                            color = Color.White.copy(alpha = if (active) 1f else 0.4f),
                                            maxLines = 1,
                                            modifier = Modifier.weight(1f),
                                        )
                                        Text(
                                            store.format(value, compact = true),
                                            fontSize = 10.sp,
                                            fontFamily = FontFamily.Monospace,
                                            color = Color.White.copy(alpha = if (active) 0.6f else 0.3f),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Trend earns its card only once there's a month to compare against.
            if (flows.count { it.total > 0.01 } >= 2) {
                item {
                    MonthTrendCard(
                        title = "Income · 6 months",
                        flows = flows,
                        tint = Ledger.income,
                        format = { store.format(it, compact = true) },
                        slices = catSlices,
                        order = catOrder,
                        colorFor = { store.incomeColorForLabel(it) },
                        scope = monthScope,
                        onScope = { monthScope = it },
                    )
                }
            }

            if (insights.isNotEmpty()) {
                item { InsightsCard("Insights", insights) }
            }
            if (aiFacts.isNotEmpty()) {
                item { AiBlurbCard(aiFacts, "income") }
            }

            if (search.isEmpty() && categoryFilter != null) {
                item {
                    FilterChip(
                        store.incomeLabel(categoryFilter!!),
                        store.incomeColor(categoryFilter!!),
                    ) { categoryFilter = null }
                }
            }
            if (search.isEmpty()) {
                item {
                    MonthScopeStrip(
                        months = flows,
                        selection = monthScope,
                        onSelect = { monthScope = it },
                        tint = Ledger.income,
                        format = { store.format(it, compact = true) },
                    )
                }
            }

            for (group in dayGroups) {
                item(key = "h-${group.id}") {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(top = 6.dp, start = 4.dp, end = 4.dp),
                    ) {
                        Text(
                            group.label,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White.copy(alpha = 0.55f),
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            store.format(group.total, compact = true),
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Ledger.income.copy(alpha = 0.8f),
                        )
                    }
                }
                items(group.items.size, key = { "r-${group.items[it].id}" }) { index ->
                    val entry = group.items[index]
                    IncomeRowView(store, entry, showsDate = search.isNotEmpty()) {
                        if (entry.derived != true) actionsFor = entry
                    }
                }
            }

            if (dayGroups.isEmpty()) {
                item {
                    Text(
                        when {
                            search.isNotEmpty() -> "No income matches “$search”."
                            categoryFilter != null ->
                                "No ${store.incomeLabel(categoryFilter!!)} in this month."
                            else -> "Nothing recorded in this month."
                        },
                        fontSize = 13.sp,
                        color = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
        }

        if (scrolledPastHero) {
            Box(
                Modifier.fillMaxWidth().statusBarsPadding().padding(top = 4.dp),
                contentAlignment = Alignment.TopCenter,
            ) {
                FloatingScopePill(
                    title = scopeTitle,
                    total = store.format(scopedTotal, compact = true),
                    tint = Ledger.income,
                    isFiltered = monthScope != null,
                ) { monthScope = null }
            }
        }
    }

    if (showAdd) {
        EntryFormSheet(store, EntryKind.INCOME) { showAdd = false }
    }
    editing?.let { entry ->
        EntryFormSheet(store, EntryKind.INCOME, editingIncome = entry) { editing = null }
    }
    actionsFor?.let { entry ->
        RowActionsSheet(
            title = entry.description.ifEmpty { store.incomeLabel(entry.type) },
            canEdit = true,
            onEdit = { editing = entry },
            onDelete = { store.scope.launch2 { store.deleteIncome(entry.id) } },
            onDismiss = { actionsFor = null },
        )
    }
}

@Composable
private fun IncomeRowView(
    store: VestaStore,
    entry: IncomeEntry,
    showsDate: Boolean,
    onLongPress: () -> Unit,
) {
    val title = entry.description.ifEmpty { store.incomeLabel(entry.type) }
    val subtitle = buildList {
        if (showsDate) add(SydneyTime.shortLabel(entry.date))
        val label = store.incomeLabel(entry.type)
        if (label != title) add(label)
    }.joinToString(" · ").ifEmpty { null }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(Ledger.card, RoundedCornerShape(12.dp))
            .clickable { onLongPress() }
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Box(Modifier.size(8.dp).background(store.incomeColor(entry.type), CircleShape))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, fontSize = 14.sp, color = Color.White, maxLines = 1)
                if (entry.derived == true) {
                    // Rows projected from tx logs — read-only, like the web.
                    Icon(
                        Icons.Filled.Link,
                        contentDescription = null,
                        tint = Color.White.copy(alpha = 0.5f),
                        modifier = Modifier.size(10.dp),
                    )
                }
            }
            subtitle?.let {
                Text(it, fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f), maxLines = 1)
            }
        }
        Text(
            Money.format(entry.amount, entry.currency),
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            color = if (entry.amount >= 0) Ledger.income else Ledger.expense,
        )
    }
}

// MARK: - Expenses

@Composable
fun ExpensesScreen(store: VestaStore, reselect: TabReselect) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showAdd by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ExpenseEntry?>(null) }
    var actionsFor by remember { mutableStateOf<ExpenseEntry?>(null) }
    var search by rememberSaveable { mutableStateOf("") }
    var monthScope by rememberSaveable { mutableStateOf<String?>(SydneyTime.currentMonthKey()) }
    var categoryFilter by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(reselect) {
        if (reselect.tab == 2 && reselect.count > 0) listState.animateScrollToItem(0)
    }

    val month = SydneyTime.currentMonthKey()
    val monthExpenses = monthScope?.let { s ->
        store.expenses.filter { SydneyTime.monthKey(it.date) == s }
    } ?: store.expenses
    val isCurrentMonth = monthScope == month
    val scopeTitle = when {
        monthScope == null -> "All time"
        isCurrentMonth -> "Spent this month"
        else -> "Spent in ${FlowMath.label(monthScope!!)}"
    }
    val scopedTotal = monthExpenses.sumOf { store.convert(it.amount, it.currency) }
    val convertedRows = store.expenses.map { it.date to store.convert(it.amount, it.currency) }
    val categoryRows = store.expenses.map {
        Triple(it.date, store.expenseLabel(it.type), store.convert(it.amount, it.currency))
    }
    val byCategory = monthExpenses
        .groupBy { it.type }
        .mapValues { (_, rows) -> rows.sumOf { store.convert(it.amount, it.currency) } }
        .filterValues { it > 0 }
        .map { (type, value) -> type to value }
        .sortedByDescending { it.second }

    // Where the money actually went this month.
    val topVendors = monthExpenses
        .filter { it.vendor.trim().isNotEmpty() }
        .groupBy { it.vendor.trim().lowercase() }
        .map { (_, rows) ->
            rows.first().vendor.trim() to rows.sumOf { store.convert(it.amount, it.currency) }
        }
        .sortedByDescending { it.second }
        .take(3)

    val listEntries = run {
        val base = if (search.isEmpty()) {
            store.expenses.filter { monthScope == null || SydneyTime.monthKey(it.date) == monthScope }
        } else {
            store.expenses // "where did I buy that" is an all-time question
        }
        val filtered = categoryFilter?.let { f -> base.filter { it.type == f } } ?: base
        val sorted = filtered.sortedWith(
            compareByDescending<ExpenseEntry> { it.date }.thenByDescending { it.createdAt }
        )
        if (search.isEmpty()) sorted
        else sorted.filter {
            FlowMath.matches(
                search,
                listOf(it.description, it.vendor, store.expenseLabel(it.type), it.notes),
                it.date,
            )
        }
    }
    val dayGroups = FlowMath.groupByDay(listEntries, { it.date }, {
        store.convert(it.amount, it.currency)
    })

    val weekdayTotals = DoubleArray(7).also { totals ->
        for (entry in monthExpenses) {
            SnapshotDate.weekdayIndex(entry.date)?.let {
                totals[it] += store.convert(entry.amount, entry.currency)
            }
        }
    }.toList()
    val weekdayOccurrences = run {
        val today = SydneyTime.today()
        val s = monthScope
        if (s == null) {
            val earliest = store.expenses.minOfOrNull { it.date }?.take(10)
            FlowMath.weekdayOccurrences(earliest ?: today, today)
        } else {
            FlowMath.weekdayOccurrences("$s-01", minOf(FlowMath.lastDay(s), today))
        }
    }

    val insights = buildList {
        // Which category moved most against its own 3-month baseline.
        val baseline = FlowMath.monthKeys(4).dropLast(1)
        val priorByType = HashMap<String, Double>()
        for (entry in store.expenses) {
            if (SydneyTime.monthKey(entry.date) in baseline) {
                priorByType[entry.type] = (priorByType[entry.type] ?: 0.0) +
                    store.convert(entry.amount, entry.currency)
            }
        }
        val movers = byCategory.mapNotNull { (type, value) ->
            val average = (priorByType[type] ?: 0.0) / 3
            if (average <= 1) return@mapNotNull null
            store.expenseLabel(type) to (value - average) / average * 100
        }
        movers.maxByOrNull { kotlin.math.abs(it.second) }?.let { top ->
            if (kotlin.math.abs(top.second) >= 10) {
                add(
                    Insight(
                        if (top.second > 0) Icons.Filled.NorthEast else Icons.Filled.SouthEast,
                        "${top.first} vs your 3-month average",
                        "${if (top.second > 0) "+" else ""}${"%.0f".format(top.second)}%",
                        if (top.second > 0) Ledger.expense else Ledger.income,
                    )
                )
            }
        }
        monthExpenses.maxByOrNull { store.convert(it.amount, it.currency) }?.let { biggest ->
            val name = biggest.vendor.ifEmpty {
                biggest.description.ifEmpty { store.expenseLabel(biggest.type) }
            }
            add(
                Insight(
                    Icons.Filled.LocalFireDepartment,
                    "Biggest · $name",
                    store.format(store.convert(biggest.amount, biggest.currency), compact = true),
                    Ledger.expense,
                )
            )
        }
        if (monthExpenses.isNotEmpty()) {
            add(
                Insight(
                    Icons.Filled.Numbers,
                    "${monthExpenses.size} purchases · average",
                    store.format(scopedTotal / monthExpenses.size, compact = true),
                )
            )
        }
        val complete = FlowMath.flows(convertedRows, 7).dropLast(1).filter { it.total > 0.01 }
        if (complete.size >= 2) {
            add(
                Insight(
                    Icons.Filled.BarChart,
                    "Typical month (last ${complete.size})",
                    store.format(complete.sumOf { it.total } / complete.size, compact = true),
                )
            )
        }
    }

    val aiFacts = if (monthExpenses.isEmpty()) "" else buildString {
        appendLine("Spending, $scopeTitle: total ${store.format(scopedTotal, compact = true)} across ${monthExpenses.size} purchases.")
        val categories = byCategory.take(4)
            .joinToString(", ") { "${store.expenseLabel(it.first)} ${store.format(it.second, compact = true)}" }
        if (categories.isNotEmpty()) appendLine("By category: $categories.")
        val vendors = topVendors.joinToString(", ") { "${it.first} ${store.format(it.second, compact = true)}" }
        if (vendors.isNotEmpty()) appendLine("Top vendors: $vendors.")
        for (insight in insights) appendLine("${insight.text}: ${insight.value}.")
        weekdayTotals.withIndex().maxByOrNull { it.value }?.let { peak ->
            if (peak.value > 0) appendLine("Highest-spend weekday: ${FlowMath.weekdayName(peak.index)}.")
        }
    }.trim()

    val flows = FlowMath.flows(convertedRows, 6)
    val (catSlices, catOrder) = FlowMath.categoryFlows(categoryRows, 6)
    val scrolledPastHero = listState.firstVisibleItemIndex > 1

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch { store.refresh(); refreshing = false }
        },
        modifier = Modifier.fillMaxSize().background(Ledger.background),
    ) {
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(8.dp),
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
                    Text("Expenses", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    Spacer(Modifier.weight(1f))
                    FxChip(store)
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier
                            .size(40.dp)
                            .background(Ledger.expense, CircleShape)
                            .clickable { showAdd = true },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Add, contentDescription = "Add", tint = Color.Black)
                    }
                }
            }
            item { SearchField(search, "Search expenses or a date") { search = it } }

            // Summary header: total, pace, burn stats, ranked bars, vendors.
            item {
                val daysGone = FlowMath.dayOfMonth()
                val daysInMonth = FlowMath.daysInCurrentMonth()
                val dailyAverage = scopedTotal / maxOf(1, daysGone)
                Column(
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        LabelMono(scopeTitle)
                        MoneyText(scopedTotal, store.displayCurrency, tint = Ledger.expense)
                        if (isCurrentMonth) {
                            FlowMath.pace(convertedRows)?.let { (current, previous) ->
                                // spending faster is the bad direction
                                PaceBadge(current, previous, upIsGood = false)
                            }
                        }
                    }
                    if (scopedTotal > 0 && isCurrentMonth) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatChip("Per day", store.format(dailyAverage, compact = true))
                            if (daysGone in 3 until daysInMonth) {
                                StatChip(
                                    "Month at this pace",
                                    "≈ " + store.format(dailyAverage * daysInMonth, compact = true),
                                )
                            }
                        }
                    }
                    // Ranked bars beat a donut for spending.
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val maxValue = byCategory.firstOrNull()?.second ?: 1.0
                        for ((type, value) in byCategory.take(6)) {
                            val active = categoryFilter == null || categoryFilter == type
                            Column(
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                                modifier = Modifier.clickable {
                                    categoryFilter = if (categoryFilter == type) null else type
                                },
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Box(Modifier.size(7.dp).background(store.expenseColor(type), CircleShape))
                                    Text(
                                        store.expenseLabel(type),
                                        fontSize = 12.sp,
                                        color = Color.White.copy(alpha = if (active) 1f else 0.4f),
                                    )
                                    Spacer(Modifier.weight(1f))
                                    Text(
                                        "${store.format(value, compact = true)} · ${(value / maxOf(1.0, scopedTotal) * 100).toInt()}%",
                                        fontSize = 10.sp,
                                        fontFamily = FontFamily.Monospace,
                                        color = Color.White.copy(alpha = if (active) 0.6f else 0.3f),
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
                                            .fillMaxWidth((value / maxValue).toFloat().coerceIn(0.02f, 1f))
                                            .height(5.dp)
                                            .background(
                                                store.expenseColor(type)
                                                    .copy(alpha = if (active) 0.85f else 0.35f),
                                                RoundedCornerShape(50),
                                            ),
                                    )
                                }
                            }
                        }
                    }
                    if (topVendors.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            LabelMono("Top vendors")
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                for ((name, total) in topVendors) {
                                    StatChip(name, store.format(total, compact = true), Ledger.expense)
                                }
                            }
                        }
                    }
                }
            }

            if (flows.count { it.total > 0.01 } >= 2) {
                item {
                    MonthTrendCard(
                        title = "Spend · 6 months",
                        flows = flows,
                        tint = Ledger.expense,
                        format = { store.format(it, compact = true) },
                        slices = catSlices,
                        order = catOrder,
                        colorFor = { store.expenseColorForLabel(it) },
                        scope = monthScope,
                        onScope = { monthScope = it },
                    )
                }
            }

            if (insights.isNotEmpty()) {
                item { InsightsCard("Insights", insights) }
            }
            if (aiFacts.isNotEmpty()) {
                item { AiBlurbCard(aiFacts, "expenses") }
            }
            if (weekdayTotals.any { it > 0 }) {
                item {
                    WeekdayPatternCard(
                        totals = weekdayTotals,
                        occurrences = weekdayOccurrences,
                        tint = Ledger.expense,
                        format = { store.format(it, compact = true) },
                    )
                }
            }

            if (search.isEmpty() && categoryFilter != null) {
                item {
                    FilterChip(
                        store.expenseLabel(categoryFilter!!),
                        store.expenseColor(categoryFilter!!),
                    ) { categoryFilter = null }
                }
            }
            if (search.isEmpty()) {
                item {
                    MonthScopeStrip(
                        months = flows,
                        selection = monthScope,
                        onSelect = { monthScope = it },
                        tint = Ledger.expense,
                        format = { store.format(it, compact = true) },
                    )
                }
            }

            for (group in dayGroups) {
                item(key = "eh-${group.id}") {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(top = 6.dp, start = 4.dp, end = 4.dp),
                    ) {
                        Text(
                            group.label,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White.copy(alpha = 0.55f),
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            store.format(group.total, compact = true),
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Ledger.expense.copy(alpha = 0.8f),
                        )
                    }
                }
                items(group.items.size, key = { "er-${group.items[it].id}" }) { index ->
                    val entry = group.items[index]
                    ExpenseRowView(store, entry, showsDate = search.isNotEmpty()) {
                        actionsFor = entry
                    }
                }
            }

            if (dayGroups.isEmpty()) {
                item {
                    Text(
                        when {
                            search.isNotEmpty() -> "No expenses match “$search”."
                            categoryFilter != null ->
                                "No ${store.expenseLabel(categoryFilter!!)} in this month."
                            else -> "Nothing recorded in this month."
                        },
                        fontSize = 13.sp,
                        color = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
        }

        if (scrolledPastHero) {
            Box(
                Modifier.fillMaxWidth().statusBarsPadding().padding(top = 4.dp),
                contentAlignment = Alignment.TopCenter,
            ) {
                FloatingScopePill(
                    title = scopeTitle,
                    total = store.format(scopedTotal, compact = true),
                    tint = Ledger.expense,
                    isFiltered = monthScope != null,
                ) { monthScope = null }
            }
        }
    }

    if (showAdd) {
        EntryFormSheet(store, EntryKind.EXPENSE) { showAdd = false }
    }
    editing?.let { entry ->
        EntryFormSheet(store, EntryKind.EXPENSE, editingExpense = entry) { editing = null }
    }
    actionsFor?.let { entry ->
        RowActionsSheet(
            title = entry.description.ifEmpty { entry.vendor.ifEmpty { store.expenseLabel(entry.type) } },
            canEdit = true,
            onEdit = { editing = entry },
            onDelete = { store.scope.launch2 { store.deleteExpense(entry.id) } },
            onDismiss = { actionsFor = null },
        )
    }
}

@Composable
private fun ExpenseRowView(
    store: VestaStore,
    entry: ExpenseEntry,
    showsDate: Boolean,
    onTap: () -> Unit,
) {
    val title = entry.description.ifEmpty { entry.vendor.ifEmpty { store.expenseLabel(entry.type) } }
    val subtitle = buildList {
        if (showsDate) add(SydneyTime.shortLabel(entry.date))
        val label = store.expenseLabel(entry.type)
        if (label != title) add(label)
        if (entry.vendor.isNotEmpty() && entry.vendor != title) add(entry.vendor)
    }.joinToString(" · ").ifEmpty { null }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(Ledger.card, RoundedCornerShape(12.dp))
            .clickable { onTap() }
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Box(Modifier.size(8.dp).background(store.expenseColor(entry.type), CircleShape))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, fontSize = 14.sp, color = Color.White, maxLines = 1)
                if (entry.source == "ios" || entry.source == "android") {
                    // Landed via quick-add automation.
                    Icon(
                        Icons.Filled.Bolt,
                        contentDescription = null,
                        tint = Ledger.income.copy(alpha = 0.7f),
                        modifier = Modifier.size(10.dp),
                    )
                }
            }
            subtitle?.let {
                Text(it, fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f), maxLines = 1)
            }
        }
        Text(
            Money.format(entry.amount, entry.currency),
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            color = Ledger.expense,
        )
    }
}
