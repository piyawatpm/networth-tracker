import Foundation

/// Hostplus publishes a daily unit price for each investment option behind its
/// public "investment returns" page — no member login required. These are the
/// same endpoints the web app uses (see `lib/utils/hostplus.ts`). There is no
/// official developer API, and member balances/units are NOT reachable — only
/// the public unit prices. Flow:
///   1. GET …investment-returns.irm.auth.json      → short-lived Bearer JWT
///   2. GET …investment-returns.irm.returns.json   → 5 days of "$1.2345" prices
/// ProductId 13 = Superannuation; frequencyType 1 = daily unit pricing.
enum HostplusAPI {
    /// Maps a holding's `ticker` to the Hostplus option NAME it tracks. Prices
    /// come back keyed by name, so matching on name lets us skip the separate
    /// option-code lookup. The user's super sits in International Shares -
    /// Indexed (code HC21A) — confirmed by transaction prices (~$2.9/unit).
    static let optionNameByTicker: [String: String] = [
        "HOSTPLUS": "International Shares - Indexed",
    ]

    private static let base =
        "https://hostplus.com.au/content/hostplus-program/home/members/our-products-and-services/investment-options/investment-returns"

    private static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

    enum HostplusError: LocalizedError {
        case badStatus(Int)
        var errorDescription: String? {
            switch self {
            case .badStatus(let code): return "Hostplus returned HTTP \(code)"
            }
        }
    }

    private struct ReturnsResponse: Decodable {
        struct Msg: Decodable {
            struct Section: Decodable {
                struct Item: Decodable {
                    let currentOptionName: String?
                    let price: [String]?
                }
                let Items: [Item]?
            }
            let DailyData: [Section]?
        }
        let msg: Msg?
    }

    /// Latest daily unit price (AUD) for every option, keyed by trimmed name.
    static func latestPrices(productId: Int = 13) async throws -> [String: Double] {
        let token = try await fetchToken()

        var req = URLRequest(url: URL(string:
            "\(base).irm.returns.json?ProductId=\(productId)&frequencyType=1")!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "irm-authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")

        let (data, resp) = try await URLSession.shared.data(for: req)
        try check(resp)

        let decoded = try JSONDecoder().decode(ReturnsResponse.self, from: data)
        var out: [String: Double] = [:]
        for section in decoded.msg?.DailyData ?? [] {
            for item in section.Items ?? [] {
                guard let name = item.currentOptionName?
                        .trimmingCharacters(in: .whitespaces),
                      let last = item.price?.last,          // last = most recent
                      let value = parsePrice(last) else { continue }
                out[name] = value
            }
        }
        return out
    }

    private static func fetchToken() async throws -> String {
        var req = URLRequest(url: URL(string: "\(base).irm.auth.json")!)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")

        let (data, resp) = try await URLSession.shared.data(for: req)
        try check(resp)
        // The endpoint returns a bare JSON string (the JWT).
        if let token = try? JSONDecoder().decode(String.self, from: data) {
            return token
        }
        return String(decoding: data, as: UTF8.self)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\"\n "))
    }

    private static func parsePrice(_ raw: String) -> Double? {
        Double(raw
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: ""))
    }

    private static func check(_ resp: URLResponse) throws {
        guard let http = resp as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw HostplusError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }

    /// Reprice a holding to `units × price`, calibrating the unit count on first
    /// use. Mirrors `repriceHostplusHolding()` in `lib/utils/hostplus.ts`: when
    /// `units × price` is >20% off the stored value the units are treated as
    /// untrustworthy and back-solved from the value (keeps today's balance);
    /// normal daily moves (<5%) never trip it, so it effectively runs once.
    static func reprice(units: Double, currentValue: Double, price: Double)
        -> (units: Double, currentValue: Double) {
        var u = units
        let implied = u * price
        if currentValue > 0, abs(implied - currentValue) / currentValue > 0.2 {
            u = currentValue / price
        }
        return (u, u * price)
    }
}
