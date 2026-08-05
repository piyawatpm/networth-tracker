import Foundation

/// The web app's three real-time price feeds, ported: Binance WS + Gate.io WS
/// for crypto (Gate covers exchange tokens Binance doesn't list — GT, OFC),
/// Alpaca WS (iex) for US stock trades. Connected while the app is foreground,
/// torn down in background; each socket reconnects itself after 5s on failure.
final class PriceSocketCenter: @unchecked Sendable {
    static let alpacaKey = "PK7UABSLFNCFJH2ICVM2YW3A53"
    static let alpacaSecret = "qSy9wj3hBvbBhMJUR3Kb64n7SRn1KfHAg8ktrEZmVWJ"

    /// Guards every stored property below.
    ///
    /// URLSession delivers completion handlers on a CONCURRENT queue, so the
    /// reconnect path mutated `tasks` from several threads at once. That races
    /// Array's copy-on-write realloc and corrupts the buffer — it crashed with
    /// EXC_BAD_ACCESS inside _swift_release_dealloc during an Alpaca reconnect
    /// (which retries every 5s whenever the US market is closed).
    private let lock = NSLock()

    private var active = false
    private var tasks: [URLSessionWebSocketTask] = []
    private var pingTask: Task<Void, Never>?

    /// symbol ("BTCUSDT") → token ("BTC")
    private var binanceMap: [String: String] = [:]
    /// pair ("GT_USDT") → token ("GT")
    private var gateMap: [String: String] = [:]
    private var stockSymbols: [String] = []

    private var onCrypto: (@Sendable (String, Double) -> Void)?
    private var onStock: (@Sendable (String, Double) -> Void)?
    private var tickCounts: [String: Int] = [:]

    private func countTick(_ feed: String, detail: String) {
        lock.lock()
        tickCounts[feed, default: 0] += 1
        let first = tickCounts[feed] == 1
        lock.unlock()
        if first { log("\(feed) first tick: \(detail)") }
    }

    /// DEBUG-only visibility — readable via `simctl launch --console`.
    private func log(_ message: String) {
        #if DEBUG
        print("[sockets] \(message)")
        #endif
    }

    func start(
        binanceMap: [String: String],
        gateMap: [String: String],
        stockSymbols: [String],
        onCrypto: @escaping @Sendable (String, Double) -> Void,
        onStock: @escaping @Sendable (String, Double) -> Void
    ) {
        stop()
        lock.lock()
        active = true
        self.binanceMap = binanceMap
        self.gateMap = gateMap
        self.stockSymbols = stockSymbols
        self.onCrypto = onCrypto
        self.onStock = onStock
        lock.unlock()
        log("start binance=\(binanceMap.count) gate=\(gateMap.count) stocks=\(stockSymbols.count)")
        connectBinance()
        connectGate()
        connectAlpaca()
    }

    func stop() {
        lock.lock()
        active = false
        pingTask?.cancel()
        pingTask = nil
        let open = tasks
        tasks.removeAll()
        lock.unlock()
        for task in open { task.cancel(with: .goingAway, reason: nil) }
    }

    /// Snapshot of `active`, for the reconnect guards.
    private var isActive: Bool {
        lock.lock(); defer { lock.unlock() }
        return active
    }

    // MARK: Plumbing

    private func open(_ url: URL, onOpen: ((URLSessionWebSocketTask) -> Void)? = nil,
                      onMessage: @escaping (URLSessionWebSocketTask, String) -> Void,
                      reconnect: @escaping () -> Void) {
        let task = URLSession.shared.webSocketTask(with: url)
        lock.lock()
        guard active else { lock.unlock(); return } // stopped mid-reconnect
        tasks.append(task)
        lock.unlock()
        task.resume()
        onOpen?(task)
        receiveLoop(task, onMessage: onMessage, reconnect: reconnect)
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask,
                             onMessage: @escaping (URLSessionWebSocketTask, String) -> Void,
                             reconnect: @escaping () -> Void) {
        task.receive { [weak self] result in
            guard let self, self.isActive else { return }
            switch result {
            case .success(let message):
                if case .string(let text) = message { onMessage(task, text) }
                self.receiveLoop(task, onMessage: onMessage, reconnect: reconnect)
            case .failure(let error):
                self.log("socket failed: \(error.localizedDescription) — retrying in 5s")
                // Socket died — retry after a beat if we're still supposed to
                // be live. The old task stays cancelled; a new one replaces it.
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(5))
                    guard let self, self.isActive else { return }
                    reconnect()
                }
            }
        }
    }

    private func json(_ text: String) -> [String: Any]? {
        text.data(using: .utf8)
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }

    // MARK: Binance — combined miniTicker stream

    private func connectBinance() {
        lock.lock(); let binanceMap = self.binanceMap; lock.unlock()
        guard !binanceMap.isEmpty else { return }
        let streams = binanceMap.keys
            .map { "\($0.lowercased())@miniTicker" }
            .sorted()
            .joined(separator: "/")
        guard let url = URL(string: "wss://stream.binance.com:9443/stream?streams=\(streams)")
        else { return }
        open(url, onMessage: { [weak self] _, text in
            guard let self,
                  let root = self.json(text),
                  let data = root["data"] as? [String: Any],
                  let symbol = data["s"] as? String,
                  let token = { self.lock.lock(); defer { self.lock.unlock() }; return self.binanceMap[symbol] }(),
                  let close = (data["c"] as? String).flatMap(Double.init)
            else { return }
            self.countTick("binance", detail: symbol)
            self.onCrypto?(token, close)
        }, reconnect: { [weak self] in self?.connectBinance() })
    }

    // MARK: Gate.io — spot.tickers channel

    private func connectGate() {
        lock.lock(); let gateMap = self.gateMap; lock.unlock()
        guard !gateMap.isEmpty, let url = URL(string: "wss://api.gateio.ws/ws/v4/")
        else { return }
        open(url, onOpen: { [weak self] task in
            guard let self else { return }
            let subscribe: [String: Any] = [
                "time": Int(Date().timeIntervalSince1970),
                "channel": "spot.tickers",
                "event": "subscribe",
                "payload": Array(gateMap.keys),
            ]
            if let data = try? JSONSerialization.data(withJSONObject: subscribe),
               let text = String(data: data, encoding: .utf8) {
                task.send(.string(text)) { _ in }
            }
            // Gate closes idle connections — app-level ping keeps it alive.
            self.lock.lock()
            self.pingTask?.cancel()
            self.pingTask = Task { [weak task] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
                    let ping = "{\"time\":\(Int(Date().timeIntervalSince1970)),\"channel\":\"spot.ping\"}"
                    task?.send(.string(ping)) { _ in }
                }
            }
            self.lock.unlock()
        }, onMessage: { [weak self] _, text in
            guard let self,
                  let root = self.json(text),
                  root["channel"] as? String == "spot.tickers",
                  root["event"] as? String == "update",
                  let result = root["result"] as? [String: Any],
                  let pair = result["currency_pair"] as? String,
                  let token = { self.lock.lock(); defer { self.lock.unlock() }; return self.gateMap[pair] }(),
                  let last = (result["last"] as? String).flatMap(Double.init)
            else { return }
            self.countTick("gate", detail: pair)
            self.onCrypto?(token, last)
        }, reconnect: { [weak self] in self?.connectGate() })
    }

    // MARK: Alpaca — iex trades

    private func connectAlpaca() {
        lock.lock(); let stockSymbols = self.stockSymbols; lock.unlock()
        guard !stockSymbols.isEmpty,
              let url = URL(string: "wss://stream.data.alpaca.markets/v2/iex")
        else { return }
        open(url, onOpen: { task in
            let auth = "{\"action\":\"auth\",\"key\":\"\(Self.alpacaKey)\",\"secret\":\"\(Self.alpacaSecret)\"}"
            task.send(.string(auth)) { _ in }
        }, onMessage: { [weak self] task, text in
            guard let self,
                  let data = text.data(using: .utf8),
                  let messages = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else { return }
            for message in messages {
                switch message["T"] as? String {
                case "success" where (message["msg"] as? String) == "authenticated":
                    let subscribe: [String: Any] = [
                        "action": "subscribe", "trades": self.stockSymbols,
                    ]
                    if let payload = try? JSONSerialization.data(withJSONObject: subscribe),
                       let text = String(data: payload, encoding: .utf8) {
                        task.send(.string(text)) { _ in }
                    }
                case "t":
                    if let symbol = message["S"] as? String,
                       let price = message["p"] as? Double {
                        self.onStock?(symbol, price)
                    }
                default:
                    break
                }
            }
        }, reconnect: { [weak self] in self?.connectAlpaca() })
    }
}
