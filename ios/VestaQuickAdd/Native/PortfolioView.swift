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
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(Money.format(liveValue, currency: holding.currency))
                    .font(.system(.footnote, design: .monospaced, weight: .semibold))
                PctBadge(percent: pct)
            }
        }
        .padding(14)
        .financeCard()
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
                    HStack(spacing: 0) {
                        statTile("Units", String(format: "%.4g", position.units > 0 ? position.units : holding.units))
                        Divider().padding(.vertical, 4)
                        statTile("Cost", Money.format(position.costBasis > 0 ? position.costBasis : holding.amountInvested, currency: holding.currency, compact: true))
                        Divider().padding(.vertical, 4)
                        statTile(
                            "Realized",
                            Money.format(position.realizedPnl, currency: holding.currency, compact: true),
                            tint: position.realizedPnl >= 0 ? Ledger.income : Ledger.expense
                        )
                    }
                }
                .padding(16)
                .financeCard()

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
