import Foundation

/// The web app's three real-time price feeds, ported: Binance WS + Gate.io WS
/// for crypto (Gate covers exchange tokens Binance doesn't list — GT, OFC),
/// Alpaca WS (iex) for US stock trades. Connected while the app is foreground,
/// torn down in background; each socket reconnects itself after 5s on failure.
final class PriceSocketCenter: @unchecked Sendable {
    static let alpacaKey = "PK7UABSLFNCFJH2ICVM2YW3A53"
    static let alpacaSecret = "qSy9wj3hBvbBhMJUR3Kb64n7SRn1KfHAg8ktrEZmVWJ"

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
        active = true
        self.binanceMap = binanceMap
        self.gateMap = gateMap
        self.stockSymbols = stockSymbols
        self.onCrypto = onCrypto
        self.onStock = onStock
        log("start binance=\(binanceMap.count) gate=\(gateMap.count) stocks=\(stockSymbols.count)")
        connectBinance()
        connectGate()
        connectAlpaca()
    }

    func stop() {
        active = false
        pingTask?.cancel()
        pingTask = nil
        for task in tasks { task.cancel(with: .goingAway, reason: nil) }
        tasks.removeAll()
    }

    // MARK: Plumbing

    private func open(_ url: URL, onOpen: ((URLSessionWebSocketTask) -> Void)? = nil,
                      onMessage: @escaping (URLSessionWebSocketTask, String) -> Void,
                      reconnect: @escaping () -> Void) {
        let task = URLSession.shared.webSocketTask(with: url)
        tasks.append(task)
        task.resume()
        onOpen?(task)
        receiveLoop(task, onMessage: onMessage, reconnect: reconnect)
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask,
                             onMessage: @escaping (URLSessionWebSocketTask, String) -> Void,
                             reconnect: @escaping () -> Void) {
        task.receive { [weak self] result in
            guard let self, self.active else { return }
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
                    guard let self, self.active else { return }
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
                  let token = self.binanceMap[symbol],
                  let close = (data["c"] as? String).flatMap(Double.init)
            else { return }
            self.tickCounts["binance", default: 0] += 1
            if self.tickCounts["binance"] == 1 { self.log("binance first tick: \(symbol)") }
            self.onCrypto?(token, close)
        }, reconnect: { [weak self] in self?.connectBinance() })
    }

    // MARK: Gate.io — spot.tickers channel

    private func connectGate() {
        guard !gateMap.isEmpty, let url = URL(string: "wss://api.gateio.ws/ws/v4/")
        else { return }
        open(url, onOpen: { [weak self] task in
            guard let self else { return }
            let subscribe: [String: Any] = [
                "time": Int(Date().timeIntervalSince1970),
                "channel": "spot.tickers",
                "event": "subscribe",
                "payload": Array(self.gateMap.keys),
            ]
            if let data = try? JSONSerialization.data(withJSONObject: subscribe),
               let text = String(data: data, encoding: .utf8) {
                task.send(.string(text)) { _ in }
            }
            // Gate closes idle connections — app-level ping keeps it alive.
            self.pingTask?.cancel()
            self.pingTask = Task { [weak task] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
                    let ping = "{\"time\":\(Int(Date().timeIntervalSince1970)),\"channel\":\"spot.ping\"}"
                    task?.send(.string(ping)) { _ in }
                }
            }
        }, onMessage: { [weak self] _, text in
            guard let self,
                  let root = self.json(text),
                  root["channel"] as? String == "spot.tickers",
                  root["event"] as? String == "update",
                  let result = root["result"] as? [String: Any],
                  let pair = result["currency_pair"] as? String,
                  let token = self.gateMap[pair],
                  let last = (result["last"] as? String).flatMap(Double.init)
            else { return }
            self.tickCounts["gate", default: 0] += 1
            if self.tickCounts["gate"] == 1 { self.log("gate first tick: \(pair)") }
            self.onCrypto?(token, last)
        }, reconnect: { [weak self] in self?.connectGate() })
    }

    // MARK: Alpaca — iex trades

    private func connectAlpaca() {
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
