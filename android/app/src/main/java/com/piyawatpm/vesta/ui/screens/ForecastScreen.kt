package com.piyawatpm.vesta.ui.screens

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.Remove
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
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
import com.piyawatpm.vesta.core.ForecastInputs
import com.piyawatpm.vesta.core.ForecastMath
import com.piyawatpm.vesta.core.MEASURED_PACE_MIN_DAYS
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.core.forecastGoal
import com.piyawatpm.vesta.core.forecastInputs
import com.piyawatpm.vesta.core.measuredPace
import com.piyawatpm.vesta.core.usingMeasuredReturn
import com.piyawatpm.vesta.data.NetworthGoal
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.components.BottomSpacer
import com.piyawatpm.vesta.ui.components.FinePrint
import com.piyawatpm.vesta.ui.components.FxChip
import com.piyawatpm.vesta.ui.components.launch2
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.financeCard
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.roundToInt

/** Compound net-worth forecast page. Port of ios ForecastView. */
@Composable
fun ForecastScreen(store: VestaStore, onBack: () -> Unit) {
    var goalId by rememberSaveable { mutableStateOf<String?>(null) }
    var showEditor by remember { mutableStateOf(false) }
    var editingGoal by remember { mutableStateOf<NetworthGoal?>(null) }
    var planYear by rememberSaveable { mutableStateOf<Int?>(null) }

    val goal = goalId?.let { id -> store.goals.firstOrNull { it.id == id && it.achievedAt == null } }
        ?: store.forecastGoal
    val activeGoals = store.goals.filter { it.achievedAt == null }
    val inputs = store.forecastInputs
    val measured = store.measuredPace
    val target = goal?.let { store.convert(it.amount, it.currency) } ?: 0.0
    val etaMonths = if (goal == null) null else ForecastMath.monthsToReach(inputs, target)
    val usingMeasured = store.usingMeasuredReturn(inputs, measured)
    val deadlineMonths: Int? = goal?.targetDate?.let { ForecastMath.monthsUntil(it) }
        ?: planYear?.let { ForecastMath.monthsUntil("$it-12-31") }

    fun setAssumptions(mutate: (com.piyawatpm.vesta.data.ForecastAssumptions) -> com.piyawatpm.vesta.data.ForecastAssumptions) {
        store.scope.launch2 { store.saveForecastAssumptions(mutate(store.forecastAssumptions)) }
    }

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
            Text("Forecast", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
            Spacer(Modifier.weight(1f))
            FxChip(store)
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.Filled.Flag,
                contentDescription = "Goals",
                tint = Ledger.income,
                modifier = Modifier
                    .clickable { editingGoal = goal; showEditor = true }
                    .padding(8.dp)
                    .size(20.dp),
            )
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            // Goal picker chips (only with >1 active goal).
            if (activeGoals.size > 1) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                ) {
                    for (g in activeGoals) {
                        ForecastChip(
                            text = g.name.ifEmpty {
                                store.format(store.convert(g.amount, g.currency), compact = true)
                            },
                            selected = g.id == goal?.id,
                        ) { goalId = g.id }
                    }
                }
            }

            // Hero
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
            ) {
                if (goal != null) {
                    LabelMono(
                        "${goal.name.ifEmpty { "Goal" }} · ${store.format(store.convert(goal.amount, goal.currency), compact = true)}"
                    )
                    when {
                        etaMonths == 0 -> Text(
                            "You're there.",
                            fontSize = 28.sp,
                            fontWeight = FontWeight.Bold,
                            color = Ledger.income,
                        )
                        etaMonths != null -> {
                            Text(
                                ForecastMath.monthYear(ForecastMath.addMonths(etaMonths)),
                                fontSize = 34.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                            )
                            Text(
                                "${ForecastMath.describe(etaMonths)} from now · saving ${store.format(inputs.monthlySaving, compact = true)}/mo at ${"%.1f".format(inputs.annualReturnPct)}%/yr${if (usingMeasured) " (your measured pace)" else ""}",
                                fontSize = 12.sp,
                                color = Color.White.copy(alpha = 0.6f),
                            )
                        }
                        else -> {
                            Text(
                                "Not on this path",
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Bold,
                                color = Ledger.expense,
                            )
                            Text(
                                "Net worth isn't growing toward the goal at these inputs — raise the saving or the return below.",
                                fontSize = 12.sp,
                                color = Color.White.copy(alpha = 0.6f),
                            )
                        }
                    }
                    val progress = if (target > 0) (inputs.netWorth / target).coerceIn(0.0, 1.0) else 0.0
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
                    Row {
                        Text(
                            "${store.format(inputs.netWorth, compact = true)} of ${store.format(target, compact = true)}",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            "${"%.1f".format(progress * 100)}% · ${store.format(maxOf(0.0, target - inputs.netWorth), compact = true)} to go",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                    }
                } else {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                    ) {
                        Icon(
                            Icons.Filled.Flag,
                            contentDescription = null,
                            tint = Color.White.copy(alpha = 0.6f),
                            modifier = Modifier.size(28.dp),
                        )
                        Text(
                            "Set a target to forecast against",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White,
                        )
                        Text(
                            "Say “100M baht” and this page tells you when you get there at this pace — and what it would take to get there sooner.",
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                        com.piyawatpm.vesta.ui.components.VoltButton("New goal") {
                            editingGoal = null
                            showEditor = true
                        }
                    }
                }
            }

            if (goal != null) {
                ForecastChartCard(store, inputs, target, etaMonths, goal)
                LeversCard(store, inputs, measured, usingMeasured, ::setAssumptions)
                PathsCard(store, inputs, measured, target, etaMonths, usingMeasured)
                PlannerCard(store, inputs, goal, target, etaMonths, deadlineMonths, planYear) {
                    planYear = it
                }
                CompositionCard(store, inputs, target, etaMonths)
                FinePrint(
                    "net worth today ${store.format(inputs.netWorth, compact = true)} incl. super · contributions land at month end, return compounds monthly · levers sync to the web",
                )
            }
            BottomSpacer()
        }
    }

    if (showEditor) {
        GoalEditorSheet(store, editingGoal) { saved ->
            store.scope.launch2 { store.saveGoal(saved) }
            goalId = saved.id
            showEditor = false
        }
    }
}

@Composable
private fun ForecastChip(text: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        text,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        color = if (selected) Color.Black else Color.White,
        modifier = Modifier
            .background(
                if (selected) Color.White else Color.White.copy(alpha = 0.08f),
                RoundedCornerShape(50),
            )
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

@Composable
private fun ForecastChartCard(
    store: VestaStore,
    inputs: ForecastInputs,
    target: Double,
    etaMonths: Int?,
    goal: NetworthGoal,
) {
    val horizon = minOf(40 * 12, maxOf(24, (etaMonths ?: 20 * 12) + 24))
    val (withGrowth, savingsOnly) = ForecastMath.projectPath(inputs, horizon)
    val yMax = maxOf(target, withGrowth.lastOrNull() ?: 0.0) * 1.05

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono("Projected net worth")
            Spacer(Modifier.weight(1f))
            ChartLegendSwatch("with growth", Ledger.income)
            Spacer(Modifier.width(10.dp))
            ChartLegendSwatch("savings only", Ledger.chartColor(2))
        }

        val textMeasurer = rememberTextMeasurer()
        Canvas(Modifier.fillMaxWidth().height(200.dp)) {
            if (withGrowth.size < 2 || yMax <= 0) return@Canvas
            val gutter = 44.dp.toPx()
            val plotWidth = size.width - gutter

            fun x(month: Int): Float = (month.toFloat() / horizon * plotWidth)
            fun y(value: Double): Float =
                (size.height - value / yMax * size.height).toFloat()

            // Y grid + labels (4 marks).
            for (i in 1..3) {
                val value = yMax * i / 4
                drawLine(
                    Color.White.copy(alpha = 0.06f),
                    Offset(0f, y(value)),
                    Offset(plotWidth, y(value)),
                    strokeWidth = 1f,
                )
                val layout = textMeasurer.measure(
                    store.format(value, compact = true),
                    TextStyle(
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.4f),
                    ),
                )
                drawText(layout, topLeft = Offset(size.width - layout.size.width, y(value) - layout.size.height / 2))
            }

            val stride = maxOf(1, horizon / 160)

            fun drawSeries(series: List<Double>, color: Color, dashed: Boolean, widthDp: Float) {
                val path = Path()
                var started = false
                var m = 0
                while (m <= horizon) {
                    val px = x(m)
                    val py = y(series[m])
                    if (!started) {
                        path.moveTo(px, py); started = true
                    } else {
                        path.lineTo(px, py)
                    }
                    m += stride
                }
                drawPath(
                    path,
                    color = color,
                    style = Stroke(
                        widthDp.dp.toPx(),
                        join = StrokeJoin.Round,
                        pathEffect = if (dashed) {
                            PathEffect.dashPathEffect(floatArrayOf(8f, 6f))
                        } else null,
                    ),
                )
            }

            drawSeries(savingsOnly, Ledger.chartColor(2), dashed = true, widthDp = 1.5f)
            drawSeries(withGrowth, Ledger.income, dashed = false, widthDp = 2f)

            // Goal rule + annotation.
            if (target > 0) {
                drawLine(
                    Ledger.chartColor(6).copy(alpha = 0.7f),
                    Offset(0f, y(target)),
                    Offset(plotWidth, y(target)),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
                )
                val label = textMeasurer.measure(
                    goal.name.ifEmpty { "goal" },
                    TextStyle(
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.6f),
                    ),
                )
                drawText(
                    label,
                    topLeft = Offset(
                        plotWidth - label.size.width - 4.dp.toPx(),
                        maxOf(0f, y(target) - label.size.height - 2.dp.toPx()),
                    ),
                )
            }

            // ETA point.
            etaMonths?.takeIf { it in 1..horizon }?.let { eta ->
                drawCircle(
                    Ledger.chartColor(6),
                    radius = 4.dp.toPx(),
                    center = Offset(x(eta), y(withGrowth[eta])),
                )
            }

            // Year ticks.
            val yearStep = maxOf(12, (horizon / 6 / 12) * 12)
            var m = 0
            while (m <= horizon) {
                val year = LocalDate.now(SydneyTime.zone).plusMonths(m.toLong()).year
                val layout = textMeasurer.measure(
                    "$year",
                    TextStyle(
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.4f),
                    ),
                )
                drawText(
                    layout,
                    topLeft = Offset(
                        (x(m) - layout.size.width / 2).coerceIn(0f, plotWidth - layout.size.width),
                        size.height - layout.size.height,
                    ),
                )
                m += yearStep
            }
        }
        FinePrint("the gap between the lines is compounding — the part of the goal your money earns for you")
    }
}

@Composable
private fun ChartLegendSwatch(label: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.width(12.dp).height(2.dp).background(color))
        Text(
            label,
            fontSize = 9.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.4f),
        )
    }
}

@Composable
private fun LeversCard(
    store: VestaStore,
    inputs: ForecastInputs,
    measured: com.piyawatpm.vesta.core.MeasuredPace,
    usingMeasured: Boolean,
    setAssumptions: ((com.piyawatpm.vesta.data.ForecastAssumptions) -> com.piyawatpm.vesta.data.ForecastAssumptions) -> Unit,
) {
    var savingText by remember(inputs.monthlySaving.roundToInt()) {
        mutableStateOf(inputs.monthlySaving.roundToInt().toString())
    }
    var returnText by remember("%.1f".format(inputs.annualReturnPct)) {
        mutableStateOf("%.1f".format(inputs.annualReturnPct))
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono("Your levers")

        // Monthly saving
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Monthly saving", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Color.White)
                Spacer(Modifier.width(6.dp))
                Text("income − expenses", fontSize = 10.sp, color = Color.White.copy(alpha = 0.4f))
                Spacer(Modifier.weight(1f))
                val m = measured.monthlySaving
                if (m != null && store.forecastAssumptions.monthlySaving != null) {
                    Text(
                        "reset to ${store.format(m, compact = true)}",
                        fontSize = 10.sp,
                        color = Ledger.income,
                        modifier = Modifier.clickable {
                            setAssumptions { it.copy(monthlySaving = null) }
                        },
                    )
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = savingText,
                    onValueChange = { savingText = it },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
                    textStyle = TextStyle(
                        fontSize = 15.sp, fontFamily = FontFamily.Monospace, color = Color.White,
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Ledger.income,
                        unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                    ),
                    modifier = Modifier.weight(1f),
                )
                Text("/mo", fontSize = 12.sp, color = Color.White.copy(alpha = 0.6f))
                val step = maxOf(1000.0, (inputs.monthlySaving * 0.05 / 1000).roundToInt() * 1000.0)
                StepperButton(Icons.Filled.Remove) {
                    setAssumptions { it.copy(monthlySaving = maxOf(0.0, inputs.monthlySaving - step)) }
                }
                StepperButton(Icons.Filled.Add) {
                    setAssumptions { it.copy(monthlySaving = inputs.monthlySaving + step) }
                }
                Text(
                    "set",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ledger.income,
                    modifier = Modifier.clickable {
                        savingText.replace(",", "").toDoubleOrNull()?.let { v ->
                            setAssumptions { it.copy(monthlySaving = maxOf(0.0, v)) }
                        }
                    },
                )
            }
            FinePrint(
                measured.monthlySaving?.let {
                    "measured ${store.format(it, compact = true)}/mo over the last six months where both ledgers were logged"
                } ?: "not enough ledger history to measure — type what you save",
            )
        }

        com.piyawatpm.vesta.ui.components.SubtleDivider()

        // Return
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Yearly return on everything you own",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = Color.White,
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            ) {
                measured.pacePct?.let { pace ->
                    ForecastChip(
                        "Your pace ${if (pace >= 0) "+" else ""}${"%.1f".format(pace)}%",
                        selected = usingMeasured,
                    ) { setAssumptions { it.copy(annualReturnPct = pace) } }
                }
                for (preset in ForecastMath.presets) {
                    ForecastChip(
                        "${preset.label} ${preset.pct.toInt()}%",
                        selected = !usingMeasured && abs(inputs.annualReturnPct - preset.pct) < 0.0001,
                    ) { setAssumptions { it.copy(annualReturnPct = preset.pct) } }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.06f), RoundedCornerShape(50))
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                ) {
                    androidx.compose.foundation.text.BasicTextField(
                        value = returnText,
                        onValueChange = { returnText = it },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                        textStyle = TextStyle(
                            fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = Color.White,
                        ),
                        modifier = Modifier.width(44.dp),
                    )
                    Text("%", fontSize = 10.sp, color = Color.White.copy(alpha = 0.6f))
                    Text(
                        "set",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Ledger.income,
                        modifier = Modifier.clickable {
                            returnText.toDoubleOrNull()?.let { v ->
                                setAssumptions { it.copy(annualReturnPct = v) }
                            }
                        },
                    )
                }
            }
            FinePrint(
                if (measured.pacePct != null) {
                    "your pace = how fast net worth grew beyond deposits over the last ${measured.paceDays.toInt()} days${if (measured.paceDays < MEASURED_PACE_MIN_DAYS) " — short window, treat it as a mood not a law; presets are long-run assumptions" else ""}"
                } else {
                    "not enough net-worth history to measure your pace yet (needs 90+ days) · presets are long-run assumptions"
                },
            )
        }

        com.piyawatpm.vesta.ui.components.SubtleDivider()

        // Contribution growth
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("Saving grows each year", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Color.White)
                Text("raises, bots scaling", fontSize = 10.sp, color = Color.White.copy(alpha = 0.4f))
            }
            Spacer(Modifier.weight(1f))
            StepperButton(Icons.Filled.Remove) {
                setAssumptions {
                    it.copy(contributionGrowthPct = maxOf(0.0, inputs.contributionGrowthPct - 1))
                }
            }
            Text(
                "${inputs.contributionGrowthPct.toInt()}%/yr",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Color.White,
                modifier = Modifier.padding(horizontal = 8.dp),
            )
            StepperButton(Icons.Filled.Add) {
                setAssumptions {
                    it.copy(contributionGrowthPct = minOf(30.0, inputs.contributionGrowthPct + 1))
                }
            }
        }
    }
}

@Composable
private fun StepperButton(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Box(
        Modifier
            .size(30.dp)
            .background(Color.White.copy(alpha = 0.08f), CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
    }
}

@Composable
private fun PathsCard(
    store: VestaStore,
    inputs: ForecastInputs,
    measured: com.piyawatpm.vesta.core.MeasuredPace,
    target: Double,
    etaMonths: Int?,
    usingMeasured: Boolean,
) {
    data class PathRow(
        val label: String, val pct: Double, val months: Int?, val note: String, val active: Boolean,
    )

    val rows = buildList {
        measured.pacePct?.let { pace ->
            add(
                PathRow(
                    "Your pace", pace,
                    ForecastMath.monthsToReach(inputs.copy(annualReturnPct = pace), target),
                    "measured over ${measured.paceDays.toInt()} days", usingMeasured,
                )
            )
        }
        for (preset in ForecastMath.presets) {
            add(
                PathRow(
                    preset.label, preset.pct,
                    ForecastMath.monthsToReach(inputs.copy(annualReturnPct = preset.pct), target),
                    preset.note,
                    !usingMeasured && abs(inputs.annualReturnPct - preset.pct) < 0.0001,
                )
            )
        }
    }

    val bump = maxOf(1000.0, (inputs.monthlySaving * 0.1 / 1000).roundToInt() * 1000.0)
    val levers = listOf(
        "+${store.format(bump, compact = true)}/mo saved" to
            ForecastMath.monthsToReach(inputs.copy(monthlySaving = inputs.monthlySaving + bump), target),
        "+1% yearly return" to
            ForecastMath.monthsToReach(inputs.copy(annualReturnPct = inputs.annualReturnPct + 1), target),
        "+3% raise each year" to
            ForecastMath.monthsToReach(
                inputs.copy(contributionGrowthPct = inputs.contributionGrowthPct + 3), target,
            ),
    )

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono("Paths to ${store.format(target, compact = true)}")
        for (row in rows) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            row.label,
                            fontSize = 14.sp,
                            fontWeight = if (row.active) FontWeight.SemiBold else FontWeight.Normal,
                            color = Color.White,
                        )
                        Text(
                            "${if (row.pct >= 0) "+" else ""}${"%.1f".format(row.pct)}%/yr",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                    }
                    Text(
                        row.note,
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White.copy(alpha = 0.4f),
                    )
                }
                if (row.months != null) {
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            ForecastMath.monthYear(ForecastMath.addMonths(row.months)),
                            fontSize = 13.sp,
                            fontWeight = if (row.active) FontWeight.SemiBold else FontWeight.Normal,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White,
                        )
                        Text(
                            ForecastMath.describe(row.months),
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.4f),
                        )
                    }
                } else {
                    Text(
                        "not on this path",
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Ledger.expense,
                    )
                }
            }
        }
        if (etaMonths != null) {
            com.piyawatpm.vesta.ui.components.SubtleDivider()
            LabelMono("What moves the needle")
            for ((label, months) in levers) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White.copy(alpha = 0.04f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                ) {
                    Icon(
                        Icons.Filled.NorthEast,
                        contentDescription = null,
                        tint = Ledger.income,
                        modifier = Modifier.size(11.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(label, fontSize = 12.sp, color = Color.White)
                    Spacer(Modifier.weight(1f))
                    if (months != null) {
                        Text(
                            if (etaMonths - months <= 0) "no change"
                            else "${ForecastMath.describe(etaMonths - months)} sooner",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = Ledger.income,
                        )
                    } else {
                        Text("—", fontSize = 12.sp, color = Color.White.copy(alpha = 0.4f))
                    }
                }
            }
        }
    }
}

@Composable
private fun PlannerCard(
    store: VestaStore,
    inputs: ForecastInputs,
    goal: NetworthGoal,
    target: Double,
    etaMonths: Int?,
    deadlineMonths: Int?,
    planYear: Int?,
    onPlanYear: (Int?) -> Unit,
) {
    val years = listOf(3, 5, 10, 15, 20).map { LocalDate.now(SydneyTime.zone).year + it }
    val months = deadlineMonths

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabelMono("Reach it by")
            Spacer(Modifier.weight(1f))
            goal.targetDate?.let {
                Text(
                    "deadline ${it.take(4)}",
                    fontSize = 10.sp,
                    color = Color.White.copy(alpha = 0.6f),
                )
            }
        }
        if (goal.targetDate == null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            ) {
                for (y in years) {
                    ForecastChip("$y", selected = planYear == y) {
                        onPlanYear(if (planYear == y) null else y)
                    }
                }
            }
        }
        if (months != null && months > 0) {
            val needSaving = ForecastMath.requiredMonthlySaving(
                inputs.netWorth, inputs.annualReturnPct, inputs.contributionGrowthPct, target, months,
            )
            val needReturn = ForecastMath.requiredAnnualReturn(
                inputs.netWorth, inputs.monthlySaving, inputs.contributionGrowthPct, target, months,
            )
            val onTrack = (etaMonths ?: Int.MAX_VALUE) <= months
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlanTile(
                    "Current pace",
                    if (onTrack) "On track"
                    else etaMonths?.let { "${ForecastMath.describe(it - months)} late" } ?: "Never",
                    etaMonths?.let { "arrives ${ForecastMath.monthYear(ForecastMath.addMonths(it))}" }
                        ?: "not on this path",
                    if (onTrack) Ledger.income else Ledger.expense,
                    Modifier.weight(1f),
                )
                PlanTile(
                    "Or save",
                    needSaving?.let { "${store.format(it, compact = true)}/mo" } ?: "—",
                    needSaving?.let {
                        "${if (it - inputs.monthlySaving >= 0) "+" else ""}${store.format(it - inputs.monthlySaving, compact = true)} vs now"
                    } ?: "no saving gets there in time",
                    Color.White,
                    Modifier.weight(1f),
                )
                PlanTile(
                    "Or earn",
                    needReturn?.let { "${"%.1f".format(it)}%/yr" } ?: "—",
                    if (needReturn != null) "vs ${"%.1f".format(inputs.annualReturnPct)}% now"
                    else "no sane return does it",
                    Color.White,
                    Modifier.weight(1f),
                )
            }
        } else {
            Text(
                "Pick a year to see what it would take.",
                fontSize = 12.sp,
                color = Color.White.copy(alpha = 0.6f),
            )
        }
    }
}

@Composable
private fun PlanTile(label: String, value: String, sub: String, tint: Color, modifier: Modifier) {
    Column(
        verticalArrangement = Arrangement.spacedBy(3.dp),
        modifier = modifier
            .background(Color.White.copy(alpha = 0.04f), RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Text(
            label.uppercase(),
            fontSize = 8.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.4f),
        )
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = tint, maxLines = 1)
        Text(
            sub,
            fontSize = 8.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.6f),
            maxLines = 2,
        )
    }
}

@Composable
private fun CompositionCard(
    store: VestaStore,
    inputs: ForecastInputs,
    target: Double,
    etaMonths: Int?,
) {
    val eta = etaMonths?.takeIf { it > 0 } ?: return
    val (withGrowth, savingsOnly) = ForecastMath.projectPath(inputs, eta)
    val start = inputs.netWorth
    val deposits = savingsOnly[eta] - start
    val growth = withGrowth[eta] - savingsOnly[eta]
    val total = maxOf(1.0, start + deposits + growth)

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        LabelMono("Where the ${store.format(target, compact = true)} comes from")
        Row(
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.fillMaxWidth().height(8.dp),
        ) {
            Box(
                Modifier
                    .weight((start / total).toFloat().coerceAtLeast(0.02f))
                    .height(8.dp)
                    .background(Ledger.chartColor(4), RoundedCornerShape(50)),
            )
            Box(
                Modifier
                    .weight((deposits / total).toFloat().coerceAtLeast(0.02f))
                    .height(8.dp)
                    .background(Ledger.chartColor(2), RoundedCornerShape(50)),
            )
            Box(
                Modifier
                    .weight((growth / total).toFloat().coerceAtLeast(0.02f))
                    .height(8.dp)
                    .background(Ledger.income, RoundedCornerShape(50)),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompositionPart(store, "Already have", start, Ledger.chartColor(4))
            CompositionPart(store, "You'll deposit", deposits, Ledger.chartColor(2))
            CompositionPart(store, "Growth earns", growth, Ledger.income)
        }
        FinePrint(
            if (growth / total < 0.25) {
                "most of this goal is your own deposits — the saving lever matters far more than the return lever right now"
            } else {
                "compounding is doing real work here — protecting the return matters as much as saving more"
            },
        )
    }
}

@Composable
private fun CompositionPart(store: VestaStore, label: String, value: Double, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.size(7.dp).background(color, CircleShape))
        Column {
            Text(
                label,
                fontSize = 8.sp,
                fontFamily = FontFamily.Monospace,
                color = Color.White.copy(alpha = 0.4f),
            )
            Text(
                store.format(value, compact = true),
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Color.White,
            )
        }
    }
}

// MARK: - Goal editor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GoalEditorSheet(
    store: VestaStore,
    goal: NetworthGoal?,
    onSave: (NetworthGoal) -> Unit,
) {
    var dismissed by remember { mutableStateOf(false) }
    if (dismissed) return

    var name by remember { mutableStateOf(goal?.name ?: "") }
    var amount by remember { mutableStateOf(goal?.let { it.amount.toInt().toString() } ?: "") }
    var currency by remember { mutableStateOf(goal?.currency ?: store.displayCurrency) }
    var year by remember { mutableStateOf(goal?.targetDate?.take(4) ?: "") }

    ModalBottomSheet(onDismissRequest = { dismissed = true }, containerColor = Ledger.background) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (goal == null) "New goal" else "Edit goal",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = {
                        val value = amount.replace(",", "").toDoubleOrNull() ?: return@TextButton
                        if (value <= 0) return@TextButton
                        val thisYear = LocalDate.now(SydneyTime.zone).year
                        val deadline = year.toIntOrNull()?.takeIf { it > thisYear }?.let { "$it-12-31" }
                        val saved = (goal ?: NetworthGoal()).copy(
                            name = name.trim().ifEmpty { "Net worth goal" },
                            amount = value,
                            currency = currency,
                            targetDate = deadline,
                            achievedAt = null,
                        )
                        onSave(saved)
                        dismissed = true
                    },
                    enabled = (amount.replace(",", "").toDoubleOrNull() ?: 0.0) > 0,
                ) {
                    Text("Save", color = Ledger.income, fontWeight = FontWeight.Bold)
                }
            }
            val fieldColors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Ledger.income,
                unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                placeholder = { Text("Name (e.g. 100M baht)", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true,
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    placeholder = { Text("Target", color = Color.White.copy(alpha = 0.4f)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                    colors = fieldColors,
                    modifier = Modifier.weight(1f),
                )
                com.piyawatpm.vesta.ui.components.SegmentedControl(
                    options = listOf("THB", "AUD", "USD"),
                    selectedIndex = listOf("THB", "AUD", "USD").indexOf(currency).coerceAtLeast(0),
                ) { currency = listOf("THB", "AUD", "USD")[it] }
            }
            OutlinedTextField(
                value = year,
                onValueChange = { year = it },
                placeholder = { Text("By year (optional)", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            FinePrint(
                "Leave the year empty for “when will I get there?”. Set one and the forecast turns into a plan — what to save or earn to make it.",
                size = 9.sp,
            )
        }
    }
}
