import ActivityKit
import SwiftUI
import WidgetKit

// Mirror of the app target's ExpenseActivityAttributes — ActivityKit pairs
// the two processes by type name + Codable shape, so this copy must stay
// byte-identical with Native/ExpenseActivity.swift.
struct ExpenseActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var amountText: String
        var vendor: String
        var category: String
        var queued: Bool
    }

    var id: String
}

private let ledgerGreen = Color(red: 0.29, green: 0.87, blue: 0.50)

@main
struct VestaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        ExpenseLiveActivityWidget()
    }
}

/// The "expense logged" receipt: lock-screen banner + Dynamic Island.
struct ExpenseLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ExpenseActivityAttributes.self) { context in
            // Lock screen / banner presentation.
            HStack(spacing: 12) {
                statusIcon(context.state)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.amountText)
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .monospacedDigit()
                    Text(subtitle(context.state))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Text(context.state.queued ? "QUEUED" : "LOGGED")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(context.state.queued ? Color.orange : ledgerGreen)
            }
            .padding(14)
            .activityBackgroundTint(Color.black.opacity(0.6))
            .activitySystemActionForegroundColor(ledgerGreen)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    statusIcon(context.state)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.amountText)
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(ledgerGreen)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(subtitle(context.state))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: context.state.queued
                    ? "tray.and.arrow.down.fill" : "checkmark.circle.fill")
                    .foregroundStyle(context.state.queued ? Color.orange : ledgerGreen)
            } compactTrailing: {
                Text(context.state.amountText)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(ledgerGreen)
            } minimal: {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(ledgerGreen)
            }
        }
    }

    private func statusIcon(_ state: ExpenseActivityAttributes.ContentState) -> some View {
        Image(systemName: state.queued ? "tray.and.arrow.down.fill" : "creditcard.fill")
            .font(.title2)
            .foregroundStyle(state.queued ? Color.orange : ledgerGreen)
    }

    private func subtitle(_ state: ExpenseActivityAttributes.ContentState) -> String {
        let vendor = state.vendor.isEmpty ? "Expense" : state.vendor
        return "\(vendor) · \(state.category)\(state.queued ? " · syncs when online" : "")"
    }
}
