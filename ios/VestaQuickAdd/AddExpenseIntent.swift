import AppIntents
import Foundation

/// Category choices, pulled live from the server so categories added on the web
/// app (including custom ones) show up here without an app update.
struct CategoryOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        // Shortcuts resolves parameters INSIDE the intent's time budget, so a
        // cold network fetch here is time the actual expense doesn't get. Serve
        // what we already know instantly and refresh behind it; only a first
        // run with an empty cache waits, and then only briefly.
        if let cached = Settings.cachedCategories, !cached.isEmpty {
            Task.detached { _ = try? await CategoryOptionsProvider.fetch() }
            return cached
        }
        return (try? await withDeadline(3) { try await CategoryOptionsProvider.fetch() })
            ?? CategoryOptionsProvider.fallback
    }

    func defaultResult() async -> String? {
        Settings.defaultCategory
    }

    /// Custom categories straight from the blob; the built-in list keeps the
    /// Action Button usable offline.
    @discardableResult
    private static func fetch() async throws -> [String] {
        var ids = fallback
        if let raw = try? await SupabaseAPI.shared.fetchAppDataValue(
            key: "custom_expense_categories"
        ), let data = raw.data(using: .utf8),
           let custom = try? JSONDecoder().decode([CustomCategory].self, from: data) {
            ids.append(contentsOf: custom.map(\.id))
        }
        Settings.cachedCategories = ids
        return ids
    }

    static let fallback = [
        "food", "transport", "rent", "utilities", "entertainment", "shopping",
        "health", "insurance", "subscriptions", "education", "travel", "gifts",
        "other",
    ]
}

/// The Action Button target, and what the Wallet automation runs on a card tap.
///
/// `openAppWhenRun` is false so a tap logs the expense without ever showing the
/// app — press, type the amount, done. The confirmation comes back as a dialog.
///
/// Conforms to `LiveActivityIntent`, not plain `AppIntent`: ActivityKit refuses
/// `Activity.request` from a backgrounded app (`ActivityAuthorizationError
/// .visibility`), which is exactly the state a Wallet automation runs in. The
/// conformance is what grants a user-initiated intent the right to start a Live
/// Activity from the background — without it the Dynamic Island receipt was
/// being thrown away on every automated tap, silently, behind a `try?`.
struct AddExpenseIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Add Expense"
    static let description = IntentDescription(
        "Log an expense to Vesta without opening the app.",
        categoryName: "Expenses"
    )
    static let openAppWhenRun = false

    // IntentCurrencyAmount, NOT Double: the Wallet Transaction automation
    // passes a transaction object, and Shortcuts coerces it into a currency
    // amount losslessly — a plain Number slot coerced it to 0 and every
    // auto-logged payment failed with "must be more than zero". This also
    // carries the card's real currency instead of assuming the default.
    //
    // OPTIONAL on purpose. Non-optional, AppIntents treats a default-
    // constructed zero as "already resolved" and never prompts, so pressing
    // the Action Button failed instantly instead of asking for an amount.
    // Optional makes "missing" representable; perform() then asks explicitly.
    @Parameter(title: "Amount", requestValueDialog: "How much?")
    var amount: IntentCurrencyAmount?

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
        // Whether the amount arrived pre-filled decides the finish: a Wallet
        // automation supplies it and runs in the background, where presenting
        // a dialog can kill the helper process; the Action Button prompts,
        // which is inherently foreground and safe to answer with one.
        let ranInBackground = (amount.map { ($0.amount as NSDecimalNumber).doubleValue } ?? 0) > 0

        // The very first statement, before any work that could stall or die.
        // Its absence after a card tap is the diagnosis: Shortcuts never got
        // here, so the fault is upstream of the app (its own transaction-record
        // timeout, an expired signature, a deferred automation) and no amount
        // of fixing this file will help.
        IntentLog.write("— intent invoked —")

        // No server config needed — writes ride the app's own Supabase
        // session (or the offline queue). The old token setup is legacy.
        // Supplied (Wallet automation) → use it. Missing or zero (Action
        // Button, Siri) → ask, rather than failing on a phantom zero.
        var supplied = amount
        if (supplied.map { ($0.amount as NSDecimalNumber).doubleValue } ?? 0) <= 0 {
            IntentLog.write("no amount supplied — prompting")
            supplied = try await $amount.requestValue("How much?")
        }
        guard let resolved = supplied else {
            IntentLog.write("aborted: no amount given")
            throw QuickExpenseError.rejected("No amount given.")
        }
        let value = (resolved.amount as NSDecimalNumber).doubleValue
        guard value > 0 else {
            IntentLog.write("aborted: amount resolved to zero")
            Notify.post(
                title: "Quick-add failed",
                body: "Received a zero amount — open the automation and re-link the Amount pill to the transaction.",
                sound: .default
            )
            throw QuickExpenseError.rejected("Amount must be more than zero.")
        }
        let code = resolved.currencyCode.isEmpty
            ? Settings.defaultCurrency : resolved.currencyCode

        let expense = PendingExpense(
            amount: value,
            type: category ?? Settings.defaultCategory,
            vendor: vendor ?? "",
            currency: code
        )
        IntentLog.write("resolved \(code) \(value) · \(expense.type) · \(expense.vendor.isEmpty ? "no vendor" : expense.vendor)")

        let delivered = try await PendingQueue.shared.submit(expense)
        let formatted = Self.currencyText(value, code: expense.currency)

        // The Dynamic Island receipt — this is what makes an Apple-Pay-tap →
        // Shortcuts automation feel native instead of a silent background log.
        // Awaited, not fire-and-forget: once perform() returns, iOS is free to
        // suspend the process, and a detached Task that hasn't run yet never
        // will.
        await ExpenseIslandPresenter.show(
            amountText: formatted,
            vendor: expense.vendor,
            category: expense.type,
            queued: !delivered
        )

        // Durable record in Notification Center, with the details the island
        // only shows for a minute.
        Notify.post(
            title: delivered ? "Expense logged" : "Expense queued — offline",
            body: "\(formatted) · \(expense.vendor.isEmpty ? "Quick add" : expense.vendor) · \(expense.type)"
        )
        IntentLog.write("— done: \(delivered ? "logged" : "queued") \(formatted) —")

        // A queued expense is a success from the user's point of view — it's
        // recorded and will sync. Saying "failed" would invite a second tap.
        // Background runs finish silently (the island + notification already
        // told the story); only the foreground prompt path speaks.
        if ranInBackground {
            return .result(dialog: IntentDialog(""))
        }
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
        AppShortcut(
            intent: LogTapIntent(),
            phrases: [
                "Log a card tap in \(.applicationName)",
            ],
            shortTitle: "Log Card Tap",
            systemImageName: "waveform.path.ecg"
        )
    }
}
