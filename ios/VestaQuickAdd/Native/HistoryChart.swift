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

/// A secondary line on the big chart — a net-worth component (stocks,
/// crypto, debt) drawn thin and glowless under the hero series.
struct ChartOverlay: Identifiable {
    let name: String
    let color: Color
    /// USD, daily resolution, ascending.
    let points: [(date: Date, valueUsd: Double)]
    /// Off until its legend chip is tapped — for series far outside the hero
    /// line's range (debt sits below zero and would crush the y-scale).
    var startsHidden: Bool = false
    var id: String { name }
}

private struct OverlayPoint: Identifiable {
    let id: Date
    let value: Double
}

/// One pot's value-over-time card: big scrub-aware number, delta badge,
/// gradient line with high/low marks, desktop-parity period picker. Used for
/// Net Worth (dashboard), Stocks and Crypto (invest tab).
struct HistoryChartCard: View {
    @Environment(DataStore.self) private var store

    let title: String
    /// Intraday series in USD, ascending, pre-parsed by DataStore.
    let parsed: [(date: Date, valueUsd: Double)]
    /// Live value in DISPLAY currency — the line's final point.
    let liveValue: Double
    var heroSize: CGFloat = 34
    var showUpdatedStamp = false
    /// Component lines with a tappable legend (dashboard only).
    var overlays: [ChartOverlay] = []

    @State private var period: ChartPeriod = .d1
    @State private var scrubDate: Date?
    @State private var points: [Point] = []
    @State private var hiddenOverlays: Set<String> = []
    @State private var seededOverlayDefaults = false

    struct Point: Identifiable {
        let date: Date
        let value: Double
        var id: Date { date }
    }

    /// `points` with the last value pinned to the CURRENT live value — the
    /// rebuild pipeline is async (period/currency changes), and between
    /// rebuilds the hero number moves with sockets and FX switches. Pinning at
    /// render keeps the line's end glued to the number above it, always.
    private var syncedPoints: [Point] {
        guard let last = points.last, last.value != liveValue else { return points }
        var copy = points
        copy[copy.count - 1] = Point(date: last.date, value: liveValue)
        return copy
    }

    private var scrubbedPoint: Point? {
        guard let scrubDate, !syncedPoints.isEmpty else { return nil }
        return syncedPoints.min {
            abs($0.date.timeIntervalSince(scrubDate)) < abs($1.date.timeIntervalSince(scrubDate))
        }
    }

    var body: some View {
        let current = scrubbedPoint?.value ?? liveValue
        let first = syncedPoints.first?.value
        let delta = first.map { (scrubbedPoint?.value ?? liveValue) - $0 }
        let deltaPct = first.flatMap { $0 > 0 ? (delta ?? 0) / $0 * 100 : nil }

        VStack(alignment: .leading, spacing: 4) {
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

            // THE number. Scrubbing rewrites it in place — digits roll.
            MoneyText(
                amount: current,
                currency: store.displayCurrency,
                font: .system(size: heroSize, weight: .bold, design: .rounded)
            )

            HStack(spacing: 6) {
                if let point = scrubbedPoint {
                    Text(
                        period == .d1
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

            chart
                .padding(.top, 8)

            // Overlay legend — tap a component to hide/show its line. The
            // overlays are daily series, so the intraday view skips them.
            if !overlays.isEmpty && period != .d1 {
                HStack(spacing: 8) {
                    ForEach(overlays) { overlay in
                        let hidden = hiddenOverlays.contains(overlay.name)
                        Button {
                            withAnimation(.snappy(duration: 0.2)) {
                                if hidden { hiddenOverlays.remove(overlay.name) }
                                else { hiddenOverlays.insert(overlay.name) }
                            }
                        } label: {
                            HStack(spacing: 5) {
                                Circle().fill(overlay.color).frame(width: 6, height: 6)
                                Text(overlay.name)
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                            }
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(Color.white.opacity(hidden ? 0.03 : 0.08), in: .capsule)
                            .opacity(hidden ? 0.4 : 1)
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.top, 6)
            }

            Picker("Period", selection: $period.animation(.spring(duration: 0.5))) {
                ForEach(ChartPeriod.allCases, id: \.self) { p in
                    Text(p.rawValue).tag(p)
                }
            }
            .pickerStyle(.segmented)
            .padding(.top, 6)
        }
        .padding(18)
        .financeCard()
        .sensoryFeedback(.selection, trigger: scrubbedPoint?.date)
        .task {
            if !seededOverlayDefaults {
                seededOverlayDefaults = true
                hiddenOverlays = Set(overlays.filter(\.startsHidden).map(\.name))
            }
            rebuildPoints()
        }
        .onChange(of: period) { rebuildPoints() }
        .onChange(of: store.lastRefreshed) { rebuildPoints() }
        .onChange(of: store.displayCurrency) { rebuildPoints() }
    }

    /// Filter → bucket → convert, then land the line on the LIVE value, like
    /// the web appends its live point at "now". Precomputed into @State
    /// because rebuilding 20k rows per scrub frame would jank.
    private func rebuildPoints() {
        let now = Date()
        let cutoff = period.cutoffSeconds.map { now.addingTimeInterval(-$0) }
        let bucket = period.bucketSeconds

        let inRange = cutoff.map { c in parsed.filter { $0.date >= c } } ?? parsed

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

        var result = kept.map { Point(date: $0.date, value: store.convert($0.valueUsd, from: "USD")) }
        if let last = result.last, now > last.date {
            result.append(Point(date: now, value: liveValue))
        } else if !result.isEmpty {
            result[result.count - 1] = Point(date: result[result.count - 1].date, value: liveValue)
        }
        points = result
    }

    private var updatedStamp: String? {
        guard store.lastRefreshed > 0 else { return nil }
        let age = Date().timeIntervalSince1970 - store.lastRefreshed
        if age < 90 { return "live" }
        if age < 3600 { return "\(Int(age / 60))m ago" }
        return "\(Int(age / 3600))h ago"
    }

    // MARK: OKX-style chart — neon glow line over a dot-matrix fill; while
    // scrubbing, the past stays lit and the future dims, with a dashed rule,
    // a white dot on the line and the timestamp pill at the top.

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

    /// One drawn segment: dotted area + three stacked line passes (wide faint,
    /// mid, crisp) that read as neon bloom — Chart marks can't blur, so the
    /// glow is layered strokes.
    @ChartContentBuilder
    private func neonSeries(
        _ segment: [Point], tint: Color, id: String, dimmed: Bool, yBase: Double
    ) -> some ChartContent {
        let dots = Image(uiImage: Self.dotTile(UIColor(tint)))
        ForEach(segment) { point in
            AreaMark(
                x: .value("Date", point.date),
                yStart: .value("Base", yBase),
                yEnd: .value("Value", point.value),
                series: .value("s", "area-\(id)")
            )
            .foregroundStyle(ImagePaint(image: dots, scale: 1))
            .opacity(dimmed ? 0.12 : 0.4)

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
        if syncedPoints.count < 2 {
            Text("Snapshots build this chart as they accumulate.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 140)
        } else {
            let chartPoints = syncedPoints
            let values = chartPoints.map(\.value)
            let cutoffDate = period.cutoffSeconds.map { Date().addingTimeInterval(-$0) }
            let visibleOverlays: [(ChartOverlay, [OverlayPoint])] =
                period == .d1 ? [] : overlays
                    .filter { !hiddenOverlays.contains($0.name) }
                    .map { overlay in
                        let pts = overlay.points
                            .filter { point in
                                cutoffDate.map { point.date >= $0 } ?? true
                            }
                            .map { OverlayPoint(id: $0.date, value: store.convert($0.valueUsd, from: "USD")) }
                        return (overlay, pts)
                    }
                    .filter { !$0.1.isEmpty }
            let overlayValues = visibleOverlays.flatMap { $0.1.map(\.value) }
            // Scale logic, deliberate: the dot-matrix fill stays banded to the
            // HERO series (yBase from mainLow), while the plot DOMAIN widens
            // to fit whatever overlays are visible — so showing the debt line
            // extends the axis below zero without smearing dots down to it.
            let mainLow = values.min() ?? 0
            let mainHigh = values.max() ?? 0
            let yBase = mainLow - (mainHigh - mainLow) * 0.06
            let domainLow = min(yBase, overlayValues.min() ?? yBase)
            let high = max(mainHigh, overlayValues.max() ?? mainHigh)
            let rising = (values.last ?? 0) >= (values.first ?? 0)
            let tint = rising ? Ledger.income : Ledger.expense

            // Scrub splits the line: everything up to the finger stays lit,
            // the rest fades back — the OKX signature.
            let splitIndex = scrubbedPoint.flatMap { selected in
                chartPoints.firstIndex { $0.date == selected.date }
            }
            let litSegment = splitIndex.map { Array(chartPoints[...$0]) } ?? chartPoints
            let dimSegment = splitIndex.map { index in
                index < chartPoints.count - 1 ? Array(chartPoints[index...]) : []
            } ?? []

            // High/low markers track the HERO series, not overlay extremes.
            let highPoint = chartPoints.first { $0.value == mainHigh }
            let lowPoint = chartPoints.first { $0.value == mainLow }

            Chart {
                neonSeries(litSegment, tint: tint, id: "lit", dimmed: false, yBase: yBase)
                if !dimSegment.isEmpty {
                    neonSeries(dimSegment, tint: tint, id: "dim", dimmed: true, yBase: yBase)
                }

                // Peak / trough of the visible window — quiet mono labels so
                // the plot stays OKX-clean but the extremes are still numbers.
                if let highPoint {
                    PointMark(x: .value("Date", highPoint.date), y: .value("Value", highPoint.value))
                        .symbolSize(22)
                        .foregroundStyle(tint)
                        .annotation(position: .top, spacing: 2) {
                            Text(Money.format(highPoint.value, currency: store.displayCurrency, compact: true))
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                }
                if let lowPoint, lowPoint.date != highPoint?.date {
                    PointMark(x: .value("Date", lowPoint.date), y: .value("Value", lowPoint.value))
                        .symbolSize(22)
                        .foregroundStyle(Ledger.expense.opacity(0.75))
                        .annotation(position: .bottom, spacing: 2) {
                            Text(Money.format(lowPoint.value, currency: store.displayCurrency, compact: true))
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                }

                ForEach(visibleOverlays, id: \.0.id) { overlay, pts in
                    ForEach(pts) { p in
                        LineMark(
                            x: .value("Date", p.id), y: .value("Value", p.value),
                            series: .value("s", "overlay-\(overlay.name)")
                        )
                        .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round))
                        .foregroundStyle(overlay.color.opacity(0.85))
                    }
                }

                if let point = scrubbedPoint {
                    RuleMark(x: .value("Date", point.date))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .foregroundStyle(.secondary.opacity(0.7))
                    PointMark(x: .value("Date", point.date), y: .value("Value", point.value))
                        .symbolSize(90)
                        .foregroundStyle(.white)
                    PointMark(x: .value("Date", point.date), y: .value("Value", point.value))
                        .symbolSize(28)
                        .foregroundStyle(tint)
                }
            }
            .chartXSelection(value: $scrubDate)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    if period == .d1 {
                        AxisValueLabel(format: .dateTime.hour().minute())
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    } else if period == .m6 || period == .y1 || period == .all {
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
            // OKX keeps the plot clean: no y labels, no gridlines — the big
            // rolling number IS the y-axis.
            .chartYAxis(.hidden)
            .chartYScale(domain: domainLow...(high + (high - domainLow) * 0.06))
            .frame(height: 200)
            .animation(.spring(duration: 0.5), value: period)
            .overlay(alignment: .top) {
                if let point = scrubbedPoint {
                    Text(
                        period == .d1 || period == .w1
                            ? point.date.formatted(.dateTime.month(.twoDigits).day(.twoDigits).hour().minute())
                            : point.date.formatted(.dateTime.month(.twoDigits).day(.twoDigits).year())
                    )
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.thinMaterial, in: .capsule)
                    .transition(.opacity)
                }
            }
        }
    }
}
