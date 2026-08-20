import SwiftUI
import Charts

/// One month's total for a money flow (income or spend).
struct MonthFlow: Identifiable {
    let key: String     // "2026-08"
    let label: String   // "Aug"
    let total: Double   // display currency
    let isCurrent: Bool // partial — drawn dimmer, labelled "so far"
    var id: String { key }
}

/// Month arithmetic for the insight cards — pure string/int math, no
/// formatters in loops (the cold-launch lesson applies everywhere).
enum FlowMath {
    /// Localized month abbreviations, indexed by month-1. Built once.
    private static let monthNames: [String] = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.shortMonthSymbols
    }()

    private static var sydneyCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = SydneyTime.zone
        return c
    }()

    /// The last `count` month keys, oldest → newest, ending at the current
    /// month.
    static func monthKeys(back count: Int) -> [String] {
        let current = SydneyTime.currentMonthKey()
        guard let year = Int(current.prefix(4)),
              let month = Int(current.suffix(2)) else { return [current] }
        return (0..<count).reversed().map { offset in
            var y = year
            var m = month - offset
            while m < 1 { m += 12; y -= 1 }
            return String(format: "%04d-%02d", y, m)
        }
    }

    static func label(_ key: String) -> String {
        guard let m = Int(key.suffix(2)), m >= 1, m <= 12 else { return key }
        return monthNames[m - 1]
    }

    static func dayOfMonth() -> Int {
        Int(SydneyTime.today().suffix(2)) ?? 1
    }

    static func daysInCurrentMonth() -> Int {
        sydneyCalendar.range(of: .day, in: .month, for: Date())?.count ?? 30
    }

    /// Monthly totals over the trailing `months`, from pre-converted rows.
    static func flows(_ rows: [(date: String, value: Double)], months: Int) -> [MonthFlow] {
        var byMonth: [String: Double] = [:]
        for row in rows {
            byMonth[String(row.date.prefix(7)), default: 0] += row.value
        }
        let current = SydneyTime.currentMonthKey()
        return monthKeys(back: months).map { key in
            MonthFlow(
                key: key, label: label(key),
                total: byMonth[key] ?? 0,
                isCurrent: key == current
            )
        }
    }

    /// This month so far vs LAST MONTH THROUGH THE SAME DAY — the honest
    /// mid-month comparison. Against last month's full total, every month
    /// would start out "down 97%".
    static func pace(_ rows: [(date: String, value: Double)])
        -> (current: Double, previousSameDay: Double)? {
        let keys = monthKeys(back: 2)
        guard keys.count == 2 else { return nil }
        let previous = keys[0], current = keys[1]
        let day = dayOfMonth()

        var currentTotal = 0.0
        var previousTotal = 0.0
        for row in rows {
            let month = String(row.date.prefix(7))
            if month == current {
                currentTotal += row.value
            } else if month == previous, Int(row.date.suffix(2)) ?? 32 <= day {
                previousTotal += row.value
            }
        }
        guard previousTotal > 0.01 else { return nil }
        return (currentTotal, previousTotal)
    }
}

/// Screenshot/UI runs can hide the header cards to photograph the record
/// list itself — same family as VESTA_INITIAL_TAB and VESTA_PERIOD.
let vestaListOnly = ProcessInfo.processInfo.environment["VESTA_LIST_ONLY"] != nil

// MARK: - Search

extension FlowMath {
    /// Does a record match a typed query, dates included?
    ///
    /// Dates are matched in every shape a person actually types them: the
    /// stored "2026-08-05", the way the app prints them ("5 Aug"), the month
    /// on its own ("Aug", "August", "2026-08"), and the weekday ("Wed").
    /// Searching "aug" or "5 aug" should find a receipt; requiring the ISO
    /// form would make the field feel broken.
    static func matches(query: String, fields: [String], date: String) -> Bool {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return true }
        // Every term must hit something — "aug food" narrows, it doesn't widen.
        return q.split(separator: " ").allSatisfy { term in
            let needle = String(term)
            if fields.contains(where: { $0.lowercased().contains(needle) }) { return true }
            return dateTokens(date).contains { $0.contains(needle) }
        }
    }

    /// Every string form of a record's date, lowercased.
    static func dateTokens(_ date: String) -> [String] {
        let day = String(date.prefix(10))
        var tokens = [day, String(day.prefix(7))]
        let parts = day.split(separator: "-")
        if parts.count == 3, let month = Int(parts[1]), month >= 1, month <= 12 {
            let short = label(String(day.prefix(7)))
            let dayNumber = Int(parts[2]).map(String.init) ?? String(parts[2])
            tokens.append(short)
            tokens.append(fullMonthName(month))
            tokens.append("\(dayNumber) \(short)")
            if let weekday = SnapshotDate.weekdayIndex(day) {
                tokens.append(weekdayName(weekday))
            }
        }
        return tokens.map { $0.lowercased() }
    }

    private static let fullMonthNames: [String] = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.monthSymbols
    }()

    static func fullMonthName(_ month: Int) -> String {
        fullMonthNames[max(0, min(11, month - 1))]
    }
}

/// Tappable category filter, shown once a category is picked.
struct FilterChip: View {
    let label: String
    let color: Color
    let onClear: () -> Void

    var body: some View {
        Button(action: onClear) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 6, height: 6)
                Text(label)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.18), in: .capsule)
            .overlay(Capsule().strokeBorder(color.opacity(0.45), lineWidth: 0.8))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Category composition per month

/// One category's slice of one month's bar.
struct CategorySlice: Identifiable {
    let monthKey: String
    let monthLabel: String
    let category: String
    let total: Double
    let isCurrent: Bool
    /// Topmost segment in its month — it carries the month's total label, so
    /// the number isn't repeated once per segment.
    let isTop: Bool
    var id: String { monthKey + "|" + category }
}

extension FlowMath {
    /// Monthly totals split by category, ready to stack.
    ///
    /// Ranks categories over the WHOLE window and keeps the top `maxCategories`,
    /// folding the tail into "Other" — a stack with fifteen segments is a
    /// texture, not a chart, and inventing a hue per extra category is exactly
    /// what a fixed categorical order exists to prevent. Because the order is
    /// computed across the window rather than per month, a category keeps its
    /// colour and stacking position as months change.
    static func categoryFlows(
        _ rows: [(date: String, category: String, value: Double)],
        months: Int,
        maxCategories: Int = 5
    ) -> (slices: [CategorySlice], order: [String]) {
        let keys = monthKeys(back: months)
        let window = Set(keys)
        var byMonthCategory: [String: [String: Double]] = [:]
        var overall: [String: Double] = [:]

        for row in rows {
            let month = String(row.date.prefix(7))
            guard window.contains(month) else { continue }
            byMonthCategory[month, default: [:]][row.category, default: 0] += row.value
            overall[row.category, default: 0] += row.value
        }

        let ranked = overall.filter { $0.value > 0.005 }
            .sorted { $0.value > $1.value }
            .map(\.key)
        let kept = Array(ranked.prefix(maxCategories))
        let keptSet = Set(kept)
        let hasOther = ranked.count > kept.count
        let order = kept + (hasOther ? [otherCategory] : [])

        let current = SydneyTime.currentMonthKey()
        var slices: [CategorySlice] = []
        for key in keys {
            var totals: [String: Double] = [:]
            for (category, value) in byMonthCategory[key] ?? [:] {
                let bucket = keptSet.contains(category) ? category : otherCategory
                totals[bucket, default: 0] += value
            }
            // Topmost = last non-empty category in stacking order.
            let present = order.filter { (totals[$0] ?? 0) > 0.005 }
            for category in present {
                slices.append(CategorySlice(
                    monthKey: key,
                    monthLabel: label(key),
                    category: category,
                    total: totals[category] ?? 0,
                    isCurrent: key == current,
                    isTop: category == present.last
                ))
            }
        }
        return (slices, order)
    }

    static let otherCategory = "Other"
}

// MARK: - Day grouping

/// A day's worth of records, with its own subtotal.
struct DayGroup<Item>: Identifiable {
    let id: String      // "2026-08-05"
    let label: String   // "Wed 5 Aug"
    let total: Double
    let items: [Item]
}

extension FlowMath {
    private static let weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// "2026-08-05" → "Wed 5 Aug". Integer weekday math, no formatter.
    static func dayLabel(_ ymd: String) -> String {
        let day = String(ymd.prefix(10))
        let parts = day.split(separator: "-")
        guard parts.count == 3, let d = Int(parts[2]), let m = Int(parts[1]),
              let weekday = SnapshotDate.weekdayIndex(day)
        else { return day }
        return "\(weekdayNames[weekday]) \(d) \(label(String(day.prefix(7))))"
    }

    static func weekdayName(_ index: Int) -> String {
        weekdayNames[max(0, min(6, index))]
    }

    /// How many times each weekday occurred between two days, inclusive —
    /// the denominator for a per-weekday average. The current month stops at
    /// today, so a Monday that hasn't happened yet isn't counted against you.
    static func weekdayOccurrences(from start: String, to end: String) -> [Int] {
        var counts = [Int](repeating: 0, count: 7)
        guard var date = SnapshotDate.parse(start),
              let last = SnapshotDate.parse(end), date <= last
        else { return counts }
        while date <= last {
            if let index = SnapshotDate.weekdayIndex(SydneyTime.dayString(date)) {
                counts[index] += 1
            }
            date = date.addingTimeInterval(86400)
        }
        return counts
    }

    /// Last day of a month key ("2026-08" → "2026-08-31").
    static func lastDay(ofMonth key: String) -> String {
        guard let year = Int(key.prefix(4)), let month = Int(key.suffix(2)) else { return key }
        let lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        var days = lengths[max(0, min(11, month - 1))]
        if month == 2, (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 { days = 29 }
        return String(format: "%@-%02d", key, days)
    }

    /// Bucket records into days, newest first, each with a subtotal. This is
    /// what turns an endless feed into something scannable — the reader gets
    /// "Wed 5 Aug · ฿1.2K" as an anchor instead of re-reading a date on
    /// every row.
    static func groupByDay<Item>(
        _ items: [Item],
        date: (Item) -> String,
        value: (Item) -> Double
    ) -> [DayGroup<Item>] {
        var buckets: [String: [Item]] = [:]
        for item in items {
            buckets[String(date(item).prefix(10)), default: []].append(item)
        }
        return buckets.keys.sorted(by: >).map { day in
            let rows = buckets[day] ?? []
            return DayGroup(
                id: day,
                label: dayLabel(day),
                total: rows.reduce(0) { $0 + value($1) },
                items: rows
            )
        }
    }
}

// MARK: - Month scoping

/// Horizontal month chips — the fix for "the list never ends".
///
/// A ledger page defaults to showing every record ever, which is a scroll
/// with no bottom and no way to answer "what did I spend in June". Scoping
/// to one month bounds it; "All" stays available for the rare full sweep.
struct MonthScopeStrip: View {
    let months: [MonthFlow]
    @Binding var selection: String?   // nil = All
    let tint: Color
    /// With a formatter, each month chip carries its total — pick a month by
    /// its number, not by remembering which month was which.
    var format: ((Double) -> String)? = nil

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                // "All" leads: it's the reset, and the strip opens on it.
                chip(title: "All", subtitle: nil, value: nil)
                ForEach(months.reversed()) { flow in
                    chip(
                        title: flow.label,
                        subtitle: format.map { fmt in
                            flow.isCurrent ? "\(fmt(flow.total)) …" : fmt(flow.total)
                        },
                        value: flow.key
                    )
                }
            }
            .padding(.horizontal, 2)
        }
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func chip(title: String, subtitle: String?, value: String?) -> some View {
        let active = selection == value
        return Button {
            withAnimation(.snappy(duration: 0.2)) { selection = value }
        } label: {
            VStack(spacing: 1) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 8, design: .monospaced))
                        .opacity(0.75)
                }
            }
            .foregroundStyle(active ? Color.black : Color.primary)
            .padding(.horizontal, 11)
            .padding(.vertical, subtitle == nil ? 8 : 4)
            .background(
                active ? AnyShapeStyle(tint) : AnyShapeStyle(Color.white.opacity(0.07)),
                in: .capsule
            )
            .overlay(
                Capsule().strokeBorder(
                    active ? Color.clear : tint.opacity(0.0), lineWidth: 1
                )
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Insights

/// One plain-language finding. The research is blunt about this: numbers on
/// their own aren't insight — "Food is 35% above your 3-month average" is.
struct Insight: Identifiable {
    let icon: String
    let text: String
    let value: String
    var tint: Color = .primary
    var id: String { icon + text }
}

struct InsightsCard: View {
    let title: String
    let insights: [Insight]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).labelMono()
            ForEach(insights) { insight in
                HStack(spacing: 9) {
                    Image(systemName: insight.icon)
                        .font(.system(size: 11))
                        .foregroundStyle(insight.tint)
                        .frame(width: 16)
                    Text(insight.text)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Spacer(minLength: 6)
                    Text(insight.value)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(insight.tint)
                        .fixedSize()
                }
            }
        }
        .padding(16)
        .financeCard()
    }
}

/// Seven bars, one per weekday — habits show up here that a monthly total
/// hides. Deliberately unlabelled on the y: the shape is the message, and
/// the busiest day is named in words above it.
struct WeekdayPatternCard: View {
    let totals: [Double]      // index 0 = Sunday
    /// How many of each weekday actually occurred in the scoped window, so
    /// the average divides by real opportunities rather than a flat 4.
    let occurrences: [Int]
    let tint: Color
    let format: (Double) -> String

    @State private var showAverage = true

    /// Average spend per occurrence — the honest "what does a Monday cost me".
    /// A raw total makes whichever weekday happened five times in the month
    /// look like a habit when it's just the calendar.
    private var values: [Double] {
        guard showAverage else { return totals }
        return totals.enumerated().map { index, total in
            let count = occurrences.indices.contains(index) ? occurrences[index] : 0
            return count > 0 ? total / Double(count) : 0
        }
    }

    private var peak: Int? {
        let series = values
        guard let max = series.max(), max > 0 else { return nil }
        return series.firstIndex(of: max)
    }

    /// Bar under the finger (or last touched) — the readout's subject.
    @State private var selectedDay: String?
    private var selectedIndex: Int? {
        guard let selectedDay else { return nil }
        return (0..<7).first { FlowMath.weekdayName($0) == selectedDay }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("By weekday").labelMono()
                Spacer()
                Picker("", selection: $showAverage) {
                    Text("Avg").tag(true)
                    Text("Total").tag(false)
                }
                .pickerStyle(.segmented)
                .frame(width: 110)
            }
            // One line, two jobs: the touched bar's numbers, else the peak
            // finding. Reserved so the card doesn't jump under the finger.
            Group {
                if let index = selectedIndex {
                    let count = occurrences.indices.contains(index) ? occurrences[index] : 0
                    let avg = count > 0 ? totals[index] / Double(count) : 0
                    Text("\(FlowMath.weekdayName(index)) · avg \(format(avg)) · total \(format(totals[index])) · \(count) day\(count == 1 ? "" : "s")")
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)
                } else if let peak {
                    Text(showAverage
                         ? "\(FlowMath.weekdayName(peak)) costs the most on average · touch a bar"
                         : "Most spent on \(FlowMath.weekdayName(peak)) · touch a bar")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(minHeight: 12, alignment: .leading)
            Chart(Array(values.enumerated()), id: \.offset) { index, total in
                BarMark(
                    x: .value("Day", FlowMath.weekdayName(index)),
                    y: .value("Total", total),
                    width: .ratio(0.5)
                )
                .cornerRadius(3)
                // Emphasis, not category: the touched bar (else the peak) is
                // the finding, the rest is context — two weights, one hue.
                .foregroundStyle(tint.opacity(
                    selectedIndex.map { $0 == index ? 0.95 : 0.28 }
                        ?? (index == peak ? 0.95 : 0.32)
                ))
                .annotation(position: .top, spacing: 2) {
                    if index == (selectedIndex ?? peak), total > 0 {
                        Text(format(total))
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .chartXSelection(value: $selectedDay)
            .chartXScale(domain: (0..<7).map { FlowMath.weekdayName($0) })
            .chartYAxis(.hidden)
            .chartXAxis {
                AxisMarks { _ in
                    AxisValueLabel()
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(height: 70)
        }
        .padding(16)
        .financeCard()
    }
}

/// "↑23% vs Jul pace" — same-day-of-month comparison, colored by whether
/// the direction is good for THIS flow (income up = volt, spend up = pink).
struct PaceBadge: View {
    let current: Double
    let previousSameDay: Double
    let upIsGood: Bool

    var body: some View {
        let pct = (current - previousSameDay) / previousSameDay * 100
        let up = pct >= 0
        let good = up == upIsGood
        let lastMonth = FlowMath.label(FlowMath.monthKeys(back: 2)[0])

        HStack(spacing: 4) {
            Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 8, weight: .bold))
            Text("\(up ? "+" : "")\(String(format: "%.0f", pct))% vs \(lastMonth) pace")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
        }
        .foregroundStyle(good ? Ledger.income : Ledger.expense)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background((good ? Ledger.income : Ledger.expense).opacity(0.12), in: .capsule)
    }
}

/// A quiet label+value stat, for the chips row under a hero number.
struct StatChip: View {
    let label: String
    let value: String
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(tint)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.white.opacity(0.05), in: .rect(cornerRadius: 9))
    }
}

/// Six months of a single flow as bars — magnitude over discrete periods is
/// bar territory; a line would imply flow between month boundaries.
///
/// The current month is real but incomplete, so it's drawn hollow-dim with a
/// "so far" annotation rather than pretending to be a finished bar. Labels
/// are selective (the max month and the current one), the axis recessive.
struct MonthTrendCard: View {
    let title: String
    let flows: [MonthFlow]
    let tint: Color
    let format: (Double) -> String
    /// Category composition for the same window. Empty = no toggle offered.
    var slices: [CategorySlice] = []
    var order: [String] = []
    var color: (String) -> Color = { _ in .gray }
    /// The page's month filter. When present, touching a bar offers "Filter"
    /// — the chart becomes the month picker, not just a picture of one.
    var scope: Binding<String?>? = nil

    // Screenshot runs can open straight into the stacked view.
    @State private var showCategories =
        ProcessInfo.processInfo.environment["VESTA_TREND_CATEGORY"] != nil
    @State private var selectedLabel: String?

    private var maxFlow: MonthFlow? {
        flows.filter { !$0.isCurrent }.max { $0.total < $1.total }
    }

    private var selectedFlow: MonthFlow? {
        flows.first { $0.label == selectedLabel }
    }
    /// The month before the touched one, for the delta line.
    private var previousFlow: MonthFlow? {
        guard let sel = selectedFlow,
              let index = flows.firstIndex(where: { $0.key == sel.key }),
              index > 0 else { return nil }
        return flows[index - 1]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).labelMono()
                Spacer()
                if !slices.isEmpty {
                    // Same bars, same totals — the toggle only decides whether
                    // each bar is split into what made it up.
                    Picker("", selection: $showCategories) {
                        Text("Total").tag(false)
                        Text("Category").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 150)
                }
            }

            readout

            if showCategories {
                categoryChart
            } else {
                totalChart
            }
        }
        .padding(16)
        .financeCard()
        .sensoryFeedback(.selection, trigger: selectedLabel)
    }

    /// The touched month, in numbers: total, vs the month before, its top
    /// category — and the button that filters the page to it. Reserved
    /// height so the card never jumps under the finger.
    private var readout: some View {
        HStack(spacing: 8) {
            if let sel = selectedFlow {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text("\(sel.label) · \(format(sel.total))\(sel.isCurrent ? " so far" : "")")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        if let prev = previousFlow, prev.total > 0.01, !sel.isCurrent {
                            let pct = (sel.total - prev.total) / prev.total * 100
                            Text("\(pct >= 0 ? "↑" : "↓")\(String(format: "%.0f", abs(pct)))% vs \(prev.label)")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(pct >= 0 ? Ledger.income : Ledger.expense)
                        }
                    }
                    if let top = topCategory(sel.key) {
                        Text("top: \(top.0) \(format(top.1))")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer()
                if let scope {
                    if scope.wrappedValue == sel.key {
                        readoutButton("Clear filter") {
                            withAnimation(.snappy(duration: 0.2)) { scope.wrappedValue = nil }
                        }
                    } else {
                        readoutButton("Filter \(sel.label)") {
                            withAnimation(.snappy(duration: 0.2)) { scope.wrappedValue = sel.key }
                        }
                    }
                }
            } else {
                Text(scope != nil
                     ? "touch a bar to inspect · Filter scopes the page to it"
                     : "touch a bar to inspect")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
                Spacer()
            }
        }
        .frame(minHeight: 26)
    }

    private func readoutButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(Color.black)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(tint, in: .capsule)
        }
        .buttonStyle(.plain)
    }

    private func topCategory(_ monthKey: String) -> (String, Double)? {
        slices
            .filter { $0.monthKey == monthKey && $0.category != FlowMath.otherCategory }
            .max { $0.total < $1.total }
            .map { ($0.category, $0.total) }
    }

    /// Emphasis for one bar: the touched one wins, else the page's scoped
    /// month, else the resting look (live month dimmed).
    private func barOpacity(_ flow: MonthFlow, resting: Double) -> Double {
        if let selectedLabel {
            return flow.label == selectedLabel ? 0.95 : 0.28
        }
        if let scoped = scope?.wrappedValue {
            return flow.key == scoped ? 0.95 : 0.28
        }
        return resting
    }

    /// Stacked composition: bar height is still the month's total, and each
    /// band is a category. Colours come from the same map the rest of the app
    /// uses, so a category is the same hue everywhere.
    private var categoryChart: some View {
        Chart(slices) { slice in
            BarMark(
                x: .value("Month", slice.monthLabel),
                y: .value("Total", slice.total),
                width: .ratio(0.55)
            )
            .foregroundStyle(by: .value("Category", slice.category))
            // The live month is real but unfinished — dimmed, same as the
            // total view, rather than posing as a complete bar. Touch and
            // scope emphasis stack on top of that.
            .opacity((slice.isCurrent ? 0.45 : 1) * barOpacity(
                MonthFlow(key: slice.monthKey, label: slice.monthLabel, total: 0, isCurrent: slice.isCurrent),
                resting: 1
            ))
            .cornerRadius(2)
            .annotation(position: .top, spacing: 3) {
                if slice.isTop {
                    monthTotalLabel(for: slice)
                }
            }
        }
        .chartXSelection(value: $selectedLabel)
        .chartForegroundStyleScale(
            domain: order,
            range: order.map { $0 == FlowMath.otherCategory ? Color.gray.opacity(0.55) : color($0) }
        )
        .chartLegend(position: .bottom, spacing: 8)
        .chartXScale(domain: flows.map(\.label))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel()
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(height: 150)
    }

    @ViewBuilder
    private func monthTotalLabel(for slice: CategorySlice) -> some View {
        let total = slices.filter { $0.monthKey == slice.monthKey }
            .reduce(0) { $0 + $1.total }
        VStack(spacing: 0) {
            Text(format(total))
                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
            if slice.isCurrent {
                Text("so far")
                    .font(.system(size: 7, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private var totalChart: some View {
        Chart(flows) { flow in
                BarMark(
                    x: .value("Month", flow.label),
                    y: .value("Total", flow.total),
                    width: .ratio(0.55)
                )
                .cornerRadius(4)
                .foregroundStyle(
                    AnyShapeStyle(tint.opacity(
                        barOpacity(flow, resting: flow.isCurrent ? 0.38 : 0.9)
                    ))
                )
                .annotation(position: .top, spacing: 3) {
                    // Selective: the benchmark month and the live one.
                    if flow.isCurrent {
                        VStack(spacing: 0) {
                            Text(format(flow.total))
                                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                                .foregroundStyle(.primary)
                            Text("so far")
                                .font(.system(size: 7, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                    } else if flow.key == maxFlow?.key, flow.total > 0 {
                        Text(format(flow.total))
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        .chartXSelection(value: $selectedLabel)
        .chartXScale(domain: flows.map(\.label))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel()
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(height: 110)
    }
}
