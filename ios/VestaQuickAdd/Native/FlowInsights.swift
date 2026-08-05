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

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(months.reversed()) { flow in
                    chip(title: flow.label, value: flow.key)
                }
                chip(title: "All", value: nil)
            }
            .padding(.horizontal, 2)
        }
    }

    private func chip(title: String, value: String?) -> some View {
        let active = selection == value
        return Button {
            withAnimation(.snappy(duration: 0.2)) { selection = value }
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(active ? Color.black : Color.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    active ? AnyShapeStyle(tint) : AnyShapeStyle(Color.white.opacity(0.07)),
                    in: .capsule
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
    let tint: Color
    let format: (Double) -> String

    private var peak: Int? {
        guard let max = totals.max(), max > 0 else { return nil }
        return totals.firstIndex(of: max)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("By weekday").labelMono()
                Spacer()
                if let peak {
                    Text("busiest · \(FlowMath.weekdayName(peak))")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
            Chart(Array(totals.enumerated()), id: \.offset) { index, total in
                BarMark(
                    x: .value("Day", FlowMath.weekdayName(index)),
                    y: .value("Total", total),
                    width: .ratio(0.5)
                )
                .cornerRadius(3)
                // Emphasis, not category: the peak is the finding, the rest
                // is context, so only two weights of the same hue.
                .foregroundStyle(tint.opacity(index == peak ? 0.95 : 0.32))
                .annotation(position: .top, spacing: 2) {
                    if index == peak, total > 0 {
                        Text(format(total))
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }
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

    private var maxFlow: MonthFlow? {
        flows.filter { !$0.isCurrent }.max { $0.total < $1.total }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).labelMono()

            Chart(flows) { flow in
                BarMark(
                    x: .value("Month", flow.label),
                    y: .value("Total", flow.total),
                    width: .ratio(0.55)
                )
                .cornerRadius(4)
                .foregroundStyle(
                    flow.isCurrent
                        ? AnyShapeStyle(tint.opacity(0.38))
                        : AnyShapeStyle(tint.opacity(0.9))
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
        .padding(16)
        .financeCard()
    }
}
