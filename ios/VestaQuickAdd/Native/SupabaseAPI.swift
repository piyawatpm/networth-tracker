import Foundation
import Security

// Direct Supabase REST + GoTrue client. Deliberately dependency-free: the
// three endpoints this app needs (password grant, token refresh, app_data
// reads/writes) don't justify an SDK, and no SPM packages keeps the
// hand-authored project file trivial.
//
// The publishable key is public by design — it ships in the web bundle today.
// Access control comes from the user JWT once RLS is applied; this client
// already authenticates every data request, so the native app keeps working
// the day the anon door closes.

enum SupabaseConfig {
    static let url = URL(string: "https://aqxxshuiyyqbnpscoqxz.supabase.co")!
    static let publishableKey = "sb_publishable_HlxRYJjza0p7nSoS2F7DKg_m7p76xdO"

    // NO ACCOUNT CREDENTIALS IN SOURCE — this repo is public. Sign in once
    // on the app's sign-in screen; the session persists in the Keychain and
    // silently refreshes from then on. For a personal build you may fill
    // these two locally to restore the silent first sign-in, but NEVER
    // commit real values (the last committed password had to be rotated).
    static let ownerEmail = ""
    static let ownerPassword = ""

    /// True only for a personal build that filled the credentials above.
    static var hasOwnerCredentials: Bool {
        !ownerEmail.isEmpty && !ownerPassword.isEmpty
    }
}

struct AuthSession: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Double // unix seconds

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
    }
}

enum SupabaseError: LocalizedError {
    case badCredentials(String)
    case notSignedIn
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .badCredentials(let message): return message
        case .notSignedIn: return "Signed out."
        case .http(let code, let message): return "Server error \(code): \(message)"
        }
    }
}

actor SupabaseAPI {
    static let shared = SupabaseAPI()

    private var session: AuthSession?

    // MARK: - Keychain persistence

    private let keychainService = "com.piyawatpm.vesta.session"
    private let keychainAccount = "supabase"

    private func keychainQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
    }

    private func persistSession() {
        var query = keychainQuery()
        SecItemDelete(query as CFDictionary)
        guard let session, let data = try? JSONEncoder().encode(session) else { return }
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(query as CFDictionary, nil)
    }

    func restoreSession() -> Bool {
        var query = keychainQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let stored = try? JSONDecoder().decode(AuthSession.self, from: data)
        else { return false }
        session = stored
        return true
    }

    func signOut() {
        session = nil
        SecItemDelete(keychainQuery() as CFDictionary)
    }

    // MARK: - Auth

    func signIn(email: String, password: String) async throws {
        var request = URLRequest(
            url: SupabaseConfig.url.appendingPathComponent("auth/v1/token"),
            timeoutInterval: 15
        )
        request.url = request.url?.appending(queryItems: [
            URLQueryItem(name: "grant_type", value: "password"),
        ])
        request.httpMethod = "POST"
        request.setValue(SupabaseConfig.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "email": email, "password": password,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SupabaseError.http(0, "no response")
        }
        guard (200...299).contains(http.statusCode) else {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
            let message =
                (detail?["error_description"] as? String)
                ?? (detail?["msg"] as? String)
                ?? "Sign-in failed (\(http.statusCode))."
            throw SupabaseError.badCredentials(message)
        }
        session = try JSONDecoder().decode(AuthSession.self, from: data)
        persistSession()
    }

    private func refreshIfNeeded() async throws {
        guard let current = session else { throw SupabaseError.notSignedIn }
        // 60s of slack so a token that expires mid-request gets renewed first.
        guard current.expiresAt - Date().timeIntervalSince1970 < 60 else { return }

        var request = URLRequest(
            url: SupabaseConfig.url.appendingPathComponent("auth/v1/token"),
            timeoutInterval: 15
        )
        request.url = request.url?.appending(queryItems: [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
        ])
        request.httpMethod = "POST"
        request.setValue(SupabaseConfig.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "refresh_token": current.refreshToken,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode) else {
            // Refresh token burned (revoked / already used) — force re-login
            // rather than looping on a dead session.
            signOut()
            throw SupabaseError.notSignedIn
        }
        session = try JSONDecoder().decode(AuthSession.self, from: data)
        persistSession()
    }

    // MARK: - REST

    private func restRequest(
        _ method: String, path: String, query: [URLQueryItem], body: Data? = nil
    ) async throws -> Data {
        try await refreshIfNeeded()
        guard let session else { throw SupabaseError.notSignedIn }

        // PostgRESTURL percent-encodes "+", which would otherwise reach
        // PostgREST as a space (a timestamp filter then fails with 22007).
        let url = PostgRESTURL.make(base: SupabaseConfig.url, path: "rest/v1/\(path)", query: query)
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpMethod = method
        request.setValue(SupabaseConfig.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SupabaseError.http(0, "no response")
        }
        guard (200...299).contains(http.statusCode) else {
            throw SupabaseError.http(
                http.statusCode, String(data: data, encoding: .utf8) ?? ""
            )
        }
        return data
    }

    /// One blob without pulling the whole table — for the intent process,
    /// which needs exactly one key and runs on a button press.
    func fetchAppDataValue(key: String) async throws -> String? {
        let data = try await restRequest(
            "GET", path: "app_data",
            query: [
                URLQueryItem(name: "key", value: "eq.\(key)"),
                URLQueryItem(name: "select", value: "value"),
            ]
        )
        struct Row: Codable { let value: String? }
        return try JSONDecoder().decode([Row].self, from: data).first?.value ?? nil
    }

    /// Ensure a usable session: restored from Keychain, else the OPTIONAL
    /// baked owner sign-in (personal builds only — see SupabaseConfig). The
    /// Action Button path calls this without the UI running.
    func ensureSession() async throws {
        if restoreSession() { return }
        guard SupabaseConfig.hasOwnerCredentials else {
            throw SupabaseError.notSignedIn
        }
        try await signIn(
            email: SupabaseConfig.ownerEmail,
            password: SupabaseConfig.ownerPassword
        )
    }

    /// Append one quick-add expense straight to the blob — the token-free
    /// replacement for the /api/quick-expense endpoint. Same idempotency
    /// contract: a replayed clientId is acknowledged, never double-added.
    ///
    /// Goes through the compare-and-swap list write, so it can only ADD this
    /// entry to the latest server list. A failed read or a blob that isn't a
    /// JSON array THROWS (the PendingQueue keeps the item and retries later);
    /// it never starts over from an empty list, which is how one undecodable
    /// entry could once make an Apple Pay tap overwrite every expense.
    func appendExpense(_ pending: PendingExpense) async throws {
        try await ensureSession()

        let entry = ExpenseEntry(
            type: pending.type,
            description: pending.note,
            amount: (pending.amount * 100).rounded() / 100,
            currency: pending.currency,
            vendor: pending.vendor,
            date: pending.dateString,
            paymentMethod: "other",
            clientId: pending.clientId,
            source: "ios"
        )
        let upsert = try ListUpsert(record: entry)
        let clientId = pending.clientId
        _ = try await mutateList(key: "expense_entries") { fresh in
            // Checked against the fresh list on every attempt, so a retry
            // racing an earlier upload of the same tap backs off instead.
            ListChange.appending(upsert, unlessAny: "clientId", equals: clientId, in: fresh)
        }
    }

    // MARK: - List blobs (compare-and-swap)

    /// Apply one change to the LATEST server copy of a list blob — see
    /// ListChange.swift for the protocol. `change` is rebuilt from the fresh
    /// server list on every attempt (nil = nothing to do). Throws, writing
    /// nothing, when the row can't be read or isn't a JSON array; returns the
    /// merged list as it now stands on the server.
    func mutateList(
        key: String,
        change: @Sendable ([JSONValue]) throws -> ListChange?
    ) async throws -> ListCommit {
        try await ListSync.commit(
            key: key,
            fetch: { try await self.fetchListRow(key: key) },
            patch: { value, expected, stamp in
                try await self.patchListRow(key: key, value: value, expected: expected, stamp: stamp)
            },
            insert: { value, stamp in
                try await self.insertListRow(key: key, value: value, stamp: stamp)
            },
            change: change
        )
    }

    /// The row as it stands right now, or nil when the key doesn't exist yet.
    /// Unlike fetchAppDataValue this keeps "no row" (may start from []) apart
    /// from "row whose value is null" (refused), and carries updated_at.
    private func fetchListRow(key: String) async throws -> ListRow? {
        let data = try await restRequest(
            "GET", path: "app_data",
            query: [
                URLQueryItem(name: "key", value: "eq.\(key)"),
                URLQueryItem(name: "select", value: "value,updated_at"),
            ]
        )
        struct Row: Decodable {
            let value: String?
            let updatedAt: String?
            enum CodingKeys: String, CodingKey {
                case value
                case updatedAt = "updated_at"
            }
        }
        guard let row = try JSONDecoder().decode([Row].self, from: data).first else { return nil }
        return ListRow(value: row.value, updatedAt: row.updatedAt)
    }

    /// Write only if updated_at still equals the value we read. False = zero
    /// rows matched: another writer got in between.
    private func patchListRow(
        key: String, value: String, expected: String?, stamp: String
    ) async throws -> Bool {
        let body = try JSONSerialization.data(
            withJSONObject: ["value": value, "updated_at": stamp],
            options: [.withoutEscapingSlashes]
        )
        let returned = try await restRequest(
            "PATCH", path: "app_data",
            query: [
                URLQueryItem(name: "key", value: "eq.\(key)"),
                URLQueryItem(name: "updated_at", value: ListSync.casFilter(expected: expected)),
                // Echo just enough to count rows, not the whole blob back.
                URLQueryItem(name: "select", value: "key,updated_at"),
            ],
            body: body
        )
        return try Self.rowCount(returned) > 0
    }

    /// Create the row. False = it already exists (409): someone created it
    /// after our read, so the caller re-reads and merges into theirs.
    private func insertListRow(key: String, value: String, stamp: String) async throws -> Bool {
        let body = try JSONSerialization.data(
            withJSONObject: ["key": key, "value": value, "updated_at": stamp],
            options: [.withoutEscapingSlashes]
        )
        do {
            let returned = try await restRequest(
                "POST", path: "app_data",
                query: [URLQueryItem(name: "select", value: "key,updated_at")],
                body: body
            )
            return try Self.rowCount(returned) > 0
        } catch SupabaseError.http(409, _) {
            return false
        }
    }

    /// Rows in a return=representation response. Anything but an array is an
    /// ambiguous answer, so it throws rather than guessing either way.
    private static func rowCount(_ data: Data) throws -> Int {
        guard let rows = try JSONSerialization.jsonObject(with: data) as? [Any] else {
            throw SupabaseError.http(0, "unexpected write response")
        }
        return rows.count
    }

    /// KV blobs — ALL of them when `since` is nil, otherwise the rows whose
    /// updated_at is past the watermark MINUS a look-back margin: every writer
    /// stamps updated_at with its own clock, so a write to one key can carry a
    /// stamp slightly before the watermark another key set, and a strict
    /// `> watermark` would miss it until that key changed again. The margin
    /// re-sends some unchanged rows; callers skip values equal to what they
    /// already hold (AppDataSync.rowsToApply). The delta path still keeps a
    /// quiet app-open to a few KB instead of re-downloading the CSV blobs.
    /// Returns every row with its updated_at, and the newest updated_at seen
    /// to thread into the next call.
    func fetchAppData(since: String? = nil) async throws
        -> (rows: [String: AppDataRow], maxUpdatedAt: String?) {
        // A "+00:00" offset in a query string decodes to a SPACE server-side
        // ("…24.604 00:00" → Postgres 22007), so the watermark is stored in
        // the Z form; one that still carries a "+" is dropped (full fetch).
        func urlSafe(_ stamp: String) -> String? {
            let z = stamp.replacingOccurrences(of: "+00:00", with: "Z")
            return z.contains("+") ? nil : z
        }
        var query = [URLQueryItem(name: "select", value: "key,value,updated_at")]
        if let floor = AppDataSync.deltaFloor(watermark: since) {
            query.append(URLQueryItem(name: "updated_at", value: "gt.\(floor)"))
        }
        let data = try await restRequest("GET", path: "app_data", query: query)
        struct Row: Codable {
            let key: String
            let value: String?
            let updatedAt: String?
            enum CodingKeys: String, CodingKey {
                case key, value
                case updatedAt = "updated_at"
            }
        }
        let rows = try JSONDecoder().decode([Row].self, from: data)
        var result: [String: AppDataRow] = [:]
        var maxStamp: String? = since
        for row in rows {
            result[row.key] = AppDataRow(value: row.value ?? "", updatedAt: row.updatedAt)
            if let stamp = row.updatedAt, stamp > (maxStamp ?? "") { maxStamp = stamp }
        }
        // Store the watermark pre-normalized so the cache never holds a "+".
        return (result, maxStamp.flatMap(urlSafe))
    }

    /// Whole-value, last-write-wins write — ONLY for settings-like blobs
    /// (currency, cash tags, forecast levers, earn exclusions). List blobs —
    /// entries, holdings, debts, goals, portfolio_groups — go through
    /// `mutateList`: overwriting a list erases other devices' entries.
    func writeAppData(key: String, value: String) async throws {
        let iso = ISO8601DateFormatter().string(from: Date())
        let body = try JSONSerialization.data(withJSONObject: [
            "value": value, "updated_at": iso,
        ])
        let returned = try await restRequest(
            "PATCH", path: "app_data",
            query: [URLQueryItem(name: "key", value: "eq.\(key)")],
            body: body
        )
        // Zero rows patched = the key doesn't exist yet — insert it.
        if (try? JSONDecoder().decode([[String: String?]].self, from: returned))?.isEmpty ?? false {
            let insert = try JSONSerialization.data(withJSONObject: [
                "key": key, "value": value, "updated_at": iso,
            ])
            _ = try await restRequest("POST", path: "app_data", query: [], body: insert)
        }
    }

    /// Raw snapshot rows, intraday granularity, ascending (values are USD).
    ///
    /// The cron writes a snapshot every few MINUTES — ~170 rows/day — so a
    /// flat `limit` covers almost no calendar time (400 rows ≈ 2 days, which
    /// is exactly the bug that made the dashboard chart look nothing like the
    /// web's). Pages newest-first until the history is exhausted or `since`
    /// is passed, so an incremental refresh usually costs one page.
    func fetchSnapshotsRaw(
        type: String, since: String?, maxPages: Int = 30
    ) async throws -> [SnapshotPoint] {
        struct Row: Codable {
            let date: String
            let value: Double
            let valueWithSuper: Double?
            let valueNoSuper: Double?
            let portfolio: Double?
            let crypto: Double?
            enum CodingKeys: String, CodingKey {
                case date, value, portfolio, crypto
                case valueWithSuper = "value_with_super"
                case valueNoSuper = "value_no_super"
            }
        }
        var all: [SnapshotPoint] = []
        for page in 0..<maxPages {
            let data = try await restRequest(
                "GET", path: "snapshots",
                query: [
                    URLQueryItem(name: "type", value: "eq.\(type)"),
                    URLQueryItem(
                        name: "select",
                        value: "date,value,value_with_super,value_no_super,portfolio,crypto"
                    ),
                    URLQueryItem(name: "order", value: "date.desc"),
                    URLQueryItem(name: "limit", value: "1000"),
                    URLQueryItem(name: "offset", value: String(page * 1000)),
                ]
            )
            let rows = try JSONDecoder().decode([Row].self, from: data)
            all.append(contentsOf: rows.map {
                SnapshotPoint(
                    date: $0.date, value: $0.value,
                    valueWithSuper: $0.valueWithSuper, valueNoSuper: $0.valueNoSuper,
                    portfolio: $0.portfolio, crypto: $0.crypto
                )
            })
            if rows.count < 1000 { break }
            if let since, let oldest = rows.last?.date, oldest <= since { break }
        }
        if let since { all.removeAll { $0.date <= since } }
        return all.sorted { $0.date < $1.date }
    }

    /// Daily closes — one point per day, last reading of the day wins.
    func fetchSnapshots(type: String) async throws -> [SnapshotPoint] {
        let raw = try await fetchSnapshotsRaw(type: type, since: nil)
        var byDay: [String: Double] = [:]
        for row in raw { byDay[String(row.date.prefix(10))] = row.value }
        return byDay.map { SnapshotPoint(date: $0.key, value: $0.value) }
            .sorted { $0.date < $1.date }
    }

    /// FX rates, same source as the web (open.er-api.com, USD-based).
    func fetchFxRates() async throws -> [String: Double] {
        let (data, _) = try await URLSession.shared.data(
            from: URL(string: "https://open.er-api.com/v6/latest/USD")!
        )
        struct Response: Codable { let rates: [String: Double] }
        return try JSONDecoder().decode(Response.self, from: data).rates
    }

    /// Live spot prices from Binance's public bulk ticker, token → USD.
    ///
    /// The `crypto_prices` blob is only as fresh as the last web session, and
    /// it turned out to be missing every major token — which valued BTC/ETH/SOL
    /// at zero and knocked ~฿750k off net worth. Live quotes fix that without
    /// waiting for the web app to be opened. Unknown symbols just miss; the
    /// holdings CSV's stored value covers them.
    func fetchBinancePrices(
        tokens: [String], mappings: [String: String]
    ) async -> [String: Double] {
        guard !tokens.isEmpty else { return [:] }
        var symbolToToken: [String: String] = [:]
        for token in tokens {
            // Mappings resolve display names to BASE symbols ("Hyperliquid" →
            // "HYPE"); the USDT pair suffix is added here, never by the blob.
            let base = (mappings[token] ?? token)
                .uppercased()
                .replacingOccurrences(of: " ", with: "")
            if (2...12).contains(base.count),
               base.allSatisfy({ $0.isLetter || $0.isNumber }) {
                symbolToToken["\(base)USDT"] = token
            }
        }
        guard !symbolToToken.isEmpty else { return [:] }

        let list = symbolToToken.keys.sorted().map { "%22\($0)%22" }.joined(separator: ",")
        guard let url = URL(
            string: "https://api.binance.com/api/v3/ticker/price?symbols=%5B\(list)%5D"
        ) else { return [:] }

        // Binance 400s the WHOLE request if ANY symbol is unknown, so fall
        // back to fetching everything and filtering — one extra round trip,
        // but immune to a bad ticker mapping poisoning the batch.
        struct Ticker: Codable { let symbol: String; let price: String }
        var tickers: [Ticker] = []
        if let (data, response) = try? await URLSession.shared.data(from: url),
           (response as? HTTPURLResponse)?.statusCode == 200,
           let decoded = try? JSONDecoder().decode([Ticker].self, from: data) {
            tickers = decoded
        } else if let all = URL(string: "https://api.binance.com/api/v3/ticker/price"),
                  let (data, response) = try? await URLSession.shared.data(from: all),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let decoded = try? JSONDecoder().decode([Ticker].self, from: data) {
            tickers = decoded.filter { symbolToToken[$0.symbol] != nil }
        }

        var result: [String: Double] = [:]
        for ticker in tickers {
            if let token = symbolToToken[ticker.symbol], let price = Double(ticker.price) {
                result[token] = price
            }
        }
        return result
    }
}
