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
    }
}

struct MainTabView: View {
    @Environment(DataStore.self) private var store
    @State private var selection = 0

    private static let tabs = [
        VestaTab(id: 0, title: "Home", icon: "square.grid.2x2"),
        VestaTab(id: 1, title: "Income", icon: "arrow.down.left.circle"),
        VestaTab(id: 2, title: "Spend", icon: "arrow.up.right.circle"),
        VestaTab(id: 3, title: "Invest", icon: "chart.line.uptrend.xyaxis"),
        VestaTab(id: 4, title: "More", icon: "ellipsis.circle"),
    ]

    var body: some View {
        // All five stay mounted so scroll positions and drill-ins survive tab
        // hops. Tabs are laid out side by side and SLIDE with the selection —
        // a directional pager, not a cross-fade, so two screens never ghost
        // over each other. Scrubbing the bar drags the whole strip along.
        GeometryReader { geo in
            ZStack {
                tabContent(DashboardView(), index: 0, width: geo.size.width)
                tabContent(IncomeView(), index: 1, width: geo.size.width)
                tabContent(ExpensesView(), index: 2, width: geo.size.width)
                tabContent(InvestView(), index: 3, width: geo.size.width)
                tabContent(MoreView(), index: 4, width: geo.size.width)
            }
        }
        .safeAreaInset(edge: .bottom) {
            VestaTabBar(tabs: Self.tabs, selection: $selection)
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
    }

    @ViewBuilder
    private func tabContent(_ view: some View, index: Int, width: CGFloat) -> some View {
        view
            .offset(x: CGFloat(index - selection) * width)
            .allowsHitTesting(selection == index)
            .animation(.snappy(duration: 0.32, extraBounce: 0.02), value: selection)
    }
}

#Preview {
    RootView()
}
