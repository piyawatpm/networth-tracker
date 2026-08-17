import SwiftUI
import Charts

/// Everywhere the More tab can push to.
///
/// Value-based rather than view-based links on purpose: a `[MoreRoute]` path
/// is what makes "pop to root" a one-liner. View-based NavigationLinks don't
/// appear in the stack's path, so there'd be nothing to clear.
enum MoreRoute: Hashable {
    case debts
    case performance
    case diagnostics
    case tapLog
    case debtDetail(String)
    case botIncome
    case coinPnl
    case ask
    case forecast
}

struct MoreView: View {
    @Environment(DataStore.self) private var store
    @Environment(\.tabReselect) private var reselect
    @State private var showSettings = false
    @State private var showWeb = false
    @State private var webPath = "/dashboard"
    // Screenshot/UI runs can open straight onto a pushed page.
    @State private var path: [MoreRoute] =
        switch ProcessInfo.processInfo.environment["VESTA_MORE_ROUTE"] {
        case "debts": [.debts]
        case "performance": [.performance]
        case "coinpnl": [.performance, .coinPnl]
        case "earn": [.performance, .botIncome]
        case "forecast": [.forecast]
        default: []
        }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section("Money") {
                    NavigationLink(value: MoreRoute.debts) {
                        Label("Debts", systemImage: "person.2")
                    }
                    NavigationLink(value: MoreRoute.performance) {
                        Label("Performance", systemImage: "chart.xyaxis.line")
                    }
                    NavigationLink(value: MoreRoute.ask) {
                        Label("Ask your money", systemImage: "sparkles")
                    }
                    NavigationLink(value: MoreRoute.forecast) {
                        Label("Forecast & goals", systemImage: "flag.checkered")
                    }
                }

                // The pages not yet rebuilt natively open the deployed web app
                // in-place — full parity beats a missing screen.
                Section("On the web") {
                    webLink("Budget", path: "/budget", icon: "chart.pie")
                    webLink("Emergency Fund", path: "/emergency-fund", icon: "shield")
                    webLink("Full Performance", path: "/performance", icon: "waveform.path.ecg")
                    webLink("Settings & Backup", path: "/settings", icon: "externaldrive")
                }

                Section("App") {
                    Button {
                        showSettings = true
                    } label: {
                        Label("Action Button & server", systemImage: "bolt.circle")
                    }
                    NavigationLink(value: MoreRoute.diagnostics) {
                        HStack {
                            Label("Quick-add diagnostics", systemImage: "stethoscope")
                            if BuildExpiry.isExpiringSoon {
                                Spacer()
                                // The one problem that breaks quick-add on a
                                // timer rather than at random.
                                Text("expiring")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Ledger.expense)
                            }
                        }
                    }
                    NavigationLink(value: MoreRoute.tapLog) {
                        Label("Card tap log", systemImage: "waveform.path.ecg")
                    }
                    Button(role: .destructive) {
                        Task { await store.signOut() }
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }

                Section {
                    Color.clear.frame(height: 90)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Ledger.background)
            .navigationTitle("More")
            // Declared once at the root — it covers every push in the stack,
            // including DebtsView's own links.
            .navigationDestination(for: MoreRoute.self) { route in
                switch route {
                case .debts: DebtsView()
                case .performance: PerformanceLiteView()
                case .diagnostics: QuickAddDiagnosticsView()
                case .tapLog: TapLogView()
                case .debtDetail(let id): DebtDetailView(debtId: id)
                case .botIncome: BotIncomeView()
                case .coinPnl: CoinPnlView()
                case .ask: AskMoneyView()
                case .forecast: ForecastView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { FxChip() }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .sheet(isPresented: $showWeb) { WebSheet(path: webPath) }
        }
        // Tapping More while already on More means "back to the top" — the
        // system gesture. Switching away and back still restores where you
        // were, which is why the path isn't cleared on tab change.
        .onChange(of: reselect) { _, new in
            guard new.tab == VestaTabIndex.more, !path.isEmpty else { return }
            withAnimation(.snappy(duration: 0.3)) { path.removeAll() }
        }
    }

    private func webLink(_ title: String, path: String, icon: String) -> some View {
        Button {
            webPath = path
            showWeb = true
        } label: {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                Image(systemName: "arrow.up.forward.square")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .tint(.primary)
    }
}

/// The deployed web app in a sheet, for pages not yet ported.
struct WebSheet: View {
    @Environment(\.dismiss) private var dismiss
    let path: String
    @State private var loadState: WebLoadState = .loading

    var body: some View {
        NavigationStack {
            ZStack {
                Color(uiColor: .vestaBackground).ignoresSafeArea()
                WebView(
                    url: (Settings.endpointBase ?? URL(string: Settings.productionURL)!)
                        .appendingPathComponent(String(path.dropFirst())),
                    loadState: $loadState
                )
                .ignoresSafeArea(edges: .bottom)
                if case .loading = loadState { ProgressView() }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Debts

/// Signed net from my perspective — sign classification, never the stored
/// direction, so an overpaid ledger flips sides instead of freezing at zero.
func debtNet(_ debt: DebtRecord, _ txs: [DebtTransaction]) -> Double {
    let paid = txs.filter { $0.debtId == debt.id }.reduce(0) { $0 + $1.amount }
    let balance = debt.originalAmount - paid
    return debt.direction == "owed_to_me" ? balance : -balance
}

struct DebtsView: View {
    @Environment(DataStore.self) private var store
    @State private var addingDebt = false
    @State private var search = ""

    private struct Row: Identifiable {
        let debt: DebtRecord
        let net: Double // signed, + = they owe me (debt's own currency)
        var id: String { debt.id }
    }

    private var rows: [Row] {
        store.debts
            .map { Row(debt: $0, net: debtNet($0, store.debtTxs)) }
            .sorted { abs($0.net) > abs($1.net) }
    }

    /// Person, reason, currency — and dates, matched against the debt's own
    /// creation day plus every repayment on it, so "aug" finds a ledger you
    /// paid into in August.
    private var visibleRows: [Row] {
        guard !search.isEmpty else { return rows }
        return rows.filter { row in
            let created = SydneyTime.dayString(
                Date(timeIntervalSince1970: row.debt.createdAt / 1000)
            )
            let fields = [row.debt.person, row.debt.reason, row.debt.notes, row.debt.currency]
            if FlowMath.matches(query: search, fields: fields, date: created) { return true }
            return store.debtTxs
                .filter { $0.debtId == row.debt.id }
                .contains { FlowMath.matches(query: search, fields: [$0.notes], date: $0.date) }
        }
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: 0) {
                    tile("They owe me", rows.filter { $0.net > 0 }
                        .reduce(0) { $0 + store.convert($1.net, from: $1.debt.currency) }, Ledger.income)
                    Divider().padding(.vertical, 6)
                    tile("I owe", rows.filter { $0.net < 0 }
                        .reduce(0) { $0 + store.convert(-$1.net, from: $1.debt.currency) }, Ledger.expense)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .padding(.vertical, 12)
                .financeCard()
            }

            // Are the balances actually coming down? The tiles above are a
            // snapshot; this is the only view that answers the trend.
            let history = DebtHistory.series(
                debts: store.debts, txs: store.debtTxs, months: 6
            )
            if history.count >= 2 {
                Section {
                    DebtTrendCard(
                        points: history,
                        convert: { store.convert($0, from: "USD") },
                        format: { store.format($0, compact: true) }
                    )
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }

            // Repayment activity per month — the trend shows the balance,
            // this shows the effort behind it.
            let repayments = FlowMath.flows(
                store.debtTxs.compactMap { tx -> (date: String, value: Double)? in
                    guard tx.amount > 0,
                          let debt = store.debts.first(where: { $0.id == tx.debtId })
                    else { return nil }
                    return (tx.date, store.convert(tx.amount, from: debt.currency))
                },
                months: 6
            )
            if repayments.filter({ $0.total > 0.01 }).count >= 2 {
                Section {
                    MonthTrendCard(
                        title: "Repayments · 6 months",
                        flows: repayments,
                        tint: Ledger.seriesDebt,
                        format: { store.format($0, compact: true) }
                    )
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }

            Section {
                ForEach(visibleRows) { row in
                    NavigationLink(value: MoreRoute.debtDetail(row.debt.id)) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.debt.person).font(.subheadline.weight(.medium))
                                if !row.debt.reason.isEmpty {
                                    Text(row.debt.reason)
                                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer()
                            if abs(row.net) < 0.005 {
                                Text("settled")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            } else {
                                Text(Money.format(abs(row.net), currency: row.debt.currency))
                                    .font(.system(.footnote, design: .monospaced, weight: .medium))
                                    .foregroundStyle(row.net > 0 ? Ledger.income : Ledger.expense)
                            }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            Task { try? await store.deleteDebt(row.debt.id) }
                        }
                    }
                }
            }

                Section {
                    Color.clear.frame(height: 90)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
        }
        .scrollContentBackground(.hidden)
        .background(Ledger.background)
        .searchable(text: $search, prompt: "Search people or a date")
        .navigationTitle("Debts")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                FxChip()
                Button { addingDebt = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $addingDebt) { DebtForm() }
    }

    private func tile(_ label: String, _ value: Double, _ tint: Color) -> some View {
        VStack(spacing: 4) {
            Text(label).labelMono()
            Text(store.format(value, compact: true))
                .font(.system(.body, design: .rounded, weight: .semibold))
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity)
    }
}

/// One debt's ledger: balance, repayment progress, transaction history, and
/// the record-repayment / borrowed-more actions.
struct DebtDetailView: View {
    @Environment(DataStore.self) private var store
    let debtId: String
    @State private var txKind: DebtTxForm.Kind?
    @State private var editingDebt = false

    private var debt: DebtRecord? { store.debts.first { $0.id == debtId } }
    private var transactions: [DebtTransaction] {
        store.debtTxs
            .filter { $0.debtId == debtId }
            .sorted { $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt }
    }

    var body: some View {
        if let debt {
            let net = debtNet(debt, store.debtTxs)
            let owedToMe = net > 0
            let repaid = debt.direction == "owed_to_me"
                ? debt.originalAmount - net : debt.originalAmount + net
            let progress = debt.originalAmount > 0
                ? min(1, max(0, repaid / debt.originalAmount)) : 1

            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 10) {
                        Text(abs(net) < 0.005
                            ? "Settled"
                            : owedToMe ? "\(debt.person) owes you" : "You owe \(debt.person)")
                            .labelMono()
                        MoneyText(
                            amount: abs(net),
                            currency: debt.currency,
                            tint: abs(net) < 0.005 ? .secondary : (owedToMe ? Ledger.income : Ledger.expense)
                        )
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(.primary.opacity(0.07))
                                Capsule()
                                    .fill(owedToMe ? Ledger.income : Ledger.expense)
                                    .frame(width: max(4, geo.size.width * progress))
                                    .animation(.spring(duration: 0.6), value: progress)
                            }
                        }
                        .frame(height: 6)
                        Text("\(Money.format(repaid, currency: debt.currency, compact: true)) of \(Money.format(debt.originalAmount, currency: debt.currency, compact: true)) repaid")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(18)
                    .financeCard()

                    HStack(spacing: 10) {
                        Button {
                            txKind = .repayment
                        } label: {
                            Label("Repayment", systemImage: "arrow.down.circle.fill")
                        }
                        .buttonStyle(VoltButtonStyle())

                        Button {
                            txKind = .borrowedMore
                        } label: {
                            Label("Borrowed more", systemImage: "arrow.up.circle")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                        }
                        .buttonStyle(.bordered)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("History").labelMono()
                        if transactions.isEmpty {
                            Text("No repayments logged yet.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(transactions) { tx in
                            HStack {
                                Image(systemName: tx.amount >= 0
                                    ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                                    .foregroundStyle(tx.amount >= 0 ? Ledger.income : Ledger.expense)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(tx.amount >= 0 ? "Repayment" : "Borrowed more")
                                        .font(.subheadline)
                                    Text("\(SydneyTime.shortLabel(tx.date))\(tx.notes.isEmpty ? "" : " · \(tx.notes)")")
                                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                                Text(Money.format(abs(tx.amount), currency: debt.currency))
                                    .font(.system(.footnote, design: .monospaced))
                            }
                            .contextMenu {
                                Button("Delete", systemImage: "trash", role: .destructive) {
                                    Task { try? await store.deleteDebtTx(tx.id) }
                                }
                            }
                        }
                    }
                    .padding(16)
                    .financeCard()
                }
                .padding(16)
                .padding(.bottom, 110)
            }
            .background(Ledger.background)
            .navigationTitle(debt.person)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { editingDebt = true }
                }
            }
            .sheet(item: $txKind) { kind in
                DebtTxForm(debt: debt, kind: kind)
            }
            .sheet(isPresented: $editingDebt) {
                DebtForm(editing: debt)
            }
        } else {
            // Deleted out from under us — nothing to show.
            Text("Debt removed").foregroundStyle(.secondary)
        }
    }
}

struct DebtForm: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var editing: DebtRecord?

    @State private var person = ""
    @State private var direction = "owed_to_me"
    @State private var reason = ""
    @State private var amount = ""
    @State private var currency = "AUD"
    @State private var notes = ""
    @State private var saving = false
    @State private var error: String?

    private var parsedAmount: Double? {
        let value = Double(amount.replacingOccurrences(of: ",", with: ""))
        return (value ?? 0) > 0 ? value : nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Direction", selection: $direction) {
                    Text("They owe me").tag("owed_to_me")
                    Text("I owe them").tag("i_owe")
                }
                .pickerStyle(.segmented)

                TextField("Person", text: $person)
                HStack {
                    TextField("Original amount", text: $amount)
                        .keyboardType(.decimalPad)
                    Picker("", selection: $currency) {
                        ForEach(["AUD", "USD", "THB"], id: \.self) { Text($0) }
                    }
                    .labelsHidden()
                    .frame(width: 90)
                }
                TextField("Reason", text: $reason)
                TextField("Notes", text: $notes, axis: .vertical)

                if let error {
                    Text(error).font(.footnote).foregroundStyle(Ledger.expense)
                }
            }
            .navigationTitle(editing == nil ? "New Debt" : "Edit Debt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(person.isEmpty || parsedAmount == nil || saving)
                }
            }
            .onAppear {
                if let editing {
                    person = editing.person
                    direction = editing.direction
                    reason = editing.reason
                    amount = String(editing.originalAmount)
                    currency = editing.currency
                    notes = editing.notes
                }
            }
        }
    }

    private func save() async {
        guard let value = parsedAmount else { return }
        saving = true
        do {
            var debt = editing ?? DebtRecord(
                person: person, direction: direction, originalAmount: value, currency: currency
            )
            debt.person = person
            debt.direction = direction
            debt.reason = reason
            debt.originalAmount = value
            debt.currency = currency
            debt.notes = notes
            try await store.saveDebt(debt)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

struct DebtTxForm: View {
    enum Kind: String, Identifiable {
        case repayment, borrowedMore
        var id: String { rawValue }
    }

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let debt: DebtRecord
    let kind: Kind

    @State private var amount = ""
    @State private var date = Date()
    @State private var notes = ""
    @State private var saving = false
    @State private var error: String?

    private var parsedAmount: Double? {
        let value = Double(amount.replacingOccurrences(of: ",", with: ""))
        return (value ?? 0) > 0 ? value : nil
    }

    var body: some View {
        NavigationStack {
            Form {
                HStack {
                    Text(Money.symbol(debt.currency))
                        .font(.system(size: 26, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                    TextField("0.00", text: $amount)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 30, weight: .semibold, design: .rounded))
                }
                DatePicker("Date", selection: $date, displayedComponents: .date)
                TextField("Notes", text: $notes)
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Ledger.expense)
                }
            }
            .navigationTitle(kind == .repayment ? "Record Repayment" : "Borrowed More")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(parsedAmount == nil || saving)
                }
            }
        }
    }

    private func save() async {
        guard let value = parsedAmount else { return }
        saving = true
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = SydneyTime.zone
        formatter.dateFormat = "yyyy-MM-dd"
        do {
            // Positive reduces the loan, negative grows it — the signed-net
            // convention every other surface (web, cron) already uses.
            try await store.saveDebtTx(DebtTransaction(
                debtId: debt.id,
                amount: kind == .repayment ? value : -value,
                date: formatter.string(from: date),
                notes: notes
            ))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// MARK: - Performance (lite)

/// Value vs contributions + XIRR — the daily-glance subset. TWR, benchmarks
/// and the DCA table stay on the web page until ported.
struct PerformanceLiteView: View {
    @Environment(DataStore.self) private var store
    @State private var series: [SnapshotPoint] = []
    // Screenshot runs can open a specific series tab.
    @State private var kind = ProcessInfo.processInfo.environment["VESTA_PERF_KIND"] ?? "networth"
    /// Super stays OUT of the net-worth comparison by default: the Hostplus
    /// contributions are only partially logged, so with super in, unlogged
    /// deposits read as growth (the known +contamination). The toggle exists
    /// for the "whole picture anyway" look.
    // Env override so simulator test runs can open straight onto super-IN.
    @State private var includeSuper =
        ProcessInfo.processInfo.environment["VESTA_PERF_SUPER"] == "1"

    private var stockValues: [(date: String, value: Double)] {
        DcaCompare.dailyValues(store.portfolioParsed)
    }

    private var cryptoPot: [(date: String, value: Double)] {
        DcaCompare.cryptoPotValues(
            DcaCompare.dailyValues(store.cryptoParsed),
            txs: store.cryptoTxs,
            isCash: { CryptoMath.isCashLike($0, tags: store.stablecoinTags) }
        )
    }

    private var cryptoFlows: [(date: String, value: Double)] {
        DcaCompare.cryptoFlowsByDay(
            store.cryptoTxs,
            isCash: { CryptoMath.isCashLike($0, tags: store.stablecoinTags) }
        )
    }

    /// Stock flows scoped to what the chosen value series tracks. Ghost flows
    /// of deleted holdings are always excluded (three duplicate A$4,300
    /// Hostplus entries live in the log); super holdings' flows join only
    /// when the values include super.
    private func stockFlows(includeSuper: Bool) -> [(date: String, value: Double)] {
        let superIds = Set(store.holdings.filter { $0.accountType == "super" }.map(\.id))
        let knownIds = Set(store.holdings.map(\.id))
        return DcaCompare.flowsByDay(
            store.portfolioTxs.filter {
                knownIds.contains($0.holdingId)
                    && (includeSuper || !superIds.contains($0.holdingId))
            }
        )
    }

    private var stockCompareFlows: [(date: String, value: Double)] {
        stockFlows(includeSuper: false)
    }

    /// Earliest honest opening per scope; net worth needs both pots past
    /// their own clamp.
    private func stocksStart(includeSuper: Bool) -> String? {
        DcaCompare.clampedStart(
            values: includeSuper
                ? DcaCompare.dailyValues(store.portfolioParsedWithSuper)
                : stockValues,
            flows: stockFlows(includeSuper: includeSuper)
        )
    }

    private var cryptoStart: String? {
        DcaCompare.clampedStart(values: cryptoPot, flows: cryptoFlows)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Picker("Series", selection: $kind) {
                    Text("Net Worth").tag("networth")
                    Text("Stocks").tag("portfolio")
                    Text("Crypto").tag("crypto")
                }
                .pickerStyle(.segmented)

                // Growth of the same dollar vs a benchmark — see PerfCompare.
                // Net Worth = both investment pots as one, benchmark toggleable.
                if kind == "networth", let stockStart = stocksStart(includeSuper: includeSuper),
                   let cryptoStart {
                    PerfCompareCard(
                        allStart: max(stockStart, cryptoStart),
                        benchmarks: [.sp500, .btc],
                        values: DcaCompare.combinedDaily(
                            includeSuper
                                ? DcaCompare.dailyValues(store.portfolioParsedWithSuper)
                                : stockValues,
                            cryptoPot
                        ),
                        flows: DcaCompare.mergedFlows(
                            stockFlows(includeSuper: includeSuper), cryptoFlows
                        ),
                        footnote: includeSuper
                            ? "super marks lag deposits by days — short wiggles self-correct"
                            : nil,
                        maskSettling: true
                    )

                    Toggle(isOn: $includeSuper.animation(.snappy(duration: 0.25))) {
                        Text("Include super")
                            .font(.subheadline)
                    }
                    .tint(Ledger.income)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .financeCard()
                }
                if kind == "portfolio", let stockStart = stocksStart(includeSuper: includeSuper) {
                    PerfCompareCard(
                        allStart: stockStart,
                        benchmarks: [.sp500],
                        values: includeSuper
                            ? DcaCompare.dailyValues(store.portfolioParsedWithSuper)
                            : stockValues,
                        flows: stockFlows(includeSuper: includeSuper),
                        footnote: includeSuper
                            ? "super marks lag deposits by days — short wiggles self-correct"
                            : nil,
                        maskSettling: true
                    )

                    Toggle(isOn: $includeSuper.animation(.snappy(duration: 0.25))) {
                        Text("Include super")
                            .font(.subheadline)
                    }
                    .tint(Ledger.income)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .financeCard()
                }
                if kind == "crypto", let cryptoStart {
                    PerfCompareCard(
                        allStart: cryptoStart,
                        benchmarks: [.btc],
                        values: cryptoPot,
                        flows: cryptoFlows
                    )
                    // The three stories one number was hiding — see CryptoSplit.
                    CryptoSplitCard()
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Value").labelMono()
                    if series.count < 2 {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 160)
                    } else {
                        Chart(series) { point in
                            AreaMark(
                                x: .value("Date", point.date),
                                y: .value("Value", store.convert(point.value, from: "USD"))
                            )
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [Ledger.chartColor(0).opacity(0.3), .clear],
                                    startPoint: .top, endPoint: .bottom
                                )
                            )
                            LineMark(
                                x: .value("Date", point.date),
                                y: .value("Value", store.convert(point.value, from: "USD"))
                            )
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(Ledger.chartColor(0))
                            .lineStyle(StrokeStyle(lineWidth: 2))
                        }
                        .chartXAxis(.hidden)
                        .chartYScale(domain: .automatic(includesZero: false))
                        .frame(height: 200)
                    }
                }
                .padding(16)
                .financeCard()

                Text("TWR, benchmark and DCA comparisons live on the full web page — More → Full Performance.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(16)
            .padding(.bottom, 110)
        }
        .background(Ledger.background)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { FxChip() } }
        .navigationTitle("Performance")
        .task(id: kind) {
            series = (try? await SupabaseAPI.shared.fetchSnapshots(type: kind)) ?? []
        }
    }
}
