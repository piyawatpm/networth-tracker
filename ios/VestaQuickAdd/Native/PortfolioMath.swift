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

    /// A holding after its transaction log moved from `before` to `after`,
    /// exactly like the web page reconciles: units and cost move by the replay
    /// delta, keeping any baseline the log doesn't explain, and value rescales
    /// at the last-known price per unit. This matters most for super — its
    /// balance is units × price (cron), so a buy that doesn't grow units would
    /// be erased by the next reprice and the contribution would read as an
    /// instant loss on the perf page.
    static func reconcile(
        _ holding: PortfolioHolding, before: DerivedPosition, after: DerivedPosition
    ) -> PortfolioHolding {
        var holding = holding
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
        return holding
    }

    /// The portfolio_holdings change that follows a transaction-log write:
    /// the SERVER's current holding, moved by exactly what that write changed.
    /// `logBefore` is the server log the write was applied to and `logAfter`
    /// the merged log it wrote — both from the same winning read, so entries
    /// another device logged are in both and cancel out, and a replayed
    /// (no-op) write moves nothing. Only units, cost and value are written.
    /// Nil when nothing moved or the holding no longer exists on the server.
    static func holdingChange(
        holdingId: String, logBefore: [JSONValue], logAfter: [JSONValue], holdings: [JSONValue]
    ) throws -> ListChange? {
        func position(_ log: [JSONValue]) -> DerivedPosition {
            derivePosition(ListBlob.decodeEach(
                PortfolioTransaction.self,
                from: log.filter { $0["holdingId"]?.stringValue == holdingId }
            ))
        }
        let before = position(logBefore)
        let after = position(logAfter)
        guard before.units != after.units || before.costBasis != after.costBasis else { return nil }

        guard let stored = holdings.first(where: { $0["id"]?.stringValue == holdingId }) else {
            return nil
        }
        guard let holding = try? stored.decode(PortfolioHolding.self) else {
            throw ListBlobError.badRecord("holding \(holdingId) on the server couldn't be read")
        }
        let next = reconcile(holding, before: before, after: after)
        return ListChange(upserts: [.patch(id: holdingId, [
            "units": .number(next.units),
            "amountInvested": .number(next.amountInvested),
            "currentValue": .number(next.currentValue),
        ])])
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

// MARK: - Saving a transaction: log it, then move its holding

/// What one logged transaction still owes its holding: the transaction log
/// before and after the write that saved it (see PortfolioMath.holdingChange).
struct HoldingMove: Equatable, Sendable {
    let holdingId: String
    let logBefore: [JSONValue]
    let logAfter: [JSONValue]

    init(holdingId: String, logBefore: [JSONValue], logAfter: [JSONValue]) {
        self.holdingId = holdingId
        self.logBefore = logBefore
        self.logAfter = logAfter
    }

    /// From the log write of `tx`. `logMayHaveLanded`: an earlier write of this
    /// same transaction threw, so it may already sit in the log without its
    /// holding ever having moved — every stored version of it then counts as
    /// not yet reflected in the holding.
    init(tx: PortfolioTransaction, written: ListCommit, logMayHaveLanded: Bool) throws {
        let before = try ListBlob.parse(Data(written.previous.utf8), key: "portfolio_transactions")
        let after = try ListBlob.parse(Data(written.value.utf8), key: "portfolio_transactions")
        self.init(
            holdingId: tx.holdingId,
            logBefore: logMayHaveLanded ? before.filter { $0["id"]?.stringValue != tx.id } : before,
            logAfter: after
        )
    }

    /// The portfolio_holdings change, against the server's current holdings.
    func change(for holdings: [JSONValue]) throws -> ListChange? {
        try PortfolioMath.holdingChange(
            holdingId: holdingId, logBefore: logBefore, logAfter: logAfter, holdings: holdings
        )
    }
}

/// The transaction IS saved; only its holding wasn't updated. Saving the same
/// transaction again (Retry) runs just the holding write.
struct HoldingNotUpdated: LocalizedError {
    let reason: String
    var errorDescription: String? {
        // The underlying write errors read "Not saved: …", which would
        // contradict the first line — drop that prefix, keep the why.
        let prefix = "Not saved: "
        let why = reason.hasPrefix(prefix) ? String(reason.dropFirst(prefix.count)) : reason
        return "Transaction saved — holding not updated. Tap Retry.\n\(why)"
    }
}

/// A second save of a transaction that is still being saved (double tap).
struct SaveInProgress: LocalizedError {
    var errorDescription: String? { "Already saving this transaction." }
}

/// Saving a transaction is two list writes — log it, then move its holding —
/// and either can fail on its own. The ledger remembers, per transaction id,
/// what a save still owes, so saving the SAME transaction again (the form keeps
/// one id for its lifetime) never logs it twice and never moves the holding
/// twice:
/// - holding write failed → the move is kept (`owed`); a retry runs ONLY the
///   holding write, with the logs from the original save;
/// - log write threw → it may have landed (`uncertain`); the retry re-saves
///   the transaction (idempotent by id) and moves the holding by its whole
///   effect, since its holding step never ran;
/// - log write was a no-op (already saved, holding already moved) → nothing.
///
/// Not covered: a holding write that LANDED but whose response was lost looks
/// like a failure, and its Retry moves the holding again — the client can't
/// tell the two apart.
@MainActor
final class PortfolioTxLedger {
    private(set) var owed: [String: HoldingMove] = [:]
    private(set) var uncertain: Set<String> = []
    private var inFlight: Set<String> = []

    func save(
        _ tx: PortfolioTransaction,
        writeLog: (ListUpsert) async throws -> ListCommit,
        writeHolding: (HoldingMove) async throws -> Void
    ) async throws {
        guard !inFlight.contains(tx.id) else { throw SaveInProgress() }
        inFlight.insert(tx.id)
        defer { inFlight.remove(tx.id) }

        if owed[tx.id] == nil {
            let upsert = try ListUpsert(record: tx)
            do {
                let written = try await writeLog(upsert)
                owed[tx.id] = try HoldingMove(
                    tx: tx, written: written, logMayHaveLanded: uncertain.contains(tx.id)
                )
                uncertain.remove(tx.id)
            } catch {
                // May have landed anyway; its holding step certainly didn't run.
                uncertain.insert(tx.id)
                throw error
            }
        }
        guard let move = owed[tx.id] else { return }
        do {
            try await writeHolding(move)
            owed[tx.id] = nil
        } catch {
            throw HoldingNotUpdated(reason: error.localizedDescription)
        }
    }
}
