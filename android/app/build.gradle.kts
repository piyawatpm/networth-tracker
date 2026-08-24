import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Secrets stay OUT of source and OUT of git: read from the git-ignored
// android/local.properties (or environment variables), empty when absent.
// With no baked values the app simply opens on the sign-in screen, where
// the Supabase project + account can be entered at runtime instead.
val localProps = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun secret(key: String): String {
    val raw = localProps.getProperty(key) ?: System.getenv(key.replace(".", "_").uppercase()) ?: ""
    return raw.trim().replace("\\", "\\\\").replace("\"", "\\\"")
}

android {
    namespace = "com.piyawatpm.vesta"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.piyawatpm.vesta"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // vesta.supabaseUrl / vesta.supabaseKey — the project the app talks
        // to (also settable at runtime on the sign-in screen).
        buildConfigField("String", "VESTA_SUPABASE_URL", "\"${secret("vesta.supabaseUrl")}\"")
        buildConfigField("String", "VESTA_SUPABASE_KEY", "\"${secret("vesta.supabaseKey")}\"")
        // vesta.ownerEmail / vesta.ownerPassword — OPTIONAL convenience for a
        // personal build: enables the silent sign-in. Leave unset for any
        // build you share; the sign-in screen is the fallback either way.
        buildConfigField("String", "VESTA_OWNER_EMAIL", "\"${secret("vesta.ownerEmail")}\"")
        buildConfigField("String", "VESTA_OWNER_PASSWORD", "\"${secret("vesta.ownerPassword")}\"")
        // vesta.alpacaKey / vesta.alpacaSecret — optional paper-trading keys
        // for the live US-stock websocket; blank just disables that feed.
        buildConfigField("String", "VESTA_ALPACA_KEY", "\"${secret("vesta.alpacaKey")}\"")
        buildConfigField("String", "VESTA_ALPACA_SECRET", "\"${secret("vesta.alpacaSecret")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.work.runtime)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.androidx.ui.tooling)
    testImplementation("junit:junit:4.13.2")
}
