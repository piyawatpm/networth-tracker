import SwiftUI

/// Native root: sign-in gate, then the five-tab app. The web app is no longer
/// the main surface — it remains reachable from More for pages not yet ported.
struct RootView: View {
    @State private var store = DataStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            // No login screen: the app paints cached data immediately and the
            // owner account signs in silently underneath. The form only exists
            // as a fallback for a changed password.
            if store.needsManualSignIn {
                SignInView()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                MainTabView()
                    .transition(.opacity)
            }
        }
        .environment(store)
        .animation(.spring(duration: 0.45), value: store.needsManualSignIn)
        .task { await store.bootstrap() }
        .task {
            // Fresh-while-open: a 2-minute tick keeps changes from other
            // devices (web edits, cron-generated entries) flowing in without
            // pull-to-refresh; sockets already stream prices in between.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(120))
                await store.refreshIfStale(maxAgeSeconds: 100)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Every open refreshes — the 20s guard only debounces rapid
                // app-switching, never a real return.
                store.startLive()
                Task { await store.refreshIfStale(maxAgeSeconds: 20) }
            case .background, .inactive:
                // Sockets don't survive suspension anyway — tear down cleanly
                // instead of letting them die mid-frame and burn reconnects.
                store.stopLive()
            default:
                break
            }
        }
        .tint(Ledger.income)
        // OKX is a dark product — pin it so system controls match.
        .preferredColorScheme(.dark)
    }
}

/// Which tab is which. Named so the pop-to-root wiring can't drift from the
/// tab order.
enum VestaTabIndex {
    static let home = 0, income = 1, spend = 2, invest = 3, more = 4
}

/// Broadcast when the active tab is tapped again. The count makes repeat
/// taps on the same tab distinct events.
struct TabReselect: Equatable {
    var tab: Int = -1
    var count: Int = 0
}

private struct TabReselectKey: EnvironmentKey {
    static let defaultValue = TabReselect()
}

extension EnvironmentValues {
    var tabReselect: TabReselect {
        get { self[TabReselectKey.self] }
        set { self[TabReselectKey.self] = newValue }
    }
}

struct MainTabView: View {
    @Environment(DataStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    /// Set by InspectTapIntent; shown the moment the app is frontmost.
    @State private var tapInspection: String?
    // Screenshot/UI runs can land on a specific tab.
    @State private var selection = Int(
        ProcessInfo.processInfo.environment["VESTA_INITIAL_TAB"] ?? ""
    ) ?? 0

    @State private var reselect = TabReselect()

    private static let tabs = [
        VestaTab(id: VestaTabIndex.home, title: "Home", icon: "square.grid.2x2"),
        VestaTab(id: VestaTabIndex.income, title: "Income", icon: "arrow.down.left.circle"),
        VestaTab(id: VestaTabIndex.spend, title: "Spend", icon: "arrow.up.right.circle"),
        VestaTab(id: VestaTabIndex.invest, title: "Invest", icon: "chart.line.uptrend.xyaxis"),
        VestaTab(id: VestaTabIndex.more, title: "More", icon: "ellipsis.circle"),
    ]

    var body: some View {
        // A native TabView, with the system bar hidden so the custom glass bar
        // can drive it. The hand-rolled ZStack this replaced kept all five
        // pages mounted at once, so every price tick re-evaluated five view
        // trees — three lists and three charts — which is what made tab
        // switching feel heavy. TabView builds a page on first visit, keeps
        // its state, and leaves off-screen pages alone.
        TabView(selection: $selection) {
            Tab(value: 0) { DashboardView().hidesSystemTabBar() }
            Tab(value: 1) { IncomeView().hidesSystemTabBar() }
            Tab(value: 2) { ExpensesView().hidesSystemTabBar() }
            Tab(value: 3) { InvestView().hidesSystemTabBar() }
            Tab(value: 4) { MoreView().hidesSystemTabBar() }
        }
        .safeAreaInset(edge: .bottom) {
            VestaTabBar(tabs: Self.tabs, selection: $selection) { index in
                // Switching tabs preserves where you were; tapping the tab
                // you're already on is the ask to go back to its root.
                reselect = TabReselect(tab: index, count: reselect.count + 1)
            }
            .padding(.bottom, 4)
        }
        .overlay(alignment: .bottom) {
            if let error = store.loadError {
                Text(error)
                    .font(.caption2)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Ledger.expense.opacity(0.9), in: .capsule)
                    .foregroundStyle(.white)
                    .padding(.bottom, 78)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onTapGesture { store.loadError = nil }
            }
        }
        .animation(.spring(duration: 0.3), value: store.loadError)
        .environment(\.tabReselect, reselect)
        // The Wallet-data inspector: the intent stores what it received and
        // foregrounds the app; this shows it as a plain readable alert.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active,
                  let report = Settings.defaults.string(forKey: "pendingTapInspection")
            else { return }
            Settings.defaults.removeObject(forKey: "pendingTapInspection")
            tapInspection = report
        }
        // vesta:// deep links — the beta-proof automation path. Both kinds
        // surface the same alert; /add also records the expense for real.
        .onOpenURL { url in
            guard let kind = DeepLink.parse(url) else { return }
            switch kind {
            case .inspect(let data):
                let report = """
                Amount: \(data.amount.map { String($0) } ?? "— nothing arrived") \(data.currency ?? "")
                Merchant: \(data.merchant.isEmpty ? "— nothing arrived" : data.merchant)
                URL: \(data.raw)
                """
                BreadcrumbLog.tap.write("URL INSPECT · " + report.replacingOccurrences(of: "\n", with: " · "))
                tapInspection = report
            case .add(let data):
                guard let amount = data.amount else {
                    BreadcrumbLog.tap.write("URL ADD · no amount · \(data.raw)")
                    tapInspection = "Add failed — no amount in:\n\(data.raw)"
                    return
                }
                let expense = PendingExpense(
                    amount: amount,
                    type: Settings.defaultCategory,
                    vendor: data.merchant,
                    currency: data.currency ?? Settings.defaultCurrency
                )
                BreadcrumbLog.tap.write("URL ADD · \(expense.currency) \(amount) · \(data.merchant)")
                Task {
                    let delivered = (try? await PendingQueue.shared.submit(expense)) ?? false
                    await MainActor.run {
                        tapInspection = """
                        \(delivered ? "Logged" : "Saved — will sync"):
                        \(expense.currency) \(amount)\(data.merchant.isEmpty ? "" : " at " + data.merchant)
                        """
                    }
                }
            }
        }
        .alert(
            "Wallet handed Vesta:",
            isPresented: Binding(
                get: { tapInspection != nil },
                set: { if !$0 { tapInspection = nil } }
            )
        ) {
            Button("OK") { tapInspection = nil }
        } message: {
            Text(tapInspection ?? "")
        }
    }

}

private extension View {
    /// Hide the tab bar this view is INSIDE of.
    ///
    /// `.toolbar(.hidden, for: .tabBar)` resolves against the enclosing tab
    /// bar, so hanging it off the TabView itself addresses an ancestor that
    /// doesn't exist and silently does nothing. iOS 26's own tab bar is a
    /// floating glass capsule, so the result wasn't a missing hide — it was
    /// the system capsule rendering behind the custom one, offset by a few
    /// points, carrying its own selection pill under whichever tab was
    /// active. It read as a deliberate double-layer style. It wasn't.
    func hidesSystemTabBar() -> some View {
        toolbar(.hidden, for: .tabBar)
    }
}

#Preview {
    RootView()
}
