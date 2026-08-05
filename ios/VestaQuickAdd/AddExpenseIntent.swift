import AppIntents
import Foundation

/// Category choices, pulled live from the server so categories added on the web
/// app (including custom ones) show up here without an app update.
struct CategoryOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        // Custom categories straight from the blob; the built-in list keeps
        // the Action Button usable offline.
        var ids = CategoryOptionsProvider.fallback
        if let raw = try? await SupabaseAPI.shared.fetchAppDataValue(
            key: "custom_expense_categories"
        ), let data = raw.data(using: .utf8),
           let custom = try? JSONDecoder().decode([CustomCategory].self, from: data) {
            ids.append(contentsOf: custom.map(\.id))
        }
        return ids
    }

    func defaultResult() async -> String? {
        Settings.defaultCategory
    }

    static let fallback = [
        "food", "transport", "rent", "utilities", "entertainment", "shopping",
        "health", "insurance", "subscriptions", "education", "travel", "gifts",
        "other",
    ]
}

/// The Action Button target.
///
/// `openAppWhenRun` is false so a tap logs the expense without ever showing the
/// app — press, type the amount, done. The confirmation comes back as a dialog.
struct AddExpenseIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Expense"
    static let description = IntentDescription(
        "Log an expense to Vesta without opening the app.",
        categoryName: "Expenses"
    )
    static let openAppWhenRun = false

    // IntentCurrencyAmount, NOT Double: the Wallet Transaction automation
    // passes a transaction object, and Shortcuts can coerce it into a currency
    // amount losslessly — a plain Number slot coerced it to 0 and every
    // auto-logged payment failed with "must be more than zero". This also
    // carries the card's real currency instead of assuming the default.
    @Parameter(title: "Amount", requestValueDialog: "How much?")
    var amount: IntentCurrencyAmount

    @Parameter(title: "Category", optionsProvider: CategoryOptionsProvider())
    var category: String?

    @Parameter(title: "Vendor")
    var vendor: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$amount) expense for \(\.$category)") {
            \.$vendor
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // No server config needed — writes ride the app's own Supabase
        // session (or the offline queue). The old token setup is legacy.
        let value = (amount.amount as NSDecimalNumber).doubleValue
        guard value > 0 else {
            throw QuickExpenseError.rejected("Amount must be more than zero.")
        }
        let code = amount.currencyCode.isEmpty
            ? Settings.defaultCurrency : amount.currencyCode

        let expense = PendingExpense(
            amount: value,
            type: category ?? Settings.defaultCategory,
            vendor: vendor ?? "",
            currency: code
        )

        let delivered = try await PendingQueue.shared.submit(expense)
        let formatted = Self.currencyText(value, code: expense.currency)

        // The Dynamic Island receipt — this is what makes an Apple-Pay-tap →
        // Shortcuts automation feel native instead of a silent background log.
        ExpenseIslandPresenter.show(
            amountText: formatted,
            vendor: expense.vendor,
            category: expense.type,
            queued: !delivered
        )

        // A queued expense is a success from the user's point of view — it's
        // recorded and will sync. Saying "failed" would invite a second tap.
        return .result(
            dialog: delivered
                ? IntentDialog("Logged \(formatted)")
                : IntentDialog("Saved \(formatted) — will sync when you're back online")
        )
    }

    private static func currencyText(_ value: Double, code: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = code
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    }
}

/// Registers the intent with the system so it appears in the Action Button
/// picker and in Siri, with no manual Shortcut assembly required.
struct VestaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddExpenseIntent(),
            phrases: [
                "Add expense to \(.applicationName)",
                "Log an expense in \(.applicationName)",
                "New \(.applicationName) expense",
            ],
            shortTitle: "Add Expense",
            systemImageName: "creditcard"
        )
    }
}
