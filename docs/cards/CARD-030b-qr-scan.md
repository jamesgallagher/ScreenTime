# CARD-030b: QR scanning on the setup screen

| Field | Value |
|---|---|
| Card | CARD-030b |
| Title | QR scanning on the setup screen |
| Size | S |
| Depends on | CARD-030 (Device Owner and enrolment screen), merged to `main` |
| Spec sections | docs/SPEC.md §11.3, §12.1, §16.2 ("Setup screen" and "As built") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-030b-qr-scan` |
| PR title | `CARD-030b: QR scanning on the setup screen` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

In CARD-030 you built the kid app's setup screens: the app becomes Device Owner, the kid types a 6-digit code, the app calls `POST /v1/enrol`, and the kid confirms their name. The parent web app's **Add device** dialog also shows a **QR code**. It holds a link like this (SPEC §11.3):

```text
screentime://enrol?host=screentime.gallagherhome.au&code=482913
```

This card lets the kid app read that link in two ways:

1. **Scan QR code** on the setup screen opens the back camera. CameraX shows the picture and ML Kit's bundled barcode model finds the QR code. The first QR code seen is read.
2. The app opens `screentime://enrol` links itself, for example when the phone's own camera app scans the QR code, or when you open the link with `adb` on the emulator. The emulator's camera cannot see a QR code on your screen, so that is how you test the whole flow.

Either way the link fills in the server and the code and connects at once; the kid then sees "This phone belongs to Alex. Correct?" as before.

Changes:

- `enrol/EnrolLink.kt` (new): `parseEnrolLink`, a pure function with JVM tests.
- `setup/QrScanner.kt` (new): the full-screen camera screen.
- `setup/SetupViewModel.kt`: a new `Scanning` state, `onScan`, `onScanCancel`, `onScanFailed`, `onLink`.
- `setup/SetupScreen.kt`: the **Scan QR code** button, and a shared `TonalButton`.
- `admin/Policies.kt`: `grantRuntimePermissions` is now public, so the camera is granted by Device Owner before scanning.
- `MainActivity.kt` and the manifest: the camera permission and the `screentime://enrol` link.
- `core-ui/Theme.kt`: tonal buttons ("Check again", "Scan QR code") were Material's default lavender in your CARD-030 screenshots. They now use the app's neutral grey.
- `server/scripts/dev-enrol-code.ts`: also prints the emulator link.

The docs (`docs/SPEC.md` §16.2, `docs/guides/android-provisioning.md`, `deploy/README.md`) and the web dialog's text are already updated on `main` by Claude. Do not change them.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with 7 `EnrolRulesTest` and 4 `EnrolLinkTest` tests; on the emulator the scan screen opens with the camera granted, a bad link shows "That QR code isn't from Screen Time.", a real link enrols the emulator, and the six screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No other camera feature (torch, zoom, front camera, picking an image from the gallery).
- No change to `core-model`, `core-time`, `app-parent`, `packages/`, `web/`, `server/src/` or `docs/`. In `core-ui` only the two lines of 5.11.
- No other new dependency than the four libraries of 5.1. No new npm package.
- Never run the app on a real phone or tablet in this card, and never install a **release** build anywhere: it turns off USB debugging and blocks uninstalling.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, activity-compose 1.13.0, Ktor 3.6.0, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36.

New, all from Google's Maven repository (already in `settings.gradle.kts`):

| Library | Version | Why |
|---|---|---|
| `androidx.camera:camera-camera2` | 1.6.0 | the camera itself |
| `androidx.camera:camera-view` | 1.6.0 | `PreviewView` and `LifecycleCameraController` |
| `androidx.camera:camera-mlkit-vision` | 1.6.0 | `MlKitAnalyzer`, which feeds camera frames to ML Kit |
| `com.google.mlkit:barcode-scanning` | 17.3.0 | the **bundled** barcode model: it is inside the APK, so it works without Google Play services and without a download |

Claude built this exact code in GitHub Actions before writing the card, so these versions resolve and compile.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c30b"
New-Item -ItemType Directory -Force $t | Out-Null
```

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7) and `'` in strings like `Mum or Dad's phone`; copy them exactly.

| File | Action |
|---|---|
| `android/gradle/libs.versions.toml` | replace (5.1) |
| `android/app-kid/build.gradle.kts` | replace (5.2) |
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.3) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/MainActivity.kt` | replace (5.4) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt` | replace (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolLink.kt` | create (5.6) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt` | replace (5.7) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/setup/QrScanner.kt` | create (5.8) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt` | replace (5.9) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/enrol/EnrolLinkTest.kt` | create (5.10) |
| `android/core-ui/src/main/kotlin/au/screentime/core/ui/Theme.kt` | replace (5.11) |
| `server/scripts/dev-enrol-code.ts` | replace (5.12) |

That is 12 files.

### 5.1 `android/gradle/libs.versions.toml`

The changes: the `camerax` and `mlkitBarcode` versions and four library lines.

```toml
[versions]
agp = "9.4.0"
kotlin = "2.4.21"
composeBom = "2026.09.00"
activityCompose = "1.13.0"
junit = "6.1.3"
kotlinxSerialization = "1.11.0"
ktor = "3.6.0"
camerax = "1.6.0"
mlkitBarcode = "17.3.0"

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
androidx-camera-camera2 = { group = "androidx.camera", name = "camera-camera2", version.ref = "camerax" }
androidx-camera-view = { group = "androidx.camera", name = "camera-view", version.ref = "camerax" }
androidx-camera-mlkit-vision = { group = "androidx.camera", name = "camera-mlkit-vision", version.ref = "camerax" }
mlkit-barcode-scanning = { group = "com.google.mlkit", name = "barcode-scanning", version.ref = "mlkitBarcode" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

### 5.2 `android/app-kid/build.gradle.kts`

The change: the comment and four `implementation` lines after `ktor.client.okhttp`.

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
    // QR scanning: CameraX with ML Kit's bundled barcode model (no Play services download, docs/SPEC.md §11.3).
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.view)
    implementation(libs.androidx.camera.mlkit.vision)
    implementation(libs.mlkit.barcode.scanning)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}
```

### 5.3 `android/app-kid/src/main/AndroidManifest.xml`

The changes: the `CAMERA` permission (with `uses-feature ... required="false"`, so a device without a camera can still install the app), `launchMode="singleTask"` (a link opens the app that is already running instead of a second copy), and the second `<intent-filter>` for `screentime://enrol`.

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <!-- Scanning the enrolment QR code. Device Owner grants it, so the kid is never asked (docs/SPEC.md §12.1). -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />

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
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <!-- The enrolment QR code, screentime://enrol?host=...&code=... (docs/SPEC.md §11.3). -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="screentime" android:host="enrol" />
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

### 5.4 `android/app-kid/src/main/kotlin/au/screentime/kid/MainActivity.kt`

The changes: a link in the starting intent goes to `onLink` (not after a rotation), and `onNewIntent` does the same for a link that arrives while the app is open.

```kotlin
package au.screentime.kid

import android.content.Intent
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
        // Opened from an enrolment link. Not again after a rotation, which would send the same code twice.
        if (savedInstanceState == null) intent?.dataString?.let(setup::onLink)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.dataString?.let(setup::onLink)
    }

    override fun onResume() {
        super.onResume()
        // Picks up a Device Owner set while the app was open, and applies the policies again once enrolled.
        setup.refresh()
    }
}
```

### 5.5 `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt`

The change: the permission loop moved out of `apply` into the new public `grantRuntimePermissions`, which `apply` calls.

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
        grantRuntimePermissions(context)
    }

    /**
     * Grants every runtime permission the manifest asks for, so the kid never sees a permission prompt.
     * Does nothing unless the app is Device Owner. The setup screen calls it before scanning, for the camera.
     */
    fun grantRuntimePermissions(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
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

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolLink.kt`

```kotlin
package au.screentime.kid.enrol

import java.net.URI
import java.net.URLDecoder

/** What the enrolment QR code holds: the server to use and the 6-digit code (docs/SPEC.md §11.3). */
data class EnrolLink(val server: String, val code: String)

/** A host name or IP address with an optional port, like `screentime.gallagherhome.au` or `10.0.2.2:8080`. */
private val HOST = Regex("[A-Za-z0-9.-]+(:[0-9]{1,5})?")

/**
 * Reads `screentime://enrol?host=<host>&code=<6 digits>`, or returns null when [text] is anything else.
 * The host is reached over `https://`. When [allowHttp] is true (debug builds), a host with a port uses
 * `http://`, for a server on the PC like `10.0.2.2:8080`.
 */
fun parseEnrolLink(text: String, allowHttp: Boolean): EnrolLink? {
    val uri = try {
        URI(text.trim())
    } catch (e: Exception) {
        return null
    }
    if (uri.scheme?.lowercase() != "screentime" || uri.host?.lowercase() != "enrol") return null
    if ((uri.rawPath ?: "") !in listOf("", "/")) return null
    val params = (uri.rawQuery ?: return null).split('&').associate { part ->
        val name = part.substringBefore('=')
        val value = part.substringAfter('=', "")
        name to try {
            URLDecoder.decode(value, Charsets.UTF_8)
        } catch (e: IllegalArgumentException) {
            return null
        }
    }
    val host = params["host"] ?: return null
    val code = params["code"] ?: return null
    if (!HOST.matches(host) || code.length != 6 || code.any { it !in '0'..'9' }) return null
    val scheme = if (allowHttp && ':' in host) "http" else "https"
    val server = serverUrl("$scheme://$host", allowHttp) ?: return null
    return EnrolLink(server, code)
}
```

### 5.7 `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt`

The changes: the `parseEnrolLink` import, the `Scanning` state, `onConnect` now calls the new private `connect`, and the new `onScan`, `onScanCancel`, `onScanFailed` and `onLink`.

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
import au.screentime.kid.enrol.parseEnrolLink
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

    /** The camera is looking for the enrolment QR code. Cancel goes back to [previous]. */
    data class Scanning(val previous: EnterCode) : SetupState

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
        connect(s)
    }

    /** "Scan QR code": the camera permission is granted first (the app is Device Owner on this screen). */
    fun onScan() {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy) return
        Policies.grantRuntimePermissions(getApplication())
        state = SetupState.Scanning(s.copy(editingServer = false, error = null, note = null))
    }

    fun onScanCancel() {
        val s = state as? SetupState.Scanning ?: return
        state = s.previous
    }

    /** The camera could not be used: back to typing the code. */
    fun onScanFailed() {
        val s = state as? SetupState.Scanning ?: return
        state = s.previous.copy(error = "The camera isn't working. Type the code instead.")
    }

    /**
     * A QR code was scanned, or the app was opened with a `screentime://enrol` link (for example from the
     * phone's own camera app, or `adb shell am start` on the emulator). A good link connects at once.
     */
    fun onLink(text: String) {
        val s = when (val current = state) {
            is SetupState.Scanning -> current.previous
            is SetupState.EnterCode -> if (current.busy) return else current
            else -> return
        }
        val link = parseEnrolLink(text, allowHttp = BuildConfig.DEBUG)
        if (link == null) {
            state = s.copy(editingServer = false, error = "That QR code isn't from Screen Time.")
            return
        }
        connect(s.copy(code = link.code, server = link.server, editingServer = false))
    }

    /** Sends the code to [SetupState.EnterCode.server], then asks the kid to confirm the name. */
    private fun connect(s: SetupState.EnterCode) {
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

### 5.8 `android/app-kid/src/main/kotlin/au/screentime/kid/setup/QrScanner.kt`

```kotlin
package au.screentime.kid.setup

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "QrScanner"

/**
 * The QR scan screen: the back camera fills the screen, with a white frame to aim at, a hint above it and
 * **Cancel** below. [onCode] gets the text of the first QR code seen, once. [onFailed] is called when the
 * camera can't be used (no permission, or no camera).
 */
@Composable
fun QrScanScreen(onCode: (String) -> Unit, onCancel: () -> Unit, onFailed: () -> Unit) {
    val context = LocalContext.current
    var allowed by remember {
        mutableStateOf(context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    // Device Owner normally grants the camera already (SetupViewModel.onScan). If it could not, ask once.
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) allowed = true else onFailed()
    }
    LaunchedEffect(Unit) {
        if (!allowed) ask.launch(Manifest.permission.CAMERA)
    }
    BackHandler(onBack = onCancel)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        if (allowed) CameraPreview(onCode = onCode, onFailed = onFailed)
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(260.dp)
                .border(4.dp, Color.White, RoundedCornerShape(24.dp)),
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "Point the camera at the QR code on Mum or Dad's phone",
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .widthIn(max = 480.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            )
            Spacer(Modifier.weight(1f))
            OutlinedButton(
                onClick = onCancel,
                modifier = Modifier
                    .widthIn(max = 480.dp)
                    .fillMaxWidth()
                    .height(56.dp),
                border = BorderStroke(1.dp, Color.White),
            ) {
                Text("Cancel", style = MaterialTheme.typography.titleMedium, color = Color.White)
            }
        }
    }
}

/** The back camera, analysed by ML Kit's bundled barcode model for QR codes only. */
@Composable
private fun CameraPreview(onCode: (String) -> Unit, onFailed: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnCode by rememberUpdatedState(onCode)
    val currentOnFailed by rememberUpdatedState(onFailed)
    val controller = remember { LifecycleCameraController(context) }

    DisposableEffect(lifecycleOwner) {
        val scanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
        )
        val reported = AtomicBoolean(false)
        val executor = context.mainExecutor
        controller.setImageAnalysisAnalyzer(
            executor,
            MlKitAnalyzer(listOf(scanner), ImageAnalysis.COORDINATE_SYSTEM_ORIGINAL, executor) { result ->
                val text = result.getValue(scanner)?.firstOrNull()?.rawValue
                if (text != null && reported.compareAndSet(false, true)) currentOnCode(text)
            },
        )
        try {
            controller.bindToLifecycle(lifecycleOwner)
        } catch (e: Exception) {
            Log.w(TAG, "camera not available", e)
            currentOnFailed()
        }
        onDispose {
            controller.unbind()
            controller.clearImageAnalysisAnalyzer()
            scanner.close()
        }
    }

    AndroidView(
        factory = { viewContext ->
            PreviewView(viewContext).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
                this.controller = controller
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}
```

### 5.9 `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt`

The changes: `Scanning` shows `QrScanScreen`; the new `TonalButton` (used by **Check again** and **Scan QR code**); on `EnterCode` the body text, the **Scan QR code** button and "or type the code" above the code boxes.

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
            onScan = vm::onScan,
            onCodeChange = vm::onCodeChange,
            onConnect = vm::onConnect,
            onEditServer = vm::onEditServer,
            onServerTextChange = vm::onServerTextChange,
            onServerDone = vm::onServerDone,
        )
        is SetupState.Scanning -> QrScanScreen(onCode = vm::onLink, onCancel = vm::onScanCancel, onFailed = vm::onScanFailed)
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

/** Secondary pill button: same size as [BigButton], neutral grey. */
@Composable
private fun TonalButton(text: String, onClick: () -> Unit, enabled: Boolean = true) {
    FilledTonalButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
    ) {
        Text(text, style = MaterialTheme.typography.titleMedium)
    }
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
        TonalButton(text = "Check again", onClick = onCheckAgain)
    }
}

@Composable
private fun EnterCodeScreen(
    state: SetupState.EnterCode,
    onScan: () -> Unit,
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
        Body("On Mum or Dad's phone, open Screen Time, choose your name and tap Add device. Then scan the QR code, or type the code.")
        Spacer(Modifier.height(32.dp))
        TonalButton(text = "Scan QR code", onClick = onScan, enabled = !state.busy)
        Spacer(Modifier.height(24.dp))
        Text(
            text = "or type the code",
            style = MaterialTheme.typography.bodyMedium,
            color = ScreenTimeTheme.colors.muted,
        )
        Spacer(Modifier.height(12.dp))
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

### 5.10 `android/app-kid/src/test/kotlin/au/screentime/kid/enrol/EnrolLinkTest.kt`

```kotlin
package au.screentime.kid.enrol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class EnrolLinkTest {
    @Test
    fun theRealServerUsesHttps() {
        val link = parseEnrolLink("screentime://enrol?host=screentime.gallagherhome.au&code=482913", allowHttp = false)

        assertEquals(EnrolLink("https://screentime.gallagherhome.au", "482913"), link)
    }

    @Test
    fun aHostWithAPortUsesHttpOnlyInDebugBuilds() {
        val text = "screentime://enrol?host=10.0.2.2%3A8080&code=000123"

        assertEquals(EnrolLink("http://10.0.2.2:8080", "000123"), parseEnrolLink(text, allowHttp = true))
        assertEquals(EnrolLink("https://10.0.2.2:8080", "000123"), parseEnrolLink(text, allowHttp = false))
    }

    @Test
    fun theOrderOfTheParametersDoesNotMatter() {
        val link = parseEnrolLink(" SCREENTIME://ENROL?code=482913&host=Screentime.Gallagherhome.au ", allowHttp = false)

        assertEquals(EnrolLink("https://screentime.gallagherhome.au", "482913"), link)
    }

    @Test
    fun anythingElseIsRefused() {
        val bad = listOf(
            "",
            "482913",
            "https://screentime.gallagherhome.au/?code=482913",
            "screentime://pair?host=example.com&code=482913",
            "screentime://enrol/x?host=example.com&code=482913",
            "screentime://enrol?host=example.com",
            "screentime://enrol?code=482913",
            "screentime://enrol?host=example.com&code=48291",
            "screentime://enrol?host=example.com&code=48291a",
            "screentime://enrol?host=example.com%2Fv1&code=482913",
            "screentime://enrol?host=me%40example.com&code=482913",
            "screentime://enrol?host=https%3A%2F%2Fexample.com&code=482913",
            "screentime://enrol?host=%zz&code=482913",
        )
        for (text in bad) {
            assertNull(parseEnrolLink(text, allowHttp = true), text)
        }
    }
}
```

### 5.11 `android/core-ui/src/main/kotlin/au/screentime/core/ui/Theme.kt`

The change: the comment and the `secondaryContainer` and `onSecondaryContainer` lines after `onSurfaceVariant`.

```kotlin
package au.screentime.core.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Screen Time colours that Material 3 has no slot for (warning, critical, night...). */
val LocalScreenTimeColors = staticCompositionLocalOf { LightColors }

/** Shortcut: `ScreenTimeTheme.colors.warning` inside a composable. */
object ScreenTimeTheme {
    val colors: ScreenTimeColors
        @Composable
        @ReadOnlyComposable
        get() = LocalScreenTimeColors.current
}

private val BaseTypography = Typography()

/** Material 3 type scale; the big remaining-time number is displayLarge, bold, tabular figures. */
val ScreenTimeTypography = BaseTypography.copy(
    displayLarge = BaseTypography.displayLarge.copy(
        fontWeight = FontWeight.Bold,
        fontFeatureSettings = "tnum",
    ),
)

/** Cards 16 dp radius (medium); sheets 28 dp radius (extraLarge). */
val ScreenTimeShapes = Shapes(
    medium = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

private fun colorSchemeOf(c: ScreenTimeColors, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.primary,
        onPrimary = c.onPrimary,
        background = c.background,
        onBackground = c.onSurface,
        surface = c.surface,
        onSurface = c.onSurface,
        surfaceVariant = c.surfaceVariant,
        onSurfaceVariant = c.muted,
        // Tonal buttons ("Check again", "Scan QR code") use these: our neutral chip grey, not Material's lavender.
        secondaryContainer = c.surfaceVariant,
        onSecondaryContainer = c.onSurface,
        outline = c.outline,
        error = c.danger,
    )
}

/** Wrap every screen of both apps in this. Light or dark follows the system setting. */
@Composable
fun ScreenTimeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors
    CompositionLocalProvider(LocalScreenTimeColors provides colors) {
        MaterialTheme(
            colorScheme = colorSchemeOf(colors, darkTheme),
            typography = ScreenTimeTypography,
            shapes = ScreenTimeShapes,
            content = content,
        )
    }
}
```

### 5.12 `server/scripts/dev-enrol-code.ts`

The change: for a phone or tablet it also prints the emulator link.

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
  if (form !== 'pc') {
    // What the QR code would hold, for the emulator's server address (docs/guides/android-provisioning.md).
    console.log(`Emulator link: screentime://enrol?host=${encodeURIComponent('10.0.2.2:8080')}&code=${code}`);
  }
} finally {
  await pool.end();
}
```

## 6. Detailed spec

### 6.1 The screens

| State | What is on screen |
|---|---|
| `NotOwner` | as before; **Check again** is now neutral grey (`surfaceVariant` background, `onSurface` text), not lavender |
| `EnterCode` | hourglass mark; "Connect to your family"; "On Mum or Dad's phone, open Screen Time, choose your name and tap Add device. Then scan the QR code, or type the code."; grey tonal **Scan QR code** (56 dp, full width); "or type the code" in `muted`; the 6 code boxes, message, **Connect** and the server line as before |
| `Scanning` | the back camera fills the black screen; a white frame 260 dp square, 4 dp line, 24 dp corners, in the middle; at the top "Point the camera at the QR code on Mum or Dad's phone" in white on a dark rounded box; at the bottom an outlined white **Cancel** (56 dp, full width up to 480 dp) |

### 6.2 What happens

- **Scan QR code** (`onScan`) asks Device Owner to grant every runtime permission in the manifest, which is now the camera, and shows `Scanning`. The kid sees no permission prompt. Only if the grant failed does `QrScanScreen` ask with the normal Android prompt; if the kid says no, or there is no camera, it goes back to `EnterCode` with "The camera isn't working. Type the code instead."
- **Cancel** and the system Back button go back to `EnterCode` as it was.
- The first QR code seen goes to `onLink`. Later frames are ignored, so it connects only once.
- `onLink` works in `Scanning` and in `EnterCode` (not while connecting; in every other state it does nothing). `parseEnrolLink` reads the link:
  - a good link: the server and code fill in and it connects, exactly like **Connect** (the spinner, then `Confirm`, or the usual error messages of CARD-030);
  - anything else: `EnterCode` with "That QR code isn't from Screen Time."
- `parseEnrolLink` (5.6): the scheme must be `screentime` and the host `enrol` (any case), no path, and both `host` and `code` present in any order. `host` is letters, digits, `.` and `-`, with an optional `:port`; `code` is exactly 6 digits. The server is `https://<host>`. Debug builds use `http://<host>` when the host has a port (the PC as seen from the emulator is `10.0.2.2:8080`). The result goes through `serverUrl` of CARD-030, so it is lower case.
- A `screentime://enrol` link opened from outside the app (another app, or `adb shell am start`) does the same as a scan.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-030b-qr-scan
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-030b-qr-scan.md` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.9 and 5.11. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-030b: scan the enrolment QR code on the setup screen`.
3. Create 5.10 and replace 5.12. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-030b: enrolment link tests and the emulator link`.
4. Run the acceptance checks in section 8, including the emulator run (8.2).
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints five lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml, app-kid\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.api.ApiClientTest tests="13" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolLinkTest tests="4" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolRulesTest tests="7" failures="0" errors="0"
  ```
- [ ] The merged debug manifest has the camera and the link. From `android`, this prints `True` three times:
  ```powershell
  $m = Get-Content app-kid\build\intermediates\merged_manifest\debug\processDebugMainManifest\AndroidManifest.xml -Raw
  $m -match 'android.permission.CAMERA'
  $m -match 'android:scheme="screentime"'
  $m -match 'android:launchMode="singleTask"'
  ```

### 8.2 On the emulator

**The emulator.** Use the same emulator as in CARD-030 (a fresh one is fine too: Device Manager › **+** › Pixel 7 › **Google APIs** image, API 34 or newer). Do not sign in to any Google account. If it still has the app from CARD-030, remove it first:

```powershell
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
```

(Each prints `Success...`, or an error if there was nothing to remove; both are fine.) `& $adb devices` must list exactly one `emulator-5554   device`.

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored):

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
```

The last line prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Open-Link` opens a link in the app; the single quotes inside the double quotes stop the emulator's shell from cutting the link at `&`.

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
function Open-Link([string]$link) {
  & $adb shell "am start -W -a android.intent.action.VIEW -d '$link' au.screentime.kid"
  Start-Sleep -Seconds 3
}
```

Never use `adb exec-out screencap > file.png` in PowerShell: it breaks the image. While the camera is on, `uiautomator dump` may fail with `could not get idle state`; that is why the steps never use `Tap-Text` on the scan screen.

**The run.** From `android`, one step at a time; check each expected result before the next step:

1. Install and open the app, then make it Device Owner:
   ```powershell
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell am start -n au.screentime.kid/.MainActivity
   Start-Sleep -Seconds 3
   Shot "1-not-owner"
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   Tap-Text "Check again"
   Shot "2-enter-code"
   ```
   `1-not-owner` says "Ask a parent to finish setup" with a **grey** Check again button. `2-enter-code` says "Connect to your family" with a grey **Scan QR code** button, "or type the code" and the code boxes. If the keyboard covers part of the screen, that is fine.
2. Open the scanner:
   ```powershell
   Tap-Text "Scan QR code"
   Start-Sleep -Seconds 3
   Shot "3-scanning"
   & $adb shell dumpsys package au.screentime.kid | Select-String 'android.permission.CAMERA: granted'
   ```
   The screen shows the camera picture (the emulator shows a virtual room, or grey), the white frame, the hint and **Cancel**. No permission prompt appeared. `Select-String` prints one line containing `android.permission.CAMERA: granted=true`.
3. Back and a bad link:
   ```powershell
   & $adb shell input keyevent 4
   Start-Sleep -Seconds 2
   Open-Link "screentime://enrol?host=10.0.2.2%3A8080&code=12"
   Shot "4-bad-link"
   ```
   Back returned to "Connect to your family"; the screen now also says "That QR code isn't from Screen Time." in red.
4. A real link while scanning. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`:
   ```powershell
   pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone
   ```
   It prints two lines: `Enrolment code for Alex (phone): <6 digits>, valid for 10 minutes.` and `Emulator link: screentime://enrol?host=10.0.2.2%3A8080&code=<the same 6 digits>`. Back in the first window, with that link:
   ```powershell
   Tap-Text "Scan QR code"
   Start-Sleep -Seconds 3
   Open-Link "<the emulator link>"
   Shot "5-confirm"
   ```
   The screen says "This phone belongs to Alex. Correct?".
5. Confirm:
   ```powershell
   Tap-Text "Yes"
   Shot "6-done"
   ```
   The screen says "All set, Alex".
6. Check the device on the server (from the repo root):
   ```powershell
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db psql -U screentime -d screentime -c "select name, form, platform from devices"
   ```
   One row: a name starting with `Google sdk_gphone`, `phone`, `android`.
7. Undo, so the emulator can be used again:
   ```powershell
   & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb uninstall au.screentime.kid
   cd ..
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item Env:DATABASE_URL
   ```
   `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 7 gave the expected results.
- [ ] The six screenshots exist: `C:\Users\james\OpenCode\Testing\temp\c30b\1-not-owner.png`, `2-enter-code.png`, `3-scanning.png`, `4-bad-link.png`, `5-confirm.png`, `6-done.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing in `server/src` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback. The **TypeScript** checks also run because of 5.12; they must be green too.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 12 files (in any order):
  ```
  android/app-kid/build.gradle.kts
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/MainActivity.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/enrol/EnrolLink.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/setup/QrScanner.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/enrol/EnrolLinkTest.kt
  android/core-ui/src/main/kotlin/au/screentime/core/ui/Theme.kt
  android/gradle/libs.versions.toml
  server/scripts/dev-enrol-code.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/enrol/EnrolLinkTest.kt` | The real server's link gives `https://screentime.gallagherhome.au` and the code. A host with a port gives `http://` only when http is allowed (debug), else `https://`. Parameter order, spaces around the text and upper case do not matter. Refused: empty text, a bare code, a web URL, another host than `enrol`, a path, a missing host or code, a 5-digit or non-digit code, a host with `/`, `@` or `://` in it, and bad `%` encoding. |

`EnrolRulesTest` from CARD-030 is unchanged. The scan screen, the camera grant and the link are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-030b: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-030b-qr-scan`
5. Open a PR into `main` titled `CARD-030b: QR scanning on the setup screen`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-030b-qr-scan --title "CARD-030b: QR scanning on the setup screen" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-030b-qr-scan.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: DurationFormatTest 9, EngineVectorsTest 27, ApiClientTest 13, EnrolLinkTest 4, EnrolRulesTest 7, all `failures="0"`
   - [x] merged debug manifest — output: `True` three times
   - [x] emulator run steps 1 to 7 — results as expected
   - [x] six screenshots in C:\Users\james\OpenCode\Testing\temp\c30b\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 12 files

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

- **Gradle cannot download `androidx.camera` or `com.google.mlkit`**: they come from Google's Maven repository (`google()` in `settings.gradle.kts`). Check the PC's internet connection and run the same command again. Do not change a version; report the exact error.
- **A permission prompt appears in step 2**: Device Owner could not grant the camera. Do not tap anything; take a `Shot "3-prompt"`, write down what it says, then tap **Allow** with `Tap-Text` on its button text and carry on. Report it under "Deviations".
- **`Open-Link` prints `Error: Activity not started, unable to resolve Intent`**: the link filter is missing from the manifest (5.3), or the app is not installed. Check 8.1's manifest check.
- **`Open-Link` opens the app but nothing changes**: the app was not on "Connect to your family" or the scan screen (for example it was still on "Ask a parent"). Take a `Shot` to see.
- **`4-bad-link` shows "Can't reach Screen Time" instead**: the link was read as good, so `parseEnrolLink` differs from 5.6. Compare the file.
- **The scan screen is all black**: fine on some emulators (no virtual camera). The frame, hint and Cancel must still show. Say so in the handback.
- **`dpm set-device-owner` says there are accounts, several users, or already provisioned**: use a fresh emulator (Device Manager › **Wipe Data**), do not sign in, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
- **`Tap-Text` says `No '...' on screen`**: take a `Shot` to see; press `& $adb shell input keyevent 4` (Back) once to close the keyboard if it covers the button, and try again.
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
Claude, here is Bob's handback for CARD-030b. Please review and merge if it is good.

CARD: CARD-030b QR scanning on the setup screen
PR: <full PR URL>
Branch: bob/card-030b-qr-scan
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
