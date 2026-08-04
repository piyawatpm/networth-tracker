import SwiftUI

struct SignInView: View {
    @Environment(DataStore.self) private var store
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focus: Field?

    enum Field { case email, password }

    var body: some View {
        ZStack {
            // Subtle animated backdrop — parchment/ink with a slow-breathing
            // mesh so the sign-in screen feels alive without shouting.
            MeshGradient(
                width: 3, height: 3,
                points: [
                    [0, 0], [0.5, 0], [1, 0],
                    [0, 0.5], [0.55, 0.45], [1, 0.5],
                    [0, 1], [0.5, 1], [1, 1],
                ],
                colors: [
                    Ledger.background, Ledger.background, Ledger.background,
                    Ledger.background, Ledger.card, Ledger.background,
                    Ledger.income.opacity(0.12), Ledger.background, Ledger.background,
                ]
            )
            .ignoresSafeArea()

            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 40, weight: .medium))
                        .foregroundStyle(Ledger.income)
                        .symbolEffect(.breathe.pulse, options: .repeat(.continuous))
                    Text("Vesta")
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                    Text("Sign in to your ledger")
                        .labelMono()
                }

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .padding(14)
                        .financeCard()

                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await submit() } }
                        .padding(14)
                        .financeCard()

                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(Ledger.expense)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        HStack {
                            if busy { ProgressView().tint(.white) }
                            Text(busy ? "Signing in…" : "Sign in")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(VoltButtonStyle())
                    .disabled(busy || email.isEmpty || password.isEmpty)
                }
                .frame(maxWidth: 340)
            }
            .padding(24)
        }
        .animation(.spring(duration: 0.35), value: error)
        .sensoryFeedback(.error, trigger: error) { _, new in new != nil }
    }

    private func submit() async {
        busy = true
        error = nil
        do {
            try await store.signIn(
                email: email.trimmingCharacters(in: .whitespaces),
                password: password
            )
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}
