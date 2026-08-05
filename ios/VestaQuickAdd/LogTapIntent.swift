import AppIntents
import Foundation

/// The "did the automation even fire?" probe.
///
/// It accepts anything, validates nothing, touches no network, starts no Live
/// Activity, and has no failure path — `perform()` cannot throw and cannot
/// block. That is the entire point. The quick-add intent can't answer the one
/// question that matters when a card tap goes missing, because it is itself a
/// suspect: a run that produced no result could mean Shortcuts never reached
/// the app, or that the app was reached and died. This one is too simple to
/// die, so:
///
///   * **An entry appears** → the automation fires and the app is reachable.
///     Whatever went wrong is inside the quick-add path, and the entry shows
///     exactly which pills Shortcuts actually handed over.
///   * **No entry** → the automation never got here. The fault is upstream:
///     Shortcuts timing out waiting on CommBank's transaction record, an
///     expired signature, Low Power Mode deferring it.
///
/// Put it as the FIRST action of the same automation, above Add Expense, and
/// every tap leaves a receipt even when the expense doesn't.
struct LogTapIntent: AppIntent {
    static let title: LocalizedStringResource = "Log Card Tap (Debug)"
    static let description = IntentDescription(
        "Records whatever an automation hands it and always succeeds. Put it above Add Expense to prove a tap reached the app.",
        categoryName: "Expenses"
    )
    static let openAppWhenRun = false

    // Every parameter optional, none with a requestValueDialog: a probe that
    // stops to ask a question is a probe that fails in the background, which
    // is precisely the failure being investigated.
    @Parameter(title: "Amount")
    var amount: IntentCurrencyAmount?

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Anything else")
    var note: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log card tap \(\.$amount) at \(\.$merchant)") {
            \.$note
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        var parts: [String] = []

        if let amount {
            let value = (amount.amount as NSDecimalNumber).doubleValue
            let code = amount.currencyCode.isEmpty ? "?" : amount.currencyCode
            parts.append("amount=\(value) \(code)")
        } else {
            // Worth distinguishing from a zero: "no pill linked" and "pill
            // linked but Shortcuts sent nothing" are different fixes.
            parts.append("amount=<none>")
        }

        if let merchant, !merchant.isEmpty {
            parts.append("merchant=\(merchant)")
        } else {
            parts.append("merchant=<none>")
        }

        if let note, !note.isEmpty { parts.append("note=\(note)") }

        BreadcrumbLog.tap.write(parts.joined(separator: " · "))

        return .result(dialog: IntentDialog("Tap logged"))
    }
}
