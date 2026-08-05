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
        let mine: [Double]     // USD P&L per day
        let index: [Double]    // USD P&L per day, same flows into the index
        let invested: [Double] // capital deployed by that day — the % base
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

    /// Daily closes of the portfolio's own (ex-super) history: last snapshot
    /// reading per day. Ex-super on purpose — the Hostplus contributions are
    /// not in the tx log, so with super in, deposits would read as profit.
    static func dailyValues(_ parsed: [(date: Date, valueUsd: Double)]) -> [(date: String, value: Double)] {
        var byDay: [String: Double] = [:]
        for row in parsed { byDay[SydneyTime.dayString(row.date)] = row.valueUsd } // ascending → last wins
        return byDay.map { (date: $0.key, value: $0.value) }.sorted { $0.date < $1.date }
    }

    /// P&L(t) for every day in [start, today], yours vs the index shadow.
    ///
    /// Yours:  value(t) − (opening + netFlows(start, t])
    /// Index:  units(t)·price(t) − (opening + netFlows(start, t]), where the
    /// opening balance buys index units at the start price (it was already
    /// deployed on day one) and each later flow buys/sells at that day's
    /// close. A sell larger than the position clamps at zero — going short is
    /// not a scenario the comparison can represent.
    static func build(
        values: [(date: String, value: Double)],
        flows: [(date: String, value: Double)],
        prices: [PricePoint],
        start: String
    ) -> Series? {
        let priceRows = prices.map { (date: $0.date, value: $0.close) }
        guard let opening = asOf(values, start),
              let startPrice = asOf(priceRows, start), startPrice > 0
        else { return nil }

        var units = opening / startPrice
        var invested = opening
        var flowIndex = flows.firstIndex { $0.date > start } ?? flows.count

        var dates: [Date] = []
        var mine: [Double] = []
        var index: [Double] = []
        var deployed: [Double] = []

        guard var cursor = SnapshotDate.parse(start) else { return nil }
        let today = SydneyTime.today()
        while true {
            let day = SydneyTime.dayString(cursor)
            if day > today { break }
            // Apply every flow dated ≤ this day.
            while flowIndex < flows.count, flows[flowIndex].date <= day {
                let flow = flows[flowIndex]
                invested += flow.value
                if let px = asOf(priceRows, flow.date), px > 0 {
                    units = max(0, units + flow.value / px)
                }
                flowIndex += 1
            }
            if let mineValue = asOf(values, day), let px = asOf(priceRows, day) {
                dates.append(cursor)
                mine.append(mineValue - invested)
                index.append(units * px - invested)
                deployed.append(invested)
            }
            cursor = cursor.addingTimeInterval(86400)
        }
        guard dates.count >= 2 else { return nil }
        return Series(dates: dates, mine: mine, index: index, invested: deployed)
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

/// The comparison chart: your stock P&L vs the same flows into SPY.
struct PerfCompareCard: View {
    @Environment(DataStore.self) private var store
    let start: String

    @State private var prices: [DcaCompare.PricePoint]?
    @State private var failed = false

    /// Flows scoped to what the value series actually tracks. Two exclusions,
    /// both mirroring the web page:
    ///   * super holdings — their contributions aren't in the ex-super value
    ///     series, so a super buy reads as pure loss (the 25 Jun A$4,300
    ///     Hostplus buy cratered the chart by exactly its own size);
    ///   * orphans of deleted holdings — the log carries ghost buys whose
    ///     holdings no longer exist (three duplicate A$4,300 Hostplus entries
    ///     under abandoned names), inflating "invested" forever.
    private var scopedFlows: [(date: String, value: Double)] {
        let superIds = Set(store.holdings.filter { $0.accountType == "super" }.map(\.id))
        let knownIds = Set(store.holdings.map(\.id))
        return DcaCompare.flowsByDay(
            store.portfolioTxs.filter {
                knownIds.contains($0.holdingId) && !superIds.contains($0.holdingId)
            }
        )
    }

    private var series: DcaCompare.Series? {
        guard let prices else { return nil }
        return DcaCompare.build(
            values: DcaCompare.dailyValues(store.portfolioParsed),
            flows: scopedFlows,
            prices: prices,
            start: start
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("You vs S&P 500 · since \(FlowMath.dayLabel(start))").labelMono()

            if let series {
                content(series)
            } else if failed {
                VStack(spacing: 8) {
                    Text("Couldn't load S&P 500 prices.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("Retry") { Task { await load() } }
                        .font(.footnote.weight(.semibold))
                        .tint(Ledger.income)
                }
                .frame(maxWidth: .infinity, minHeight: 120)
            } else if prices != nil {
                Text("Tracked history starts after \(FlowMath.dayLabel(start)) — no opening value to compare from.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .padding(16)
        .financeCard()
        .task { await load() }
    }

    /// P&L as a percent of the capital deployed by that day.
    private func pct(_ pnl: Double, _ invested: Double) -> Double {
        abs(invested) > 1e-9 ? pnl / abs(invested) * 100 : 0
    }

    @ViewBuilder
    private func content(_ series: DcaCompare.Series) -> some View {
        let lastInvested = series.invested.last ?? 0
        let minePct = pct(series.mine.last ?? 0, lastInvested)
        let indexPct = pct(series.index.last ?? 0, lastInvested)
        let lead = minePct - indexPct
        let ahead = lead >= 0

        // Y-domain from the BULK of the data, not its extremes: a one-day
        // snapshot glitch (value recorded mid-restructure) can spike to +90%
        // and flatten the real ±10% story into a line at zero. The 2nd–98th
        // percentile keeps the axis honest for the other ~95 days; the spike
        // still shows, clipped at the plot edge instead of owning the scale.
        let allPct = (0..<series.dates.count).flatMap {
            [pct(series.mine[$0], series.invested[$0]), pct(series.index[$0], series.invested[$0])]
        }.sorted()
        let lo = allPct[Int(Double(allPct.count - 1) * 0.02)]
        let hi = allPct[Int(Double(allPct.count - 1) * 0.98)]
        let span = max(hi - lo, 1)
        let yLow = min(lo - span * 0.25, -1)
        let yHigh = max(hi + span * 0.25, 1)

        // The verdict, in words, before any chart-reading is needed. Points,
        // not %: the difference of two percentages is percentage points.
        HStack(spacing: 6) {
            Image(systemName: ahead ? "arrow.up.right" : "arrow.down.right")
                .font(.caption2.bold())
            Text("\(ahead ? "ahead of" : "behind") the index by \(String(format: "%.1f", abs(lead))) pts")
                .font(.system(.caption, design: .monospaced, weight: .semibold))
        }
        .foregroundStyle(ahead ? Ledger.income : Ledger.expense)

        Chart {
            RuleMark(y: .value("Flat", 0))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 4]))
                .foregroundStyle(.white.opacity(0.18))

            ForEach(Array(series.dates.enumerated()), id: \.offset) { i, date in
                LineMark(
                    x: .value("Date", date),
                    y: .value("P&L %", pct(series.mine[i], series.invested[i])),
                    series: .value("s", "mine")
                )
                .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                .foregroundStyle(Ledger.income)

                LineMark(
                    x: .value("Date", date),
                    y: .value("P&L %", pct(series.index[i], series.invested[i])),
                    series: .value("s", "spy")
                )
                .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                .foregroundStyle(Ledger.seriesStocks)
            }
        }
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
        .chartYScale(domain: yLow...yHigh)
        // Charts does NOT clip marks to the plot — without this the glitch
        // day draws a line up across the whole page.
        .chartPlotStyle { $0.clipped() }
        // Hand-placed ticks: .automatic puts one on the domain's last instant,
        // where the label renders clipped to an ellipsis (same fix as the
        // dashboard chart). fixedSize so Charts can't truncate the text.
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
            chip("You", minePct, store.convert(series.mine.last ?? 0, from: "USD"), Ledger.income)
            chip("S&P 500 · same flows", indexPct, store.convert(series.index.last ?? 0, from: "USD"), Ledger.seriesStocks)
            Spacer(minLength: 0)
        }

        Text("P&L only — deposits subtracted from both sides · ex-super (flows too) · deleted-holding flows excluded · dividends in SPY")
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.tertiary)
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
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(pctValue >= 0 ? Ledger.income : Ledger.expense)
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
        do {
            prices = try await BenchmarkAPI.prices(symbol: "SPY", from: start)
        } catch {
            failed = true
        }
    }
}
