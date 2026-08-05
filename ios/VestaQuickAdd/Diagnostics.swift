import Foundation

// MARK: - Deadlines

struct DeadlineExceeded: LocalizedError {
    let seconds: Double
    var errorDescription: String? { "timed out after \(Int(seconds))s" }
}

/// Run `operation`, abandoning it after `seconds`.
///
/// Everything an App Intent does happens inside a budget iOS does not publish
/// and will not extend. Overrun it and the process is killed mid-flight, which
/// Shortcuts reports as "couldn't communicate with a helper application" — a
/// message that names the symptom and hides the cause. URLSession's own
/// timeouts are far too generous for that budget (15s connect + 30s read, three
/// requests deep for a single expense = 75s worst case), so every network hop on
/// the quick-add path gets a deadline short enough to always return an answer.
func withDeadline<T: Sendable>(
    _ seconds: Double,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(for: .seconds(seconds))
            throw DeadlineExceeded(seconds: seconds)
        }
        // Whoever finishes first wins; the loser is cancelled, which aborts an
        // in-flight URLSession request rather than leaving it running.
        defer { group.cancelAll() }
        guard let result = try await group.next() else {
            throw DeadlineExceeded(seconds: seconds)
        }
        return result
    }
}

// MARK: - Timing

/// Stopwatch for the boot path, DEBUG-only.
///
/// Cold launch is the one thing a user measures without being asked, and it's
/// the one thing that can't be reasoned about from the code — the cost is in
/// what the data actually is, not what the code says. Numbers first.
enum Perf {
    @discardableResult
    static func measure<T>(_ label: String, _ work: () throws -> T) rethrows -> T {
        #if DEBUG
        let start = CFAbsoluteTimeGetCurrent()
        defer {
            let ms = (CFAbsoluteTimeGetCurrent() - start) * 1000
            print(String(format: "[perf] %-26@ %7.1f ms", label as NSString, ms))
        }
        #endif
        return try work()
    }

    @discardableResult
    static func measureAsync<T>(_ label: String, _ work: () async throws -> T) async rethrows -> T {
        #if DEBUG
        let start = CFAbsoluteTimeGetCurrent()
        defer {
            let ms = (CFAbsoluteTimeGetCurrent() - start) * 1000
            print(String(format: "[perf] %-26@ %7.1f ms", label as NSString, ms))
        }
        #endif
        return try await work()
    }
}

// MARK: - Intent breadcrumbs

/// An on-device trail of what the quick-add intent did, and how far it got.
///
/// A failed Wallet automation gives you one useless sentence and no way to tell
/// these apart:
///
///   * Shortcuts never reached the app — its own timeout waiting on the bank's
///     transaction record (a documented iOS bug, FB14035016), an expired
///     signature, Low Power Mode deferring the automation.
///   * The app ran and failed — no session, no network, a zero amount.
///
/// The distinction is the whole diagnosis, and it needs no Mac: **no entry for
/// the tap means it never got here.** Entries are written synchronously so a
/// line survives the process being killed on the next statement.
struct BreadcrumbLog {
    struct Entry: Codable, Identifiable, Sendable {
        let at: Date
        let message: String
        var id: String { "\(at.timeIntervalSince1970)-\(message)" }
    }

    let filename: String
    var limit = 80

    /// What the real quick-add did.
    static let quickAdd = BreadcrumbLog(filename: "intent-log.json")
    /// What the accept-everything debug intent was handed. Kept separate so a
    /// noisy week of taps can't push the quick-add's own trail off the end.
    static let tap = BreadcrumbLog(filename: "tap-log.json")

    private static let queue = DispatchQueue(label: "com.piyawatpm.vesta.breadcrumbs")

    private var fileURL: URL {
        let dir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: Settings.appGroup)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(filename)
    }

    /// Synchronous on purpose — an entry that lands after the kill is no entry.
    func write(_ message: String) {
        Self.queue.sync {
            var entries = loadLocked()
            entries.append(Entry(at: Date(), message: message))
            if entries.count > limit { entries.removeFirst(entries.count - limit) }
            do {
                let data = try JSONEncoder().encode(entries)
                try data.write(to: fileURL, options: .atomic)
            } catch {
                // A diagnostic that fails silently is worse than no diagnostic
                // — it makes "no entries" look like "the intent never ran".
                #if DEBUG
                print("[breadcrumb] write to \(fileURL.path) failed: \(error)")
                #endif
            }
        }
    }

    /// Newest first, for display.
    func entries() -> [Entry] {
        Self.queue.sync { Array(loadLocked().reversed()) }
    }

    func clear() {
        Self.queue.sync { try? FileManager.default.removeItem(at: fileURL) }
    }

    private func loadLocked() -> [Entry] {
        guard let data = try? Data(contentsOf: fileURL),
              let entries = try? JSONDecoder().decode([Entry].self, from: data)
        else { return [] }
        return entries
    }
}

/// Shorthand for the quick-add channel — by far the most-written one.
enum IntentLog {
    static func write(_ message: String) { BreadcrumbLog.quickAdd.write(message) }
    static func entries() -> [BreadcrumbLog.Entry] { BreadcrumbLog.quickAdd.entries() }
    static func clear() { BreadcrumbLog.quickAdd.clear() }
}

// MARK: - Signature expiry

/// When this build's signature dies.
///
/// A free personal-team profile is valid for seven days. On day eight the app
/// refuses to launch — and every Wallet automation fails with the same
/// "couldn't communicate with a helper application" as a real bug, because from
/// Shortcuts' side it *is* the same thing: nobody answered. Reading the date out
/// of the bundle turns a week-long mystery into a reinstall reminder.
enum BuildExpiry {
    static let date: Date? = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              // The profile is CMS-signed, but its plist sits in the clear
              // inside the envelope — no crypto needed to read the date.
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8)),
              let plist = try? PropertyListSerialization.propertyList(
                  from: Data(data[start.lowerBound..<end.upperBound]), format: nil
              ) as? [String: Any]
        else { return nil }
        return plist["ExpirationDate"] as? Date
    }()

    /// Whole days from now until the signature lapses; nil for App Store or
    /// simulator builds, which carry no profile.
    static var daysLeft: Int? {
        guard let date else { return nil }
        return Calendar.current.dateComponents([.day], from: Date(), to: date).day
    }

    /// Inside the window where the reinstall should happen *before* the next
    /// card tap discovers the problem.
    static var isExpiringSoon: Bool {
        guard let daysLeft else { return false }
        return daysLeft <= 3
    }

    static var summary: String {
        guard let date else { return "No expiry (release build)" }
        let formatter = DateFormatter()
        formatter.dateFormat = "d MMM, h:mm a"
        let days = daysLeft ?? 0
        return "\(formatter.string(from: date)) · \(days) day\(days == 1 ? "" : "s") left"
    }
}
