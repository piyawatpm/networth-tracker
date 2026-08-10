import SwiftUI
import Charts

struct ExpensesView: View {
    @Environment(DataStore.self) private var store
    @State private var showAdd = false
    @State private var editing: ExpenseEntry?
    @State private var search = ""
    /// Which month the record list shows; nil = every record.
    @State private var scope: String? = SydneyTime.currentMonthKey()
    /// Tapping a category in the breakdown narrows the record list to it.
    @State private var categoryFilter: String?

    private var month: String { SydneyTime.currentMonthKey() }

    /// Everything the summary/insight cards describe — the month chosen with
    /// the chips, not always the calendar month. "All" means all of it.
    private var monthExpenses: [ExpenseEntry] {
        guard let scope else { return store.expenses }
        return store.expenses.filter { SydneyTime.monthKey($0.date) == scope }
    }

    private var isCurrentMonth: Bool { scope == month }

    /// Heading for the scoped total.
    private var scopeTitle: String {
        guard let scope else { return "All time" }
        return isCurrentMonth ? "Spent this month" : "Spent in \(FlowMath.label(scope))"
    }

    private var scopedTotal: Double {
        monthExpenses.reduce(0) { $0 + store.convert($1.amount, from: $1.currency) }
    }

    /// Category totals for the scoped window, for the stacked trend.
    private var categoryRows: [(date: String, category: String, value: Double)] {
        store.expenses.map {
            ($0.date, store.expenseLabel($0.type), store.convert($0.amount, from: $0.currency))
        }
    }

    private var byCategory: [(type: String, label: String, value: Double, color: Color)] {
        var map: [String: Double] = [:]
        for entry in monthExpenses {
            map[entry.type, default: 0] += store.convert(entry.amount, from: entry.currency)
        }
        return map
            .filter { $0.value > 0 }
            .map { (type: $0.key, label: store.expenseLabel($0.key), value: $0.value, color: store.expenseColor($0.key)) }
            .sorted { $0.value > $1.value }
    }

    /// Dates + display-currency values, shared by the trend and pace math.
    private var convertedRows: [(date: String, value: Double)] {
        store.expenses.map { ($0.date, store.convert($0.amount, from: $0.currency)) }
    }

    /// Where the money actually went this month — vendor names now flow in
    /// from the Apple Pay quick-add, so the page can finally answer this.
    private var topVendors: [(name: String, total: Double)] {
        var byVendor: [String: (name: String, total: Double)] = [:]
        for entry in monthExpenses {
            let trimmed = entry.vendor.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }
            let key = trimmed.lowercased()
            let value = store.convert(entry.amount, from: entry.currency)
            byVendor[key] = (byVendor[key]?.name ?? trimmed, (byVendor[key]?.total ?? 0) + value)
        }
        return byVendor.values.sorted { $0.total > $1.total }.prefix(3).map { $0 }
    }

    /// Records for the list: scoped to the chosen month, newest first.
    ///
    /// Searching deliberately ignores the scope — "where did I buy that" is
    /// an all-time question, and silently hiding matches in other months
    /// would make the search look broken.
    private var listEntries: [ExpenseEntry] {
        let base = search.isEmpty
            ? store.expenses.filter { scope == nil || SydneyTime.monthKey($0.date) == scope }
            : store.expenses
        let filtered = categoryFilter == nil
            ? base : base.filter { $0.type == categoryFilter }
        let sorted = filtered.sorted {
            $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt
        }
        guard !search.isEmpty else { return sorted }
        return sorted.filter {
            FlowMath.matches(
                query: search,
                fields: [$0.description, $0.vendor, store.expenseLabel($0.type), $0.notes],
                date: $0.date
            )
        }
    }

    /// Calendar opportunities per weekday inside the scoped window — the
    /// denominator behind the per-weekday average.
    private var weekdayOccurrences: [Int] {
        let today = SydneyTime.today()
        guard let scope else {
            let earliest = store.expenses.map(\.date).min().map { String($0.prefix(10)) }
            return FlowMath.weekdayOccurrences(from: earliest ?? today, to: today)
        }
        let end = min(FlowMath.lastDay(ofMonth: scope), today)
        return FlowMath.weekdayOccurrences(from: scope + "-01", to: end)
    }

    private var dayGroups: [DayGroup<ExpenseEntry>] {
        FlowMath.groupByDay(
            listEntries,
            date: { $0.date },
            value: { store.convert($0.amount, from: $0.currency) }
        )
    }

    /// Spend per weekday this month, index 0 = Sunday.
    private var weekdayTotals: [Double] {
        var totals = [Double](repeating: 0, count: 7)
        for entry in monthExpenses {
            guard let index = SnapshotDate.weekdayIndex(entry.date) else { continue }
            totals[index] += store.convert(entry.amount, from: entry.currency)
        }
        return totals
    }

    /// Plain-language findings. Each one is suppressed unless the data
    /// actually supports it — a made-up insight is worse than none.
    private var insights: [Insight] {
        var out: [Insight] = []
        let rows = convertedRows

        // Which category moved most against its own 3-month baseline.
        let baseline = FlowMath.monthKeys(back: 4).dropLast() // 3 complete months
        var priorByType: [String: Double] = [:]
        for entry in store.expenses where baseline.contains(SydneyTime.monthKey(entry.date)) {
            priorByType[entry.type, default: 0] += store.convert(entry.amount, from: entry.currency)
        }
        let movers = byCategory.compactMap { row -> (String, Double)? in
            let average = (priorByType[row.type] ?? 0) / 3
            guard average > 1 else { return nil }
            return (row.label, (row.value - average) / average * 100)
        }
        if let top = movers.max(by: { abs($0.1) < abs($1.1) }), abs(top.1) >= 10 {
            out.append(Insight(
                icon: top.1 > 0 ? "arrow.up.right.circle" : "arrow.down.right.circle",
                text: "\(top.0) vs your 3-month average",
                value: "\(top.1 > 0 ? "+" : "")\(String(format: "%.0f", top.1))%",
                tint: top.1 > 0 ? Ledger.expense : Ledger.income
            ))
        }

        // The single biggest line — usually the thing worth remembering.
        if let biggest = monthExpenses.max(by: {
            store.convert($0.amount, from: $0.currency) < store.convert($1.amount, from: $1.currency)
        }) {
            let name = biggest.vendor.isEmpty
                ? (biggest.description.isEmpty ? store.expenseLabel(biggest.type) : biggest.description)
                : biggest.vendor
            out.append(Insight(
                icon: "flame",
                text: "Biggest · \(name)",
                value: store.format(store.convert(biggest.amount, from: biggest.currency), compact: true),
                tint: Ledger.expense
            ))
        }

        // Volume, so the totals above have a denominator.
        if !monthExpenses.isEmpty {
            let total = scopedTotal
            out.append(Insight(
                icon: "number",
                text: "\(monthExpenses.count) purchases · average",
                value: store.format(total / Double(monthExpenses.count), compact: true)
            ))
        }

        // Six-month baseline for the month total itself.
        let complete = FlowMath.flows(rows, months: 7).dropLast().filter { $0.total > 0.01 }
        if complete.count >= 2 {
            let average = complete.reduce(0) { $0 + $1.total } / Double(complete.count)
            out.append(Insight(
                icon: "chart.bar",
                text: "Typical month (last \(complete.count))",
                value: store.format(average, compact: true)
            ))
        }
        return out
    }

    /// Precomputed facts for the on-device blurb — the model narrates these
    /// numbers, it never computes its own.
    private var aiFacts: String {
        guard !monthExpenses.isEmpty else { return "" }
        var lines = ["Spending, \(scopeTitle): total \(store.format(scopedTotal, compact: true)) across \(monthExpenses.count) purchases."]
        let categories = byCategory.prefix(4)
            .map { "\($0.label) \(store.format($0.value, compact: true))" }
        if !categories.isEmpty { lines.append("By category: " + categories.joined(separator: ", ") + ".") }
        let vendors = topVendors.map { "\($0.name) \(store.format($0.total, compact: true))" }
        if !vendors.isEmpty { lines.append("Top vendors: " + vendors.joined(separator: ", ") + ".") }
        for insight in insights { lines.append("\(insight.text): \(insight.value).") }
        if let peak = weekdayTotals.enumerated().max(by: { $0.element < $1.element }), peak.element > 0 {
            lines.append("Highest-spend weekday: \(FlowMath.weekdayName(peak.offset)).")
        }
        return lines.joined(separator: "\n")
    }

    var body: some View {
        NavigationStack {
            List {
                if !vestaListOnly {
                    Section {
                        summaryHeader
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }

                let flows = FlowMath.flows(convertedRows, months: 6)
                let categoryFlows = FlowMath.categoryFlows(categoryRows, months: 6)
                if !vestaListOnly, flows.filter({ $0.total > 0.01 }).count >= 2 {
                    Section {
                        MonthTrendCard(
                            title: "Spend · 6 months",
                            flows: flows,
                            tint: Ledger.expense,
                            format: { store.format($0, compact: true) },
                            slices: categoryFlows.slices,
                            order: categoryFlows.order,
                            color: { store.expenseColorForLabel($0) }
                        )
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }

                if !vestaListOnly, !insights.isEmpty {
                    Section {
                        InsightsCard(title: "Insights", insights: insights)
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }

                if !vestaListOnly {
                    Section {
                        AIBlurbCard(facts: aiFacts, cacheKey: "expenses")
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }

                if !vestaListOnly, weekdayTotals.contains(where: { $0 > 0 }) {
                    Section {
                        WeekdayPatternCard(
                            totals: weekdayTotals,
                            occurrences: weekdayOccurrences,
                            tint: Ledger.expense,
                            format: { store.format($0, compact: true) }
                        )
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }

                if search.isEmpty, let active = categoryFilter {
                    Section {
                        FilterChip(
                            label: store.expenseLabel(active),
                            color: store.expenseColor(active)
                        ) { withAnimation(.snappy(duration: 0.2)) { categoryFilter = nil } }
                        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }

                if search.isEmpty {
                    Section {
                        MonthScopeStrip(months: flows, selection: $scope, tint: Ledger.expense)
                            .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }

                // One section per day, each carrying its own subtotal — the
                // anchor that makes a ledger scannable instead of a wall.
                ForEach(dayGroups) { group in
                    Section {
                        ForEach(group.items) { entry in
                            ExpenseRow(entry: entry, showsDate: !search.isEmpty)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button("Delete", systemImage: "trash", role: .destructive) {
                                        Task { try? await store.deleteExpense(entry.id) }
                                    }
                                    Button("Edit", systemImage: "pencil") { editing = entry }
                                        .tint(.blue)
                                }
                        }
                    } header: {
                        HStack {
                            Text(group.label)
                            Spacer()
                            Text(store.format(group.total, compact: true))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(Ledger.expense.opacity(0.8))
                        }
                    }
                }

                if dayGroups.isEmpty {
                    Section {
                        Text(search.isEmpty
                             ? (categoryFilter == nil
                                ? "Nothing recorded in this month."
                                : "No \(store.expenseLabel(categoryFilter!)) in this month.")
                             : "No expenses match “\(search)”.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Color.clear.frame(height: 90)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(8)
            .scrollContentBackground(.hidden)
            .background(Ledger.background)
            .searchable(text: $search, prompt: "Search expenses or a date")
            .navigationTitle("Expenses")
            .refreshable { await store.loadAll() }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    FxChip()
                    Button { showAdd = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAdd) { EntryFormView(kind: .expense) }
            .sheet(item: $editing) { EntryFormView(kind: .expense, editingExpense: $0) }
        }
    }

    private var summaryHeader: some View {
        let total = scopedTotal
        let daysGone = FlowMath.dayOfMonth()
        let daysInMonth = FlowMath.daysInCurrentMonth()
        let dailyAverage = total / Double(max(1, daysGone))

        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(scopeTitle).labelMono()
                MoneyText(
                    amount: total,
                    currency: store.displayCurrency,
                    tint: Ledger.expense
                )
                // Pace compares two partial months, so it only means
                // anything while this month is still running.
                if isCurrentMonth, let pace = FlowMath.pace(convertedRows) {
                    PaceBadge(
                        current: pace.current,
                        previousSameDay: pace.previousSameDay,
                        upIsGood: false // spending faster is the bad direction
                    )
                }
            }

            // Burn rate, and where it lands if the month keeps this pace.
            // Projection waits for three days of data — day-one extrapolation
            // is numerology.
            if total > 0, isCurrentMonth {
                HStack(spacing: 8) {
                    StatChip(label: "Per day", value: store.format(dailyAverage, compact: true))
                    if daysGone >= 3, daysGone < daysInMonth {
                        StatChip(
                            label: "Month at this pace",
                            value: "≈ " + store.format(dailyAverage * Double(daysInMonth), compact: true)
                        )
                    }
                    Spacer(minLength: 0)
                }
            }

            // Ranked bars beat a donut for spending: the question is "what's
            // eating the money", and ordered lengths answer it at a glance.
            VStack(spacing: 8) {
                ForEach(byCategory.prefix(6), id: \.type) { row in
                    Button {
                        withAnimation(.snappy(duration: 0.2)) {
                            categoryFilter = categoryFilter == row.type ? nil : row.type
                        }
                    } label: {
                    VStack(spacing: 4) {
                        HStack {
                            Circle().fill(row.color).frame(width: 7, height: 7)
                            Text(row.label).font(.caption)
                            Spacer()
                            Text("\(store.format(row.value, compact: true)) · \(Int((row.value / max(1, total)) * 100))%")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        GeometryReader { geo in
                            Capsule()
                                .fill(row.color.opacity(0.85))
                                .frame(width: max(3, geo.size.width * row.value / max(1, byCategory.first?.value ?? 1)))
                                .animation(.spring(duration: 0.6), value: row.value)
                        }
                        .frame(height: 5)
                        .background(Capsule().fill(.primary.opacity(0.06)))
                    }
                    .opacity(categoryFilter == nil || categoryFilter == row.type ? 1 : 0.4)
                    }
                    .buttonStyle(.plain)
                }
            }

            if !topVendors.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Top vendors").labelMono()
                    HStack(spacing: 8) {
                        ForEach(topVendors, id: \.name) { vendor in
                            StatChip(
                                label: vendor.name,
                                value: store.format(vendor.total, compact: true),
                                tint: Ledger.expense
                            )
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .padding(16)
        .financeCard()
        .padding(.vertical, 4)
    }
}

struct ExpenseRow: View {
    @Environment(DataStore.self) private var store
    let entry: ExpenseEntry
    /// Day-grouped lists carry the date in the section header, so repeating
    /// it on every row is pure noise.
    var showsDate = false

    private var title: String {
        if !entry.description.isEmpty { return entry.description }
        if !entry.vendor.isEmpty { return entry.vendor }
        return store.expenseLabel(entry.type)
    }

    /// Whatever the title didn't already say.
    private var subtitle: String? {
        var parts: [String] = []
        if showsDate { parts.append(SydneyTime.shortLabel(entry.date)) }
        let label = store.expenseLabel(entry.type)
        if label != title { parts.append(label) }
        if !entry.vendor.isEmpty, entry.vendor != title { parts.append(entry.vendor) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(store.expenseColor(entry.type))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(title)
                        .font(.subheadline)
                        .lineLimit(1)
                    if entry.source == "ios" {
                        // Landed via Action Button / card-tap automation.
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 8))
                            .foregroundStyle(Ledger.income.opacity(0.7))
                    }
                }
                if let subtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Text(Money.format(entry.amount, currency: entry.currency))
                .font(.system(.footnote, design: .monospaced, weight: .medium))
                .foregroundStyle(Ledger.expense)
        }
        .padding(.vertical, 2)
    }
}
