package com.piyawatpm.vesta

import com.piyawatpm.vesta.core.CashFlow
import com.piyawatpm.vesta.core.FlowMath
import com.piyawatpm.vesta.core.ForecastInputs
import com.piyawatpm.vesta.core.ForecastMath
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SnapshotDate
import com.piyawatpm.vesta.core.xirr
import com.piyawatpm.vesta.data.CryptoMath
import com.piyawatpm.vesta.data.DcaCompare
import com.piyawatpm.vesta.data.HostplusApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/** Ports of the web's vitest suites (lib/utils/__tests__) for the shared
 *  math, so a divergence between the platforms fails loudly here. */
class CoreMathTest {

    // MARK: forecast.ts parity

    @Test
    fun `monthly rate compounds to the annual rate`() {
        val monthly = ForecastMath.monthlyRate(7.0)
        val yearly = (1 + monthly).let { r -> (1..12).fold(1.0) { acc, _ -> acc * r } }
        assertEquals(1.07, yearly, 1e-9)
    }

    @Test
    fun `zero return path is plain accumulation`() {
        val inputs = ForecastInputs(1000.0, 100.0, 0.0, 0.0)
        val (withGrowth, savingsOnly) = ForecastMath.projectPath(inputs, 12)
        assertEquals(2200.0, withGrowth[12], 1e-6)
        assertEquals(2200.0, savingsOnly[12], 1e-6)
    }

    @Test
    fun `monthsToReach forward and inverse agree`() {
        val inputs = ForecastInputs(10_000.0, 1_000.0, 7.0, 0.0)
        val target = 100_000.0
        val months = ForecastMath.monthsToReach(inputs, target)
        assertNotNull(months)
        val required = ForecastMath.requiredMonthlySaving(
            inputs.netWorth, inputs.annualReturnPct, inputs.contributionGrowthPct,
            target, months!!,
        )
        assertNotNull(required)
        // Saving the bisected answer reaches the target inside the deadline.
        assertTrue(
            ForecastMath.monthsToReach(inputs.copy(monthlySaving = required!!), target)!! <= months
        )
    }

    @Test
    fun `already-there returns zero, shrinking path returns null`() {
        assertEquals(0, ForecastMath.monthsToReach(ForecastInputs(100.0, 0.0, 7.0, 0.0), 50.0))
        assertNull(ForecastMath.monthsToReach(ForecastInputs(100.0, 0.0, -10.0, 0.0), 1_000_000.0))
    }

    @Test
    fun `measured saving only counts complete months`() {
        val saving = ForecastMath.measuredMonthlySaving(
            listOf(5000.0 to 3000.0, 5000.0 to 0.0, 6000.0 to 4000.0)
        )
        // The income-only month predates expense tracking and is excluded.
        assertEquals(2000.0, saving!!, 1e-9)
    }

    // MARK: performance.ts xirr parity

    @Test
    fun `xirr recovers a known annual return`() {
        val flows = listOf(
            CashFlow("2024-01-01", -1000.0),
            CashFlow("2025-01-01", 1100.0),
        )
        val rate = xirr(flows)
        assertNotNull(rate)
        assertEquals(0.10, rate!!, 0.01)
    }

    @Test
    fun `xirr guards short spans and one-signed flows`() {
        assertNull(xirr(listOf(CashFlow("2024-01-01", -1000.0), CashFlow("2024-01-15", 1010.0))))
        assertNull(xirr(listOf(CashFlow("2024-01-01", -1000.0), CashFlow("2025-01-01", -1000.0))))
    }

    // MARK: crypto-csv.ts parity

    @Test
    fun `quoted thousands separators parse correctly`() {
        val csv = """
            Date,Token,Type,Price (USD),Amount,Total value (USD),Fee,Fee Currency,Notes
            2026-01-02 10:00:00,BTC,buy,"43,210.55",0.5,"21,605.28",0,USDT,
            2026-02-03 11:00:00,BTC,sell,"50,000.00",0.25,"12,500.00",0,USDT,
        """.trimIndent()
        val txs = CryptoMath.parseTransactions(csv)
        assertEquals(2, txs.size)
        assertEquals(43210.55, txs[0].priceUsd!!, 1e-9)
        assertEquals(21605.28, txs[0].totalValueUsd!!, 1e-9)

        val holdings = CryptoMath.computeHoldings(txs)
        assertEquals(1, holdings.size)
        assertEquals(0.25, holdings[0].amount, 1e-9)

        // Realized on the sell: 12500 − 0.25 × (21605.28 / 0.5)
        val (total, byToken) = CryptoMath.computeRealizedPnl(txs)
        assertEquals(1, byToken.size)
        assertEquals(12500.0 - 0.25 * (21605.28 / 0.5), total, 1e-6)
    }

    @Test
    fun `overview csv detection and parsing`() {
        val overview = """
            Some header,Total Value,Last Updated
            x,y,z

            Assets
            "Name","Price","1h %","24h %","7d %","Holdings (USD)","Amount","Avg Buy","P/L","P/L %"
            "BTC","43,000","1","2","3","21,500.00","0.5","40,000","1,500","7.5"
            "USDT","1.00","0","0","0","1,000.00","1,000","1.00","0","0"
        """.trimIndent()
        assertTrue(CryptoMath.isOverviewCsv(overview))
        val holdings = CryptoMath.holdingsFromCsv(overview)
        assertEquals(2, holdings.size)
        val btc = holdings.first { it.token == "BTC" }
        assertEquals(21500.0, btc.valueUsd, 1e-9)
        assertEquals(0.5 * 40000, btc.costUsd, 1e-9)
    }

    @Test
    fun `valueless transferIns move units but not cost basis`() {
        val txs = listOf(
            com.piyawatpm.vesta.data.CryptoTransaction("2026-01-01", "ETH", "buy", 2000.0, 1.0, 2000.0, ""),
            com.piyawatpm.vesta.data.CryptoTransaction("2026-01-05", "ETH", "transferIn", null, 1.0, null, ""),
        )
        val holdings = CryptoMath.computeHoldings(txs)
        assertEquals(2.0, holdings[0].amount, 1e-9)
        // Avg buy stays $2000 — cost = avg × amount = 4000, not dragged to 1000×2.
        assertEquals(4000.0, holdings[0].totalCostUsd, 1e-9)
    }

    @Test
    fun `stablecoin classification handles yield wrappers`() {
        assertTrue(CryptoMath.isStablecoin("USDT"))
        assertTrue(CryptoMath.isStablecoin("Tether"))
        // Yield-bearing wrappers contain "usdc" but are investments, not cash.
        assertTrue(!CryptoMath.isStablecoin("syrupUSDC"))
        assertTrue(CryptoMath.isCashLike("SYRUPUSDC", emptyMap())) // pegged extra
        assertTrue(CryptoMath.isCashLike("BTC", mapOf("BTC" to true))) // user tag wins
    }

    // MARK: hostplus.ts parity

    @Test
    fun `hostplus reprice calibrates units only past the 20 pct guard`() {
        // Normal daily move: units trusted, value = units × price.
        val (units1, value1) = HostplusApi.reprice(units = 1000.0, currentValue = 2900.0, price = 2.95)
        assertEquals(1000.0, units1, 1e-9)
        assertEquals(2950.0, value1, 1e-9)
        // Wildly off: units back-solved from the stored value.
        val (units2, value2) = HostplusApi.reprice(units = 10.0, currentValue = 2900.0, price = 2.9)
        assertEquals(1000.0, units2, 1e-6)
        assertEquals(2900.0, value2, 1e-6)
    }

    // MARK: dca-benchmark.ts parity

    @Test
    fun `asOf forward-fills and clampedStart respects first flow`() {
        val values = listOf(
            DcaCompare.DatedValue("2026-01-01", 100.0),
            DcaCompare.DatedValue("2026-01-05", 120.0),
        )
        assertEquals(100.0, DcaCompare.asOf(values, "2026-01-03")!!, 1e-9)
        assertNull(DcaCompare.asOf(values, "2025-12-31"))
        assertEquals(
            "2026-01-03",
            DcaCompare.clampedStart(values, listOf(DcaCompare.DatedValue("2026-01-03", 50.0))),
        )
    }

    // MARK: timezone/date parity

    @Test
    fun `snapshot date parser matches the day and weekday math`() {
        val ms = SnapshotDate.parse("2026-08-05 14:30:00")
        assertNotNull(ms)
        assertEquals("2026-08-05", com.piyawatpm.vesta.core.sydneyDay(ms!!.toDouble()))
        // 2026-08-05 is a Wednesday (index 3, 0 = Sunday).
        assertEquals(3, SnapshotDate.weekdayIndex("2026-08-05"))
    }

    @Test
    fun `month keys walk backwards across year boundaries`() {
        val keys = FlowMath.monthKeys(3)
        assertEquals(3, keys.size)
        assertTrue(keys[0] < keys[1] && keys[1] < keys[2])
    }

    @Test
    fun `fx converts through usd`() {
        Money.rates = mapOf("USD" to 1.0, "AUD" to 1.5, "THB" to 35.0)
        assertEquals(35.0 / 1.5, Money.convert(1.0, "AUD", "THB"), 1e-9)
        assertEquals(1.0, Money.convert(1.0, "AUD", "AUD"), 1e-9)
        Money.rates = emptyMap()
    }

    @Test
    fun `money format uses compact suffixes and u2212 minus`() {
        assertEquals("$1.2K", Money.format(1234.0, "USD", compact = true))
        assertTrue(Money.format(-5.0, "USD").startsWith("−"))
    }

    @Test
    fun `search matches human date forms`() {
        assertTrue(FlowMath.matches("aug", emptyList(), "2026-08-05"))
        assertTrue(FlowMath.matches("5 aug", emptyList(), "2026-08-05"))
        assertTrue(FlowMath.matches("wed", emptyList(), "2026-08-05"))
        assertTrue(FlowMath.matches("aug coffee", listOf("Coffee shop"), "2026-08-05"))
        assertTrue(!FlowMath.matches("sep", emptyList(), "2026-08-05"))
    }
}
