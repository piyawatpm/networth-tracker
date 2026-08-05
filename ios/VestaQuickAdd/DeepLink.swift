import Foundation

/// vesta:// deep links — quick-add without App Intents.
///
/// Exists because the iOS 26.6 BETA broke third-party intents in automations:
/// every invocation dies with "couldn't communicate with a helper
/// application" before any app code runs, while Apple's own actions work.
/// So the Wallet automation uses Apple's Open-URLs action to drive these:
///
///     vesta://add?amount=[Amount]&merchant=[Merchant]
///     vesta://tap?amount=[Amount]&merchant=[Merchant]   (inspect only)
///
/// Shortcuts pastes variables into the URL text raw — spaces, currency
/// symbols, no percent-encoding — so parsing is deliberately tolerant
/// instead of URLComponents-strict.
enum DeepLink {
    struct QuickAdd {
        var amount: Double?
        var currency: String?
        var merchant: String
        var raw: String
    }

    enum Kind {
        case add(QuickAdd)
        case inspect(QuickAdd)
    }

    static func parse(_ url: URL) -> Kind? {
        guard url.scheme?.lowercased() == "vesta" else { return nil }
        let action = (url.host ?? url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))).lowercased()

        // Hand-split the query: the automation writes it unencoded.
        let full = url.absoluteString
        var fields: [String: String] = [:]
        if let mark = full.firstIndex(of: "?") {
            for pair in full[full.index(after: mark)...].components(separatedBy: "&") {
                let parts = pair.components(separatedBy: "=")
                guard parts.count >= 2 else { continue }
                let key = parts[0].lowercased()
                let value = parts[1...].joined(separator: "=")
                    .removingPercentEncoding ?? parts[1...].joined(separator: "=")
                fields[key] = value.trimmingCharacters(in: .whitespaces)
            }
        }

        let payload = QuickAdd(
            amount: firstNumber(in: fields["amount"] ?? ""),
            currency: currencyCode(in: fields["amount"] ?? "", explicit: fields["currency"]),
            merchant: fields["merchant"] ?? fields["name"] ?? "",
            raw: full
        )
        switch action {
        case "add": return .add(payload)
        case "tap", "inspect": return .inspect(payload)
        default: return nil
        }
    }

    /// "A$17.10", "17,10", "17.1 AUD" → 17.1. Shortcuts formats currency
    /// amounts per locale, so pull the first numeric run and normalize.
    static func firstNumber(in text: String) -> Double? {
        var digits = ""
        var seenDigit = false
        for ch in text {
            if ch.isNumber { digits.append(ch); seenDigit = true }
            else if (ch == "." || ch == ",") && seenDigit { digits.append(".") }
            else if seenDigit { break }
        }
        // "1.234.56" from thousands separators → keep only the LAST dot.
        let parts = digits.components(separatedBy: ".")
        let normalized = parts.count > 1
            ? parts.dropLast().joined() + "." + (parts.last ?? "")
            : digits
        return Double(normalized).flatMap { $0 > 0 ? $0 : nil }
    }

    /// Currency: explicit &currency= wins; else a 3-letter code or symbol
    /// riding inside the amount text ("A$", "฿", "17.10 AUD").
    static func currencyCode(in amountText: String, explicit: String?) -> String? {
        if let explicit, !explicit.isEmpty { return explicit.uppercased() }
        let upper = amountText.uppercased()
        for code in ["AUD", "USD", "THB", "EUR", "GBP", "JPY", "SGD", "NZD"] {
            if upper.contains(code) { return code }
        }
        if amountText.contains("฿") { return "THB" }
        if amountText.contains("A$") { return "AUD" }
        if amountText.contains("US$") { return "USD" }
        return nil
    }
}
