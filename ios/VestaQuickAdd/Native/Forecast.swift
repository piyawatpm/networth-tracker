import SwiftUI
import Charts

// Compound net-worth forecast — line-for-line port of lib/utils/forecast.ts
// (which carries the test suite). One monthly simulation answers every
// question: forward ("when do I get there?") and inverse ("what saving /
// return would get me there by then?", by bisection over the same walk), so
// the answers can never disagree with each other.

struct ForecastInputs {
    var netWorth: Double
    var monthlySaving: Double
    var annualReturnPct: Double
    var contributionGrowthPct: Double
}

enum ForecastMath {
    static let maxMonths = 100 * 12

    static func monthlyRate(_ annualPct: Double) -> Double {
        pow(1 + annualPct / 100, 1.0 / 12) - 1
    }

    /// Net worth after each month (index 0 = today) with and without growth.
    static func projectPath(_ inputs: ForecastInputs, months: Int) -> (withGrowth: [Double], savingsOnly: [Double]) {
        let r = monthlyRate(inputs.annualReturnPct)
        var withGrowth = [inputs.netWorth]
        var savingsOnly = [inputs.netWorth]
        var nw = inputs.netWorth
        var flat = inputs.netWorth
        var saving = inputs.monthlySaving
        if months >= 1 {
            for m in 1...months {
                if m > 1, (m - 1) % 12 == 0 { saving *= 1 + inputs.contributionGrowthPct / 100 }
                nw = nw * (1 + r) + saving
                flat += saving
                withGrowth.append(nw)
                savingsOnly.append(flat)
            }
        }
        return (withGrowth, savingsOnly)
    }

    /// Months until `target` is first reached; 0 if already there; nil if
    /// the path never gets there inside the horizon.
    static func monthsToReach(_ inputs: ForecastInputs, target: Double) -> Int? {
        if inputs.netWorth >= target { return 0 }
        let r = monthlyRate(inputs.annualReturnPct)
        var nw = inputs.netWorth
        var saving = inputs.monthlySaving
        for m in 1...maxMonths {
            if m > 1, (m - 1) % 12 == 0 { saving *= 1 + inputs.contributionGrowthPct / 100 }
            nw = nw * (1 + r) + saving
            if nw >= target { return m }
        }
        return nil
    }

    static func requiredMonthlySaving(
        netWorth: Double, annualReturnPct: Double, contributionGrowthPct: Double,
        target: Double, months: Int
    ) -> Double? {
        guard months > 0 else { return nil }
        func reaches(_ saving: Double) -> Bool {
            let inputs = ForecastInputs(netWorth: netWorth, monthlySaving: saving,
                                        annualReturnPct: annualReturnPct,
                                        contributionGrowthPct: contributionGrowthPct)
            return (monthsToReach(inputs, target: target) ?? .max) <= months
        }
        if reaches(0) { return 0 }
        var lo = 0.0
        var hi = max(1, target)
        guard reaches(hi) else { return nil }
        for _ in 0..<60 {
            let mid = (lo + hi) / 2
            if reaches(mid) { hi = mid } else { lo = mid }
        }
        return hi
    }

    static func requiredAnnualReturn(
        netWorth: Double, monthlySaving: Double, contributionGrowthPct: Double,
        target: Double, months: Int
    ) -> Double? {
        guard months > 0 else { return nil }
        func reaches(_ pct: Double) -> Bool {
            let inputs = ForecastInputs(netWorth: netWorth, monthlySaving: monthlySaving,
                                        annualReturnPct: pct,
                                        contributionGrowthPct: contributionGrowthPct)
            return (monthsToReach(inputs, target: target) ?? .max) <= months
        }
        var lo = -50.0
        var hi = 100.0
        if reaches(lo) { return lo }
        guard reaches(hi) else { return nil }
        for _ in 0..<60 {
            let mid = (lo + hi) / 2
            if reaches(mid) { hi = mid } else { lo = mid }
        }
        return hi
    }

    static func describe(months: Int) -> String {
        if months <= 0 { return "now" }
        let y = months / 12
        let m = months % 12
        if y == 0 { return "\(m) month\(m == 1 ? "" : "s")" }
        if m == 0 { return "\(y) year\(y == 1 ? "" : "s")" }
        return "\(y)y \(m)m"
    }

    /// Growth of net worth beyond deposits, annualized; nil under 90 days.
    static func measuredAnnualPacePct(nwStart: Double, nwEnd: Double, netSavings: Double, windowDays: Double) -> Double? {
        guard windowDays >= 90 else { return nil }
        let avg = (nwStart + nwEnd) / 2
        guard avg > 0 else { return nil }
        let pct = (nwEnd - nwStart - netSavings) / avg * (365 / windowDays) * 100
        return pct.isFinite ? pct : nil
    }

    /// Only months with BOTH income and expenses logged count — a month with
    /// income and zero expenses predates expense tracking and would inflate
    /// the pace. Falls back to income months when fewer than two qualify.
    static func measuredMonthlySaving(_ monthly: [(income: Double, expenses: Double)]) -> Double? {
        let complete = monthly.filter { $0.income > 0 && $0.expenses > 0 }
        let pool = complete.count >= 2 ? complete : monthly.filter { $0.income > 0 }
        guard !pool.isEmpty else { return nil }
        return pool.reduce(0) { $0 + ($1.income - $1.expenses) } / Double(pool.count)
    }

    static let fallbackReturnPct = 7.0
    static let presets: [(label: String, pct: Double, note: String)] = [
        ("Cautious", 4, "bonds-heavy, or a rough decade"),
        ("Balanced", 7, "long-run diversified equities"),
        ("Aggressive", 10, "all-in growth, in a good era"),
    ]

    static func addMonths(_ months: Int) -> Date {
        Calendar.current.date(byAdding: .month, value: months, to: Date()) ?? Date()
    }

    static func monthYear(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MMM yyyy"
        return f.string(from: date)
    }

    static func monthsUntil(_ ymd: String) -> Int? {
        guard let target = SnapshotDate.parse(ymd) else { return nil }
        let c = Calendar.current
        let comps = c.dateComponents([.month], from: c.startOfDay(for: Date()), to: target)
        return comps.month
    }
}

// MARK: - Measured inputs from the store

extension DataStore {
    struct MeasuredPace {
        var monthlySaving: Double?
        var pacePct: Double?
        var paceDays: Double
    }

    /// The honest inputs: saving from the ledgers, pace from the net-worth
    /// history — both in the display currency. Same definitions as the web.
    var measuredPace: MeasuredPace {
        // Last six complete months (exclude the current, partial one).
        let months = FlowMath.monthKeys(back: 7).dropLast()
        let monthly = months.map { key in
            (income: monthTotal(income, month: key), expenses: monthTotalExpenses(month: key))
        }
        let saving = ForecastMath.measuredMonthlySaving(monthly)

        // Pace: latest reading vs ~180 days back (or as far as history goes).
        var pace: Double?
        var days = 0.0
        let series = networthParsed
        if let last = series.last, series.count > 1 {
            let wanted = last.date.addingTimeInterval(-180 * 86400)
            let start = series.first { $0.date >= wanted } ?? series[0]
            days = last.date.timeIntervalSince(start.date) / 86400
            let startKey = SydneyTime.dayString(start.date)
            let endKey = SydneyTime.dayString(last.date)
            let earned = income
                .filter { $0.date >= startKey && $0.date <= endKey }
                .reduce(0) { $0 + convert($1.amount, from: $1.currency) }
            let spent = expenses
                .filter { $0.date >= startKey && $0.date <= endKey }
                .reduce(0) { $0 + convert($1.amount, from: $1.currency) }
            pace = ForecastMath.measuredAnnualPacePct(
                nwStart: convert(start.valueUsd, from: "USD"),
                nwEnd: convert(last.valueUsd, from: "USD"),
                netSavings: earned - spent,
                windowDays: days
            )
        }
        return MeasuredPace(monthlySaving: saving, pacePct: pace, paceDays: days)
    }

    /// Full net worth incl. super — a decades-scale forecast should count
    /// everything owned, whatever the Invest tab's toggle says today.
    var forecastNetWorth: Double { stocksValue + cryptoValue + debtNet }

    /// The measured pace is a trustworthy DEFAULT only once a full year is
    /// behind it — four months of a crypto dip annualised to −6% would
    /// otherwise headline a 15-year forecast. Under a year it stays a chip
    /// the user can pick, and the balanced preset leads.
    static let measuredPaceMinDays = 365.0

    /// The effective levers: overrides win, measured values fill the gaps,
    /// the balanced preset is the last resort.
    var forecastInputs: ForecastInputs {
        let measured = measuredPace
        let a = forecastAssumptions
        let measuredDefault = measured.paceDays >= Self.measuredPaceMinDays ? measured.pacePct : nil
        return ForecastInputs(
            netWorth: forecastNetWorth,
            monthlySaving: a.monthlySaving ?? measured.monthlySaving ?? 0,
            annualReturnPct: a.annualReturnPct ?? measuredDefault ?? ForecastMath.fallbackReturnPct,
            contributionGrowthPct: a.contributionGrowthPct
        )
    }

    /// The goal the forecast is aimed at: the nearest active one.
    var forecastGoal: NetworthGoal? {
        goals.filter { $0.achievedAt == nil }
            .min { convert($0.amount, from: $0.currency) < convert($1.amount, from: $1.currency) }
    }
}

// MARK: - The screen

struct ForecastView: View {
    @Environment(DataStore.self) private var store
    @State private var goalId: String?
    @State private var editingGoal: NetworthGoal?
    @State private var showEditor = false
    @State private var planYear: Int?
    @State private var savingText = ""
    @State private var returnText = ""
    @State private var growthText = ""
    @FocusState private var editingField: String?

    private var goal: NetworthGoal? {
        if let goalId, let g = store.goals.first(where: { $0.id == goalId && $0.achievedAt == nil }) { return g }
        // Screenshot runs can aim at a goal by name (VESTA_FORECAST_GOAL).
        if let wanted = ProcessInfo.processInfo.environment["VESTA_FORECAST_GOAL"],
           let g = store.goals.first(where: { $0.name == wanted && $0.achievedAt == nil }) { return g }
        return store.forecastGoal
    }
    private var activeGoals: [NetworthGoal] { store.goals.filter { $0.achievedAt == nil } }
    private var inputs: ForecastInputs { store.forecastInputs }
    private var measured: DataStore.MeasuredPace { store.measuredPace }
    private var target: Double { goal.map { store.convert($0.amount, from: $0.currency) } ?? 0 }
    private var etaMonths: Int? { goal == nil ? nil : ForecastMath.monthsToReach(inputs, target: target) }
    /// "Your pace" is what's driving the number — either the user chose it,
    /// or it's the default because a full year of history stands behind it.
    private var usingMeasuredReturn: Bool {
        guard let pace = measured.pacePct else { return false }
        return abs(inputs.annualReturnPct - pace) < 0.0001
    }

    private var deadlineMonths: Int? {
        if let td = goal?.targetDate { return ForecastMath.monthsUntil(td) }
        if let planYear { return ForecastMath.monthsUntil("\(planYear)-12-31") }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if activeGoals.count > 1 { goalPicker }
                heroCard
                if goal != nil {
                    chartCard
                    leversCard
                    pathsCard
                    plannerCard
                    compositionCard
                    Text("net worth today \(store.format(inputs.netWorth, compact: true)) incl. super · contributions land at month end, return compounds monthly · levers sync to the web")
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(16)
            .padding(.bottom, 110)
        }
        .background(Ledger.background)
        .navigationTitle("Forecast")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { FxChip() }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let goal {
                        Button("Edit goal", systemImage: "pencil") { editingGoal = goal; showEditor = true }
                    }
                    Button("New goal", systemImage: "plus") { editingGoal = nil; showEditor = true }
                } label: {
                    Image(systemName: "flag.checkered")
                }
            }
        }
        .sheet(isPresented: $showEditor) {
            GoalEditorSheet(goal: editingGoal) { saved in
                Task { try? await store.saveGoal(saved) }
                goalId = saved.id
            }
        }
        .onAppear { syncFields() }
        .onChange(of: store.forecastAssumptions) { _, _ in syncFields() }
        // Data lands after the page appears (cold launch straight onto it),
        // so the fields must keep following the store until the user types.
        .onChange(of: inputs.monthlySaving) { _, _ in syncFields() }
        .onChange(of: inputs.annualReturnPct) { _, _ in syncFields() }
        .defaultScrollAnchor(
            ProcessInfo.processInfo.environment["VESTA_SCROLL_BOTTOM"] != nil ? .bottom : .top
        )
    }

    private func syncFields() {
        if editingField != "saving" { savingText = String(Int(inputs.monthlySaving.rounded())) }
        if editingField != "return" { returnText = String(format: "%.1f", inputs.annualReturnPct) }
        growthText = String(format: "%.0f", inputs.contributionGrowthPct)
    }

    private func setAssumptions(_ mutate: (inout ForecastAssumptions) -> Void) {
        var next = store.forecastAssumptions
        mutate(&next)
        Task { await store.saveForecastAssumptions(next) }
    }

    // MARK: Cards

    private var goalPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(activeGoals) { g in
                    let selected = g.id == goal?.id
                    Button {
                        withAnimation(.snappy(duration: 0.2)) { goalId = g.id }
                    } label: {
                        Text(g.name.isEmpty ? store.format(store.convert(g.amount, from: g.currency), compact: true) : g.name)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(selected ? Color.primary : Color.primary.opacity(0.08), in: .capsule)
                            .foregroundStyle(selected ? Color(uiColor: .systemBackground) : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let goal {
                Text("\(goal.name.isEmpty ? "Goal" : goal.name) · \(store.format(store.convert(goal.amount, from: goal.currency), compact: true))").labelMono()
                if let eta = etaMonths {
                    if eta == 0 {
                        Text("You're there.")
                            .font(.system(.title, design: .rounded, weight: .bold))
                            .foregroundStyle(Ledger.income)
                    } else {
                        Text(ForecastMath.monthYear(ForecastMath.addMonths(eta)))
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                            .contentTransition(.numericText())
                        Text("\(ForecastMath.describe(months: eta)) from now · saving \(store.format(inputs.monthlySaving, compact: true))/mo at \(String(format: "%.1f", inputs.annualReturnPct))%/yr\(usingMeasuredReturn ? " (your measured pace)" : "")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Not on this path")
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(Ledger.expense)
                    Text("Net worth isn't growing toward the goal at these inputs — raise the saving or the return below.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                let progress = target > 0 ? min(1, max(0, inputs.netWorth / target)) : 0
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.primary.opacity(0.07))
                        Capsule().fill(Ledger.income)
                            .frame(width: max(6, geo.size.width * progress))
                            .animation(.spring(duration: 0.8), value: progress)
                    }
                }
                .frame(height: 8)
                HStack {
                    Text("\(store.format(inputs.netWorth, compact: true)) of \(store.format(target, compact: true))")
                    Spacer()
                    Text("\(String(format: "%.1f", progress * 100))% · \(store.format(max(0, target - inputs.netWorth), compact: true)) to go")
                }
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "flag.checkered").font(.title).foregroundStyle(.secondary)
                    Text("Set a target to forecast against").font(.headline)
                    Text("Say “100M baht” and this page tells you when you get there at this pace — and what it would take to get there sooner.")
                        .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("New goal", systemImage: "plus") { editingGoal = nil; showEditor = true }
                        .buttonStyle(.borderedProminent)
                        .tint(Ledger.income)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
        }
        .padding(16)
        .financeCard()
    }

    private struct PathPoint: Identifiable {
        let month: Int
        let value: Double
        let kind: String
        var id: String { "\(kind)-\(month)" }
    }

    private var chartCard: some View {
        let horizon = min(40 * 12, max(24, (etaMonths ?? 20 * 12) + 24))
        let path = ForecastMath.projectPath(inputs, months: horizon)
        // Every 3rd month keeps the mark count sane on a 40-year horizon.
        let stride = max(1, horizon / 160)
        var points: [PathPoint] = []
        for m in Swift.stride(from: 0, through: horizon, by: stride) {
            points.append(PathPoint(month: m, value: path.withGrowth[m], kind: "With growth"))
            points.append(PathPoint(month: m, value: path.savingsOnly[m], kind: "Savings only"))
        }
        let yMax = max(target, path.withGrowth.last ?? 0) * 1.05

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Projected net worth").labelMono()
                Spacer()
                HStack(spacing: 10) {
                    legend("with growth", Ledger.income, dashed: false)
                    legend("savings only", Ledger.chartColor(2), dashed: true)
                }
            }
            Chart {
                ForEach(points) { p in
                    LineMark(x: .value("Month", p.month), y: .value("Value", p.value))
                        .foregroundStyle(by: .value("Kind", p.kind))
                        .lineStyle(StrokeStyle(lineWidth: p.kind == "With growth" ? 2 : 1.5,
                                               dash: p.kind == "With growth" ? [] : [4, 3]))
                        .interpolationMethod(.monotone)
                }
                if target > 0 {
                    RuleMark(y: .value("Goal", target))
                        .foregroundStyle(Ledger.chartColor(6).opacity(0.7))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .annotation(position: .top, alignment: .trailing) {
                            Text(goal?.name.isEmpty == false ? goal!.name : "goal")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                }
                if let eta = etaMonths, eta <= horizon {
                    PointMark(x: .value("Month", eta), y: .value("Value", path.withGrowth[eta]))
                        .foregroundStyle(Ledger.chartColor(6))
                        .symbolSize(60)
                }
            }
            .chartForegroundStyleScale(["With growth": Ledger.income, "Savings only": Ledger.chartColor(2)])
            .chartLegend(.hidden)
            .chartYScale(domain: 0...max(1, yMax))
            .chartXAxis {
                AxisMarks(values: Array(Swift.stride(from: 0, through: horizon, by: max(12, (horizon / 6 / 12) * 12)))) { value in
                    AxisGridLine().foregroundStyle(.primary.opacity(0.06))
                    AxisValueLabel {
                        if let m = value.as(Int.self) {
                            Text(String(Calendar.current.component(.year, from: ForecastMath.addMonths(m))))
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine().foregroundStyle(.primary.opacity(0.06))
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(store.format(v, compact: true))
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .frame(height: 200)
            Text("the gap between the lines is compounding — the part of the goal your money earns for you")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
        .padding(16)
        .financeCard()
    }

    private func legend(_ label: String, _ color: Color, dashed: Bool) -> some View {
        HStack(spacing: 4) {
            Rectangle().fill(color).frame(width: 12, height: dashed ? 1 : 2)
            Text(label).font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
        }
    }

    private var leversCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Your levers").labelMono()

            // Monthly saving
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Monthly saving").font(.subheadline.weight(.medium))
                    Text("income − expenses").font(.caption2).foregroundStyle(.tertiary)
                    Spacer()
                    if let m = measured.monthlySaving, store.forecastAssumptions.monthlySaving != nil {
                        Button("reset to \(store.format(m, compact: true))") {
                            setAssumptions { $0.monthlySaving = nil }
                        }
                        .font(.caption2)
                    }
                }
                HStack {
                    TextField("0", text: $savingText)
                        .keyboardType(.numberPad)
                        .font(.system(.body, design: .monospaced))
                        .focused($editingField, equals: "saving")
                        .onSubmit { commitSaving() }
                    Text("/mo").font(.caption).foregroundStyle(.secondary)
                    Stepper("", value: Binding(
                        get: { inputs.monthlySaving },
                        set: { v in setAssumptions { $0.monthlySaving = max(0, v) } }
                    ), step: max(1000, (inputs.monthlySaving * 0.05 / 1000).rounded() * 1000))
                    .labelsHidden()
                }
                Text(measured.monthlySaving.map { "measured \(store.format($0, compact: true))/mo over the last six months where both ledgers were logged" }
                     ?? "not enough ledger history to measure — type what you save")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }

            Divider().opacity(0.5)

            // Return
            VStack(alignment: .leading, spacing: 6) {
                Text("Yearly return on everything you own").font(.subheadline.weight(.medium))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        if let pace = measured.pacePct {
                            chip("Your pace \(pace >= 0 ? "+" : "")\(String(format: "%.1f", pace))%", selected: usingMeasuredReturn) {
                                setAssumptions { $0.annualReturnPct = pace }
                            }
                        }
                        ForEach(ForecastMath.presets, id: \.pct) { p in
                            chip("\(p.label) \(Int(p.pct))%", selected: !usingMeasuredReturn && abs(inputs.annualReturnPct - p.pct) < 0.0001) {
                                setAssumptions { $0.annualReturnPct = p.pct }
                            }
                        }
                        HStack(spacing: 2) {
                            TextField("7.0", text: $returnText)
                                .keyboardType(.decimalPad)
                                .font(.system(.caption, design: .monospaced))
                                .frame(width: 44)
                                .focused($editingField, equals: "return")
                                .onSubmit { commitReturn() }
                            Text("%").font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(.primary.opacity(0.06), in: .capsule)
                    }
                }
                Text(measured.pacePct != nil
                     ? "your pace = how fast net worth grew beyond deposits over the last \(Int(measured.paceDays)) days\(measured.paceDays < 365 ? " — short window, treat it as a mood not a law; presets are long-run assumptions" : "")"
                     : "not enough net-worth history to measure your pace yet (needs 90+ days) · presets are long-run assumptions")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider().opacity(0.5)

            // Contribution growth
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Saving grows each year").font(.subheadline.weight(.medium))
                    Text("raises, bots scaling").font(.caption2).foregroundStyle(.tertiary)
                }
                Spacer()
                Stepper(value: Binding(
                    get: { inputs.contributionGrowthPct },
                    set: { v in setAssumptions { $0.contributionGrowthPct = max(0, v) } }
                ), in: 0...30, step: 1) {
                    Text("\(Int(inputs.contributionGrowthPct))%/yr")
                        .font(.system(.footnote, design: .monospaced, weight: .semibold))
                }
                .fixedSize()
            }
        }
        .padding(16)
        .financeCard()
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    commitSaving(); commitReturn()
                    editingField = nil
                }
            }
        }
    }

    private func commitSaving() {
        guard let v = Double(savingText.replacingOccurrences(of: ",", with: "")), v != inputs.monthlySaving else { return }
        setAssumptions { $0.monthlySaving = max(0, v) }
    }
    private func commitReturn() {
        guard let v = Double(returnText), abs(v - inputs.annualReturnPct) > 0.001 else { return }
        setAssumptions { $0.annualReturnPct = v }
    }

    private func chip(_ text: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(selected ? Color.primary : Color.primary.opacity(0.08), in: .capsule)
                .foregroundStyle(selected ? Color(uiColor: .systemBackground) : .primary)
        }
        .buttonStyle(.plain)
    }

    private var pathsCard: some View {
        var rows: [(label: String, pct: Double, months: Int?, note: String, active: Bool)] = []
        if let pace = measured.pacePct {
            var i = inputs; i.annualReturnPct = pace
            rows.append(("Your pace", pace, ForecastMath.monthsToReach(i, target: target),
                         "measured over \(Int(measured.paceDays)) days", usingMeasuredReturn))
        }
        for p in ForecastMath.presets {
            var i = inputs; i.annualReturnPct = p.pct
            rows.append((p.label, p.pct, ForecastMath.monthsToReach(i, target: target),
                         p.note, !usingMeasuredReturn && abs(inputs.annualReturnPct - p.pct) < 0.0001))
        }
        // Sensitivity: one notch on each lever.
        let bump = max(1000, (inputs.monthlySaving * 0.1 / 1000).rounded() * 1000)
        var moreSaving = inputs; moreSaving.monthlySaving += bump
        var moreReturn = inputs; moreReturn.annualReturnPct += 1
        var moreGrowth = inputs; moreGrowth.contributionGrowthPct += 3
        let levers: [(String, Int?)] = [
            ("+\(store.format(bump, compact: true))/mo saved", ForecastMath.monthsToReach(moreSaving, target: target)),
            ("+1% yearly return", ForecastMath.monthsToReach(moreReturn, target: target)),
            ("+3% raise each year", ForecastMath.monthsToReach(moreGrowth, target: target)),
        ]

        return VStack(alignment: .leading, spacing: 10) {
            Text("Paths to \(store.format(target, compact: true))").labelMono()
            ForEach(rows, id: \.label) { row in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(row.label).font(.subheadline.weight(row.active ? .semibold : .regular))
                            Text("\(row.pct >= 0 ? "+" : "")\(String(format: "%.1f", row.pct))%/yr")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        Text(row.note).font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                    }
                    Spacer()
                    if let m = row.months {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(ForecastMath.monthYear(ForecastMath.addMonths(m)))
                                .font(.system(.footnote, design: .monospaced, weight: row.active ? .semibold : .regular))
                            Text(ForecastMath.describe(months: m))
                                .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                        }
                    } else {
                        Text("not on this path")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(Ledger.expense)
                    }
                }
            }
            if let eta = etaMonths {
                Divider().opacity(0.5)
                Text("What moves the needle").labelMono()
                ForEach(levers, id: \.0) { lever in
                    HStack {
                        Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(Ledger.income)
                        Text(lever.0).font(.caption)
                        Spacer()
                        if let m = lever.1 {
                            Text(eta - m <= 0 ? "no change" : "\(ForecastMath.describe(months: eta - m)) sooner")
                                .font(.system(.caption, design: .monospaced, weight: .semibold))
                                .foregroundStyle(Ledger.income)
                        } else {
                            Text("—").font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(.primary.opacity(0.04), in: .rect(cornerRadius: 8))
                }
            }
        }
        .padding(16)
        .financeCard()
    }

    private var plannerCard: some View {
        let years = [3, 5, 10, 15, 20].map { Calendar.current.component(.year, from: Date()) + $0 }
        let months = deadlineMonths
        let plan: (needSaving: Double?, needReturn: Double?, onTrack: Bool)? = {
            guard let months, months > 0 else { return nil }
            let s = ForecastMath.requiredMonthlySaving(
                netWorth: inputs.netWorth, annualReturnPct: inputs.annualReturnPct,
                contributionGrowthPct: inputs.contributionGrowthPct, target: target, months: months)
            let r = ForecastMath.requiredAnnualReturn(
                netWorth: inputs.netWorth, monthlySaving: inputs.monthlySaving,
                contributionGrowthPct: inputs.contributionGrowthPct, target: target, months: months)
            return (s, r, (etaMonths ?? .max) <= months)
        }()

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Reach it by").labelMono()
                Spacer()
                if let td = goal?.targetDate {
                    Button("deadline \(td.prefix(4)) · change") {
                        editingGoal = goal; showEditor = true
                    }
                    .font(.caption2)
                }
            }
            if goal?.targetDate == nil {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(years, id: \.self) { y in
                            chip(String(y), selected: planYear == y) {
                                withAnimation(.snappy(duration: 0.2)) { planYear = planYear == y ? nil : y }
                            }
                        }
                    }
                }
            }
            if let plan, let months {
                HStack(spacing: 8) {
                    planTile(
                        "Current pace",
                        plan.onTrack ? "On track" : (etaMonths.map { "\(ForecastMath.describe(months: $0 - months)) late" } ?? "Never"),
                        etaMonths.map { "arrives \(ForecastMath.monthYear(ForecastMath.addMonths($0)))" } ?? "not on this path",
                        tint: plan.onTrack ? Ledger.income : Ledger.expense
                    )
                    planTile(
                        "Or save",
                        plan.needSaving.map { "\(store.format($0, compact: true))/mo" } ?? "—",
                        plan.needSaving.map { "\($0 - inputs.monthlySaving >= 0 ? "+" : "")\(store.format($0 - inputs.monthlySaving, compact: true)) vs now" } ?? "no saving gets there in time"
                    )
                    planTile(
                        "Or earn",
                        plan.needReturn.map { "\(String(format: "%.1f", $0))%/yr" } ?? "—",
                        plan.needReturn.map { _ in "vs \(String(format: "%.1f", inputs.annualReturnPct))% now" } ?? "no sane return does it"
                    )
                }
            } else {
                Text("Pick a year to see what it would take.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .financeCard()
    }

    private func planTile(_ label: String, _ value: String, _ sub: String, tint: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased()).font(.system(size: 8, weight: .semibold, design: .monospaced)).foregroundStyle(.tertiary)
            Text(value).font(.system(.footnote, design: .rounded, weight: .bold)).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.7)
            Text(sub).font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.primary.opacity(0.04), in: .rect(cornerRadius: 10))
    }

    @ViewBuilder
    private var compositionCard: some View {
        if let eta = etaMonths, eta > 0 {
            let path = ForecastMath.projectPath(inputs, months: eta)
            let start = inputs.netWorth
            let deposits = path.savingsOnly[eta] - start
            let growth = path.withGrowth[eta] - path.savingsOnly[eta]
            let total = max(1, start + deposits + growth)
            VStack(alignment: .leading, spacing: 8) {
                Text("Where the \(store.format(target, compact: true)) comes from").labelMono()
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        Capsule().fill(Ledger.chartColor(4)).frame(width: max(2, geo.size.width * start / total))
                        Capsule().fill(Ledger.chartColor(2)).frame(width: max(2, geo.size.width * deposits / total))
                        Capsule().fill(Ledger.income)
                    }
                }
                .frame(height: 8)
                HStack(spacing: 10) {
                    part("Already have", start, Ledger.chartColor(4))
                    part("You'll deposit", deposits, Ledger.chartColor(2))
                    part("Growth earns", growth, Ledger.income)
                }
                Text(growth / total < 0.25
                     ? "most of this goal is your own deposits — the saving lever matters far more than the return lever right now"
                     : "compounding is doing real work here — protecting the return matters as much as saving more")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .financeCard()
        }
    }

    private func part(_ label: String, _ value: Double, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 0) {
                Text(label).font(.system(size: 8, design: .monospaced)).foregroundStyle(.tertiary)
                Text(store.format(value, compact: true)).font(.system(.caption2, design: .monospaced, weight: .semibold))
            }
        }
    }
}

// MARK: - Goal editor

struct GoalEditorSheet: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let goal: NetworthGoal?
    let onSave: (NetworthGoal) -> Void

    @State private var name = ""
    @State private var amount = ""
    @State private var currency = "AUD"
    @State private var year = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name (e.g. 100M baht)", text: $name)
                    HStack {
                        TextField("Target", text: $amount).keyboardType(.decimalPad)
                        Picker("", selection: $currency) {
                            ForEach(["THB", "AUD", "USD"], id: \.self) { Text($0).tag($0) }
                        }
                        .labelsHidden()
                    }
                }
                Section {
                    TextField("By year (optional)", text: $year).keyboardType(.numberPad)
                } footer: {
                    Text("Leave the year empty for “when will I get there?”. Set one and the forecast turns into a plan — what to save or earn to make it.")
                }
            }
            .navigationTitle(goal == nil ? "New goal" : "Edit goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled((Double(amount.replacingOccurrences(of: ",", with: "")) ?? 0) <= 0)
                }
            }
            .onAppear {
                name = goal?.name ?? ""
                amount = goal.map { String(Int($0.amount)) } ?? ""
                currency = goal?.currency ?? store.displayCurrency
                year = goal?.targetDate.map { String($0.prefix(4)) } ?? ""
            }
        }
    }

    private func save() {
        guard let value = Double(amount.replacingOccurrences(of: ",", with: "")), value > 0 else { return }
        let thisYear = Calendar.current.component(.year, from: Date())
        let deadline: String? = Int(year).flatMap { $0 > thisYear ? "\($0)-12-31" : nil }
        var saved = goal ?? NetworthGoal(name: "", amount: 0, currency: currency)
        saved.name = name.trimmingCharacters(in: .whitespaces).isEmpty ? "Net worth goal" : name.trimmingCharacters(in: .whitespaces)
        saved.amount = value
        saved.currency = currency
        saved.targetDate = deadline
        saved.achievedAt = nil
        onSave(saved)
        dismiss()
    }
}
