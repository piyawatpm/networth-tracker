import Foundation

// Safe writes for the LIST blobs in app_data (income_entries, expense_entries,
// portfolio_*, debt_*, networth_goals, recurring_*_templates).
//
// Every client used to serialize its in-memory list and overwrite the row, so
// a device holding an old copy silently erased what another device had added
// (four income entries were lost that way). The protocol here — shared with
// the web and Android clients — is:
//
//   1. read the row's latest value + updated_at;
//   2. throw, writing nothing, if that read fails or isn't a JSON array (only
//      a MISSING row may start from []);
//   3. apply only THIS change (upserts by id + deletes by id) to the raw
//      server JSON — never re-encode other devices' entries through Swift
//      models, which would strip fields the models don't know;
//   4. PATCH conditionally on the updated_at we read (compare-and-swap);
//   5. zero rows patched → someone wrote in between → re-read and retry.
//
// Foundation-only and model-agnostic on purpose: the harness compiles this
// file alone.

// MARK: - Raw JSON

/// A lossless JSON tree, so entries can be edited without a Swift model.
///
/// Why not JSONSerialization's `[String: Any]`: it writes doubles with 17
/// significant digits (12.3 → 12.300000000000001), which would rewrite every
/// amount in the blob on each write. JSONEncoder writes the shortest form,
/// exactly like the web's JSON.stringify, so entries this device didn't touch
/// come back with identical values and number text (keys sorted).
enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        // Order matters: `true` must not become 1, and 3 must not become 3.0.
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int64.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    /// Any Encodable value as a JSON tree (a model → its stored object).
    init<T: Encodable>(encoding value: T) throws {
        self = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }

    /// A number the way the encoder would write it back: integral values
    /// become `.int`, so a computed 15.0 compares equal to a stored 15.
    static func number(_ value: Double) -> JSONValue {
        if value.rounded() == value, abs(value) < 9_007_199_254_740_992 {
            return .int(Int64(value))
        }
        return .double(value)
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let fields) = self { return fields[key] }
        return nil
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    /// Decode this subtree as a model (for reading one server entry).
    func decode<T: Decodable>(_ type: T.Type) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }
}

// MARK: - Errors

enum ListBlobError: LocalizedError, Equatable {
    /// The stored value is valid JSON but not an array (object, string, null…).
    case notAnArray(key: String)
    /// The stored value isn't JSON at all (or is empty).
    case unparseable(key: String)
    /// Every compare-and-swap round lost to another writer.
    case conflict(key: String, attempts: Int)
    /// A record couldn't be turned into (or read from) a JSON object.
    case badRecord(String)
    /// A settings blob holds a value this app can't decode — overwriting it
    /// with our default would destroy it, so the write is refused.
    case unreadableSetting(key: String)

    var errorDescription: String? {
        switch self {
        case .notAnArray(let key):
            return "Not saved: the server copy of \(key) isn't a list, so it wasn't touched."
        case .unparseable(let key):
            return "Not saved: the server copy of \(key) couldn't be read, so it wasn't touched."
        case .conflict(let key, let attempts):
            return "Not saved: \(key) kept changing on another device (\(attempts) tries). Try again."
        case .badRecord(let detail):
            return "Not saved: \(detail)"
        case .unreadableSetting(let key):
            return "Not saved: the stored \(key) couldn't be read by this app, so it wasn't overwritten."
        }
    }
}

// MARK: - Blob <-> list

enum ListBlob {
    /// Parse a stored list blob. Throws — never returns [] — for anything that
    /// isn't a JSON array: an empty fallback here is exactly how a single bad
    /// read used to wipe a whole list.
    static func parse(_ data: Data, key: String = "list") throws -> [JSONValue] {
        do {
            return try JSONDecoder().decode([JSONValue].self, from: data)
        } catch DecodingError.typeMismatch, DecodingError.valueNotFound {
            throw ListBlobError.notAnArray(key: key) // valid JSON, wrong shape
        } catch {
            throw ListBlobError.unparseable(key: key)
        }
    }

    /// Sorted keys → deterministic bytes (idempotent writes); unescaped
    /// slashes → base64 data URLs aren't bloated with "\/".
    static func serialize(_ list: [JSONValue]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(list)
    }

    static func text(_ list: [JSONValue]) throws -> String {
        String(decoding: try serialize(list), as: UTF8.self)
    }

    /// Decode each entry on its own, skipping any a model can't read — one
    /// odd entry mustn't hide the rest from the math that needs them.
    static func decodeEach<T: Decodable>(_ type: T.Type, from list: [JSONValue]) -> [T] {
        list.compactMap { try? $0.decode(T.self) }
    }
}

// MARK: - The change

/// A model stored in a list blob. `storageKeys` is every key the model reads
/// and writes (its CodingKeys) — the keys an upsert is authoritative for.
protocol ListRecord: Encodable {
    var id: String { get }
    static var storageKeys: Set<String> { get }
}

/// One entry to write, matched by its string "id".
struct ListUpsert: Equatable, Sendable {
    let id: String
    /// The entry's JSON; always carries "id".
    let fields: [String: JSONValue]
    /// Keys this writer owns. On an existing entry each owned key takes its
    /// value from `fields`, or is REMOVED when `fields` lacks it — that's how
    /// a cleared optional sticks. Keys outside this set (fields another
    /// client added that the model doesn't know) survive untouched.
    let ownedKeys: Set<String>
    /// False for patches: an id that's gone from the server is skipped, never
    /// resurrected as a partial object.
    let insertIfMissing: Bool

    init(id: String, fields: [String: JSONValue], ownedKeys: Set<String>, insertIfMissing: Bool = true) {
        var fields = fields
        fields["id"] = .string(id)
        self.id = id
        self.fields = fields
        self.ownedKeys = ownedKeys.union(["id"])
        self.insertIfMissing = insertIfMissing
    }

    /// A whole record: the model's JSON, owning all of its storage keys.
    init<T: ListRecord>(record: T) throws {
        guard case .object(let fields) = try JSONValue(encoding: record) else {
            throw ListBlobError.badRecord("\(T.self) did not encode to a JSON object")
        }
        self.init(id: record.id, fields: fields, ownedKeys: T.storageKeys)
    }

    /// Change only `fields` on an entry that already exists on the server.
    static func patch(id: String, _ fields: [String: JSONValue]) -> ListUpsert {
        ListUpsert(id: id, fields: fields, ownedKeys: Set(fields.keys), insertIfMissing: false)
    }
}

/// Upserts (by id) and deletes (by id) — never a whole list.
struct ListChange: Equatable, Sendable {
    var upserts: [ListUpsert]
    var deletes: Set<String>

    init(upserts: [ListUpsert] = [], deletes: Set<String> = []) {
        self.upserts = upserts
        self.deletes = deletes
    }

    var isEmpty: Bool { upserts.isEmpty && deletes.isEmpty }

    /// Apply to a parsed list. Deletes remove EVERY object with a listed id,
    /// and win over an upsert of the same id (as in the web's applyChange);
    /// each other upsert replaces the FIRST object with its id in place
    /// (keeping keys it doesn't own) or appends. Everything else — including
    /// non-object elements — is left exactly where it was. `changed` is false
    /// when the result equals the input (nothing to write).
    func apply(to list: [JSONValue]) -> (list: [JSONValue], changed: Bool) {
        var result = list
        var changed = false

        if !deletes.isEmpty {
            let before = result.count
            result.removeAll { element in
                element["id"]?.stringValue.map { deletes.contains($0) } ?? false
            }
            changed = result.count != before
        }

        for upsert in upserts where !deletes.contains(upsert.id) {
            if let index = result.firstIndex(where: { $0["id"]?.stringValue == upsert.id }),
               case .object(let existing) = result[index] {
                var merged = existing
                for key in upsert.ownedKeys where upsert.fields[key] == nil {
                    merged.removeValue(forKey: key)
                }
                for (key, value) in upsert.fields {
                    merged[key] = value
                }
                if merged != existing {
                    result[index] = .object(merged)
                    changed = true
                }
            } else if upsert.insertIfMissing {
                result.append(.object(upsert.fields))
                changed = true
            }
        }
        return (result, changed)
    }

    /// Bytes → bytes. `nil` means the row doesn't exist yet — the ONLY input
    /// that starts from []. Anything that isn't a JSON array throws.
    func apply(to data: Data?, key: String = "list") throws -> Data {
        let list = try data.map { try ListBlob.parse($0, key: key) } ?? []
        return try ListBlob.serialize(apply(to: list).list)
    }

    /// Append `upsert` unless an entry already has `field == value` — the
    /// quick-add replay guard (clientId). Nil = already there, nothing to do.
    static func appending(
        _ upsert: ListUpsert, unlessAny field: String, equals value: String, in list: [JSONValue]
    ) -> ListChange? {
        if list.contains(where: { $0[field]?.stringValue == value }) { return nil }
        return ListChange(upserts: [upsert])
    }

    /// Delete every entry whose `field == value` (a debt's ledger rows), read
    /// from the FRESH server list so rows another device just added go too.
    static func deleting(where field: String, equals value: String, in list: [JSONValue]) -> ListChange? {
        let ids = list.compactMap { element -> String? in
            element[field]?.stringValue == value ? element["id"]?.stringValue : nil
        }
        return ids.isEmpty ? nil : ListChange(deletes: Set(ids))
    }
}

// MARK: - Compare-and-swap loop

/// One app_data row as read for a write. `value` is the TEXT column.
struct ListRow: Equatable, Sendable {
    var value: String?
    var updatedAt: String?
}

struct ListCommit: Equatable, Sendable {
    /// The list as it now stands on the server — adopt this, not local state.
    let value: String
    /// The server text the change was applied to (the winning read; "[]" for
    /// a new row). Equal to `value` when nothing was written.
    let previous: String
    /// False when the change was a no-op against the latest copy.
    let wrote: Bool
    let attempts: Int
    let updatedAt: String?
}

enum ListSync {
    static let maxAttempts = 5

    /// Read → apply `change` to the FRESH list → conditional write, retrying
    /// on a lost race. The transport is injected so the decision logic runs
    /// in the harness against a fake server.
    ///
    /// - fetch: the row, or nil when the key doesn't exist. Throwing aborts
    ///   the whole write — nothing is written on a failed read.
    /// - patch: write iff updated_at still equals `expected`; false = 0 rows.
    /// - insert: create the row; false = it already exists (409).
    /// - change: builds this write from the latest list (it runs again on
    ///   every attempt); nil or a no-op means there's nothing to write.
    static func commit(
        key: String,
        maxAttempts: Int = ListSync.maxAttempts,
        fetch: () async throws -> ListRow?,
        patch: (_ value: String, _ expected: String?, _ stamp: String) async throws -> Bool,
        insert: (_ value: String, _ stamp: String) async throws -> Bool,
        sleep: (_ attempt: Int) async throws -> Void = ListSync.backoff,
        now: () -> Date = { Date() },
        change: ([JSONValue]) throws -> ListChange?
    ) async throws -> ListCommit {
        let attempts = max(1, maxAttempts)
        for attempt in 1...attempts {
            try Task.checkCancellation()
            let row = try await fetch()

            let current: [JSONValue]
            if let row {
                guard let text = row.value else { throw ListBlobError.notAnArray(key: key) }
                current = try ListBlob.parse(Data(text.utf8), key: key)
            } else {
                current = [] // no row yet — the one case that may start empty
            }

            let previous = row?.value ?? "[]"
            guard let delta = try change(current), !delta.isEmpty else {
                return ListCommit(value: previous, previous: previous, wrote: false,
                                  attempts: attempt, updatedAt: row?.updatedAt)
            }
            let (merged, changed) = delta.apply(to: current)
            guard changed else {
                return ListCommit(value: previous, previous: previous, wrote: false,
                                  attempts: attempt, updatedAt: row?.updatedAt)
            }

            let text = try ListBlob.text(merged)
            let stamp = nextStamp(after: row?.updatedAt, now: now())
            let landed = row == nil
                ? try await insert(text, stamp)
                : try await patch(text, row?.updatedAt, stamp)
            if landed {
                return ListCommit(value: text, previous: previous, wrote: true,
                                  attempts: attempt, updatedAt: stamp)
            }
            if attempt < attempts { try await sleep(attempt) }
        }
        throw ListBlobError.conflict(key: key, attempts: attempts)
    }

    /// Short, growing, jittered — five rounds fit well inside the quick-add
    /// intent's 6s budget. Cancellation-aware: a deadline stops the loop.
    static func backoff(_ attempt: Int) async throws {
        let millis = 120 * attempt + Int.random(in: 0...80)
        try await Task.sleep(nanoseconds: UInt64(millis) * 1_000_000)
    }

    /// PostgREST filter for the updated_at we read. The raw string goes back
    /// verbatim — re-formatting would drop its microseconds and never match.
    /// "+00:00" becomes "Z" (same instant, URL-safe); any other "+" offset is
    /// percent-encoded by PostgRESTURL.
    static func casFilter(expected: String?) -> String {
        guard let expected else { return "is.null" }
        return "eq." + expected.replacingOccurrences(of: "+00:00", with: "Z")
    }

    /// The updated_at to write: now, in UTC with milliseconds, but always
    /// strictly after the stamp we read. Second-precision stamps would let two
    /// writes in the same second look identical to the CAS, and a device clock
    /// running behind could otherwise reuse the previous stamp.
    static func nextStamp(after previous: String?, now: Date) -> String {
        var millis = (now.timeIntervalSince1970 * 1000).rounded(.down)
        if let previous, let prior = parseStamp(previous) {
            millis = max(millis, (prior.timeIntervalSince1970 * 1000).rounded(.down) + 1)
        }
        return formatStamp(millis: millis)
    }

    /// "2026-09-23T01:02:03.123Z" for a whole number of epoch milliseconds.
    /// Whole seconds go through the formatter and the milliseconds are
    /// appended by hand: ISO8601DateFormatter ROUNDS fractional seconds, which
    /// could print a stamp other than the one computed.
    static func formatStamp(millis: Double) -> String {
        let seconds = (millis / 1000).rounded(.down)
        let fraction = Int(millis - seconds * 1000)
        let whole = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: seconds))
        return whole.dropLast() + String(format: ".%03dZ", fraction) // "…:03Z" → "…:03.123Z"
    }

    /// An updated_at in either spelling ("…+00:00" from PostgREST, "…Z" from
    /// us), to millisecond precision. Nil when it isn't ISO 8601.
    static func parseStamp(_ stamp: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: stamp) ?? ISO8601DateFormatter().date(from: stamp)
    }
}

// MARK: - Settings blobs

/// Whole-value (settings) blobs are still written last-write-wins, which is
/// only safe when this app could read what it is replacing.
enum SettingsBlob {
    /// True when the stored value is real (not missing, empty or JSON null)
    /// yet doesn't decode as `T`: writing our default over it would destroy a
    /// value this build can't read, so such writes are refused.
    static func isUnreadable<T: Decodable>(_ raw: String?, as type: T.Type) -> Bool {
        guard let raw else { return false }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "null" { return false }
        return (try? JSONDecoder().decode(T.self, from: Data(trimmed.utf8))) == nil
    }
}

// MARK: - Delta refresh

/// One app_data row from a (delta) fetch.
struct AppDataRow: Equatable, Sendable {
    let value: String
    let updatedAt: String?
}

enum AppDataSync {
    /// Every writer stamps updated_at with its OWN clock, so a write to one
    /// key can carry a stamp slightly before the watermark another key set.
    /// Delta fetches therefore look back this far past the watermark.
    static let margin: TimeInterval = 10 * 60

    /// `updated_at` floor for a delta fetch (watermark − margin), in the
    /// URL-safe "Z" form. Nil when there's no usable watermark: fetch all.
    static func deltaFloor(watermark: String?, margin: TimeInterval = AppDataSync.margin) -> String? {
        guard let watermark, let date = ListSync.parseStamp(watermark) else { return nil }
        return ListSync.formatStamp(millis: ((date.timeIntervalSince1970 - margin) * 1000).rounded(.down))
    }

    /// Strictly earlier, judged as instants (the two spellings of a stamp
    /// don't compare as strings). Unknown on either side → false.
    static func isOlder(_ stamp: String?, than other: String?) -> Bool {
        guard let stamp, let other,
              let a = ListSync.parseStamp(stamp), let b = ListSync.parseStamp(other) else { return false }
        return a < b
    }

    /// The rows of a delta fetch worth applying, key → value:
    /// - values identical to the cache are skipped (the look-back margin
    ///   brings unchanged rows back on purpose);
    /// - a row OLDER than the list this device adopted from its own write
    ///   while the fetch was in flight is skipped — it's the pre-write copy,
    ///   and applying it would make the saved entry vanish until the next
    ///   refresh. `adoptedDuringFetch` holds those writes' updated_at.
    static func rowsToApply(
        _ rows: [String: AppDataRow], cached: [String: String], adoptedDuringFetch: [String: String?]
    ) -> [String: String] {
        var apply: [String: String] = [:]
        for (key, row) in rows {
            if cached[key] == row.value { continue }
            if let adopted = adoptedDuringFetch[key], isOlder(row.updatedAt, than: adopted) { continue }
            apply[key] = row.value
        }
        return apply
    }
}

// MARK: - URL building

enum PostgRESTURL {
    /// `URL.appending(queryItems:)` leaves "+" literal, and PostgREST decodes
    /// a literal "+" as a SPACE ("…03+10:00" → Postgres 22007). Everything
    /// else is encoded exactly as before.
    static func make(base: URL, path: String, query: [URLQueryItem]) -> URL {
        let url = base.appendingPathComponent(path)
        guard !query.isEmpty else { return url }
        let withQuery = url.appending(queryItems: query)
        guard var components = URLComponents(url: withQuery, resolvingAgainstBaseURL: false),
              let encoded = components.percentEncodedQuery, encoded.contains("+")
        else { return withQuery }
        components.percentEncodedQuery = encoded.replacingOccurrences(of: "+", with: "%2B")
        return components.url ?? withQuery
    }
}
