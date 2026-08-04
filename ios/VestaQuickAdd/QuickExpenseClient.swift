import Foundation

/// One expense on its way to the server.
///
/// `clientId` is generated once, when the expense is created, and reused across
/// every retry. The server treats a repeat of the same `clientId` as the same
/// expense, so a request that actually succeeded but whose response was lost to
/// a dropped connection can be safely resent instead of double-charging you.
struct PendingExpense: Codable, Sendable, Identifiable, Equatable {
    var clientId: String
    var amount: Double
    var type: String
    var vendor: String
    var note: String
    var currency: String
    var createdAt: Date

    var id: String { clientId }

    init(
        amount: Double,
        type: String,
        vendor: String = "",
        note: String = "",
        currency: String = Settings.defaultCurrency,
        clientId: String = UUID().uuidString,
        createdAt: Date = Date()
    ) {
        self.clientId = clientId
        self.amount = amount
        self.type = type
        self.vendor = vendor
        self.note = note
        self.currency = currency
        self.createdAt = createdAt
    }

    /// Stamped the day the expense was ENTERED, not the day it finally
    /// synced — a queued item that uploads two days later still belongs to
    /// the day you actually spent the money.
    var dateString: String {
        Self.dateFormatter.string(from: createdAt)
    }

    /// The wire format the legacy /api/quick-expense route expects.
    var body: [String: Any] {
        [
            "amount": amount,
            "type": type,
            "vendor": vendor,
            "description": note,
            "currency": currency,
            "clientId": clientId,
            "date": dateString,
        ]
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Australia/Sydney")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

struct ExpenseCategory: Codable, Sendable, Hashable {
    let id: String
    let label: String
}

private struct CategoriesResponse: Codable {
    let categories: [ExpenseCategory]
    let defaultCurrency: String?
}

enum QuickExpenseError: LocalizedError {
    case notConfigured
    case unauthorized
    /// The server rejected the expense itself — retrying will never help.
    case rejected(String)
    /// Network or server-side trouble; the expense should stay queued.
    case transient(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Set your server URL and token in Settings first."
        case .unauthorized:
            return "Token rejected. Check it matches QUICK_ADD_TOKEN on the server."
        case .rejected(let message):
            return message
        case .transient(let message):
            return message
        }
    }

    /// Whether the item should stay in the queue for another attempt.
    var isRetryable: Bool {
        switch self {
        case .transient: return true
        case .notConfigured, .unauthorized, .rejected: return false
        }
    }
}

struct QuickExpenseClient: Sendable {
    private static func request(_ method: String) throws -> URLRequest {
        guard Settings.isConfigured, let url = Settings.endpoint else {
            throw QuickExpenseError.notConfigured
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 15
        req.setValue("Bearer \(Settings.token ?? "")", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return req
    }

    /// Posts one expense. Returns normally on success (including when the
    /// server recognised it as a duplicate of an earlier attempt).
    func send(_ expense: PendingExpense) async throws {
        var req = try Self.request("POST")
        req.httpBody = try JSONSerialization.data(withJSONObject: expense.body)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            // Offline, timeout, DNS — all worth another attempt later.
            throw QuickExpenseError.transient(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw QuickExpenseError.transient("No response from server.")
        }

        switch http.statusCode {
        case 200...299:
            return
        case 401:
            throw QuickExpenseError.unauthorized
        case 400...499:
            throw QuickExpenseError.rejected(Self.message(from: data) ?? "Rejected by server.")
        default:
            throw QuickExpenseError.transient(
                Self.message(from: data) ?? "Server error \(http.statusCode)."
            )
        }
    }

    func categories() async throws -> [ExpenseCategory] {
        let req = try Self.request("GET")
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw QuickExpenseError.transient(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw QuickExpenseError.transient("No response from server.")
        }
        if http.statusCode == 401 { throw QuickExpenseError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            throw QuickExpenseError.transient("Server error \(http.statusCode).")
        }
        let decoded = try JSONDecoder().decode(CategoriesResponse.self, from: data)
        if let currency = decoded.defaultCurrency, !currency.isEmpty {
            Settings.defaultCurrency = currency
        }
        return decoded.categories
    }

    private static func message(from data: Data) -> String? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = object["error"] as? String
        else { return nil }
        return error
    }
}
