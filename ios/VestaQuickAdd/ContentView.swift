import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var categories: [ExpenseCategory] = []
    @Published var pendingCount = 0
    @Published var status: String?
    @Published var isError = false
    @Published var isSending = false

    private let client = QuickExpenseClient()

    func refresh() async {
        pendingCount = await PendingQueue.shared.count
        // Defaults + custom categories from the blob — no server config needed.
        var list = Categories.expenseLabels.map { ExpenseCategory(id: $0.id, label: $0.label) }
        if let raw = try? await SupabaseAPI.shared.fetchAppDataValue(
            key: "custom_expense_categories"
        ), let data = raw.data(using: .utf8),
           let custom = try? JSONDecoder().decode([CustomCategory].self, from: data) {
            list.append(contentsOf: custom.map { ExpenseCategory(id: $0.id, label: $0.label) })
        }
        categories = list
    }

    func flush() async {
        await PendingQueue.shared.flush()
        pendingCount = await PendingQueue.shared.count
    }

    func submit(amount: Double, category: String, vendor: String, note: String) async -> Bool {
        isSending = true
        defer { isSending = false }
        let expense = PendingExpense(amount: amount, type: category, vendor: vendor, note: note)
        do {
            let delivered = try await PendingQueue.shared.submit(expense)
            pendingCount = await PendingQueue.shared.count
            isError = false
            status = delivered ? "Added" : "Saved — will sync when online"
            return true
        } catch {
            isError = true
            status = error.localizedDescription
            return false
        }
    }
}

struct ContentView: View {
    @StateObject private var model = AppModel()
    @State private var amount = ""
    @State private var category = Settings.defaultCategory
    @State private var vendor = ""
    @State private var note = ""
    @State private var showingSettings = false
    @FocusState private var amountFocused: Bool

    private var parsedAmount: Double? {
        let cleaned = amount.replacingOccurrences(of: ",", with: "")
        guard let value = Double(cleaned), value > 0 else { return nil }
        return value
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Amount") {
                    TextField("0.00", text: $amount)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                        .focused($amountFocused)
                }

                Section("Details") {
                    Picker("Category", selection: $category) {
                        if model.categories.isEmpty {
                            ForEach(CategoryOptionsProvider.fallback, id: \.self) { id in
                                Text(id.capitalized).tag(id)
                            }
                        } else {
                            ForEach(model.categories, id: \.id) { c in
                                Text(c.label).tag(c.id)
                            }
                        }
                    }
                    TextField("Vendor", text: $vendor)
                    TextField("Note", text: $note)
                }

                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Spacer()
                            if model.isSending {
                                ProgressView()
                            } else {
                                Text("Add Expense").bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(parsedAmount == nil || model.isSending)
                }

                if let status = model.status {
                    Section {
                        Text(status)
                            .font(.footnote)
                            .foregroundStyle(model.isError ? .red : .secondary)
                    }
                }

                if model.pendingCount > 0 {
                    Section("Waiting to sync") {
                        Text("^[\(model.pendingCount) expense](inflect: true) queued")
                            .font(.footnote)
                        Button("Retry now") { Task { await model.flush() } }
                    }
                }
            }
            .navigationTitle("Quick Add")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView().onDisappear { Task { await model.refresh() } }
            }
            .task {
                await model.refresh()
                await model.flush()
            }
        }
    }

    private func save() async {
        guard let value = parsedAmount else { return }
        let ok = await model.submit(
            amount: value,
            category: category,
            vendor: vendor.trimmingCharacters(in: .whitespacesAndNewlines),
            note: note.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        if ok {
            amount = ""
            vendor = ""
            note = ""
            amountFocused = true
            Settings.defaultCategory = category
        }
    }
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var baseURL = Settings.baseURL
    @State private var token = Settings.token ?? ""
    @State private var checkResult: String?
    @State private var checking = false
    @State private var showQuickAddForm = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(Settings.productionURL, text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                } header: {
                    Text("Server")
                } footer: {
                    Text("Where the app and its API live. Leave as-is unless you're testing a preview deploy.")
                }
                Section {
                    SecureField("QUICK_ADD_TOKEN", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Token")
                } footer: {
                    Text("Must match QUICK_ADD_TOKEN in your Vercel environment variables.")
                }
                Section {
                    Button(checking ? "Checking…" : "Test connection") {
                        Task { await test() }
                    }
                    .disabled(checking)
                    if let checkResult {
                        Text(checkResult).font(.footnote).foregroundStyle(.secondary)
                    }
                }

                Section {
                    Button("Offline quick-add form") { showQuickAddForm = true }
                } footer: {
                    Text("Logs an expense natively when the web app can't load. The Action Button does the same thing without opening anything.")
                }
            }
            .sheet(isPresented: $showQuickAddForm) {
                ContentView()
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Settings.baseURL = baseURL
                        Settings.token = token
                        dismiss()
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func test() async {
        // Persist first — the client reads from Settings, not from these fields.
        Settings.baseURL = baseURL
        Settings.token = token
        checking = true
        defer { checking = false }
        do {
            let found = try await QuickExpenseClient().categories()
            checkResult = "Connected — \(found.count) categories."
        } catch {
            checkResult = error.localizedDescription
        }
    }
}

#Preview {
    ContentView()
}
