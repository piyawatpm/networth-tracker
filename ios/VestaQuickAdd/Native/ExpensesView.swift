import SwiftUI
import Charts

struct ExpensesView: View {
    @Environment(DataStore.self) private var store
    @State private var showAdd = false
    @State private var editing: ExpenseEntry?
    @State private var search = ""

    private var month: String { SydneyTime.currentMonthKey() }

    private var monthExpenses: [ExpenseEntry] {
        store.expenses.filter { SydneyTime.monthKey($0.date) == month }
    }

    private var byCategory: [(type: String, label: String, value: Double, color: Color)] {
        var map: [String: Double] = [:]
        for entry in monthExpenses {
            map[entry.type, default: 0] += store.convert(entry.amount, from: entry.currency)
        }
        return map
            .filter { $0.value > 0 }
            .map { (type: $0.key, label: store.expenseLabel($0.key), value: $0.value, color: store.expenseColor($0.key)) }
            .sorted { $0.value > $1.value }
    }

    private var listEntries: [ExpenseEntry] {
        let sorted = store.expenses.sorted {
            $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt
        }
        guard !search.isEmpty else { return sorted }
        let q = search.lowercased()
        return sorted.filter {
            $0.description.lowercased().contains(q)
                || $0.vendor.lowercased().contains(q)
                || store.expenseLabel($0.type).lowercased().contains(q)
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
                        ExpenseRow(entry: entry)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button("Delete", systemImage: "trash", role: .destructive) {
                                    Task { try? await store.deleteExpense(entry.id) }
                                }
                                Button("Edit", systemImage: "pencil") { editing = entry }
                                    .tint(.blue)
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
            .searchable(text: $search, prompt: "Search expenses")
            .navigationTitle("Expenses")
            .refreshable { await store.loadAll() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAdd = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAdd) { EntryFormView(kind: .expense) }
            .sheet(item: $editing) { EntryFormView(kind: .expense, editingExpense: $0) }
        }
    }

    private var summaryHeader: some View {
        let total = store.monthTotalExpenses(month: month)
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Spent This Month").labelMono()
                MoneyText(
                    amount: total,
                    currency: store.displayCurrency,
                    tint: Ledger.expense
                )
            }

            // Ranked bars beat a donut for spending: the question is "what's
            // eating the money", and ordered lengths answer it at a glance.
            VStack(spacing: 8) {
                ForEach(byCategory.prefix(6), id: \.type) { row in
                    VStack(spacing: 4) {
                        HStack {
                            Circle().fill(row.color).frame(width: 7, height: 7)
                            Text(row.label).font(.caption)
                            Spacer()
                            Text("\(store.format(row.value, compact: true)) · \(Int((row.value / max(1, total)) * 100))%")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        GeometryReader { geo in
                            Capsule()
                                .fill(row.color.opacity(0.85))
                                .frame(width: max(3, geo.size.width * row.value / max(1, byCategory.first?.value ?? 1)))
                                .animation(.spring(duration: 0.6), value: row.value)
                        }
                        .frame(height: 5)
                        .background(Capsule().fill(.primary.opacity(0.06)))
                    }
                }
            }
        }
        .padding(16)
        .financeCard()
        .padding(.vertical, 4)
    }
}

struct ExpenseRow: View {
    @Environment(DataStore.self) private var store
    let entry: ExpenseEntry

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(store.expenseColor(entry.type))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.description.isEmpty ? store.expenseLabel(entry.type) : entry.description)
                    .font(.subheadline)
                    .lineLimit(1)
                Text("\(SydneyTime.shortLabel(entry.date)) · \(entry.vendor.isEmpty ? store.expenseLabel(entry.type) : entry.vendor)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(Money.format(entry.amount, currency: entry.currency))
                .font(.system(.footnote, design: .monospaced, weight: .medium))
                .foregroundStyle(Ledger.expense)
        }
        .padding(.vertical, 2)
    }
}
