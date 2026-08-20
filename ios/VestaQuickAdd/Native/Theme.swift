import SwiftUI

/// OKX-style palette: pure black stage, elevated near-black cards, volt lime
/// for money-up, hot pink for money-down. Dark-only by design — RootView pins
/// the color scheme so every system control matches.
enum Ledger {
    static let background = Color(hex: "#000000")
    static let card = Color(hex: "#1A1A1D")
    static let income = Color(hex: "#CDF546") // volt
    static let expense = Color(hex: "#FB3D7B") // hot pink
    static let subtle = Color.white.opacity(0.55)

    // Chart series identity — categorical slots 1-3 of the reference palette,
    // validated all-pairs for CVD against this dark surface. Deliberately NOT
    // volt/pink: those carry polarity (gain/loss) and reusing them for series
    // identity both collides in meaning and failed CVD separation.
    static let seriesStocks = Color(hex: "#3987e5") // blue
    static let seriesCrypto = Color(hex: "#d95926") // orange
    static let seriesDebt = Color(hex: "#199e70")   // aqua

    /// CHART_COLORS from lib/utils/constants.ts, same order — category colors
    /// must match the web app or the same donut tells two different stories.
    static let chartHex: [String] = [
        "#b8860b", "#2e8b57", "#cd5c5c", "#8b5e3c", "#6b8e23", "#708090",
        "#9e5e8e", "#c4a35a", "#2e7d5b", "#c05040", "#5f6b80", "#c4943a",
        "#2e7d7b", "#4f7cac", "#8f6bb0",
    ]

    static func chartColor(_ index: Int) -> Color {
        Color(hex: chartHex[((index % chartHex.count) + chartHex.count) % chartHex.count])
    }

    /// Same deterministic fallback as the web's useCategories (hashCode % n),
    /// so custom categories keep their color across platforms.
    static func hashedColor(_ id: String) -> Color {
        var hash: Int32 = 0
        for scalar in id.unicodeScalars {
            hash = (hash << 5) &- hash &+ Int32(scalar.value)
        }
        return chartColor(Int(abs(hash)))
    }
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    init(light: String, dark: String) {
        self.init(uiColor: UIColor { trait in
            UIColor(Color(hex: trait.userInterfaceStyle == .dark ? dark : light))
        })
    }
}

// MARK: - Shared styling

/// OKX-style elevated card: near-black rounded surface on the pure-black stage.
struct FinanceCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Ledger.card, in: .rect(cornerRadius: 20))
            .overlay(
                RoundedRectangle(cornerRadius: 20)
                    .strokeBorder(Color.white.opacity(0.05))
            )
    }
}

/// The currency cycle chip (AUD → USD → THB), shared by every page's
/// toolbar. Writes through preferred_currency so the web app follows.
/// Toolbar-sized super toggle — same rank as the FX chip, so the choice is
/// always in reach without a card burning vertical space.
struct SuperChip: View {
    @Environment(DataStore.self) private var store

    var body: some View {
        Button {
            withAnimation(.spring(duration: 0.4)) {
                store.includeSuperStocks.toggle()
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: store.includeSuperStocks
                      ? "checkmark.circle.fill" : "slash.circle")
                    .font(.system(size: 11, weight: .bold))
                Text("Super")
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
            }
            .foregroundStyle(store.includeSuperStocks ? Ledger.income : .secondary)
            .fixedSize() // the toolbar would otherwise squeeze the label away
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Ledger.card, in: .capsule)
            .overlay(Capsule().strokeBorder(
                store.includeSuperStocks ? Ledger.income.opacity(0.35) : Color.white.opacity(0.08)
            ))
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.impact(weight: .light), trigger: store.includeSuperStocks)
    }
}

struct FxChip: View {
    @Environment(DataStore.self) private var store

    var body: some View {
        Button {
            let cycle = ["AUD", "USD", "THB"]
            let index = cycle.firstIndex(of: store.displayCurrency) ?? 2
            withAnimation(.spring(duration: 0.5)) {
                store.setDisplayCurrency(cycle[(index + 1) % cycle.count])
            }
        } label: {
            Text("\(Money.symbol(store.displayCurrency)) \(store.displayCurrency)")
                .font(.system(.subheadline, design: .monospaced, weight: .semibold))
                .foregroundStyle(.primary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Ledger.card, in: .capsule)
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.08)))
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.impact(weight: .light), trigger: store.displayCurrency)
    }
}

/// OKX's signed percent chip: tinted pill, volt for gains, pink for losses.
struct PctBadge: View {
    let percent: Double

    var body: some View {
        let tint = percent >= 0 ? Ledger.income : Ledger.expense
        Text("\(percent >= 0 ? "+" : "")\(String(format: "%.2f", percent))%")
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(tint.opacity(0.16), in: .rect(cornerRadius: 10))
    }
}

/// OKX's primary action: volt capsule, black bold label.
struct VoltButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .rounded, weight: .semibold))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                Ledger.income.opacity(configuration.isPressed ? 0.7 : 1),
                in: .capsule
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// The web app's `label-mono`: small uppercase mono section labels.
struct LabelMono: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .kerning(0.8)
            .foregroundStyle(Ledger.subtle)
    }
}

extension View {
    func financeCard() -> some View { modifier(FinanceCard()) }
    func labelMono() -> some View { modifier(LabelMono()) }

    /// Cards drift up + fade as they enter, the native cousin of BlurFade.
    func entranceTransition() -> some View {
        // Entrance ONLY. The symmetric version also faded cards at the TOP
        // edge — hiding a section the reader was mid-way through. Leaving
        // the viewport upward keeps full opacity; arriving from the bottom
        // gets the rise-and-sharpen.
        scrollTransition(
            topLeading: .identity,
            bottomTrailing: .animated(.spring(duration: 0.4))
        ) { content, phase in
            content
                .opacity(phase == .bottomTrailing ? 0 : 1)
                .offset(y: phase == .bottomTrailing ? 14 : 0)
                .blur(radius: phase == .bottomTrailing ? 3 : 0)
        }
    }
}

/// Big money figure. Deliberately NO contentTransition: numericText's
/// fallback blur-crossfade (which kicks in whenever the string shape changes,
/// e.g. an FX switch) reads as smearing. Crisp instant updates, like OKX.
struct MoneyText: View {
    let amount: Double
    let currency: String
    var font: Font = .system(size: 34, weight: .semibold, design: .rounded)
    var tint: Color? = nil

    var body: some View {
        Text(Money.format(amount, currency: currency))
            .font(font)
            .monospacedDigit()
            .foregroundStyle(tint ?? .primary)
    }
}

/// Loading shimmer for cards while the first blob fetch is in flight.
struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .redacted(reason: .placeholder)
            .overlay(
                GeometryReader { geo in
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.25), .clear],
                        startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: geo.size.width * 0.6)
                    .offset(x: phase * geo.size.width * 1.6)
                }
                .clipped()
            )
            .onAppear {
                withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

extension View {
    func shimmering() -> some View { modifier(Shimmer()) }
}

/// Decoded logos kept in memory across renders.
///
/// AsyncImage re-issues its load every time the row is rebuilt, so with live
/// prices ticking the holdings lists re-fetched and re-decoded ~19 logos over
/// and over. Once decoded, a logo never changes — cache it.
@MainActor
final class LogoCache {
    static let shared = LogoCache()
    private let cache = NSCache<NSURL, UIImage>()
    private var inFlight: Set<URL> = []

    func image(for url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    func load(_ url: URL) async -> UIImage? {
        if let hit = cache.object(forKey: url as NSURL) { return hit }
        guard !inFlight.contains(url) else { return nil }
        inFlight.insert(url)
        defer { inFlight.remove(url) }
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let image = UIImage(data: data) else { return nil }
        cache.setObject(image, forKey: url as NSURL)
        return image
    }
}

/// Circular asset logo with a monogram fallback, so rows never show a blank
/// hole while the image loads (or when a token has no image yet).
struct LogoCircle: View {
    let url: URL?
    let fallback: String
    var size: CGFloat = 26

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Circle()
                .fill(Ledger.hashedColor(fallback).opacity(0.22))
            Text(String(fallback.prefix(2)).uppercased())
                .font(.system(size: size * 0.34, weight: .bold, design: .rounded))
                .foregroundStyle(Ledger.hashedColor(fallback))
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(.circle)
            }
        }
        .frame(width: size, height: size)
        .task(id: url) {
            guard let url else { return }
            // Synchronous cache hit avoids a frame of the monogram flashing.
            if let hit = LogoCache.shared.image(for: url) {
                image = hit
                return
            }
            image = await LogoCache.shared.load(url)
        }
    }
}
