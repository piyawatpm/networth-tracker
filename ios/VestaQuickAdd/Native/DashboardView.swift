import SwiftUI
import Charts

struct DashboardView: View {
    @Environment(DataStore.self) private var store
    /// True once the hero number has scrolled away — floats the live pill.
    @State private var scrolledPastHero = false
    /// Which distribution segment's members are being inspected.
    @State private var segmentDetail: SegmentDetail?
    /// Touched month in the growth chart.
    @State private var growthSelection: String?
    /// Which growth components are drawn — either alone, or both stacked.
    @State private var growthShowMoney = true
    @State private var growthShowMarket = true

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
    /// One month of net-worth growth, split the way the perf page splits it:
    /// what was DEPOSITED (income − expenses, the ledgers) vs what the assets
    /// DID (Δ net worth minus those deposits).
    private struct GrowthSplit: Identifiable {
        let key: String
        let label: String
        let delta: Double
        let deposits: Double?   // nil = ledgers incomplete, no honest split
        let partial: Bool
        var market: Double? { deposits.map { delta - $0 } }
        var id: String { key }
    }

    private var growthSplits: [GrowthSplit] {
        store.monthlyGrowth.map { row in
            let earned = store.monthTotal(store.allIncome, month: row.key)
            let spent = store.monthTotalExpenses(month: row.key)
            // A month with income but no logged expenses predates expense
            // tracking — a split there would paint the untracked spending as
            // "market loss". Those months stay total-only.
            let deposits: Double? = (earned > 0 && spent > 0) ? earned - spent : nil
            return GrowthSplit(
                key: row.key, label: row.label,
                delta: store.convert(row.deltaUsd, from: "USD"),
                deposits: deposits, partial: row.partial
            )
        }
    }

    private var monthlyGrowthCard: some View {
        let splits = growthSplits
        let selected = splits.first { $0.label == growthSelection }
            ?? splits.last

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Monthly Growth").labelMono()
                Spacer()
                HStack(spacing: 6) {
                    // Tappable: show one component alone, or both stacked.
                    growthToggle("new money", Ledger.seriesStocks, on: growthShowMoney) {
                        if growthShowMoney && !growthShowMarket { growthShowMarket = true }
                        growthShowMoney.toggle()
                    }
                    growthToggle("market", Ledger.income, on: growthShowMarket) {
                        if growthShowMarket && !growthShowMoney { growthShowMoney = true }
                        growthShowMarket.toggle()
                    }
                }
            }

            // Readout: the touched month (else the latest), decomposed.
            Group {
                if let sel = selected {
                    if let deposits = sel.deposits, let market = sel.market {
                        Text("\(sel.label)\(sel.partial ? " so far" : "") · \(store.format(deposits, compact: true)) in · \(market >= 0 ? "+" : "")\(store.format(market, compact: true)) market · = \(sel.delta >= 0 ? "+" : "")\(store.format(sel.delta, compact: true))")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.secondary)
                    } else {
                        Text("\(sel.label) · \(sel.delta >= 0 ? "+" : "")\(store.format(sel.delta, compact: true)) — expenses untracked, no split")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .frame(minHeight: 13, alignment: .leading)

            if splits.count < 2 {
                Text("Needs two months of snapshots to compare.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Chart(splits) { split in
                    if let deposits = split.deposits, let market = split.market {
                        // One component alone, or both stacked (negatives
                        // hang below zero, so a pink market bar under a blue
                        // deposits bar reads as exactly what happened).
                        if growthShowMoney {
                            BarMark(
                                x: .value("Month", split.label),
                                y: .value("New money", deposits)
                            )
                            .cornerRadius(3)
                            .foregroundStyle(Ledger.seriesStocks.opacity(split.partial ? 0.5 : 0.95))
                        }
                        if growthShowMarket {
                            BarMark(
                                x: .value("Month", split.label),
                                y: .value("Market", market)
                            )
                            .cornerRadius(3)
                            .foregroundStyle(
                                (market >= 0 ? Ledger.income : Ledger.expense)
                                    .opacity(split.partial ? 0.5 : 0.95)
                            )
                        }
                    } else {
                        BarMark(
                            x: .value("Month", split.label),
                            y: .value("Change", split.delta)
                        )
                        .cornerRadius(5)
                        .foregroundStyle(
                            (split.delta >= 0 ? Ledger.income : Ledger.expense)
                                .opacity(split.partial ? 0.45 : 0.55)
                        )
                    }
                }
                .chartXSelection(value: $growthSelection)
                .chartXScale(domain: splits.map(\.label))
                .chartYAxis(.hidden)
                .chartXAxis {
                    AxisMarks { _ in
                        AxisValueLabel()
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(height: 160)

                Text("net-worth change per month · tap a legend chip to isolate one component · touch a bar for numbers · faded = this month so far")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(16)
        .financeCard()
    }

    private func growthToggle(
        _ label: String, _ color: Color, on: Bool, action: @escaping () -> Void
    ) -> some View {
        Button {
            withAnimation(.snappy(duration: 0.25)) { action() }
        } label: {
            HStack(spacing: 4) {
                Circle().fill(on ? color : Color.secondary.opacity(0.4))
                    .frame(width: 6, height: 6)
                Text(label)
                    .font(.system(size: 9, weight: on ? .semibold : .regular, design: .monospaced))
                    .foregroundStyle(on ? .secondary : .tertiary)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(on ? color.opacity(0.14) : Color.primary.opacity(0.04), in: .capsule)
        }
        .buttonStyle(.plain)
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
        // The web's Asset Distribution — and it follows the super toggle:
        // super OFF drops the Super segment AND any super-held cash, so
        // every number on screen describes the same pot.
        let includeSuper = store.includeSuperStocks
        let traditional = store.holdings
            .filter { $0.accountType != "super" }
            .reduce(0) { $0 + store.convert(store.holdingLiveValue($1), from: $1.currency) }
        let superTotal = store.holdings
            .filter { $0.accountType == "super" }
            .reduce(0) { $0 + store.convert(store.holdingLiveValue($1), from: $1.currency) }
        let crypto = store.cryptoValue
        var segments: [(String, Double, Color)] = [
            ("Traditional", traditional, Ledger.seriesStocks),
            ("Crypto", crypto, Ledger.seriesCrypto),
        ]
        if includeSuper { segments.append(("Super", superTotal, Ledger.chartColor(1))) }
        let portfolioTotal = segments.reduce(0) { $0 + $1.1 }
        let cash = store.dryPowder(includeSuper: includeSuper)
        let cashPct = portfolioTotal > 0 ? cash / portfolioTotal * 100 : 0

        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text("Asset Distribution").labelMono()
                    if !includeSuper {
                        Text("ex-super")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
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
            // BTC included) + any holding flagged cash/savings — super-held
            // cash only while the toggle includes super.
            rows = store.cryptoCsvHoldings
                .filter { store.cryptoCashTags[$0.token] == true }
                .map { ($0.token, "crypto", store.convert(store.csvHoldingValueUsd($0), from: "USD")) }
            rows += store.holdings
                .filter { ($0.isCash == true || $0.type == "savings")
                    && (store.includeSuperStocks || $0.accountType != "super") }
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
    @State private var editingCash = false

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
            .toolbar {
                if detail.title == "Cash" {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Edit") { editingCash = true }
                    }
                }
            }
            .sheet(isPresented: $editingCash) { CashPickerSheet() }
        }
    }
}

/// "Which of my assets count as cash?" — every crypto token and holding,
/// each with a checkmark. Tokens write crypto_cash_tags (the same blob the
/// web's Cash dialog edits); holdings flip their isCash flag.
struct CashPickerSheet: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private struct PickRow: Identifiable {
        let id: String
        let name: String
        let value: String
        let on: Bool
        let locked: Bool
        let toggle: () -> Void
    }

    private var tokenRows: [PickRow] {
        store.cryptoCsvHoldings
            .sorted { store.csvHoldingValueUsd($0) > store.csvHoldingValueUsd($1) }
            .map { holding in
                let on = store.cryptoCashTags[holding.token] == true
                let value = store.convert(store.csvHoldingValueUsd(holding), from: "USD")
                return PickRow(
                    id: "t-" + holding.token,
                    name: holding.token,
                    value: store.format(value, compact: true),
                    on: on,
                    locked: false
                ) { Task { await store.setCryptoCash(holding.token, !on) } }
            }
    }

    private var holdingRows: [PickRow] {
        store.holdings.map { holding in
            let flagged = holding.isCash == true
            let value = store.convert(store.holdingLiveValue(holding), from: holding.currency)
            return PickRow(
                id: "h-" + holding.id,
                name: holding.ticker.isEmpty ? holding.name : holding.ticker,
                value: store.format(value, compact: true),
                on: flagged || holding.type == "savings",
                locked: holding.type == "savings" // savings ARE cash
            ) { Task { await store.setHoldingCash(holding.id, !flagged) } }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Crypto tokens") {
                    ForEach(tokenRows) { row in
                        Button(action: row.toggle) {
                            cashRow(row.name, row.value, on: row.on)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Section {
                    ForEach(holdingRows) { row in
                        Button(action: row.toggle) {
                            cashRow(row.name, row.value, on: row.on)
                        }
                        .buttonStyle(.plain)
                        .disabled(row.locked)
                    }
                } header: {
                    Text("Holdings")
                } footer: {
                    Text("Synced with the web's Cash tags. Savings-type accounts always count.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Ledger.background)
            .navigationTitle("What counts as cash")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func cashRow(_ name: String, _ value: String, on: Bool) -> some View {
        HStack {
            Text(name).font(.subheadline.weight(.medium))
            Spacer()
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(on ? Ledger.income : Color.secondary)
        }
    }
}
