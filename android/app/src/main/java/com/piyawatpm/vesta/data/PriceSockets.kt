package com.piyawatpm.vesta.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.TimeUnit

/**
 * The web app's three real-time price feeds, ported: Binance WS + Gate.io WS
 * for crypto (Gate covers exchange tokens Binance doesn't list — GT, OFC),
 * Alpaca WS (iex) for US stock trades. Connected while the app is foreground,
 * torn down in background; each socket reconnects itself after 5s on failure.
 * Mirrors ios PriceSockets.swift.
 */
class PriceSocketCenter {
    companion object {
        // Paper-trading keys — market data only; same convention as the web
        // bundle and the iOS app (see lib/hooks/use-alpaca-ws.ts).
        const val ALPACA_KEY = "PK7UABSLFNCFJH2ICVM2YW3A53"
        const val ALPACA_SECRET = "qSy9wj3hBvbBhMJUR3Kb64n7SRn1KfHAg8ktrEZmVWJ"
    }

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // websockets stay open
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val json = Json { ignoreUnknownKeys = true }

    private val lock = Any()
    private var active = false
    private var sockets = mutableListOf<WebSocket>()
    private var pingTimer: Timer? = null

    /** symbol ("BTCUSDT") → token ("BTC") */
    private var binanceMap: Map<String, String> = emptyMap()

    /** pair ("GT_USDT") → token ("GT") */
    private var gateMap: Map<String, String> = emptyMap()
    private var stockSymbols: List<String> = emptyList()

    private var onCrypto: ((String, Double) -> Unit)? = null
    private var onStock: ((String, Double) -> Unit)? = null

    fun start(
        binanceMap: Map<String, String>,
        gateMap: Map<String, String>,
        stockSymbols: List<String>,
        onCrypto: (String, Double) -> Unit,
        onStock: (String, Double) -> Unit,
    ) {
        stop()
        synchronized(lock) {
            active = true
            this.binanceMap = binanceMap
            this.gateMap = gateMap
            this.stockSymbols = stockSymbols
            this.onCrypto = onCrypto
            this.onStock = onStock
        }
        connectBinance()
        connectGate()
        connectAlpaca()
    }

    fun stop() {
        val open: List<WebSocket>
        synchronized(lock) {
            active = false
            pingTimer?.cancel()
            pingTimer = null
            open = sockets.toList()
            sockets.clear()
        }
        for (socket in open) socket.close(1001, "going away")
    }

    private val isActive: Boolean get() = synchronized(lock) { active }

    // MARK: Plumbing

    private fun open(
        url: String,
        onOpen: ((WebSocket) -> Unit)? = null,
        onMessage: (WebSocket, String) -> Unit,
        reconnect: () -> Unit,
    ) {
        val request = Request.Builder().url(url).build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                onOpen?.invoke(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!isActive) return
                onMessage(webSocket, text)
            }

            override fun onFailure(
                webSocket: WebSocket,
                t: Throwable,
                response: okhttp3.Response?,
            ) {
                scheduleReconnect(reconnect)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                scheduleReconnect(reconnect)
            }
        }
        synchronized(lock) {
            if (!active) return // stopped mid-reconnect
            sockets.add(client.newWebSocket(request, listener))
        }
    }

    private fun scheduleReconnect(reconnect: () -> Unit) {
        if (!isActive) return
        Timer().schedule(object : TimerTask() {
            override fun run() {
                if (isActive) reconnect()
            }
        }, 5000)
    }

    private fun parse(text: String): JsonObject? = try {
        json.parseToJsonElement(text) as? JsonObject
    } catch (_: Exception) {
        null
    }

    // MARK: Binance — combined miniTicker stream

    private fun connectBinance() {
        val map = synchronized(lock) { binanceMap }
        if (map.isEmpty()) return
        val streams = map.keys
            .map { "${it.lowercase()}@miniTicker" }
            .sorted()
            .joinToString("/")
        open(
            "wss://stream.binance.com:9443/stream?streams=$streams",
            onMessage = { _, text ->
                val root = parse(text) ?: return@open
                val data = root["data"] as? JsonObject ?: return@open
                val symbol = data["s"]?.jsonPrimitive?.contentOrNull ?: return@open
                val token = synchronized(lock) { binanceMap[symbol] } ?: return@open
                val close = data["c"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()
                    ?: return@open
                onCrypto?.invoke(token, close)
            },
            reconnect = { connectBinance() },
        )
    }

    // MARK: Gate.io — spot.tickers channel

    private fun connectGate() {
        val map = synchronized(lock) { gateMap }
        if (map.isEmpty()) return
        open(
            "wss://api.gateio.ws/ws/v4/",
            onOpen = { socket ->
                val subscribe = buildJsonObject {
                    put("time", System.currentTimeMillis() / 1000)
                    put("channel", "spot.tickers")
                    put("event", "subscribe")
                    putJsonArray("payload") { map.keys.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } }
                }
                socket.send(subscribe.toString())
                // Gate closes idle connections — app-level ping keeps it alive.
                synchronized(lock) {
                    pingTimer?.cancel()
                    pingTimer = Timer().also { timer ->
                        timer.scheduleAtFixedRate(object : TimerTask() {
                            override fun run() {
                                val ping =
                                    "{\"time\":${System.currentTimeMillis() / 1000},\"channel\":\"spot.ping\"}"
                                socket.send(ping)
                            }
                        }, 20_000, 20_000)
                    }
                }
            },
            onMessage = { _, text ->
                val root = parse(text) ?: return@open
                if (root["channel"]?.jsonPrimitive?.contentOrNull != "spot.tickers") return@open
                if (root["event"]?.jsonPrimitive?.contentOrNull != "update") return@open
                val result = root["result"] as? JsonObject ?: return@open
                val pair = result["currency_pair"]?.jsonPrimitive?.contentOrNull ?: return@open
                val token = synchronized(lock) { gateMap[pair] } ?: return@open
                val last = result["last"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()
                    ?: return@open
                onCrypto?.invoke(token, last)
            },
            reconnect = { connectGate() },
        )
    }

    // MARK: Alpaca — iex trades

    private fun connectAlpaca() {
        val symbols = synchronized(lock) { stockSymbols }
        if (symbols.isEmpty()) return
        open(
            "wss://stream.data.alpaca.markets/v2/iex",
            onOpen = { socket ->
                socket.send(
                    "{\"action\":\"auth\",\"key\":\"$ALPACA_KEY\",\"secret\":\"$ALPACA_SECRET\"}"
                )
            },
            onMessage = { socket, text ->
                val messages = try {
                    json.parseToJsonElement(text) as? JsonArray
                } catch (_: Exception) {
                    null
                } ?: return@open
                for (element in messages) {
                    val message = element as? JsonObject ?: continue
                    when (message["T"]?.jsonPrimitive?.contentOrNull) {
                        "success" -> {
                            if (message["msg"]?.jsonPrimitive?.contentOrNull == "authenticated") {
                                val subscribe = buildJsonObject {
                                    put("action", "subscribe")
                                    putJsonArray("trades") {
                                        symbols.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) }
                                    }
                                }
                                socket.send(subscribe.toString())
                            }
                        }
                        "t" -> {
                            val symbol = message["S"]?.jsonPrimitive?.contentOrNull
                            val price = message["p"]?.jsonPrimitive?.doubleOrNull
                            if (symbol != null && price != null) {
                                onStock?.invoke(symbol, price)
                            }
                        }
                    }
                }
            },
            reconnect = { connectAlpaca() },
        )
    }
}
