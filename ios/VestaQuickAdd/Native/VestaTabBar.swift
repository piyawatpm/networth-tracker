import SwiftUI

struct VestaTab: Identifiable, Equatable {
    let id: Int
    let title: String
    let icon: String
}

/// Custom Liquid Glass tab bar built around one gesture: touch anywhere on the
/// bar and either tap a tab or HOLD AND DRAG — the selection scrubs under your
/// finger with a haptic tick per tab, and the glass indicator stretches while
/// dragging like it's being pulled. A system TabView can't do any of that.
struct VestaTabBar: View {
    let tabs: [VestaTab]
    @Binding var selection: Int
    @State private var isDragging = false

    var body: some View {
        GeometryReader { geo in
            let slot = geo.size.width / CGFloat(tabs.count)

            ZStack(alignment: .topLeading) {
                // The Liquid Glass selection lens: a real material, so it
                // refracts what's behind it instead of compositing as a flat
                // white blob (the bug the old tinted fill had). Slides on a
                // continuous offset and stretches while the finger drags.
                Capsule()
                    .fill(.ultraThinMaterial)
                    .overlay(
                        Capsule().fill(Ledger.income.opacity(0.14))
                    )
                    .overlay(
                        Capsule().strokeBorder(
                            LinearGradient(
                                colors: [.white.opacity(0.35), .white.opacity(0.05)],
                                startPoint: .top, endPoint: .bottom
                            ),
                            lineWidth: 0.8
                        )
                    )
                    .shadow(color: .black.opacity(0.12), radius: 5, y: 2)
                    .frame(width: slot - 10, height: geo.size.height - 12)
                    .scaleEffect(isDragging ? 1.12 : 1)
                    .offset(x: CGFloat(selection) * slot + 5, y: 6)
                    .animation(.snappy(duration: 0.3, extraBounce: 0.18), value: selection)
                    .animation(.snappy(duration: 0.2), value: isDragging)

                HStack(spacing: 0) {
                    ForEach(tabs) { tab in
                        VStack(spacing: 3) {
                            Image(systemName: tab.icon)
                                .font(.system(size: 19, weight: .medium))
                                .symbolVariant(tab.id == selection ? .fill : .none)
                                .symbolEffect(.bounce, value: tab.id == selection)
                            Text(tab.title)
                                .font(.system(size: 9, weight: .semibold, design: .rounded))
                        }
                        .foregroundStyle(tab.id == selection ? Ledger.income : Color.secondary)
                        .frame(width: slot, height: geo.size.height)
                        .scaleEffect(tab.id == selection && isDragging ? 1.1 : 1)
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(.rect)
            // minimumDistance 0 = the same gesture serves taps and scrubs.
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let index = min(
                            tabs.count - 1,
                            max(0, Int(value.location.x / slot))
                        )
                        if index != selection {
                            withAnimation(.snappy(duration: 0.28, extraBounce: 0.12)) {
                                selection = index
                            }
                        }
                        if !isDragging {
                            withAnimation(.snappy(duration: 0.2)) { isDragging = true }
                        }
                    }
                    .onEnded { _ in
                        withAnimation(.spring(duration: 0.35, bounce: 0.3)) {
                            isDragging = false
                        }
                    }
            )
        }
        .frame(height: 58)
        .glassEffect(.regular, in: .capsule)
        .overlay(
            Capsule().strokeBorder(Color.primary.opacity(0.06))
        )
        .padding(.horizontal, 24)
        .sensoryFeedback(.selection, trigger: selection)
        .accessibilityElement(children: .contain)
    }
}
