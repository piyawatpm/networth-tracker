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
    //
    // STRING, not IntentCurrencyAmount: parameter conversion runs BEFORE
    // perform(), and the 26.6 beta appears to choke converting the Wallet
    // transaction's amount ("AUD 6.12") into a currency amount — killing the
    // helper process before a single line here could log. Text accepts
    // anything; DeepLink's lenient parser does the reading.
    @Parameter(title: "Amount")
    var amount: String?

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Anything else")
    var note: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log card tap \(\.$amount) at \(\.$merchant)") {
            \.$note
        }
    }

    func perform() async throws -> some IntentResult {
        var parts: [String] = []

        if let amount, !amount.isEmpty {
            // Raw AND parsed — the raw text is the evidence, the parse is
            // the verdict on whether AddExpense would have understood it.
            let value = DeepLink.firstNumber(in: amount)
            let code = DeepLink.currencyCode(in: amount, explicit: nil)
            parts.append("amount-raw='\(amount)' parsed=\(value.map { String($0) } ?? "✗") \(code ?? "")")
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

        // No dialog, ON PURPOSE: a background Wallet automation may have no
        // surface to present one on, and a failed presentation kills the
        // helper process — which Shortcuts reports as "couldn't communicate
        // with a helper application". The receipt IS the log entry.
        return .result()
    }
}
