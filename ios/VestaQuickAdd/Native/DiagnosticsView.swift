import SwiftUI

/// Everything needed to answer "why didn't my card tap log an expense?" without
/// a Mac, a cable, or a device log.
///
/// The three things that break the Wallet automation, in the order they break:
/// an expired signature (the app can't launch at all), a stalled network inside
/// the intent's budget (the process gets killed), and Shortcuts timing out on
/// the bank's transaction record before the app is ever asked. The first is a
/// date, the second is a stopwatch, and the third is proven by the *absence* of
/// a log line — so all three live on this one screen.
struct QuickAddDiagnosticsView: View {
    @State private var entries: [BreadcrumbLog.Entry] = []
    @State private var queued = 0
    @State private var probe: ProbeResult?
    @State private var probing = false

    private struct ProbeResult {
        let ok: Bool
        let detail: String
        let seconds: Double
    }

    var body: some View {
        List {
            signatureSection
            probeSection
            queueSection
            logSection
        }
        .scrollContentBackground(.hidden)
        .background(Ledger.background)
        .navigationTitle("Quick-add")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .refreshable { await reload() }
    }

    // MARK: Sections

    private var signatureSection: some View {
        Section {
            LabeledContent("Signature valid until") {
                Text(BuildExpiry.summary)
                    .foregroundStyle(BuildExpiry.isExpiringSoon ? Ledger.expense : Ledger.subtle)
            }
            if BuildExpiry.isExpiringSoon {
                Text("Once this lapses the app won't launch, and every card tap fails with “couldn't communicate with a helper application.” Reinstall from the Mac: `ios/reinstall.sh`.")
                    .font(.caption)
                    .foregroundStyle(Ledger.expense)
            }
        } header: {
            Text("Build")
        }
        .listRowBackground(Ledger.card)
    }

    private var probeSection: some View {
        Section {
            Button {
                Task { await runProbe() }
            } label: {
                HStack {
                    Label("Test the connection", systemImage: "stethoscope")
                    Spacer()
                    if probing { ProgressView().tint(Ledger.income) }
                }
            }
            .disabled(probing)

            if let probe {
                LabeledContent(probe.ok ? "Reachable" : "Failed") {
                    Text("\(String(format: "%.1f", probe.seconds))s")
                        .foregroundStyle(probe.ok ? Ledger.income : Ledger.expense)
                }
                Text(probe.detail)
                    .font(.caption)
                    .foregroundStyle(Ledger.subtle)
                if probe.ok && probe.seconds > 4 {
                    Text("Slower than the intent's 6s budget allows for comfort — taps on this connection will save locally and sync later rather than uploading on the spot.")
                        .font(.caption)
                        .foregroundStyle(Ledger.seriesCrypto)
                }
            }
        } header: {
            Text("Round trip")
        } footer: {
            Text("Signs in and reads the expense ledger — the same work a card tap does, minus the write. Under about 4 seconds means a tap will upload immediately.")
        }
        .listRowBackground(Ledger.card)
    }

    private var queueSection: some View {
        Section {
            LabeledContent("Waiting to sync") {
                Text("\(queued)")
                    .foregroundStyle(queued == 0 ? Ledger.subtle : Ledger.seriesCrypto)
            }
            if queued > 0 {
                Button("Sync now") {
                    Task {
                        await PendingQueue.shared.flush()
                        await reload()
                    }
                }
                .tint(Ledger.income)
            }
        } header: {
            Text("Offline queue")
        } footer: {
            Text("Expenses are written here before anything touches the network, so a failed upload is always a delay, never a loss.")
        }
        .listRowBackground(Ledger.card)
    }

    private var logSection: some View {
        Section {
            if entries.isEmpty {
                Text("Nothing yet. A card tap that leaves no trace here never reached the app — the automation itself failed upstream.")
                    .font(.caption)
                    .foregroundStyle(Ledger.subtle)
            } else {
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.message)
                            .font(.system(.footnote, design: .monospaced))
                        Text(entry.at, format: .dateTime.day().month().hour().minute().second())
                            .font(.caption2)
                            .foregroundStyle(Ledger.subtle)
                    }
                    .listRowBackground(Ledger.card)
                }
                Button(role: .destructive) {
                    IntentLog.clear()
                    entries = []
                } label: {
                    Label("Clear log", systemImage: "trash")
                }
                .listRowBackground(Ledger.card)
            }

            Color.clear.frame(height: 80)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        } header: {
            Text("Last runs")
        } footer: {
            Text("Newest first. Each quick-add writes a line as it starts and as it finishes; a run that stops halfway names where it stopped.")
        }
        .listRowBackground(Ledger.card)
    }

    // MARK: Work

    private func reload() async {
        entries = IntentLog.entries()
        queued = await PendingQueue.shared.count
    }

    /// The read half of a quick-add, timed. Deliberately does not write — a
    /// diagnostic that leaves test rows in the ledger is one you stop running.
    private func runProbe() async {
        probing = true
        defer { probing = false }
        let started = Date()
        do {
            try await withDeadline(10) {
                try await SupabaseAPI.shared.ensureSession()
                _ = try await SupabaseAPI.shared.fetchAppDataValue(key: "expense_entries")
            }
            let elapsed = Date().timeIntervalSince(started)
            probe = ProbeResult(
                ok: true,
                detail: "Signed in and read the expense ledger.",
                seconds: elapsed
            )
            // Logged, not just displayed: it doubles as proof the breadcrumb
            // file is writable, which is the one thing the whole screen
            // depends on and can't otherwise demonstrate.
            IntentLog.write(String(format: "connection test ok · %.1fs", elapsed))
        } catch {
            let elapsed = Date().timeIntervalSince(started)
            probe = ProbeResult(
                ok: false,
                detail: error.localizedDescription,
                seconds: elapsed
            )
            IntentLog.write("connection test failed · \(error.localizedDescription)")
        }
        entries = IntentLog.entries()
    }
}

/// What the accept-everything probe caught.
///
/// This page answers one question and no others: did the tap reach the app?
/// An empty list after a card tap is not an absence of information — it is the
/// finding, and it points away from the app entirely.
struct TapLogView: View {
    @State private var entries: [BreadcrumbLog.Entry] = []

    var body: some View {
        List {
            Section {
                if entries.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No taps recorded")
                            .font(.headline)
                        Text("If you've tapped your card since setting the automation up, that means Shortcuts never reached the app — the automation failed before the first action ran. Nothing in Vesta can fix that; see the setup below.")
                            .font(.caption)
                            .foregroundStyle(Ledger.subtle)
                    }
                    .padding(.vertical, 4)
                } else {
                    ForEach(entries) { entry in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(entry.at, format: .dateTime.day().month().hour().minute().second())
                                .font(.caption2)
                                .foregroundStyle(Ledger.income)
                            Text(entry.message)
                                .font(.system(.footnote, design: .monospaced))
                        }
                        .padding(.vertical, 2)
                    }
                }
            } header: {
                Text("Card taps seen")
            }
            .listRowBackground(Ledger.card)

            Section {
                Text("""
                1. Shortcuts → Automation → your Wallet automation.
                2. Add **Log Card Tap (Debug)** as the FIRST action, above Add Expense.
                3. Link the Amount and Merchant pills to the transaction, same as Add Expense.
                4. Run Immediately, Notify When Run on.

                It never asks anything, never waits on the network and can't fail — so a tap that reaches the app always lands here, even when the expense itself doesn't.
                """)
                .font(.caption)
                .foregroundStyle(Ledger.subtle)
            } header: {
                Text("Setup")
            }
            .listRowBackground(Ledger.card)

            if !entries.isEmpty {
                Section {
                    Button(role: .destructive) {
                        BreadcrumbLog.tap.clear()
                        entries = []
                    } label: {
                        Label("Clear", systemImage: "trash")
                    }
                }
                .listRowBackground(Ledger.card)
            }

            Section {
                Color.clear.frame(height: 80)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Ledger.background)
        .navigationTitle("Card tap log")
        .navigationBarTitleDisplayMode(.inline)
        .task { entries = BreadcrumbLog.tap.entries() }
        .refreshable { entries = BreadcrumbLog.tap.entries() }
    }
}
