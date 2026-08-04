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

    /// Write straight to Supabase (authenticated, idempotent by clientId);
    /// queue on ANY failure. Nothing is ever dropped — a bad network, an
    /// expired session, whatever: the expense sits on disk until a flush
    /// succeeds. Returns whether it reached the server right now.
    @discardableResult
    func submit(_ expense: PendingExpense) async throws -> Bool {
        do {
            try await SupabaseAPI.shared.appendExpense(expense)
            await flush()
            return true
        } catch {
            var items = load()
            items.append(expense)
            save(items)
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

        for item in items.sorted(by: { $0.createdAt < $1.createdAt }) {
            if stalled {
                remaining.append(item)
                continue
            }
            do {
                try await SupabaseAPI.shared.appendExpense(item)
            } catch {
                stalled = true
                remaining.append(item)
            }
        }

        items = remaining
        save(items)
    }

    func remove(_ id: String) {
        save(load().filter { $0.clientId != id })
    }

    func clear() {
        save([])
    }
}
