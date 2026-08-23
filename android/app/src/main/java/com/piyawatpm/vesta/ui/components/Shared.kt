package com.piyawatpm.vesta.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.piyawatpm.vesta.core.FlowMath
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.MonthFlow
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.theme.Ledger
import com.piyawatpm.vesta.ui.theme.financeCard
import kotlin.math.abs

/** The app-wide store, provided at the root — the Compose stand-in for the
 *  iOS `@Environment(DataStore.self)`. */
val LocalStore = staticCompositionLocalOf<VestaStore> {
    error("VestaStore not provided")
}

/** Tabular figures for money — the Compose stand-in for monospacedDigit(). */
val MoneyStyle = TextStyle(fontFeatureSettings = "tnum")

/** Big money figure. Crisp instant updates, like OKX — deliberately no
 *  animated crossfade (it reads as smearing on FX switches). */
@Composable
fun MoneyText(
    amount: Double,
    currency: String,
    fontSize: TextUnit = 34.sp,
    tint: Color = Color.White,
    fontWeight: FontWeight = FontWeight.SemiBold,
) {
    Text(
        text = Money.format(amount, currency),
        style = MoneyStyle,
        fontSize = fontSize,
        fontWeight = fontWeight,
        color = tint,
    )
}

/** OKX's signed percent chip: tinted pill, volt for gains, pink for losses. */
@Composable
fun PctBadge(percent: Double) {
    val tint = if (percent >= 0) Ledger.income else Ledger.expense
    Text(
        text = "${if (percent >= 0) "+" else ""}${"%.2f".format(percent)}%",
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        style = MoneyStyle,
        color = tint,
        modifier = Modifier
            .background(tint.copy(alpha = 0.16f), RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

/** OKX's primary action: volt capsule, black bold label. */
@Composable
fun VoltButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Ledger.income.copy(alpha = if (enabled) 1f else 0.4f),
                RoundedCornerShape(50),
            )
            .clickable(enabled = enabled) { onClick() }
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = Color.Black,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
        )
    }
}

/** The currency cycle chip (AUD → USD → THB), shared by every page's
 *  toolbar. Writes through preferred_currency so the web app follows. */
@Composable
fun FxChip(store: VestaStore) {
    val cycle = listOf("AUD", "USD", "THB")
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .background(Ledger.card, RoundedCornerShape(50))
            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(50))
            .clickable {
                val index = cycle.indexOf(store.displayCurrency).let { if (it < 0) 2 else it }
                store.updateDisplayCurrency(cycle[(index + 1) % cycle.size])
            }
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text(
            text = "${Money.symbol(store.displayCurrency)} ${store.displayCurrency}",
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = Color.White,
        )
    }
}

/** Toolbar-sized super toggle — same rank as the FX chip. */
@Composable
fun SuperChip(store: VestaStore) {
    val on = store.includeSuperStocks
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .background(Ledger.card, RoundedCornerShape(50))
            .border(
                1.dp,
                if (on) Ledger.income.copy(alpha = 0.35f) else Color.White.copy(alpha = 0.08f),
                RoundedCornerShape(50),
            )
            .clickable { store.setIncludeSuper(!on) }
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Icon(
            imageVector = if (on) Icons.Filled.CheckCircle else Icons.Outlined.Block,
            contentDescription = null,
            tint = if (on) Ledger.income else Ledger.subtle,
            modifier = Modifier.size(13.dp),
        )
        Text(
            text = "Super",
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (on) Ledger.income else Ledger.subtle,
        )
    }
}

/** A quiet label+value stat, for the chips row under a hero number. */
@Composable
fun StatChip(label: String, value: String, tint: Color = Color.White) {
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(9.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(
            text = label.uppercase(),
            fontSize = 8.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.4f),
        )
        Text(
            text = value,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = tint,
        )
    }
}

/** Tappable category filter, shown once a category is picked. */
@Composable
fun FilterChip(label: String, color: Color, onClear: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        modifier = Modifier
            .background(color.copy(alpha = 0.18f), RoundedCornerShape(50))
            .border(0.8.dp, color.copy(alpha = 0.45f), RoundedCornerShape(50))
            .clickable { onClear() }
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Box(Modifier.size(6.dp).background(color, CircleShape))
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        Icon(
            Icons.Filled.Close,
            contentDescription = "clear",
            tint = Color.White,
            modifier = Modifier.size(10.dp),
        )
    }
}

/** "↑23% vs Jul pace" — same-day-of-month comparison, colored by whether
 *  the direction is good for THIS flow. */
@Composable
fun PaceBadge(current: Double, previousSameDay: Double, upIsGood: Boolean) {
    val pct = (current - previousSameDay) / previousSameDay * 100
    val up = pct >= 0
    val good = up == upIsGood
    val lastMonth = FlowMath.label(FlowMath.monthKeys(2)[0])
    val tint = if (good) Ledger.income else Ledger.expense

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .background(tint.copy(alpha = 0.12f), RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Icon(
            imageVector = if (up) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(9.dp),
        )
        Text(
            text = "${if (up) "+" else ""}${"%.0f".format(pct)}% vs $lastMonth pace",
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = tint,
        )
    }
}

/** One plain-language finding — "Food is 35% above your 3-month average". */
data class Insight(
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val text: String,
    val value: String,
    val tint: Color = Color.White,
)

@Composable
fun InsightsCard(title: String, insights: List<Insight>) {
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().financeCard().padding(16.dp),
    ) {
        com.piyawatpm.vesta.ui.theme.LabelMono(title)
        for (insight in insights) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Icon(
                    insight.icon,
                    contentDescription = null,
                    tint = insight.tint,
                    modifier = Modifier.size(14.dp),
                )
                Text(
                    text = insight.text,
                    fontSize = 12.sp,
                    color = Color.White.copy(alpha = 0.6f),
                    maxLines = 2,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = insight.value,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    color = insight.tint,
                )
            }
        }
    }
}

/**
 * Horizontal month chips — the fix for "the list never ends". Scoping to one
 * month bounds it; "All" stays available for the rare full sweep.
 */
@Composable
fun MonthScopeStrip(
    months: List<MonthFlow>,
    selection: String?,
    onSelect: (String?) -> Unit,
    tint: Color,
    format: ((Double) -> String)? = null,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 2.dp),
    ) {
        // "All" leads: it's the reset, and the strip opens on it.
        ScopeChip("All", null, selection == null, tint) { onSelect(null) }
        for (flow in months.reversed()) {
            val subtitle = format?.let { fmt ->
                if (flow.isCurrent) "${fmt(flow.total)} …" else fmt(flow.total)
            }
            ScopeChip(flow.label, subtitle, selection == flow.key, tint) {
                onSelect(flow.key)
            }
        }
    }
}

@Composable
private fun ScopeChip(
    title: String,
    subtitle: String?,
    active: Boolean,
    tint: Color,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(1.dp),
        modifier = Modifier
            .background(
                if (active) tint else Color.White.copy(alpha = 0.07f),
                RoundedCornerShape(50),
            )
            .clickable { onClick() }
            .padding(horizontal = 11.dp, vertical = if (subtitle == null) 8.dp else 4.dp),
    ) {
        Text(
            text = title,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (active) Color.Black else Color.White,
        )
        if (subtitle != null) {
            Text(
                text = subtitle,
                fontSize = 8.sp,
                fontFamily = FontFamily.Monospace,
                color = (if (active) Color.Black else Color.White).copy(alpha = 0.75f),
            )
        }
    }
}

/** The context that floats over the ledger once the hero has scrolled away. */
@Composable
fun FloatingScopePill(
    title: String,
    total: String,
    tint: Color,
    isFiltered: Boolean,
    onClear: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .background(Color(0xE61A1A1D), RoundedCornerShape(50))
            .border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Box(Modifier.size(7.dp).background(tint, CircleShape))
        Text(title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        Text(
            total,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = tint,
        )
        if (isFiltered) {
            Icon(
                Icons.Filled.Cancel,
                contentDescription = "clear",
                tint = Color.White.copy(alpha = 0.55f),
                modifier = Modifier.size(15.dp).clickable(
                    interactionSource = MutableInteractionSource(),
                    indication = null,
                ) { onClear() },
            )
        }
    }
}

/** Signed compact money string, "+A$1.2K" style — used all over the ledgers. */
fun signedCompact(store: VestaStore, usd: Double): String =
    "${if (usd >= 0) "+" else ""}${store.format(store.convert(usd, "USD"), compact = true)}"

/** Percent with sign, one decimal. */
fun signedPct(value: Double): String =
    "${if (value >= 0) "+" else ""}${"%.1f".format(value)}%"

/** Tiny vertical spacer helper for list bottoms clearing the tab bar. */
@Composable
fun BottomSpacer(height: Int = 110) {
    Spacer(Modifier.height(height.dp).fillMaxWidth())
}

/** Fine-print monospace footnote. */
@Composable
fun FinePrint(text: String, size: TextUnit = 8.sp) {
    Text(
        text = text,
        fontSize = size,
        fontFamily = FontFamily.Monospace,
        color = Color.White.copy(alpha = 0.35f),
    )
}

/** Row divider matching the iOS white-10% overlay dividers. */
@Composable
fun SubtleDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Color.White.copy(alpha = 0.1f)),
    )
}

/** Small colored category dot. */
@Composable
fun CategoryDot(color: Color, size: Int = 8) {
    Box(Modifier.size(size.dp).background(color, CircleShape))
}

/** abs-format convenience mirroring the Swift call sites. */
fun absFormat(store: VestaStore, amount: Double, compact: Boolean = true): String =
    store.format(abs(amount), compact = compact)
