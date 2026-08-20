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
                    Text(store.format(store.convert(tx.totalAmount, from: tx.currency), compact: true))
                        .font(.system(.caption, design: .monospaced, weight: .semibold))
                        .foregroundStyle(tx.type == "buy" ? .primary : Ledger.income)
                }
            }
        }
        .padding(16)
        .financeCard()
    }
}

// MARK: - Custom groups ("Quantum", "AI", …)

/// User-defined baskets of holdings with their allocation — the answer to
/// "how much of my portfolio is the quantum bet?". Groups are ticker sets
/// synced with the web (`portfolio_groups`); a holding may sit in several.
struct HoldingGroupsCard: View {
    @Environment(DataStore.self) private var store
    /// The visible holdings (already scope-filtered by the section).
    let holdings: [PortfolioHolding]

    @State private var editing: PortfolioGroup?
    @State private var creating = false
    @State private var expanded: Set<String> = []

    private func value(_ holding: PortfolioHolding) -> Double {
        store.convert(store.holdingLiveValue(holding), from: holding.currency)
    }

    private var portfolioTotal: Double { holdings.reduce(0) { $0 + value($1) } }

    private func members(_ group: PortfolioGroup) -> [PortfolioHolding] {
        let set = Set(group.tickers.map { $0.uppercased() })
        return holdings
            .filter { set.contains($0.ticker.uppercased()) }
            .sorted { value($0) > value($1) }
    }

    private var groupedTickers: Set<String> {
        Set(store.portfolioGroups.flatMap { $0.tickers.map { $0.uppercased() } })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Groups").labelMono()
                Spacer()
                Button {
                    creating = true
                } label: {
                    Label("New", systemImage: "plus")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Ledger.income)
            }

            if store.portfolioGroups.isEmpty {
                Text("Group holdings into themes — “Quantum”, “AI” — and see what share of the portfolio each bet is.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach(store.portfolioGroups) { group in
                let rows = members(group)
                let total = rows.reduce(0) { $0 + value($1) }
                let pct = portfolioTotal > 0 ? total / portfolioTotal : 0
                VStack(spacing: 6) {
                    Button {
                        withAnimation(.snappy(duration: 0.25)) {
                            if expanded.contains(group.id) { expanded.remove(group.id) }
                            else { expanded.insert(group.id) }
                        }
                    } label: {
                        VStack(spacing: 5) {
                            HStack(spacing: 6) {
                                Image(systemName: expanded.contains(group.id) ? "chevron.down" : "chevron.right")
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(.tertiary)
                                Text(group.name).font(.subheadline.weight(.semibold))
                                Text("\(rows.count)")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                                Spacer()
                                Text("\(store.format(total, compact: true))  \(String(format: "%.1f%%", pct * 100))")
                                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                            }
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(.primary.opacity(0.06))
                                    Capsule().fill(Ledger.income.opacity(0.85))
                                        .frame(width: max(3, geo.size.width * pct))
                                }
                            }
                            .frame(height: 4)
                        }
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Edit", systemImage: "pencil") { editing = group }
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            Task {
                                await store.savePortfolioGroups(
                                    store.portfolioGroups.filter { $0.id != group.id }
                                )
                            }
                        }
                    }

                    if expanded.contains(group.id) {
                        VStack(spacing: 5) {
                            ForEach(rows) { holding in
                                HStack(spacing: 6) {
                                    Text(holding.ticker.isEmpty ? holding.name : holding.ticker)
                                        .font(.system(size: 11, design: .monospaced))
                                    Spacer()
                                    Text(store.format(value(holding), compact: true))
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                    Text(String(format: "%.0f%%", total > 0 ? value(holding) / total * 100 : 0))
                                        .font(.system(size: 9, design: .monospaced))
                                        .foregroundStyle(.tertiary)
                                        .frame(width: 32, alignment: .trailing)
                                }
                            }
                            // Members priced at zero (exited/missing) still listed.
                            let missing = group.tickers.map { $0.uppercased() }
                                .filter { t in !rows.contains { $0.ticker.uppercased() == t } }
                            if !missing.isEmpty {
                                Text("not held: \(missing.joined(separator: ", "))")
                                    .font(.system(size: 8, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            HStack {
                                Button("Edit group", systemImage: "pencil") { editing = group }
                                    .font(.system(size: 10, weight: .semibold))
                                    .buttonStyle(.plain)
                                    .foregroundStyle(.secondary)
                                Spacer()
                            }
                        }
                        .padding(.leading, 15)
                    }
                }
            }

            if !store.portfolioGroups.isEmpty {
                let ungrouped = holdings.filter { !groupedTickers.contains($0.ticker.uppercased()) }
                if !ungrouped.isEmpty {
                    let total = ungrouped.reduce(0) { $0 + value($1) }
                    HStack {
                        Text("Ungrouped · \(ungrouped.count)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("\(store.format(total, compact: true))  \(String(format: "%.1f%%", portfolioTotal > 0 ? total / portfolioTotal * 100 : 0))")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(16)
        .financeCard()
        .sheet(isPresented: $creating) {
            GroupEditorSheet(group: nil, holdings: holdings)
        }
        .sheet(item: $editing) { group in
            GroupEditorSheet(group: group, holdings: holdings)
        }
    }
}

struct GroupEditorSheet: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let group: PortfolioGroup?
    let holdings: [PortfolioHolding]

    @State private var name = ""
    @State private var selected: Set<String> = []

    private var sortedHoldings: [PortfolioHolding] {
        holdings.sorted {
            store.convert(store.holdingLiveValue($0), from: $0.currency)
                > store.convert(store.holdingLiveValue($1), from: $1.currency)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Group name (e.g. Quantum)", text: $name)
                }
                Section("Holdings · \(selected.count) picked") {
                    ForEach(sortedHoldings) { holding in
                        let ticker = holding.ticker.uppercased()
                        Button {
                            if selected.contains(ticker) { selected.remove(ticker) }
                            else { selected.insert(ticker) }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(holding.ticker.isEmpty ? holding.name : holding.ticker)
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(.primary)
                                    Text(holding.name)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Text(store.format(store.convert(store.holdingLiveValue(holding), from: holding.currency), compact: true))
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                Image(systemName: selected.contains(ticker) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected.contains(ticker) ? Ledger.income : Color.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle(group == nil ? "New group" : "Edit group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || selected.isEmpty)
                }
            }
            .onAppear {
                name = group?.name ?? ""
                selected = Set((group?.tickers ?? []).map { $0.uppercased() })
            }
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !selected.isEmpty else { return }
        var groups = store.portfolioGroups
        if let group, let index = groups.firstIndex(where: { $0.id == group.id }) {
            groups[index].name = trimmed
            groups[index].tickers = selected.sorted()
        } else {
            groups.append(PortfolioGroup(name: trimmed, tickers: selected.sorted()))
        }
        Task { await store.savePortfolioGroups(groups) }
        dismiss()
    }
}
