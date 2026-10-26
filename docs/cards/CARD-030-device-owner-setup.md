# CARD-030: Device Owner and enrolment screen

| Field | Value |
|---|---|
| Card | CARD-030 |
| Title | Device Owner and enrolment screen |
| Size | M |
| Depends on | CARD-013 (enrolment API), CARD-029 (Kotlin API client), both merged to `main` |
| Spec sections | docs/SPEC.md §11.2, §11.3, §12.1, §16.1, §16.2 ("Setup screen" and "As built") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-030-device-owner-setup` |
| PR title | `CARD-030: Device Owner and enrolment screen` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

The Android **kid app** (`android/app-kid`) can only lock a phone if it is the phone's **Device Owner**: a special role that a parent gives it once, from a computer, with `adb shell dpm set-device-owner ...` (the steps are in `docs/guides/android-provisioning.md`, already on `main`; read it). Then the app has to be paired with the family: a parent creates a 6-digit code (web app: Kids › kid › Add device), the kid types it on the phone, and the app calls `POST /v1/enrol`, which returns a **device token**. Every later call of the kid app uses that token.

This card is the first real code in `app-kid`. It adds:

- `admin/KidDeviceAdminReceiver.kt`: the Device Owner component, plus `res/xml/device_admin.xml` and its `<receiver>` in the manifest.
- `admin/Policies.kt`: the Device Owner policies of SPEC §12.1 (user restrictions, auto time, permission grants). **Debug** builds skip the two policies that would lock a developer out (USB debugging off and uninstall blocked).
- `enrol/EnrolRules.kt`: small pure functions (clean the typed code, check a server address, the device model text, the error messages). They have no Android code, so JVM unit tests check them.
- `enrol/EnrolmentStore.kt`: keeps the server URL, device id, device token and kid name in app-private storage. The manifest turns off backup and device-to-device transfer, so the token never leaves the phone.
- `setup/SetupViewModel.kt` and `setup/SetupScreen.kt`: the first-run screens (section 6).
- `MainActivity.kt` now shows the setup screens.
- Debug-only files: `src/debug/AndroidManifest.xml` makes debug builds **test-only** (so `adb shell dpm remove-active-admin` can undo Device Owner) and allows `http://` to a server on the PC.
- `server/scripts/dev-enrol-code.ts`: prints an enrolment code for a kid of the development database, so you can test without signing in to the web app.

You test everything on the **Android emulator** on James's PC, against the Docker stack on the same PC. The emulator reaches the PC at `10.0.2.2`, which is the default server of debug builds. You take five screenshots with `adb`; Claude looks at them.

Scanning the QR code comes in CARD-030b. The block screen, usage tracking and the main screen come in later cards.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with 7 `EnrolRulesTest` tests; on an Android 14 emulator the app shows the not-owner screen, becomes Device Owner, rejects a wrong code, enrols with a real code, applies the policies, and the device appears in the database; the five screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No QR scanning, camera or ML Kit (CARD-030b). No Lock Task, block screen, foreground service or notification.
- No Factory Reset Protection policy (needs a family setting that does not exist yet).
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/` or `server/src/`.
- No other new dependency than `ktor-client-okhttp` (5.1). No new npm package.
- Never run `Policies` or the app on a real phone or tablet in this card, and never install a **release** build anywhere: it turns off USB debugging and blocks uninstalling.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, activity-compose 1.13.0, Ktor 3.6.0, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36.

New: `io.ktor:ktor-client-okhttp:3.6.0` (the HTTP engine the kid app gives to `ApiClient`). The `ViewModel` classes come with activity-compose, so nothing else is added.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c30"
New-Item -ItemType Directory -Force $t | Out-Null
```

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `›` (U+203A), `→` (U+2192) and `'` in strings like `Mum or Dad's phone`; copy them exactly.

| File | Action |
|---|---|
| `android/gradle/libs.versions.toml` | replace (5.1) |
| `android/app-kid/build.gradle.kts` | replace (5.2) |
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.3) |
| `android/app-kid/src/main/res/xml/device_admin.xml` | create (5.4) |
| `android/app-kid/src/main/res/xml/data_extraction_rules.xml` | create (5.5) |
| `android/app-kid/src/debug/AndroidManifest.xml` | create (5.6) |
| `android/app-kid/src/debug/res/xml/network_security_config.xml` | create (5.7) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/MainActivity.kt` | replace (5.8) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/admin/KidDeviceAdminReceiver.kt` | create (5.9) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt` | create (5.10) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolRules.kt` | create (5.11) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolmentStore.kt` | create (5.12) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt` | create (5.13) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt` | create (5.14) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/enrol/EnrolRulesTest.kt` | create (5.15) |
| `server/scripts/dev-enrol-code.ts` | create (5.16) |

That is 16 files.

### 5.1 `android/gradle/libs.versions.toml`

The only change: the `ktor-client-okhttp` library line.

```toml
[versions]
agp = "9.4.0"
kotlin = "2.4.21"
composeBom = "2026.09.00"
activityCompose = "1.13.0"
junit = "6.1.3"
kotlinxSerialization = "1.11.0"
ktor = "3.6.0"

[libraries]
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
junit-bom = { group = "org.junit", name = "junit-bom", version.ref = "junit" }
junit-jupiter = { group = "org.junit.jupiter", name = "junit-jupiter" }
junit-platform-launcher = { group = "org.junit.platform", name = "junit-platform-launcher" }
kotlinx-serialization-json = { group = "org.jetbrains.kotlinx", name = "kotlinx-serialization-json", version.ref = "kotlinxSerialization" }
ktor-client-core = { group = "io.ktor", name = "ktor-client-core", version.ref = "ktor" }
ktor-client-content-negotiation = { group = "io.ktor", name = "ktor-client-content-negotiation", version.ref = "ktor" }
ktor-serialization-kotlinx-json = { group = "io.ktor", name = "ktor-serialization-kotlinx-json", version.ref = "ktor" }
ktor-client-mock = { group = "io.ktor", name = "ktor-client-mock", version.ref = "ktor" }
ktor-client-okhttp = { group = "io.ktor", name = "ktor-client-okhttp", version.ref = "ktor" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

### 5.2 `android/app-kid/build.gradle.kts`

The changes: the `buildTypes` block with `DEFAULT_SERVER`, `buildConfig = true`, the `testOptions` block (JUnit 6 for unit tests), the `ktor.client.okhttp` line and the three test lines.

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "au.screentime.kid"
    compileSdk = 37

    defaultConfig {
        applicationId = "au.screentime.kid"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            // The Android emulator reaches the developer's PC at 10.0.2.2 (`pnpm dev:server` or docker compose).
            buildConfigField("String", "DEFAULT_SERVER", "\"http://10.0.2.2:8080\"")
        }
        release {
            buildConfigField("String", "DEFAULT_SERVER", "\"https://screentime.gallagherhome.au\"")
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

    testOptions {
        unitTests.all {
            it.useJUnitPlatform()
        }
    }
}

dependencies {
    implementation(project(":core-ui"))
    implementation(project(":core-time"))
    implementation(project(":core-model"))
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.ktor.client.okhttp)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}
```

### 5.3 `android/app-kid/src/main/AndroidManifest.xml`

Adds the `INTERNET` permission, turns off backup, sets `adjustResize` so the keyboard does not cover the code, and declares the Device Owner receiver.

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <!--
        No backup and no device-to-device transfer: the device token must never leave this device
        (docs/SPEC.md §11.2).
    -->
    <application
        android:allowBackup="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:label="Screen Time"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Material.Light.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <receiver
            android:name=".admin.KidDeviceAdminReceiver"
            android:exported="true"
            android:permission="android.permission.BIND_DEVICE_ADMIN">
            <meta-data
                android:name="android.app.device_admin"
                android:resource="@xml/device_admin" />
            <intent-filter>
                <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
            </intent-filter>
        </receiver>

    </application>

</manifest>
```

### 5.4 `android/app-kid/src/main/res/xml/device_admin.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- A Device Owner needs no listed policies: its powers come from DevicePolicyManager. -->
<device-admin>
    <uses-policies />
</device-admin>
```

### 5.5 `android/app-kid/src/main/res/xml/data_extraction_rules.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Nothing of this app goes to a cloud backup or to a new phone. -->
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </device-transfer>
</data-extraction-rules>
```

### 5.6 `android/app-kid/src/debug/AndroidManifest.xml`

Only in debug builds: Gradle merges it into the main manifest.

```xml
<?xml version="1.0" encoding="utf-8"?>
<!--
    Debug builds only. testOnly lets `adb shell dpm remove-active-admin` take the app off as Device Owner,
    and the network config allows http:// to a server on the developer's PC (10.0.2.2 from the emulator).
-->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:networkSecurityConfig="@xml/network_security_config"
        android:testOnly="true" />

</manifest>
```

### 5.7 `android/app-kid/src/debug/res/xml/network_security_config.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Debug builds only: allow http:// so the app can reach a server running on the PC. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
```

### 5.8 `android/app-kid/src/main/kotlin/au/screentime/kid/MainActivity.kt`

```kotlin
package au.screentime.kid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.setup.SetupScreen
import au.screentime.kid.setup.SetupViewModel

class MainActivity : ComponentActivity() {
    private val setup: SetupViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ScreenTimeTheme {
                SetupScreen(setup)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Picks up a Device Owner set while the app was open, and applies the policies again once enrolled.
        setup.refresh()
    }
}
```

### 5.9 `android/app-kid/src/main/kotlin/au/screentime/kid/admin/KidDeviceAdminReceiver.kt`

```kotlin
package au.screentime.kid.admin

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context

/**
 * The Device Owner component. A parent makes the app Device Owner once, from a computer:
 * `adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver` (docs/guides/android-provisioning.md).
 */
class KidDeviceAdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun component(context: Context) = ComponentName(context, KidDeviceAdminReceiver::class.java)
    }
}
```

### 5.10 `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt`

```kotlin
package au.screentime.kid.admin

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import android.os.UserManager
import android.util.Log
import au.screentime.kid.BuildConfig

/** The Device Owner policies of docs/SPEC.md §12.1. Applying them again changes nothing, so the app does it on every start. */
object Policies {
    private const val TAG = "Policies"

    /** Restrictions for every build. */
    private val RESTRICTIONS = listOf(
        UserManager.DISALLOW_APPS_CONTROL,
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_FACTORY_RESET,
        UserManager.DISALLOW_CONFIG_DATE_TIME,
        UserManager.DISALLOW_ADD_USER,
        UserManager.DISALLOW_AIRPLANE_MODE,
    )

    fun isDeviceOwner(context: Context): Boolean =
        context.getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(context.packageName)

    /**
     * Applies every policy. Does nothing unless the app is Device Owner.
     * A debug build leaves USB debugging on and the app uninstallable, so a developer can always reinstall it
     * and take it off as Device Owner with `adb shell dpm remove-active-admin` (debug builds are test-only).
     */
    fun apply(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)

        for (restriction in RESTRICTIONS) {
            dpm.addUserRestriction(admin, restriction)
        }
        if (!BuildConfig.DEBUG) {
            dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
            dpm.setUninstallBlocked(admin, context.packageName, true)
        }
        dpm.setAutoTimeEnabled(admin, true)
        dpm.setAutoTimeZoneEnabled(admin, true)

        // Every runtime permission the manifest asks for, so the kid never sees a permission prompt.
        for (permission in runtimePermissions(context)) {
            val granted = dpm.setPermissionGrantState(
                admin,
                context.packageName,
                permission,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
            )
            if (!granted) Log.w(TAG, "could not grant $permission")
        }
    }

    /** The permissions in the manifest that a user would otherwise have to allow. */
    private fun runtimePermissions(context: Context): List<String> {
        val pm = context.packageManager
        val info = pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
        return info.requestedPermissions.orEmpty().filter { name ->
            try {
                pm.getPermissionInfo(name, 0).protection == PermissionInfo.PROTECTION_DANGEROUS
            } catch (e: PackageManager.NameNotFoundException) {
                false
            }
        }
    }
}
```

### 5.11 `android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolRules.kt`

```kotlin
package au.screentime.kid.enrol

import java.net.URI

// The small decisions of enrolment, kept free of Android so the JVM tests can check them.

/** What the kid typed, as at most 6 digits: spaces, dashes and letters are dropped. */
fun cleanCode(input: String): String = input.filter { it in '0'..'9' }.take(6)

/**
 * The server's base URL from what a parent typed or the QR code held, or null when it is not a server address.
 * Without a scheme it is `https://`. `http://` only works when [allowHttp] is true (debug builds, for a server
 * on the PC). A trailing `/` is dropped; a path, query or user name is refused.
 */
fun serverUrl(input: String, allowHttp: Boolean): String? {
    val text = input.trim()
    if (text.isEmpty() || text.any { it.isWhitespace() }) return null
    val withScheme = if ("://" in text) text else "https://$text"
    val uri = try {
        URI(withScheme)
    } catch (e: Exception) {
        return null
    }
    val scheme = uri.scheme?.lowercase()
    if (scheme != "https" && !(scheme == "http" && allowHttp)) return null
    if (uri.host.isNullOrEmpty() || uri.userInfo != null) return null
    if ((uri.rawPath ?: "") !in listOf("", "/") || uri.rawQuery != null || uri.rawFragment != null) return null
    val port = if (uri.port == -1) "" else ":${uri.port}"
    return "$scheme://${uri.host.lowercase()}$port"
}

/** The server address without `https://`, to show under the code boxes. */
fun serverLabel(url: String): String = url.removePrefix("https://")

/** `Google` + `Pixel 7` → `Google Pixel 7`; `samsung` + `SM-S916B` → `Samsung SM-S916B`. At most 100 characters. */
fun deviceModel(manufacturer: String, model: String): String {
    val maker = manufacturer.trim().replaceFirstChar { it.uppercase() }
    val name = model.trim()
    val full = when {
        maker.isEmpty() -> name
        name.isEmpty() -> maker
        name.startsWith(maker, ignoreCase = true) -> name
        else -> "$maker $name"
    }
    return full.ifEmpty { "Android device" }.take(100)
}

/** What the kid sees when enrolment fails. [status] is null when the server could not be reached. */
fun enrolErrorMessage(status: Int?): String = when (status) {
    null -> "Can't reach Screen Time. Check the Wi-Fi and try again."
    401 -> "That code didn't work. Check it, or ask for a new one."
    409 -> "That code is for a PC. Ask for a phone or tablet code."
    429 -> "Too many tries. Wait 15 minutes, then try again."
    else -> "Something went wrong. Try again."
}
```

### 5.12 `android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolmentStore.kt`

```kotlin
package au.screentime.kid.enrol

import android.content.Context

/** What this device knows after enrolment (docs/SPEC.md §11.2, §11.3). */
data class Enrolment(
    val serverUrl: String,
    val deviceId: String,
    val deviceToken: String,
    val kidName: String,
    val familyTimezone: String,
    /** The kid said "Yes, this phone is mine". Until then the setup screen asks again. */
    val confirmed: Boolean,
)

/**
 * Keeps the enrolment in the app's private storage. Backup and device-to-device transfer are off for the whole
 * app (AndroidManifest.xml), so the device token never leaves this device.
 */
class EnrolmentStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("enrolment", Context.MODE_PRIVATE)

    fun load(): Enrolment? {
        val token = prefs.getString(TOKEN, null) ?: return null
        return Enrolment(
            serverUrl = prefs.getString(SERVER, null) ?: return null,
            deviceId = prefs.getString(DEVICE, null) ?: return null,
            deviceToken = token,
            kidName = prefs.getString(KID, null) ?: return null,
            familyTimezone = prefs.getString(TIMEZONE, null) ?: return null,
            confirmed = prefs.getBoolean(CONFIRMED, false),
        )
    }

    fun save(enrolment: Enrolment) {
        prefs.edit()
            .putString(SERVER, enrolment.serverUrl)
            .putString(DEVICE, enrolment.deviceId)
            .putString(TOKEN, enrolment.deviceToken)
            .putString(KID, enrolment.kidName)
            .putString(TIMEZONE, enrolment.familyTimezone)
            .putBoolean(CONFIRMED, enrolment.confirmed)
            .commit()
    }

    /** Forgets the enrolment, but keeps [lastServer]. */
    fun clear() {
        prefs.edit()
            .remove(SERVER)
            .remove(DEVICE)
            .remove(TOKEN)
            .remove(KID)
            .remove(TIMEZONE)
            .remove(CONFIRMED)
            .commit()
    }

    /** The server the kid used last, so a second try starts from it. */
    var lastServer: String?
        get() = prefs.getString(LAST_SERVER, null)
        set(value) {
            prefs.edit().putString(LAST_SERVER, value).commit()
        }

    private companion object {
        const val SERVER = "serverUrl"
        const val DEVICE = "deviceId"
        const val TOKEN = "deviceToken"
        const val KID = "kidName"
        const val TIMEZONE = "familyTimezone"
        const val CONFIRMED = "confirmed"
        const val LAST_SERVER = "lastServer"
    }
}
```

### 5.13 `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt`

```kotlin
package au.screentime.kid.setup

import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.EnrolRequest
import au.screentime.core.model.api.Platform
import au.screentime.kid.BuildConfig
import au.screentime.kid.admin.Policies
import au.screentime.kid.enrol.Enrolment
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.enrol.cleanCode
import au.screentime.kid.enrol.deviceModel
import au.screentime.kid.enrol.enrolErrorMessage
import au.screentime.kid.enrol.serverUrl
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** One screen of the first-run setup (docs/SPEC.md §16.2, "Setup screen"). */
sealed interface SetupState {
    /** The app is not Device Owner yet: a parent has to finish setup on a computer. */
    data object NotOwner : SetupState

    /** Typing the 6-digit code. [server] is the base URL; [editingServer] shows the address field. */
    data class EnterCode(
        val code: String = "",
        val server: String,
        val serverText: String = "",
        val editingServer: Boolean = false,
        val busy: Boolean = false,
        val error: String? = null,
        val note: String? = null,
    ) : SetupState

    /** Enrolled; the kid checks the name before the phone is locked down. */
    data class Confirm(val kidName: String) : SetupState

    /** Enrolled and confirmed. The main screen comes in a later card. */
    data class Done(val kidName: String) : SetupState
}

class SetupViewModel(app: Application) : AndroidViewModel(app) {
    private val store = EnrolmentStore(app)

    var state by mutableStateOf(initialState())
        private set

    /** Phone or tablet, for the copy ("This phone belongs to..."). */
    val deviceWord: String =
        if (app.resources.configuration.smallestScreenWidthDp >= 600) "tablet" else "phone"

    private fun initialState(): SetupState {
        val enrolment = store.load()
        return when {
            enrolment?.confirmed == true -> SetupState.Done(enrolment.kidName)
            enrolment != null -> SetupState.Confirm(enrolment.kidName)
            !Policies.isDeviceOwner(getApplication()) -> SetupState.NotOwner
            else -> enterCode()
        }
    }

    private fun enterCode(note: String? = null) =
        SetupState.EnterCode(server = store.lastServer ?: BuildConfig.DEFAULT_SERVER, note = note)

    /** Looks again, for example after a parent ran the adb command while this screen was open. */
    fun refresh() {
        if (state is SetupState.NotOwner) state = initialState()
        if (state is SetupState.Done) Policies.apply(getApplication())
    }

    fun onCodeChange(text: String) {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy) return
        state = s.copy(code = cleanCode(text), error = null)
    }

    fun onEditServer() {
        val s = state as? SetupState.EnterCode ?: return
        state = s.copy(editingServer = true, serverText = s.server.removePrefix("https://"), error = null)
    }

    fun onServerTextChange(text: String) {
        val s = state as? SetupState.EnterCode ?: return
        state = s.copy(serverText = text, error = null)
    }

    fun onServerDone() {
        val s = state as? SetupState.EnterCode ?: return
        val url = serverUrl(s.serverText, allowHttp = BuildConfig.DEBUG)
        state = if (url == null) {
            s.copy(error = "That doesn't look like a server address.")
        } else {
            s.copy(server = url, editingServer = false)
        }
    }

    fun onConnect() {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy || s.code.length != 6 || s.editingServer) return
        state = s.copy(busy = true, error = null, note = null)
        viewModelScope.launch {
            state = try {
                val enrolment = enrol(s.server, s.code)
                store.lastServer = s.server
                store.save(enrolment)
                SetupState.Confirm(enrolment.kidName)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                s.copy(busy = false, code = "", error = enrolErrorMessage(e.status))
            } catch (e: Exception) {
                s.copy(busy = false, error = enrolErrorMessage(null))
            }
        }
    }

    /** "Yes, that's me": lock the device down and finish. */
    fun onConfirm() {
        val enrolment = store.load() ?: return
        store.save(enrolment.copy(confirmed = true))
        Policies.apply(getApplication())
        state = SetupState.Done(enrolment.kidName)
    }

    /** "No": forget this enrolment. A parent removes the device in the parent app (it stays listed until then). */
    fun onReject() {
        store.clear()
        state = enterCode(note = "OK. Ask Mum or Dad to remove this $deviceWord in Screen Time, then use a new code.")
    }

    private suspend fun enrol(server: String, code: String): Enrolment {
        val app = getApplication<Application>()
        // The client does not close an engine it was given, so both are closed here.
        OkHttp.create().use { engine ->
            ApiClient(server, engine, token = { null }).use { api ->
                val response = api.postEnrol(
                    EnrolRequest(
                        code = code,
                        platform = Platform.ANDROID,
                        hasCellular = app.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_SUBSCRIPTION),
                        model = deviceModel(Build.MANUFACTURER, Build.MODEL),
                        osVersion = "Android ${Build.VERSION.RELEASE}",
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                )
                return Enrolment(
                    serverUrl = server,
                    deviceId = response.deviceId,
                    deviceToken = response.deviceToken,
                    kidName = response.kid.name,
                    familyTimezone = response.family.timezone,
                    confirmed = false,
                )
            }
        }
    }
}
```

### 5.14 `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt`

```kotlin
package au.screentime.kid.setup

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.enrol.serverLabel

/** Guide for the computer part of setup (docs/SPEC.md §12.1). */
private const val GUIDE = "github.com/jamesgallagher/ScreenTime › docs/guides/android-provisioning.md"

@Composable
fun SetupScreen(vm: SetupViewModel) {
    when (val s = vm.state) {
        SetupState.NotOwner -> NotOwnerScreen(onCheckAgain = vm::refresh)
        is SetupState.EnterCode -> EnterCodeScreen(
            state = s,
            onCodeChange = vm::onCodeChange,
            onConnect = vm::onConnect,
            onEditServer = vm::onEditServer,
            onServerTextChange = vm::onServerTextChange,
            onServerDone = vm::onServerDone,
        )
        is SetupState.Confirm -> ConfirmScreen(s.kidName, vm.deviceWord, onYes = vm::onConfirm, onNo = vm::onReject)
        is SetupState.Done -> DoneScreen(s.kidName, vm.deviceWord)
    }
}

/** Every setup screen: centred column, at most 480 dp wide, scrolls when the keyboard is up. */
@Composable
private fun SetupPage(content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 480.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            content = content,
        )
    }
}

@Composable
private fun Title(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun Body(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        color = ScreenTimeTheme.colors.muted,
        textAlign = TextAlign.Center,
    )
}

/** Primary pill button, 56 dp high and full width (docs/SPEC.md §16.1, kid buttons). */
@Composable
private fun BigButton(text: String, onClick: () -> Unit, enabled: Boolean = true, busy: Boolean = false) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(24.dp),
                strokeWidth = 3.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            Text(text, style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** The app's mark: a teal circle with a white hourglass, 72 dp. */
@Composable
private fun HourglassMark() {
    val primary = MaterialTheme.colorScheme.primary
    val onPrimary = MaterialTheme.colorScheme.onPrimary
    Canvas(
        modifier = Modifier
            .size(72.dp)
            .semantics { contentDescription = "Screen Time" },
    ) {
        drawCircle(primary)
        val w = size.width
        val h = size.height
        val glass = Path().apply {
            moveTo(w * 0.32f, h * 0.26f)
            lineTo(w * 0.68f, h * 0.26f)
            lineTo(w * 0.5f, h * 0.5f)
            lineTo(w * 0.68f, h * 0.74f)
            lineTo(w * 0.32f, h * 0.74f)
            lineTo(w * 0.5f, h * 0.5f)
            close()
        }
        drawPath(glass, onPrimary)
        val bar = h * 0.05f
        drawLine(onPrimary, Offset(w * 0.28f, h * 0.24f), Offset(w * 0.72f, h * 0.24f), strokeWidth = bar)
        drawLine(onPrimary, Offset(w * 0.28f, h * 0.76f), Offset(w * 0.72f, h * 0.76f), strokeWidth = bar)
    }
}

@Composable
private fun NotOwnerScreen(onCheckAgain: () -> Unit) {
    SetupPage {
        HourglassMark()
        Spacer(Modifier.height(24.dp))
        Title("Ask a parent to finish setup")
        Spacer(Modifier.height(12.dp))
        Body("Screen Time needs a computer to finish setting up. Mum or Dad can follow the guide:")
        Spacer(Modifier.height(12.dp))
        Text(
            text = GUIDE,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        FilledTonalButton(
            onClick = onCheckAgain,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Text("Check again", style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun EnterCodeScreen(
    state: SetupState.EnterCode,
    onCodeChange: (String) -> Unit,
    onConnect: () -> Unit,
    onEditServer: () -> Unit,
    onServerTextChange: (String) -> Unit,
    onServerDone: () -> Unit,
) {
    SetupPage {
        HourglassMark()
        Spacer(Modifier.height(24.dp))
        Title("Connect to your family")
        Spacer(Modifier.height(12.dp))
        Body("On Mum or Dad's phone, open Screen Time, choose your name and tap Add device. Then type the code here.")
        Spacer(Modifier.height(32.dp))
        CodeBoxes(code = state.code, enabled = !state.busy && !state.editingServer, onChange = onCodeChange, onDone = onConnect)
        Spacer(Modifier.height(16.dp))
        val message = state.error ?: state.note
        if (message != null) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = if (state.error != null) ScreenTimeTheme.colors.critical else ScreenTimeTheme.colors.muted,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
        }
        BigButton(
            text = "Connect",
            onClick = onConnect,
            enabled = state.code.length == 6 && !state.editingServer,
            busy = state.busy,
        )
        Spacer(Modifier.height(24.dp))
        if (state.editingServer) {
            OutlinedTextField(
                value = state.serverText,
                onValueChange = onServerTextChange,
                label = { Text("Server address") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onServerDone() }),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onServerDone) { Text("Done") }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Server: ${serverLabel(state.server)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.muted,
                )
                TextButton(onClick = onEditServer, enabled = !state.busy) { Text("Change") }
            }
        }
    }
}

/**
 * Six boxes over one hidden text field, so the number keyboard, paste and backspace all work.
 * The box for the next digit has a primary border.
 */
@Composable
private fun CodeBoxes(code: String, enabled: Boolean, onChange: (String) -> Unit, onDone: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(enabled) {
        if (enabled) focus.requestFocus()
    }
    val colors = ScreenTimeTheme.colors
    BasicTextField(
        value = code,
        onValueChange = onChange,
        enabled = enabled,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = Modifier
            .focusRequester(focus)
            .semantics { contentDescription = "6-digit code" },
        decorationBox = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (i in 0 until 6) {
                    val digit = code.getOrNull(i)?.toString() ?: ""
                    val current = enabled && i == code.length
                    Box(
                        modifier = Modifier
                            .size(width = 48.dp, height = 60.dp)
                            .background(colors.surfaceVariant, RoundedCornerShape(12.dp))
                            .border(
                                width = if (current) 2.dp else 1.dp,
                                color = if (current) colors.primary else colors.outline,
                                shape = RoundedCornerShape(12.dp),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = digit,
                            fontSize = 28.sp,
                            fontWeight = FontWeight.Bold,
                            color = colors.onSurface,
                        )
                    }
                }
            }
        },
    )
}

@Composable
private fun KidInitial(name: String) {
    Box(
        modifier = Modifier
            .size(96.dp)
            .background(MaterialTheme.colorScheme.primary, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = name.take(1).uppercase(),
            fontSize = 44.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

@Composable
private fun ConfirmScreen(kidName: String, deviceWord: String, onYes: () -> Unit, onNo: () -> Unit) {
    SetupPage {
        KidInitial(kidName)
        Spacer(Modifier.height(24.dp))
        Title("This $deviceWord belongs to $kidName. Correct?")
        Spacer(Modifier.height(32.dp))
        BigButton(text = "Yes", onClick = onYes)
        Spacer(Modifier.height(8.dp))
        TextButton(
            onClick = onNo,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Text("No, that's not me", style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun DoneScreen(kidName: String, deviceWord: String) {
    SetupPage {
        KidInitial(kidName)
        Spacer(Modifier.height(24.dp))
        Title("All set, $kidName")
        Spacer(Modifier.height(12.dp))
        Body("Screen Time is looking after this $deviceWord now.")
    }
}
```

### 5.15 `android/app-kid/src/test/kotlin/au/screentime/kid/enrol/EnrolRulesTest.kt`

```kotlin
package au.screentime.kid.enrol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class EnrolRulesTest {
    @Test
    fun cleanCodeKeepsAtMostSixDigits() {
        assertEquals("123456", cleanCode("123456"))
        assertEquals("123456", cleanCode(" 123-456 "))
        assertEquals("123456", cleanCode("1234567"))
        assertEquals("12", cleanCode("1a2b"))
        assertEquals("", cleanCode("abc"))
    }

    @Test
    fun serverUrlAddsHttpsAndDropsTheSlash() {
        assertEquals("https://screentime.gallagherhome.au", serverUrl("screentime.gallagherhome.au", allowHttp = false))
        assertEquals("https://screentime.gallagherhome.au", serverUrl(" https://Screentime.Gallagherhome.au/ ", allowHttp = false))
        assertEquals("https://192.168.1.20:8443", serverUrl("192.168.1.20:8443", allowHttp = false))
    }

    @Test
    fun serverUrlTakesHttpOnlyWhenAllowed() {
        assertEquals("http://10.0.2.2:8080", serverUrl("http://10.0.2.2:8080", allowHttp = true))
        assertNull(serverUrl("http://10.0.2.2:8080", allowHttp = false))
    }

    @Test
    fun serverUrlRefusesWhatIsNotAServer() {
        for (bad in listOf("", "   ", "ftp://example.com", "https://", "exa mple.com", "example.com/v1", "example.com?x=1", "https://me@example.com")) {
            assertNull(serverUrl(bad, allowHttp = true), bad)
        }
    }

    @Test
    fun serverLabelHidesHttps() {
        assertEquals("screentime.gallagherhome.au", serverLabel("https://screentime.gallagherhome.au"))
        assertEquals("http://10.0.2.2:8080", serverLabel("http://10.0.2.2:8080"))
    }

    @Test
    fun deviceModelJoinsMakerAndModelOnce() {
        assertEquals("Google Pixel 7", deviceModel("Google", "Pixel 7"))
        assertEquals("Samsung SM-S916B", deviceModel("samsung", "SM-S916B"))
        assertEquals("XPPen Magic Drawing Pad", deviceModel("XPPen", "XPPen Magic Drawing Pad"))
        assertEquals("Android device", deviceModel(" ", " "))
        assertEquals(100, deviceModel("Maker", "x".repeat(200)).length)
    }

    @Test
    fun enrolErrorMessagesAreFriendly() {
        assertEquals("That code didn't work. Check it, or ask for a new one.", enrolErrorMessage(401))
        assertEquals("That code is for a PC. Ask for a phone or tablet code.", enrolErrorMessage(409))
        assertEquals("Too many tries. Wait 15 minutes, then try again.", enrolErrorMessage(429))
        assertEquals("Can't reach Screen Time. Check the Wi-Fi and try again.", enrolErrorMessage(null))
        assertEquals("Something went wrong. Try again.", enrolErrorMessage(500))
    }
}
```

### 5.16 `server/scripts/dev-enrol-code.ts`

A development tool only, like `seed-dev.ts` next to it. It writes straight to the database, so it needs no sign-in.

```typescript
// Prints a fresh enrolment code for a kid of the development database, without signing in to the web app.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone
// The kid name is matched without case; the form is phone, tablet or pc. Never run this against the production database.
import { asc, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { enrolmentCodes, kids, parents } from '../src/db/schema.js';
import { newEnrolmentCode } from '../src/devices/token.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const form = process.argv[3]?.trim();
if (!databaseUrl || !kidName || !form || !['phone', 'tablet', 'pc'].includes(form)) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-enrol-code.ts <kid name> <phone|tablet|pc>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db
    .select()
    .from(kids)
    .where(sql`lower(${kids.name}) = lower(${kidName})`)
    .orderBy(asc(kids.createdAt))
    .limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}: run scripts/seed-dev.ts first`);
  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.familyId, kid.familyId))
    .orderBy(asc(parents.createdAt))
    .limit(1);
  if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
  // Codes are random, so a clash with another live code is one in a million.
  const code = newEnrolmentCode();
  await db.insert(enrolmentCodes).values({
    familyId: kid.familyId,
    kidId: kid.id,
    form,
    code,
    expiresAt: sql`now() + interval '10 minutes'`,
    createdBy: parent.id,
  });
  console.log(`Enrolment code for ${kid.name} (${form}): ${code}, valid for 10 minutes.`);
} finally {
  await pool.end();
}
```

## 6. Detailed spec

### 6.1 The screens

All screens: the app's background colour, content centred, at most 480 dp wide, 24 dp side padding, scrolls when the keyboard is up. Titles are `headlineMedium` bold; body text is `bodyLarge` in `muted`; buttons are pills 56 dp high and full width. Copy is short and warm (SPEC §16.1). The kid never sees an error code.

| State | When | What is on screen |
|---|---|---|
| `NotOwner` | the app is not Device Owner | 72 dp teal circle with a white hourglass; "Ask a parent to finish setup"; "Screen Time needs a computer to finish setting up. Mum or Dad can follow the guide:"; the guide path; tonal button **Check again** |
| `EnterCode` | Device Owner, not enrolled | hourglass mark; "Connect to your family"; "On Mum or Dad's phone, open Screen Time, choose your name and tap Add device. Then type the code here."; 6 code boxes (48×60 dp, 12 dp corners, the box for the next digit has a 2 dp primary border); an error in `critical` or a note in `muted`; **Connect** (enabled at 6 digits, a spinner while sending); "Server: …" with **Change** |
| `EnterCode`, editing | after **Change** | an outlined "Server address" field and **Done** instead of the server line; the code boxes and **Connect** are disabled |
| `Confirm` | enrolled, not confirmed | 96 dp teal circle with the kid's initial; "This phone belongs to Alex. Correct?" (tablet: "This tablet ..."); **Yes**; text button **No, that's not me** |
| `Done` | confirmed | the initial circle; "All set, Alex"; "Screen Time is looking after this phone now." |

### 6.2 What happens

- **Check again** and every return to the app (`onResume`) look again whether the app became Device Owner.
- Typing keeps digits only, at most 6 (`cleanCode`). The Enter key on the code keyboard is the same as **Connect**.
- **Connect** calls `POST /v1/enrol` with `platform: android`, `hasCellular` (the device has a SIM slot feature), `model` (`deviceModel`, for example "Google sdk_gphone64_x86_64" on the emulator), `osVersion` ("Android 14") and `appVersion` ("0.1.0").
- On an error the code boxes clear (except when the server could not be reached) and the message comes from `enrolErrorMessage`: 401 "That code didn't work. Check it, or ask for a new one.", 409 "That code is for a PC. Ask for a phone or tablet code.", 429 "Too many tries. Wait 15 minutes, then try again.", no connection "Can't reach Screen Time. Check the Wi-Fi and try again.", anything else "Something went wrong. Try again."
- On success the enrolment is saved at once (confirmed = false), so a restart shows `Confirm` again.
- **Yes** saves confirmed = true, applies `Policies`, and shows `Done`. Every later start applies `Policies` again.
- **No, that's not me** forgets the enrolment (the server keeps the device until a parent removes it) and shows `EnterCode` with the note "OK. Ask Mum or Dad to remove this phone in Screen Time, then use a new code."
- **Change**: the field accepts `screentime.gallagherhome.au`, `https://...`, a port, and in debug builds `http://...` (`serverUrl`). Anything else shows "That doesn't look like a server address." The last server that worked is remembered.

### 6.3 The policies (`Policies.apply`)

| Policy | Debug build | Release build |
|---|---|---|
| `DISALLOW_APPS_CONTROL`, `DISALLOW_SAFE_BOOT`, `DISALLOW_FACTORY_RESET`, `DISALLOW_CONFIG_DATE_TIME`, `DISALLOW_ADD_USER`, `DISALLOW_AIRPLANE_MODE` | yes | yes |
| auto time and auto time zone on | yes | yes |
| every dangerous permission in the manifest granted (none yet) | yes | yes |
| `DISALLOW_DEBUGGING_FEATURES` | **no** | yes |
| uninstall blocked | **no** | yes |

In `dumpsys device_policy` the restrictions show by their keys: `no_control_apps`, `no_safe_boot`, `no_factory_reset`, `no_config_date_time`, `no_add_user`, `no_airplane_mode` (and `no_debugging_features` only in release).

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-030-device-owner-setup
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-030-device-owner-setup.md` and `docs/guides/android-provisioning.md` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.14. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-030: Device Owner policies and the setup screens`.
3. Create 5.15 and 5.16. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-030: enrolment rule tests and a dev enrolment code script`.
4. Run the acceptance checks in section 8, including the emulator run (8.2).
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints four lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml, app-kid\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.api.ApiClientTest tests="13" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolRulesTest tests="7" failures="0" errors="0"
  ```
- [ ] Debug builds are test-only and allow http; the main manifest has the receiver. From `android`, this prints `True` three times:
  ```powershell
  $m = Get-Content app-kid\build\intermediates\merged_manifest\debug\processDebugMainManifest\AndroidManifest.xml -Raw
  $m -match 'android:testOnly="true"'
  $m -match 'android:networkSecurityConfig="@xml/network_security_config"'
  $m -match 'au.screentime.kid.admin.KidDeviceAdminReceiver'
  ```
  If the file is not at that path, find it with `Get-ChildItem app-kid\build\intermediates -Recurse -Filter AndroidManifest.xml | Select-Object FullName` and use the one under `merged_manifest\debug`; say so under "Deviations".

### 8.2 On the emulator

**The emulator.** In Android Studio: Device Manager › **+** › Create Virtual Device › **Pixel 7** › system image **API 34, Google APIs** (not "Google Play"; download it if needed) › Finish. Start it and do not sign in to any Google account. If you cannot create or start it, stop and ask James (he installs missing tools). Then `& $adb devices` must list exactly one `emulator-5554   device`. If a real phone is also plugged in, unplug it.

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored):

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
```

The last line prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

**A helper** to tap a button by its text and to take a screenshot. Paste it into the same PowerShell window (it is not a file in the repo):

```powershell
function Tap-Text([string]$text) {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -First 1
  if (-not $node) { throw "No '$text' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds 2
}
function Shot([string]$name) {
  & $adb shell screencap -p /sdcard/shot.png
  & $adb pull /sdcard/shot.png "$t\$name.png" | Out-Null
}
```

Never use `adb exec-out screencap > file.png` in PowerShell: it breaks the image.

**The run.** From `android`, one step at a time; check each expected result before the next step:

1. Install and open the app:
   ```powershell
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell am start -n au.screentime.kid/.MainActivity
   Start-Sleep -Seconds 3
   Shot "1-not-owner"
   ```
   The screen says "Ask a parent to finish setup".
2. Make the app Device Owner and check again:
   ```powershell
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   Tap-Text "Check again"
   Shot "2-enter-code"
   ```
   `dpm` prints `Success: Device owner set to package ComponentInfo{au.screentime.kid/au.screentime.kid.admin.KidDeviceAdminReceiver}` (or similar). The screen says "Connect to your family" and "Server: http://10.0.2.2:8080".
3. A wrong code:
   ```powershell
   & $adb shell input text 000000
   Tap-Text "Connect"
   Shot "3-wrong-code"
   ```
   The screen says "That code didn't work. Check it, or ask for a new one." and the boxes are empty.
4. A real code (from the repo root in a second PowerShell window, with the same `$env:DATABASE_URL`):
   ```powershell
   pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone
   ```
   It prints `Enrolment code for Alex (phone): <6 digits>, valid for 10 minutes.` Back in the first window, with those digits:
   ```powershell
   & $adb shell input text <the 6 digits>
   Tap-Text "Connect"
   Shot "4-confirm"
   ```
   The screen says "This phone belongs to Alex. Correct?".
5. Confirm:
   ```powershell
   Tap-Text "Yes"
   Shot "5-done"
   ```
   The screen says "All set, Alex".
6. Check the policies. This prints `True` six times, then `False`:
   ```powershell
   $p = & $adb shell dumpsys device_policy | Out-String
   foreach ($k in 'no_control_apps', 'no_safe_boot', 'no_factory_reset', 'no_config_date_time', 'no_add_user', 'no_airplane_mode') { $p -match $k }
   $p -match 'no_debugging_features'
   ```
7. Check the device on the server (from the repo root):
   ```powershell
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db psql -U screentime -d screentime -c "select name, form, platform, has_cellular, os_version, app_version from devices"
   ```
   One row: a name starting with `Google sdk_gphone`, `phone`, `android`, `t` or `f`, `Android 14`, `0.1.0`.
8. Undo, so the emulator can be used again:
   ```powershell
   & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb uninstall au.screentime.kid
   cd ..
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item Env:DATABASE_URL
   ```
   `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 8 gave the expected results.
- [ ] The five screenshots exist: `C:\Users\james\OpenCode\Testing\temp\c30\1-not-owner.png`, `2-enter-code.png`, `3-wrong-code.png`, `4-confirm.png`, `5-done.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing in `server/src` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback. The **TypeScript** checks also run because of 5.16; they must be green too.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 16 files (in any order):
  ```
  android/app-kid/build.gradle.kts
  android/app-kid/src/debug/AndroidManifest.xml
  android/app-kid/src/debug/res/xml/network_security_config.xml
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/MainActivity.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/admin/KidDeviceAdminReceiver.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolRules.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolmentStore.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt
  android/app-kid/src/main/res/xml/data_extraction_rules.xml
  android/app-kid/src/main/res/xml/device_admin.xml
  android/app-kid/src/test/kotlin/au/screentime/kid/enrol/EnrolRulesTest.kt
  android/gradle/libs.versions.toml
  server/scripts/dev-enrol-code.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/enrol/EnrolRulesTest.kt` | `cleanCode` keeps at most 6 digits. `serverUrl` adds `https://`, lower-cases the host, keeps a port, drops a trailing `/`, takes `http://` only when allowed, and refuses empty text, other schemes, spaces, paths, queries and user names. `serverLabel` hides `https://` only. `deviceModel` joins maker and model once and caps at 100 characters. `enrolErrorMessage` gives the five texts of 6.2. |

The screens, the policies and enrolment are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-030: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-030-device-owner-setup`
5. Open a PR into `main` titled `CARD-030: Device Owner and enrolment screen`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-030-device-owner-setup --title "CARD-030: Device Owner and enrolment screen" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-030-device-owner-setup.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: DurationFormatTest 9, EngineVectorsTest 27, ApiClientTest 13, EnrolRulesTest 7, all `failures="0"`
   - [x] merged debug manifest — output: `True` three times
   - [x] emulator run steps 1 to 8 — results as expected
   - [x] five screenshots in C:\Users\james\OpenCode\Testing\temp\c30\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 16 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Only tick a box if you ran the command and saw that output. If you could not run something, leave the box empty and say why.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **`dpm set-device-owner` says there are accounts or several users**: the emulator has a Google account or a second user. Use a fresh emulator with the "Google APIs" image and do not sign in. Never remove accounts from a real phone in this card.
- **`dpm set-device-owner` says the device is already provisioned**: on some images it only works right after a wipe. In Device Manager, choose **Wipe Data** for the emulator, start it again, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
- **"Can't reach Screen Time" after Connect**: the API is not up, or the app is not using `http://10.0.2.2:8080`. Check `curl.exe -s http://localhost:8080/health` on the PC, and that `docker compose ... ps` shows the api running. Do not change the default server.
- **`Tap-Text` says `No 'Connect' on screen`**: the keyboard or a system dialog is covering it, or the screen changed. Take a `Shot` to see, press `& $adb shell input keyevent 4` (Back) once to close the keyboard, and try again.
- **`input text` types nothing**: tap a code box first with `& $adb shell input tap 540 1000` (the middle of a Pixel 7 screen is about there), then run `input text` again.
- **`Unresolved reference: BuildConfig`**: check `buildConfig = true` in 5.2.
- **`Unresolved reference: viewModels` or `AndroidViewModel`**: report the exact error under "Blockers / questions"; do not add a dependency.
- **`kotlin-client.test.ts` or another server test fails**: you changed something outside this card's files; run `git status`.
- **Gradle cannot download a library**: Maven Central sometimes answers 429. Wait a minute and run the same command again.
- **Temporary files** (the PR body, `ui.xml`, the screenshots) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **Every difference from the card is a deviation**, in any file, including tests, comments and how you ran a check. List each one under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-030. Please review and merge if it is good.

CARD: CARD-030 Device Owner and enrolment screen
PR: <full PR URL>
Branch: bob/card-030-device-owner-setup
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
