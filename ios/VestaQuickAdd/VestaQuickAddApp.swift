import SwiftUI
import BackgroundTasks
import UserNotifications

@main
struct VestaQuickAddApp: App {
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Foreground banners + permission ask for the quick-add notifications.
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
        Notify.requestPermission()
        Self.scheduleExpiryWarning()
        // Dev hook: proves the on-device breadcrumb log is writable without
        // having to wait for a real card tap to find out it wasn't.
        #if DEBUG
        print("[boot] vesta env: \(ProcessInfo.processInfo.environment.keys.filter { $0.hasPrefix("VESTA") })")
        #endif
        if ProcessInfo.processInfo.environment["VESTA_LOG_PING"] != nil {
            IntentLog.write("log ping — writable")
        }
    }

    private static let refreshTaskID = "com.piyawatpm.vesta.refresh"

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Coming back to the foreground is the most reliable moment to
                // drain anything the Action Button queued while offline.
                Task { await PendingQueue.shared.flush() }
            case .background:
                Self.scheduleBackgroundRefresh()
            default:
                break
            }
        }
        // Periodic headless refresh: keep the disk cache warm so a cold open
        // paints current numbers before the network round trip. iOS decides
        // the actual cadence; earliestBeginDate keeps it "regularly, not all
        // the time".
        .backgroundTask(.appRefresh(Self.refreshTaskID)) {
            await BackgroundRefresher.run()
            await Self.scheduleBackgroundRefresh()
        }
    }

    /// Warn before the free-provisioning signature lapses.
    ///
    /// On expiry the app stops launching, and the first symptom is a card tap
    /// failing with "couldn't communicate with a helper application" — which
    /// reads exactly like a bug in the intent. Two days' notice, at 9am, is
    /// enough to plug the phone in and reinstall before that happens.
    private static func scheduleExpiryWarning() {
        let id = "com.piyawatpm.vesta.build-expiry"
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [id])
        guard let expiry = BuildExpiry.date else { return }

        let content = UNMutableNotificationContent()
        content.title = "Vesta expires in 2 days"
        content.body = "Reinstall from the Mac (ios/reinstall.sh) or quick-add from card taps will stop working."
        content.sound = .default

        let warn = expiry.addingTimeInterval(-2 * 24 * 3600)
        var trigger: UNNotificationTrigger?
        if warn > Date() {
            var parts = Calendar.current.dateComponents([.year, .month, .day], from: warn)
            parts.hour = 9
            trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        } else if BuildExpiry.isExpiringSoon {
            // Already inside the window — say so on this launch instead.
            content.title = "Vesta expires \(BuildExpiry.summary)"
        }
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }

    private static func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 2 * 3600)
        // Already-pending duplicates just fail the submit; that's fine.
        try? BGTaskScheduler.shared.submit(request)
    }
}
