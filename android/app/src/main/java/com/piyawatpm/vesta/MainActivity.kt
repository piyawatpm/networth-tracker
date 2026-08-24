package com.piyawatpm.vesta

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.piyawatpm.vesta.ai.OnDeviceAI
import com.piyawatpm.vesta.data.Categories
import com.piyawatpm.vesta.data.DeepLink
import com.piyawatpm.vesta.data.Notify
import com.piyawatpm.vesta.data.PendingExpense
import com.piyawatpm.vesta.data.Settings
import com.piyawatpm.vesta.ui.VestaRoot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val intentScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val app = application as VestaApp
        setContent {
            VestaRoot(app.store)
        }
        handleDeepLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    /** vesta://add?amount=…&merchant=… — the automation path. The tap
     *  carries a merchant but no category, so the on-device categorizer
     *  picks one from the real list; falls back to the default. */
    private fun handleDeepLink(intent: Intent?) {
        val url = intent?.dataString ?: return
        val kind = DeepLink.parse(url) ?: return
        val app = application as VestaApp
        when (kind) {
            is DeepLink.Kind.Inspect -> {
                val data = kind.data
                Toast.makeText(
                    this,
                    "Amount: ${data.amount ?: "— nothing arrived"} ${data.currency ?: ""}\nMerchant: ${data.merchant.ifEmpty { "— nothing arrived" }}",
                    Toast.LENGTH_LONG,
                ).show()
            }
            is DeepLink.Kind.Add -> {
                val data = kind.data
                val amount = data.amount
                if (amount == null) {
                    Toast.makeText(this, "Add failed — no amount in:\n$url", Toast.LENGTH_LONG).show()
                    return
                }
                intentScope.launch {
                    var type = Settings.defaultCategory
                    if (data.merchant.isNotEmpty()) {
                        OnDeviceAI.categorize(
                            data.merchant,
                            Settings.cachedCategories
                                ?: Categories.expenseLabels.map { it.first },
                        )?.let { type = it }
                    }
                    val expense = PendingExpense(
                        amount = amount,
                        type = type,
                        vendor = data.merchant,
                        currency = data.currency ?: Settings.defaultCurrency,
                    )
                    val delivered = try {
                        app.pendingQueue.submit(expense)
                    } catch (_: Exception) {
                        false
                    }
                    val title = if (delivered) "Logged" else "Saved — will sync"
                    val body = "${expense.currency} $amount" +
                        (if (data.merchant.isEmpty()) "" else " at ${data.merchant}") +
                        " · $type"
                    Notify.post(this@MainActivity, title, body)
                    Toast.makeText(this@MainActivity, "$title: $body", Toast.LENGTH_LONG).show()
                    if (delivered) app.store.refresh()
                }
            }
        }
    }
}
