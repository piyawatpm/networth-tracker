import Foundation

/// Fast parser for snapshot timestamps — "yyyy-MM-dd HH:mm:ss",
/// "yyyy-MM-dd HH:mm" or bare "yyyy-MM-dd", pinned to Sydney wall time
/// exactly like the DateFormatter trio it replaces.
///
/// Why it exists: DateFormatter costs ~60µs per parse, and a cold launch
/// parses the ~60k cached snapshot rows several times over — measured at
/// 9.2 seconds of main-thread freeze. Scanning the digits by hand and doing
/// the calendar math directly is ~50× faster and produces the identical
/// instant (verified against the formatter across two years of timestamps,
/// including both DST transitions).
///
/// The one deliberate divergence: during the fall-back hour (first Sunday of
/// April, 2:00–2:59 occurs twice) a wall-clock string is genuinely ambiguous.
/// The formatter picks one offset, this picks the post-transition one —
/// at worst a one-hour x-shift for a handful of points, twice a year.
enum SnapshotDate {
    /// Mirrors SydneyTime.zone — kept self-contained so the parser compiles
    /// standalone in the equivalence harness.
    static let zone = TimeZone(identifier: "Australia/Sydney")!

    static func parse(_ string: String) -> Date? {
        // Digit runs, in order: y m d [h] [min] [sec]. Separators don't
        // matter, which also tolerates the "yyyy-MM-ddTHH:mm" shape.
        var nums = [0, 0, 0, 0, 0, 0]
        var index = 0
        var current = 0
        var inNumber = false
        for byte in string.utf8 {
            if byte >= 48, byte <= 57 {
                current = current * 10 + Int(byte - 48)
                inNumber = true
            } else if inNumber {
                if index < 6 { nums[index] = current }
                index += 1
                current = 0
                inNumber = false
                if index >= 6 { break }
            }
        }
        if inNumber, index < 6 { nums[index] = current; index += 1 }

        guard index >= 3 else { return nil }
        let y = nums[0], m = nums[1], d = nums[2]
        let h = index > 3 ? nums[3] : 0
        let minute = index > 4 ? nums[4] : 0
        let second = index > 5 ? nums[5] : 0
        guard y >= 1970, m >= 1, m <= 12, d >= 1, d <= 31,
              h < 24, minute < 60, second < 60 else { return nil }

        // Wall-clock seconds as if the string were UTC…
        let wall = Double(daysFromCivil(y: y, m: m, d: d)) * 86400
            + Double(h * 3600 + minute * 60 + second)
        // …then shift by Sydney's offset at that instant. Two passes converge
        // across a DST boundary: the first guess uses the offset at the wall
        // time, the second re-queries at the corrected instant.
        let first = Double(zone.secondsFromGMT(for: Date(timeIntervalSince1970: wall)))
        var epoch = wall - first
        let second_ = Double(zone.secondsFromGMT(for: Date(timeIntervalSince1970: epoch)))
        if second_ != first { epoch = wall - second_ }
        return Date(timeIntervalSince1970: epoch)
    }

    /// Day of week for a "yyyy-MM-dd…" string: 0 = Sunday … 6 = Saturday.
    /// Integer math, so it's safe to call per row on a whole ledger.
    static func weekdayIndex(_ ymd: String) -> Int? {
        let parts = ymd.prefix(10).split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2])
        else { return nil }
        // 1970-01-01 was a Thursday (index 4).
        return ((daysFromCivil(y: y, m: m, d: d) % 7) + 7 + 4) % 7
    }

    /// Days between 1970-01-01 and the given civil date (Howard Hinnant's
    /// branchless algorithm — proleptic Gregorian, exact for all our years).
    private static func daysFromCivil(y: Int, m: Int, d: Int) -> Int {
        let year = m <= 2 ? y - 1 : y
        let era = (year >= 0 ? year : year - 399) / 400
        let yoe = year - era * 400
        let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }
}
