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
        /// The date|token|amount identity used for manual exclusion — stable
        /// across CSV re-uploads, which row ids would not be.
        let key: String
        var id: String { key + String(usd) }
    }

    /// A stable transfer's USD value: the CSV usually leaves `totalValueUsd`
    /// empty on transfers, so fall back to amount × price, then to the $1 peg.
    private static func stableValue(_ tx: CryptoTransaction) -> Double {
        tx.totalValueUsd ?? (tx.priceUsd ?? 1) * tx.amount
    }

    /// The day the Notes-column convention started. From here on, earn is
    /// opt-in: "E" (or anything containing "earn") in the note, nothing else.
    /// BEFORE it, the user's CMC habit was the opposite — earn was recorded
    /// AS a transferIn — so pre-era transfer-ins count by default, with two
    /// guards: venue moves (an in that bounces straight back out) are
    /// auto-excluded, and a lone "x" note vetoes any row that was actually
    /// the user's own capital arriving.
    static let markerEpoch = "2026-08-05"

    /// Is this transfer explicitly marked as earn income? ("E" / "earn")
    static func isEarnMarked(_ tx: CryptoTransaction) -> Bool {
        let note = tx.notes.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return note == "e" || note.contains("earn")
    }

    /// Pre-era opt-out: "x" (or "not earn") says this arrival was capital.
    static func isOptedOut(_ tx: CryptoTransaction) -> Bool {
        let note = tx.notes.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return note == "x" || note == "not earn"
    }

    /// The stable identity of a transfer for pairing and manual exclusion.
    static func earnKey(_ tx: CryptoTransaction) -> String {
        "\(tx.date.prefix(10))|\(tx.token)|\(tx.amount)"
    }
    private static func pairKey(_ tx: CryptoTransaction) -> String { earnKey(tx) }

    /// Pre-era transfer-ins that bounce back out — same token, within 3 days,
    /// amount within 12% — are the user's own money hopping venues, not
    /// income. Greedy one-to-one matching, oldest first; returns a multiset
    /// of pair keys so duplicate-looking rows only cancel once each.
    private static func internalMoveKeys(_ txs: [CryptoTransaction]) -> [String: Int] {
        let pre = txs.filter { String($0.date.prefix(10)) < markerEpoch }
        let ins = pre.filter { $0.type == "transferIn" }.sorted { $0.date < $1.date }
        var outs = pre.filter { $0.type == "transferOut" }.sorted { $0.date < $1.date }
            .map { (tx: $0, used: false) }
        var keys: [String: Int] = [:]
        for arrival in ins {
            guard arrival.amount > 0,
                  let inDate = SnapshotDate.parse(arrival.date) else { continue }
            for i in outs.indices where !outs[i].used {
                let out = outs[i].tx
                guard out.token == arrival.token,
                      let outDate = SnapshotDate.parse(out.date),
                      abs(outDate.timeIntervalSince(inDate)) <= 3 * 86400,
                      abs(out.amount - arrival.amount) / arrival.amount < 0.12
                else { continue }
                outs[i].used = true
                keys[pairKey(arrival), default: 0] += 1
                break
            }
        }
        return keys
    }

    /// The one earn decision, shared by every computation in this file so the
    /// card, the per-coin page, and the ledger can never disagree:
    /// marked rows always count; pre-era transfer-ins count unless vetoed
    /// ("x") or recognized as a venue move. Stateful because the venue-move
    /// multiset is consumed as rows match — instantiate one per pass.
    struct EarnRule {
        private var internalMoves: [String: Int]
        private let excluded: Set<String>

        init(_ txs: [CryptoTransaction], exclusions: Set<String> = []) {
            internalMoves = CryptoSplit.internalMoveKeys(txs)
            excluded = exclusions
        }

        mutating func countsAsEarn(_ tx: CryptoTransaction) -> Bool {
            // Manual veto beats everything, marked rows included — the user
            // taps "not earn" in the ledger and the row stops counting.
            if excluded.contains(CryptoSplit.earnKey(tx)) { return false }
            if CryptoSplit.isEarnMarked(tx) { return true }
            guard tx.type == "transferIn",
                  String(tx.date.prefix(10)) < CryptoSplit.markerEpoch,
                  !CryptoSplit.isOptedOut(tx)
            else { return false }
            let key = CryptoSplit.pairKey(tx)
            if let count = internalMoves[key], count > 0 {
                internalMoves[key] = count - 1
                return false
            }
            return true
        }
    }

    /// The token's logged price nearest in time to `date` — how a coin
    /// transfer (Earn interest paid in ETH, bot rewards in kind) gets valued
    /// at ARRIVAL, since the CSV leaves transfers priceless.
    static func nearestPrices(_ txs: [CryptoTransaction]) -> (String, String) -> Double? {
        var points: [String: [(date: Date, price: Double)]] = [:]
        for tx in txs {
            if let p = tx.priceUsd, p > 0, let d = SnapshotDate.parse(tx.date) {
                points[tx.token, default: []].append((d, p))
            }
        }
        return { token, dateString in
            guard let candidates = points[token], let date = SnapshotDate.parse(dateString)
            else { return nil }
            return candidates.min {
                abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date))
            }?.price
        }
    }

    static func compute(
        txs: [CryptoTransaction],
        tags: [String: Bool],
        livePrice: (String) -> Double?,
        exclusions: Set<String> = []
    ) -> Split {
        var split = Split()
        let arrivalPrice = nearestPrices(txs)
        var earnRule = EarnRule(txs, exclusions: exclusions)

        // Trading replay with earn transfers booked as INCOME AT ARRIVAL
        // VALUE — Earn pays in kind (ETH, BTC…) as well as USDT, and pricing
        // those arrivals at zero was hiding ฿35K of yield inside
        // "unrealized". A transferred coin gets its arrival value as cost
        // basis, so the trading rows measure only what happened AFTER it
        // arrived.
        var lastPrice: [String: Double] = [:]
        var bags: [String: (amount: Double, cost: Double)] = [:]
        for tx in txs.sorted(by: { $0.date < $1.date }) {
            if let p = tx.priceUsd, p > 0 { lastPrice[tx.token] = p }
            if CryptoMath.isCashLike(tx.token, tags: tags) {
                guard earnRule.countsAsEarn(tx) else { continue } // else cash management
                if tx.type == "transferIn" { split.yieldInUsd += stableValue(tx) }
                if tx.type == "transferOut" { split.yieldOutUsd += stableValue(tx) }
                continue
            }
            var bag = bags[tx.token] ?? (0, 0)
            switch tx.type {
            case "buy":
                bag.amount += tx.amount
                bag.cost += tx.totalValueUsd ?? 0
            case "transferIn":
                bag.amount += tx.amount
                if let px = arrivalPrice(tx.token, tx.date) {
                    let value = tx.amount * px
                    bag.cost += value // arrival basis either way
                    if earnRule.countsAsEarn(tx) { split.yieldInUsd += value }
                }
            case "sell", "transferOut":
                guard bag.amount > 1e-9 else { break }
                let take = min(tx.amount, bag.amount)
                let avg = bag.cost / bag.amount
                if tx.type == "sell", let value = tx.totalValueUsd {
                    split.realizedUsd += value - avg * take
                } else if tx.type == "transferOut", earnRule.countsAsEarn(tx),
                          let px = arrivalPrice(tx.token, tx.date) {
                    split.yieldOutUsd += take * px
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
        let earnedUsd: Double     // transfers valued at arrival — Earn/bot in kind
        let realizedUsd: Double
        let unrealizedUsd: Double
        let heldAmount: Double
        let priced: Bool
        // Trading only — earn lives on the Earn income page.
        var netUsd: Double { realizedUsd + unrealizedUsd }
        var id: String { token }
    }

    /// Net earn per coin — earned (transfers at arrival value) + realized +
    /// bag. Exited coins stay listed; that is the point of the question.
    static func perCoin(
        txs: [CryptoTransaction],
        tags: [String: Bool],
        livePrice: (String) -> Double?,
        exclusions: Set<String> = []
    ) -> [CoinPnl] {
        let arrivalPrice = nearestPrices(txs)
        var earnRule = EarnRule(txs, exclusions: exclusions)
        var lastPrice: [String: Double] = [:]
        var bags: [String: (amount: Double, cost: Double)] = [:]
        var realized: [String: Double] = [:]
        var earned: [String: Double] = [:]
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
                if let px = arrivalPrice(tx.token, tx.date) {
                    let value = tx.amount * px
                    bag.cost += value
                    if earnRule.countsAsEarn(tx) { earned[tx.token, default: 0] += value }
                }
            case "sell", "transferOut":
                guard bag.amount > 1e-9 else { break }
                let take = min(tx.amount, bag.amount)
                let avg = bag.cost / bag.amount
                if tx.type == "sell", let value = tx.totalValueUsd {
                    realized[tx.token, default: 0] += value - avg * take
                } else if tx.type == "transferOut", earnRule.countsAsEarn(tx),
                          let px = arrivalPrice(tx.token, tx.date) {
                    earned[tx.token, default: 0] -= take * px
                }
                bag.amount -= take
                bag.cost -= avg * take
            default: break
            }
            bags[tx.token] = bag
        }
        var out: [CoinPnl] = []
        for token in Set(bags.keys).union(realized.keys).union(earned.keys) {
            let bag = bags[token] ?? (0, 0)
            let held = bag.amount > 1e-9
            let price = livePrice(token) ?? lastPrice[token]
            let unreal = held ? (price.map { bag.amount * $0 - bag.cost } ?? 0) : 0
            let r = realized[token] ?? 0
            let e = earned[token] ?? 0
            if abs(r) < 0.5, (!held || abs(unreal) < 0.5) { continue } // no trading story
            out.append(CoinPnl(
                token: token,
                earnedUsd: e,
                realizedUsd: r,
                unrealizedUsd: unreal,
                heldAmount: bag.amount,
                priced: !held || price != nil
            ))
        }
        return out.sorted { $0.netUsd > $1.netUsd }
    }

    /// Every earn transfer — USDT payouts AND in-kind coin rewards — valued
    /// at arrival, newest first. The bot/Earn pay history. Pre-era rows
    /// (the CMC transferIn habit) and marked rows alike, one shared rule.
    /// EVERY transfer in/out, valued at arrival (stables $1, coins nearest
    /// logged price) — the external funding of the crypto pot. Venue-move
    /// pairs cancel in any monthly sum by construction. Distinct from earn:
    /// this is capital movement, no marker semantics at all.
    static func externalFlowEvents(
        txs: [CryptoTransaction],
        tags: [String: Bool]
    ) -> [(month: String, date: String, token: String, usd: Double)] {
        let arrivalPrice = nearestPrices(txs)
        var events: [(String, String, String, Double)] = []
        for tx in txs where tx.type == "transferIn" || tx.type == "transferOut" {
            let value: Double
            if CryptoMath.isCashLike(tx.token, tags: tags) {
                value = stableValue(tx)
            } else if let px = arrivalPrice(tx.token, tx.date) {
                value = tx.amount * px
            } else {
                continue
            }
            let day = String(tx.date.prefix(10))
            events.append((String(day.prefix(7)), day, tx.token,
                           tx.type == "transferIn" ? value : -value))
        }
        return events
    }

    static func yieldEvents(
        txs: [CryptoTransaction],
        tags: [String: Bool],
        exclusions: Set<String> = []
    ) -> [YieldEvent] {
        let arrivalPrice = nearestPrices(txs)
        var earnRule = EarnRule(txs, exclusions: exclusions)
        var events: [YieldEvent] = []
        // Date order so the venue-move multiset consumes rows the same way
        // compute() does.
        for tx in txs.sorted(by: { $0.date < $1.date }) {
            guard tx.type == "transferIn" || tx.type == "transferOut",
                  earnRule.countsAsEarn(tx) else { continue }
            let value: Double
            if CryptoMath.isCashLike(tx.token, tags: tags) {
                value = stableValue(tx)
            } else if let px = arrivalPrice(tx.token, tx.date) {
                value = tx.amount * px
            } else {
                continue // no price anywhere — cannot state a value honestly
            }
            events.append(YieldEvent(
                date: String(tx.date.prefix(10)),
                token: tx.token,
                usd: tx.type == "transferIn" ? value : -value,
                notes: tx.notes,
                key: earnKey(tx)
            ))
        }
        return events.sorted { $0.date > $1.date }
    }
}

/// The split, as a card on the Performance page's crypto tab.
struct CryptoSplitCard: View {
    @Environment(DataStore.self) private var store

    private var split: CryptoSplit.Split {
        CryptoSplit.compute(
            txs: store.cryptoTxs,
            tags: store.stablecoinTags,
            livePrice: { store.livePrices[$0] },
            exclusions: store.earnExclusions
        )
    }

    var body: some View {
        let s = split
        VStack(alignment: .leading, spacing: 10) {
            Text("Where crypto P&L comes from").labelMono()

            row("Earn & bot income", "pre-Aug-5 transfer-ins + rows marked E / Earn", s.netYieldUsd, emphasize: true)
            row("Trading · realized", "locked in by sells", s.realizedUsd)
            row("Trading · unrealized", "bags vs cost incl. arrival value", s.unrealizedUsd)

            Divider().overlay(Color.white.opacity(0.1))

            row("Net", "the whole journey", s.netUsd, emphasize: true)

            NavigationLink(value: MoreRoute.coinPnl) {
                HStack(spacing: 6) {
                    Image(systemName: "bitcoinsign.circle")
                        .font(.system(size: 11))
                    Text("Trading by coin")
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
                    Text("Earn income · by token & ledger")
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
            Text("before 5 Aug 2026 every transfer-in counts as earn (the old CMC habit) — venue moves that bounce back out are auto-excluded, and an x note vetoes a row that was really your own deposit · from 5 Aug only rows marked E / Earn count · marked outs subtract")
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

/// Earn income: what the bots and Earn actually PAID you — by token, then
/// the full transfer ledger. This is the page for "tf in USDT x, ETH y".
struct BotIncomeView: View {
    @Environment(DataStore.self) private var store
    @State private var removalCandidate: CryptoSplit.YieldEvent?

    private var events: [CryptoSplit.YieldEvent] {
        CryptoSplit.yieldEvents(
            txs: store.cryptoTxs,
            tags: store.stablecoinTags,
            exclusions: store.earnExclusions
        )
    }

    /// The rows the user has taken off — computed from the unfiltered set so
    /// they stay visible (and restorable) at the bottom of the page.
    private var removedEvents: [CryptoSplit.YieldEvent] {
        guard !store.earnExclusions.isEmpty else { return [] }
        return CryptoSplit.yieldEvents(txs: store.cryptoTxs, tags: store.stablecoinTags)
            .filter { store.earnExclusions.contains($0.key) }
    }

    /// Net earn per token, biggest first — USDT (the bots) beside the
    /// in-kind payers (ETH, BTC…).
    private var byToken: [(token: String, net: Double, count: Int)] {
        var totals: [String: (Double, Int)] = [:]
        for event in events {
            var t = totals[event.token] ?? (0, 0)
            t.0 += event.usd
            if event.usd > 0 { t.1 += 1 }
            totals[event.token] = t
        }
        return totals.map { ($0.key, $0.value.0, $0.value.1) }
            .filter { abs($0.1) > 0.5 }
            .sorted { $0.1 > $1.1 }
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
                    Text("Bots + Earn · everything they paid you").labelMono()
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

            if events.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No earn yet").font(.headline)
                        Text("Transfer-ins recorded before 5 Aug 2026 count automatically (that was the CMC habit). From then on, put E (or Earn) in a transfer's note — bot payouts, Earn interest, rewards — and it appears here.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            } else {
                Section {
                    Text("pre-5 Aug 2026: transfer-ins count as earn (venue moves excluded, note x on a row to veto it) · after: only rows marked E / Earn")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .listRowBackground(Color.clear)
                }
            }

            Section("By token") {
                ForEach(byToken, id: \.token) { row in
                    HStack(spacing: 10) {
                        LogoCircle(url: store.coinImageURL(row.token), fallback: row.token, size: 26)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(row.token).font(.subheadline.weight(.semibold))
                            Text("\(row.count) payout\(row.count == 1 ? "" : "s")")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("\(row.net >= 0 ? "+" : "")\(store.format(store.convert(row.net, from: "USD"), compact: true))")
                            .font(.system(.footnote, design: .monospaced, weight: .semibold))
                            .foregroundStyle(row.net >= 0 ? Ledger.income : Ledger.expense)
                    }
                    .padding(.vertical, 2)
                }
            }

            ForEach(months, id: \.key) { month in
                Section {
                    ForEach(month.items) { event in
                        // Tap = "this wasn't earn" — the manual veto for
                        // backfilled rows the CMC habit swept in wrongly.
                        Button {
                            removalCandidate = event
                        } label: {
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
                        .buttonStyle(.plain)
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

            if !removedEvents.isEmpty {
                Section {
                    ForEach(removedEvents) { event in
                        Button {
                            Task { await store.setEarnExcluded(event.key, false) }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "arrow.uturn.backward.circle")
                                    .font(.system(size: 14))
                                    .foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("\(event.token) · \(SydneyTime.shortLabel(event.date))")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    Text("tap to count it as earn again")
                                        .font(.caption2).foregroundStyle(.tertiary)
                                }
                                Spacer()
                                Text(store.format(store.convert(abs(event.usd), from: "USD"), compact: true))
                                    .font(.system(.footnote, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                                    .strikethrough()
                            }
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Removed by you · not earn")
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
        .toolbar { ToolbarItem(placement: .topBarTrailing) { FxChip() } }
        .navigationTitle("Earn income")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            removalCandidate.map { "\($0.token) · \(store.format(store.convert(abs($0.usd), from: "USD"), compact: true)) on \(SydneyTime.shortLabel($0.date))" } ?? "",
            isPresented: Binding(
                get: { removalCandidate != nil },
                set: { if !$0 { removalCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Not earn — remove it", role: .destructive) {
                if let event = removalCandidate {
                    Task { await store.setEarnExcluded(event.key, true) }
                }
                removalCandidate = nil
            }
            Button("Cancel", role: .cancel) { removalCandidate = nil }
        } message: {
            Text("Removed rows stop counting everywhere (totals, per-token, this ledger) and move to the bottom of this page, where a tap restores them.")
        }
    }
}


/// Every coin's verdict: what it realized, what its bag is doing, the net.
struct CoinPnlView: View {
    @Environment(DataStore.self) private var store

    private var rows: [CryptoSplit.CoinPnl] {
        CryptoSplit.perCoin(
            txs: store.cryptoTxs,
            tags: store.stablecoinTags,
            livePrice: { store.livePrices[$0] },
            exclusions: store.earnExclusions
        )
    }

    var body: some View {
        let winners = rows.filter { $0.netUsd >= 0 }
        let losers = rows.filter { $0.netUsd < 0 }

        List {
            Section {
                let total = rows.reduce(0) { $0 + $1.netUsd }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Trading net · buys & sells only").labelMono()
                    MoneyText(
                        amount: store.convert(total, from: "USD"),
                        currency: store.displayCurrency,
                        tint: total >= 0 ? Ledger.income : Ledger.expense
                    )
                    Text("realized + unrealized · transfers carry arrival-price basis · earn (pre-Aug-5 ins + marked E) lives on its own page")
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
        .toolbar { ToolbarItem(placement: .topBarTrailing) { FxChip() } }
        .navigationTitle("Trading by coin")
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
