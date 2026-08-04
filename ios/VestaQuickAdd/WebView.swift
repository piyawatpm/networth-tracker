import SwiftUI
import WebKit

/// Where the main web app currently is, from the shell's point of view.
enum WebLoadState: Equatable {
    case loading
    case loaded
    /// First load never succeeded — nothing to show but a retry screen.
    case failed(String)
}

extension Notification.Name {
    /// Posted by the retry button; the coordinator owns the WKWebView.
    static let vestaReloadWebView = Notification.Name("vestaReloadWebView")
}

/// The native shell around the deployed web app.
///
/// The web app stays the source of truth ("keep the PWA") — this wrapper adds
/// what a Home-Screen PWA can't do: an Action Button intent, an offline queue,
/// and a real app icon in the switcher. Login cookies live in the default
/// WKWebsiteDataStore, so signing in survives relaunches exactly like Safari.
struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var loadState: WebLoadState

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // Appends to the default Safari UA instead of replacing it, so the web
        // app can detect the shell later without breaking UA-sniffing libs.
        config.applicationNameForUserAgent = "VestaiOS"

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .vestaBackground
        webView.underPageBackgroundColor = .vestaBackground
        // The page uses viewport-fit=cover + env(safe-area-inset-*) already
        // (it ships as a PWA); double-padding from UIKit would push it down.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        webView.isInspectable = true
        #endif

        let refresh = UIRefreshControl()
        refresh.addTarget(
            context.coordinator,
            action: #selector(Coordinator.handleRefresh(_:)),
            for: .valueChanged
        )
        webView.scrollView.refreshControl = refresh

        context.coordinator.webView = webView
        context.coordinator.observeReloadRequests()
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        var parent: WebView
        weak var webView: WKWebView?
        private var hasLoadedOnce = false
        private var reloadObserver: NSObjectProtocol?

        init(_ parent: WebView) {
            self.parent = parent
        }

        deinit {
            if let reloadObserver {
                NotificationCenter.default.removeObserver(reloadObserver)
            }
        }

        func observeReloadRequests() {
            reloadObserver = NotificationCenter.default.addObserver(
                forName: .vestaReloadWebView, object: nil, queue: .main
            ) { [weak self] _ in
                guard let self, let webView = self.webView else { return }
                self.parent.loadState = .loading
                if webView.url != nil {
                    webView.reload()
                } else {
                    webView.load(URLRequest(url: self.parent.url))
                }
            }
        }

        @objc func handleRefresh(_ sender: UIRefreshControl) {
            webView?.reload()
        }

        private func endRefreshing() {
            webView?.scrollView.refreshControl?.endRefreshing()
        }

        // MARK: Navigation lifecycle

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            hasLoadedOnce = true
            parent.loadState = .loaded
            endRefreshing()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            handleFailure(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handleFailure(error)
        }

        private func handleFailure(_ error: Error) {
            endRefreshing()
            let nsError = error as NSError
            // Back-forward swipes and rapid taps cancel navigations routinely;
            // that's not an outage, so don't blank a working page for it.
            if nsError.code == NSURLErrorCancelled { return }
            // Only take over the screen when there's nothing rendered at all —
            // a failed refresh on a loaded app is survivable and self-evident.
            if !hasLoadedOnce {
                parent.loadState = .failed(nsError.localizedDescription)
            }
        }

        /// The web process was killed (memory pressure, crash). Without this
        /// the app shows a permanent white screen until force-quit.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        // MARK: Navigation policy

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.shouldPerformDownload {
                decisionHandler(.download)
                return
            }
            guard let target = navigationAction.request.url,
                  navigationAction.targetFrame?.isMainFrame != false
            else {
                decisionHandler(.allow)
                return
            }
            // Main-frame navigations that leave the app's origin (broker
            // links, ticker pages) belong in Safari, not trapped in the shell
            // with no address bar.
            if isExternal(target) {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            // Things WebKit can't render inline (JSON backups, CSV exports)
            // become downloads and land in the share sheet.
            decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
        }

        private func isExternal(_ target: URL) -> Bool {
            guard let scheme = target.scheme?.lowercased() else { return false }
            guard scheme == "http" || scheme == "https" else { return false }
            let appHost = parent.url.host?.lowercased() ?? ""
            let targetHost = target.host?.lowercased() ?? ""
            return targetHost != appHost
        }

        /// target=_blank: same-origin links stay in the shell; anything else
        /// goes to Safari. Never returns a second webview.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let target = navigationAction.request.url {
                if isExternal(target) {
                    UIApplication.shared.open(target)
                } else {
                    webView.load(navigationAction.request)
                }
            }
            return nil
        }

        // MARK: Downloads (CSV/JSON exports)

        func webView(
            _ webView: WKWebView,
            navigationAction: WKNavigationAction,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func webView(
            _ webView: WKWebView,
            navigationResponse: WKNavigationResponse,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let destination = dir.appendingPathComponent(suggestedFilename)
            pendingDownloadURL = destination
            completionHandler(destination)
        }

        private var pendingDownloadURL: URL?

        func downloadDidFinish(_ download: WKDownload) {
            guard let fileURL = pendingDownloadURL else { return }
            pendingDownloadURL = nil
            presentShareSheet(for: fileURL)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            pendingDownloadURL = nil
        }

        private func presentShareSheet(for fileURL: URL) {
            guard let root = webView?.window?.rootViewController else { return }
            let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            var top = root
            while let presented = top.presentedViewController { top = presented }
            top.present(activity, animated: true)
        }
    }
}

extension UIColor {
    /// Matches the web app's themeColor meta (#1a1a1a dark / #efeee5 light) so
    /// the shell never flashes white behind the page.
    static let vestaBackground = UIColor(red: 0, green: 0, blue: 0, alpha: 1)
}
