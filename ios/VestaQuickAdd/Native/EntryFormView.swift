import SwiftUI

/// One form for income and expense add/edit — the fields are 90% shared, and
/// one implementation means one set of bugs.
struct EntryFormView: View {
    enum Kind { case income, expense }

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let kind: Kind
    var editingIncome: IncomeEntry?
    var editingExpense: ExpenseEntry?

    @State private var amount = ""
    @State private var category = ""
    @State private var descriptionText = ""
    @State private var vendorOrSource = ""
    @State private var notes = ""
    @State private var currency = "AUD"
    @State private var date = Date()
    @State private var paymentMethod = "other"
    @State private var saving = false
    @State private var error: String?
    @State private var savedPulse = false
    @FocusState private var amountFocused: Bool

    private var isEditing: Bool { editingIncome != nil || editingExpense != nil }

    private var categories: [(id: String, label: String)] {
        switch kind {
        case .income:
            // Derived categories are projected from tx logs — hand-adding one
            // would double-count, so they're not offered.
            let defaults = Categories.incomeLabels.filter {
                !Categories.derivedIncomeTypes.contains($0.id)
            }
            return defaults + store.customIncomeCategories.map { ($0.id, $0.label) }
        case .expense:
            return Categories.expenseLabels + store.customExpenseCategories.map { ($0.id, $0.label) }
        }
    }

    private var parsedAmount: Double? {
        let value = Double(amount.replacingOccurrences(of: ",", with: ""))
        return (value ?? 0) > 0 ? value : nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 8) {
                        Text(Money.symbol(currency))
                            .font(.system(size: 30, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                        TextField("0.00", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 34, weight: .semibold, design: .rounded))
                            .focused($amountFocused)
                    }
                    Picker("Currency", selection: $currency) {
                        ForEach(["AUD", "USD", "THB"], id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Category") {
                    // Grid beats a wheel for 13+ categories: everything visible,
                    // one tap, color-coded to match the web's donut.
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 8)], spacing: 8) {
                        ForEach(categories, id: \.id) { item in
                            let color = kind == .income
                                ? store.incomeColor(item.id) : store.expenseColor(item.id)
                            let selected = category == item.id
                            Button {
                                withAnimation(.snappy(duration: 0.2)) { category = item.id }
                            } label: {
                                HStack(spacing: 5) {
                                    Circle().fill(color).frame(width: 7, height: 7)
                                    Text(item.label)
                                        .font(.caption)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.8)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 9)
                                .background(
                                    selected ? color.opacity(0.18) : Color.primary.opacity(0.05),
                                    in: .capsule
                                )
                                .overlay(
                                    Capsule().strokeBorder(
                                        selected ? color : .clear, lineWidth: 1.5
                                    )
                                )
                            }
                            .buttonStyle(.plain)
                            .sensoryFeedback(.selection, trigger: selected)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("Details") {
                    TextField("Description", text: $descriptionText)
                    TextField(kind == .income ? "Source" : "Vendor", text: $vendorOrSource)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    if kind == .expense {
                        Picker("Paid with", selection: $paymentMethod) {
                            ForEach(Categories.paymentMethods, id: \.id) {
                                Text($0.label).tag($0.id)
                            }
                        }
                    }
                    TextField("Notes", text: $notes, axis: .vertical)
                }

                if let error {
                    Section {
                        Text(error).font(.footnote).foregroundStyle(Ledger.expense)
                    }
                }
            }
            .navigationTitle(
                isEditing
                    ? "Edit \(kind == .income ? "Income" : "Expense")"
                    : "Add \(kind == .income ? "Income" : "Expense")"
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView() } else { Text("Save").bold() }
                    }
                    .disabled(parsedAmount == nil || category.isEmpty || saving)
                }
            }
            .sensoryFeedback(.success, trigger: savedPulse)
            .onAppear(perform: populate)
        }
    }

    private func populate() {
        if let entry = editingIncome {
            amount = String(entry.amount)
            category = entry.type
            descriptionText = entry.description
            vendorOrSource = entry.source
            notes = entry.notes
            currency = entry.currency
            date = dateFrom(entry.date)
        } else if let entry = editingExpense {
            amount = String(entry.amount)
            category = entry.type
            descriptionText = entry.description
            vendorOrSource = entry.vendor
            notes = entry.notes
            currency = entry.currency
            paymentMethod = entry.paymentMethod
            date = dateFrom(entry.date)
        } else {
            currency = store.displayCurrency == "THB" ? "AUD" : store.displayCurrency
            category = kind == .income ? "salary" : "food"
            amountFocused = true
        }
    }

    private func dateFrom(_ string: String) -> Date {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = SydneyTime.zone
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: String(string.prefix(10))) ?? Date()
    }

    private func dateString(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = SydneyTime.zone
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    private func save() async {
        guard let value = parsedAmount else { return }
        saving = true
        error = nil
        do {
            switch kind {
            case .income:
                var entry = editingIncome ?? IncomeEntry(
                    type: category, description: descriptionText, amount: value,
                    currency: currency, date: dateString(date)
                )
                entry.type = category
                entry.description = descriptionText
                entry.amount = value
                entry.currency = currency
                entry.date = dateString(date)
                entry.source = vendorOrSource
                entry.notes = notes
                try await store.saveIncome(entry)
            case .expense:
                var entry = editingExpense ?? ExpenseEntry(
                    type: category, description: descriptionText, amount: value,
                    currency: currency, date: dateString(date)
                )
                entry.type = category
                entry.description = descriptionText
                entry.amount = value
                entry.currency = currency
                entry.date = dateString(date)
                entry.vendor = vendorOrSource
                entry.notes = notes
                entry.paymentMethod = paymentMethod
                try await store.saveExpense(entry)
            }
            savedPulse.toggle()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
