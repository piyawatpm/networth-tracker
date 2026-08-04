import Foundation
import Observation
import SwiftUI

/// The app's single source of truth, mirroring the web's DataProvider: load
/// every KV blob once, decode, expose typed collections; writes re-encode the
/// whole array back to its blob (the same convention the web app uses, so the
/// two clients can't corrupt each other's shape).
/// Everything needed to boot offline, snapshotted to one file after each
/// successful refresh. Blobs stay raw strings so the cache can't drift from
/// the decode logic — decode always runs the same path, cache or network.
struct DiskCache: Codable {
    /// Bump when the cache's SEMANTICS change, not just its shape. v2: the
    /// history field went from a ~2-day daily window to full intraday rows —
    /// a v1 cache must be discarded, because the incremental refresh only
    /// fetches rows NEWER than the cached max and would freeze the old
    /// truncated history in place forever (first point stuck at Aug 3).
    /// v3: adds the portfolio + crypto series. v4: portfolio rows carry
    /// value_with_super (old rows lack it → with-super chart would be wrong).
    static let currentVersion = 4

    var version: Int // decoding a versionless v1 cache fails → treated as empty
    var blobs: [String: String]
    var networthHistory: [SnapshotPoint]
    var portfolioHistory: [SnapshotPoint]
    var cryptoHistory: [SnapshotPoint]
    var fxRates: [String: Double]
    var livePrices: [String: Double]
    var savedAt: Double

    static var fileURL: URL {
        let dir = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        )[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("vesta-cache.json")
    }

    static func load() -> DiskCache? {
        guard let data = try? Data(contentsOf: fileURL),
              let cache = try? JSONDecoder().decode(DiskCache.self, from: data),
              cache.version == currentVersion
        else { return nil }
        return cache
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: Self.fileURL, options: .atomic)
    }
}

@Observable
@MainActor
final class DataStore {
    // MARK: State

    var isSignedIn = false
    var isLoading = false
    var loadError: String?
    var needsManualSignIn = false
    /// Unix seconds of the last successful network refresh (0 = never).
    var lastRefreshed: Double = 0

    var income: [IncomeEntry] = []
    var expenses: [ExpenseEntry] = []
    var holdings: [PortfolioHolding] = []
    var portfolioTxs: [PortfolioTransaction] = []
    var debts: [DebtRecord] = []
    var debtTxs: [DebtTransaction] = []
    var customIncomeCategories: [CustomCategory] = []
    var customExpenseCategories: [CustomCategory] = []
    var cryptoTxs: [CryptoTransaction] = []
    var cryptoCsvHoldings: [CryptoCsvHolding] = []
    var cryptoPrices: [String: Double] = [:]
    var livePrices: [String: Double] = [:]
    var tickerMappings: [String: String] = [:]
    var stablecoinTags: [String: Bool] = [:]
    var goals: [NetworthGoal] = []
    /// display-name → CoinGecko image URL (maintained by the web app).
    var coinImages: [String: String] = [:]
    /// ticker → Finnhub logo URL.
    var stockLogos: [String: String] = [:]
    var recurringIncome: [RecurringTemplate] = []
    var recurringExpenses: [RecurringTemplate] = []
    var realizedIncomeEnabled = true
    var displayCurrency = "AUD"
    var fxLoaded = false
    /// Raw INTRADAY snapshots (USD), full history, ascending — one series per
    /// pot, mirroring the snapshots table's type column.
    var networthHistory: [SnapshotPoint] = []
    var portfolioHistory: [SnapshotPoint] = []
    var cryptoHistory: [SnapshotPoint] = []
    /// Same rows with dates parsed once — 20k string→Date parses per chart
    /// render would jank the scrubber.
    private(set) var networthParsed: [(date: Date, valueUsd: Double)] = []
    /// Ex-super — the snapshot `value` column.
    private(set) var portfolioParsed: [(date: Date, valueUsd: Double)] = []
    /// Including super (falls back to ex-super where the column is null).
    private(set) var portfolioParsedWithSuper: [(date: Date, valueUsd: Double)] = []
    private(set) var cryptoParsed: [(date: Date, valueUsd: Double)] = []

    /// Live trade prices from the Alpaca socket, ticker → USD.
    var liveStockPrices: [String: Double] = [:]
    /// Invest-tab super toggle (persisted; net worth always includes super).
    var includeSuperStocks: Bool = Settings.defaults.object(forKey: "includeSuperStocks") as? Bool ?? true {
        didSet { Settings.defaults.set(includeSuperStocks, forKey: "includeSuperStocks") }
    }

    private let sockets = PriceSocketCenter()

    private static let snapshotFormats: [DateFormatter] = {
        ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"].map { format in
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = SydneyTime.zone
            f.dateFormat = format
            return f
        }
    }()

    static func parseRows(
        _ rows: [SnapshotPoint], withSuper: Bool = false
    ) -> [(date: Date, valueUsd: Double)] {
        rows.compactMap { row in
            for formatter in snapshotFormats {
                if let date = formatter.date(from: row.date) {
                    return (date, withSuper ? (row.valueWithSuper ?? row.value) : row.value)
                }
            }
            return nil
        }
    }

    private func setHistory(_ type: String, _ rows: [SnapshotPoint]) {
        switch type {
        case "portfolio":
            portfolioHistory = rows
            portfolioParsed = Self.parseRows(rows)
            portfolioParsedWithSuper = Self.parseRows(rows, withSuper: true)
        case "crypto":
            cryptoHistory = rows
            cryptoParsed = Self.parseRows(rows)
        default:
            networthHistory = rows
            networthParsed = Self.parseRows(rows)
        }
    }

    private func history(for type: String) -> [SnapshotPoint] {
        switch type {
        case "portfolio": return portfolioHistory
        case "crypto": return cryptoHistory
        default: return networthHistory
        }
    }

    /// Incremental merge: fetch rows newer than the cached max, append.
    private func mergeHistory(_ type: String) async {
        let current = history(for: type)
        guard let fresh = try? await api.fetchSnapshotsRaw(
            type: type, since: current.last?.date
        ), !fresh.isEmpty else { return }
        let known = Set(current.map(\.date))
        let merged = (current + fresh.filter { !known.contains($0.date) })
            .sorted { $0.date < $1.date }
        setHistory(type, merged)
    }

    private let api = SupabaseAPI.shared
    /// Raw blobs from the last load — kept so cache saves exactly what came in.
    private var rawBlobs: [String: String] = [:]

    // MARK: Session

    func bootstrap() async {
        // 1. Paint instantly from the disk cache — no spinner, no network.
        if let cache = DiskCache.load() {
            rawBlobs = cache.blobs
            if !cache.fxRates.isEmpty {
                Money.rates = cache.fxRates
                fxLoaded = true
            }
            livePrices = cache.livePrices
            setHistory("networth", cache.networthHistory)
            setHistory("portfolio", cache.portfolioHistory)
            setHistory("crypto", cache.cryptoHistory)
            lastRefreshed = cache.savedAt
            decode(cache.blobs)
        }

        // 2. Session: keychain restore, else silent owner sign-in. The login
        //    screen only exists as a fallback for a changed password.
        if await api.restoreSession() {
            isSignedIn = true
        } else {
            do {
                try await api.signIn(
                    email: SupabaseConfig.ownerEmail,
                    password: SupabaseConfig.ownerPassword
                )
                isSignedIn = true
            } catch {
                needsManualSignIn = true
                return
            }
        }

        // 3. Fresh data behind the cached paint.
        await refresh()
    }

    func signIn(email: String, password: String) async throws {
        try await api.signIn(email: email, password: password)
        isSignedIn = true
        needsManualSignIn = false
        await refresh()
    }

    func signOut() async {
        await api.signOut()
        isSignedIn = false
        needsManualSignIn = true
    }

    // MARK: Load / refresh

    /// Refresh only when the data is older than `maxAgeSeconds` — the "update
    /// regularly, not all the time" policy. Foreground pokes call this.
    func refreshIfStale(maxAgeSeconds: Double) async {
        guard Date().timeIntervalSince1970 - lastRefreshed > maxAgeSeconds else { return }
        await refresh()
    }

    func refresh() async {
        guard isSignedIn else { return }
        isLoading = rawBlobs.isEmpty // skeletons only when there's no cache
        loadError = nil
        do {
            async let blobsTask = api.fetchAppData()
            async let ratesTask = api.fetchFxRates()

            let blobs = try await blobsTask
            rawBlobs = blobs
            decode(blobs)

            if let rates = try? await ratesTask, !rates.isEmpty {
                Money.rates = rates
                fxLoaded = true
            }
            // First load pulls each pot's whole snapshot history (~20 pages);
            // afterwards only rows newer than what's cached — usually 1 page.
            await mergeHistory("networth")
            await mergeHistory("portfolio")
            await mergeHistory("crypto")

            // Live prices for whatever the holdings CSV says we own.
            let tokens = cryptoCsvHoldings
                .filter { !CryptoMath.isCashLike($0.token, tags: stablecoinTags) }
                .map(\.token)
            let live = await api.fetchBinancePrices(tokens: tokens, mappings: tickerMappings)
            if !live.isEmpty { livePrices = live }

            // Symbol set may have changed (new coin, new holding) — resubscribe.
            startLive()

            lastRefreshed = Date().timeIntervalSince1970
            DiskCache(
                version: DiskCache.currentVersion,
                blobs: blobs,
                networthHistory: networthHistory,
                portfolioHistory: portfolioHistory,
                cryptoHistory: cryptoHistory,
                fxRates: Money.rates,
                livePrices: livePrices,
                savedAt: lastRefreshed
            ).save()
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    /// Alias kept for call sites that predate the cache split.
    func loadAll() async { await refresh() }

    private func decode(_ blobs: [String: String]) {
        func blob<T: Decodable>(_ key: String, _ type: T.Type) -> T? {
            guard let raw = blobs[key], let data = raw.data(using: .utf8) else { return nil }
            return try? JSONDecoder().decode(T.self, from: data)
        }

        income = blob("income_entries", [IncomeEntry].self) ?? []
        expenses = blob("expense_entries", [ExpenseEntry].self) ?? []
        holdings = blob("portfolio_holdings", [PortfolioHolding].self) ?? []
        portfolioTxs = blob("portfolio_transactions", [PortfolioTransaction].self) ?? []
        debts = blob("debt_records", [DebtRecord].self) ?? []
        debtTxs = blob("debt_transactions", [DebtTransaction].self) ?? []
        customIncomeCategories = blob("custom_income_categories", [CustomCategory].self) ?? []
        customExpenseCategories = blob("custom_expense_categories", [CustomCategory].self) ?? []
        cryptoPrices = blob("crypto_prices", CryptoPricesBlob.self)?.prices ?? [:]
        tickerMappings = blob("crypto_ticker_mappings", [String: String].self) ?? [:]
        stablecoinTags = blob("crypto_stablecoin_tags", [String: Bool].self) ?? [:]
        goals = blob("networth_goals", [NetworthGoal].self) ?? []
        coinImages = blob("crypto_coin_images", [String: String].self) ?? [:]
        stockLogos = blob("portfolio_stock_logos", [String: String].self) ?? [:]
        recurringIncome = blob("recurring_income_templates", [RecurringTemplate].self) ?? []
        recurringExpenses = blob("recurring_expense_templates", [RecurringTemplate].self) ?? []
        realizedIncomeEnabled = blob("realized_income_enabled", Bool.self) ?? true
        displayCurrency = blob("preferred_currency", String.self) ?? "AUD"

        // Both CSVs are raw string blobs, not JSON-of-array.
        if let csv = blob("crypto_tx_csv_text", String.self), !csv.isEmpty {
            cryptoTxs = CryptoMath.parseTransactions(csv)
        } else {
            cryptoTxs = []
        }
        if let csv = blob("crypto_csv_text", String.self), !csv.isEmpty {
            cryptoCsvHoldings = CryptoMath.parsePortfolioOverview(csv)
        } else {
            cryptoCsvHoldings = []
        }
    }

    // MARK: Writes (whole-blob, like the web)

    private func persist<T: Encodable>(_ key: String, _ value: T) async throws {
        let data = try JSONEncoder().encode(value)
        let json = String(decoding: data, as: UTF8.self)
        try await api.writeAppData(key: key, value: json)
    }

    func saveIncome(_ entry: IncomeEntry) async throws {
        if let index = income.firstIndex(where: { $0.id == entry.id }) {
            income[index] = entry
        } else {
            income.append(entry)
        }
        try await persist("income_entries", income)
    }

    func deleteIncome(_ id: String) async throws {
        income.removeAll { $0.id == id }
        try await persist("income_entries", income)
    }

    func saveExpense(_ entry: ExpenseEntry) async throws {
        if let index = expenses.firstIndex(where: { $0.id == entry.id }) {
            expenses[index] = entry
        } else {
            expenses.append(entry)
        }
        try await persist("expense_entries", expenses)
    }

    func deleteExpense(_ id: String) async throws {
        expenses.removeAll { $0.id == id }
        try await persist("expense_entries", expenses)
    }

    func savePortfolioTx(_ tx: PortfolioTransaction) async throws {
        portfolioTxs.append(tx)
        try await persist("portfolio_transactions", portfolioTxs)
    }

    func saveDebt(_ debt: DebtRecord) async throws {
        if let index = debts.firstIndex(where: { $0.id == debt.id }) {
            debts[index] = debt
        } else {
            debts.append(debt)
        }
        try await persist("debt_records", debts)
    }

    /// Removes the record AND its ledger — orphan transactions would silently
    /// distort net worth forever.
    func deleteDebt(_ id: String) async throws {
        debts.removeAll { $0.id == id }
        debtTxs.removeAll { $0.debtId == id }
        try await persist("debt_records", debts)
        try await persist("debt_transactions", debtTxs)
    }

    func saveDebtTx(_ tx: DebtTransaction) async throws {
        debtTxs.append(tx)
        try await persist("debt_transactions", debtTxs)
    }

    func deleteDebtTx(_ id: String) async throws {
        debtTxs.removeAll { $0.id == id }
        try await persist("debt_transactions", debtTxs)
    }

    /// Display currency, synced through the same `preferred_currency` blob the
    /// web reads — switch on the phone and the website follows.
    func setDisplayCurrency(_ code: String) {
        displayCurrency = code
        Task { try? await persist("preferred_currency", code) }
    }

    // MARK: Derived — money

    func convert(_ amount: Double, from currency: String) -> Double {
        Money.convert(amount, from: currency, to: displayCurrency)
    }

    func format(_ amount: Double, compact: Bool = false) -> String {
        Money.format(amount, currency: displayCurrency, compact: compact)
    }

    // MARK: Derived — categories

    func incomeLabel(_ type: String) -> String {
        if let match = Categories.incomeLabels.first(where: { $0.id == type }) {
            return match.label
        }
        return customIncomeCategories.first { $0.id == type }?.label ?? type
    }

    func expenseLabel(_ type: String) -> String {
        if let match = Categories.expenseLabels.first(where: { $0.id == type }) {
            return match.label
        }
        return customExpenseCategories.first { $0.id == type }?.label ?? type
    }

    func incomeColor(_ type: String) -> Color {
        if let index = Categories.incomeColorIndex[type] { return Ledger.chartColor(index) }
        if let custom = customIncomeCategories.first(where: { $0.id == type }) {
            return Color(hex: custom.color)
        }
        return Ledger.hashedColor(type)
    }

    func expenseColor(_ type: String) -> Color {
        if let index = Categories.expenseColorIndex[type] { return Ledger.chartColor(index) }
        if let custom = customExpenseCategories.first(where: { $0.id == type }) {
            return Color(hex: custom.color)
        }
        return Ledger.hashedColor(type)
    }

    // MARK: Derived — realized income (parity with the web income page)

    var derivedRealizedIncome: [IncomeEntry] {
        guard realizedIncomeEnabled else { return [] }
        let tickers = Dictionary(uniqueKeysWithValues: holdings.map { ($0.id, $0.ticker) })
        let stocks = PortfolioMath.realizedSales(portfolioTxs) { tickers[$0] }
        let crypto = CryptoMath.realizedSales(cryptoTxs)
        return (stocks + crypto).map { sale in
            IncomeEntry(
                id: sale.id,
                type: sale.source == "stocks" ? "realized_stocks" : "realized_crypto",
                description: "\(sale.realized >= 0 ? "Gain on" : "Loss on") \(sale.label) sell",
                amount: sale.realized,
                currency: sale.currency,
                date: sale.date,
                source: sale.ticker,
                isPassive: true,
                createdAt: 0,
                derived: true
            )
        }
    }

    var allIncome: [IncomeEntry] { income + derivedRealizedIncome }

    // MARK: Derived — net worth pieces (all in display currency)

    /// Web's canAutoUpdate rule: real ticker, not the SUPER placeholder, not
    /// an IFM- internal code — and Alpaca only quotes USD listings.
    private func liveEligible(_ holding: PortfolioHolding) -> Bool {
        !holding.ticker.isEmpty && holding.ticker != "SUPER"
            && !holding.ticker.hasPrefix("IFM-") && holding.currency == "USD"
    }

    /// Current value with the live trade price applied where one exists.
    func holdingLiveValue(_ holding: PortfolioHolding) -> Double {
        if liveEligible(holding), holding.units > 0,
           let price = liveStockPrices[holding.ticker] {
            return holding.units * price
        }
        return holding.currentValue
    }

    var stocksValue: Double {
        holdings.reduce(0) { $0 + convert(holdingLiveValue($1), from: $1.currency) }
    }

    /// Invest-tab figure, honoring the super toggle.
    var stocksValueVisible: Double {
        holdings
            .filter { includeSuperStocks || $0.accountType != "super" }
            .reduce(0) { $0 + convert(holdingLiveValue($1), from: $1.currency) }
    }

    // MARK: Live sockets

    /// (Re)connect the three price feeds for whatever we currently hold.
    /// Called on foreground and after each refresh (the token set may change).
    func startLive() {
        guard isSignedIn else { return }
        let tokens = cryptoCsvHoldings
            .filter { !CryptoMath.isCashLike($0.token, tags: stablecoinTags) }
            .map(\.token)
        var binanceMap: [String: String] = [:]
        var gateMap: [String: String] = [:]
        for token in tokens {
            // The mappings blob resolves display names to BASE symbols
            // ("Hyperliquid" → "HYPE"), never to exchange pairs — the pair
            // suffix is ours to add. Assuming it mapped to pairs left the
            // Binance list empty and killed the whole feed.
            let base = (tickerMappings[token] ?? token)
                .uppercased().replacingOccurrences(of: " ", with: "")
            guard (2...12).contains(base.count),
                  base.allSatisfy({ $0.isLetter || $0.isNumber }) else { continue }
            binanceMap["\(base)USDT"] = token
            // Gate covers what Binance doesn't list (GT, OFC…); harmless
            // double-subscription otherwise — same number wins either way.
            gateMap["\(base)_USDT"] = token
        }
        let stockSymbols = holdings.filter { liveEligible($0) }.map(\.ticker)

        sockets.start(
            binanceMap: binanceMap,
            gateMap: gateMap,
            stockSymbols: stockSymbols,
            onCrypto: { token, price in
                Task { @MainActor [weak self] in self?.livePrices[token] = price }
            },
            onStock: { ticker, price in
                Task { @MainActor [weak self] in self?.liveStockPrices[ticker] = price }
            }
        )
    }

    func stopLive() {
        sockets.stop()
    }

    var cryptoHoldings: [CryptoHolding] {
        CryptoMath.computeHoldings(cryptoTxs)
    }

    /// Best available USD price for a token: live Binance beats the web's
    /// stored blob beats nothing.
    func priceUsd(_ token: String) -> Double? {
        livePrices[token] ?? cryptoPrices[token]
    }

    /// A token's current USD value, holdings-CSV row.
    ///
    /// The CSV's stored value is the FLOOR of knowledge (it priced every coin
    /// at upload time, including Earn/locked ones no feed quotes); a live
    /// price refreshes it when one exists. Never price-by-feed-or-zero — that
    /// exact bug valued BTC at $0 and reported net worth ฿750k short.
    func csvHoldingValueUsd(_ holding: CryptoCsvHolding) -> Double {
        if CryptoMath.isCashLike(holding.token, tags: stablecoinTags) {
            return holding.amount // pegged $1/unit, same as the web
        }
        if let price = priceUsd(holding.token) {
            return holding.amount * price
        }
        return holding.valueUsd
    }

    var cryptoValue: Double {
        // The holdings CSV is authoritative when present (it includes coins
        // the tx log never saw). Tx replay is the fallback for a fresh setup.
        let usd: Double
        if !cryptoCsvHoldings.isEmpty {
            usd = cryptoCsvHoldings.reduce(0) { $0 + csvHoldingValueUsd($1) }
        } else {
            usd = cryptoHoldings.reduce(0) { total, holding in
                if CryptoMath.isCashLike(holding.token, tags: stablecoinTags) {
                    return total + holding.amount
                }
                return total + holding.amount * (priceUsd(holding.token) ?? 0)
            }
        }
        return convert(usd, from: "USD")
    }

    func coinImageURL(_ token: String) -> URL? {
        if let direct = coinImages[token] { return URL(string: direct) }
        // Blob keys are display names; tolerate case drift.
        let lower = token.lowercased()
        return coinImages.first { $0.key.lowercased() == lower }
            .flatMap { URL(string: $0.value) }
    }

    func stockLogoURL(_ ticker: String) -> URL? {
        stockLogos[ticker].flatMap(URL.init(string:))
    }

    struct CryptoDisplayRow: Identifiable {
        let token: String
        let amount: Double
        let valueUsd: Double
        let costUsd: Double
        let isCash: Bool
        let isLive: Bool
        var id: String { token }
        var pnlUsd: Double { valueUsd - costUsd }
    }

    /// What the Crypto tab renders: holdings CSV first (authoritative,
    /// includes Earn/locked coins), tx replay only as a fresh-setup fallback.
    var cryptoDisplayRows: [CryptoDisplayRow] {
        let rows: [CryptoDisplayRow]
        if !cryptoCsvHoldings.isEmpty {
            rows = cryptoCsvHoldings.map { holding in
                CryptoDisplayRow(
                    token: holding.token,
                    amount: holding.amount,
                    valueUsd: csvHoldingValueUsd(holding),
                    costUsd: CryptoMath.isCashLike(holding.token, tags: stablecoinTags)
                        ? holding.amount : holding.costUsd,
                    isCash: CryptoMath.isCashLike(holding.token, tags: stablecoinTags),
                    isLive: livePrices[holding.token] != nil
                )
            }
        } else {
            rows = cryptoHoldings.map { holding in
                let cash = CryptoMath.isCashLike(holding.token, tags: stablecoinTags)
                return CryptoDisplayRow(
                    token: holding.token,
                    amount: holding.amount,
                    valueUsd: cash
                        ? holding.amount
                        : holding.amount * (priceUsd(holding.token) ?? 0),
                    costUsd: holding.totalCostUsd,
                    isCash: cash,
                    isLive: livePrices[holding.token] != nil
                )
            }
        }
        return rows.filter { $0.valueUsd > 0.5 }.sorted { $0.valueUsd > $1.valueUsd }
    }

    var debtNet: Double {
        var net = 0.0
        for debt in debts {
            let paid = debtTxs.filter { $0.debtId == debt.id }.reduce(0) { $0 + $1.amount }
            let balance = debt.originalAmount - paid
            let signed = debt.direction == "owed_to_me" ? balance : -balance
            net += convert(signed, from: debt.currency)
        }
        return net
    }

    var netWorth: Double { stocksValue + cryptoValue + debtNet }

    // MARK: Derived — month aggregates

    func monthTotal(_ entries: [IncomeEntry], month: String) -> Double {
        entries
            .filter { SydneyTime.monthKey($0.date) == month }
            .reduce(0) { $0 + convert($1.amount, from: $1.currency) }
    }

    func monthTotalExpenses(month: String) -> Double {
        expenses
            .filter { SydneyTime.monthKey($0.date) == month }
            .reduce(0) { $0 + convert($1.amount, from: $1.currency) }
    }
}

// MARK: - Background refresh (BGAppRefreshTask)

/// Headless variant of DataStore.refresh for iOS background execution: fetch,
/// price, write the disk cache, exit. No UI state is touched — the app picks
/// the fresh cache up on its next launch, so opening the app shows current
/// numbers instantly instead of last week's.
enum BackgroundRefresher {
    static func run() async {
        let api = SupabaseAPI.shared
        if await !api.restoreSession() {
            guard (try? await api.signIn(
                email: SupabaseConfig.ownerEmail,
                password: SupabaseConfig.ownerPassword
            )) != nil else { return }
        }
        guard let blobs = try? await api.fetchAppData() else { return }

        let rates = (try? await api.fetchFxRates()) ?? [:]
        // Incremental on top of the cached histories, same as the foreground.
        let cached = DiskCache.load()
        func merged(_ type: String, _ current: [SnapshotPoint]) async -> [SnapshotPoint] {
            let fresh = (try? await api.fetchSnapshotsRaw(
                type: type, since: current.last?.date
            )) ?? []
            let known = Set(current.map(\.date))
            return (current + fresh.filter { !known.contains($0.date) })
                .sorted { $0.date < $1.date }
        }
        let history = await merged("networth", cached?.networthHistory ?? [])
        let portfolioHistory = await merged("portfolio", cached?.portfolioHistory ?? [])
        let cryptoHistory = await merged("crypto", cached?.cryptoHistory ?? [])

        func blobString(_ key: String) -> String? {
            guard let raw = blobs[key], let data = raw.data(using: .utf8) else { return nil }
            return try? JSONDecoder().decode(String.self, from: data)
        }
        let tags = blobs["crypto_stablecoin_tags"]
            .flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONDecoder().decode([String: Bool].self, from: $0) } ?? [:]
        let mappings = blobs["crypto_ticker_mappings"]
            .flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONDecoder().decode([String: String].self, from: $0) } ?? [:]
        let tokens = blobString("crypto_csv_text")
            .map(CryptoMath.parsePortfolioOverview)?
            .filter { !CryptoMath.isCashLike($0.token, tags: tags) }
            .map(\.token) ?? []
        let live = await api.fetchBinancePrices(tokens: tokens, mappings: mappings)

        DiskCache(
            version: DiskCache.currentVersion,
            blobs: blobs,
            networthHistory: history,
            portfolioHistory: portfolioHistory,
            cryptoHistory: cryptoHistory,
            fxRates: rates,
            livePrices: live,
            savedAt: Date().timeIntervalSince1970
        ).save()
    }
}
