import UserNotifications

/// Local notifications for the quick-add pipeline: a durable record of every
/// auto-logged expense (the island receipt self-dismisses; these stay in
/// Notification Center), and a loud, self-explanatory failure when something
/// breaks — a Shortcuts "Automation failed" banner says nothing useful.
enum Notify {
    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge]
        ) { _, _ in }
    }

    static func post(title: String, body: String, sound: UNNotificationSound? = nil) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = sound
        let request = UNNotificationRequest(
            identifier: UUID().uuidString, content: content, trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}

/// Without a delegate, notifications are swallowed while the app is
/// foreground — the banner should show either way.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }
}
