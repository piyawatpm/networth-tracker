package com.piyawatpm.vesta.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.piyawatpm.vesta.core.Money
import com.piyawatpm.vesta.core.SydneyTime
import com.piyawatpm.vesta.data.Categories
import com.piyawatpm.vesta.data.ExpenseEntry
import com.piyawatpm.vesta.data.IncomeEntry
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.components.SegmentedControl
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.Ledger
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

enum class EntryKind { INCOME, EXPENSE }

/**
 * One form for income and expense add/edit — the fields are 90% shared, and
 * one implementation means one set of bugs. Port of ios EntryFormView.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EntryFormSheet(
    store: VestaStore,
    kind: EntryKind,
    editingIncome: IncomeEntry? = null,
    editingExpense: ExpenseEntry? = null,
    onDismiss: () -> Unit,
) {
    val isEditing = editingIncome != null || editingExpense != null

    var amount by remember {
        mutableStateOf(
            editingIncome?.amount?.toString() ?: editingExpense?.amount?.toString() ?: ""
        )
    }
    var category by remember {
        mutableStateOf(
            editingIncome?.type ?: editingExpense?.type
                ?: if (kind == EntryKind.INCOME) "salary" else "food"
        )
    }
    var descriptionText by remember {
        mutableStateOf(editingIncome?.description ?: editingExpense?.description ?: "")
    }
    var vendorOrSource by remember {
        mutableStateOf(editingIncome?.source ?: editingExpense?.vendor ?: "")
    }
    var notes by remember {
        mutableStateOf(editingIncome?.notes ?: editingExpense?.notes ?: "")
    }
    var currency by remember {
        mutableStateOf(
            editingIncome?.currency ?: editingExpense?.currency
                ?: if (store.displayCurrency == "THB") "AUD" else store.displayCurrency
        )
    }
    var dateString by remember {
        mutableStateOf(
            (editingIncome?.date ?: editingExpense?.date)?.take(10)?.ifEmpty { null }
                ?: SydneyTime.today()
        )
    }
    var paymentMethod by remember {
        mutableStateOf(editingExpense?.paymentMethod ?: "other")
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showDatePicker by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val categories: List<Pair<String, String>> = when (kind) {
        EntryKind.INCOME -> {
            // Derived categories are projected from tx logs — hand-adding one
            // would double-count, so they're not offered.
            Categories.incomeLabels.filter { it.first !in Categories.derivedIncomeTypes } +
                store.customIncomeCategories.map { it.id to it.label }
        }
        EntryKind.EXPENSE ->
            Categories.expenseLabels + store.customExpenseCategories.map { it.id to it.label }
    }

    val parsedAmount = amount.replace(",", "").toDoubleOrNull()?.takeIf { it > 0 }

    fun save() {
        val value = parsedAmount ?: return
        saving = true
        error = null
        scope.launch {
            try {
                when (kind) {
                    EntryKind.INCOME -> {
                        val entry = (editingIncome ?: IncomeEntry()).copy(
                            type = category,
                            description = descriptionText,
                            amount = value,
                            currency = currency,
                            date = dateString,
                            source = vendorOrSource,
                            notes = notes,
                        )
                        store.saveIncome(entry)
                    }
                    EntryKind.EXPENSE -> {
                        val entry = (editingExpense ?: ExpenseEntry()).copy(
                            type = category,
                            description = descriptionText,
                            amount = value,
                            currency = currency,
                            date = dateString,
                            vendor = vendorOrSource,
                            notes = notes,
                            paymentMethod = paymentMethod,
                        )
                        store.saveExpense(entry)
                    }
                }
                onDismiss()
            } catch (e: Exception) {
                error = e.message
            }
            saving = false
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ledger.background) {
        Column(
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) {
                    Text("Cancel", color = Color.White.copy(alpha = 0.6f))
                }
                Spacer(Modifier.weight(1f))
                Text(
                    "${if (isEditing) "Edit" else "Add"} ${if (kind == EntryKind.INCOME) "Income" else "Expense"}",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = { save() },
                    enabled = parsedAmount != null && category.isNotEmpty() && !saving,
                ) {
                    Text(
                        if (saving) "…" else "Save",
                        color = if (parsedAmount != null && !saving) Ledger.income
                        else Color.White.copy(alpha = 0.3f),
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            // Amount + currency
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    Money.symbol(currency),
                    fontSize = 30.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White.copy(alpha = 0.6f),
                )
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    placeholder = {
                        Text("0.00", fontSize = 30.sp, color = Color.White.copy(alpha = 0.3f))
                    },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = androidx.compose.ui.text.TextStyle(
                        fontSize = 30.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Color.Transparent,
                        unfocusedBorderColor = Color.Transparent,
                    ),
                    modifier = Modifier.weight(1f),
                )
            }
            val currencyOptions = listOf("AUD", "USD", "THB")
            SegmentedControl(
                options = currencyOptions,
                selectedIndex = currencyOptions.indexOf(currency).coerceAtLeast(0),
                modifier = Modifier.fillMaxWidth(),
            ) { currency = currencyOptions[it] }

            // Category grid — everything visible, one tap, color-coded to
            // match the web's donut.
            LabelMono("Category")
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for ((id, label) in categories) {
                    val color = if (kind == EntryKind.INCOME) store.incomeColor(id)
                    else store.expenseColor(id)
                    val selected = category == id
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        modifier = Modifier
                            .background(
                                if (selected) color.copy(alpha = 0.18f)
                                else Color.White.copy(alpha = 0.05f),
                                RoundedCornerShape(50),
                            )
                            .border(
                                1.5.dp,
                                if (selected) color else Color.Transparent,
                                RoundedCornerShape(50),
                            )
                            .clickable { category = id }
                            .padding(horizontal = 12.dp, vertical = 9.dp),
                    ) {
                        Box(Modifier.size(7.dp).background(color, CircleShape))
                        Text(label, fontSize = 12.sp, color = Color.White, maxLines = 1)
                    }
                }
            }

            // Details
            LabelMono("Details")
            val fieldColors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Ledger.income,
                unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
            )
            OutlinedTextField(
                value = descriptionText,
                onValueChange = { descriptionText = it },
                placeholder = { Text("Description", color = Color.White.copy(alpha = 0.4f)) },
                singleLine = true,
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = vendorOrSource,
                onValueChange = { vendorOrSource = it },
                placeholder = {
                    Text(
                        if (kind == EntryKind.INCOME) "Source" else "Vendor",
                        color = Color.White.copy(alpha = 0.4f),
                    )
                },
                singleLine = true,
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )

            // Date row
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(12.dp))
                    .clickable { showDatePicker = true }
                    .padding(horizontal = 14.dp, vertical = 14.dp),
            ) {
                Text("Date", fontSize = 14.sp, color = Color.White)
                Spacer(Modifier.weight(1f))
                Text(
                    dateString,
                    fontSize = 14.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Ledger.income,
                )
            }

            if (kind == EntryKind.EXPENSE) {
                LabelMono("Paid with")
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    for ((id, label) in Categories.paymentMethods) {
                        val selected = paymentMethod == id
                        Text(
                            label,
                            fontSize = 12.sp,
                            color = if (selected) Color.Black else Color.White,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .background(
                                    if (selected) Ledger.income else Color.White.copy(alpha = 0.07f),
                                    RoundedCornerShape(50),
                                )
                                .clickable { paymentMethod = id }
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
            }

            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                placeholder = { Text("Notes", color = Color.White.copy(alpha = 0.4f)) },
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )

            error?.let {
                Text(it, fontSize = 13.sp, color = Ledger.expense)
            }
        }
    }

    if (showDatePicker) {
        val initialMillis = try {
            LocalDate.parse(dateString).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        } catch (_: Exception) {
            System.currentTimeMillis()
        }
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { millis ->
                        dateString = Instant.ofEpochMilli(millis)
                            .atZone(ZoneOffset.UTC).toLocalDate().toString()
                    }
                    showDatePicker = false
                }) { Text("OK", color = Ledger.income) }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) {
                    Text("Cancel", color = Color.White.copy(alpha = 0.6f))
                }
            },
        ) {
            DatePicker(state = pickerState)
        }
    }
}
