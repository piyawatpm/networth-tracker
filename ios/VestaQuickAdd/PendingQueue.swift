import Foundation

/// Expenses that haven't reached the server yet.
///
/// The whole point of the app over a plain Shortcut: tapping the Action Button
/// in a car park with no signal still records the expense. Items are written to
/// the shared App Group container so the Intent process and the app see one
/// queue, and every send is idempotent by `clientId`, so a retry after an
/// ambiguous failure can't create a duplicate.
actor PendingQueue {
    static let shared = PendingQueue()

    private let client = QuickExpenseClient()
    private var cached: [PendingExpense]?

    private var fileURL: URL {
        let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: Settings.appGroup)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
        return container.appendingPathComponent("pending-expenses.json")
    }

    private func load() -> [PendingExpense] {
        if let cached { return cached }
        guard let data = try? Data(contentsOf: fileURL),
              let items = try? JSONDecoder().decode([PendingExpense].self, from: data)
        else {
            cached = []
            return []
        }
        cached = items
        return items
    }

    private func save(_ items: [PendingExpense]) {
        cached = items
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    var count: Int { load().count }

    var items: [PendingExpense] { load() }

    /// How long the intent may spend uploading before it gives up and lets the
    /// disk queue do its job. Deliberately far below what URLSession would
    /// allow: returning "saved, will sync" in six seconds beats being killed at
    /// thirty with the user staring at a Shortcuts error.
    private static let uploadBudget: Double = 6

    /// Write straight to Supabase (authenticated, idempotent by clientId);
    /// queue on ANY failure. Nothing is ever dropped — a bad network, an
    /// expired session, whatever: the expense sits on disk until a flush
    /// succeeds. Returns whether it reached the server right now.
    @discardableResult
    func submit(_ expense: PendingExpense) async throws -> Bool {
        // Durably enqueue BEFORE touching the network.
        //
        // The upload is heavy for a background intent: sign in, pull the
        // ~54 KB expense blob, decode ~190 records, append, push it back. On a
        // slow connection at a checkout that can outlast the intent's time
        // budget, and iOS kills the process — which does NOT throw, so the old
        // "send, and only queue if it throws" order silently lost the expense
        // and surfaced as "couldn't communicate with a helper application".
        // Queued first, the worst case is a delayed sync instead of a lost one.
        var items = load()
        items.append(expense)
        save(items)
        IntentLog.write("queued to disk · \(expense.currency) \(expense.amount) · \(expense.type)")

        do {
            try await withDeadline(Self.uploadBudget) {
                try await SupabaseAPI.shared.appendExpense(expense)
            }
            remove(expense.clientId)
            IntentLog.write("uploaded ✓")
            await flush() // opportunistically drain anything older
            // The store (same process) reloads instantly — no stale UI.
            NotificationCenter.default.post(name: .vestaDataDidChange, object: nil)
            return true
        } catch {
            // Still on disk, still idempotent. The next foreground open or
            // background refresh sends it.
            IntentLog.write("upload deferred — \(error.localizedDescription)")
            return false
        }
    }

    /// Retry everything queued, oldest first. Stops at the first failure —
    /// if the network is down, the rest will fail the same way, and hammering
    /// it drains the battery for nothing.
    func flush() async {
        var items = load()
        guard !items.isEmpty else { return }

        var remaining: [PendingExpense] = []
        var stalled = false
        var synced = false

        for item in items.sorted(by: { $0.createdAt < $1.createdAt }) {
            if stalled {
                remaining.append(item)
                continue
            }
            do {
                // Same deadline as submit: a flush riding inside an intent must
                // not turn one slow request into a killed process.
                try await withDeadline(Self.uploadBudget) {
                    try await SupabaseAPI.shared.appendExpense(item)
                }
                synced = true
            } catch {
                stalled = true
                remaining.append(item)
            }
        }

        items = remaining
        save(items)
        if synced {
            NotificationCenter.default.post(name: .vestaDataDidChange, object: nil)
            let count = load().count
            Notify.post(
                title: "Queued expenses synced",
                body: count == 0
                    ? "Everything is up to date."
                    : "\(count) still waiting for a connection."
            )
        }
    }

    func remove(_ id: String) {
        save(load().filter { $0.clientId != id })
    }

    func clear() {
        save([])
    }
}
