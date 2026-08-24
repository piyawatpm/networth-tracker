package com.piyawatpm.vesta.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.SouthWest
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.components.LocalStore
import com.piyawatpm.vesta.ui.screens.DashboardScreen
import com.piyawatpm.vesta.ui.screens.ExpensesScreen
import com.piyawatpm.vesta.ui.screens.IncomeScreen
import com.piyawatpm.vesta.ui.screens.InvestScreen
import com.piyawatpm.vesta.ui.screens.MoreScreen
import com.piyawatpm.vesta.ui.screens.SignInScreen
import com.piyawatpm.vesta.ui.theme.Ledger
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Which tab is which — named so pop-to-root wiring can't drift. */
object VestaTabIndex {
    const val HOME = 0
    const val INCOME = 1
    const val SPEND = 2
    const val INVEST = 3
    const val MORE = 4
}

data class VestaTab(val id: Int, val title: String, val icon: ImageVector)

/** Broadcast when the active tab is tapped again — "back to the top". */
data class TabReselect(val tab: Int = -1, val count: Int = 0)

/**
 * Native root: sign-in gate, then the five-tab app. The web app is no longer
 * the main surface — it remains reachable from More for pages not yet ported.
 * Port of ios RootView.swift.
 */
@Composable
fun VestaRoot(store: VestaStore) {
    // Bootstrap once: cached paint, silent owner sign-in, fresh data behind.
    LaunchedEffect(Unit) { store.bootstrap() }

    // Fresh-while-open: a 2-minute tick keeps changes from other devices
    // (web edits, cron-generated entries) flowing in without pull-to-refresh.
    LaunchedEffect(Unit) {
        while (true) {
            delay(120_000)
            store.refreshIfStale(maxAgeSeconds = 100.0)
        }
    }

    // Foreground/background: sockets don't survive suspension — tear down
    // cleanly and refresh on each return (20s guard debounces app switching).
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    store.startLive()
                    scope.launch { store.refreshIfStale(maxAgeSeconds = 20.0) }
                }
                Lifecycle.Event.ON_STOP -> store.stopLive()
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    CompositionLocalProvider(LocalStore provides store) {
        Box(Modifier.fillMaxSize().background(Ledger.background)) {
            if (store.needsManualSignIn) {
                SignInScreen(store)
            } else {
                MainTabView(store)
            }
        }
    }
}

private val tabs = listOf(
    VestaTab(VestaTabIndex.HOME, "Home", Icons.Filled.GridView),
    VestaTab(VestaTabIndex.INCOME, "Income", Icons.Filled.SouthWest),
    VestaTab(VestaTabIndex.SPEND, "Spend", Icons.Filled.NorthEast),
    VestaTab(VestaTabIndex.INVEST, "Invest", Icons.AutoMirrored.Filled.TrendingUp),
    VestaTab(VestaTabIndex.MORE, "More", Icons.Filled.MoreHoriz),
)

@Composable
fun MainTabView(store: VestaStore) {
    var selection by rememberSaveable { mutableIntStateOf(0) }
    var reselect by remember { mutableStateOf(TabReselect()) }
    val stateHolder = rememberSaveableStateHolder()

    Box(Modifier.fillMaxSize()) {
        // Each tab keeps its own saved state (scroll positions, filters) the
        // way the iOS TabView keeps pages alive.
        stateHolder.SaveableStateProvider(key = "tab-$selection") {
            when (selection) {
                VestaTabIndex.HOME -> DashboardScreen(store, reselect)
                VestaTabIndex.INCOME -> IncomeScreen(store, reselect)
                VestaTabIndex.SPEND -> ExpensesScreen(store, reselect)
                VestaTabIndex.INVEST -> InvestScreen(store, reselect)
                VestaTabIndex.MORE -> MoreScreen(store, reselect)
            }
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 4.dp),
        ) {
            // Error toast rides above the bar; tap to dismiss.
            AnimatedVisibility(
                visible = store.loadError != null,
                enter = slideInVertically { it } + fadeIn(),
                exit = slideOutVertically { it } + fadeOut(),
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) {
                Text(
                    text = store.loadError ?: "",
                    fontSize = 11.sp,
                    color = Color.White,
                    maxLines = 2,
                    modifier = Modifier
                        .padding(bottom = 8.dp)
                        .background(Ledger.expense.copy(alpha = 0.9f), RoundedCornerShape(50))
                        .clickable { store.loadError = null }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }

            VestaTabBar(
                tabs = tabs,
                selection = selection,
                onSelect = { selection = it },
                onReselect = { index ->
                    reselect = TabReselect(index, reselect.count + 1)
                },
            )
        }
    }
}

/**
 * Custom glass-style tab bar built around one gesture: touch anywhere on the
 * bar and either tap a tab or HOLD AND DRAG — the selection scrubs under your
 * finger, and the indicator stretches while dragging. Port of VestaTabBar.
 */
@Composable
fun VestaTabBar(
    tabs: List<VestaTab>,
    selection: Int,
    onSelect: (Int) -> Unit,
    onReselect: (Int) -> Unit,
) {
    var isDragging by remember { mutableStateOf(false) }

    BoxWithConstraints(
        modifier = Modifier
            .padding(horizontal = 24.dp)
            .fillMaxWidth()
            .height(58.dp)
            .background(Color(0xF0141416), RoundedCornerShape(50))
            .border(1.dp, Color.White.copy(alpha = 0.06f), RoundedCornerShape(50)),
    ) {
        val slot = maxWidth / tabs.size
        val density = LocalDensity.current

        val indicatorOffset by animateFloatAsState(
            targetValue = selection.toFloat(),
            animationSpec = spring(dampingRatio = 0.62f, stiffness = 700f),
            label = "tab-indicator",
        )
        val indicatorScale by animateFloatAsState(
            targetValue = if (isDragging) 1.12f else 1f,
            animationSpec = spring(),
            label = "tab-scale",
        )

        // The selection lens.
        Box(
            Modifier
                .offset(x = slot * indicatorOffset + 5.dp, y = 6.dp)
                .width(slot - 10.dp)
                .height(58.dp - 12.dp)
                .scale(indicatorScale)
                .background(Ledger.income.copy(alpha = 0.14f), RoundedCornerShape(50))
                .border(
                    0.8.dp,
                    Brush.verticalGradient(
                        listOf(Color.White.copy(alpha = 0.35f), Color.White.copy(alpha = 0.05f)),
                    ),
                    RoundedCornerShape(50),
                ),
        )

        Row(Modifier.fillMaxSize()) {
            for (tab in tabs) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.weight(1f).fillMaxSize(),
                ) {
                    Icon(
                        tab.icon,
                        contentDescription = tab.title,
                        tint = if (tab.id == selection) Ledger.income else Color.White.copy(alpha = 0.5f),
                        modifier = Modifier.size(20.dp),
                    )
                    Text(
                        tab.title,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (tab.id == selection) Ledger.income else Color.White.copy(alpha = 0.5f),
                    )
                }
            }
        }

        // One gesture serves taps and scrubs: press → maybe drag across tabs
        // with live selection; release on the starting tab without movement =
        // tap (reselect if already active).
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(tabs.size, selection) {
                    val slotPx = with(density) { slot.toPx() }
                    awaitEachGesture {
                        val down = awaitPointerEvent().changes.firstOrNull() ?: return@awaitEachGesture
                        if (!down.pressed) return@awaitEachGesture
                        var scrubbed = false
                        var lastIndex = (down.position.x / slotPx).toInt()
                            .coerceIn(0, tabs.size - 1)
                        if (lastIndex != selection) {
                            scrubbed = true
                            onSelect(lastIndex)
                        }
                        isDragging = true
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull() ?: break
                            if (!change.pressed) break
                            val index = (change.position.x / slotPx).toInt()
                                .coerceIn(0, tabs.size - 1)
                            if (index != lastIndex) {
                                scrubbed = true
                                lastIndex = index
                                onSelect(index)
                            }
                        }
                        isDragging = false
                        if (!scrubbed && lastIndex == selection) onReselect(lastIndex)
                    }
                },
        )
    }
}
