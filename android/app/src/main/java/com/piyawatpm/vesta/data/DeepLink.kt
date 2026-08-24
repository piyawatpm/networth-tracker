package com.piyawatpm.vesta.data

/**
 * vesta:// deep links — the automation path (Tasker / Shortcuts-style tap
 * logging). Port of ios DeepLink.swift:
 *
 *   vesta://add?amount=[Amount]&merchant=[Merchant]
 *   vesta://tap?amount=…&merchant=…      (aliases: inspect)
 *
 * The query is hand-split because automation tools paste variables unencoded.
 */
object DeepLink {
    data class TapData(
        val amount: Double?,
        val currency: String?,
        val merchant: String,
        val raw: String,
    )

    sealed class Kind {
        data class Add(val data: TapData) : Kind()
        data class Inspect(val data: TapData) : Kind()
    }

    fun parse(url: String): Kind? {
        if (!url.startsWith("vesta://")) return null
        val afterScheme = url.removePrefix("vesta://")
        val host = afterScheme.substringBefore("?").trim('/').lowercase()
        val query = afterScheme.substringAfter("?", "")

        val params = HashMap<String, String>()
        for (pair in query.split("&")) {
            val key = pair.substringBefore("=", "")
            if (key.isEmpty()) continue
            params[key.lowercase()] = java.net.URLDecoder.decode(
                pair.substringAfter("=", ""), "UTF-8"
            )
        }

        val amountText = params["amount"] ?: ""
        val merchant = params["merchant"] ?: params["vendor"] ?: ""
        val data = TapData(
            amount = firstNumber(amountText.ifEmpty { query }),
            currency = currencyCode(amountText.ifEmpty { query }, params["currency"]),
            merchant = merchant.trim(),
            raw = url,
        )
        return when (host) {
            "add" -> Kind.Add(data)
            "tap", "inspect" -> Kind.Inspect(data)
            else -> null
        }
    }

    /** First numeric run: `.` and `,` treated alike, only the LAST dot kept
     *  ("1.234.56" → 1234.56). */
    fun firstNumber(text: String): Double? {
        val run = StringBuilder()
        var started = false
        for (ch in text) {
            if (ch.isDigit() || ch == '.' || ch == ',') {
                run.append(if (ch == ',') '.' else ch)
                started = true
            } else if (started) {
                break
            }
        }
        if (run.isEmpty()) return null
        val parts = run.toString().split(".")
        val normalized = if (parts.size <= 1) run.toString()
        else parts.dropLast(1).joinToString("") + "." + parts.last()
        return normalized.toDoubleOrNull()
    }

    fun currencyCode(text: String, explicit: String?): String? {
        explicit?.trim()?.uppercase()?.takeIf { it.length == 3 }?.let { return it }
        val upper = text.uppercase()
        for (code in listOf("AUD", "USD", "THB", "EUR", "GBP", "JPY", "SGD")) {
            if (upper.contains(code)) return code
        }
        return when {
            text.contains("฿") -> "THB"
            text.contains("A$") -> "AUD"
            text.contains("US$") -> "USD"
            else -> null
        }
    }
}
