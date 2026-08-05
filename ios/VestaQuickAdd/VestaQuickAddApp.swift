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

    private static func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 2 * 3600)
        // Already-pending duplicates just fail the submit; that's fine.
        try? BGTaskScheduler.shared.submit(request)
    }
}
