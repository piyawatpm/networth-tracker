import SwiftUI
import Charts

// The Invest tab's insight layer — the web portfolio/crypto pages' section
// cards (allocation donuts, broker/exchange breakdowns, the trade ledger)
// in the same visual language the income/expenses insights use.

struct AllocationSlice: Identifiable, Equatable {
    let name: String
    let value: Double
    let color: Color
    var id: String { name }
}

/// The web's three side-by-side donuts don't fit a phone, so one card hosts
/// them behind a segmented switch (Type | Holdings | Country). Tap-and-hold
/// the ring to read a slice, same as the income donut.
struct AllocationDonutCard: View {
    @Environment(DataStore.self) private var store
    let title: String
    let modes: [(label: String, slices: [AllocationSlice])]
    let centerNoun: String

    @State private var mode = 0
    @State private var selectedAngle: Double?

    private var slices: [AllocationSlice] {
        modes.isEmpty ? [] : modes[min(mode, modes.count - 1)].slices
    }
    private var total: Double { slices.reduce(0) { $0 + $1.value } }

    private var selectedSlice: AllocationSlice? {
        guard let angle = selectedAngle else { return nil }
        var running = 0.0
        for slice in slices {
            running += slice.value
            if angle <= running { return slice }
        }
        return slices.last
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).labelMono()

            if modes.count > 1 {
                Picker("Mode", selection: $mode.animation(.snappy(duration: 0.25))) {
                    ForEach(Array(modes.enumerated()), id: \.offset) { index, entry in
                        Text(entry.label).tag(index)
                    }
                }
                .pickerStyle(.segmented)
            }

            HStack(alignment: .center, spacing: 16) {
                Chart(slices) { slice in
                    SectorMark(
                        angle: .value("Value", slice.value),
                        innerRadius: .ratio(0.68),
                        angularInset: 1.5
                    )
                    .cornerRadius(3)
                    .foregroundStyle(slice.color)
                    .opacity(selectedSlice == nil || selectedSlice == slice ? 1 : 0.35)
                }
                .chartAngleSelection(value: $selectedAngle)
                .chartBackground { _ in
                    VStack(spacing: 2) {
                        if let selected = selectedSlice {
                            Text(selected.name)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Text(store.format(selected.value, compact: true))
                                .font(.system(.footnote, design: .rounded, weight: .bold))
                        } else {
                            Text("\(slices.count)")
                                .font(.system(.title3, design: .rounded, weight: .bold))
                            Text(centerNoun).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(width: 124, height: 124)
                .animation(.spring(duration: 0.35), value: selectedAngle != nil)

                VStack(alignment: .leading, spacing: 7) {
                    ForEach(slices) { slice in
                        HStack(spacing: 6) {
                            Circle().fill(slice.color).frame(width: 7, height: 7)
                            Text(slice.name).font(.caption).lineLimit(1)
                            Spacer(minLength: 8)
                            Text(store.format(slice.value, compact: true))
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                            if total > 0 {
                                Text(String(format: "%.0f%%", slice.value / total * 100))
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                                    .frame(width: 30, alignment: .trailing)
                            }
                        }
                    }
                }
            }
        }
        .padding(16)
        .financeCard()
    }
}

struct BreakdownBar: Identifiable {
    let name: String
    let count: Int?
    let value: Double
    var id: String { name }
}

/// The web's "By Broker" / "By Exchange" section: ranked rows with a share
/// bar, values in the display currency.
struct BreakdownBarsCard: View {
    @Environment(DataStore.self) private var store
    let title: String
    let rows: [BreakdownBar]

    private var total: Double { rows.reduce(0) { $0 + $1.value } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).labelMono()
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                let pct = total > 0 ? row.value / total : 0
                VStack(spacing: 4) {
                    HStack(spacing: 6) {
                        Circle().fill(Ledger.chartColor(index)).frame(width: 7, height: 7)
                        Text(row.name).font(.caption).lineLimit(1)
                        if let count = row.count {
                            Text("\(count)")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Text("\(store.format(row.value, compact: true))  \(String(format: "%.1f%%", pct * 100))")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.primary.opacity(0.06))
                            Capsule()
                                .fill(Ledger.chartColor(index))
                                .frame(width: max(3, geo.size.width * pct))
                        }
                    }
                    .frame(height: 5)
                }
            }
        }
        .padding(16)
        .financeCard()
    }
}

/// The web portfolio page's transaction history, phone-sized: the latest
/// trades across every holding, newest first.
struct RecentTradesCard: View {
    @Environment(DataStore.self) private var store
    let txs: [PortfolioTransaction]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Latest trades").labelMono()
            ForEach(txs) { tx in
                HStack(spacing: 10) {
                    Image(systemName: tx.type == "buy"
                          ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(tx.type == "buy" ? Ledger.income : Ledger.expense)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(tx.holdingName)
                            .font(.footnote.weight(.medium))
                            .lineLimit(1)
                        Text("\(tx.type == "buy" ? "Buy" : "Sell") \(String(format: "%.4g", tx.units)) · \(SydneyTime.shortLabel(tx.date))")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(Money.format(tx.totalAmount, currency: tx.currency, compact: true))
                        .font(.system(.caption, design: .monospaced, weight: .semibold))
                        .foregroundStyle(tx.type == "buy" ? .primary : Ledger.income)
                }
            }
        }
        .padding(16)
        .financeCard()
    }
}
