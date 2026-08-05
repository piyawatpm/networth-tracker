import SwiftUI
import Charts

struct DashboardView: View {
    @Environment(DataStore.self) private var store

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    HistoryChartCard(
                        title: store.includeSuperStocks ? "Net Worth" : "Net Worth · ex-super",
                        parsed: store.includeSuperStocks
                            ? store.networthParsed : store.networthParsedNoSuper,
                        liveValue: store.netWorth,
                        heroSize: 40,
                        showUpdatedStamp: true,
                        overlays: componentOverlays
                    )
                    .id(store.includeSuperStocks)
                    .entranceTransition()
                    superToggleCard.entranceTransition()
                    monthStartCard.entranceTransition()
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
                ToolbarItem(placement: .topBarTrailing) { FxChip() }
            }
        }
    }

    // MARK: Net-worth components

    /// Every factor of net worth as an overlay line: stocks (super-adjusted
    /// per the toggle), crypto, and the replayed signed debt.
    private var componentOverlays: [ChartOverlay] {
        let superOn = store.includeSuperStocks
        let stocks = store.overlayPortfolio.map { point -> (date: Date, valueUsd: Double) in
            guard !superOn, let delta = store.overlaySuperDelta[point.date] else { return point }
            return (point.date, max(0, point.valueUsd - delta))
        }
        // Categorical slots 1-3, validated all-pairs for CVD on the dark
        // surface (scripts/validate_palette.js). NOT the volt/pink pair —
        // those are reserved for polarity (gain/loss) everywhere else, and
        // the old pink debt line was ΔE 2.1 from crypto under protanopia.
        return [
            ChartOverlay(name: "Stocks", color: Ledger.seriesStocks, points: stocks),
            ChartOverlay(name: "Crypto", color: Ledger.seriesCrypto, points: store.overlayCrypto),
            ChartOverlay(name: "Debt", color: Ledger.seriesDebt, points: store.overlayDebt),
        ]
    }

    private var superToggleCard: some View {
        @Bindable var store = store
        return HStack {
            Text("Include super").font(.subheadline)
            Spacer()
            Toggle("", isOn: $store.includeSuperStocks.animation(.spring(duration: 0.4)))
                .labelsHidden()
                .tint(Ledger.income)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .financeCard()
    }

    // MARK: Month starts

    /// Net worth at the OPEN of each month + now — the trend at a glance.
    private var monthStartCard: some View {
        let rows = store.monthStartNetWorth
        let converted = rows.map { (label: $0.label, value: store.convert($0.valueUsd, from: "USD"), isNow: $0.isNow) }
        let lastDelta: Double? = converted.count >= 2
            ? converted[converted.count - 1].value - converted[converted.count - 2].value
            : nil

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Month Starts").labelMono()
                Spacer()
                if let lastDelta {
                    Text("\(lastDelta >= 0 ? "+" : "")\(store.format(lastDelta, compact: true)) this month")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(lastDelta >= 0 ? Ledger.income : Ledger.expense)
                }
            }
            if converted.count < 2 {
                Text("Needs a month of snapshots to compare.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Chart(Array(converted.enumerated()), id: \.offset) { _, row in
                    BarMark(
                        x: .value("Month", row.label),
                        y: .value("Net Worth", row.value)
                    )
                    .cornerRadius(6)
                    .foregroundStyle(row.isNow ? Ledger.income : Ledger.income.opacity(0.35))
                    .annotation(position: .top, spacing: 2) {
                        Text(Money.format(row.value, currency: store.displayCurrency, compact: true))
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                .chartXScale(domain: converted.map(\.label))
                .chartYAxis(.hidden)
                .chartYScale(domain: (converted.map(\.value).min() ?? 0) * 0.94...(converted.map(\.value).max() ?? 1) * 1.1)
                .chartXAxis {
                    AxisMarks { _ in
                        AxisValueLabel()
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(height: 150)
            }
        }
        .padding(16)
        .financeCard()
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
