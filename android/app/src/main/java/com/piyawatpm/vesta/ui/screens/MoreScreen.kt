package com.piyawatpm.vesta.ui.screens

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CurrencyBitcoin
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.SouthWest
import androidx.compose.material.icons.filled.SsidChart
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.piyawatpm.vesta.ai.OnDeviceAI
import com.piyawatpm.vesta.core.FlowMath
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.data.CryptoMath
import com.piyawatpm.vesta.data.CryptoSplit
import com.piyawatpm.vesta.data.DcaCompare
import com.piyawatpm.vesta.data.DebtRecord
import com.piyawatpm.vesta.data.DebtTransaction
import com.piyawatpm.vesta.data.QuickExpenseClient
import com.piyawatpm.vesta.data.Settings
import com.piyawatpm.vesta.data.SnapshotPoint
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.TabReselect
import com.piyawatpm.vesta.ui.VestaTabIndex
import com.piyawatpm.vesta.ui.components.FxChip
import com.piyawatpm.vesta.ui.components.MoneyText
import com.piyawatpm.vesta.ui.components.MonthTrendCard
import com.piyawatpm.vesta.ui.components.SegmentedControl
import com.piyawatpm.vesta.ui.components.StatChip
import com.piyawatpm.vesta.ui.components.SubtleDivider
import com.piyawatpm.vesta.ui.components.DebtHistory
import com.piyawatpm.vesta.ui.components.DebtTrendCard
import com.piyawatpm.vesta.ui.components.FinePrint
import com.piyawatpm.vesta.ui.components.launch2
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.LogoCircle
import com.piyawatpm.vesta.ui.theme.financeCard
import java.time.Instant
import kotlin.math.abs

/** Everywhere the More tab can push to. */
sealed class MoreRoute {
    data object Debts : MoreRoute()
    data object Performance : MoreRoute()
    data class DebtDetail(val id: String) : MoreRoute()
    data object BotIncome : MoreRoute()
    data object CoinPnl : MoreRoute()
    data object Ask : MoreRoute()
    data object Forecast : MoreRoute()
    data object Diagnostics : MoreRoute()
    data class Web(val path: String, val title: String) : MoreRoute()
}

@Composable
fun MoreScreen(store: VestaStore, reselect: TabReselect) {
    var stack by remember { mutableStateOf(listOf<MoreRoute>()) }
    var showSettings by remember { mutableStateOf(false) }

    fun push(route: MoreRoute) {
        stack = stack + route
    }

    fun pop() {
        stack = stack.dropLast(1)
    }

    // Tapping More while already on More means "back to the top".
    LaunchedEffect(reselect) {
        if (reselect.tab == VestaTabIndex.MORE && reselect.count > 0 && stack.isNotEmpty()) {
            stack = emptyList()
        }
    }

    if (stack.isNotEmpty()) {
        BackHandler { pop() }
        when (val route = stack.last()) {
            is MoreRoute.Debts -> DebtsScreen(store, onBack = ::pop) { push(MoreRoute.DebtDetail(it)) }
            is MoreRoute.Performance -> PerformanceScreen(store, onBack = ::pop) { push(it) }
            is MoreRoute.DebtDetail -> DebtDetailScreen(store, route.id, onBack = ::pop)
            is MoreRoute.BotIncome -> BotIncomeScreen(store, onBack = ::pop)
            is MoreRoute.CoinPnl -> CoinPnlScreen(store, onBack = ::pop)
            is MoreRoute.Ask -> AskMoneyScreen(store, onBack = ::pop)
            is MoreRoute.Forecast -> ForecastScreen(store, onBack = ::pop)
            is MoreRoute.Diagnostics -> DiagnosticsScreen(store, onBack = ::pop)
            is MoreRoute.Web -> WebScreen(route.path, route.title, onBack = ::pop)
        }
        return
    }

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            Text("More", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Spacer(Modifier.weight(1f))
            FxChip(store)
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 110.dp),
        ) {
            LabelMono("Money")
            MoreLink("Debts", Icons.Filled.Groups) { push(MoreRoute.Debts) }
            MoreLink("Performance", Icons.Filled.SsidChart) { push(MoreRoute.Performance) }
            MoreLink("Ask your money", Icons.Filled.AutoAwesome) { push(MoreRoute.Ask) }
            MoreLink("Forecast & goals", Icons.Filled.Flag) { push(MoreRoute.Forecast) }

            Spacer(Modifier.height(8.dp))
            // The pages not yet rebuilt natively open the deployed web app
            // in-place — full parity beats a missing screen.
            LabelMono("On the web")
            MoreLink("Budget", Icons.Filled.PieChart, external = true) {
                push(MoreRoute.Web("/budget", "Budget"))
            }
            MoreLink("Emergency Fund", Icons.Filled.Shield, external = true) {
                push(MoreRoute.Web("/emergency-fund", "Emergency Fund"))
            }
            MoreLink("Full Performance", Icons.Filled.MonitorHeart, external = true) {
                push(MoreRoute.Web("/performance", "Performance"))
            }
            MoreLink("Settings & Backup", Icons.Filled.Language, external = true) {
                push(MoreRoute.Web("/settings", "Settings"))
            }

            Spacer(Modifier.height(8.dp))
            LabelMono("App")
            MoreLink("Quick add & server", Icons.Filled.Bolt) { showSettings = true }
            MoreLink("Diagnostics", Icons.Filled.MonitorHeart) { push(MoreRoute.Diagnostics) }
            MoreLink("Sign out", Icons.Filled.Logout, tint = Ledger.expense) {
                store.signOut()
            }
        }
    }

    if (showSettings) {
        SettingsSheet(store) { showSettings = false }
    }
}

@Composable
private fun MoreLink(
    title: String,
    icon: ImageVector,
    tint: Color = Color.White,
    external: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(Ledger.card, RoundedCornerShape(12.dp))
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
        Text(title, fontSize = 15.sp, color = tint, modifier = Modifier.weight(1f))
        Icon(
            if (external) Icons.Filled.NorthEast else Icons.Filled.ChevronRight,
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.35f),
            modifier = Modifier.size(13.dp),
        )
    }
}

/** Simple back-titled header shared by pushed screens. */
@Composable
fun PushedHeader(title: String, store: VestaStore?, onBack: () -> Unit, trailing: @Composable () -> Unit = {}) {
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
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        Spacer(Modifier.weight(1f))
        store?.let { FxChip(it) }
        trailing()
    }
}

// MARK: - Debts

/** Signed net from my perspective — sign classification, never the stored
 *  direction, so an overpaid ledger flips sides instead of freezing at zero. */
fun debtNet(debt: DebtRecord, txs: List<DebtTransaction>): Double {
    val paid = txs.filter { it.debtId == debt.id }.sumOf { it.amount }
    val balance = debt.originalAmount - paid
    return if (debt.direction == "owed_to_me") balance else -balance
}

@Composable
fun DebtsScreen(store: VestaStore, onBack: () -> Unit, onOpenDebt: (String) -> Unit) {
    var addingDebt by remember { mutableStateOf(false) }
    var search by rememberSaveable { mutableStateOf("") }

    val rows = store.debts
        .map { it to debtNet(it, store.debtTxs) }
        .sortedByDescending { abs(it.second) }

    val visibleRows = if (search.isEmpty()) rows else rows.filter { (debt, _) ->
        val created = SydneyTime.dayString(Instant.ofEpochMilli(debt.createdAt.toLong()))
        val fields = listOf(debt.person, debt.reason, debt.notes, debt.currency)
        if (FlowMath.matches(search, fields, created)) true
        else store.debtTxs.filter { it.debtId == debt.id }
            .any { FlowMath.matches(search, listOf(it.notes), it.date) }
    }

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        PushedHeader("Debts", store, onBack) {
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier
                    .size(34.dp)
                    .background(Ledger.income, CircleShape)
                    .clickable { addingDebt = true },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Add, contentDescription = "Add", tint = Color.Black, modifier = Modifier.size(18.dp))
            }
        }

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp, end = 16.dp, bottom = 110.dp,
            ),
        ) {
            item { SearchField(search, "Search people or a date") { search = it } }
            item {
                Row(modifier = Modifier.fillMaxWidth().financeCard().padding(vertical = 12.dp)) {
                    DebtTile(
                        store, "They owe me",
                        rows.filter { it.second > 0 }
                            .sumOf { store.convert(it.second, it.first.currency) },
                        Ledger.income, Modifier.weight(1f),
                    )
                    DebtTile(
                        store, "I owe",
                        rows.filter { it.second < 0 }
                            .sumOf { store.convert(-it.second, it.first.currency) },
                        Ledger.expense, Modifier.weight(1f),
                    )
                }
            }

            // Are the balances actually coming down? The tiles are a
            // snapshot; this is the only view that answers the trend.
            val history = DebtHistory.series(store.debts, store.debtTxs, 6)
            if (history.size >= 2) {
                item {
                    DebtTrendCard(
                        points = history,
                        convert = { store.convert(it, "USD") },
                        format = { store.format(it, compact = true) },
                    )
                }
            }

            // Repayment activity per month — the trend shows the balance,
            // this shows the effort behind it.
            val repayments = FlowMath.flows(
                store.debtTxs.mapNotNull { tx ->
                    if (tx.amount <= 0) return@mapNotNull null
                    val debt = store.debts.firstOrNull { it.id == tx.debtId }
                        ?: return@mapNotNull null
                    tx.date to store.convert(tx.amount, debt.currency)
                },
                6,
            )
            if (repayments.count { it.total > 0.01 } >= 2) {
                item {
                    MonthTrendCard(
                        title = "Repayments · 6 months",
                        flows = repayments,
                        tint = Ledger.seriesDebt,
                        format = { store.format(it, compact = true) },
                    )
                }
            }

            items(visibleRows.size, key = { visibleRows[it].first.id }) { index ->
                val (debt, net) = visibleRows[index]
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Ledger.card, RoundedCornerShape(12.dp))
                        .clickable { onOpenDebt(debt.id) }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            debt.person,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color.White,
                        )
                        if (debt.reason.isNotEmpty()) {
                            Text(
                                debt.reason,
                                fontSize = 10.sp,
                                color = Color.White.copy(alpha = 0.6f),
                                maxLines = 1,
                            )
                        }
                    }
                    if (abs(net) < 0.005) {
                        Text(
                            "settled",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                    } else {
                        Text(
                            Money.format(abs(net), debt.currency),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            fontFamily = FontFamily.Monospace,
                            color = if (net > 0) Ledger.income else Ledger.expense,
                        )
                    }
                }
            }
        }
    }

    if (addingDebt) {
        DebtFormSheet(store, editing = null) { addingDebt = false }
    }
}

@Composable
private fun DebtTile(store: VestaStore, label: String, value: Double, tint: Color, modifier: Modifier) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = modifier,
    ) {
        LabelMono(label)
        Text(
            store.format(value, compact = true),
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = tint,
        )
    }
}

@Composable
fun DebtDetailScreen(store: VestaStore, debtId: String, onBack: () -> Unit) {
    val debt = store.debts.firstOrNull { it.id == debtId }
    var txKind by remember { mutableStateOf<String?>(null) } // "repayment" | "borrowedMore"
    var editingDebt by remember { mutableStateOf(false) }

    if (debt == null) {
        Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
            PushedHeader("Debt", null, onBack)
            Text(
                "Debt removed",
                fontSize = 14.sp,
                color = Color.White.copy(alpha = 0.6f),
                modifier = Modifier.padding(16.dp),
            )
        }
        return
    }

    val net = debtNet(debt, store.debtTxs)
    val owedToMe = net > 0
    val repaid = if (debt.direction == "owed_to_me") debt.originalAmount - net
    else debt.originalAmount + net
    val progress = if (debt.originalAmount > 0) (repaid / debt.originalAmount).coerceIn(0.0, 1.0) else 1.0
    val transactions = store.debtTxs
        .filter { it.debtId == debtId }
        .sortedWith(compareByDescending<DebtTransaction> { it.date }.thenByDescending { it.createdAt })

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        PushedHeader(debt.person, null, onBack) {
            TextButton(onClick = { editingDebt = true }) {
                Text("Edit", color = Ledger.income)
            }
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(18.dp),
            ) {
                LabelMono(
                    when {
                        abs(net) < 0.005 -> "Settled"
                        owedToMe -> "${debt.person} owes you"
                        else -> "You owe ${debt.person}"
                    }
                )
                MoneyText(
                    abs(net), debt.currency,
                    tint = when {
                        abs(net) < 0.005 -> Color.White.copy(alpha = 0.6f)
                        owedToMe -> Ledger.income
                        else -> Ledger.expense
                    },
                )
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(50)),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(progress.toFloat().coerceAtLeast(0.02f))
                            .height(6.dp)
                            .background(
                                if (owedToMe) Ledger.income else Ledger.expense,
                                RoundedCornerShape(50),
                            ),
                    )
                }
                Text(
                    "${Money.format(repaid, debt.currency, compact = true)} of ${Money.format(debt.originalAmount, debt.currency, compact = true)} repaid",
                    fontSize = 10.sp,
                    color = Color.White.copy(alpha = 0.6f),
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f)) {
                    com.piyawatpm.vesta.ui.components.VoltButton("Repayment") {
                        txKind = "repayment"
                    }
                }
                Box(
                    Modifier
                        .weight(1f)
                        .background(Color.White.copy(alpha = 0.06f), RoundedCornerShape(50))
                        .clickable { txKind = "borrowedMore" }
                        .padding(vertical = 14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "Borrowed more",
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    )
                }
            }

            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
            ) {
                LabelMono("History")
                if (transactions.isEmpty()) {
                    Text(
                        "No repayments logged yet.",
                        fontSize = 13.sp,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
                for (tx in transactions) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.clickable {
                            store.scope.launch2 { store.deleteDebtTx(tx.id) }
                        },
                    ) {
                        Icon(
                            if (tx.amount >= 0) Icons.Filled.SouthWest else Icons.Filled.NorthEast,
                            contentDescription = null,
                            tint = if (tx.amount >= 0) Ledger.income else Ledger.expense,
                            modifier = Modifier.size(15.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                if (tx.amount >= 0) "Repayment" else "Borrowed more",
                                fontSize = 14.sp,
                                color = Color.White,
                            )
                            Text(
                                "${SydneyTime.shortLabel(tx.date)}${if (tx.notes.isEmpty()) "" else " · ${tx.notes}"}",
                                fontSize = 10.sp,
                                color = Color.White.copy(alpha = 0.6f),
                                maxLines = 1,
                            )
                        }
                        Text(
                            Money.format(abs(tx.amount), debt.currency),
                            fontSize = 13.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White,
                        )
                    }
                }
                if (transactions.isNotEmpty()) {
                    FinePrint("tap a row to delete it")
                }
            }
            com.piyawatpm.vesta.ui.components.BottomSpacer()
        }
    }

    txKind?.let { kind ->
        DebtTxFormSheet(store, debt, kind) { txKind = null }
    }
    if (editingDebt) {
        DebtFormSheet(store, editing = debt) { editingDebt = false }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DebtFormSheet(store: VestaStore, editing: DebtRecord?, onDismiss: () -> Unit) {
    var person by remember { mutableStateOf(editing?.person ?: "") }
    var direction by remember { mutableStateOf(editing?.direction ?: "owed_to_me") }
    var reason by remember { mutableStateOf(editing?.reason ?: "") }
    var amount by remember { mutableStateOf(editing?.originalAmount?.toString() ?: "") }
    var currency by remember { mutableStateOf(editing?.currency ?: "AUD") }
    var notes by remember { mutableStateOf(editing?.notes ?: "") }

    val parsedAmount = amount.replace(",", "").toDoubleOrNull()?.takeIf { it > 0 }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.background) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (editing == null) "New Debt" else "Edit Debt",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = {
                        val value = parsedAmount ?: return@TextButton
                        store.scope.launch2 {
                            store.saveDebt(
                                (editing ?: DebtRecord()).copy(
                                    person = person,
                                    direction = direction,
                                    reason = reason,
                                    originalAmount = value,
                                    currency = currency,
                                    notes = notes,
                                )
                            )
                        }
                        onDismiss()
                    },
                    enabled = person.isNotEmpty() && parsedAmount != null,
                ) {
                    Text("Save", color = Ledger.income, fontWeight = FontWeight.Bold)
                }
            }
            SegmentedControl(
                options = listOf("They owe me", "I owe them"),
                selectedIndex = if (direction == "owed_to_me") 0 else 1,
                modifier = Modifier.fillMaxWidth(),
            ) { direction = if (it == 0) "owed_to_me" else "i_owe" }

            val fieldColors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Ledger.income,
                unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
            )
            OutlinedTextField(
                value = person, onValueChange = { person = it },
                placeholder = { Text("Person", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = amount, onValueChange = { amount = it },
                    placeholder = { Text("Original amount", color = Color.White.copy(alpha = 0.4f)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                    colors = fieldColors,
                    modifier = Modifier.weight(1f),
                )
                SegmentedControl(
                    options = listOf("AUD", "USD", "THB"),
                    selectedIndex = listOf("AUD", "USD", "THB").indexOf(currency).coerceAtLeast(0),
                ) { currency = listOf("AUD", "USD", "THB")[it] }
            }
            OutlinedTextField(
                value = reason, onValueChange = { reason = it },
                placeholder = { Text("Reason", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = notes, onValueChange = { notes = it },
                placeholder = { Text("Notes", color = Color.White.copy(alpha = 0.4f)) },
                colors = fieldColors, modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DebtTxFormSheet(store: VestaStore, debt: DebtRecord, kind: String, onDismiss: () -> Unit) {
    var amount by remember { mutableStateOf("") }
    var dateString by remember { mutableStateOf(SydneyTime.today()) }
    var notes by remember { mutableStateOf("") }

    val parsedAmount = amount.replace(",", "").toDoubleOrNull()?.takeIf { it > 0 }
    val isRepayment = kind == "repayment"

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.background) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (isRepayment) "Record Repayment" else "Borrowed More",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = {
                        val value = parsedAmount ?: return@TextButton
                        store.scope.launch2 {
                            // Positive reduces the loan, negative grows it —
                            // the signed-net convention every surface uses.
                            store.saveDebtTx(
                                DebtTransaction(
                                    debtId = debt.id,
                                    amount = if (isRepayment) value else -value,
                                    date = dateString,
                                    notes = notes,
                                )
                            )
                        }
                        onDismiss()
                    },
                    enabled = parsedAmount != null,
                ) {
                    Text("Save", color = Ledger.income, fontWeight = FontWeight.Bold)
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    Money.symbol(debt.currency),
                    fontSize = 26.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White.copy(alpha = 0.6f),
                )
                OutlinedTextField(
                    value = amount, onValueChange = { amount = it },
                    placeholder = { Text("0.00", fontSize = 26.sp, color = Color.White.copy(alpha = 0.3f)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                    textStyle = androidx.compose.ui.text.TextStyle(
                        fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = Color.White,
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Color.Transparent,
                        unfocusedBorderColor = Color.Transparent,
                    ),
                    modifier = Modifier.weight(1f),
                )
            }
            val fieldColors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Ledger.income,
                unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
            )
            OutlinedTextField(
                value = dateString, onValueChange = { dateString = it },
                placeholder = { Text("yyyy-MM-dd", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = notes, onValueChange = { notes = it },
                placeholder = { Text("Notes", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

// MARK: - Performance (lite)

@Composable
fun PerformanceScreen(store: VestaStore, onBack: () -> Unit, onPush: (MoreRoute) -> Unit) {
    var kind by rememberSaveable { mutableStateOf("networth") }
    /** Super stays OUT by default: Hostplus contributions are only partially
     *  logged, so with super in, unlogged deposits read as growth. */
    var includeSuper by rememberSaveable { mutableStateOf(false) }
    var series by remember { mutableStateOf<List<SnapshotPoint>>(emptyList()) }

    LaunchedEffect(kind) {
        series = try {
            store.api.fetchSnapshots(kind)
        } catch (_: Exception) {
            emptyList()
        }
    }

    val stockValues = DcaCompare.dailyValues(store.portfolioParsed)
    val stockValuesWithSuper = DcaCompare.dailyValues(store.portfolioParsedWithSuper)
    val cryptoPot = DcaCompare.cryptoPotValues(
        DcaCompare.dailyValues(store.cryptoParsed),
        store.cryptoTxs,
    ) { CryptoMath.isCashLike(it, store.stablecoinTags) }
    val cryptoFlows = DcaCompare.cryptoFlowsByDay(store.cryptoTxs) {
        CryptoMath.isCashLike(it, store.stablecoinTags)
    }

    fun stockFlows(withSuper: Boolean): List<DcaCompare.DatedValue> {
        val superIds = store.holdings.filter { it.accountType == "super" }.map { it.id }.toSet()
        val knownIds = store.holdings.map { it.id }.toSet()
        return DcaCompare.flowsByDay(
            store.portfolioTxs.filter {
                it.holdingId in knownIds && (withSuper || it.holdingId !in superIds)
            }
        )
    }

    fun stocksStart(withSuper: Boolean): String? = DcaCompare.clampedStart(
        values = if (withSuper) stockValuesWithSuper else stockValues,
        flows = stockFlows(withSuper),
    )

    val cryptoStart = DcaCompare.clampedStart(cryptoPot, cryptoFlows)

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        PushedHeader("Performance", store, onBack)
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        ) {
            SegmentedControl(
                options = listOf("Net Worth", "Stocks", "Crypto"),
                selectedIndex = listOf("networth", "portfolio", "crypto").indexOf(kind).coerceAtLeast(0),
                modifier = Modifier.fillMaxWidth(),
            ) { kind = listOf("networth", "portfolio", "crypto")[it] }

            when (kind) {
                "networth" -> {
                    val stockStart = stocksStart(includeSuper)
                    if (stockStart != null && cryptoStart != null) {
                        PerfCompareCard(
                            store = store,
                            allStart = maxOf(stockStart, cryptoStart),
                            benchmarks = listOf(Benchmark.sp500, Benchmark.btc),
                            values = DcaCompare.combinedDaily(
                                if (includeSuper) stockValuesWithSuper else stockValues,
                                cryptoPot,
                            ),
                            flows = DcaCompare.mergedFlows(stockFlows(includeSuper), cryptoFlows),
                            footnote = if (includeSuper) {
                                "super marks lag deposits by days — short wiggles self-correct"
                            } else null,
                            maskSettling = true,
                        )
                        SuperToggleCard(includeSuper) { includeSuper = it }
                    }
                }
                "portfolio" -> {
                    stocksStart(includeSuper)?.let { stockStart ->
                        PerfCompareCard(
                            store = store,
                            allStart = stockStart,
                            benchmarks = listOf(Benchmark.sp500),
                            values = if (includeSuper) stockValuesWithSuper else stockValues,
                            flows = stockFlows(includeSuper),
                            footnote = if (includeSuper) {
                                "super marks lag deposits by days — short wiggles self-correct"
                            } else null,
                            maskSettling = true,
                        )
                        SuperToggleCard(includeSuper) { includeSuper = it }
                    }
                }
                "crypto" -> {
                    cryptoStart?.let { start ->
                        PerfCompareCard(
                            store = store,
                            allStart = start,
                            benchmarks = listOf(Benchmark.btc),
                            values = cryptoPot,
                            flows = cryptoFlows,
                        )
                    }
                    // The three stories one number was hiding.
                    CryptoSplitCard(store, onPush)
                }
            }

            ValueAreaCard(store, series)

            Text(
                "TWR, benchmark and DCA comparisons live on the full web page — More → Full Performance.",
                fontSize = 10.sp,
                color = Color.White.copy(alpha = 0.6f),
            )
            com.piyawatpm.vesta.ui.components.BottomSpacer()
        }
    }
}

@Composable
private fun SuperToggleCard(includeSuper: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().financeCard().padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Text("Include super", fontSize = 14.sp, color = Color.White)
        Spacer(Modifier.weight(1f))
        Switch(
            checked = includeSuper,
            onCheckedChange = onToggle,
            colors = SwitchDefaults.colors(
                checkedTrackColor = Ledger.income,
                checkedThumbColor = Color.Black,
            ),
        )
    }
}

@Composable
private fun ValueAreaCard(store: VestaStore, series: List<SnapshotPoint>) {
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono("Value")
        if (series.size < 2) {
            Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = Ledger.subtle,
                )
            }
        } else {
            androidx.compose.foundation.Canvas(Modifier.fillMaxWidth().height(200.dp)) {
                val values = series.map { store.convert(it.value, "USD") }
                val lo = values.min()
                val hi = values.max()
                val span = maxOf(hi - lo, 0.0001)

                fun x(index: Int): Float = index.toFloat() / (series.size - 1) * size.width
                fun y(value: Double): Float =
                    (size.height - (value - lo + span * 0.05) / (span * 1.1) * size.height).toFloat()

                val line = androidx.compose.ui.graphics.Path()
                val area = androidx.compose.ui.graphics.Path()
                values.forEachIndexed { index, value ->
                    val px = x(index)
                    val py = y(value)
                    if (index == 0) {
                        line.moveTo(px, py)
                        area.moveTo(px, size.height)
                        area.lineTo(px, py)
                    } else {
                        line.lineTo(px, py)
                        area.lineTo(px, py)
                    }
                }
                area.lineTo(size.width, size.height)
                area.close()
                drawPath(
                    area,
                    brush = androidx.compose.ui.graphics.Brush.verticalGradient(
                        listOf(Ledger.chartColor(0).copy(alpha = 0.3f), Color.Transparent),
                    ),
                )
                drawPath(
                    line,
                    color = Ledger.chartColor(0),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()),
                )
            }
        }
    }
}

// MARK: - Crypto split card + earn/coin screens

/** The split, as a card on the Performance page's crypto tab. */
@Composable
fun CryptoSplitCard(store: VestaStore, onPush: (MoreRoute) -> Unit) {
    val split = CryptoSplit.compute(
        txs = store.cryptoTxs,
        tags = store.stablecoinTags,
        livePrice = { store.livePrices[it] },
        exclusions = store.earnExclusions,
    )

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono("Where crypto P&L comes from")
        SplitRow(store, "Earn & bot income", "pre-Aug-5 transfer-ins + rows marked E / Earn", split.netYieldUsd, emphasize = true)
        SplitRow(store, "Trading · realized", "locked in by sells", split.realizedUsd)
        SplitRow(store, "Trading · unrealized", "bags vs cost incl. arrival value", split.unrealizedUsd)
        SubtleDivider()
        SplitRow(store, "Net", "the whole journey", split.netUsd, emphasize = true)

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.clickable { onPush(MoreRoute.CoinPnl) },
        ) {
            Icon(
                Icons.Filled.CurrencyBitcoin,
                contentDescription = null,
                tint = Ledger.income,
                modifier = Modifier.size(13.dp),
            )
            Text("Trading by coin", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Ledger.income)
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.4f),
                modifier = Modifier.size(11.dp),
            )
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.clickable { onPush(MoreRoute.BotIncome) },
        ) {
            Icon(
                Icons.Filled.Bolt,
                contentDescription = null,
                tint = Ledger.income,
                modifier = Modifier.size(13.dp),
            )
            Text(
                "Earn income · by token & ledger",
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ledger.income,
            )
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.4f),
                modifier = Modifier.size(11.dp),
            )
        }

        if (split.unpriced.isNotEmpty()) {
            FinePrint("no price for ${split.unpriced.joinToString(", ")} — excluded from unrealized")
        }
        FinePrint(
            "before 5 Aug 2026 every transfer-in counts as earn (the old CMC habit) — venue moves that bounce back out are auto-excluded, and an x note vetoes a row that was really your own deposit · from 5 Aug only rows marked E / Earn count · marked outs subtract",
        )
    }
}

@Composable
private fun SplitRow(store: VestaStore, title: String, caption: String, usd: Double, emphasize: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(verticalArrangement = Arrangement.spacedBy(1.dp), modifier = Modifier.weight(1f)) {
            Text(
                title,
                fontSize = if (emphasize) 13.sp else 12.sp,
                fontWeight = if (emphasize) FontWeight.Bold else FontWeight.Medium,
                color = Color.White,
            )
            FinePrint(caption)
        }
        Text(
            "${if (usd >= 0) "+" else ""}${store.format(store.convert(usd, "USD"), compact = true)}",
            fontSize = if (emphasize) 14.sp else 12.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = if (usd >= 0) Ledger.income else Ledger.expense,
        )
    }
}

/** Earn income: what the bots and Earn actually PAID you. Tap a row =
 *  "this wasn't earn" — the manual veto, synced via earn_exclusions. */
@Composable
fun BotIncomeScreen(store: VestaStore, onBack: () -> Unit) {
    var removalCandidate by remember { mutableStateOf<CryptoSplit.YieldEvent?>(null) }

    val events = CryptoSplit.yieldEvents(store.cryptoTxs, store.stablecoinTags, store.earnExclusions)
    val removedEvents = if (store.earnExclusions.isEmpty()) emptyList() else {
        CryptoSplit.yieldEvents(store.cryptoTxs, store.stablecoinTags)
            .filter { it.key in store.earnExclusions }
    }
    val byToken = events
        .groupBy { it.token }
        .map { (token, rows) ->
            Triple(token, rows.sumOf { it.usd }, rows.count { it.usd > 0 })
        }
        .filter { abs(it.second) > 0.5 }
        .sortedByDescending { it.second }
    val months = events
        .groupBy { it.date.take(7) }
        .entries.sortedByDescending { it.key }

    val total = events.sumOf { it.usd }
    val gross = events.filter { it.usd > 0 }.sumOf { it.usd }

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        PushedHeader("Earn income", store, onBack)
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp, end = 16.dp, bottom = 110.dp,
            ),
        ) {
            item {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
                ) {
                    LabelMono("Bots + Earn · everything they paid you")
                    MoneyText(
                        store.convert(total, "USD"),
                        store.displayCurrency,
                        tint = if (total >= 0) Ledger.income else Ledger.expense,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatChip(
                            "Arrived",
                            "+" + store.format(store.convert(gross, "USD"), compact = true),
                            Ledger.income,
                        )
                        StatChip(
                            "Moved out",
                            "−" + store.format(store.convert(gross - total, "USD"), compact = true),
                        )
                        StatChip("Payments", "${events.count { it.usd > 0 }}")
                    }
                }
            }

            if (events.isEmpty()) {
                item {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
                    ) {
                        Text("No earn yet", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                        Text(
                            "Transfer-ins recorded before 5 Aug 2026 count automatically (that was the CMC habit). From then on, put E (or Earn) in a transfer's note — bot payouts, Earn interest, rewards — and it appears here.",
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                    }
                }
            } else {
                item {
                    FinePrint(
                        "pre-5 Aug 2026: transfer-ins count as earn (venue moves excluded, note x on a row to veto it) · after: only rows marked E / Earn",
                        size = 9.sp,
                    )
                }
            }

            item { LabelMono("By token") }
            items(byToken.size) { index ->
                val (token, net, count) = byToken[index]
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                ) {
                    LogoCircle(url = store.coinImageURL(token), fallback = token, size = 26.dp)
                    Column(Modifier.weight(1f)) {
                        Text(token, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                        Text(
                            "$count payout${if (count == 1) "" else "s"}",
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                    }
                    Text(
                        "${if (net >= 0) "+" else ""}${store.format(store.convert(net, "USD"), compact = true)}",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace,
                        color = if (net >= 0) Ledger.income else Ledger.expense,
                    )
                }
            }

            for ((monthKey, items) in months) {
                item(key = "m-$monthKey") {
                    Row(modifier = Modifier.padding(top = 8.dp)) {
                        Text(
                            "${com.piyawatpm.vesta.core.fullMonthName(monthKey.takeLast(2).toIntOrNull() ?: 1)} ${monthKey.take(4)}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White.copy(alpha = 0.55f),
                        )
                        Spacer(Modifier.weight(1f))
                        val net = items.sumOf { it.usd }
                        Text(
                            "${if (net >= 0) "+" else ""}${store.format(store.convert(net, "USD"), compact = true)}",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = (if (net >= 0) Ledger.income else Ledger.expense).copy(alpha = 0.85f),
                        )
                    }
                }
                items(items.size, key = { "e-${items[it].id}" }) { index ->
                    val event = items[index]
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Ledger.card, RoundedCornerShape(10.dp))
                            .clickable { removalCandidate = event }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        Icon(
                            if (event.usd >= 0) Icons.Filled.SouthWest else Icons.Filled.NorthEast,
                            contentDescription = null,
                            tint = if (event.usd >= 0) Ledger.income else Ledger.subtle,
                            modifier = Modifier.size(14.dp),
                        )
                        Column(Modifier.weight(1f)) {
                            Text(
                                if (event.usd >= 0) "Bot payout · ${event.token}" else "Moved out · ${event.token}",
                                fontSize = 14.sp,
                                color = Color.White,
                            )
                            if (event.notes.isNotEmpty()) {
                                Text(
                                    event.notes,
                                    fontSize = 10.sp,
                                    color = Color.White.copy(alpha = 0.6f),
                                    maxLines = 1,
                                )
                            }
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(
                                "${if (event.usd >= 0) "+" else ""}${store.format(store.convert(event.usd, "USD"), compact = true)}",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                fontFamily = FontFamily.Monospace,
                                color = if (event.usd >= 0) Ledger.income else Ledger.expense,
                            )
                            Text(
                                SydneyTime.shortLabel(event.date),
                                fontSize = 10.sp,
                                color = Color.White.copy(alpha = 0.4f),
                            )
                        }
                    }
                }
            }

            if (removedEvents.isNotEmpty()) {
                item {
                    LabelMono("Removed by you · not earn")
                }
                items(removedEvents.size, key = { "rm-${removedEvents[it].id}" }) { index ->
                    val event = removedEvents[index]
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                store.scope.launch2 { store.setEarnExcluded(event.key, false) }
                            }
                            .padding(vertical = 4.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                "${event.token} · ${SydneyTime.shortLabel(event.date)}",
                                fontSize = 14.sp,
                                color = Color.White.copy(alpha = 0.6f),
                            )
                            Text(
                                "tap to count it as earn again",
                                fontSize = 10.sp,
                                color = Color.White.copy(alpha = 0.4f),
                            )
                        }
                        Text(
                            store.format(store.convert(abs(event.usd), "USD"), compact = true),
                            fontSize = 13.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.4f),
                            textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough,
                        )
                    }
                }
            }
        }
    }

    removalCandidate?.let { event ->
        RowActionsSheet(
            title = "${event.token} · ${store.format(store.convert(abs(event.usd), "USD"), compact = true)} on ${SydneyTime.shortLabel(event.date)} — removed rows stop counting everywhere and can be restored below the ledger.",
            canEdit = false,
            onEdit = {},
            onDelete = { store.scope.launch2 { store.setEarnExcluded(event.key, true) } },
            onDismiss = { removalCandidate = null },
        )
    }
}

/** Every coin's verdict: what it realized, what its bag is doing, the net. */
@Composable
fun CoinPnlScreen(store: VestaStore, onBack: () -> Unit) {
    val rows = CryptoSplit.perCoin(
        store.cryptoTxs, store.stablecoinTags,
        { store.livePrices[it] }, store.earnExclusions,
    )
    val winners = rows.filter { it.netUsd >= 0 }
    val losers = rows.filter { it.netUsd < 0 }
    val total = rows.sumOf { it.netUsd }

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        PushedHeader("Trading by coin", store, onBack)
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp, end = 16.dp, bottom = 110.dp,
            ),
        ) {
            item {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
                ) {
                    LabelMono("Trading net · buys & sells only")
                    MoneyText(
                        store.convert(total, "USD"),
                        store.displayCurrency,
                        tint = if (total >= 0) Ledger.income else Ledger.expense,
                    )
                    FinePrint("realized + unrealized · transfers carry arrival-price basis · earn (pre-Aug-5 ins + marked E) lives on its own page")
                }
            }
            item { LabelMono("Made money · ${winners.size}") }
            items(winners.size, key = { "w-${winners[it].token}" }) { CoinRow(store, winners[it]) }
            item { LabelMono("Lost money · ${losers.size}") }
            items(losers.size, key = { "l-${losers[it].token}" }) { CoinRow(store, losers[it]) }
        }
    }
}

@Composable
private fun CoinRow(store: VestaStore, coin: CryptoSplit.CoinPnl) {
    fun signed(usd: Double): String =
        "${if (usd >= 0) "+" else ""}${store.format(store.convert(usd, "USD"), compact = true)}"

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
    ) {
        LogoCircle(url = store.coinImageURL(coin.token), fallback = coin.token, size = 26.dp)
        Column(verticalArrangement = Arrangement.spacedBy(1.dp), modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(coin.token, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                if (coin.heldAmount <= 1e-9) {
                    Text(
                        "exited",
                        fontSize = 8.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier
                            .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(50))
                            .padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                }
                if (!coin.priced) {
                    Text(
                        "no price",
                        fontSize = 8.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Ledger.seriesCrypto,
                    )
                }
            }
            Text(
                "sold ${signed(coin.realizedUsd)} · bag ${signed(coin.unrealizedUsd)}",
                fontSize = 9.sp,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.6f),
            )
        }
        Text(
            signed(coin.netUsd),
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = if (coin.netUsd >= 0) Ledger.income else Ledger.expense,
        )
    }
}

// MARK: - Ask your money

/** The precomputed fact sheet the narrator reads from — port of the iOS
 *  DataStore.moneyFacts(): every number is precomputed; the answerer only
 *  ever repeats them. */
fun moneyFacts(store: VestaStore): String = buildString {
    val currency = store.displayCurrency
    appendLine("Today is ${SydneyTime.today()}. Display currency: $currency.")
    appendLine("Net worth: ${store.format(store.netWorth)}.")
    for (other in listOf("AUD", "USD", "THB").filter { it != currency }) {
        appendLine(
            "Net worth in $other: ${Money.format(Money.convert(Money.convert(store.netWorth, currency, "USD"), "USD", other), other)}."
        )
    }
    appendLine("Stocks & funds: ${store.format(store.stocksValueVisible)}. Crypto: ${store.format(store.cryptoValue)}. Debts net: ${store.format(store.debtNet)}. Dry powder cash: ${store.format(store.dryPowder)}.")

    // Per-person net debt across all their ledgers — pre-computed because
    // the narrator must never subtract.
    val byPerson = store.debts.groupBy { it.person }
    for ((person, ledgers) in byPerson) {
        val netAud = ledgers.sumOf {
            Money.convert(debtNet(it, store.debtTxs), it.currency, "AUD")
        }
        if (abs(netAud) < 0.5) {
            appendLine("$person: settled overall.")
        } else {
            val direction = if (netAud > 0) "owes you" else "you owe"
            val thb = Money.convert(abs(netAud), "AUD", "THB")
            val usd = Money.convert(abs(netAud), "AUD", "USD")
            appendLine(
                "$person $direction ${Money.format(abs(netAud), "AUD")} (${Money.format(thb, "THB")}, ${Money.format(usd, "USD")}) net across ${ledgers.size} ledger${if (ledgers.size == 1) "" else "s"}."
            )
        }
    }

    // Six months of income/spend.
    for (key in FlowMath.monthKeys(6)) {
        val income = store.monthTotal(store.allIncome, key)
        val spend = store.monthTotalExpenses(key)
        if (income > 0 || spend > 0) {
            appendLine(
                "${FlowMath.label(key)}: income ${store.format(income, compact = true)}, expenses ${store.format(spend, compact = true)}, saved ${store.format(income - spend, compact = true)}."
            )
        }
    }

    // This month by category + top vendors + income by source.
    val month = SydneyTime.currentMonthKey()
    val monthExpenses = store.expenses.filter { SydneyTime.monthKey(it.date) == month }
    val byCategory = monthExpenses.groupBy { it.type }
        .mapValues { (_, rows) -> rows.sumOf { store.convert(it.amount, it.currency) } }
        .entries.sortedByDescending { it.value }.take(5)
    if (byCategory.isNotEmpty()) {
        appendLine(
            "This month's spending by category: " + byCategory.joinToString(", ") {
                "${store.expenseLabel(it.key)} ${store.format(it.value, compact = true)}"
            } + "."
        )
    }
    val vendors = monthExpenses.filter { it.vendor.isNotBlank() }
        .groupBy { it.vendor.trim().lowercase() }
        .map { (_, rows) -> rows.first().vendor.trim() to rows.sumOf { store.convert(it.amount, it.currency) } }
        .sortedByDescending { it.second }.take(3)
    if (vendors.isNotEmpty()) {
        appendLine(
            "Top vendors this month: " + vendors.joinToString(", ") {
                "${it.first} ${store.format(it.second, compact = true)}"
            } + "."
        )
    }
    val sources = store.allIncome.filter { SydneyTime.monthKey(it.date) == month }
        .groupBy { it.type }
        .mapValues { (_, rows) -> rows.sumOf { store.convert(it.amount, it.currency) } }
        .entries.sortedByDescending { it.value }.take(5)
    if (sources.isNotEmpty()) {
        appendLine(
            "This month's income by source: " + sources.joinToString(", ") {
                "${store.incomeLabel(it.key)} ${store.format(it.value, compact = true)}"
            } + "."
        )
    }

    // Crypto stories.
    if (store.cryptoTxs.isNotEmpty()) {
        val (realizedTotal, byToken) = CryptoMath.computeRealizedPnl(store.cryptoTxs)
        appendLine("Crypto all-time realized P&L: ${store.format(store.convert(realizedTotal, "USD"), compact = true)}.")
        byToken.firstOrNull()?.let {
            appendLine("Best coin by realized P&L: ${it.token} ${store.format(store.convert(it.realizedPnlUsd, "USD"), compact = true)}.")
        }
        val yieldTotal = CryptoSplit.yieldEvents(store.cryptoTxs, store.stablecoinTags, store.earnExclusions)
            .sumOf { it.usd }
        appendLine("Net crypto earn income: ${store.format(store.convert(yieldTotal, "USD"), compact = true)}.")
    }
}.trim()

@Composable
fun AskMoneyScreen(store: VestaStore, onBack: () -> Unit) {
    var question by rememberSaveable { mutableStateOf("") }
    var answer by remember { mutableStateOf<String?>(null) }

    val suggestions = listOf(
        "What's my net worth in THB?",
        "How much did I save last month?",
        "Who owes me money?",
        "Top spending category this month?",
    )

    fun submit() {
        if (question.isBlank()) return
        answer = OnDeviceAI.ask(question, moneyFacts(store))
    }

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        PushedHeader("Ask your money", store, onBack)
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.weight(1f)) {
                    OutlinedTextField(
                        value = question,
                        onValueChange = { question = it },
                        placeholder = {
                            Text("Ask about your numbers…", color = Color.White.copy(alpha = 0.4f))
                        },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Ledger.income,
                            unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Box(
                    Modifier
                        .size(44.dp)
                        .background(Ledger.income, CircleShape)
                        .clickable { submit() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Ask",
                        tint = Color.Black,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            ) {
                for (suggestion in suggestions) {
                    Text(
                        suggestion,
                        fontSize = 11.sp,
                        color = Color.White,
                        modifier = Modifier
                            .background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(50))
                            .clickable {
                                question = suggestion
                                submit()
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }

            answer?.let {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
                ) {
                    Text(it, fontSize = 14.sp, color = Color.White.copy(alpha = 0.9f))
                }
            }

            FinePrint(
                "answered on-device from a precomputed fact sheet — every amount is pre-converted, nothing is computed on the fly, nothing leaves the phone",
                size = 9.sp,
            )
        }
    }
}

// MARK: - Settings / diagnostics / web

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(store: VestaStore, onDismiss: () -> Unit) {
    var baseURL by remember { mutableStateOf(Settings.baseURL) }
    var token by remember { mutableStateOf(Settings.token ?: "") }
    var testResult by remember { mutableStateOf<String?>(null) }
    var testing by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.background) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp),
        ) {
            Text(
                "Quick add & server",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White,
            )
            val fieldColors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Ledger.income,
                unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
            )
            OutlinedTextField(
                value = baseURL,
                onValueChange = { baseURL = it; Settings.baseURL = it },
                label = { Text("Server URL", color = Color.White.copy(alpha = 0.5f)) },
                singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it; Settings.token = it },
                label = { Text("QUICK_ADD_TOKEN", color = Color.White.copy(alpha = 0.5f)) },
                singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth(),
            )
            com.piyawatpm.vesta.ui.components.VoltButton(
                if (testing) "Testing…" else "Test connection",
                enabled = !testing,
            ) {
                testing = true
                testResult = null
                store.scope.launch2 {
                    testResult = when (val result = QuickExpenseClient.testConnection()) {
                        is QuickExpenseClient.TestResult.Ok -> "✓ ${result.detail}"
                        is QuickExpenseClient.TestResult.Failed -> "✕ ${result.reason}"
                    }
                    testing = false
                }
            }
            testResult?.let {
                Text(
                    it,
                    fontSize = 13.sp,
                    color = if (it.startsWith("✓")) Ledger.income else Ledger.expense,
                )
            }
            FinePrint(
                "quick-adds write straight to Supabase with the owner session; the token only matters for the legacy /api/quick-expense probe",
                size = 9.sp,
            )
        }
    }
}

@Composable
fun DiagnosticsScreen(store: VestaStore, onBack: () -> Unit) {
    var probe by remember { mutableStateOf<String?>(null) }
    var probing by remember { mutableStateOf(false) }
    var queueCount by remember { mutableStateOf(-1) }
    val queue = remember { com.piyawatpm.vesta.VestaApp.instance.pendingQueue }

    LaunchedEffect(Unit) { queueCount = queue.count() }

    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        PushedHeader("Diagnostics", store, onBack)
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
            ) {
                LabelMono("Connection")
                com.piyawatpm.vesta.ui.components.VoltButton(
                    if (probing) "Testing…" else "Test the connection",
                    enabled = !probing,
                ) {
                    probing = true
                    probe = null
                    store.scope.launch2 {
                        val startedAt = System.currentTimeMillis()
                        probe = try {
                            kotlinx.coroutines.withTimeout(10_000) {
                                store.api.ensureSession()
                                store.api.fetchAppDataValue("expense_entries")
                            }
                            val ms = System.currentTimeMillis() - startedAt
                            "✓ Signed in and read the ledger in ${ms}ms" +
                                if (ms > 4000) " — slower than usual" else ""
                        } catch (e: Exception) {
                            "✕ ${e.message ?: "failed"}"
                        }
                        probing = false
                    }
                }
                probe?.let {
                    Text(
                        it,
                        fontSize = 13.sp,
                        fontFamily = FontFamily.Monospace,
                        color = if (it.startsWith("✓")) Ledger.income else Ledger.expense,
                    )
                }
            }

            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
            ) {
                LabelMono("Offline queue")
                Text(
                    when {
                        queueCount < 0 -> "…"
                        queueCount == 0 -> "Nothing waiting — every quick-add is on the server."
                        else -> "$queueCount expense${if (queueCount == 1) "" else "s"} waiting to sync."
                    },
                    fontSize = 13.sp,
                    color = Color.White.copy(alpha = 0.8f),
                )
                if (queueCount > 0) {
                    com.piyawatpm.vesta.ui.components.VoltButton("Sync now") {
                        store.scope.launch2 {
                            queue.flush()
                            queueCount = queue.count()
                            store.refresh()
                        }
                    }
                }
            }

            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
            ) {
                LabelMono("Data")
                DiagRow("Signed in", if (store.isSignedIn) "yes" else "no")
                DiagRow(
                    "Last refresh",
                    if (store.lastRefreshed > 0) {
                        SydneyTime.dayString(Instant.ofEpochMilli((store.lastRefreshed * 1000).toLong()))
                    } else "never",
                )
                DiagRow("Income rows", "${store.income.size}")
                DiagRow("Expense rows", "${store.expenses.size}")
                DiagRow("Holdings", "${store.holdings.size}")
                DiagRow("Crypto tx rows", "${store.cryptoTxs.size}")
                DiagRow("Snapshot rows", "${store.networthHistory.size}")
                DiagRow("Live crypto prices", "${store.livePrices.size}")
                DiagRow("Live stock prices", "${store.liveStockPrices.size}")
            }
        }
    }
}

@Composable
private fun DiagRow(label: String, value: String) {
    Row {
        Text(label, fontSize = 12.sp, color = Color.White.copy(alpha = 0.6f))
        Spacer(Modifier.weight(1f))
        Text(
            value,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.White,
        )
    }
}

/** The deployed web app in-place, for pages not yet ported. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebScreen(path: String, title: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Ledger.background).statusBarsPadding()) {
        PushedHeader(title, null, onBack)
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    webViewClient = WebViewClient()
                    setBackgroundColor(android.graphics.Color.BLACK)
                    val base = Settings.endpointBase ?: Settings.PRODUCTION_URL
                    loadUrl("$base$path")
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}
