import ActivityKit
import Foundation

/// Live Activity payload for a just-logged expense.
///
/// ActivityKit matches app ↔ extension by the TYPE NAME and its Codable
/// encoding, so `VestaWidgets` carries an identical copy of this struct —
/// change one, change both.
struct ExpenseActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var amountText: String
        var vendor: String
        var category: String
        var queued: Bool
    }

    var id: String
}

/// Puts a "logged ✓" card in the Dynamic Island right after a quick-add —
/// the Apple-Pay-tap → Shortcuts → AddExpenseIntent flow ends here.
enum ExpenseIslandPresenter {
    static func show(amountText: String, vendor: String, category: String, queued: Bool) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let state = ExpenseActivityAttributes.ContentState(
            amountText: amountText,
            vendor: vendor,
            category: category,
            queued: queued
        )

        Task {
            // One receipt at a time — a burst of taps must not stack islands.
            for activity in Activity<ExpenseActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            let content = ActivityContent(
                state: state,
                staleDate: Date().addingTimeInterval(90)
            )
            let activity = try? Activity.request(
                attributes: ExpenseActivityAttributes(id: UUID().uuidString),
                content: content
            )
            // Auto-dismiss after a minute. If the process suspends first the
            // island lingers until iOS reaps it via staleDate — acceptable.
            try? await Task.sleep(for: .seconds(60))
            await activity?.end(nil, dismissalPolicy: .immediate)
        }
    }
}
