import SwiftUI
import Charts

/// Crypto pot: holdings replayed from the tx CSV, valued with the same
/// crypto_prices blob the web app persists (the web's WebSocket feeds keep it
/// fresh; pull-to-refresh re-reads it).
struct CryptoSection: View {
    @Environment(DataStore.self) private var store

    private var rows: [DataStore.CryptoDisplayRow] { store.cryptoDisplayRows }
    private var investedRows: [DataStore.CryptoDisplayRow] { rows.filter { !$0.isCash } }
    private var cashRows: [DataStore.CryptoDisplayRow] { rows.filter(\.isCash) }

    var body: some View {
        VStack(spacing: 12) {
            // Same interactive chart as the dashboard, fed by the crypto
            // snapshot series.
            HistoryChartCard(
                title: "Crypto",
                parsed: store.cryptoParsed,
                liveValue: store.cryptoValue,
                heroSize: 32
            )
            .entranceTransition()

            // Investments vs the stable cash layer, same split the web uses —
            // plus the unrealized verdict on the invested pot, so realized
            // (card below) and unrealized are both one glance away.
            HStack(spacing: 14) {
                potBadge(
                    "Invested",
                    investedRows.reduce(0) { $0 + $1.valueUsd },
                    Ledger.chartColor(12)
                )
                potBadge(
                    "Cash (stables)",
                    cashRows.reduce(0) { $0 + $1.valueUsd },
                    Ledger.chartColor(5)
                )
                Spacer()
                unrealizedBadge(
                    investedRows.reduce(0) { $0 + $1.pnlUsd },
                    cost: investedRows.reduce(0) { $0 + $1.costUsd }
                )
            }
            .padding(14)
            .financeCard()
            .entranceTransition()

            // The web page's allocation donut: top coins + Other, cash
            // included — it is part of the pot.
            if rows.count > 1 {
                AllocationDonutCard(
                    title: "Allocation",
                    modes: [("Coins", coinSlices)],
                    centerNoun: "coins"
                )
                .entranceTransition()
            }

            // The web crypto page's Realized P&L card: avg-buy replay over the
            // tx CSV, sells and transfer-outs alike, exited coins included.
            // In USD like everything crypto, converted for display.
            if !store.cryptoTxs.isEmpty {
                let realized = CryptoMath.computeRealizedPnl(store.cryptoTxs)
                RealizedPnlCard(
                    rows: realized.byToken.map {
                        RealizedPnlCard.Row(
                            id: $0.token,
                            name: $0.token,
                            ticker: "",
                            value: store.convert($0.realizedPnlUsd, from: "USD")
                        )
                    },
                    countNoun: "token",
                    emptyHint: "",
                    zeroHeaderWhenEmpty: true
                )
                .entranceTransition()
            }

            if rows.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "bitcoinsign.circle")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Upload your transaction CSV on the web app to populate this.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(24)
                .frame(maxWidth: .infinity)
                .financeCard()
            }

            let portTotal = rows.reduce(0) { $0 + $1.valueUsd }
            ForEach(rows) { row in
                // Same fields as the web's holdings card: amount @ price up
                // top, value on the right, then P&L (abs + %) against the
                // share of the portfolio.
                VStack(spacing: 8) {
                    HStack(spacing: 10) {
                        LogoCircle(url: store.coinImageURL(row.token), fallback: row.token)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 5) {
                                Text(row.token).font(.subheadline.weight(.semibold))
                                if row.isCash {
                                    Text("CASH")
                                        .font(.system(size: 9, design: .monospaced))
                                        .padding(.horizontal, 5).padding(.vertical, 2)
                                        .background(.primary.opacity(0.08), in: .capsule)
                                } else if row.isLive {
                                    // Priced by Binance seconds ago, not the CSV.
                                    Circle().fill(Ledger.income).frame(width: 5, height: 5)
                                }
                            }
                            Text(amountLine(row))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(store.format(store.convert(row.valueUsd, from: "USD"), compact: true))
                            .font(.system(.footnote, design: .monospaced, weight: .semibold))
                    }
                    HStack {
                        if !row.isCash && row.costUsd > 0 {
                            Text("\(row.pnlUsd >= 0 ? "+" : "")\(store.format(store.convert(row.pnlUsd, from: "USD"), compact: true))  \(row.pnlUsd >= 0 ? "+" : "")\(String(format: "%.1f", row.pnlUsd / row.costUsd * 100))%")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(row.pnlUsd >= 0 ? Ledger.income : Ledger.expense)
                        }
                        Spacer()
                        if portTotal > 0 {
                            Text(String(format: "%.1f%% of port", row.valueUsd / portTotal * 100))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                .padding(14)
                .financeCard()
                .entranceTransition()
            }

            // The web page's "By Exchange" section — driven by the exchange
            // names hand-set on the web (crypto_exchange_overrides).
            if !exchangeBars.isEmpty {
                BreakdownBarsCard(title: "By exchange", rows: exchangeBars)
                    .entranceTransition()
            }
        }
    }

    /// Top six coins + Other, display currency — the donut's diet.
    private var coinSlices: [AllocationSlice] {
        let sorted = rows.sorted { $0.valueUsd > $1.valueUsd }
        var slices = sorted.prefix(6).enumerated().map { index, row in
            AllocationSlice(
                name: row.token,
                value: store.convert(row.valueUsd, from: "USD"),
                color: Ledger.chartColor(index)
            )
        }
        let rest = sorted.dropFirst(6).reduce(0) { $0 + $1.valueUsd }
        if rest > 0 {
            slices.append(AllocationSlice(
                name: "Other",
                value: store.convert(rest, from: "USD"),
                color: Ledger.chartColor(6)
            ))
        }
        return slices
    }

    /// Value per exchange, display currency. Rendered only once at least one
    /// token has an exchange assigned — an all-Unassigned card says nothing.
    private var exchangeBars: [BreakdownBar] {
        var byExchange: [String: (value: Double, count: Int)] = [:]
        var assigned = false
        for row in rows {
            let name = store.exchangeOverrides[row.token]?
                .trimmingCharacters(in: .whitespaces) ?? ""
            if !name.isEmpty { assigned = true }
            let key = name.isEmpty ? "Unassigned" : name
            var entry = byExchange[key] ?? (0, 0)
            entry.value += store.convert(row.valueUsd, from: "USD")
            entry.count += 1
            byExchange[key] = entry
        }
        guard assigned else { return [] }
        return byExchange
            .map { BreakdownBar(name: $0.key, count: $0.value.count, value: $0.value.value) }
            .sorted { $0.value > $1.value }
    }

    /// "0.5182 @ $3,421.55" — the web card's amount line. Sub-$1 tokens keep
    /// four decimals so meme-coin prices don't collapse to $0.00.
    private func amountLine(_ row: DataStore.CryptoDisplayRow) -> String {
        let amount = String(format: "%.6g", row.amount)
        guard row.amount > 0, !row.isCash else { return amount }
        let price = row.valueUsd / row.amount
        let priceText = price < 1
            ? String(format: "$%.4f", price)
            : "$" + Self.priceFormatter.string(from: NSNumber(value: price))!
        return "\(amount) @ \(priceText)"
    }

    private static let priceFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()

    private func potBadge(_ label: String, _ usd: Double, _ tint: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(tint).frame(width: 7, height: 7)
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(store.format(store.convert(usd, from: "USD"), compact: true))
                .font(.system(.caption2, design: .monospaced, weight: .medium))
        }
    }

    private func unrealizedBadge(_ pnlUsd: Double, cost: Double) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text("\(pnlUsd >= 0 ? "+" : "")\(store.format(store.convert(pnlUsd, from: "USD"), compact: true))")
                .font(.system(.caption2, design: .monospaced, weight: .semibold))
                .foregroundStyle(pnlUsd >= 0 ? Ledger.income : Ledger.expense)
            Text(cost > 0
                 ? "unrealized \(pnlUsd >= 0 ? "+" : "")\(String(format: "%.1f", pnlUsd / cost * 100))%"
                 : "unrealized")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
    }
}
