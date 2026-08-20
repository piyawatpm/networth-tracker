import SwiftUI
import Charts

struct DashboardView: View {
    @Environment(DataStore.self) private var store
    /// True once the hero number has scrolled away — floats the live pill.
    @State private var scrolledPastHero = false
    /// Which distribution segment's members are being inspected.
    @State private var segmentDetail: SegmentDetail?

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
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
                    monthlyGrowthCard.entranceTransition()
                    assetBreakdownCard.entranceTransition().id("assets")
                    monthFlowCard.entranceTransition().id("flow")
                    if let goal = activeGoal { goalCard(goal).entranceTransition() }
                    if !upcoming.isEmpty { upcomingCard.entranceTransition().id("upcoming") }
                    recentActivityCard.entranceTransition().id("recent")
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 110)
            }
            // Screenshot runs can start at the bottom to capture cards that
            // sit below the fold.
            .defaultScrollAnchor(
                ProcessInfo.processInfo.environment["VESTA_SCROLL_BOTTOM"] != nil
                    ? .bottom : .top
            )
            // …or jump straight to one card by id, which the bottom anchor
            // can't reach on a page this long (VESTA_SCROLL_TO=assets).
            .task {
                guard let target = ProcessInfo.processInfo.environment["VESTA_SCROLL_TO"]
                else { return }
                try? await Task.sleep(for: .seconds(1))
                withAnimation { proxy.scrollTo(target, anchor: .top) }
            }
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top > 200
            } action: { _, scrolled in
                withAnimation(.snappy(duration: 0.25)) { scrolledPastHero = scrolled }
            }
            .overlay(alignment: .top) {
                // The number this whole app exists for, kept in sight while
                // the rest of the dashboard scrolls by — still live-ticking.
                if scrolledPastHero {
                    FloatingScopePill(
                        title: store.includeSuperStocks ? "Net Worth" : "Net Worth · ex-super",
                        total: store.format(store.netWorth),
                        tint: Ledger.income,
                        isFiltered: false
                    ) {}
                    .padding(.top, 4)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .sheet(item: $segmentDetail) { detail in
                SegmentDetailSheet(detail: detail)
                    .presentationDetents([.medium, .large])
            }
            .background(Ledger.background)
            .navigationTitle("Dashboard")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await store.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { SuperChip() }
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
            // Not a peer line: a replayed daily ledger, an order of magnitude
            // smaller, where "up" means the opposite of what it means for the
            // others. It gets its own step strip — see ChartOverlay.Form.
            ChartOverlay(
                name: "Debt", color: Ledger.seriesDebt,
                points: store.overlayDebt, form: .stepStrip
            ),
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

    // MARK: Monthly growth

    /// Month-over-month CHANGE, not the absolute level.
    ///
    /// The absolute version was a truncated-axis bar chart (bars starting near
    /// the minimum instead of zero) — bar length encodes magnitude, so that
    /// exaggerates small differences, and at ฿1.2M–1.7M every bar looked the
    /// same anyway. Change bars are zero-based and honest, and "how much did I
    /// gain in June" is the question actually being asked.
    private var monthlyGrowthCard: some View {
        let rows = store.monthlyGrowth.map {
            (label: $0.label, value: store.convert($0.deltaUsd, from: "USD"), partial: $0.partial)
        }
        let best = rows.filter { !$0.partial }.max { $0.value < $1.value }

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Monthly Growth").labelMono()
                Spacer()
                if let best {
                    Text("best \(best.label) \(store.format(best.value, compact: true))")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }

            if rows.count < 2 {
                Text("Needs two months of snapshots to compare.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Chart(Array(rows.enumerated()), id: \.offset) { _, row in
                    BarMark(
                        x: .value("Month", row.label),
                        y: .value("Change", row.value)
                    )
                    .cornerRadius(5)
                    .foregroundStyle(
                        row.value >= 0
                            ? Ledger.income.opacity(row.partial ? 0.45 : 1)
                            : Ledger.expense.opacity(row.partial ? 0.45 : 1)
                    )
                    .annotation(position: row.value >= 0 ? .top : .bottom, spacing: 3) {
                        Text(Money.format(row.value, currency: store.displayCurrency, compact: true))
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                .chartXScale(domain: rows.map(\.label))
                .chartYAxis(.hidden)
                .chartXAxis {
                    AxisMarks { _ in
                        AxisValueLabel()
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(height: 160)

                Text("change per month · faded bar is this month so far")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(16)
        .financeCard()
    }

    // MARK: Financial freedom

    /// What share of the last 30 days' spending was already covered by income
    /// that doesn't require showing up: dividends, yield, interest, rent and
    /// realized gains.
    private var freedomCard: some View {
        let f = store.freedom
        let pct = min(1.0, max(0, f.coverage))

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Passive Coverage").labelMono()
                Spacer()
                Text("\(Int(f.coverage * 100))%")
                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                    .foregroundStyle(f.coverage >= 1 ? Ledger.income : .primary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.07))
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [Ledger.income.opacity(0.65), Ledger.income],
                                startPoint: .leading, endPoint: .trailing
                            )
                        )
                        .frame(width: max(4, geo.size.width * pct))
                        .animation(.spring(duration: 0.7), value: pct)
                }
            }
            .frame(height: 8)
            Text("\(store.format(f.passive, compact: true)) passive vs \(store.format(f.expenses, compact: true)) spent · last 30 days")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .financeCard()
    }

    // MARK: Goal

    /// When the goal lands under the compound forecast — the same walk the
    /// Forecast page draws, so card and page never name different dates.
    /// (Replaced a trailing-90-day straight line, which ignored compounding
    /// and read a hot quarter as a permanent slope.) Silent when the path
    /// never gets there — a "never" ETA is noise on a dashboard.
    private func goalETA(target: Double) -> String? {
        guard let months = ForecastMath.monthsToReach(store.forecastInputs, target: target),
              months > 0 else { return nil }
        return "\(ForecastMath.monthYear(ForecastMath.addMonths(months))) · \(ForecastMath.describe(months: months)) at this pace"
    }


    private var activeGoal: NetworthGoal? {
        store.forecastGoal
    }

    private func goalCard(_ goal: NetworthGoal) -> some View {
        let target = store.convert(goal.amount, from: goal.currency)
        let progress = target > 0 ? min(1, max(0, store.netWorth / target)) : 0

        return NavigationLink {
            ForecastView()
        } label: {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(goal.name.isEmpty ? "Goal" : goal.name).labelMono()
                Spacer()
                Text("\(Int(progress * 100))%")
                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                    .foregroundStyle(Ledger.income)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tertiary)
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
            if let eta = goalETA(target: target) {
                HStack(spacing: 4) {
                    Image(systemName: "flag.checkered").font(.system(size: 9))
                    Text(eta)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                }
                .foregroundStyle(Ledger.income)
            }
        }
        .padding(16)
        .financeCard()
        }
        .buttonStyle(.plain)
    }

    // MARK: Assets

    private var assetBreakdownCard: some View {
        // The web's Asset Distribution: Traditional / Super / Crypto shares
        // of everything owned — toggle-independent, because the split itself
        // is the point.
        let traditional = store.holdings
            .filter { $0.accountType != "super" }
            .reduce(0) { $0 + store.convert(store.holdingLiveValue($1), from: $1.currency) }
        let superTotal = store.holdings
            .filter { $0.accountType == "super" }
            .reduce(0) { $0 + store.convert(store.holdingLiveValue($1), from: $1.currency) }
        let crypto = store.cryptoValue
        let portfolioTotal = traditional + superTotal + crypto
        let segments: [(String, Double, Color)] = [
            ("Traditional", traditional, Ledger.seriesStocks),
            ("Crypto", crypto, Ledger.seriesCrypto),
            ("Super", superTotal, Ledger.chartColor(1)),
        ]
        let cash = store.dryPowder
        let cashPct = portfolioTotal > 0 ? cash / portfolioTotal * 100 : 0

        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Asset Distribution").labelMono()
                Text(store.format(portfolioTotal))
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.4), value: portfolioTotal)
                Text("everything you own · debts excluded")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }

            // One stacked bar — the three shares at a glance.
            if portfolioTotal > 0 {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        ForEach(segments, id: \.0) { seg in
                            Capsule().fill(seg.2)
                                .frame(width: max(3, (geo.size.width - 4) * seg.1 / portfolioTotal))
                        }
                    }
                    .animation(.spring(duration: 0.7), value: portfolioTotal)
                }
                .frame(height: 6)
            }

            ForEach(segments, id: \.0) { seg in
                Button {
                    segmentDetail = segmentMembers(seg.0, tint: seg.2)
                } label: {
                    HStack {
                        Circle().fill(seg.2).frame(width: 8, height: 8)
                        Text(seg.0).font(.subheadline)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(.tertiary)
                        Spacer()
                        Text(store.format(seg.1))
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Text(String(format: "%.1f%%", portfolioTotal > 0 ? seg.1 / portfolioTotal * 100 : 0))
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .frame(width: 46, alignment: .trailing)
                    }
                }
                .buttonStyle(.plain)
            }

            // Deployable cash across the whole portfolio — the web's Dry
            // Powder (cash-TAGGED crypto; BTC is on the user's list, CASHH
            // deliberately off it).
            Divider().opacity(0.5)
            Button {
                segmentDetail = segmentMembers("Cash", tint: Ledger.income)
            } label: {
                HStack {
                    Image(systemName: "banknote")
                        .font(.system(size: 11))
                        .foregroundStyle(Ledger.income)
                    Text("Cash · dry powder").font(.subheadline)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.tertiary)
                    Spacer()
                    Text(store.format(cash))
                        .font(.system(.footnote, design: .monospaced, weight: .semibold))
                    Text(String(format: "%.1f%%", cashPct))
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Ledger.income)
                        .frame(width: 46, alignment: .trailing)
                }
            }
            .buttonStyle(.plain)
            HStack {
                Text("Debts (net)").font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(store.format(store.debtNet))
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            // The reconciliation, so the two headline numbers never look like
            // they disagree: portfolio − what you owe = net worth.
            Divider().opacity(0.5)
            HStack {
                Text("Net worth").font(.subheadline.weight(.medium))
                Spacer()
                Text(store.format(store.netWorth))
                    .font(.system(.footnote, design: .monospaced, weight: .semibold))
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


// MARK: - Distribution detail

/// One distribution segment, opened as a modal: every member with its value
/// and share of the segment.
struct SegmentDetail: Identifiable {
    let title: String
    let tint: Color
    let rows: [(name: String, sub: String?, value: Double)]
    var id: String { title }
    var total: Double { rows.reduce(0) { $0 + $1.value } }
}

extension DashboardView {
    /// Members of a distribution segment, display currency, biggest first.
    func segmentMembers(_ segment: String, tint: Color) -> SegmentDetail {
        var rows: [(String, String?, Double)] = []
        switch segment {
        case "Traditional":
            rows = store.holdings
                .filter { $0.accountType != "super" }
                .map { (
                    $0.ticker.isEmpty ? $0.name : $0.ticker,
                    $0.ticker.isEmpty ? ($0.broker.isEmpty ? nil : $0.broker) : $0.name,
                    store.convert(store.holdingLiveValue($0), from: $0.currency)
                ) }
        case "Super":
            rows = store.holdings
                .filter { $0.accountType == "super" }
                .map { (
                    $0.ticker.isEmpty ? $0.name : $0.ticker,
                    $0.name,
                    store.convert(store.holdingLiveValue($0), from: $0.currency)
                ) }
        case "Crypto":
            rows = store.cryptoDisplayRows.map { (
                $0.token,
                $0.isCash ? "cash" : nil,
                store.convert($0.valueUsd, from: "USD")
            ) }
        case "Cash":
            // The dry-powder roster: cash-TAGGED crypto (the user's list,
            // BTC included) + any holding flagged cash/savings.
            rows = store.cryptoCsvHoldings
                .filter { store.cryptoCashTags[$0.token] == true }
                .map { ($0.token, "crypto", store.convert(store.csvHoldingValueUsd($0), from: "USD")) }
            rows += store.holdings
                .filter { $0.isCash == true || $0.type == "savings" }
                .map { ($0.name, $0.broker.isEmpty ? "account" : $0.broker,
                        store.convert(store.holdingLiveValue($0), from: $0.currency)) }
        default: break
        }
        return SegmentDetail(
            title: segment,
            tint: tint,
            rows: rows.filter { $0.2 > 0.005 }.sorted { $0.2 > $1.2 }
        )
    }
}

struct SegmentDetailSheet: View {
    @Environment(DataStore.self) private var store
    let detail: SegmentDetail

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Circle().fill(detail.tint).frame(width: 9, height: 9)
                        Text(store.format(detail.total))
                            .font(.system(.title3, design: .rounded, weight: .bold))
                            .monospacedDigit()
                        Spacer()
                        Text("\(detail.rows.count) position\(detail.rows.count == 1 ? "" : "s")")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }
                Section {
                    ForEach(Array(detail.rows.enumerated()), id: \.offset) { _, row in
                        VStack(spacing: 5) {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(row.name).font(.subheadline.weight(.medium))
                                    if let sub = row.sub, sub != row.name {
                                        Text(sub).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                                Spacer()
                                Text(store.format(row.value, compact: true))
                                    .font(.system(.footnote, design: .monospaced, weight: .semibold))
                                Text(String(format: "%.1f%%", detail.total > 0 ? row.value / detail.total * 100 : 0))
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                                    .frame(width: 44, alignment: .trailing)
                            }
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(.primary.opacity(0.06))
                                    Capsule().fill(detail.tint.opacity(0.85))
                                        .frame(width: max(2, geo.size.width * (detail.total > 0 ? row.value / detail.total : 0)))
                                }
                            }
                            .frame(height: 4)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Ledger.background)
            .navigationTitle("\(detail.title) allocation")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
