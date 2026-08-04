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

            // Investments vs the stable cash layer, same split the web uses.
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
            }
            .padding(14)
            .financeCard()
            .entranceTransition()

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

            ForEach(rows) { row in
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
                        Text(String(format: "%.6g", row.amount))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(store.format(store.convert(row.valueUsd, from: "USD"), compact: true))
                            .font(.system(.footnote, design: .monospaced, weight: .semibold))
                        if !row.isCash && row.costUsd > 0 {
                            let pct = row.pnlUsd / row.costUsd * 100
                            Text("\(pct >= 0 ? "+" : "")\(String(format: "%.1f", pct))%")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(pct >= 0 ? Ledger.income : Ledger.expense)
                        }
                    }
                }
                .padding(14)
                .financeCard()
                .entranceTransition()
            }
        }
    }

    private func potBadge(_ label: String, _ usd: Double, _ tint: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(tint).frame(width: 7, height: 7)
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(store.format(store.convert(usd, from: "USD"), compact: true))
                .font(.system(.caption2, design: .monospaced, weight: .medium))
        }
    }
}
