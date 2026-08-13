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
        let minePct: [Double]  // your P&L, % of capital deployed to date
        let indexPct: [Double] // same flows into the benchmark, same base
        let mineUsd: [Double]  // the baht question, USD at source
        let indexUsd: [Double]
    }

    /// The honest "all time" opening: no earlier than the first LOGGED flow.
    /// The portfolio history begins with hand-seeded monthly estimates
    /// (2025-10-01: 7200, 7800, 8200…) months before any transaction was
    /// logged — start there and estimated contributions read as market
    /// profit. Same clamp the web's bootstrap guard applies.
    static func clampedStart(
        values: [(date: String, value: Double)],
        flows: [(date: String, value: Double)]
    ) -> String? {
        guard let firstValue = values.first?.date else { return nil }
        guard let firstFlow = flows.first?.date else { return firstValue }
        return max(firstValue, firstFlow)
    }

    /// Latest value at or before `day` (forward-fill over weekends/holidays).
    /// `rows` ascending by date string.
    static func asOf(_ rows: [(date: String, value: Double)], _ day: String) -> Double? {
        asOfRow(rows, day)?.value
    }

    /// Same forward-fill, but keeps the reading's own date — build() needs to
    /// know whether the opening it read is genuinely from the start day or a
    /// stale fill from earlier.
    static func asOfRow(
        _ rows: [(date: String, value: Double)], _ day: String
    ) -> (date: String, value: Double)? {
        var lo = 0, hi = rows.count - 1
        var found: (date: String, value: Double)?
        while lo <= hi {
            let mid = (lo + hi) / 2
            if rows[mid].date <= day { found = rows[mid]; lo = mid + 1 }
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

    /// Same money, same days: your pot's P&L vs the same flows into the
    /// benchmark, both as a percent of capital deployed to date.
    ///
    /// P&L, not time-weighted, ON PURPOSE. Holding values here are marked by
    /// hand and lag the logged buys by days, and TWR multiplies each lag pair
    /// into a permanent fake loss (measured: −39% on a pot whose actual P&L
    /// was −4%). P&L only trusts level differences — a lagged mark wobbles
    /// the path for a few days and then self-corrects, and the endpoints are
    /// real readings. The benchmark side deploys identical capital on
    /// identical days, so the two lines stay directly comparable.
    ///
    ///   invested(t) = opening + netFlows(start, t]
    ///   yours(t)    = value(t) − invested(t)        (as % of invested)
    ///   bench(t)    = units(t)·price(t) − invested(t)
    ///
    /// where the opening balance buys benchmark units at the start price and
    /// each flow buys/sells at its day's close (clamped at zero — short is
    /// not a scenario the comparison can represent).
    static func build(
        values: [(date: String, value: Double)],
        flows: [(date: String, value: Double)],
        prices: [PricePoint],
        start: String,
        maskSettling: Bool = false
    ) -> Series? {
        let priceRows = prices.map { (date: $0.date, value: $0.close) }
        let today = SydneyTime.today()
        let readings = values.filter { $0.date >= start && $0.date <= today }
        guard let openingRow = asOfRow(values, start),
              let startPrice = asOf(priceRows, start), startPrice > 0,
              readings.count >= 2
        else { return nil }
        let opening = openingRow.value

        // Flows dated ON the start day: counted when the opening reading is
        // older than the start day itself — all-time starts at the first
        // logged flow, and when the last reading before it predates the buy,
        // that capital is in neither the opening nor the flows. The A$26.4k
        // super opening buy vanished from `invested` this way and came back
        // as fake profit (+143% instead of ~+14%).
        //
        // The date test alone has a loophole in COMBINED series: net worth
        // had a reading dated exactly on the start day (the crypto side did),
        // but its stocks half was still a stale forward-fill — same missing
        // capital, +58.8% instead of ~+8%. So start-day flows also count
        // when the day's buys exceed the entire opening reading: money that
        // big cannot plausibly already be inside it. When the opening
        // genuinely contains the buys (marks updated the same day), the
        // opening is at least as large as they are and the test stays false.
        // The 1.5× margin keeps a same-day-priced pot that opened slightly
        // below cost (crypto: $483 pot vs $500 buy after a small dip) from
        // tripping it — a genuine miss shows up as a multiple, not a hair.
        let startDayBuys = flows
            .filter { $0.date == start && $0.value > 0 }
            .reduce(0) { $0 + $1.value }
        let startDayCounts = openingRow.date < start
            || startDayBuys > openingRow.value * 1.5

        var invested = opening
        var units = opening / startPrice
        let inWindow = flows.filter {
            ($0.date > start || (startDayCounts && $0.date == start)) && $0.date <= today
        }
        .sorted { $0.date < $1.date }
        var flowIndex = 0

        // Settling windows of LARGE flows. Hand-marked values record a
        // deposit days after (or before) the flow itself, and every such
        // pair draws a fake tooth in the P&L path — +31.7% for exactly one
        // day at the June gap re-entry, −13pp dives on the July paydays.
        // Readings inside [flow − 1d, flow + 4d] are dropped FROM THE
        // DRAWING when the flow is ≥4% of capital: pure sampling, nothing
        // invented — the walk still processes every reading, so endpoints
        // and every kept point are the exact honest numbers. First and last
        // readings always survive. Off for crypto, whose snapshot values
        // price flows the same day.
        var settling: [(from: Date, to: Date)] = []
        if maskSettling {
            var probe = opening
            for flow in inWindow {
                let big = abs(flow.value) >= max(500, 0.04 * max(abs(probe), 1))
                probe += flow.value
                if big, let day = SnapshotDate.parse(flow.date) {
                    settling.append((
                        from: day.addingTimeInterval(-86400),
                        to: day.addingTimeInterval(4 * 86400)
                    ))
                }
            }
        }

        var dates: [Date] = []
        var minePct: [Double] = []
        var indexPct: [Double] = []
        var mineUsd: [Double] = []
        var indexUsd: [Double] = []

        for reading in readings {
            while flowIndex < inWindow.count, inWindow[flowIndex].date <= reading.date {
                let flow = inWindow[flowIndex]
                invested += flow.value
                if let px = asOf(priceRows, flow.date), px > 0 {
                    units = max(0, units + flow.value / px)
                }
                flowIndex += 1
            }
            guard let date = SnapshotDate.parse(reading.date),
                  let price = asOf(priceRows, reading.date),
                  abs(invested) > 1e-9
            else { continue }
            let mine = reading.value - invested
            let bench = units * price - invested
            dates.append(date)
            mineUsd.append(mine)
            indexUsd.append(bench)
            minePct.append(mine / abs(invested) * 100)
            indexPct.append(bench / abs(invested) * 100)
        }
        guard dates.count >= 2 else { return nil }

        if !settling.isEmpty {
            var kept: [Int] = []
            for index in dates.indices {
                let isEdge = index == 0 || index == dates.count - 1
                let masked = settling.contains {
                    dates[index] >= $0.from && dates[index] <= $0.to
                }
                if isEdge || !masked { kept.append(index) }
            }
            if kept.count >= 2 {
                dates = kept.map { dates[$0] }
                minePct = kept.map { minePct[$0] }
                indexPct = kept.map { indexPct[$0] }
                mineUsd = kept.map { mineUsd[$0] }
                indexUsd = kept.map { indexUsd[$0] }
            }
        }

        return Series(
            dates: dates, minePct: minePct, indexPct: indexPct,
            mineUsd: mineUsd, indexUsd: indexUsd
        )
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

/// Comparison windows, mirroring the dashboard chart's picker. Daily
/// readings are the finest grain the data has, so 1D would be two points —
/// the set starts at a week.
enum CompareWindow: String, CaseIterable {
    case w1 = "1W", m1 = "1M", m6 = "6M", y1 = "1Y", all = "All"

    var days: Int? {
        switch self {
        case .w1: 7
        case .m1: 30
        case .m6: 180
        case .y1: 365
        case .all: nil
        }
    }
}

struct PerfCompareCard: View {
    @Environment(DataStore.self) private var store
    /// Earliest honest opening (first reading AND first logged flow).
    let allStart: String
    /// One = fixed comparison; several = a picker chooses, first is default.
    let benchmarks: [Benchmark]
    let values: [(date: String, value: Double)]
    let flows: [(date: String, value: Double)]
    /// Extra caveat line under the fine print (e.g. the super-in warning).
    var footnote: String?
    /// Hide readings while big deposits settle into the hand-marks — for
    /// scopes whose values lag their flows (stocks, net worth).
    var maskSettling: Bool

    @State private var selected: Benchmark
    @State private var window: CompareWindow = .all
    @State private var prices: [DcaCompare.PricePoint]?
    @State private var failed = false
    @State private var scrubDate: Date?

    init(
        allStart: String, benchmarks: [Benchmark],
        values: [(date: String, value: Double)], flows: [(date: String, value: Double)],
        footnote: String? = nil, maskSettling: Bool = false
    ) {
        self.allStart = allStart
        self.benchmarks = benchmarks
        self.values = values
        self.flows = flows
        self.footnote = footnote
        self.maskSettling = maskSettling
        _selected = State(initialValue: benchmarks[0])
    }

    /// The window's opening day — never earlier than the honest clamp.
    private var start: String {
        guard let days = window.days,
              let today = SnapshotDate.parse(SydneyTime.today()) else { return allStart }
        let from = SydneyTime.dayString(today.addingTimeInterval(-Double(days) * 86400))
        return max(allStart, from)
    }

    private var series: DcaCompare.Series? {
        guard let prices else { return nil }
        return DcaCompare.build(
            values: values, flows: flows, prices: prices, start: start,
            maskSettling: maskSettling
        )
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

        let mineMoney = store.convert(at.map { series.mineUsd[$0] } ?? (series.mineUsd.last ?? 0), from: "USD")
        let indexMoney = store.convert(at.map { series.indexUsd[$0] } ?? (series.indexUsd.last ?? 0), from: "USD")
        Picker("", selection: $window.animation(nil)) {
            ForEach(CompareWindow.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)

        HStack(spacing: 8) {
            chip("You", minePct, mineMoney, Ledger.income)
            chip(selected.label, indexPct, indexMoney, selected.color)
            Spacer(minLength: 0)
        }

        Text("P&L as % of capital deployed · same money, same days into the benchmark — so the benchmark line follows YOUR deposit schedule and shifts when scope or the super toggle changes it · dividends in S&P 500\(maskSettling ? " · days right after big deposits hidden while marks settle" : "")")
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.tertiary)
        if let footnote {
            Text("⚠ " + footnote)
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(Ledger.seriesCrypto)
        }
    }

    private func chip(_ name: String, _ pctValue: Double, _ money: Double, _ color: Color) -> some View {
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
            // The baht question, answered next to the percent one.
            Text("\(money >= 0 ? "+" : "")\(store.format(money, compact: true))")
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(Color.white.opacity(0.05), in: .rect(cornerRadius: 9))
    }

    private func load() async {
        failed = false
        prices = nil
        do {
            prices = try await BenchmarkAPI.prices(symbol: selected.symbol, from: allStart)
        } catch {
            failed = true
        }
    }
}
