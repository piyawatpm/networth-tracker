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
