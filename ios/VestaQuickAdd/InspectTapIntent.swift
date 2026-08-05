import AppIntents
import Foundation

/// The see-everything probe: opens Vesta and shows a plain alert with every
/// value the Wallet automation actually handed over.
///
/// Exists because the silent probe logged `amount=<none> · merchant=<none>`
/// from a real tap — the automation reached the app, but the pills weren't
/// carrying the transaction. This intent makes the handoff visible on the
/// phone itself: no Mac, no log pulling — tap card, read alert.
struct InspectTapIntent: AppIntent {
    static let title: LocalizedStringResource = "Inspect Wallet Data"
    static let description = IntentDescription(
        "Opens Vesta and shows everything the automation passed in.",
        categoryName: "Expenses"
    )
    /// Foreground on purpose — the whole point is to LOOK at the values.
    static let openAppWhenRun = true

    @Parameter(title: "Amount")
    var amount: IntentCurrencyAmount?

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Name")
    var name: String?

    @Parameter(title: "Card")
    var card: String?

    @Parameter(title: "Anything else")
    var extra: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Inspect \(\.$amount) at \(\.$merchant)") {
            \.$name
            \.$card
            \.$extra
        }
    }

    func perform() async throws -> some IntentResult {
        var lines: [String] = []
        if let amount {
            let value = (amount.amount as NSDecimalNumber).doubleValue
            lines.append("Amount: \(value) \(amount.currencyCode.isEmpty ? "(no currency)" : amount.currencyCode)")
        } else {
            lines.append("Amount: — nothing arrived")
        }
        lines.append("Merchant: \(merchant?.isEmpty == false ? merchant! : "— nothing arrived")")
        lines.append("Name: \(name?.isEmpty == false ? name! : "— nothing arrived")")
        lines.append("Card: \(card?.isEmpty == false ? card! : "— nothing arrived")")
        if let extra, !extra.isEmpty { lines.append("Extra: \(extra)") }

        let report = lines.joined(separator: "\n")
        BreadcrumbLog.tap.write("INSPECT · " + report.replacingOccurrences(of: "\n", with: " · "))
        // The app (foregrounded by this intent) watches this key and shows
        // the alert the moment it becomes active.
        Settings.defaults.set(report, forKey: "pendingTapInspection")
        return .result()
    }
}
