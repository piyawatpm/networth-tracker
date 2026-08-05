import SwiftUI

/// The crypto pot's P&L, separated into the three stories that were tangled
/// in one number: what the bots/Earn PAID you (stable transfers in), what
/// trading LOCKED IN (sell realized), and what the bags are doing on paper.
enum CryptoSplit {
    struct Split {
        var yieldInUsd: Double = 0    // stable transfers in
        var yieldOutUsd: Double = 0   // stable transfers out (redeploys/withdrawals)
        var realizedUsd: Double = 0   // avg-cost realized on sells
        var unrealizedUsd: Double = 0 // bags at live/last-known prices
        var unpriced: [String] = []   // tokens with no price anywhere

        var netYieldUsd: Double { yieldInUsd - yieldOutUsd }
        var netUsd: Double { netYieldUsd + realizedUsd + unrealizedUsd }
    }

    struct YieldEvent: Identifiable {
        let date: String   // yyyy-MM-dd
        let token: String
        let usd: Double    // signed: + arrived, − left
        let notes: String
        var id: String { date + token + String(usd) }
    }

    /// A stable transfer's USD value: the CSV usually leaves `totalValueUsd`
    /// empty on transfers, so fall back to amount × price, then to the $1 peg.
    private static func stableValue(_ tx: CryptoTransaction) -> Double {
        tx.totalValueUsd ?? (tx.priceUsd ?? 1) * tx.amount
    }

    static func compute(
        txs: [CryptoTransaction],
        tags: [String: Bool],
        livePrice: (String) -> Double?
    ) -> Split {
        var split = Split()

        // Yield: stables moving in/out. ArenaBot pays in USDT, so transferIn
        // of a cash token IS the bot's income event.
        for tx in txs where CryptoMath.isCashLike(tx.token, tags: tags) {
            if tx.type == "transferIn" { split.yieldInUsd += stableValue(tx) }
            if tx.type == "transferOut" { split.yieldOutUsd += stableValue(tx) }
        }

        // Trading: avg-cost replay where transferred-in coins carry ZERO cost.
        // computeHoldings (the holdings-page port) bills free units at the
        // average buy price — defensible for a balance sheet, but here it
        // manufactures cost that was never invested, and the split stops
        // reconciling with the snapshot-based compare card on the same
        // screen. Zero-cost keeps the identity: yield + realized + unrealized
        // ≈ pot − invested.
        var lastPrice: [String: Double] = [:]
        var bags: [String: (amount: Double, cost: Double)] = [:]
        for tx in txs.sorted(by: { $0.date < $1.date }) {
            if let p = tx.priceUsd, p > 0 { lastPrice[tx.token] = p }
            guard !CryptoMath.isCashLike(tx.token, tags: tags) else { continue }
            var bag = bags[tx.token] ?? (0, 0)
            switch tx.type {
            case "buy":
                bag.amount += tx.amount
                bag.cost += tx.totalValueUsd ?? 0
            case "transferIn":
                bag.amount += tx.amount // bot-minted / moved in — no cost here
            case "sell", "transferOut":
                guard bag.amount > 1e-9 else { break }
                let take = min(tx.amount, bag.amount)
                let avg = bag.cost / bag.amount
                if tx.type == "sell", let value = tx.totalValueUsd {
                    split.realizedUsd += value - avg * take
                }
                bag.amount -= take
                bag.cost -= avg * take
            default: break
            }
            bags[tx.token] = bag
        }
        for (token, bag) in bags where bag.amount > 1e-9 {
            if let price = livePrice(token) ?? lastPrice[token] {
                split.unrealizedUsd += bag.amount * price - bag.cost
            } else {
                split.unpriced.append(token)
            }
        }
        return split
    }

    struct CoinPnl: Identifiable {
        let token: String
        let realizedUsd: Double
        let unrealizedUsd: Double
        let heldAmount: Double
        let priced: Bool
        var netUsd: Double { realizedUsd + unrealizedUsd }
        var id: String { token }
    }

    /// Net earn per coin — the same zero-cost replay, kept per token.
    /// Exited coins stay in the list with their realized result; that's the
    /// point of asking "what did each coin actually make me".
    static func perCoin(
        txs: [CryptoTransaction],
        tags: [String: Bool],
        livePrice: (String) -> Double?
    ) -> [CoinPnl] {
        var lastPrice: [String: Double] = [:]
        var bags: [String: (amount: Double, cost: Double)] = [:]
        var realized: [String: Double] = [:]
        for tx in txs.sorted(by: { $0.date < $1.date }) {
            if let p = tx.priceUsd, p > 0 { lastPrice[tx.token] = p }
            guard !CryptoMath.isCashLike(tx.token, tags: tags) else { continue }
            var bag = bags[tx.token] ?? (0, 0)
            switch tx.type {
            case "buy":
                bag.amount += tx.amount
                bag.cost += tx.totalValueUsd ?? 0
            case "transferIn":
                bag.amount += tx.amount
            case "sell", "transferOut":
                guard bag.amount > 1e-9 else { break }
                let take = min(tx.amount, bag.amount)
                let avg = bag.cost / bag.amount
                if tx.type == "sell", let value = tx.totalValueUsd {
                    realized[tx.token, default: 0] += value - avg * take
                }
                bag.amount -= take
                bag.cost -= avg * take
            default: break
            }
            bags[tx.token] = bag
        }
        var out: [CoinPnl] = []
        for token in Set(bags.keys).union(realized.keys) {
            let bag = bags[token] ?? (0, 0)
            let held = bag.amount > 1e-9
            let price = livePrice(token) ?? lastPrice[token]
            let unreal = held ? (price.map { bag.amount * $0 - bag.cost } ?? 0) : 0
            let r = realized[token] ?? 0
            // Skip pure pass-through tokens that never made or lost anything.
            if !held, abs(r) < 0.5 { continue }
            out.append(CoinPnl(
                token: token,
                realizedUsd: r,
                unrealizedUsd: unreal,
                heldAmount: bag.amount,
                priced: !held || price != nil
            ))
        }
        return out.sorted { $0.netUsd > $1.netUsd }
    }

    /// Every stable transfer, newest first — the bot-income ledger.
    static func yieldEvents(txs: [CryptoTransaction], tags: [String: Bool]) -> [YieldEvent] {
        txs.filter {
            CryptoMath.isCashLike($0.token, tags: tags)
                && ($0.type == "transferIn" || $0.type == "transferOut")
        }
        .map {
            YieldEvent(
                date: String($0.date.prefix(10)),
                token: $0.token,
                usd: $0.type == "transferIn" ? stableValue($0) : -stableValue($0),
                notes: $0.notes
            )
        }
        .sorted { $0.date > $1.date }
    }
}

/// The split, as a card on the Performance page's crypto tab.
struct CryptoSplitCard: View {
    @Environment(DataStore.self) private var store

    private var split: CryptoSplit.Split {
        CryptoSplit.compute(
            txs: store.cryptoTxs,
            tags: store.stablecoinTags,
            livePrice: { store.livePrices[$0] }
        )
    }

    var body: some View {
        let s = split
        VStack(alignment: .leading, spacing: 10) {
            Text("Where crypto P&L comes from").labelMono()

            row("Earn & bot income", "net stable transfers in", s.netYieldUsd, emphasize: true)
            row("Trading · realized", "locked in by sells", s.realizedUsd)
            row("Trading · unrealized", "bags at today's prices", s.unrealizedUsd)

            Divider().overlay(Color.white.opacity(0.1))

            row("Net", "the whole journey", s.netUsd, emphasize: true)

            NavigationLink(value: MoreRoute.coinPnl) {
                HStack(spacing: 6) {
                    Image(systemName: "bitcoinsign.circle")
                        .font(.system(size: 11))
                    Text("Net by coin")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .foregroundStyle(Ledger.income)
                .padding(.top, 2)
            }
            .buttonStyle(.plain)

            NavigationLink(value: MoreRoute.botIncome) {
                HStack(spacing: 6) {
                    Image(systemName: "list.bullet.rectangle")
                        .font(.system(size: 11))
                    Text("Bot income ledger")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .foregroundStyle(Ledger.income)
                .padding(.top, 2)
            }
            .buttonStyle(.plain)

            if !s.unpriced.isEmpty {
                Text("no price for \(s.unpriced.joined(separator: ", ")) — excluded from unrealized")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            Text("convention: stable transfers = income (that's how ArenaBot pays), coin transfers carry zero cost · outs subtract, they may be your own redeployments")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
        .padding(16)
        .financeCard()
    }

    private func row(
        _ title: String, _ caption: String, _ usd: Double, emphasize: Bool = false
    ) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: emphasize ? 13 : 12,
                                  weight: emphasize ? .bold : .medium,
                                  design: .rounded))
                Text(caption)
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            Text("\(usd >= 0 ? "+" : "")\(store.format(store.convert(usd, from: "USD"), compact: true))")
                .font(.system(size: emphasize ? 14 : 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(usd >= 0 ? Ledger.income : Ledger.expense)
        }
    }
}

/// The list: every stable transfer, month by month — ArenaBot's pay history.
struct BotIncomeView: View {
    @Environment(DataStore.self) private var store

    private var events: [CryptoSplit.YieldEvent] {
        CryptoSplit.yieldEvents(txs: store.cryptoTxs, tags: store.stablecoinTags)
    }

    private var months: [(key: String, label: String, net: Double, items: [CryptoSplit.YieldEvent])] {
        var buckets: [String: [CryptoSplit.YieldEvent]] = [:]
        for event in events { buckets[String(event.date.prefix(7)), default: []].append(event) }
        return buckets.keys.sorted(by: >).map { key in
            let items = buckets[key] ?? []
            return (
                key,
                "\(FlowMath.fullMonthName(Int(key.suffix(2)) ?? 1)) \(key.prefix(4))",
                items.reduce(0) { $0 + $1.usd },
                items
            )
        }
    }

    var body: some View {
        let total = events.reduce(0) { $0 + $1.usd }
        let gross = events.filter { $0.usd > 0 }.reduce(0) { $0 + $1.usd }

        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Net bot & Earn income").labelMono()
                    MoneyText(
                        amount: store.convert(total, from: "USD"),
                        currency: store.displayCurrency,
                        tint: total >= 0 ? Ledger.income : Ledger.expense
                    )
                    HStack(spacing: 8) {
                        StatChip(label: "Arrived", value: "+" + store.format(store.convert(gross, from: "USD"), compact: true), tint: Ledger.income)
                        StatChip(label: "Moved out", value: "−" + store.format(store.convert(gross - total, from: "USD"), compact: true))
                        StatChip(label: "Payments", value: "\(events.filter { $0.usd > 0 }.count)")
                        Spacer(minLength: 0)
                    }
                }
                .padding(16)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .financeCard()
            }

            ForEach(months, id: \.key) { month in
                Section {
                    ForEach(month.items) { event in
                        HStack(spacing: 10) {
                            Image(systemName: event.usd >= 0 ? "arrow.down.left.circle.fill" : "arrow.up.right.circle")
                                .font(.system(size: 14))
                                .foregroundStyle(event.usd >= 0 ? Ledger.income : Ledger.subtle)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(event.usd >= 0 ? "Bot payout · \(event.token)" : "Moved out · \(event.token)")
                                    .font(.subheadline)
                                if !event.notes.isEmpty {
                                    Text(event.notes).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 1) {
                                Text("\(event.usd >= 0 ? "+" : "")\(store.format(store.convert(event.usd, from: "USD"), compact: true))")
                                    .font(.system(.footnote, design: .monospaced, weight: .medium))
                                    .foregroundStyle(event.usd >= 0 ? Ledger.income : Ledger.expense)
                                Text(SydneyTime.shortLabel(event.date))
                                    .font(.caption2).foregroundStyle(.tertiary)
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text(month.label)
                        Spacer()
                        Text("\(month.net >= 0 ? "+" : "")\(store.format(store.convert(month.net, from: "USD"), compact: true))")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(month.net >= 0 ? Ledger.income.opacity(0.85) : Ledger.expense.opacity(0.85))
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
        .navigationTitle("Bot income")
        .navigationBarTitleDisplayMode(.inline)
    }
}


/// Every coin's verdict: what it realized, what its bag is doing, the net.
struct CoinPnlView: View {
    @Environment(DataStore.self) private var store

    private var rows: [CryptoSplit.CoinPnl] {
        CryptoSplit.perCoin(
            txs: store.cryptoTxs,
            tags: store.stablecoinTags,
            livePrice: { store.livePrices[$0] }
        )
    }

    var body: some View {
        let winners = rows.filter { $0.netUsd >= 0 }
        let losers = rows.filter { $0.netUsd < 0 }

        List {
            Section {
                let total = rows.reduce(0) { $0 + $1.netUsd }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Trading net · all coins").labelMono()
                    MoneyText(
                        amount: store.convert(total, from: "USD"),
                        currency: store.displayCurrency,
                        tint: total >= 0 ? Ledger.income : Ledger.expense
                    )
                    Text("realized + unrealized, per coin · bot USDT payouts live in the bot income ledger, not here")
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
                .padding(16)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .financeCard()
            }

            Section("Made money · \(winners.count)") {
                ForEach(winners) { coinRow($0) }
            }
            Section("Lost money · \(losers.count)") {
                ForEach(losers) { coinRow($0) }
            }

            Section {
                Color.clear.frame(height: 90)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Ledger.background)
        .navigationTitle("Net by coin")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func coinRow(_ coin: CryptoSplit.CoinPnl) -> some View {
        HStack(spacing: 10) {
            LogoCircle(url: store.coinImageURL(coin.token), fallback: coin.token, size: 26)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Text(coin.token).font(.subheadline.weight(.semibold))
                    if coin.heldAmount <= 1e-9 {
                        Text("exited")
                            .font(.system(size: 8, weight: .semibold, design: .monospaced))
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.white.opacity(0.08), in: .capsule)
                            .foregroundStyle(.secondary)
                    }
                    if !coin.priced {
                        Text("no price")
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(Ledger.seriesCrypto)
                    }
                }
                Text("sold \(signed(coin.realizedUsd)) · bag \(signed(coin.unrealizedUsd))")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(signed(coin.netUsd))
                .font(.system(.footnote, design: .monospaced, weight: .semibold))
                .foregroundStyle(coin.netUsd >= 0 ? Ledger.income : Ledger.expense)
        }
        .padding(.vertical, 2)
    }

    private func signed(_ usd: Double) -> String {
        "\(usd >= 0 ? "+" : "")\(store.format(store.convert(usd, from: "USD"), compact: true))"
    }
}
