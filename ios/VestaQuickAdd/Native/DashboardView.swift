import SwiftUI
import Charts

struct DashboardView: View {
    @Environment(DataStore.self) private var store

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    HistoryChartCard(
                        title: "Net Worth",
                        parsed: store.networthParsed,
                        liveValue: store.netWorth,
                        heroSize: 40,
                        showUpdatedStamp: true
                    )
                    .entranceTransition()
                    if let goal = activeGoal { goalCard(goal).entranceTransition() }
                    assetBreakdownCard.entranceTransition()
                    monthFlowCard.entranceTransition()
                    if !upcoming.isEmpty { upcomingCard.entranceTransition() }
                    recentActivityCard.entranceTransition()
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 110)
            }
            .background(Ledger.background)
            .navigationTitle("Dashboard")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await store.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // One tap = next currency, exactly like the web's FX
                    // toggle (same cycle order). Syncs through
                    // preferred_currency, so the web app follows.
                    Button {
                        let cycle = ["AUD", "USD", "THB"]
                        let index = cycle.firstIndex(of: store.displayCurrency) ?? 2
                        withAnimation(.spring(duration: 0.5)) {
                            store.setDisplayCurrency(cycle[(index + 1) % cycle.count])
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text("FX")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Text("\(Money.symbol(store.displayCurrency)) \(store.displayCurrency)")
                                .font(.system(.caption, design: .monospaced, weight: .semibold))
                                .contentTransition(.numericText())
                                .foregroundStyle(.primary)
                        }
                    }
                    // .plain, NOT .glass — the glass style's pressed state
                    // paints an opaque white square behind the text.
                    .buttonStyle(.plain)
                    .sensoryFeedback(.impact(weight: .light), trigger: store.displayCurrency)
                }
            }
        }
    }

    // MARK: Goal

    private var activeGoal: NetworthGoal? {
        store.goals.filter { $0.achievedAt == nil }.max { $0.setAt < $1.setAt }
    }

    private func goalCard(_ goal: NetworthGoal) -> some View {
        let target = store.convert(goal.amount, from: goal.currency)
        let progress = target > 0 ? min(1, max(0, store.netWorth / target)) : 0

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(goal.name.isEmpty ? "Goal" : goal.name).labelMono()
                Spacer()
                Text("\(Int(progress * 100))%")
                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                    .foregroundStyle(Ledger.income)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.primary.opacity(0.07))
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [Ledger.income.opacity(0.7), Ledger.income],
                                startPoint: .leading, endPoint: .trailing
                            )
                        )
                        .frame(width: max(6, geo.size.width * progress))
                        .animation(.spring(duration: 0.8), value: progress)
                }
            }
            .frame(height: 8)
            Text("\(store.format(store.netWorth, compact: true)) of \(store.format(target, compact: true)) — \(store.format(max(0, target - store.netWorth), compact: true)) to go")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .financeCard()
    }

    // MARK: Assets

    private var assetBreakdownCard: some View {
        let rows: [(String, Double, Color)] = [
            ("Stocks & Funds", store.stocksValue, Ledger.chartColor(0)),
            ("Crypto", store.cryptoValue, Ledger.chartColor(12)),
            ("Debts (net)", store.debtNet, store.debtNet >= 0 ? Ledger.income : Ledger.expense),
        ]
        let total = max(1, rows.reduce(0) { $0 + abs($1.1) })

        return VStack(alignment: .leading, spacing: 12) {
            Text("Assets").labelMono()
            ForEach(rows, id: \.0) { row in
                VStack(spacing: 5) {
                    HStack {
                        Circle().fill(row.2).frame(width: 8, height: 8)
                        Text(row.0).font(.subheadline)
                        Spacer()
                        Text(store.format(row.1))
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    GeometryReader { geo in
                        Capsule()
                            .fill(row.2.opacity(0.85))
                            .frame(width: max(3, geo.size.width * abs(row.1) / total))
                            .animation(.spring(duration: 0.7), value: row.1)
                    }
                    .frame(height: 5)
                    .background(Capsule().fill(.primary.opacity(0.06)))
                }
            }
        }
        .padding(16)
        .financeCard()
    }

    // MARK: This month flow

    private var monthFlowCard: some View {
        let month = SydneyTime.currentMonthKey()
        let earned = store.monthTotal(store.allIncome, month: month)
        let spent = store.monthTotalExpenses(month: month)

        return HStack(spacing: 0) {
            flowTile("Income", earned, Ledger.income)
            Divider().padding(.vertical, 8)
            flowTile("Expenses", spent, Ledger.expense)
            Divider().padding(.vertical, 8)
            flowTile("Saved", earned - spent, earned - spent >= 0 ? Ledger.income : Ledger.expense)
        }
        .padding(.vertical, 14)
        .financeCard()
    }

    private func flowTile(_ label: String, _ value: Double, _ tint: Color) -> some View {
        VStack(spacing: 4) {
            Text(label).labelMono()
            Text(store.format(value, compact: true))
                .font(.system(.body, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .contentTransition(.numericText(value: value))
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Upcoming recurring

    private struct Upcoming: Identifiable {
        let id: String
        let label: String
        let amount: Double
        let currency: String
        let date: String
        let isIncome: Bool
    }

    private var upcoming: [Upcoming] {
        let today = SydneyTime.today()
        var items: [Upcoming] = []
        for template in store.recurringIncome {
            if let next = template.nextOccurrence(onOrAfter: today) {
                items.append(Upcoming(
                    id: "in-\(template.id)", label: template.description,
                    amount: template.amount, currency: template.currency,
                    date: next, isIncome: true
                ))
            }
        }
        for template in store.recurringExpenses {
            if let next = template.nextOccurrence(onOrAfter: today) {
                items.append(Upcoming(
                    id: "ex-\(template.id)", label: template.description,
                    amount: -template.amount, currency: template.currency,
                    date: next, isIncome: false
                ))
            }
        }
        return Array(items.sorted { $0.date < $1.date }.prefix(4))
    }

    private var upcomingCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Upcoming").labelMono()
            ForEach(upcoming) { item in
                HStack {
                    Image(systemName: "calendar")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.label).font(.subheadline).lineLimit(1)
                        Text(SydneyTime.shortLabel(item.date))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(Money.format(item.amount, currency: item.currency))
                        .font(.system(.footnote, design: .monospaced, weight: .medium))
                        .foregroundStyle(item.isIncome ? Ledger.income : Ledger.expense)
                }
            }
        }
        .padding(16)
        .financeCard()
    }

    // MARK: Recent activity

    private struct ActivityItem: Identifiable {
        let id: String
        let label: String
        let amount: Double
        let currency: String
        let date: String
        let isIncome: Bool
    }

    private var recentActivity: [ActivityItem] {
        var items: [ActivityItem] = []
        for entry in store.allIncome {
            let label = entry.description.isEmpty ? store.incomeLabel(entry.type) : entry.description
            items.append(ActivityItem(
                id: entry.id, label: label, amount: entry.amount,
                currency: entry.currency, date: entry.date, isIncome: true
            ))
        }
        for entry in store.expenses {
            let label = entry.description.isEmpty ? store.expenseLabel(entry.type) : entry.description
            items.append(ActivityItem(
                id: entry.id, label: label, amount: -entry.amount,
                currency: entry.currency, date: entry.date, isIncome: false
            ))
        }
        items.sort { $0.date > $1.date }
        return Array(items.prefix(6))
    }

    private var recentActivityCard: some View {
        let recent = recentActivity
        return VStack(alignment: .leading, spacing: 10) {
            Text("Recent").labelMono()
            if recent.isEmpty {
                Text("No activity yet.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(recent) { item in
                HStack {
                    Image(systemName: item.isIncome ? "arrow.down.left.circle.fill" : "arrow.up.right.circle.fill")
                        .foregroundStyle(item.isIncome ? Ledger.income : Ledger.expense)
                        .font(.title3)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.label).font(.subheadline).lineLimit(1)
                        Text(SydneyTime.shortLabel(item.date))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(Money.format(item.amount, currency: item.currency))
                        .font(.system(.footnote, design: .monospaced, weight: .medium))
                        .foregroundStyle(item.amount >= 0 ? Ledger.income : Ledger.expense)
                }
            }
        }
        .padding(16)
        .financeCard()
    }
}
