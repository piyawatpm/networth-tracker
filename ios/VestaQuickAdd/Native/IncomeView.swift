import SwiftUI
import Charts

struct IncomeView: View {
    @Environment(DataStore.self) private var store
    @State private var showAdd = false
    @State private var editing: IncomeEntry?
    @State private var search = ""
    @State private var selectedAngle: Double?
    /// Which month the record list shows; nil = every record.
    @State private var scope: String? = SydneyTime.currentMonthKey()
    /// True once the hero has scrolled away — floats the scope pill.
    @State private var scrolledPastHero = false
    /// Tapping a donut slice or legend row narrows the record list to it.
    @State private var categoryFilter: String?

    private var month: String { SydneyTime.currentMonthKey() }

    /// Everything the summary/insight cards describe — the month chosen with
    /// the chips, not always the calendar month. "All" means all of it.
    private var monthEntries: [IncomeEntry] {
        guard let scope else { return store.allIncome }
        return store.allIncome.filter { SydneyTime.monthKey($0.date) == scope }
    }

    private var isCurrentMonth: Bool { scope == month }

    private var scopeTitle: String {
        guard let scope else { return "All time" }
        return isCurrentMonth ? "This month" : FlowMath.label(scope)
    }

    private var scopedTotal: Double {
        monthEntries.reduce(0) { $0 + store.convert($1.amount, from: $1.currency) }
    }

    private var categoryRows: [(date: String, category: String, value: Double)] {
        store.allIncome.map {
            ($0.date, store.incomeLabel($0.type), store.convert($0.amount, from: $0.currency))
        }
    }

    /// Donut slices for this month, positive categories only (a pie can't
    /// draw a negative arc — same rule as the web).
    private var slices: [(type: String, label: String, value: Double, color: Color)] {
        var byType: [String: Double] = [:]
        for entry in monthEntries {
            byType[entry.type, default: 0] += store.convert(entry.amount, from: entry.currency)
        }
        return byType
            .filter { $0.value > 0.005 }
            .map { (type: $0.key, label: store.incomeLabel($0.key), value: $0.value, color: store.incomeColor($0.key)) }
            .sorted { $0.value > $1.value }
    }

    /// Which slice the current chartAngleSelection lands in.
    private var selectedSlice: (type: String, label: String, value: Double, color: Color)? {
        guard let angle = selectedAngle else { return nil }
        var running = 0.0
        for slice in slices {
            running += slice.value
            if angle <= running { return slice }
        }
        return nil
    }

    /// Dates + display-currency values, shared by the trend and pace math.
    private var convertedRows: [(date: String, value: Double)] {
        store.allIncome.map { ($0.date, store.convert($0.amount, from: $0.currency)) }
    }

    /// Scoped to the chosen month; search sweeps everything (see Expenses).
    private var listEntries: [IncomeEntry] {
        let base = search.isEmpty
            ? store.allIncome.filter { scope == nil || SydneyTime.monthKey($0.date) == scope }
            : store.allIncome
        let filtered = categoryFilter == nil
            ? base : base.filter { $0.type == categoryFilter }
        let sorted = filtered.sorted {
            $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt
        }
        guard !search.isEmpty else { return sorted }
        return sorted.filter {
            FlowMath.matches(
                query: search,
                fields: [$0.description, $0.source, store.incomeLabel($0.type)],
                date: $0.date
            )
        }
    }

    private var dayGroups: [DayGroup<IncomeEntry>] {
        FlowMath.groupByDay(
            listEntries,
            date: { $0.date },
            value: { store.convert($0.amount, from: $0.currency) }
        )
    }

    /// Findings tuned to the actual goal here: replacing wage income.
    private var insights: [Insight] {
        var out: [Insight] = []
        let total = scopedTotal

        // Passive coverage — the single number the whole plan turns on.
        let freedom = store.freedom
        if freedom.expenses > 1 {
            let pct = freedom.coverage * 100
            out.append(Insight(
                icon: "shield.lefthalf.filled",
                text: "Passive income covers your spending",
                value: "\(String(format: "%.0f", pct))%",
                tint: pct >= 100 ? Ledger.income : (pct >= 50 ? Ledger.seriesDebt : Ledger.expense)
            ))
        }

        // Concentration: one source carrying everything is a risk worth
        // seeing, not a milestone.
        if let top = slices.first, total > 1 {
            let share = top.value / total * 100
            out.append(Insight(
                icon: "chart.pie",
                text: "\(top.label) is your largest source",
                value: "\(String(format: "%.0f", share))%",
                tint: share >= 70 ? Ledger.seriesCrypto : .primary
            ))
        }

        if !monthEntries.isEmpty {
            out.append(Insight(
                icon: "number",
                text: "\(monthEntries.count) payments · average",
                value: store.format(total / Double(monthEntries.count), compact: true)
            ))
        }

        let complete = FlowMath.flows(convertedRows, months: 7).dropLast().filter { $0.total > 0.01 }
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

    /// Precomputed facts for the on-device blurb — narrated, never computed,
    /// by the model.
    private var aiFacts: String {
        guard !monthEntries.isEmpty else { return "" }
        var lines = ["Income, \(scopeTitle): total \(store.format(scopedTotal, compact: true)) across \(monthEntries.count) entries."]
        let sources = slices.prefix(4)
            .map { "\($0.label) \(store.format($0.value, compact: true))" }
        if !sources.isEmpty { lines.append("By source: " + sources.joined(separator: ", ") + ".") }
        for insight in insights { lines.append("\(insight.text): \(insight.value).") }
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

                // Trend earns its card only once there's a month to compare
                // against — a single lonely bar answers nothing.
                let flows = FlowMath.flows(convertedRows, months: 6)
                let categoryFlows = FlowMath.categoryFlows(categoryRows, months: 6)
                if !vestaListOnly, flows.filter({ $0.total > 0.01 }).count >= 2 {
                    Section {
                        MonthTrendCard(
                            title: "Income · 6 months",
                            flows: flows,
                            tint: Ledger.income,
                            format: { store.format($0, compact: true) },
                            slices: categoryFlows.slices,
                            order: categoryFlows.order,
                            color: { store.incomeColorForLabel($0) },
                            scope: $scope
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
                        AIBlurbCard(facts: aiFacts, cacheKey: "income")
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }

                if search.isEmpty, let active = categoryFilter {
                    Section {
                        FilterChip(
                            label: store.incomeLabel(active),
                            color: store.incomeColor(active)
                        ) { withAnimation(.snappy(duration: 0.2)) { categoryFilter = nil } }
                        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }

                if search.isEmpty {
                    Section {
                        MonthScopeStrip(months: flows, selection: $scope, tint: Ledger.income, format: { store.format($0, compact: true) })
                            .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }

                ForEach(dayGroups) { group in
                    Section {
                        ForEach(group.items) { entry in
                            IncomeRow(entry: entry, showsDate: !search.isEmpty)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if entry.derived != true {
                                        Button("Delete", systemImage: "trash", role: .destructive) {
                                            Task { try? await store.deleteIncome(entry.id) }
                                        }
                                        Button("Edit", systemImage: "pencil") { editing = entry }
                                            .tint(.blue)
                                    }
                                }
                        }
                    } header: {
                        HStack {
                            Text(group.label)
                            Spacer()
                            Text(store.format(group.total, compact: true))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(Ledger.income.opacity(0.8))
                        }
                    }
                }

                if dayGroups.isEmpty {
                    Section {
                        Text(search.isEmpty
                             ? (categoryFilter == nil
                                ? "Nothing recorded in this month."
                                : "No \(store.incomeLabel(categoryFilter!)) in this month.")
                             : "No income matches “\(search)”.")
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
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top > 320
            } action: { _, scrolled in
                withAnimation(.snappy(duration: 0.25)) { scrolledPastHero = scrolled }
            }
            .overlay(alignment: .top) {
                // The page's context, kept in sight once the hero is gone —
                // which window you're reading and its total, clear in one tap.
                if scrolledPastHero, !vestaListOnly {
                    FloatingScopePill(
                        title: scopeTitle,
                        total: store.format(scopedTotal, compact: true),
                        tint: Ledger.income,
                        isFiltered: scope != nil
                    ) {
                        withAnimation(.snappy(duration: 0.25)) { scope = nil }
                    }
                    .padding(.top, 4)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .scrollContentBackground(.hidden)
            .background(Ledger.background)
            .searchable(text: $search, prompt: "Search income or a date")
            .navigationTitle("Income")
            .refreshable { await store.loadAll() }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    FxChip()
                    Button { showAdd = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAdd) { EntryFormView(kind: .income) }
            .sheet(item: $editing) { EntryFormView(kind: .income, editingIncome: $0) }
        }
    }

    private var summaryHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(scopeTitle).labelMono()
                MoneyText(
                    amount: scopedTotal,
                    currency: store.displayCurrency,
                    tint: Ledger.income
                )
                // Partial-vs-partial: this month so far against last month
                // through the same day, so the number means something on the 5th.
                if isCurrentMonth, let pace = FlowMath.pace(convertedRows) {
                    PaceBadge(
                        current: pace.current,
                        previousSameDay: pace.previousSameDay,
                        upIsGood: true
                    )
                }
            }

            if !slices.isEmpty {
                HStack(spacing: 16) {
                    Chart(slices, id: \.type) { slice in
                        SectorMark(
                            angle: .value("Amount", slice.value),
                            innerRadius: .ratio(0.68),
                            angularInset: 1.5
                        )
                        .cornerRadius(3)
                        .foregroundStyle(slice.color)
                        .opacity(
                            selectedSlice == nil || selectedSlice?.type == slice.type ? 1 : 0.35
                        )
                    }
                    .chartAngleSelection(value: $selectedAngle)
                    .chartBackground { _ in
                        VStack(spacing: 2) {
                            if let selected = selectedSlice {
                                Text(selected.label)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Text(store.format(selected.value, compact: true))
                                    .font(.system(.footnote, design: .rounded, weight: .bold))
                            } else {
                                Text("\(slices.count)")
                                    .font(.system(.title3, design: .rounded, weight: .bold))
                                Text("sources").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .frame(width: 130, height: 130)
                    .animation(.spring(duration: 0.35), value: selectedAngle != nil)

                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(slices.prefix(5), id: \.type) { slice in
                            Button {
                                withAnimation(.snappy(duration: 0.2)) {
                                    categoryFilter = categoryFilter == slice.type ? nil : slice.type
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Circle().fill(slice.color).frame(width: 7, height: 7)
                                    Text(slice.label).font(.caption).lineLimit(1)
                                    Spacer()
                                    Text(store.format(slice.value, compact: true))
                                        .font(.system(.caption2, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                                .opacity(categoryFilter == nil || categoryFilter == slice.type ? 1 : 0.4)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding(16)
        .financeCard()
        .padding(.vertical, 4)
    }
}

struct IncomeRow: View {
    @Environment(DataStore.self) private var store
    let entry: IncomeEntry
    /// See ExpenseRow — the day header already carries the date.
    var showsDate = false

    private var title: String {
        entry.description.isEmpty ? store.incomeLabel(entry.type) : entry.description
    }

    private var subtitle: String? {
        var parts: [String] = []
        if showsDate { parts.append(SydneyTime.shortLabel(entry.date)) }
        let label = store.incomeLabel(entry.type)
        if label != title { parts.append(label) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(store.incomeColor(entry.type))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(title)
                        .font(.subheadline)
                        .lineLimit(1)
                    if entry.derived == true {
                        // Rows projected from tx logs — read-only, like the web.
                        Image(systemName: "link")
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
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
                .foregroundStyle(entry.amount >= 0 ? Ledger.income : Ledger.expense)
        }
        .padding(.vertical, 2)
    }
}
