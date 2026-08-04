import Foundation

// Mirrors lib/utils/types.ts. Decoding is lenient (old rows lack new fields —
// same reason the web has normalizeIncomeEntry), but encoding writes every
// known field so a round-trip through the native app never strips data the
// web app relies on.

struct IncomeEntry: Identifiable, Codable, Equatable {
    var id: String
    var type: String
    var description: String
    var amount: Double
    var currency: String
    var date: String
    var source: String
    var notes: String
    var isPassive: Bool?
    var isRecurring: Bool?
    var recurringId: String?
    var createdAt: Double
    /// Local-only marker for rows projected from the transaction logs.
    var derived: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "other"
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        amount = try c.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? "AUD"
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? ""
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        isPassive = try c.decodeIfPresent(Bool.self, forKey: .isPassive)
        isRecurring = try c.decodeIfPresent(Bool.self, forKey: .isRecurring)
        recurringId = try c.decodeIfPresent(String.self, forKey: .recurringId)
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
        derived = nil
    }

    init(
        id: String = UUID().uuidString, type: String, description: String,
        amount: Double, currency: String, date: String, source: String = "",
        notes: String = "", isPassive: Bool? = nil, isRecurring: Bool? = nil,
        recurringId: String? = nil,
        createdAt: Double = Date().timeIntervalSince1970 * 1000,
        derived: Bool? = nil
    ) {
        self.id = id; self.type = type; self.description = description
        self.amount = amount; self.currency = currency; self.date = date
        self.source = source; self.notes = notes; self.isPassive = isPassive
        self.isRecurring = isRecurring; self.recurringId = recurringId
        self.createdAt = createdAt; self.derived = derived
    }

    /// `derived` must never reach storage — those rows are recomputed, not kept.
    enum CodingKeys: String, CodingKey {
        case id, type, description, amount, currency, date, source, notes
        case isPassive, isRecurring, recurringId, createdAt
    }
}

struct ExpenseEntry: Identifiable, Codable, Equatable {
    var id: String
    var type: String
    var description: String
    var amount: Double
    var currency: String
    var vendor: String
    var date: String
    var notes: String
    var images: [String]
    var createdAt: Double
    var paymentMethod: String
    var isRecurring: Bool?
    var recurringId: String?
    var isOneOff: Bool?
    /// Written by the quick-add endpoint; preserved so replay dedupe survives edits.
    var clientId: String?
    var source: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "other"
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        amount = try c.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? "AUD"
        vendor = try c.decodeIfPresent(String.self, forKey: .vendor) ?? ""
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        images = try c.decodeIfPresent([String].self, forKey: .images) ?? []
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
        paymentMethod = try c.decodeIfPresent(String.self, forKey: .paymentMethod) ?? "other"
        isRecurring = try c.decodeIfPresent(Bool.self, forKey: .isRecurring)
        recurringId = try c.decodeIfPresent(String.self, forKey: .recurringId)
        isOneOff = try c.decodeIfPresent(Bool.self, forKey: .isOneOff)
        clientId = try c.decodeIfPresent(String.self, forKey: .clientId)
        source = try c.decodeIfPresent(String.self, forKey: .source)
    }

    init(
        id: String = UUID().uuidString, type: String, description: String,
        amount: Double, currency: String, vendor: String = "", date: String,
        notes: String = "", images: [String] = [],
        createdAt: Double = Date().timeIntervalSince1970 * 1000,
        paymentMethod: String = "other", isRecurring: Bool? = nil,
        recurringId: String? = nil, isOneOff: Bool? = nil,
        clientId: String? = nil, source: String? = nil
    ) {
        self.id = id; self.type = type; self.description = description
        self.amount = amount; self.currency = currency; self.vendor = vendor
        self.date = date; self.notes = notes; self.images = images
        self.createdAt = createdAt; self.paymentMethod = paymentMethod
        self.isRecurring = isRecurring; self.recurringId = recurringId
        self.isOneOff = isOneOff; self.clientId = clientId; self.source = source
    }
}

struct PortfolioHolding: Identifiable, Codable, Equatable {
    var id: String
    var name: String
    var ticker: String
    var type: String
    var accountType: String
    var broker: String
    var country: String
    var link: String
    var units: Double
    var amountInvested: Double
    var currentValue: Double
    var currency: String
    var notes: String
    var createdAt: Double
    var isEmergencyFund: Bool?
    var isCash: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        ticker = try c.decodeIfPresent(String.self, forKey: .ticker) ?? ""
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "stock"
        accountType = try c.decodeIfPresent(String.self, forKey: .accountType) ?? "normal"
        broker = try c.decodeIfPresent(String.self, forKey: .broker) ?? ""
        country = try c.decodeIfPresent(String.self, forKey: .country) ?? ""
        link = try c.decodeIfPresent(String.self, forKey: .link) ?? ""
        units = try c.decodeIfPresent(Double.self, forKey: .units) ?? 0
        amountInvested = try c.decodeIfPresent(Double.self, forKey: .amountInvested) ?? 0
        currentValue = try c.decodeIfPresent(Double.self, forKey: .currentValue) ?? 0
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? "AUD"
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
        isEmergencyFund = try c.decodeIfPresent(Bool.self, forKey: .isEmergencyFund)
        isCash = try c.decodeIfPresent(Bool.self, forKey: .isCash)
    }
}

struct PortfolioTransaction: Identifiable, Codable, Equatable {
    var id: String
    var holdingId: String
    var holdingName: String
    var type: String // "buy" | "sell"
    var units: Double
    var pricePerUnit: Double
    var totalAmount: Double
    var currency: String
    var date: String
    var notes: String
    var createdAt: Double

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        holdingId = try c.decodeIfPresent(String.self, forKey: .holdingId) ?? ""
        holdingName = try c.decodeIfPresent(String.self, forKey: .holdingName) ?? ""
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "buy"
        units = try c.decodeIfPresent(Double.self, forKey: .units) ?? 0
        pricePerUnit = try c.decodeIfPresent(Double.self, forKey: .pricePerUnit) ?? 0
        totalAmount = try c.decodeIfPresent(Double.self, forKey: .totalAmount) ?? 0
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? "AUD"
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
    }

    init(
        id: String = UUID().uuidString, holdingId: String, holdingName: String,
        type: String, units: Double, pricePerUnit: Double, totalAmount: Double,
        currency: String, date: String, notes: String = "",
        createdAt: Double = Date().timeIntervalSince1970 * 1000
    ) {
        self.id = id; self.holdingId = holdingId; self.holdingName = holdingName
        self.type = type; self.units = units; self.pricePerUnit = pricePerUnit
        self.totalAmount = totalAmount; self.currency = currency; self.date = date
        self.notes = notes; self.createdAt = createdAt
    }
}

struct DebtRecord: Identifiable, Codable, Equatable {
    var id: String
    var person: String
    var direction: String // "i_owe" | "owed_to_me"
    var reason: String
    var originalAmount: Double
    var currency: String
    var notes: String
    var images: [String]
    var createdAt: Double

    init(
        id: String = UUID().uuidString, person: String, direction: String,
        reason: String = "", originalAmount: Double, currency: String,
        notes: String = "", images: [String] = [],
        createdAt: Double = Date().timeIntervalSince1970 * 1000
    ) {
        self.id = id; self.person = person; self.direction = direction
        self.reason = reason; self.originalAmount = originalAmount
        self.currency = currency; self.notes = notes; self.images = images
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        person = try c.decodeIfPresent(String.self, forKey: .person) ?? ""
        direction = try c.decodeIfPresent(String.self, forKey: .direction) ?? "i_owe"
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        originalAmount = try c.decodeIfPresent(Double.self, forKey: .originalAmount) ?? 0
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? "AUD"
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        images = try c.decodeIfPresent([String].self, forKey: .images) ?? []
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
    }
}

struct DebtTransaction: Identifiable, Codable, Equatable {
    var id: String
    var debtId: String
    var amount: Double // positive = repayment, negative = borrowed more
    var date: String
    var notes: String
    var images: [String]
    var createdAt: Double

    init(
        id: String = UUID().uuidString, debtId: String, amount: Double,
        date: String, notes: String = "", images: [String] = [],
        createdAt: Double = Date().timeIntervalSince1970 * 1000
    ) {
        self.id = id; self.debtId = debtId; self.amount = amount
        self.date = date; self.notes = notes; self.images = images
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        debtId = try c.decodeIfPresent(String.self, forKey: .debtId) ?? ""
        amount = try c.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        images = try c.decodeIfPresent([String].self, forKey: .images) ?? []
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
    }
}

struct CustomCategory: Identifiable, Codable, Equatable {
    var id: String
    var label: String
    var color: String
}

struct CryptoPricesBlob: Codable {
    var prices: [String: Double]
}

struct NetworthGoal: Identifiable, Codable, Equatable {
    var id: String
    var name: String
    var amount: Double
    var currency: String
    var setAt: Double
    var achievedAt: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        amount = try c.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? "AUD"
        setAt = try c.decodeIfPresent(Double.self, forKey: .setAt) ?? 0
        achievedAt = try c.decodeIfPresent(Double.self, forKey: .achievedAt)
    }
}

/// Recurring income/expense template — enough of it to project the next
/// occurrence for the "Upcoming" card. Generation stays server-side (cron).
struct RecurringTemplate: Identifiable, Codable, Equatable {
    var id: String
    var description: String
    var amount: Double
    var currency: String
    var frequency: String // weekly | fortnightly | monthly | yearly
    var startDate: String
    var endDate: String?
    var active: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        amount = try c.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? "AUD"
        frequency = try c.decodeIfPresent(String.self, forKey: .frequency) ?? "monthly"
        startDate = try c.decodeIfPresent(String.self, forKey: .startDate) ?? ""
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? true
    }

    /// First occurrence on/after `today`, stepping from startDate. Nil when
    /// inactive, expired, or the date string is unparseable.
    func nextOccurrence(onOrAfter today: String) -> String? {
        guard active, startDate.count >= 10 else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = SydneyTime.zone
        formatter.dateFormat = "yyyy-MM-dd"
        guard let start = formatter.date(from: String(startDate.prefix(10))),
              let target = formatter.date(from: today) else { return nil }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = SydneyTime.zone
        var cursor = start
        // Bounded walk — a weekly template from years back is still < 1e4 steps.
        for _ in 0..<10_000 {
            if cursor >= target {
                let day = formatter.string(from: cursor)
                if let end = endDate, !end.isEmpty, day > end { return nil }
                return day
            }
            let next: Date?
            switch frequency {
            case "weekly": next = calendar.date(byAdding: .day, value: 7, to: cursor)
            case "fortnightly": next = calendar.date(byAdding: .day, value: 14, to: cursor)
            case "yearly": next = calendar.date(byAdding: .year, value: 1, to: cursor)
            default: next = calendar.date(byAdding: .month, value: 1, to: cursor)
            }
            guard let advanced = next else { return nil }
            cursor = advanced
        }
        return nil
    }
}

struct SnapshotPoint: Identifiable, Codable, Equatable {
    var date: String
    var value: Double
    /// Portfolio snapshots only: `value` is EX-super, this includes super —
    /// same split the web's dailySnapshotValues reads.
    var valueWithSuper: Double?
    var id: String { date }
}

// MARK: - Category labels/colors (mirrors constants.ts exactly)

enum Categories {
    static let incomeLabels: [(id: String, label: String)] = [
        ("salary", "Salary"), ("super_employer", "Super (Employer)"),
        ("super_personal", "Super (Personal)"), ("arena_bot", "Arena Bot"),
        ("arb_bot", "Arb Bot"), ("uber", "Uber"), ("freelance", "Freelance"),
        ("dividend", "Dividend"), ("crypto_yield", "Crypto Yield"),
        ("interest", "Interest"), ("rental", "Rental"), ("bonus", "Bonus"),
        ("realized_stocks", "Realized · Stocks"),
        ("realized_crypto", "Realized · Crypto"), ("other", "Other"),
    ]

    static let expenseLabels: [(id: String, label: String)] = [
        ("food", "Food"), ("transport", "Transport"), ("rent", "Rent"),
        ("utilities", "Utilities"), ("entertainment", "Entertainment"),
        ("shopping", "Shopping"), ("health", "Health"), ("insurance", "Insurance"),
        ("subscriptions", "Subscriptions"), ("education", "Education"),
        ("travel", "Travel"), ("gifts", "Gifts"), ("other", "Other"),
    ]

    static let incomeColorIndex: [String: Int] = [
        "salary": 0, "super_employer": 1, "super_personal": 2, "arena_bot": 3,
        "arb_bot": 4, "uber": 5, "freelance": 6, "dividend": 7,
        "crypto_yield": 8, "interest": 9, "rental": 10, "bonus": 11,
        "realized_stocks": 13, "realized_crypto": 14, "other": 12,
    ]

    static let expenseColorIndex: [String: Int] = [
        "food": 0, "transport": 1, "rent": 2, "utilities": 3, "entertainment": 4,
        "shopping": 5, "health": 6, "insurance": 7, "subscriptions": 8,
        "education": 9, "travel": 10, "gifts": 11, "other": 12,
    ]

    /// Derived categories can't be hand-picked — they're projected from logs.
    static let derivedIncomeTypes: Set<String> = ["realized_stocks", "realized_crypto"]

    static let paymentMethods: [(id: String, label: String)] = [
        ("cash", "Cash"), ("debit_card", "Debit"), ("credit_card", "Credit"),
        ("bank_transfer", "Transfer"), ("other", "Other"),
    ]
}
