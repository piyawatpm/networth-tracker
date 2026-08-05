import Foundation

// Ports of lib/utils/fx.ts, timezone.ts and performance.ts (xirr). Kept as
// literal translations — when a number here disagrees with the web app, the
// bug is a port divergence, so the less creative the Swift, the better.

enum Money {
    /// ALL_CURRENCIES subset that actually appears in the data.
    static let symbols: [String: String] = [
        "AUD": "A$", "USD": "$", "THB": "฿", "EUR": "€", "GBP": "£",
        "JPY": "¥", "SGD": "S$", "HKD": "HK$", "NZD": "NZ$", "CAD": "C$",
    ]

    static func symbol(_ currency: String) -> String {
        symbols[currency] ?? currency
    }

    /// USD-based cross rates, same as fx.ts: rates[X] = units of X per 1 USD.
    nonisolated(unsafe) static var rates: [String: Double] = [:]

    static func convert(_ amount: Double, from: String, to: String) -> Double {
        if from == to || rates.isEmpty { return amount }
        let fromRate = rates[from] ?? 1
        let toRate = rates[to] ?? 1
        return (amount / fromRate) * toRate
    }

    static func format(_ amount: Double, currency: String, compact: Bool = false) -> String {
        let sign = amount < 0 ? "−" : ""
        let abs = Swift.abs(amount)
        if compact && abs >= 1_000_000 {
            return "\(sign)\(symbol(currency))\(String(format: "%.1f", abs / 1_000_000))M"
        }
        if compact && abs >= 1_000 {
            return "\(sign)\(symbol(currency))\(String(format: "%.1f", abs / 1_000))K"
        }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        let body = formatter.string(from: NSNumber(value: abs)) ?? String(format: "%.2f", abs)
        return "\(sign)\(symbol(currency))\(body)"
    }
}

enum SydneyTime {
    static let zone = TimeZone(identifier: "Australia/Sydney")!

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func today() -> String {
        dayFormatter.string(from: Date())
    }

    /// "yyyy-MM-dd" in Sydney, for any instant.
    static func dayString(_ date: Date) -> String {
        dayFormatter.string(from: date)
    }

    static func monthKey(_ dateString: String) -> String {
        String(dateString.prefix(7))
    }

    static func currentMonthKey() -> String {
        String(today().prefix(7))
    }

    /// "2026-08-04" → "4 Aug" for row display.
    static func shortLabel(_ dateString: String) -> String {
        guard let date = dayFormatter.date(from: String(dateString.prefix(10))) else {
            return dateString
        }
        let f = DateFormatter()
        f.timeZone = zone
        f.dateFormat = "d MMM"
        return f.string(from: date)
    }
}

// MARK: - XIRR (port of lib/utils/performance.ts)

struct CashFlow {
    let date: String // YYYY-MM-DD
    let amount: Double // negative = money in, positive = money out/final value
}

/// Annualized money-weighted return. Newton-Raphson from 10%, bisection
/// fallback on [-0.9999, 1e6]. Nil when <2 flows, no sign change, span < 30
/// days, or no convergence — same guards as the web.
func xirr(_ flows: [CashFlow]) -> Double? {
    guard flows.count >= 2 else { return nil }
    let sorted = flows.sorted { $0.date < $1.date }
    guard sorted.contains(where: { $0.amount > 0 }),
          sorted.contains(where: { $0.amount < 0 }) else { return nil }

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM-dd"
    guard let t0 = formatter.date(from: sorted[0].date) else { return nil }

    let times = sorted.compactMap { flow -> (years: Double, amount: Double)? in
        guard let d = formatter.date(from: flow.date) else { return nil }
        return (d.timeIntervalSince(t0) / (365.25 * 86400), flow.amount)
    }
    guard times.count == sorted.count,
          let last = times.last, last.years * 365.25 >= 30 else { return nil }

    func npv(_ rate: Double) -> Double {
        times.reduce(0) { $0 + $1.amount / pow(1 + rate, $1.years) }
    }
    func derivative(_ rate: Double) -> Double {
        times.reduce(0) { $0 - $1.years * $1.amount / pow(1 + rate, $1.years + 1) }
    }

    var rate = 0.1
    for _ in 0..<50 {
        let value = npv(rate)
        if Swift.abs(value) < 1e-7 { return rate }
        let slope = derivative(rate)
        if Swift.abs(slope) < 1e-12 { break }
        let next = rate - value / slope
        if next <= -1 || next.isNaN || next.isInfinite { break }
        if Swift.abs(next - rate) < 1e-9 { return next }
        rate = next
    }

    var lo = -0.9999, hi = 1e6
    var fLo = npv(lo)
    guard fLo * npv(hi) < 0 else { return nil }
    for _ in 0..<200 {
        let mid = (lo + hi) / 2
        let fMid = npv(mid)
        if Swift.abs(fMid) < 1e-7 { return mid }
        if fLo * fMid < 0 { hi = mid } else { lo = mid; fLo = fMid }
    }
    return nil
}
