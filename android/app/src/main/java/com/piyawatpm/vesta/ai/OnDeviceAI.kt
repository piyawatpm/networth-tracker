package com.piyawatpm.vesta.ai

import com.piyawatpm.vesta.data.Categories

/**
 * The Android stand-in for the iOS FoundationModels layer. Apple's on-device
 * model has no universal Android equivalent (Gemini Nano is device-gated),
 * so the same three features run on deterministic rules instead — preserving
 * the iOS contract verbatim: the narrator only ever repeats precomputed
 * numbers, it never computes its own.
 */
object OnDeviceAI {

    /** Vendor keyword → expense category id. Mirrors the intent of the iOS
     *  categorizer ("reply with exactly one category id"). */
    private val vendorRules: List<Pair<List<String>, String>> = listOf(
        listOf(
            "woolworths", "coles", "aldi", "iga", "grocer", "market", "7-eleven", "seven eleven",
            "cafe", "coffee", "restaurant", "kitchen", "sushi", "thai", "pho", "kebab", "burger",
            "pizza", "kfc", "mcdonald", "hungry", "grill", "bakery", "noodle", "ramen", "food",
            "eat", "dining", "bar ", "pub ", "uber eats", "ubereats", "doordash", "menulog",
        ) to "food",
        listOf(
            "uber", "didi", "ola", "taxi", "cab", "opal", "transport", "train", "bus", "metro",
            "fuel", "petrol", "bp ", "shell", "caltex", "ampol", "parking", "toll", "linkt",
        ) to "transport",
        listOf("rent", "landlord", "real estate", "realestate") to "rent",
        listOf(
            "agl", "origin", "energy", "electric", "water", "gas ", "internet", "telstra",
            "optus", "vodafone", "amaysim", "belong", "nbn",
        ) to "utilities",
        listOf(
            "netflix", "spotify", "youtube", "disney", "apple.com", "apple music", "icloud",
            "prime", "hbo", "openai", "chatgpt", "claude", "subscription", "patreon", "github",
        ) to "subscriptions",
        listOf(
            "cinema", "movie", "event", "ticketek", "ticketmaster", "steam", "playstation",
            "nintendo", "game", "concert", "karaoke", "bowling",
        ) to "entertainment",
        listOf(
            "kmart", "target", "big w", "myer", "uniqlo", "h&m", "zara", "amazon", "ebay",
            "shein", "temu", "ikea", "jb hi", "jbhifi", "officeworks", "chemist", "shop",
        ) to "shopping",
        listOf(
            "pharmacy", "chemist warehouse", "doctor", "medical", "dental", "dentist",
            "hospital", "clinic", "physio", "gym", "fitness", "anytime",
        ) to "health",
        listOf("insurance", "nrma", "aami", "budget direct", "bupa", "medibank", "hcf") to "insurance",
        listOf("udemy", "coursera", "school", "uni", "tafe", "course", "tuition", "book") to "education",
        listOf(
            "qantas", "jetstar", "virgin", "airasia", "flight", "hotel", "airbnb", "agoda",
            "booking.com", "expedia", "travel",
        ) to "travel",
        listOf("gift", "florist", "flowers", "present") to "gifts",
    )

    /**
     * Pick a category id for a vendor, from the provided category list only —
     * same post-validation the iOS model output got. Null = unsure.
     */
    fun categorize(vendor: String, categories: List<String>): String? {
        val lower = vendor.lowercase()
        if (lower.isBlank()) return null
        for ((keywords, category) in vendorRules) {
            if (keywords.any { lower.contains(it) } && categories.contains(category)) {
                return category
            }
        }
        // A vendor whose name IS a category ("Food Market") still lands.
        return categories.firstOrNull { lower.contains(it.replace("_", " ")) }
    }

    /**
     * Two short sentences built from the page's precomputed fact sheet —
     * quoted as written, no advice, exactly the iOS instruction set, done
     * with templates instead of a model.
     */
    fun blurb(facts: String): String? {
        val lines = facts.lines().map { it.trim() }.filter { it.isNotEmpty() }
        if (lines.isEmpty()) return null
        val first = lines.first().removeSuffix(".")
        val second = lines.drop(1).firstOrNull()?.removeSuffix(".")
        return if (second != null) "$first. $second." else "$first."
    }

    /**
     * Answer a question strictly from the fact sheet: return the fact lines
     * whose words overlap the question, never an invented number.
     */
    fun ask(question: String, facts: String): String {
        val lines = facts.lines().map { it.trim() }.filter { it.isNotEmpty() }
        if (lines.isEmpty()) return "No numbers to read yet — open the app once data has loaded."
        val terms = question.lowercase()
            .split(" ", ",", "?", ".", "!")
            .filter { it.length >= 3 }
        val scored = lines.map { line ->
            val lower = line.lowercase()
            line to terms.count { lower.contains(it) }
        }.filter { it.second > 0 }
            .sortedByDescending { it.second }
            .take(3)
            .map { it.first }
        return if (scored.isEmpty()) {
            "From this page's numbers: ${lines.take(2).joinToString(" ")}"
        } else {
            scored.joinToString(" ")
        }
    }

    val fallbackCategories: List<String> = Categories.expenseLabels.map { it.first }
}

/** FNV-1a — a hash that's stable across launches, for the blurb cache. */
fun stableHash(text: String): Long {
    var hash = -0x340d631b7bdddcdbL
    for (byte in text.encodeToByteArray()) {
        hash = hash xor (byte.toLong() and 0xff)
        hash *= 0x100000001b3L
    }
    return hash
}
