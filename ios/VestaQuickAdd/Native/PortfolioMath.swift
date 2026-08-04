import Foundation

// Port of lib/utils/portfolio-transactions.ts — the average-cost replay. The
// TS version is the reference implementation (it has the test suite); this
// stays a line-for-line translation so the two can be diffed by eye.

struct DerivedPosition {
    var units: Double = 0
    var costBasis: Double = 0
    var realizedPnl: Double = 0
    var totalBought: Double = 0
    var totalSold: Double = 0
}

struct RealizedSale: Identifiable {
    let id: String
    let source: String // "stocks" | "crypto"
    let date: String
    let label: String
    let ticker: String
    let realized: Double
    let currency: String
}

enum PortfolioMath {
    /// Average-cost replay. Realized on a sell = proceeds − avgCost × sold;
    /// oversells are clamped so a stray log row can't invent a cost basis.
    static func derivePosition(
        _ transactions: [PortfolioTransaction],
        onSale: ((PortfolioTransaction, Double) -> Void)? = nil
    ) -> DerivedPosition {
        let sorted = transactions.sorted {
            $0.date != $1.date ? $0.date < $1.date : $0.createdAt < $1.createdAt
        }
        var p = DerivedPosition()
        for tx in sorted {
            if tx.type == "buy" {
                p.units += tx.units
                p.costBasis += tx.totalAmount
                p.totalBought += tx.units
            } else {
                let soldUnits = p.units > 0 ? min(tx.units, p.units) : 0
                let avgCost = p.units > 0 ? p.costBasis / p.units : 0
                let costOfSold = avgCost * soldUnits
                let gain = tx.totalAmount - costOfSold
                p.realizedPnl += gain
                p.costBasis = max(0, p.costBasis - costOfSold)
                p.units -= tx.units
                p.totalSold += tx.units
                onSale?(tx, gain)
            }
        }
        if abs(p.units) < 1e-9 { p.units = 0 }
        if p.costBasis < 1e-9 { p.costBasis = 0 }
        return p
    }

    /// One realized event per sell, per holding, in the holding's own quote
    /// currency — feeds the income page's derived rows.
    static func realizedSales(
        _ transactions: [PortfolioTransaction],
        // @escaping because it's captured by derivePosition's onSale closure,
        // which is Optional and therefore escaping by definition.
        tickerFor: @escaping (String) -> String?
    ) -> [RealizedSale] {
        var byHolding: [String: [PortfolioTransaction]] = [:]
        for tx in transactions {
            byHolding[tx.holdingId, default: []].append(tx)
        }

        var events: [RealizedSale] = []
        for (holdingId, group) in byHolding {
            let currency = group.min {
                $0.date != $1.date ? $0.date < $1.date : $0.createdAt < $1.createdAt
            }?.currency ?? "AUD"
            _ = derivePosition(group) { tx, realized in
                guard abs(realized) >= 0.01 else { return }
                events.append(RealizedSale(
                    id: "rp-stocks-\(tx.id)",
                    source: "stocks",
                    date: tx.date,
                    label: tx.holdingName,
                    ticker: tickerFor(holdingId) ?? tx.holdingName,
                    realized: realized,
                    currency: currency
                ))
            }
        }
        return events
    }
}
