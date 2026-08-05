import SwiftUI
import Charts

/// "Would I be richer if the same money had gone into the index on the same
/// days?" — the shadow-portfolio comparison, ported from the web's
/// dca-benchmark so the two can't disagree on method.
///
/// Both sides are PROFIT AND LOSS, not ending value: capital you deposited is
/// not performance, so `invested = opening + netFlows` is subtracted from
/// both. The counterfactual deploys exactly the same capital on exactly the
/// same dates, which is what makes the two lines directly comparable.
enum DcaCompare {
    struct PricePoint: Decodable {
        let date: String
        /// Adjusted close — dividends folded in, a total-return series.
        let close: Double
    }

    struct Series {
        let dates: [Date]
        let minePct: [Double]  // cumulative % growth of a dollar in YOUR basket
        let indexPct: [Double] // cumulative % growth of a dollar in the index
    }

    /// Latest value at or before `day` (forward-fill over weekends/holidays).
    /// `rows` ascending by date string.
    static func asOf(_ rows: [(date: String, value: Double)], _ day: String) -> Double? {
        var lo = 0, hi = rows.count - 1
        var found: Double?
        while lo <= hi {
            let mid = (lo + hi) / 2
            if rows[mid].date <= day { found = rows[mid].value; lo = mid + 1 }
            else { hi = mid - 1 }
        }
        return found
    }

    /// Net buys − sells per day in USD, ascending. Positive = money in.
    static func flowsByDay(_ txs: [PortfolioTransaction]) -> [(date: String, value: Double)] {
        var byDay: [String: Double] = [:]
        for tx in txs {
            let usd = Money.convert(tx.totalAmount, from: tx.currency, to: "USD")
            byDay[String(tx.date.prefix(10)), default: 0] += tx.type == "buy" ? usd : -usd
        }
        return byDay.filter { abs($0.value) > 0.005 }
            .map { (date: $0.key, value: $0.value) }
            .sorted { $0.date < $1.date }
    }

    /// Daily closes of a snapshot series: last reading per day, USD.
    static func dailyValues(_ parsed: [(date: Date, valueUsd: Double)]) -> [(date: String, value: Double)] {
        var byDay: [String: Double] = [:]
        for row in parsed { byDay[SydneyTime.dayString(row.date)] = row.valueUsd } // ascending → last wins
        return byDay.map { (date: $0.key, value: $0.value) }.sorted { $0.date < $1.date }
    }

    /// Two pots as one: union of days, each side forward-filled. The combined
    /// series only starts once BOTH pots have a reading — summing one pot
    /// with the other's zero would draw a fake cliff at the join.
    static func combinedDaily(
        _ a: [(date: String, value: Double)], _ b: [(date: String, value: Double)]
    ) -> [(date: String, value: Double)] {
        let days = Set(a.map(\.date)).union(b.map(\.date)).sorted()
        return days.compactMap { day in
            guard let va = asOf(a, day), let vb = asOf(b, day) else { return nil }
            return (day, va + vb)
        }
    }

    /// Flow schedules merged by day.
    static func mergedFlows(
        _ a: [(date: String, value: Double)], _ b: [(date: String, value: Double)]
    ) -> [(date: String, value: Double)] {
        var byDay: [String: Double] = [:]
        for flow in a + b { byDay[flow.date, default: 0] += flow.value }
        return byDay.filter { abs($0.value) > 0.005 }
            .map { (date: $0.key, value: $0.value) }
            .sorted { $0.date < $1.date }
    }

    /// Growth of the same money: your basket per-dollar vs the index per-dollar.
    ///
    /// "If all my money sat in my stocks vs all in SPY, what would happen?"
    /// is a per-unit question, so deposits must not move the answer — your
    /// side chains segment returns with the segment's net flows removed
    /// (r = (V_t − ΣF) / V_prev, time-weighted, flows at end), and the index
    /// side is its price path rebased to the window start; per dollar, any
    /// flow schedule into an index grows at its price return.
    ///
    /// Chained between REAL readings only, never forward-fill. The snapshot
    /// cron was down 19 May–24 Jun, and a day-walker that forward-filled the
    /// stale value divided every mid-gap buy against a frozen denominator —
    /// each one manufacturing a permanent fake loss (the "−20%" that
    /// contradicted every P&L surface). A gap is one segment: its true
    /// multi-week return, flows netted, chains in as a unit.
    static func build(
        values: [(date: String, value: Double)],
        flows: [(date: String, value: Double)],
        prices: [PricePoint],
        start: String
    ) -> Series? {
        let priceRows = prices.map { (date: $0.date, value: $0.close) }
        let today = SydneyTime.today()
        let readings = values.filter { $0.date >= start && $0.date <= today }
        guard let startPrice = asOf(priceRows, start), startPrice > 0,
              var previous = asOf(values, start), previous > 1,
              readings.count >= 2
        else { return nil }

        let inWindow = flows.filter { $0.date > start && $0.date <= today }
            .sorted { $0.date < $1.date }
        var flowIndex = 0
        var previousDay = start

        var dates: [Date] = []
        var minePct: [Double] = []
        var indexPct: [Double] = []
        var growth = 1.0

        for reading in readings {
            // Net flows that landed since the last real reading.
            var segmentFlows = 0.0
            while flowIndex < inWindow.count, inWindow[flowIndex].date <= reading.date {
                segmentFlows += inWindow[flowIndex].value
                flowIndex += 1
            }
            if reading.date > previousDay, previous > 1 {
                let r = (reading.value - segmentFlows) / previous
                // One-day ratios outside 0.5–2 are snapshot artifacts — a real
                // day never halves or doubles these pots. Multi-day segments
                // (tracking gaps) pass through: a 5-week move can be anything.
                let days = (SnapshotDate.parse(reading.date).flatMap { end in
                    SnapshotDate.parse(previousDay).map { end.timeIntervalSince($0) / 86400 }
                }) ?? 1
                if r > 0, days > 2 || (r > 0.5 && r < 2.0) { growth *= r }
            }
            previous = reading.value
            previousDay = reading.date
            if let date = SnapshotDate.parse(reading.date),
               let price = asOf(priceRows, reading.date) {
                dates.append(date)
                minePct.append((growth - 1) * 100)
                indexPct.append((price / startPrice - 1) * 100)
            }
        }
        guard dates.count >= 2 else { return nil }
        return Series(dates: dates, minePct: minePct, indexPct: indexPct)
    }
}

// MARK: Crypto scope (port of crypto-performance.ts)
//
// The crypto investment pot is the NON-cash tokens: stablecoins are the cash
// layer, so buys of investment tokens are deposits from cash, sells are
// withdrawals to cash, and transfers (bot profits / yield) are zero-flow —
// their value surfaces in the pot's growth, i.e. as return.
extension DcaCompare {
    /// Net non-cash buys − sells per day, USD.
    static func cryptoFlowsByDay(
        _ txs: [CryptoTransaction], isCash: (String) -> Bool
    ) -> [(date: String, value: Double)] {
        var byDay: [String: Double] = [:]
        for tx in txs {
            guard tx.type == "buy" || tx.type == "sell", !isCash(tx.token),
                  let usd = tx.totalValueUsd, usd.isFinite else { continue }
            byDay[String(tx.date.prefix(10)), default: 0] += tx.type == "buy" ? usd : -usd
        }
        return byDay.filter { abs($0.value) > 0.005 }
            .map { (date: $0.key, value: $0.value) }
            .sorted { $0.date < $1.date }
    }

    /// Snapshot value minus the forward-filled stable balance ($1/unit,
    /// floored at 0) — the pot the flows above deposit into.
    static func cryptoPotValues(
        _ snapshots: [(date: String, value: Double)],
        txs: [CryptoTransaction], isCash: (String) -> Bool
    ) -> [(date: String, value: Double)] {
        var deltaByDay: [String: Double] = [:]
        for tx in txs where isCash(tx.token) {
            let sign: Double = (tx.type == "buy" || tx.type == "transferIn") ? 1 : -1
            deltaByDay[String(tx.date.prefix(10)), default: 0] += sign * tx.amount
        }
        var balance = 0.0
        let stableDays: [(date: String, balance: Double)] = deltaByDay.keys.sorted().map { day in
            balance = max(0, balance + (deltaByDay[day] ?? 0))
            return (day, balance)
        }

        var si = -1
        var level = 0.0
        var out: [(date: String, value: Double)] = []
        for snap in snapshots {
            while si + 1 < stableDays.count, stableDays[si + 1].date <= snap.date {
                si += 1
                level = stableDays[si].balance
            }
            let v = snap.value - level
            if v > 0 { out.append((snap.date, v)) }
        }
        return out
    }
}

/// Fetches index closes from the app's own /api/benchmark (adjusted close —
/// raw close would understate SPY by its ~1.2%/yr dividend yield and bias
/// every comparison in the portfolio's favour).
enum BenchmarkAPI {
    static func prices(symbol: String, from: String) async throws -> [DcaCompare.PricePoint] {
        guard let base = Settings.endpointBase else { throw URLError(.badURL) }
        var components = URLComponents(
            url: base.appendingPathComponent("api/benchmark"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "symbol", value: symbol),
            URLQueryItem(name: "from", value: from),
        ]
        guard let url = components?.url else { throw URLError(.badURL) }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        struct Payload: Decodable { let prices: [DcaCompare.PricePoint] }
        return try JSONDecoder().decode(Payload.self, from: data).prices
    }
}

/// Growth of the same money: a dollar in this pot vs a dollar in the
/// benchmark, both rebased to 0% at the window start.
struct Benchmark: Identifiable, Hashable {
    let symbol: String  // /api/benchmark symbol
    let label: String   // legend name
    let color: Color
    var id: String { symbol }

    static let sp500 = Benchmark(symbol: "SPY", label: "S&P 500", color: Ledger.seriesStocks)
    static let btc = Benchmark(symbol: "BTC", label: "BTC", color: Ledger.seriesCrypto)
}

struct PerfCompareCard: View {
    @Environment(DataStore.self) private var store
    let start: String
    /// One = fixed comparison; several = a picker chooses, first is default.
    let benchmarks: [Benchmark]
    let values: [(date: String, value: Double)]
    let flows: [(date: String, value: Double)]

    @State private var selected: Benchmark
    @State private var prices: [DcaCompare.PricePoint]?
    @State private var failed = false
    @State private var scrubDate: Date?

    init(
        start: String, benchmarks: [Benchmark],
        values: [(date: String, value: Double)], flows: [(date: String, value: Double)]
    ) {
        self.start = start
        self.benchmarks = benchmarks
        self.values = values
        self.flows = flows
        _selected = State(initialValue: benchmarks[0])
    }

    private var series: DcaCompare.Series? {
        guard let prices else { return nil }
        return DcaCompare.build(values: values, flows: flows, prices: prices, start: start)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("You vs \(selected.label) · since \(FlowMath.dayLabel(start))").labelMono()
                Spacer()
                if benchmarks.count > 1 {
                    Picker("", selection: $selected) {
                        ForEach(benchmarks) { bench in
                            Text(bench.label).tag(bench)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 140)
                }
            }

            if let series {
                content(series)
            } else if failed {
                VStack(spacing: 8) {
                    Text("Couldn't load \(selected.label) prices.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("Retry") { Task { await load() } }
                        .font(.footnote.weight(.semibold))
                        .tint(Ledger.income)
                }
                .frame(maxWidth: .infinity, minHeight: 120)
            } else if prices != nil {
                Text("Tracked history starts after \(FlowMath.dayLabel(start)) — nothing to compare from.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .padding(16)
        .financeCard()
        .task(id: selected.symbol) { await load() }
    }

    /// Index of the reading nearest the scrub position.
    private func scrubIndex(_ series: DcaCompare.Series) -> Int? {
        guard let scrubDate, !series.dates.isEmpty else { return nil }
        return series.dates.indices.min {
            abs(series.dates[$0].timeIntervalSince(scrubDate))
                < abs(series.dates[$1].timeIntervalSince(scrubDate))
        }
    }

    @ViewBuilder
    private func content(_ series: DcaCompare.Series) -> some View {
        // Hold on the chart → every number on the card reads at that day.
        let at = scrubIndex(series)
        let minePct = at.map { series.minePct[$0] } ?? (series.minePct.last ?? 0)
        let indexPct = at.map { series.indexPct[$0] } ?? (series.indexPct.last ?? 0)
        let lead = minePct - indexPct
        let ahead = lead >= 0

        // Verdict first, in words. Points, not %: the difference of two
        // percentages is percentage points.
        HStack(spacing: 6) {
            Image(systemName: ahead ? "arrow.up.right" : "arrow.down.right")
                .font(.caption2.bold())
            Text("\(ahead ? "ahead of" : "behind") \(selected.label) by \(String(format: "%.1f", abs(lead))) pts")
                .font(.system(.caption, design: .monospaced, weight: .semibold))
            if let at {
                Text("· \(series.dates[at].formatted(.dateTime.day().month(.abbreviated)))")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(ahead ? Ledger.income : Ledger.expense)

        // Y-domain from the bulk of the data (2nd–98th pct): one artifact day
        // must not flatten the story the other ~95 days are telling.
        let allPct = (series.minePct + series.indexPct).sorted()
        let lo = allPct[Int(Double(allPct.count - 1) * 0.02)]
        let hi = allPct[Int(Double(allPct.count - 1) * 0.98)]
        let span = max(hi - lo, 1)
        let yLow = min(lo - span * 0.25, -1)
        let yHigh = max(hi + span * 0.25, 1)

        Chart {
            RuleMark(y: .value("Flat", 0))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 4]))
                .foregroundStyle(.white.opacity(0.18))

            ForEach(Array(series.dates.enumerated()), id: \.offset) { i, date in
                LineMark(
                    x: .value("Date", date),
                    y: .value("Growth", series.minePct[i]),
                    series: .value("s", "mine")
                )
                .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                .foregroundStyle(Ledger.income)

                LineMark(
                    x: .value("Date", date),
                    y: .value("Growth", series.indexPct[i]),
                    series: .value("s", "bench")
                )
                .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                .foregroundStyle(selected.color)
            }

            if let at {
                RuleMark(x: .value("Date", series.dates[at]))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .foregroundStyle(.secondary.opacity(0.7))
                PointMark(x: .value("Date", series.dates[at]), y: .value("Growth", series.minePct[at]))
                    .symbolSize(70).foregroundStyle(.white)
                PointMark(x: .value("Date", series.dates[at]), y: .value("Growth", series.minePct[at]))
                    .symbolSize(26).foregroundStyle(Ledger.income)
                PointMark(x: .value("Date", series.dates[at]), y: .value("Growth", series.indexPct[at]))
                    .symbolSize(70).foregroundStyle(.white)
                PointMark(x: .value("Date", series.dates[at]), y: .value("Growth", series.indexPct[at]))
                    .symbolSize(26).foregroundStyle(selected.color)
            }
        }
        .sensoryFeedback(.selection, trigger: at)
        .chartYScale(domain: yLow...yHigh)
        .chartXSelection(value: $scrubDate)
        // Charts does NOT clip marks to the plot area by default.
        .chartPlotStyle { $0.clipped() }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine().foregroundStyle(.white.opacity(0.05))
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text("\(v >= 0 ? "+" : "")\(String(format: "%.0f", v))%")
                            .font(.system(size: 8, design: .monospaced))
                    }
                }
            }
        }
        // Hand-placed ticks: .automatic labels the domain edge, where the
        // text clips to an ellipsis. fixedSize so Charts can't truncate.
        .chartXAxis {
            let ticks: [Date] = {
                guard let first = series.dates.first, let last = series.dates.last else { return [] }
                let span = last.timeIntervalSince(first)
                return [0.10, 0.5, 0.88].map { first.addingTimeInterval(span * $0) }
            }()
            return AxisMarks(values: ticks) { value in
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(date, format: .dateTime.day().month(.abbreviated))
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .fixedSize()
                    }
                }
            }
        }
        .frame(height: 170)

        HStack(spacing: 8) {
            chip("You", minePct, Ledger.income)
            chip(selected.label, indexPct, selected.color)
            Spacer(minLength: 0)
        }

        Text("growth of the same dollar · deposits neutralized (time-weighted) · dividends in S&P 500")
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.tertiary)
    }

    private func chip(_ name: String, _ pctValue: Double, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(name)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .lineLimit(1)
            }
            Text("\(pctValue >= 0 ? "+" : "")\(String(format: "%.1f", pctValue))%")
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(pctValue >= 0 ? Ledger.income : Ledger.expense)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(Color.white.opacity(0.05), in: .rect(cornerRadius: 9))
    }

    private func load() async {
        failed = false
        prices = nil
        do {
            prices = try await BenchmarkAPI.prices(symbol: selected.symbol, from: start)
        } catch {
            failed = true
        }
    }
}
