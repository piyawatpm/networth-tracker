import Foundation
import Observation
import SwiftUI

/// The app's single source of truth, mirroring the web's DataProvider: load
/// every KV blob once, decode, expose typed collections; writes re-encode the
/// whole array back to its blob (the same convention the web app uses, so the
/// two clients can't corrupt each other's shape).
extension Notification.Name {
    /// Posted whenever a quick-add lands in Supabase — the store refreshes
    /// immediately instead of waiting for a staleness window.
    static let vestaDataDidChange = Notification.Name("vestaDataDidChange")
}

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
    /// value_with_super. v5: networth rows carry value_no_super +
    /// portfolio/crypto components for the overlay lines.
    static let currentVersion = 5

    var version: Int // decoding a versionless v1 cache fails → treated as empty
    var blobs: [String: String]
    var networthHistory: [SnapshotPoint]
    var portfolioHistory: [SnapshotPoint]
    var cryptoHistory: [SnapshotPoint]
    var fxRates: [String: Double]
    var livePrices: [String: Double]
    var savedAt: Double
    /// updated_at watermark for delta blob fetches. Optional so v5
    /// caches written before it existed still decode (nil → full fetch).
    var blobsSyncedAt: String?

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

/// The cached boot, fully prepared off the main actor: the cache itself plus
/// every parsed series derived from it. `bootstrap()` awaits this from a
/// detached task and then just assigns — the main thread never parses.
struct BootPayload: Sendable {
    let cache: DiskCache
    let networthParsed: [(date: Date, valueUsd: Double)]
    let networthParsedNoSuper: [(date: Date, valueUsd: Double)]
    let portfolioParsed: [(date: Date, valueUsd: Double)]
    let portfolioParsedWithSuper: [(date: Date, valueUsd: Double)]
    let cryptoParsed: [(date: Date, valueUsd: Double)]

    static func prepare() -> BootPayload? {
        guard let cache = DiskCache.load() else { return nil }
        return BootPayload(
            cache: cache,
            networthParsed: DataStore.parseRows(cache.networthHistory),
            networthParsedNoSuper: DataStore.parseRowsNoSuper(cache.networthHistory),
            portfolioParsed: DataStore.parseRows(cache.portfolioHistory),
            portfolioParsedWithSuper: DataStore.parseRows(cache.portfolioHistory, withSuper: true),
            cryptoParsed: DataStore.parseRows(cache.cryptoHistory)
        )
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
    /// Drives the Invest toolbar spinner while Hostplus prices are fetched.
    var isRefreshingHostplus = false
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
    /// token → exchange name, hand-set on the web crypto page.
    var exchangeOverrides: [String: String] = [:]
    /// Earn events the user manually removed ("this arrival wasn't income")
    /// — keys are CryptoSplit's date|token|amount, synced via app_data so
    /// they survive CSV re-uploads and reinstalls.
    private(set) var earnExclusions: Set<String> = []
    /// Option code → (yyyy-MM-dd → unit price), accumulated by the cron —
    /// the visible log of the daily Hostplus repricing.
    var hostplusPriceHistory: [String: [String: Double]] = [:]
    var goals: [NetworthGoal] = []
    /// Forecast levers, synced with the web (see Forecast.swift).
    var forecastAssumptions: ForecastAssumptions = .default
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
    /// Networth excluding super (value_no_super, falling back to value).
    private(set) var networthParsedNoSuper: [(date: Date, valueUsd: Double)] = []
    /// Daily component overlays for the dashboard chart (USD, last of day):
    /// portfolio (with super), the day's super delta (for the toggle),
    /// crypto, and the replayed signed debt net.
    private(set) var overlayPortfolio: [(date: Date, valueUsd: Double)] = []
    private(set) var overlaySuperDelta: [Date: Double] = [:]
    private(set) var overlayCrypto: [(date: Date, valueUsd: Double)] = []
    private(set) var overlayDebt: [(date: Date, valueUsd: Double)] = []
    /// Ex-super — the snapshot `value` column.
    private(set) var portfolioParsed: [(date: Date, valueUsd: Double)] = []
    /// Including super (falls back to ex-super where the column is null).
    private(set) var portfolioParsedWithSuper: [(date: Date, valueUsd: Double)] = []
    private(set) var cryptoParsed: [(date: Date, valueUsd: Double)] = []

    /// Live trade prices from the Alpaca socket, ticker → USD.
    var liveStockPrices: [String: Double] = [:]
    /// Invest-tab super toggle (persisted; net worth always includes super).
    var includeSuperStocks: Bool = Settings.defaults.object(forKey: "includeSuperStocks") as? Bool ?? true {
        didSet {
            Settings.defaults.set(includeSuperStocks, forKey: "includeSuperStocks")
            recomputeDerived()
        }
    }

    private let sockets = PriceSocketCenter()

    // MARK: Cached derivations
    //
    // These were computed properties, so they re-ran on EVERY view render —
    // and the dashboard alone reads allIncome three times (month flow, recent
    // activity, and inside freedom), each one re-sorting and replaying the
    // whole crypto CSV. With price sockets ticking ~12x/second that was dozens
    // of full replays per second. They are pure functions of the stored data,
    // so they're computed once per data change instead.
    private(set) var derivedRealizedIncome: [IncomeEntry] = []
    private(set) var allIncome: [IncomeEntry] = []
    private(set) var monthlyGrowth: [(label: String, deltaUsd: Double, partial: Bool)] = []
    private(set) var freedom: (passive: Double, expenses: Double, coverage: Double) = (0, 0, 0)
    /// Stocks overlay with the super delta already removed when the toggle is
    /// off — the dashboard was re-mapping 20k rows on every render to do this.
    private(set) var overlayStocksAdjusted: [(date: Date, valueUsd: Double)] = []

    /// Recompute everything cached above. Cheap relative to doing it per frame.
    func recomputeDerived() {
        derivedRealizedIncome = computeDerivedRealizedIncome()
        allIncome = income + derivedRealizedIncome
        monthlyGrowth = computeMonthlyGrowth()
        freedom = computeFreedom()
        overlayStocksAdjusted = overlayPortfolio.map { point in
            guard !includeSuperStocks, let delta = overlaySuperDelta[point.date] else { return point }
            return (point.date, max(0, point.valueUsd - delta))
        }
    }

    // MARK: Price-tick coalescing
    //
    // Binance/Gate/Alpaca push far faster than a screen needs to update, and
    // every mutation invalidates the whole view tree. Buffer and flush a few
    // times a second instead. @ObservationIgnored so the buffers themselves
    // don't trigger renders.
    @ObservationIgnored private var pendingCrypto: [String: Double] = [:]
    @ObservationIgnored private var pendingStocks: [String: Double] = [:]
    @ObservationIgnored private var flushTask: Task<Void, Never>?

    private func queuePrice(crypto token: String, _ price: Double) {
        pendingCrypto[token] = price
        schedulePriceFlush()
    }

    private func queuePrice(stock ticker: String, _ price: Double) {
        pendingStocks[ticker] = price
        schedulePriceFlush()
    }

    private func schedulePriceFlush() {
        guard flushTask == nil else { return }
        flushTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard let self else { return }
            self.flushTask = nil
            if !self.pendingCrypto.isEmpty {
                self.livePrices.merge(self.pendingCrypto) { _, new in new }
                self.pendingCrypto.removeAll()
            }
            if !self.pendingStocks.isEmpty {
                self.liveStockPrices.merge(self.pendingStocks) { _, new in new }
                self.pendingStocks.removeAll()
            }
        }
    }

    // Snapshot timestamps go through SnapshotDate, not DateFormatter — the
    // formatter trio this replaced cost ~60µs a row and put 9.2s of parsing
    // on the main thread at every cold launch. nonisolated so the boot path
    // can run it off the main actor; it's a pure function.
    nonisolated static func parseRows(
        _ rows: [SnapshotPoint], withSuper: Bool = false
    ) -> [(date: Date, valueUsd: Double)] {
        rows.compactMap { row in
            guard let date = SnapshotDate.parse(row.date) else { return nil }
            return (date, withSuper ? (row.valueWithSuper ?? row.value) : row.value)
        }
    }

    nonisolated static func parseRowsNoSuper(
        _ rows: [SnapshotPoint]
    ) -> [(date: Date, valueUsd: Double)] {
        rows.compactMap { row in
            guard let date = SnapshotDate.parse(row.date) else { return nil }
            return (date, row.valueNoSuper ?? row.value)
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
            networthParsedNoSuper = Self.parseRowsNoSuper(rows)
            rebuildOverlays()
        }
    }

    /// Component series at the SAME INTRADAY resolution as the net-worth
    /// series, so every line shares timestamps and buckets identically — a
    /// daily-only overlay had nothing to draw on the 1D view, which is why
    /// the legend used to vanish there. Debt only moves on logged
    /// transactions, so its daily replay is forward-filled onto each row.
    /// One cached day formatter — the old code allocated a fresh DateFormatter
    /// per debt PER DAY inside the replay loop, at ~1ms per allocation.
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = SydneyTime.zone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private func rebuildOverlays() {
        // Each debt's creation day, computed once for the whole replay.
        let createdDays = debts.map {
            Self.dayFormatter.string(from: Date(timeIntervalSince1970: $0.createdAt / 1000))
        }

        // Replay debt once per distinct day, not once per intraday row.
        var debtByDay: [String: Double] = [:]
        for row in networthHistory {
            let day = String(row.date.prefix(10))
            if debtByDay[day] == nil {
                debtByDay[day] = debtNetUsdAt(day: day, createdDays: createdDays)
            }
        }

        var portfolio: [(date: Date, valueUsd: Double)] = []
        var crypto: [(date: Date, valueUsd: Double)] = []
        var debt: [(date: Date, valueUsd: Double)] = []
        var superDelta: [Date: Double] = [:]

        for row in networthHistory {
            guard let date = SnapshotDate.parse(row.date) else { continue }
            if let p = row.portfolio { portfolio.append((date, p)) }
            if let c = row.crypto { crypto.append((date, c)) }
            if let noSuper = row.valueNoSuper { superDelta[date] = row.value - noSuper }
            if let d = debtByDay[String(row.date.prefix(10))] { debt.append((date, d)) }
        }

        overlayPortfolio = portfolio
        overlayCrypto = crypto
        overlayDebt = debt
        overlaySuperDelta = superDelta
    }

    /// Signed net debt (USD) as it stood at end of `day` — records created by
    /// then, transactions dated by then. Overpaid ledgers flip sides.
    /// `createdDays` aligns with `debts`, precomputed by the caller.
    private func debtNetUsdAt(day: String, createdDays: [String]) -> Double {
        var net = 0.0
        for (debt, createdDay) in zip(debts, createdDays) {
            guard createdDay <= day else { continue }
            let paid = debtTxs
                .filter { $0.debtId == debt.id && String($0.date.prefix(10)) <= day }
                .reduce(0) { $0 + $1.amount }
            let balance = debt.originalAmount - paid
            let signed = debt.direction == "owed_to_me" ? balance : -balance
            net += Money.convert(signed, from: debt.currency, to: "USD")
        }
        return net
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
    private var blobsSyncedAt: String?
    /// Coalesces overlapping refresh triggers (foreground + timer + intent
    /// signal can all fire together) into one network pass.
    private var refreshInFlight = false

    // MARK: Session

    func bootstrap() async {
        // 1. Paint from the disk cache — file read, 6MB JSON decode and all
        //    date parsing happen OFF the main actor, so the first frame is on
        //    screen while this works. The await suspends without blocking;
        //    the main actor only assigns the finished arrays.
        let prepared = await Perf.measureAsync("boot prepare (off-main)") {
            await Task.detached(priority: .userInitiated) { BootPayload.prepare() }.value
        }
        if let p = prepared {
            Perf.measure("boot apply (main)") {
                rawBlobs = p.cache.blobs
                blobsSyncedAt = p.cache.blobsSyncedAt
                if !p.cache.fxRates.isEmpty {
                    Money.rates = p.cache.fxRates
                    fxLoaded = true
                }
                livePrices = p.cache.livePrices
                lastRefreshed = p.cache.savedAt
                // decode FIRST: rebuildOverlays needs `debts`/`debtTxs`.
                decode(p.cache.blobs)
                networthHistory = p.cache.networthHistory
                networthParsed = p.networthParsed
                networthParsedNoSuper = p.networthParsedNoSuper
                portfolioHistory = p.cache.portfolioHistory
                portfolioParsed = p.portfolioParsed
                portfolioParsedWithSuper = p.portfolioParsedWithSuper
                cryptoHistory = p.cache.cryptoHistory
                cryptoParsed = p.cryptoParsed
                rebuildOverlays()
                recomputeDerived()
            }
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

        // Quick-adds (Action Button / Apple Pay automation) write to Supabase
        // directly — this signal pulls them into the UI the moment they land.
        NotificationCenter.default.addObserver(
            forName: .vestaDataDidChange, object: nil, queue: .main
        ) { _ in
            Task { @MainActor [weak self] in await self?.refresh() }
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
        guard isSignedIn, !refreshInFlight else { return }
        refreshInFlight = true
        defer { refreshInFlight = false }
        isLoading = rawBlobs.isEmpty // skeletons only when there's no cache
        loadError = nil
        do {
            // Delta fetch: only blobs whose updated_at moved since last sync.
            // First run (no watermark) pulls everything.
            async let blobsTask = api.fetchAppData(since: blobsSyncedAt)
            async let ratesTask = api.fetchFxRates()

            let (changed, stamp) = try await blobsTask
            blobsSyncedAt = stamp
            if !changed.isEmpty {
                rawBlobs.merge(changed) { _, new in new }
                decode(rawBlobs)
                rebuildOverlays()
            }

            if let rates = try? await ratesTask, !rates.isEmpty {
                Money.rates = rates
                fxLoaded = true
            }
            // First load pulls each pot's whole snapshot history (~20 pages);
            // afterwards only rows newer than what's cached — usually 1 page.
            await mergeHistory("networth")
            await mergeHistory("portfolio")
            await mergeHistory("crypto")
            recomputeDerived()

            // Live prices for whatever the holdings CSV says we own.
            let tokens = cryptoCsvHoldings
                .filter { !CryptoMath.isCashLike($0.token, tags: stablecoinTags) }
                .map(\.token)
            let live = await api.fetchBinancePrices(tokens: tokens, mappings: tickerMappings)
            if !live.isEmpty { livePrices = live }

            // Symbol set may have changed (new coin, new holding) — resubscribe.
            startLive()

            lastRefreshed = Date().timeIntervalSince1970
            // Encode+write off-main: serializing 6MB of JSON on the main
            // actor after every refresh was a visible hitch. The struct is a
            // value copy, so the store can keep mutating while it writes.
            let snapshot = DiskCache(
                version: DiskCache.currentVersion,
                blobs: rawBlobs,
                networthHistory: networthHistory,
                portfolioHistory: portfolioHistory,
                cryptoHistory: cryptoHistory,
                fxRates: Money.rates,
                livePrices: livePrices,
                savedAt: lastRefreshed,
                blobsSyncedAt: blobsSyncedAt
            )
            Task.detached(priority: .utility) { snapshot.save() }
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    /// Manually pull the latest Hostplus super unit price and reprice the
    /// holding as units × price (calibrating units once — see HostplusAPI). iOS
    /// reads holdings from the `portfolio_holdings` blob, so we reprice locally
    /// and write the blob back to Supabase, keeping web / cron / mobile in sync.
    /// The daily cron does this automatically; this is the on-demand button.
    func refreshHostplus() async {
        guard isSignedIn, !isRefreshingHostplus else { return }
        let targets = holdings.enumerated().filter {
            HostplusAPI.optionNameByTicker[$0.element.ticker.uppercased()] != nil
                && $0.element.units > 0
        }
        guard !targets.isEmpty else { return }

        isRefreshingHostplus = true
        defer { isRefreshingHostplus = false }
        do {
            let prices = try await HostplusAPI.latestPrices()
            var changed = false
            for (idx, holding) in targets {
                guard let name = HostplusAPI.optionNameByTicker[holding.ticker.uppercased()],
                      let price = prices[name], price > 0 else { continue }
                let r = HostplusAPI.reprice(
                    units: holding.units,
                    currentValue: holding.currentValue,
                    price: price
                )
                if abs(r.currentValue - holding.currentValue) > 0.01
                    || abs(r.units - holding.units) > 1e-6 {
                    holdings[idx].units = r.units
                    holdings[idx].currentValue = r.currentValue
                    holdings[idx].currency = "AUD"
                    changed = true
                }
            }
            guard changed else { return }
            let encoded = try JSONEncoder().encode(holdings)
            let value = String(decoding: encoded, as: UTF8.self)
            try await api.writeAppData(key: "portfolio_holdings", value: value)
            rawBlobs["portfolio_holdings"] = value
            recomputeDerived()
        } catch {
            loadError = error.localizedDescription
        }
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
        exchangeOverrides = blob("crypto_exchange_overrides", [String: String].self) ?? [:]
        earnExclusions = Set(blob("earn_exclusions", [String].self) ?? [])
        hostplusPriceHistory = blob("hostplus_price_history", [String: [String: Double]].self) ?? [:]
        goals = blob("networth_goals", [NetworthGoal].self) ?? []
        forecastAssumptions = blob("forecast_assumptions", ForecastAssumptions.self) ?? .default
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
        recomputeDerived()
        try await persist("income_entries", income)
    }

    func deleteIncome(_ id: String) async throws {
        income.removeAll { $0.id == id }
        recomputeDerived()
        try await persist("income_entries", income)
    }

    func saveExpense(_ entry: ExpenseEntry) async throws {
        if let index = expenses.firstIndex(where: { $0.id == entry.id }) {
            expenses[index] = entry
        } else {
            expenses.append(entry)
        }
        recomputeDerived()
        try await persist("expense_entries", expenses)
    }

    func deleteExpense(_ id: String) async throws {
        expenses.removeAll { $0.id == id }
        recomputeDerived()
        try await persist("expense_entries", expenses)
    }

    func savePortfolioTx(_ tx: PortfolioTransaction) async throws {
        let before = PortfolioMath.derivePosition(
            portfolioTxs.filter { $0.holdingId == tx.holdingId }
        )
        portfolioTxs.append(tx)

        // Reconcile the holding exactly like the web page does: units and
        // cost move by the replay delta, keeping any baseline the log doesn't
        // explain, and value rescales at the last-known price per unit. This
        // matters most for super — its balance is units × price (cron), so a
        // buy that doesn't grow units would be erased by the next reprice and
        // the contribution would read as an instant loss on the perf page.
        if let index = holdings.firstIndex(where: { $0.id == tx.holdingId }) {
            let after = PortfolioMath.derivePosition(
                portfolioTxs.filter { $0.holdingId == tx.holdingId }
            )
            var holding = holdings[index]
            let baseUnits = holding.units - before.units
            let baseCost = holding.amountInvested - before.costBasis
            let pricePerUnit = holding.units > 1e-9
                ? holding.currentValue / holding.units : 0

            var units = baseUnits + after.units
            var amountInvested = baseCost + after.costBasis
            if abs(units) < 1e-9 { units = 0 }
            if amountInvested < 1e-9 { amountInvested = 0 }

            holding.units = units
            holding.amountInvested = amountInvested
            holding.currentValue = units == 0
                ? 0
                : (pricePerUnit > 0 ? pricePerUnit * units : holding.currentValue)
            holdings[index] = holding
            try await persist("portfolio_holdings", holdings)
        }

        recomputeDerived()
        try await persist("portfolio_transactions", portfolioTxs)
    }

    /// Upsert a net-worth goal — same blob the web's GoalSection edits.
    func saveGoal(_ goal: NetworthGoal) async throws {
        if let index = goals.firstIndex(where: { $0.id == goal.id }) {
            goals[index] = goal
        } else {
            goals.append(goal)
        }
        try await persist("networth_goals", goals)
    }

    /// Forecast levers; local flip first so the page answers instantly.
    func saveForecastAssumptions(_ next: ForecastAssumptions) async {
        forecastAssumptions = next
        do { try await persist("forecast_assumptions", next) }
        catch { loadError = error.localizedDescription }
    }

    /// Flip one earn event in or out of the excluded set and persist. Errors
    /// surface via loadError but the local flip stays — the list re-syncs on
    /// the next refresh either way.
    func setEarnExcluded(_ key: String, _ excluded: Bool) async {
        if excluded { earnExclusions.insert(key) } else { earnExclusions.remove(key) }
        do {
            try await persist("earn_exclusions", earnExclusions.sorted())
        } catch {
            loadError = error.localizedDescription
        }
    }

    func saveDebt(_ debt: DebtRecord) async throws {
        if let index = debts.firstIndex(where: { $0.id == debt.id }) {
            debts[index] = debt
        } else {
            debts.append(debt)
        }
        recomputeDerived()
        try await persist("debt_records", debts)
    }

    /// Removes the record AND its ledger — orphan transactions would silently
    /// distort net worth forever.
    func deleteDebt(_ id: String) async throws {
        debts.removeAll { $0.id == id }
        debtTxs.removeAll { $0.debtId == id }
        recomputeDerived()
        try await persist("debt_records", debts)
        recomputeDerived()
        try await persist("debt_transactions", debtTxs)
    }

    func saveDebtTx(_ tx: DebtTransaction) async throws {
        debtTxs.append(tx)
        recomputeDerived()
        try await persist("debt_transactions", debtTxs)
    }

    func deleteDebtTx(_ id: String) async throws {
        debtTxs.removeAll { $0.id == id }
        recomputeDerived()
        try await persist("debt_transactions", debtTxs)
    }

    /// Display currency, synced through the same `preferred_currency` blob the
    /// web reads — switch on the phone and the website follows.
    func setDisplayCurrency(_ code: String) {
        displayCurrency = code
        recomputeDerived() // `freedom` is denominated in the display currency
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

    // The stacked category charts key on the human LABEL (that's what the
    // legend shows), so they need the reverse lookup to land on the same hue
    // the donut and the ranked bars already use — one entity, one colour.

    func incomeColorForLabel(_ label: String) -> Color {
        guard let type = incomeTypeForLabel(label) else { return Ledger.hashedColor(label) }
        return incomeColor(type)
    }

    func expenseColorForLabel(_ label: String) -> Color {
        guard let type = expenseTypeForLabel(label) else { return Ledger.hashedColor(label) }
        return expenseColor(type)
    }

    private func incomeTypeForLabel(_ label: String) -> String? {
        Categories.incomeLabels.first { $0.label == label }?.id
            ?? customIncomeCategories.first { $0.label == label }?.id
    }

    private func expenseTypeForLabel(_ label: String) -> String? {
        Categories.expenseLabels.first { $0.label == label }?.id
            ?? customExpenseCategories.first { $0.label == label }?.id
    }

    // MARK: Derived — realized income (parity with the web income page)

    private func computeDerivedRealizedIncome() -> [IncomeEntry] {
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
                Task { @MainActor [weak self] in self?.queuePrice(crypto: token, price) }
            },
            onStock: { ticker, price in
                Task { @MainActor [weak self] in self?.queuePrice(stock: ticker, price) }
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

    /// Honors the app-wide super toggle — dashboard, goal and chart all agree.
    var netWorth: Double { stocksValueVisible + cryptoValue + debtNet }

    /// Month-over-month net-worth CHANGE, USD, oldest first. The last entry
    /// is the current (partial) month, flagged so the UI can say so.
    private func computeMonthlyGrowth() -> [(label: String, deltaUsd: Double, partial: Bool)] {
        var firstPerMonth: [String: SnapshotPoint] = [:]
        for row in networthHistory {
            let month = String(row.date.prefix(7))
            if firstPerMonth[month] == nil { firstPerMonth[month] = row }
        }
        let months = firstPerMonth.keys.sorted().suffix(13)
        guard months.count >= 2 else { return [] }

        func value(_ row: SnapshotPoint) -> Double {
            includeSuperStocks ? row.value : (row.valueNoSuper ?? row.value)
        }
        let labeler = DateFormatter()
        labeler.locale = Locale(identifier: "en_US_POSIX")
        labeler.dateFormat = "MMM"

        var out: [(String, Double, Bool)] = []
        let list = Array(months)
        for index in 1..<list.count {
            guard let prev = firstPerMonth[list[index - 1]],
                  let curr = firstPerMonth[list[index]] else { continue }
            // The delta BELONGS to the month that produced it (prev month).
            let parts = list[index - 1].split(separator: "-")
            var label = list[index - 1]
            if parts.count == 2, let m = Int(parts[1]),
               let date = DateComponents(calendar: .current, year: Int(parts[0]), month: m).date {
                label = labeler.string(from: date)
            }
            out.append((label, value(curr) - value(prev), false))
        }
        // Current month so far: its opening reading vs live net worth.
        if let lastMonth = list.last, let opening = firstPerMonth[lastMonth] {
            let parts = lastMonth.split(separator: "-")
            var label = lastMonth
            if parts.count == 2, let m = Int(parts[1]),
               let date = DateComponents(calendar: .current, year: Int(parts[0]), month: m).date {
                label = labeler.string(from: date)
            }
            let live = Money.convert(netWorth, from: displayCurrency, to: "USD")
            out.append((label, live - value(opening), true))
        }
        return out
    }

    /// Average daily net-worth change (USD) over the trailing window — the
    /// pace behind the goal projection. Nil when history is too short.
    func dailyGrowthUsd(days: Int = 90) -> Double? {
        let series = includeSuperStocks ? networthParsed : networthParsedNoSuper
        guard let last = series.last else { return nil }
        let cutoff = last.date.addingTimeInterval(-Double(days) * 86400)
        guard let first = series.first(where: { $0.date >= cutoff }) else { return nil }
        let span = last.date.timeIntervalSince(first.date) / 86400
        guard span >= 7 else { return nil } // a week is the floor for a trend
        let live = Money.convert(netWorth, from: displayCurrency, to: "USD")
        return (live - first.valueUsd) / span
    }

    /// Passive income vs expenses over the trailing 30 days, in display
    /// currency — "how much of my burn is already covered without working".
    private func computeFreedom() -> (passive: Double, expenses: Double, coverage: Double) {
        let cutoff = Calendar.current.date(byAdding: .day, value: -30, to: Date())
            .map { date -> String in
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_US_POSIX")
                f.timeZone = SydneyTime.zone
                f.dateFormat = "yyyy-MM-dd"
                return f.string(from: date)
            } ?? ""

        let passiveTypes: Set<String> = [
            "dividend", "crypto_yield", "interest", "rental",
            "realized_stocks", "realized_crypto",
        ]
        let passive = allIncome
            .filter { $0.date >= cutoff }
            .filter { $0.isPassive == true || passiveTypes.contains($0.type) }
            .reduce(0.0) { $0 + convert($1.amount, from: $1.currency) }
        let spend = expenses
            .filter { $0.date >= cutoff }
            .reduce(0.0) { $0 + convert($1.amount, from: $1.currency) }
        return (passive, spend, spend > 0 ? passive / spend : 0)
    }

    /// Net worth at the START of each month (first snapshot reading), USD,
    /// plus a live "now" sample — the month-over-month trend card.
    var monthStartNetWorth: [(label: String, valueUsd: Double, isNow: Bool)] {
        var firstPerMonth: [String: SnapshotPoint] = [:]
        for row in networthHistory {
            let month = String(row.date.prefix(7))
            if firstPerMonth[month] == nil { firstPerMonth[month] = row } // rows are ascending
        }
        let labeler = DateFormatter()
        labeler.locale = Locale(identifier: "en_US_POSIX")
        labeler.dateFormat = "MMM"
        var out: [(String, Double, Bool)] = []
        for month in firstPerMonth.keys.sorted().suffix(11) {
            guard let row = firstPerMonth[month] else { continue }
            let value = includeSuperStocks ? row.value : (row.valueNoSuper ?? row.value)
            let parts = month.split(separator: "-")
            var label = month
            if parts.count == 2, let m = Int(parts[1]) {
                labeler.dateFormat = "MMM"
                let comps = DateComponents(calendar: .current, year: Int(parts[0]), month: m)
                if let date = comps.date { label = labeler.string(from: date) }
            }
            out.append((label, value, false))
        }
        out.append(("Now", Money.convert(netWorth, from: displayCurrency, to: "USD"), true))
        return out
    }

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
        let cached = DiskCache.load()
        guard let (changed, stamp) = try? await api.fetchAppData(
            since: cached?.blobsSyncedAt
        ) else { return }
        var blobs = cached?.blobs ?? [:]
        blobs.merge(changed) { _, new in new }

        let rates = (try? await api.fetchFxRates()) ?? [:]
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
            savedAt: Date().timeIntervalSince1970,
            blobsSyncedAt: stamp
        ).save()
    }
}
