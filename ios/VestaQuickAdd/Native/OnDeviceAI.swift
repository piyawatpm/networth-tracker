import SwiftUI
import FoundationModels

/// Apple's on-device foundation model (iOS 26 FoundationModels framework),
/// used three ways: categorizing Wallet taps, narrating the insight pages,
/// and answering free-form money questions. Everything runs on the Neural
/// Engine — free, offline, nothing leaves the phone.
///
/// One rule everywhere: THE MODEL NEVER DOES ARITHMETIC. Every number it
/// sees is precomputed by the app; the model only classifies or narrates.
enum OnDeviceAI {
    static var isAvailable: Bool {
        if case .available = SystemLanguageModel.default.availability { return true }
        return false
    }

    /// Human-readable reason for the Ask page's empty state.
    static var unavailabilityNote: String {
        switch SystemLanguageModel.default.availability {
        case .available:
            return ""
        case .unavailable(.deviceNotEligible):
            return "This iPhone doesn't support Apple Intelligence."
        case .unavailable(.appleIntelligenceNotEnabled):
            return "Turn on Apple Intelligence in Settings to use this."
        case .unavailable(.modelNotReady):
            return "The on-device model is still downloading — try again shortly."
        case .unavailable:
            return "The on-device model isn't available right now."
        }
    }

    /// "Two Peck Crispy Chicken" → "food". Returns nil (caller falls back to
    /// the default category) when the model is off, slow, or answers with
    /// something not on the list — a guessed category must never invent ids.
    static func categorize(vendor: String, categories: [String]) async -> String? {
        guard isAvailable, !vendor.isEmpty, !categories.isEmpty else { return nil }
        let prompt = "Merchant: \(vendor)\nCategory ids: \(categories.joined(separator: ", "))"
        guard let raw = try? await withDeadline(8, operation: {
            let session = LanguageModelSession(instructions: """
                You classify a purchase into an expense category. Reply with \
                exactly one category id copied verbatim from the provided \
                list — no other words, no punctuation.
                """)
            return try await session.respond(to: prompt).content
        }) else { return nil }
        let answer = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let exact = categories.first(where: { $0.lowercased() == answer }) { return exact }
        return categories.first { answer.contains($0.lowercased()) }
    }

    /// Two plain sentences from a page's precomputed facts.
    static func blurb(facts: String) async -> String? {
        guard isAvailable, !facts.isEmpty else { return nil }
        return try? await withDeadline(20, operation: {
            let session = LanguageModelSession(instructions: """
                You turn precomputed personal-finance facts into a plain, \
                friendly observation of EXACTLY two short sentences. Use \
                only the numbers given, quoted as written — never \
                recalculate, never invent. No advice, no greeting, no emoji.
                """)
            return try await session.respond(to: facts).content
                .trimmingCharacters(in: .whitespacesAndNewlines)
        })
    }

    /// Free-form question against the fact sheet DataStore.moneyFacts()
    /// builds. The instructions pin the model to the sheet so it says "I
    /// don't have that" instead of hallucinating a balance.
    static func ask(_ question: String, facts: String) async -> String? {
        guard isAvailable else { return nil }
        return try? await withDeadline(25, operation: {
            let session = LanguageModelSession(instructions: """
                You answer questions about the user's own finances using \
                ONLY the fact sheet in the prompt. Quote numbers exactly as \
                written. If the facts can't answer the question, say so in \
                one sentence and name what's missing. At most three short \
                sentences. Never give investment advice.
                """)
            return try await session.respond(to: "FACT SHEET:\n\(facts)\n\nQUESTION: \(question)")
                .content.trimmingCharacters(in: .whitespacesAndNewlines)
        })
    }

    /// Stable across launches (String.hashValue is not) — cache keys for
    /// generated blurbs.
    static func stableHash(_ text: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return String(hash, radix: 16)
    }
}

// MARK: - The fact sheet

extension DataStore {
    /// Everything the Ask page lets the model see — a compact, precomputed
    /// digest in the display currency. Aggregates only, never raw ledgers:
    /// it has to fit the model's small context and the model must not be
    /// tempted to do sums itself.
    func moneyFacts() -> String {
        var lines: [String] = []
        lines.append("Currency: \(displayCurrency). Today: \(SydneyTime.today()).")
        lines.append("Net worth: \(format(netWorth, compact: true)). Stocks & funds: \(format(stocksValueVisible, compact: true)). Crypto: \(format(cryptoValue, compact: true)). Debts (net, negative = I owe): \(format(debtNet, compact: true)).")

        // Month-by-month flow, oldest → newest, so "June" questions work.
        for key in FlowMath.monthKeys(back: 6).sorted() {
            let spent = expenses
                .filter { SydneyTime.monthKey($0.date) == key }
                .reduce(0) { $0 + convert($1.amount, from: $1.currency) }
            let earned = allIncome
                .filter { SydneyTime.monthKey($0.date) == key }
                .reduce(0) { $0 + convert($1.amount, from: $1.currency) }
            lines.append("\(key): income \(format(earned, compact: true)), spent \(format(spent, compact: true))")
        }

        // This month, broken down.
        let thisMonth = String(SydneyTime.today().prefix(7))
        var byCategory: [String: Double] = [:]
        var byVendor: [String: Double] = [:]
        for entry in expenses where SydneyTime.monthKey(entry.date) == thisMonth {
            byCategory[expenseLabel(entry.type), default: 0] += convert(entry.amount, from: entry.currency)
            let vendor = entry.vendor.trimmingCharacters(in: .whitespaces)
            if !vendor.isEmpty { byVendor[vendor, default: 0] += convert(entry.amount, from: entry.currency) }
        }
        if !byCategory.isEmpty {
            let rows = byCategory.sorted { $0.value > $1.value }.prefix(6)
                .map { "\($0.key) \(format($0.value, compact: true))" }
            lines.append("This month's spending by category: " + rows.joined(separator: ", ") + ".")
        }
        if !byVendor.isEmpty {
            let rows = byVendor.sorted { $0.value > $1.value }.prefix(4)
                .map { "\($0.key) \(format($0.value, compact: true))" }
            lines.append("This month's top vendors: " + rows.joined(separator: ", ") + ".")
        }
        var incomeByType: [String: Double] = [:]
        for entry in allIncome where SydneyTime.monthKey(entry.date) == thisMonth {
            incomeByType[incomeLabel(entry.type), default: 0] += convert(entry.amount, from: entry.currency)
        }
        if !incomeByType.isEmpty {
            let rows = incomeByType.sorted { $0.value > $1.value }.prefix(6)
                .map { "\($0.key) \(format($0.value, compact: true))" }
            lines.append("This month's income by source: " + rows.joined(separator: ", ") + ".")
        }

        // Crypto verdicts, precomputed by the same code the pages use.
        if !cryptoTxs.isEmpty {
            let realized = CryptoMath.computeRealizedPnl(cryptoTxs)
            lines.append("Crypto all-time realized P&L: \(format(convert(realized.total, from: "USD"), compact: true)).")
            if let best = realized.byToken.first {
                lines.append("Best realized coin: \(best.token) \(format(convert(best.realizedPnlUsd, from: "USD"), compact: true)).")
            }
            let earn = CryptoSplit.yieldEvents(
                txs: cryptoTxs, tags: stablecoinTags, exclusions: earnExclusions
            ).reduce(0) { $0 + $1.usd }
            lines.append("Crypto earn income (bots + Earn, net): \(format(convert(earn, from: "USD"), compact: true)).")
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - Insight blurb card

/// "In plain words" — two model-written sentences under the insight cards.
/// Generates once per distinct fact set (stable-hashed, cached), shows
/// nothing at all when the model is unavailable or hasn't answered yet.
struct AIBlurbCard: View {
    let facts: String
    let cacheKey: String

    @State private var text: String?

    var body: some View {
        Group {
            if let text, !text.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 5) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                        Text("In plain words").labelMono()
                    }
                    Text(text)
                        .font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("written on-device from this page's numbers · nothing leaves the phone")
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .financeCard()
            }
        }
        .task(id: facts) {
            guard OnDeviceAI.isAvailable, !facts.isEmpty else { return }
            let hash = OnDeviceAI.stableHash(facts)
            let defaults = Settings.defaults
            if defaults.string(forKey: "aiBlurbHash-\(cacheKey)") == hash,
               let cached = defaults.string(forKey: "aiBlurb-\(cacheKey)") {
                text = cached
                return
            }
            guard let generated = await OnDeviceAI.blurb(facts: facts) else { return }
            text = generated
            defaults.set(hash, forKey: "aiBlurbHash-\(cacheKey)")
            defaults.set(generated, forKey: "aiBlurb-\(cacheKey)")
        }
    }
}

// MARK: - Ask your money

struct AskMoneyView: View {
    @Environment(DataStore.self) private var store
    @State private var question = ""
    @State private var answer: String?
    @State private var askedQuestion: String?
    @State private var thinking = false
    @FocusState private var focused: Bool

    private let suggestions = [
        "How much did I spend on food this month?",
        "Am I up or down on crypto overall?",
        "What was my biggest vendor this month?",
        "How does this month compare to last month?",
    ]

    var body: some View {
        List {
            if !OnDeviceAI.isAvailable {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Model unavailable").font(.headline)
                        Text(OnDeviceAI.unavailabilityNote)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            } else {
                Section {
                    HStack(spacing: 8) {
                        TextField("Ask about your money…", text: $question, axis: .vertical)
                            .focused($focused)
                            .onSubmit { submit() }
                        Button {
                            submit()
                        } label: {
                            Image(systemName: thinking ? "hourglass" : "arrow.up.circle.fill")
                                .font(.title3)
                        }
                        .disabled(thinking || question.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }

                if answer == nil && !thinking {
                    Section("Try") {
                        ForEach(suggestions, id: \.self) { suggestion in
                            Button {
                                question = suggestion
                                submit()
                            } label: {
                                Text(suggestion).font(.footnote)
                            }
                            .tint(.primary)
                        }
                    }
                }

                if thinking {
                    Section {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Reading your numbers…")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }

                if let answer, let askedQuestion {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(askedQuestion)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(answer)
                                .font(.callout)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                        .padding(.vertical, 2)
                    } footer: {
                        Text("Answered on-device from precomputed totals — the model never does the math itself, and nothing leaves the phone.")
                    }
                }
            }

            Section {
                Color.clear.frame(height: 90)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Ledger.background)
        .navigationTitle("Ask your money")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        let trimmed = question.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !thinking else { return }
        focused = false
        thinking = true
        answer = nil
        askedQuestion = trimmed
        let facts = store.moneyFacts()
        Task {
            let reply = await OnDeviceAI.ask(trimmed, facts: facts)
            await MainActor.run {
                answer = reply ?? "The model didn't answer in time — try again."
                thinking = false
                question = ""
            }
        }
    }
}
