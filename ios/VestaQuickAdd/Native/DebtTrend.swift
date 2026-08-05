import SwiftUI
import Charts

/// Daily replay of what the debt ledger was worth, for the Debts page trend.
enum DebtHistory {
    /// Signed net per day (USD) over the trailing `months`: positive = owed to
    /// me, negative = I owe. Same sign convention as the dashboard overlay, so
    /// the two can't disagree.
    ///
    /// Walks days ascending and advances a per-debt payment cursor alongside,
    /// so the whole replay is O(days + payments) rather than re-summing every
    /// transaction for every day.
    static func series(
        debts: [DebtRecord],
        txs: [DebtTransaction],
        months: Int
    ) -> [(date: Date, netUsd: Double)] {
        guard !debts.isEmpty, let firstMonth = FlowMath.monthKeys(back: months).first,
              let start = SnapshotDate.parse(firstMonth + "-01")
        else { return [] }

        let createdDay = debts.map {
            SydneyTime.dayString(Date(timeIntervalSince1970: $0.createdAt / 1000))
        }

        var payments: [String: [(day: String, amount: Double)]] = [:]
        for tx in txs {
            payments[tx.debtId, default: []].append((String(tx.date.prefix(10)), tx.amount))
        }
        for key in payments.keys { payments[key]?.sort { $0.day < $1.day } }

        var cursor = [Int](repeating: 0, count: debts.count)
        var paid = [Double](repeating: 0, count: debts.count)

        var out: [(date: Date, netUsd: Double)] = []
        var date = start
        let now = Date()
        while date <= now {
            let day = SydneyTime.dayString(date)
            var net = 0.0
            for (index, debt) in debts.enumerated() {
                // Roll this debt's payments forward to `day`.
                if let schedule = payments[debt.id] {
                    while cursor[index] < schedule.count, schedule[cursor[index]].day <= day {
                        paid[index] += schedule[cursor[index]].amount
                        cursor[index] += 1
                    }
                }
                guard createdDay[index] <= day else { continue }
                let balance = debt.originalAmount - paid[index]
                let signed = debt.direction == "owed_to_me" ? balance : -balance
                net += Money.convert(signed, from: debt.currency, to: "USD")
            }
            out.append((date, net))
            date = date.addingTimeInterval(86400)
        }
        return out
    }
}

/// Net debt over time, as a step area.
///
/// Step interpolation, not a smooth line: the balance holds flat until a
/// repayment replaces it, so the horizontal runs are "nothing happened" and
/// the verticals are the days money moved — a diagonal would assert a gradual
/// paydown that never occurred. Dots mark the events themselves.
///
/// The scale is fitted to the data and both ends are labelled rather than
/// anchored at zero: on a ฿500k balance, a ฿20k repayment anchored at zero is
/// invisible, and progress is the entire question this card exists to answer.
/// The zero rule appears only when the ledger actually crosses it.
struct DebtTrendCard: View {
    let points: [(date: Date, netUsd: Double)]
    let convert: (Double) -> Double
    let format: (Double) -> String

    private struct Point: Identifiable {
        let date: Date
        let value: Double
        var id: Date { date }
    }

    private var series: [Point] {
        points.map { Point(date: $0.date, value: convert($0.netUsd)) }
    }

    var body: some View {
        let values = series.map(\.value)
        let low = values.min() ?? 0
        let high = values.max() ?? 0
        let pad = max((high - low) * 0.2, max(abs(high), 1) * 0.02)
        let floor = low - pad
        let current = values.last ?? 0
        let change = (values.last ?? 0) - (values.first ?? 0)
        let events = zip(series, series.dropFirst()).compactMap { previous, next in
            abs(next.value - previous.value) > 0.005 ? next : nil
        }
        // A ledger that never moved has one value, not a range.
        let axisValues: [Double] = (high - low) > max(abs(high), 1) * 0.001
            ? [low, high] : [high]

        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Net position · 6 months").labelMono()
                Spacer()
                if abs(change) > 0.01 {
                    // Rising net = the balance owed shrank.
                    Text("\(change > 0 ? "↓" : "↑")\(format(abs(change))) \(change > 0 ? "paid down" : "added")")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(change > 0 ? Ledger.income : Ledger.expense)
                }
            }

            Text(format(abs(current)))
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(current < 0 ? Ledger.expense : Ledger.income)
            Text(current < 0 ? "owed by you" : "owed to you")
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.tertiary)

            Chart {
                ForEach(series) { point in
                    AreaMark(
                        x: .value("Date", point.date),
                        yStart: .value("Floor", floor),
                        yEnd: .value("Net", point.value),
                        series: .value("s", "debt-area")
                    )
                    .interpolationMethod(.stepEnd)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [Ledger.seriesDebt.opacity(0.3), Ledger.seriesDebt.opacity(0.02)],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                }
                ForEach(series) { point in
                    LineMark(
                        x: .value("Date", point.date),
                        y: .value("Net", point.value),
                        series: .value("s", "debt-line")
                    )
                    .interpolationMethod(.stepEnd)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineJoin: .round))
                    .foregroundStyle(Ledger.seriesDebt)
                }
                if low <= 0, high >= 0 {
                    RuleMark(y: .value("Clear", 0))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                        .foregroundStyle(.white.opacity(0.3))
                }
                ForEach(events) { point in
                    PointMark(x: .value("Date", point.date), y: .value("Net", point.value))
                        .symbolSize(22)
                        .foregroundStyle(Ledger.seriesDebt)
                }
            }
            .chartYScale(domain: floor...(high + pad))
            .chartYAxis {
                AxisMarks(position: .trailing, values: axisValues) { value in
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(format(v))
                                .font(.system(size: 8, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                    AxisValueLabel(format: .dateTime.month(.abbreviated))
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(height: 130)
        }
        .padding(16)
        .financeCard()
    }
}
