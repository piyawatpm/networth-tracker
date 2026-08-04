import SwiftUI
import Charts

struct IncomeView: View {
    @Environment(DataStore.self) private var store
    @State private var showAdd = false
    @State private var editing: IncomeEntry?
    @State private var search = ""
    @State private var selectedAngle: Double?

    private var month: String { SydneyTime.currentMonthKey() }

    private var monthEntries: [IncomeEntry] {
        store.allIncome.filter { SydneyTime.monthKey($0.date) == month }
    }

    /// Donut slices for this month, positive categories only (a pie can't
    /// draw a negative arc — same rule as the web).
    private var slices: [(type: String, label: String, value: Double, color: Color)] {
        var byType: [String: Double] = [:]
        for entry in monthEntries {
            byType[entry.type, default: 0] += store.convert(entry.amount, from: entry.currency)
        }
        return byType
            .filter { $0.value > 0.005 }
            .map { (type: $0.key, label: store.incomeLabel($0.key), value: $0.value, color: store.incomeColor($0.key)) }
            .sorted { $0.value > $1.value }
    }

    /// Which slice the current chartAngleSelection lands in.
    private var selectedSlice: (type: String, label: String, value: Double, color: Color)? {
        guard let angle = selectedAngle else { return nil }
        var running = 0.0
        for slice in slices {
            running += slice.value
            if angle <= running { return slice }
        }
        return nil
    }

    private var listEntries: [IncomeEntry] {
        let sorted = store.allIncome.sorted {
            $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt
        }
        guard !search.isEmpty else { return sorted }
        let q = search.lowercased()
        return sorted.filter {
            $0.description.lowercased().contains(q)
                || $0.source.lowercased().contains(q)
                || store.incomeLabel($0.type).lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    summaryHeader
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                Section("Records") {
                    ForEach(listEntries) { entry in
                        IncomeRow(entry: entry)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if entry.derived != true {
                                    Button("Delete", systemImage: "trash", role: .destructive) {
                                        Task { try? await store.deleteIncome(entry.id) }
                                    }
                                    Button("Edit", systemImage: "pencil") { editing = entry }
                                        .tint(.blue)
                                }
                            }
                    }
                }

                Section {
                    Color.clear.frame(height: 90)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Ledger.background)
            .searchable(text: $search, prompt: "Search income")
            .navigationTitle("Income")
            .refreshable { await store.loadAll() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAdd = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAdd) { EntryFormView(kind: .income) }
            .sheet(item: $editing) { EntryFormView(kind: .income, editingIncome: $0) }
        }
    }

    private var summaryHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("This Month").labelMono()
                MoneyText(
                    amount: store.monthTotal(store.allIncome, month: month),
                    currency: store.displayCurrency,
                    tint: Ledger.income
                )
            }

            if !slices.isEmpty {
                HStack(spacing: 16) {
                    Chart(slices, id: \.type) { slice in
                        SectorMark(
                            angle: .value("Amount", slice.value),
                            innerRadius: .ratio(0.68),
                            angularInset: 1.5
                        )
                        .cornerRadius(3)
                        .foregroundStyle(slice.color)
                        .opacity(
                            selectedSlice == nil || selectedSlice?.type == slice.type ? 1 : 0.35
                        )
                    }
                    .chartAngleSelection(value: $selectedAngle)
                    .chartBackground { _ in
                        VStack(spacing: 2) {
                            if let selected = selectedSlice {
                                Text(selected.label)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Text(store.format(selected.value, compact: true))
                                    .font(.system(.footnote, design: .rounded, weight: .bold))
                            } else {
                                Text("\(slices.count)")
                                    .font(.system(.title3, design: .rounded, weight: .bold))
                                Text("sources").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .frame(width: 130, height: 130)
                    .animation(.spring(duration: 0.35), value: selectedAngle != nil)

                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(slices.prefix(5), id: \.type) { slice in
                            HStack(spacing: 6) {
                                Circle().fill(slice.color).frame(width: 7, height: 7)
                                Text(slice.label).font(.caption).lineLimit(1)
                                Spacer()
                                Text(store.format(slice.value, compact: true))
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .padding(16)
        .financeCard()
        .padding(.vertical, 4)
    }
}

struct IncomeRow: View {
    @Environment(DataStore.self) private var store
    let entry: IncomeEntry

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(store.incomeColor(entry.type))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(entry.description.isEmpty ? store.incomeLabel(entry.type) : entry.description)
                        .font(.subheadline)
                        .lineLimit(1)
                    if entry.derived == true {
                        // Rows projected from tx logs — read-only, like the web.
                        Image(systemName: "link")
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                    }
                }
                Text("\(SydneyTime.shortLabel(entry.date)) · \(store.incomeLabel(entry.type))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(Money.format(entry.amount, currency: entry.currency))
                .font(.system(.footnote, design: .monospaced, weight: .medium))
                .foregroundStyle(entry.amount >= 0 ? Ledger.income : Ledger.expense)
        }
        .padding(.vertical, 2)
    }
}
