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
    /// Async so the caller can await the part that must happen before the
    /// process is allowed to suspend. Starting the activity is fast; only the
    /// auto-dismiss timer runs detached.
    static func show(amountText: String, vendor: String, category: String, queued: Bool) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            IntentLog.write("island skipped — Live Activities are off in Settings")
            return
        }

        let state = ExpenseActivityAttributes.ContentState(
            amountText: amountText,
            vendor: vendor,
            category: category,
            queued: queued
        )

        // One receipt at a time — a burst of taps must not stack islands, and
        // a leftover activity makes the next request fail outright.
        for activity in Activity<ExpenseActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        let content = ActivityContent(
            state: state,
            staleDate: Date().addingTimeInterval(90)
        )
        do {
            let activity = try Activity.request(
                attributes: ExpenseActivityAttributes(id: UUID().uuidString),
                content: content
            )
            IntentLog.write("island shown")
            // Auto-dismiss after a minute. If the process suspends first the
            // island lingers until iOS reaps it via staleDate — acceptable.
            Task.detached {
                try? await Task.sleep(for: .seconds(60))
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        } catch {
            // Worth a line: a `visibility` error here means the background
            // start privilege was refused, which is a code problem, not a
            // network one.
            IntentLog.write("island failed — \(error.localizedDescription)")
        }
    }
}
