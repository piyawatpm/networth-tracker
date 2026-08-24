package com.piyawatpm.vesta.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import com.piyawatpm.vesta.data.VestaStore
import com.piyawatpm.vesta.ui.components.VoltButton
import com.piyawatpm.vesta.ui.theme.LabelMono
import com.piyawatpm.vesta.ui.theme.Ledger
import kotlinx.coroutines.launch

/**
 * Sign-in — shown whenever no session exists and no personal build baked a
 * silent sign-in. Also the place a fresh install points itself at ANY
 * Supabase project (URL + publishable key), so setting the app up on a new
 * backend needs zero code changes. Port of ios SignInView.swift, extended.
 */
@Composable
fun SignInScreen(store: VestaStore) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var supabaseUrl by remember {
        mutableStateOf(com.piyawatpm.vesta.data.SupabaseConfig.url)
    }
    var supabaseKey by remember {
        mutableStateOf(com.piyawatpm.vesta.data.SupabaseConfig.publishableKey)
    }
    var showProject by remember {
        // A build with no project baked in NEEDS these fields — open them.
        mutableStateOf(!com.piyawatpm.vesta.data.SupabaseConfig.isConfigured)
    }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy || email.isEmpty() || password.isEmpty()) return
        busy = true
        error = null
        // Persist any project override BEFORE the attempt, so the sign-in
        // call targets what's on screen.
        com.piyawatpm.vesta.data.Settings.supabaseUrl = supabaseUrl
        com.piyawatpm.vesta.data.Settings.supabaseKey = supabaseKey
        scope.launch {
            try {
                store.signIn(email.trim(), password)
            } catch (e: Exception) {
                error = e.message ?: "Sign-in failed."
            }
            busy = false
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    listOf(Ledger.card, Ledger.background),
                    radius = 1400f,
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
            modifier = Modifier.padding(24.dp).widthIn(max = 340.dp),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.TrendingUp,
                    contentDescription = null,
                    tint = Ledger.income,
                    modifier = Modifier.size(44.dp),
                )
                Text(
                    "Vesta",
                    fontSize = 32.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
                LabelMono("Sign in to your ledger")
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val fieldColors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Ledger.income,
                    unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedContainerColor = Ledger.card,
                    unfocusedContainerColor = Ledger.card,
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    placeholder = { Text("Email", color = Color.White.copy(alpha = 0.4f)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = { Text("Password", color = Color.White.copy(alpha = 0.4f)) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth(),
                )

                error?.let {
                    Text(it, fontSize = 13.sp, color = Ledger.expense)
                }

                VoltButton(
                    text = if (busy) "Signing in…" else "Sign in",
                    enabled = !busy && email.isNotEmpty() && password.isNotEmpty(),
                ) { submit() }

                // "Supabase project" — collapsed when a project is already
                // configured, open when the build carries none.
                Text(
                    text = if (showProject) "Supabase project ▾" else "Supabase project ▸",
                    fontSize = 12.sp,
                    color = Color.White.copy(alpha = 0.55f),
                    modifier = androidx.compose.ui.Modifier
                        .align(Alignment.CenterHorizontally)
                        .clickable { showProject = !showProject }
                        .padding(top = 6.dp),
                )
                if (showProject) {
                    OutlinedTextField(
                        value = supabaseUrl,
                        onValueChange = { supabaseUrl = it },
                        placeholder = {
                            Text("https://xxxx.supabase.co", color = Color.White.copy(alpha = 0.4f))
                        },
                        label = { Text("Project URL", color = Color.White.copy(alpha = 0.5f)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        colors = fieldColors,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = supabaseKey,
                        onValueChange = { supabaseKey = it },
                        placeholder = {
                            Text("sb_publishable_…", color = Color.White.copy(alpha = 0.4f))
                        },
                        label = {
                            Text("Publishable (anon) key", color = Color.White.copy(alpha = 0.5f))
                        },
                        singleLine = true,
                        colors = fieldColors,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "Point this install at any Supabase project — create one, run the setup SQL from the repo README, add a user under Authentication, then sign in here. Stored on this device only.",
                        fontSize = 10.sp,
                        color = Color.White.copy(alpha = 0.4f),
                    )
                }
            }
        }
    }
}
