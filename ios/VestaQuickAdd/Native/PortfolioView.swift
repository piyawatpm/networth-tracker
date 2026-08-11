import SwiftUI

/// Stocks and crypto under one roof, matching the web's mental model of two
/// pots. A segmented control instead of two tab slots keeps the tab bar to
/// five items.
struct InvestView: View {
    @Environment(DataStore.self) private var store
    @State private var pot = 0
    @Namespace private var zoom

    private var hasHostplus: Bool {
        store.holdings.contains {
            HostplusAPI.optionNameByTicker[$0.ticker.uppercased()] != nil
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Pot", selection: $pot.animation(.snappy(duration: 0.25))) {
                    Text("Stocks").tag(0)
                    Text("Crypto").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)

                // Real pager: swipe between pots, picker stays in sync.
                TabView(selection: $pot) {
                    ScrollView {
                        PortfolioSection(zoom: zoom)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 110)
                    }
                    .refreshable {
                        await store.refresh()
                        await store.refreshHostplus()
                    }
                    .tag(0)

                    ScrollView {
                        CryptoSection()
                            .padding(.horizontal, 16)
                            .padding(.bottom, 110)
                    }
                    .refreshable { await store.refresh() }
                    .tag(1)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .background(Ledger.background)
            .navigationTitle("Invest")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { FxChip() }
                if hasHostplus {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            Task { await store.refreshHostplus() }
                        } label: {
                            if store.isRefreshingHostplus {
                                ProgressView()
                            } else {
                                Image(systemName: "arrow.clockwise")
                            }
                        }
                        .disabled(store.isRefreshingHostplus)
                        .accessibilityLabel("Update Hostplus super price")
                    }
                }
            }
        }
    }
}

// MARK: - Stocks

private struct PortfolioSection: View {
    @Environment(DataStore.self) private var store
    let zoom: Namespace.ID
    @State private var addingTxFor: PortfolioHolding?

    private var rows: [(holding: PortfolioHolding, position: DerivedPosition)] {
        store.holdings
            .filter { $0.type != "savings" }
            .filter { store.includeSuperStocks || $0.accountType != "super" }
            .map { holding in
                let own = store.portfolioTxs.filter { $0.holdingId == holding.id }
                return (holding, PortfolioMath.derivePosition(own))
            }
            .sorted {
                store.convert(store.holdingLiveValue($0.holding), from: $0.holding.currency)
                    > store.convert(store.holdingLiveValue($1.holding), from: $1.holding.currency)
            }
    }

    // The web's realizedBreakdown: only holdings with a recorded sell appear,
    // biggest gain first, each converted to the display currency. Follows the
    // same scope as the list above, so the super toggle applies here too.
    private var realizedRows: [RealizedPnlCard.Row] {
        rows.compactMap { row in
            guard row.position.totalSold > 0 else { return nil }
            return RealizedPnlCard.Row(
                id: row.holding.id,
                name: row.holding.name,
                ticker: row.holding.ticker,
                value: store.convert(row.position.realizedPnl, from: row.holding.currency)
            )
        }
        .sorted { $0.value > $1.value }
    }

    // Web parity: holding-level invested vs live value, display currency.
    private var investedTotal: Double {
        rows.reduce(0) { $0 + store.convert($1.holding.amountInvested, from: $1.holding.currency) }
    }
    private var unrealizedTotal: Double {
        rows.reduce(0) {
            $0 + store.convert(
                store.holdingLiveValue($1.holding) - $1.holding.amountInvested,
                from: $1.holding.currency
            )
        }
    }

    private func displayValue(_ holding: PortfolioHolding) -> Double {
        store.convert(store.holdingLiveValue(holding), from: holding.currency)
    }

    private static let typeLabels: [String: String] = [
        "stock": "Stocks", "etf": "ETFs", "fund": "Funds",
        "bond": "Bonds", "other": "Other",
    ]
    // Mirror of the web's HOLDING_TYPE_COLOR_MAP chart indices.
    private static let typeColorIndex: [String: Int] = [
        "stock": 0, "etf": 1, "fund": 2, "bond": 3, "other": 4,
    ]

    /// The web page's three donuts, one segmented card: by type, top
    /// holdings, by country.
    private var allocationModes: [(label: String, slices: [AllocationSlice])] {
        var byType: [String: Double] = [:]
        var byCountry: [String: Double] = [:]
        for row in rows {
            byType[row.holding.type, default: 0] += displayValue(row.holding)
            let country = row.holding.country.isEmpty ? "Unknown" : row.holding.country
            byCountry[country, default: 0] += displayValue(row.holding)
        }
        let typeSlices = byType
            .map { type, value in
                AllocationSlice(
                    name: Self.typeLabels[type] ?? type,
                    value: value,
                    color: Ledger.chartColor(Self.typeColorIndex[type] ?? 4)
                )
            }
            .sorted { $0.value > $1.value }

        let sorted = rows.sorted { displayValue($0.holding) > displayValue($1.holding) }
        var holdingSlices = sorted.prefix(6).enumerated().map { index, row in
            AllocationSlice(
                name: row.holding.ticker.isEmpty ? row.holding.name : row.holding.ticker,
                value: displayValue(row.holding),
                color: Ledger.chartColor(index)
            )
        }
        let rest = sorted.dropFirst(6).reduce(0) { $0 + displayValue($1.holding) }
        if rest > 0 {
            holdingSlices.append(AllocationSlice(name: "Other", value: rest, color: Ledger.chartColor(6)))
        }

        let countrySlices = byCountry
            .sorted { $0.value > $1.value }
            .enumerated()
            .map { index, entry in
                AllocationSlice(name: entry.key, value: entry.value, color: Ledger.chartColor(index))
            }

        return [("Type", typeSlices), ("Holdings", holdingSlices), ("Country", countrySlices)]
    }

    /// The web's By Broker section over the same visible scope.
    private var brokerBars: [BreakdownBar] {
        var byBroker: [String: (value: Double, count: Int)] = [:]
        for row in rows {
            let name = row.holding.broker.isEmpty ? "Unknown" : row.holding.broker
            var entry = byBroker[name] ?? (0, 0)
            entry.value += displayValue(row.holding)
            entry.count += 1
            byBroker[name] = entry
        }
        return byBroker
            .map { BreakdownBar(name: $0.key, count: $0.value.count, value: $0.value.value) }
            .sorted { $0.value > $1.value }
    }

    /// Latest trades across the visible holdings, newest first.
    private var recentTrades: [PortfolioTransaction] {
        let visibleIds = Set(rows.map(\.holding.id))
        return store.portfolioTxs
            .filter { visibleIds.contains($0.holdingId) }
            .sorted { $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt }
            .prefix(8)
            .map { $0 }
    }

    var body: some View {
        @Bindable var store = store
        VStack(spacing: 12) {
            // Chart + value follow the toggle: the snapshot table stores both
            // series (value = ex-super, value_with_super = with), same as web.
            HistoryChartCard(
                title: store.includeSuperStocks ? "Stocks & Funds" : "Stocks · ex-super",
                parsed: store.includeSuperStocks
                    ? store.portfolioParsedWithSuper : store.portfolioParsed,
                liveValue: store.stocksValueVisible,
                heroSize: 32
            )
            .id(store.includeSuperStocks) // rebuild points when the series swaps
            .entranceTransition()

            // Super toggle, same semantics as the web's "Super: in/out" pill.
            HStack {
                Text("Include super").font(.subheadline)
                Spacer()
                Toggle("", isOn: $store.includeSuperStocks.animation(.spring(duration: 0.4)))
                    .labelsHidden()
                    .tint(Ledger.income)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .financeCard()
            .entranceTransition()

            // Invested vs unrealized over the visible scope — the totals the
            // web's summary row carries, so realized (card below) and
            // unrealized are both on the page.
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Invested").font(.caption2).foregroundStyle(.secondary)
                    Text(store.format(investedTotal, compact: true))
                        .font(.system(.caption, design: .monospaced, weight: .medium))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text("\(unrealizedTotal >= 0 ? "+" : "")\(store.format(unrealizedTotal, compact: true))")
                        .font(.system(.caption, design: .monospaced, weight: .semibold))
                        .foregroundStyle(unrealizedTotal >= 0 ? Ledger.income : Ledger.expense)
                    Text(investedTotal > 0
                         ? "unrealized \(unrealizedTotal >= 0 ? "+" : "")\(String(format: "%.1f", unrealizedTotal / investedTotal * 100))%"
                         : "unrealized")
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(14)
            .financeCard()
            .entranceTransition()

            // The web page's donuts (Type | Holdings | Country), one card.
            if rows.count > 1 {
                AllocationDonutCard(
                    title: "Allocation",
                    modes: allocationModes,
                    centerNoun: "holdings"
                )
                .entranceTransition()
            }

            // The web's Realized P&L card: gains locked in by sells, replayed
            // from the transaction log at average cost.
            RealizedPnlCard(
                rows: realizedRows,
                countNoun: "position",
                emptyHint: "Realized gains and losses show up here once you log a sell — including holdings you've fully exited."
            )
            .entranceTransition()

            if brokerBars.count > 1 {
                BreakdownBarsCard(title: "By broker", rows: brokerBars)
                    .entranceTransition()
            }

            ForEach(rows, id: \.holding.id) { row in
                NavigationLink {
                    HoldingDetailView(holding: row.holding)
                        .navigationTransition(.zoom(sourceID: row.holding.id, in: zoom))
                } label: {
                    HoldingCard(holding: row.holding, position: row.position)
                        .matchedTransitionSource(id: row.holding.id, in: zoom)
                }
                .buttonStyle(.plain)
                .entranceTransition()
            }

            // The web page's transaction history, phone-sized.
            if !recentTrades.isEmpty {
                RecentTradesCard(txs: recentTrades)
                    .entranceTransition()
            }
        }
    }
}

private struct HoldingCard: View {
    @Environment(DataStore.self) private var store
    let holding: PortfolioHolding
    let position: DerivedPosition

    var body: some View {
        // Unrealized gain in the holding's own currency: live value − cost
        // basis remaining after sells (average-cost, same as the web table).
        let liveValue = store.holdingLiveValue(holding)
        let gain = liveValue - (position.costBasis > 0 ? position.costBasis : holding.amountInvested)
        let base = position.costBasis > 0 ? position.costBasis : holding.amountInvested
        let pct = base > 0 ? gain / base * 100 : 0
        let isLive = store.liveStockPrices[holding.ticker] != nil
        let units = position.units > 0 ? position.units : holding.units

        HStack(spacing: 10) {
            LogoCircle(
                url: store.stockLogoURL(holding.ticker),
                fallback: holding.ticker.isEmpty ? holding.name : holding.ticker
            )
            VStack(alignment: .leading, spacing: 3) {
                Text(holding.name).font(.subheadline.weight(.medium)).lineLimit(1)
                HStack(spacing: 5) {
                    if !holding.ticker.isEmpty {
                        Text(holding.ticker)
                            .font(.system(size: 10, design: .monospaced))
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(.primary.opacity(0.07), in: .capsule)
                    }
                    if isLive {
                        // Ticking from the Alpaca socket right now.
                        Circle().fill(Ledger.income).frame(width: 5, height: 5)
                    }
                    if holding.accountType == "super" {
                        Text("SUPER")
                            .font(.system(size: 9, design: .monospaced))
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Ledger.chartColor(1).opacity(0.15), in: .capsule)
                    }
                    if units > 0 {
                        // The web row's "…/u" — what one unit trades at now.
                        Text("\(Money.format(liveValue / units, currency: holding.currency, compact: true))/u")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(Money.format(liveValue, currency: holding.currency))
                    .font(.system(.footnote, design: .monospaced, weight: .semibold))
                // Web parity: absolute P&L beside the percent, not % alone.
                Text("\(gain >= 0 ? "+" : "")\(Money.format(gain, currency: holding.currency, compact: true)) (\(gain >= 0 ? "+" : "")\(String(format: "%.1f", pct))%)")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(gain >= 0 ? Ledger.income : Ledger.expense)
            }
        }
        .padding(14)
        .financeCard()
    }
}

/// The web's "All-Time Realized" card, shared by both pots: locked-in P&L
/// total up top, a per-position breakdown below, biggest gain first. Values
/// arrive pre-converted to the display currency.
struct RealizedPnlCard: View {
    struct Row: Identifiable {
        let id: String
        let name: String
        let ticker: String
        let value: Double
    }

    @Environment(DataStore.self) private var store
    let rows: [Row]
    let countNoun: String
    let emptyHint: String
    /// Web parity: the crypto card keeps its zero header + footnote while the
    /// CSV has no sells; the stocks card collapses to a hint instead.
    var zeroHeaderWhenEmpty = false

    private var total: Double { rows.reduce(0) { $0 + $1.value } }

    var body: some View {
        if rows.isEmpty && !zeroHeaderWhenEmpty {
            HStack(spacing: 12) {
                Image(systemName: "receipt")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 38, height: 38)
                    .background(.primary.opacity(0.06), in: .rect(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Track realized profit").font(.footnote.weight(.medium))
                    Text(emptyHint)
                        .font(.caption2).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .financeCard()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("All-Time Realized").labelMono()
                        Text("\(total >= 0 ? "+" : "")\(store.format(total))")
                            .font(.system(.title3, design: .monospaced, weight: .semibold))
                            .foregroundStyle(total >= 0 ? Ledger.income : Ledger.expense)
                    }
                    Spacer()
                    if !rows.isEmpty {
                        Text("\(rows.count) \(countNoun)\(rows.count == 1 ? "" : "s")")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(14)

                Divider().opacity(0.6)

                if rows.isEmpty {
                    Text("No realized sells yet — locked-in gains show up here once you sell.")
                        .font(.caption2).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 16)
                } else {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            Divider().opacity(0.35).padding(.leading, 14)
                        }
                        HStack(spacing: 6) {
                            Text(row.name)
                                .font(.footnote.weight(.medium))
                                .lineLimit(1)
                            if !row.ticker.isEmpty && row.ticker != row.name {
                                Text(row.ticker)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(row.value >= 0 ? "+" : "")\(store.format(row.value, compact: true))")
                                .font(.system(.footnote, design: .monospaced, weight: .semibold))
                                .foregroundStyle(row.value >= 0 ? Ledger.income : Ledger.expense)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                    }
                }
            }
            .financeCard()
        }
    }
}

struct HoldingDetailView: View {
    @Environment(DataStore.self) private var store
    let holding: PortfolioHolding
    @State private var addingTx = false

    private var transactions: [PortfolioTransaction] {
        store.portfolioTxs
            .filter { $0.holdingId == holding.id }
            .sorted { $0.date > $1.date }
    }

    private var position: DerivedPosition {
        PortfolioMath.derivePosition(store.portfolioTxs.filter { $0.holdingId == holding.id })
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 12) {
                    MoneyText(amount: holding.currentValue, currency: holding.currency)
                    let units = position.units > 0 ? position.units : holding.units
                    let cost = position.costBasis > 0 ? position.costBasis : holding.amountInvested
                    let unrealized = holding.currentValue - cost
                    HStack(spacing: 0) {
                        statTile("Units", String(format: "%.4g", units))
                        Divider().padding(.vertical, 4)
                        statTile("Price / u", units > 0
                            ? Money.format(holding.currentValue / units, currency: holding.currency, compact: true)
                            : "—")
                        Divider().padding(.vertical, 4)
                        statTile("Cost", Money.format(cost, currency: holding.currency, compact: true))
                    }
                    Divider()
                    HStack(spacing: 0) {
                        statTile(
                            "Realized",
                            Money.format(position.realizedPnl, currency: holding.currency, compact: true),
                            tint: position.realizedPnl >= 0 ? Ledger.income : Ledger.expense
                        )
                        Divider().padding(.vertical, 4)
                        statTile(
                            "Unrealized",
                            Money.format(unrealized, currency: holding.currency, compact: true),
                            tint: unrealized >= 0 ? Ledger.income : Ledger.expense
                        )
                    }
                }
                .padding(16)
                .financeCard()

                // The Hostplus unit-price log — proof the daily auto-reprice
                // is alive, since the balance alone moves too quietly to see.
                if let code = HostplusAPI.optionCodeByTicker[holding.ticker.uppercased()],
                   let history = store.hostplusPriceHistory[code], !history.isEmpty {
                    let days = Array(history.sorted { $0.key > $1.key }.prefix(7))
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Unit price · Hostplus feed").labelMono()
                        ForEach(days.indices, id: \.self) { index in
                            let (date, price) = days[index]
                            HStack {
                                Text(SydneyTime.shortLabel(date)).font(.caption)
                                Spacer()
                                if index + 1 < days.count {
                                    let previous = days[index + 1].value
                                    let deltaPct = previous > 0 ? (price - previous) / previous * 100 : 0
                                    Text("\(deltaPct >= 0 ? "+" : "")\(String(format: "%.2f", deltaPct))%")
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(deltaPct >= 0 ? Ledger.income : Ledger.expense)
                                }
                                Text(String(format: "$%.4f", price))
                                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                                    .frame(width: 64, alignment: .trailing)
                            }
                        }
                        Text("auto-updated by the daily server job · Hostplus publishes each day's price the next business day ~6pm Sydney · balance = units × price")
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                    .financeCard()
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Transactions").labelMono()
                    if transactions.isEmpty {
                        Text("No buys or sells logged yet.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(transactions) { tx in
                        HStack {
                            Image(systemName: tx.type == "buy" ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                                .foregroundStyle(tx.type == "buy" ? Ledger.income : Ledger.expense)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(tx.type == "buy" ? "Buy" : "Sell") \(String(format: "%.4g", tx.units))")
                                    .font(.subheadline)
                                Text(SydneyTime.shortLabel(tx.date))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Money.format(tx.totalAmount, currency: tx.currency))
                                .font(.system(.footnote, design: .monospaced))
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
        .navigationTitle(holding.ticker.isEmpty ? holding.name : holding.ticker)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Log", systemImage: "plus") { addingTx = true }
            }
        }
        .sheet(isPresented: $addingTx) {
            PortfolioTxForm(holding: holding)
        }
    }

    private func statTile(_ label: String, _ value: String, tint: Color = .primary) -> some View {
        VStack(spacing: 3) {
            Text(label).labelMono()
            Text(value)
                .font(.system(.footnote, design: .monospaced, weight: .semibold))
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Log a buy/sell against a holding — same fields as the web dialog.
struct PortfolioTxForm: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let holding: PortfolioHolding

    @State private var type = "buy"
    @State private var units = ""
    @State private var total = ""
    @State private var date = Date()
    @State private var saving = false
    @State private var error: String?

    private var parsedUnits: Double? { Double(units.replacingOccurrences(of: ",", with: "")) }
    private var parsedTotal: Double? { Double(total.replacingOccurrences(of: ",", with: "")) }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $type) {
                    Text("Buy").tag("buy")
                    Text("Sell").tag("sell")
                }
                .pickerStyle(.segmented)

                TextField("Units", text: $units).keyboardType(.decimalPad)
                TextField("Total \(holding.currency)", text: $total).keyboardType(.decimalPad)
                DatePicker("Date", selection: $date, displayedComponents: .date)

                if let u = parsedUnits, let t = parsedTotal, u > 0 {
                    LabeledContent("Price / unit") {
                        Text(Money.format(t / u, currency: holding.currency))
                            .font(.system(.body, design: .monospaced))
                    }
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Ledger.expense)
                }
            }
            .navigationTitle("\(holding.ticker.isEmpty ? holding.name : holding.ticker)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(parsedUnits == nil || parsedTotal == nil || saving)
                }
            }
        }
    }

    private func save() async {
        guard let u = parsedUnits, let t = parsedTotal, u > 0, t > 0 else { return }
        saving = true
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = SydneyTime.zone
        formatter.dateFormat = "yyyy-MM-dd"
        do {
            // Currency invariant: every leg is stamped with the HOLDING's
            // quote currency — the "Paid in" mislabel bug came from breaking
            // exactly this.
            try await store.savePortfolioTx(PortfolioTransaction(
                holdingId: holding.id,
                holdingName: holding.name,
                type: type,
                units: u,
                pricePerUnit: t / u,
                totalAmount: t,
                currency: holding.currency,
                date: formatter.string(from: date)
            ))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
