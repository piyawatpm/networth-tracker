import SwiftUI
import Charts
import UIKit

/// Same period set, cutoffs and downsampling as the web dashboard's
/// performance-chart: 1D every intraday point, then hourly / 4-hourly /
/// 12-hourly / daily closes. Keep first point + each bucket's close.
enum ChartPeriod: String, CaseIterable {
    case d1 = "1D", w1 = "1W", m1 = "1M", m6 = "6M", y1 = "1Y", all = "All"

    var cutoffSeconds: TimeInterval? {
        let day: TimeInterval = 86400
        switch self {
        case .d1: return day
        case .w1: return 7 * day
        case .m1: return 30 * day
        case .m6: return 180 * day
        case .y1: return 365 * day
        case .all: return nil
        }
    }

    var bucketSeconds: TimeInterval {
        let hour: TimeInterval = 3600
        switch self {
        case .d1: return 0 // every point
        case .w1: return hour
        case .m1: return 4 * hour
        case .m6: return 12 * hour
        case .y1, .all: return 24 * hour
        }
    }

    /// Same wording as the web's PnL badge.
    var pnlLabel: String {
        switch self {
        case .d1: return "Today"
        case .w1: return "7D"
        case .m1: return "30D"
        case .m6: return "6M"
        case .y1: return "1Y"
        case .all: return "All-time"
        }
    }
}

/// How the plot resolves series of different magnitudes.
///
/// `value` plots raw currency; only honest when ONE series is on screen —
/// stocks at ฿1.3M, crypto at ฿800k and debt at −฿450k on one linear axis
/// crush each other. `indexed` re-bases every visible series to 0% at the
/// window's start, which is the sanctioned fix for multi-scale comparison
/// (the alternative, a second y-axis, invents correlations that aren't in the
/// data). The mode switches itself as series come and go; the toggle lets you
/// override.
enum ChartMode {
    case value, indexed
}

/// A component of net worth drawn alongside it. `points` share the hero
/// series' timestamps so every line buckets identically.
struct ChartOverlay: Identifiable {
    let name: String
    let color: Color
    let points: [(date: Date, valueUsd: Double)]
    var id: String { name }
}

/// One pot's value-over-time card: scrub-aware hero number, neon hero line,
/// optional component lines with a per-series legend, desktop-parity periods.
struct HistoryChartCard: View {
    @Environment(DataStore.self) private var store

    let title: String
    /// Intraday series in USD, ascending, pre-parsed by DataStore.
    let parsed: [(date: Date, valueUsd: Double)]
    /// Live value in DISPLAY currency — the hero line's final point.
    let liveValue: Double
    var heroSize: CGFloat = 34
    var showUpdatedStamp = false
    /// Component lines, toggled from the legend.
    var overlays: [ChartOverlay] = []

    @State private var period: ChartPeriod = .d1
    @State private var scrubDate: Date?
    @State private var render = RenderState()
    @State private var hiddenOverlays: Set<String> = []
    @State private var modeOverride: ChartMode?

    struct Point: Identifiable {
        let date: Date
        let value: Double
        var id: Date { date }
    }

    /// The period AND the points computed for it, swapped as one value.
    ///
    /// Held together on purpose: when these were separate @State, changing the
    /// period re-rendered the chart a frame BEFORE rebuild() replaced the
    /// points, so Charts drew the previous window's data against the new
    /// window's axis — and the spring animation tweened across that mismatch,
    /// which is what painted those filled blobs for ~1s.
    struct RenderState {
        var period: ChartPeriod = .d1
        var hero: [Point] = []
        var overlays: [String: [Point]] = [:]
    }

    // MARK: Derived state

    private var visibleOverlays: [ChartOverlay] {
        overlays.filter { !hiddenOverlays.contains($0.name) && !(render.overlays[$0.name] ?? []).isEmpty }
    }

    /// Absolute values are only readable with a single series on the plot;
    /// past that, indexing is the honest default. An explicit toggle wins.
    private var mode: ChartMode {
        modeOverride ?? (visibleOverlays.isEmpty ? .value : .indexed)
    }

    /// Hero points with the last value pinned to the CURRENT live value —
    /// rebuilds are async, so between them the number moves with sockets and
    /// FX switches. Pinning at render keeps line and headline glued together.
    private var syncedHero: [Point] {
        guard let last = render.hero.last, last.value != liveValue else { return render.hero }
        var copy = render.hero
        copy[copy.count - 1] = Point(date: last.date, value: liveValue)
        return copy
    }

    private var scrubbedPoint: Point? {
        guard let scrubDate, !syncedHero.isEmpty else { return nil }
        return syncedHero.min {
            abs($0.date.timeIntervalSince(scrubDate)) < abs($1.date.timeIntervalSince(scrubDate))
        }
    }

    /// Percent change from the window's start, per series.
    private func indexed(_ points: [Point]) -> [Point] {
        guard let base = points.first?.value, abs(base) > 0.01 else { return [] }
        return points.map {
            Point(date: $0.date, value: ($0.value - base) / abs(base) * 100)
        }
    }

    private func rendered(_ points: [Point]) -> [Point] {
        mode == .indexed ? indexed(points) : points
    }

    /// A series' value at the scrub position, for its legend chip.
    private func scrubValue(_ points: [Point]) -> Double? {
        guard let scrubDate else { return points.last?.value }
        return points.min {
            abs($0.date.timeIntervalSince(scrubDate)) < abs($1.date.timeIntervalSince(scrubDate))
        }?.value
    }

    // MARK: Body

    var body: some View {
        let current = scrubbedPoint?.value ?? liveValue
        let first = syncedHero.first?.value
        let delta = first.map { current - $0 }
        let deltaPct = first.flatMap { $0 > 0 ? (delta ?? 0) / $0 * 100 : nil }

        VStack(alignment: .leading, spacing: 4) {
            header
            MoneyText(
                amount: current,
                currency: store.displayCurrency,
                font: .system(size: heroSize, weight: .bold, design: .rounded)
            )
            subtitle(delta: delta, deltaPct: deltaPct)

            chart.padding(.top, 8)

            if !overlays.isEmpty { legend.padding(.top, 8) }

            Picker("Period", selection: $period.animation(.spring(duration: 0.5))) {
                ForEach(ChartPeriod.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.top, 8)
        }
        .padding(18)
        .financeCard()
        .sensoryFeedback(.selection, trigger: scrubbedPoint?.date)
        .task { rebuild() }
        .onChange(of: period) { rebuild() }
        .onChange(of: store.lastRefreshed) { rebuild() }
        .onChange(of: store.displayCurrency) { rebuild() }
    }

    private var header: some View {
        HStack {
            Text(scrubbedPoint == nil ? title : "\(title) · past").labelMono()
            Spacer()
            if store.isLoading {
                ProgressView().controlSize(.small)
            } else if showUpdatedStamp, let stamp = updatedStamp {
                Text(stamp)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private func subtitle(delta: Double?, deltaPct: Double?) -> some View {
        HStack(spacing: 6) {
            if let point = scrubbedPoint {
                Text(
                    render.period == .d1 || render.period == .w1
                        ? point.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
                        : point.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year())
                )
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
            } else if let delta, let deltaPct {
                Image(systemName: delta >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.caption2.bold())
                Text("\(store.format(delta)) (\(deltaPct >= 0 ? "+" : "")\(String(format: "%.1f", deltaPct))%) · \(period.pnlLabel)")
                    .font(.system(.caption, design: .monospaced))
            }
        }
        .foregroundStyle((delta ?? 0) >= 0 ? Ledger.income : Ledger.expense)
    }

    // MARK: Legend — identity by swatch, value in ink (never color-only)

    private var legend: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                // Short, STABLE name: the full title carries the "· ex-super"
                // qualifier, which wrapped the chip to two lines and shoved
                // the whole card down whenever super was toggled.
                legendChip(
                    name: legendTitle, color: Ledger.income, hidden: false,
                    value: scrubValue(rendered(syncedHero)), isHero: true
                )
                ForEach(overlays) { overlay in
                    legendChip(
                        name: overlay.name, color: overlay.color,
                        hidden: hiddenOverlays.contains(overlay.name),
                        value: scrubValue(rendered(render.overlays[overlay.name] ?? [])),
                        isHero: false
                    )
                }
                Spacer(minLength: 0)
            }

            // The axis changes meaning between modes — say which, and make the
            // note itself the switch.
            Button {
                withAnimation(.snappy(duration: 0.25)) {
                    modeOverride = mode == .indexed ? .value : .indexed
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: mode == .indexed ? "percent" : "dollarsign")
                        .font(.system(size: 8, weight: .bold))
                    Text(
                        mode == .indexed
                            ? "change from window start · tap for values"
                            : "absolute values · tap to compare"
                    )
                    .font(.system(size: 9, design: .monospaced))
                }
                .foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)
        }
    }

    private func legendChip(
        name: String, color: Color, hidden: Bool, value: Double?, isHero: Bool
    ) -> some View {
        Button {
            guard !isHero else { return } // the hero series is always drawn
            withAnimation(.snappy(duration: 0.25)) {
                if hidden { hiddenOverlays.remove(name) } else { hiddenOverlays.insert(name) }
                modeOverride = nil // let the mode follow the new series count
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Circle().fill(color).frame(width: 7, height: 7)
                    Text(name)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .fixedSize()
                }
                if let value, !hidden {
                    Text(
                        mode == .indexed
                            ? "\(value >= 0 ? "+" : "")\(String(format: "%.1f", value))%"
                            : Money.format(value, currency: store.displayCurrency, compact: true)
                    )
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.secondary)
                }
            }
            .frame(height: 30, alignment: .leading)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(Color.white.opacity(hidden ? 0.03 : 0.08), in: .rect(cornerRadius: 10))
            .opacity(hidden ? 0.45 : 1)
        }
        .buttonStyle(.plain)
    }

    /// Title without any "· qualifier" suffix, so the chip width is stable.
    private var legendTitle: String {
        title.components(separatedBy: " · ").first ?? title
    }

    private var updatedStamp: String? {
        guard store.lastRefreshed > 0 else { return nil }
        let age = Date().timeIntervalSince1970 - store.lastRefreshed
        if age < 90 { return "live" }
        if age < 3600 { return "\(Int(age / 60))m ago" }
        return "\(Int(age / 3600))h ago"
    }

    // MARK: Chart

    /// Tiled halftone dot, pre-tinted (ImagePaint can't tint at fill time).
    private static var tileCache: [String: UIImage] = [:]
    private static func dotTile(_ color: UIColor) -> UIImage {
        let key = color.debugDescription
        if let cached = tileCache[key] { return cached }
        let side: CGFloat = 7
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        let image = renderer.image { context in
            color.setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 2.5, y: 2.5, width: 2.0, height: 2.0))
        }
        tileCache[key] = image
        return image
    }

    /// Hero line: dotted area + three stacked strokes that read as neon bloom
    /// (Chart marks can't blur, so the glow is layered width).
    @ChartContentBuilder
    private func heroSeries(
        _ segment: [Point], tint: Color, id: String, dimmed: Bool, yBase: Double, filled: Bool
    ) -> some ChartContent {
        let dots = Image(uiImage: Self.dotTile(UIColor(tint)))
        ForEach(segment) { point in
            if filled {
                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("Base", yBase),
                    yEnd: .value("Value", point.value),
                    series: .value("s", "area-\(id)")
                )
                .foregroundStyle(ImagePaint(image: dots, scale: 1))
                .opacity(dimmed ? 0.12 : 0.4)
            }
            LineMark(
                x: .value("Date", point.date), y: .value("Value", point.value),
                series: .value("s", "glow1-\(id)")
            )
            .lineStyle(StrokeStyle(lineWidth: 11, lineCap: .round, lineJoin: .round))
            .foregroundStyle(tint)
            .opacity(dimmed ? 0.04 : 0.10)

            LineMark(
                x: .value("Date", point.date), y: .value("Value", point.value),
                series: .value("s", "glow2-\(id)")
            )
            .lineStyle(StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
            .foregroundStyle(tint)
            .opacity(dimmed ? 0.08 : 0.22)

            LineMark(
                x: .value("Date", point.date), y: .value("Value", point.value),
                series: .value("s", "main-\(id)")
            )
            .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
            .foregroundStyle(tint)
            .opacity(dimmed ? 0.3 : 1)
        }
    }

    @ViewBuilder
    private var chart: some View {
        let hero = rendered(syncedHero)
        if hero.count < 2 {
            Text("Snapshots build this chart as they accumulate.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 160)
        } else {
            let series = visibleOverlays.map { ($0, rendered(render.overlays[$0.name] ?? [])) }
            let heroValues = hero.map(\.value)
            let allValues = heroValues + series.flatMap { $0.1.map(\.value) }
            let low = allValues.min() ?? 0
            let high = allValues.max() ?? 1
            let span = max(high - low, 0.0001)
            // The dotted fill is a VALUE-mode flourish anchored under the hero
            // line. In indexed mode there is no meaningful floor to fill to.
            let filled = mode == .value
            let yBase = filled ? low - span * 0.06 : low - span * 0.08
            let rising = (heroValues.last ?? 0) >= (heroValues.first ?? 0)
            let tint = rising ? Ledger.income : Ledger.expense

            // Scrub splits the hero line: lit up to the finger, dim after.
            let splitIndex = scrubbedPoint.flatMap { selected in
                hero.firstIndex { $0.date == selected.date }
            }
            let lit = splitIndex.map { Array(hero[...$0]) } ?? hero
            let dim = splitIndex.map { $0 < hero.count - 1 ? Array(hero[$0...]) : [] } ?? []

            let heroHigh = hero.first { $0.value == (heroValues.max() ?? 0) }
            let heroLow = hero.first { $0.value == (heroValues.min() ?? 0) }

            Chart {
                // Zero line anchors the indexed view — "did it beat flat?"
                if mode == .indexed {
                    RuleMark(y: .value("Flat", 0))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 4]))
                        .foregroundStyle(.white.opacity(0.18))
                }

                heroSeries(lit, tint: tint, id: "lit", dimmed: false, yBase: yBase, filled: filled)
                if !dim.isEmpty {
                    heroSeries(dim, tint: tint, id: "dim", dimmed: true, yBase: yBase, filled: filled)
                }

                // Component lines: thin, no glow, so the hero stays the hero.
                ForEach(series, id: \.0.id) { overlay, pts in
                    ForEach(pts) { p in
                        LineMark(
                            x: .value("Date", p.date), y: .value("Value", p.value),
                            series: .value("s", "ov-\(overlay.name)")
                        )
                        .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                        .foregroundStyle(overlay.color)
                    }
                    // End marker doubles as the direct label anchor.
                    if let last = pts.last {
                        PointMark(x: .value("Date", last.date), y: .value("Value", last.value))
                            .symbolSize(40)
                            .foregroundStyle(overlay.color)
                    }
                }

                // Peak / trough of the HERO series only — and only when the
                // two are far enough apart that compact formatting doesn't
                // print the same string twice ("฿1.3M" above and below).
                let extremesDistinct = (heroValues.max() ?? 0) - (heroValues.min() ?? 0)
                    > abs(heroValues.max() ?? 1) * 0.02
                if mode == .value, extremesDistinct, let heroHigh {
                    PointMark(x: .value("Date", heroHigh.date), y: .value("Value", heroHigh.value))
                        .symbolSize(22)
                        .foregroundStyle(tint)
                        .annotation(position: .top, spacing: 2) {
                            Text(Money.format(heroHigh.value, currency: store.displayCurrency, compact: true))
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                }
                if mode == .value, extremesDistinct, let heroLow, heroLow.date != heroHigh?.date {
                    PointMark(x: .value("Date", heroLow.date), y: .value("Value", heroLow.value))
                        .symbolSize(22)
                        .foregroundStyle(Ledger.expense.opacity(0.75))
                        .annotation(position: .bottom, spacing: 2) {
                            Text(Money.format(heroLow.value, currency: store.displayCurrency, compact: true))
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                }

                if let point = scrubbedPoint, let rendered = hero.first(where: { $0.date == point.date }) {
                    RuleMark(x: .value("Date", rendered.date))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .foregroundStyle(.secondary.opacity(0.7))
                    PointMark(x: .value("Date", rendered.date), y: .value("Value", rendered.value))
                        .symbolSize(90)
                        .foregroundStyle(.white)
                    PointMark(x: .value("Date", rendered.date), y: .value("Value", rendered.value))
                        .symbolSize(28)
                        .foregroundStyle(tint)
                }
            }
            .chartXSelection(value: $scrubDate)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    if render.period == .d1 {
                        AxisValueLabel(format: .dateTime.hour().minute())
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    } else if render.period == .m6 || render.period == .y1 || render.period == .all {
                        AxisValueLabel(format: .dateTime.month(.abbreviated).year(.twoDigits))
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    } else {
                        AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .chartYAxis {
                // Value mode keeps the OKX-clean hidden axis (the hero number
                // IS the scale). Indexed mode needs %, or the reader can't
                // size the spread between lines.
                if mode == .indexed {
                    AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { value in
                        AxisGridLine().foregroundStyle(.white.opacity(0.05))
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text("\(v >= 0 ? "+" : "")\(String(format: "%.0f", v))%")
                                    .font(.system(size: 9, design: .monospaced))
                            }
                        }
                    }
                }
            }
            .chartYScale(domain: yBase...(high + span * 0.10))
            .frame(height: 210)
        }
    }

    // MARK: Rebuild — hero and overlays share one filter+bucket pipeline

    private func bucketed(_ rows: [(date: Date, valueUsd: Double)], now: Date) -> [Point] {
        let cutoff = period.cutoffSeconds.map { now.addingTimeInterval(-$0) }
        let inRange = cutoff.map { c in rows.filter { $0.date >= c } } ?? rows
        let bucket = period.bucketSeconds
        var kept: [(date: Date, valueUsd: Double)] = []
        if bucket <= 0 || inRange.isEmpty {
            kept = inRange
        } else {
            for (index, row) in inRange.enumerated() {
                let slot = Int(row.date.timeIntervalSince1970 / bucket)
                let lastInBucket = index + 1 >= inRange.count
                    || Int(inRange[index + 1].date.timeIntervalSince1970 / bucket) != slot
                if index == 0 || lastInBucket { kept.append(row) }
            }
        }
        return kept.map { Point(date: $0.date, value: store.convert($0.valueUsd, from: "USD")) }
    }

    private func rebuild() {
        let now = Date()
        var hero = bucketed(parsed, now: now)
        if let last = hero.last, now > last.date {
            hero.append(Point(date: now, value: liveValue))
        } else if !hero.isEmpty {
            hero[hero.count - 1] = Point(date: hero[hero.count - 1].date, value: liveValue)
        }
        var built: [String: [Point]] = [:]
        for overlay in overlays {
            built[overlay.name] = bucketed(overlay.points, now: now)
        }
        // One assignment — the chart never sees a half-updated window.
        render = RenderState(period: period, hero: hero, overlays: built)
    }
}
