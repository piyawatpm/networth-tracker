import Foundation
import Security

/// Where the app posts to and what it authenticates with.
///
/// The base URL and default category are plain preferences, but the token is a
/// write credential for the expense ledger, so it lives in the Keychain rather
/// than UserDefaults — UserDefaults is readable from an unencrypted plist in a
/// device backup.
///
/// Stored in a shared App Group so the App Intent (which runs in a separate
/// extension process for the Action Button) reads the same values as the app.
enum Settings {
    static let appGroup = "group.com.piyawatpm.vesta"

    private enum Key {
        static let baseURL = "baseURL"
        static let defaultCategory = "defaultCategory"
        static let defaultCurrency = "defaultCurrency"
        static let categories = "cachedCategories"
    }

    /// Falls back to standard defaults if the App Group isn't provisioned yet,
    /// so a fresh checkout still runs instead of crashing on a nil suite.
    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    /// Deployed production URL baked in as the default, so the shell and the
    /// Action Button work out of the box — only the token needs entering.
    static let productionURL = "https://my-networth-tracker.vercel.app"

    static var baseURL: String {
        get {
            let stored = defaults.string(forKey: Key.baseURL) ?? ""
            return stored.isEmpty ? productionURL : stored
        }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Key.baseURL) }
    }

    /// The app's origin as a URL — what the webview shell loads. Nil only when
    /// a hand-entered override is unparseable.
    static var endpointBase: URL? {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let normalized = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        return URL(string: normalized)
    }

    static var defaultCategory: String {
        get { defaults.string(forKey: Key.defaultCategory) ?? "food" }
        set { defaults.set(newValue, forKey: Key.defaultCategory) }
    }

    static var defaultCurrency: String {
        get { defaults.string(forKey: Key.defaultCurrency) ?? "AUD" }
        set { defaults.set(newValue, forKey: Key.defaultCurrency) }
    }

    /// Last known category list, so the intent's parameter picker never has to
    /// wait on the network inside its execution budget.
    static var cachedCategories: [String]? {
        get { defaults.stringArray(forKey: Key.categories) }
        set { defaults.set(newValue, forKey: Key.categories) }
    }

    static var isConfigured: Bool {
        !baseURL.isEmpty && !(token ?? "").isEmpty
    }

    /// The endpoint, or nil when the base URL is missing or unparseable.
    static var endpoint: URL? {
        endpointBase?.appendingPathComponent("api/quick-expense")
    }

    // MARK: - Keychain

    private static let tokenAccount = "quick-add-token"
    private static let tokenService = "com.piyawatpm.vesta.quickadd"

    static var token: String? {
        get {
            var query = baseTokenQuery()
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
                  let data = item as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
        set {
            let query = baseTokenQuery()
            SecItemDelete(query as CFDictionary)
            guard let value = newValue?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty,
                  let data = value.data(using: .utf8) else { return }
            var insert = query
            insert[kSecValueData as String] = data
            // Available after first unlock so a queued retry can fire from the
            // background without the phone being unlocked at that moment.
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    private static func baseTokenQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: tokenService,
            kSecAttrAccount as String: tokenAccount,
        ]
    }
}
