# CARD-040: Parent app sign-in, app lock and Today

| Field | Value |
|---|---|
| Card | CARD-040 |
| Title | Parent app sign-in, app lock and Today |
| Size | L |
| Depends on | CARD-039b, merged to `main` (the parent app is still the CARD-002 skeleton) |
| Spec sections | docs/SPEC.md §11.1 (parent sign-in), §16.1 (tokens), §16.4 (Android parent app) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-040-parent-sign-in` |
| PR title | `CARD-040: Parent app sign-in, app lock and Today` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

The kid app is done (apart from push, CARD-034b). This card starts the **parent app** (`android/app-parent`, package `au.screentime.parent`), which today is only a placeholder screen. After this card a parent can:

1. **Sign in** with their email and a 6-digit code the server emails them (in development the server writes the code to its log instead).
2. Stay signed in: the app keeps a **refresh token** encrypted with a key in the Android Keystore, and swaps it for a fresh 15-minute access token when it needs one.
3. Be asked for their **fingerprint or the phone's PIN** when the app opens fresh, or after 5 minutes away from it (the **app lock**).
4. See **Today**: one card per kid, with each pool's time left and used, a bar, and status chips ("Using alex on Dev PC now"). It asks the server again every 30 seconds and when pulled down.
5. Move between four tabs: **Today**, **Inbox**, **Kids**, **Settings**. Inbox and Kids only say what will come later; Settings shows who is signed in and has **Sign out**.

The server side is already built: `POST /v1/auth/otp/request`, `POST /v1/auth/otp/verify`, `POST /v1/auth/refresh`, `POST /v1/auth/logout` and `GET /v1/today`, all in the generated Kotlin client `ApiClient` in `android/core-model`.

**This card works differently from the earlier ones.** You write the app code yourself. The card gives:

- the exact contents of the files you **copy**: the Gradle file, the manifests, the icons, a development script, and the four test files;
- what each of the 15 Kotlin files you **write** must do: its public names (the tests call them), its rules, and for screens the exact layout, sizes, colours and words.

The tests are the contract: they must pass unchanged. Claude wrote the same app before writing this card and built it in GitHub Actions, so everything here compiles and works; when Claude reviews your PR, it checks your code against this card, not against its own copy. Where the card says **exactly**, use those names and words. Where it leaves something open (private helpers, how you split a function), choose what is simplest.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with the four new test suites (25 tests) unchanged; the emulator run passes (sign-in with a code from the server log, a wrong code, Today with real data and its 30-second refresh, Settings, the lock on a fresh start, after cancelling and after 5 minutes away, the token stored encrypted, sign out); the eight screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No adjust sheet or **±** button on Today (CARD-041), no inbox, no requests or messages (CARD-041), no push or FCM (CARD-042), no kid detail, schedules or devices (CARD-043), no SOS (CARD-044), no tablet layout or navigation rail.
- No change to the server, the web app, `packages/` or `docs/`, except the new file `server/scripts/dev-usage.ts` (copied, 5.25).
- No change to `core-model`, `core-time`, `core-ui` or `app-kid`. No change to `android/gradle/libs.versions.toml`, `settings.gradle.kts` or the Gradle wrapper. No new library: everything here comes from libraries the project already uses. In particular, **no `androidx.biometric`, no `androidx.navigation`, no `androidx.security:security-crypto`, no Hilt**: the card uses the Android framework's `BiometricPrompt` and `KeyStore` directly.
- No launcher icon: the app keeps Android's default for now.
- Never run the parent app on a real phone in this card. Never install a **release** build anywhere.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a token, or any key. Never paste a token, a sign-in code or the contents of `shared_prefs/session.xml` into the PR or the handback, except the made-up values the card gives.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36.

The parent app already depends on `core-ui`, `core-time`, `core-model`, Compose Material 3 and `activity-compose`. This card adds `ktor-client-okhttp` (the HTTP engine, as in the kid app) and the test libraries. `activity-compose` brings the AndroidX lifecycle libraries with it, so these are there without being listed: `androidx.lifecycle.AndroidViewModel`, `viewModelScope`, `lifecycleScope`, `repeatOnLifecycle`, `androidx.lifecycle.compose.LocalLifecycleOwner`, and `by viewModels()` in an activity. The kid app uses the same (see `app-kid/.../setup/SetupViewModel.kt` and `app-kid/.../MainActivity.kt`), so look there for working examples of a view model, `mutableStateOf` state and `ApiClient` with OkHttp.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c40"
New-Item -ItemType Directory -Force $t | Out-Null
```

## 5. Files

Paths are relative to the repo root. Kotlin files below are under `android/app-parent/src/main/kotlin/au/screentime/parent/` (written `…/` in the table) and tests under `android/app-parent/src/test/kotlin/au/screentime/parent/`.

| File | Action |
|---|---|
| `android/app-parent/build.gradle.kts` | replace, **copy** (5.1) |
| `android/app-parent/src/main/AndroidManifest.xml` | replace, **copy** (5.2) |
| `android/app-parent/src/debug/AndroidManifest.xml` | create, **copy** (5.3) |
| `android/app-parent/src/debug/res/xml/network_security_config.xml` | create, **copy** (5.3) |
| `android/app-parent/src/main/res/xml/data_extraction_rules.xml` | create, **copy** (5.4) |
| `android/app-parent/src/main/res/drawable/ic_hourglass.xml` | create, **copy** (5.5) |
| `android/app-parent/src/main/res/drawable/ic_today.xml` | create, **copy** (5.5) |
| `android/app-parent/src/main/res/drawable/ic_inbox.xml` | create, **copy** (5.5) |
| `android/app-parent/src/main/res/drawable/ic_kids.xml` | create, **copy** (5.5) |
| `android/app-parent/src/main/res/drawable/ic_settings.xml` | create, **copy** (5.5) |
| `…/ParentApp.kt` | create, **write** (6.1) |
| `…/auth/Session.kt` | create, **write** (6.2) |
| `…/auth/PrefsTokenStore.kt` | create, **write** (6.3) |
| `…/auth/SignIn.kt` | create, **write** (6.4) |
| `…/auth/SignInViewModel.kt` | create, **write** (6.5) |
| `…/AppMark.kt` | create, **write** (6.6) |
| `…/auth/SignInScreen.kt` | create, **write** (6.7) |
| `…/lock/AppLock.kt` | create, **write** (6.8) |
| `…/lock/LockScreen.kt` | create, **write** (6.9) |
| `…/today/TodayView.kt` | create, **write** (6.10) |
| `…/today/TodayViewModel.kt` | create, **write** (6.11) |
| `…/today/TodayScreen.kt` | create, **write** (6.12) |
| `…/home/HomeScreen.kt` | create, **write** (6.13) |
| `…/home/SettingsScreen.kt` | create, **write** (6.14) |
| `…/MainActivity.kt` | replace, **write** (6.15) |
| `android/app-parent/src/test/kotlin/au/screentime/parent/auth/SessionTest.kt` | create, **copy** (5.6) |
| `android/app-parent/src/test/kotlin/au/screentime/parent/auth/SignInTest.kt` | create, **copy** (5.7) |
| `android/app-parent/src/test/kotlin/au/screentime/parent/lock/AppLockTest.kt` | create, **copy** (5.8) |
| `android/app-parent/src/test/kotlin/au/screentime/parent/today/TodayViewTest.kt` | create, **copy** (5.9) |
| `server/scripts/dev-usage.ts` | create, **copy** (5.10) |

That is 30 files: 28 new, 2 replaced (`build.gradle.kts` and `MainActivity.kt`; the old `MainActivity.kt` placeholder is replaced completely).

**Copy** means: copy the code block exactly, character for character, blank lines included. This card is UTF-8; if you see `Â`, `â€` or `ðŸ` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `·` (U+00B7, a middle dot), `…` (U+2026), `→` (U+2192) and `’` never: apostrophes are plain `'`. Copy them exactly.

**Write** means: write the file yourself from section 6. Use 4-space indentation and a KDoc comment (`/** … */`) on every public class and function, saying what it is for, as the rest of the project does. Strings shown to people must be **exactly** the card's words.

### 5.1 `android/app-parent/build.gradle.kts`

Replace the whole file. Compared with `main`: `buildTypes` with the server address (`BuildConfig.SERVER`), `buildConfig = true`, JUnit 6 for unit tests, OkHttp, and the test libraries.

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "au.screentime.parent"
    compileSdk = 37

    defaultConfig {
        applicationId = "au.screentime.parent"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            // The Android emulator reaches the developer's PC at 10.0.2.2 (`pnpm dev:server` or docker compose).
            buildConfigField("String", "SERVER", "\"http://10.0.2.2:8080\"")
        }
        release {
            buildConfigField("String", "SERVER", "\"https://screentime.gallagherhome.au\"")
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
    testImplementation(libs.ktor.client.mock)
    testRuntimeOnly(libs.junit.platform.launcher)
}
```

### 5.2 `android/app-parent/src/main/AndroidManifest.xml`

Replace the whole file. Compared with `main`: the `INTERNET` and `USE_BIOMETRIC` permissions, `ParentApp` as the application class, no backup, and `singleTask` with `adjustResize` on the activity (the keyboard pushes the sign-in form up).

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <!-- The app lock: fingerprint or the phone's PIN, pattern or password (docs/SPEC.md §11.1). -->
    <uses-permission android:name="android.permission.USE_BIOMETRIC" />

    <!--
        No backup and no device-to-device transfer: the sign-in is encrypted with a key that never leaves this
        phone, so a copy on another phone could not be read anyway (docs/SPEC.md §11.1).
    -->
    <application
        android:name=".ParentApp"
        android:allowBackup="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:label="Screen Time Parent"
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
        </activity>

    </application>

</manifest>
```

### 5.3 Debug builds: `http://` to the PC

New, both files. As in the kid app: debug builds may reach `http://10.0.2.2:8080`, the PC as seen from the emulator. Release builds only use HTTPS.

`android/app-parent/src/debug/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Debug builds only: the network config allows http:// to a server on the developer's PC (10.0.2.2 from the emulator). -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application android:networkSecurityConfig="@xml/network_security_config" />

</manifest>
```

`android/app-parent/src/debug/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Debug builds only: allow http:// so the app can reach a server running on the PC. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
```

### 5.4 `android/app-parent/src/main/res/xml/data_extraction_rules.xml`

New. Nothing of the app goes to a cloud backup or a new phone (the same file as the kid app's).

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

### 5.5 Icons

New, five files. The app's hourglass mark, and the four tab icons from Material Symbols Rounded (docs/SPEC.md §16.1). They are black on transparent; Compose's `Icon` tints them. Use them with `painterResource(R.drawable.ic_today)` and so on.

`android/app-parent/src/main/res/drawable/ic_hourglass.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The app's mark on the sign-in and lock screens: the kid app's hourglass, 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FF000000"
        android:pathData="M6,2h12v2h-1.2l-4.8,8l4.8,8h1.2v2h-12v-2h1.2l4.8,-8l-4.8,-8h-1.2z" />
</vector>
```

`android/app-parent/src/main/res/drawable/ic_today.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The Today tab: Material Symbols Rounded "today", 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <path
        android:fillColor="#FF000000"
        android:pathData="M360,660Q318,660 289,631Q260,602 260,560Q260,518 289,489Q318,460 360,460Q402,460 431,489Q460,518 460,560Q460,602 431,631Q402,660 360,660ZM200,880Q167,880 143.5,856.5Q120,833 120,800L120,240Q120,207 143.5,183.5Q167,160 200,160L240,160L240,120Q240,103 251.5,91.5Q263,80 280,80Q297,80 308.5,91.5Q320,103 320,120L320,160L640,160L640,120Q640,103 651.5,91.5Q663,80 680,80Q697,80 708.5,91.5Q720,103 720,120L720,160L760,160Q793,160 816.5,183.5Q840,207 840,240L840,800Q840,833 816.5,856.5Q793,880 760,880L200,880ZM200,800L760,800Q760,800 760,800Q760,800 760,800L760,400L200,400L200,800Q200,800 200,800Q200,800 200,800ZM200,320L760,320L760,240Q760,240 760,240Q760,240 760,240L200,240Q200,240 200,240Q200,240 200,240L200,320ZM200,320L200,240Q200,240 200,240Q200,240 200,240L200,240Q200,240 200,240Q200,240 200,240L200,320L200,320Z" />
</vector>
```

`android/app-parent/src/main/res/drawable/ic_inbox.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The Inbox tab: Material Symbols Rounded "inbox", 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <path
        android:fillColor="#FF000000"
        android:pathData="M200,840Q167,840 143.5,816.5Q120,793 120,760L120,200Q120,167 143.5,143.5Q167,120 200,120L760,120Q793,120 816.5,143.5Q840,167 840,200L840,760Q840,793 816.5,816.5Q793,840 760,840L200,840ZM200,760L760,760Q760,760 760,760Q760,760 760,760L760,640L640,640Q610,678 568.5,699Q527,720 480,720Q433,720 391.5,699Q350,678 320,640L200,640L200,760Q200,760 200,760Q200,760 200,760ZM480,640Q512,640 539,623.5Q566,607 583,580Q589,571 598,565.5Q607,560 618,560L760,560L760,200Q760,200 760,200Q760,200 760,200L200,200Q200,200 200,200Q200,200 200,200L200,560L342,560Q353,560 362,565.5Q371,571 377,580Q394,607 421,623.5Q448,640 480,640ZM200,760Q200,760 200,760Q200,760 200,760L200,760L320,760Q350,760 391.5,760Q433,760 480,760Q527,760 568.5,760Q610,760 640,760L760,760L760,760Q760,760 760,760Q760,760 760,760L200,760Z" />
</vector>
```

`android/app-parent/src/main/res/drawable/ic_kids.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The Kids tab: Material Symbols Rounded "group", 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <path
        android:fillColor="#FF000000"
        android:pathData="M40,688Q40,654 57.5,625.5Q75,597 104,582Q166,551 230,535.5Q294,520 360,520Q426,520 490,535.5Q554,551 616,582Q645,597 662.5,625.5Q680,654 680,688L680,720Q680,753 656.5,776.5Q633,800 600,800L120,800Q87,800 63.5,776.5Q40,753 40,720L40,688ZM840,800L738,800Q749,782 754.5,761.5Q760,741 760,720L760,680Q760,636 735.5,595.5Q711,555 666,526Q717,532 762,546.5Q807,561 846,582Q882,602 901,626.5Q920,651 920,680L920,720Q920,753 896.5,776.5Q873,800 840,800ZM360,480Q294,480 247,433Q200,386 200,320Q200,254 247,207Q294,160 360,160Q426,160 473,207Q520,254 520,320Q520,386 473,433Q426,480 360,480ZM760,320Q760,386 713,433Q666,480 600,480Q589,480 572,477.5Q555,475 544,472Q571,440 585.5,401Q600,362 600,320Q600,278 585.5,239Q571,200 544,168Q558,163 572,161.5Q586,160 600,160Q666,160 713,207Q760,254 760,320ZM120,720L600,720L600,688Q600,677 594.5,668Q589,659 580,654Q526,627 471,613.5Q416,600 360,600Q304,600 249,613.5Q194,627 140,654Q131,659 125.5,668Q120,677 120,688L120,720ZM360,400Q393,400 416.5,376.5Q440,353 440,320Q440,287 416.5,263.5Q393,240 360,240Q327,240 303.5,263.5Q280,287 280,320Q280,353 303.5,376.5Q327,400 360,400ZM360,720L360,720L360,720Q360,720 360,720Q360,720 360,720Q360,720 360,720Q360,720 360,720Q360,720 360,720Q360,720 360,720Q360,720 360,720Q360,720 360,720L360,720ZM360,320Q360,320 360,320Q360,320 360,320Q360,320 360,320Q360,320 360,320Q360,320 360,320Q360,320 360,320Q360,320 360,320Q360,320 360,320Z" />
</vector>
```

`android/app-parent/src/main/res/drawable/ic_settings.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The Settings tab: Material Symbols Rounded "settings", 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <path
        android:fillColor="#FF000000"
        android:pathData="M433,880Q406,880 386.5,862Q367,844 363,818L354,752Q341,747 329.5,740Q318,733 307,725L245,751Q220,762 195,753Q170,744 156,721L109,639Q95,616 101,590Q107,564 128,547L181,507Q180,500 180,493.5Q180,487 180,480Q180,473 180,466.5Q180,460 181,453L128,413Q107,396 101,370Q95,344 109,321L156,239Q170,216 195,207Q220,198 245,209L307,235Q318,227 330,220Q342,213 354,208L363,142Q367,116 386.5,98Q406,80 433,80L527,80Q554,80 573.5,98Q593,116 597,142L606,208Q619,213 630.5,220Q642,227 653,235L715,209Q740,198 765,207Q790,216 804,239L851,321Q865,344 859,370Q853,396 832,413L779,453Q780,460 780,466.5Q780,473 780,480Q780,487 780,493.5Q780,500 778,507L831,547Q852,564 858,590Q864,616 850,639L802,721Q788,744 763,753Q738,762 713,751L653,725Q642,733 630,740Q618,747 606,752L597,818Q593,844 573.5,862Q554,880 527,880L433,880ZM440,800L519,800L533,694Q564,686 590.5,670.5Q617,655 639,633L738,674L777,606L691,541Q696,527 698,511.5Q700,496 700,480Q700,464 698,448.5Q696,433 691,419L777,354L738,286L639,328Q617,305 590.5,289.5Q564,274 533,266L520,160L441,160L427,266Q396,274 369.5,289.5Q343,305 321,327L222,286L183,354L269,418Q264,433 262,448Q260,463 260,480Q260,496 262,511Q264,526 269,541L183,606L222,674L321,632Q343,655 369.5,670.5Q396,686 427,694L440,800ZM482,620Q540,620 581,579Q622,538 622,480Q622,422 581,381Q540,340 482,340Q423,340 382.5,381Q342,422 342,480Q342,538 382.5,579Q423,620 482,620ZM480,480L480,480Q480,480 480,480Q480,480 480,480L480,480L480,480L480,480Q480,480 480,480Q480,480 480,480Q480,480 480,480Q480,480 480,480L480,480L480,480L480,480Q480,480 480,480Q480,480 480,480L480,480L480,480L480,480Q480,480 480,480Q480,480 480,480L480,480L480,480L480,480Q480,480 480,480Q480,480 480,480Q480,480 480,480Q480,480 480,480L480,480L480,480L480,480Q480,480 480,480Q480,480 480,480L480,480L480,480Z" />
</vector>
```

### 5.6 `…/test/…/auth/SessionTest.kt`

New. 9 tests of `Session` (6.2) against a pretend server (Ktor's `MockEngine`) and a token store in memory. Read it before writing `Session.kt`: it shows exactly which requests go to the server, in which order, with which token.

```kotlin
package au.screentime.parent.auth

import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.Me
import au.screentime.core.model.api.MeFamily
import au.screentime.core.model.api.MeParent
import au.screentime.core.model.api.Role
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import java.io.IOException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class SessionTest {
    private val me = Me(
        parent = MeParent("p1", "dad@example.com", "Dad", null),
        family = MeFamily("f1", "Dev family", "Australia/Sydney", "000"),
        roles = listOf(Role.PARENT),
    )
    private val meJson =
        """{"parent":{"id":"p1","email":"dad@example.com","displayName":"Dad","phoneE164":null},""" +
            """"family":{"id":"f1","name":"Dev family","timezone":"Australia/Sydney","emergencyNumber":"000"},""" +
            """"roles":["parent"]}"""

    private class MemoryStore(var saved: Saved? = null) : TokenStore {
        override fun load() = saved

        override fun save(saved: Saved) {
            this.saved = saved
        }

        override fun clear() {
            saved = null
        }
    }

    private var now = 1_000_000L
    private val requests = mutableListOf<HttpRequestData>()
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun session(
        store: TokenStore,
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ) = Session(
        "https://api.example",
        MockEngine { request ->
            requests += request
            handler(request)
        },
        store,
        clock = { now },
    )

    private fun MockRequestHandleScope.tokens(access: String, refresh: String) =
        respond("""{"accessToken":"$access","refreshToken":"$refresh","expiresIn":900,"me":$meJson}""", HttpStatusCode.OK, json)

    private fun MockRequestHandleScope.unauthorized() =
        respond("""{"error":{"code":"unauthorized","message":"Sign in again."}}""", HttpStatusCode.Unauthorized, json)

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private fun HttpRequestData.bearer() = headers[HttpHeaders.Authorization]

    private val paths get() = requests.map { it.url.encodedPath }

    @Test
    fun startsSignedInOnlyWithASavedSignIn() {
        assertEquals(SessionState.SignedOut, session(MemoryStore()) { error("no call") }.state.value)
        assertEquals(SessionState.SignedIn(me), session(MemoryStore(Saved("r0", me))) { error("no call") }.state.value)
    }

    @Test
    fun theCodeSignsInAsAnAndroidPhoneAndKeepsTheRefreshToken() = runBlocking {
        val store = MemoryStore()
        val session = session(store) { tokens("a1", "r1") }

        session.verify("dad@example.com", "123456", "Pixel 10")

        assertEquals("/v1/auth/otp/verify", requests.single().url.encodedPath)
        assertEquals(
            """{"email":"dad@example.com","code":"123456","client":"android","clientLabel":"Pixel 10"}""",
            requests.single().bodyText(),
        )
        assertEquals(Saved("r1", me), store.saved)
        assertEquals(SessionState.SignedIn(me), session.state.value)
    }

    @Test
    fun aSavedSignInSwapsTheRefreshTokenBeforeTheFirstCall() = runBlocking {
        val store = MemoryStore(Saved("r0", me))
        val session = session(store) { request ->
            if (request.url.encodedPath == "/v1/auth/refresh") tokens("a1", "r1") else respond("", HttpStatusCode.NoContent)
        }

        session.call { postAuthLogout() }

        assertEquals(listOf("/v1/auth/refresh", "/v1/auth/logout"), paths)
        assertEquals("""{"refreshToken":"r0"}""", requests[0].bodyText())
        assertNull(requests[0].bearer())
        assertEquals("Bearer a1", requests[1].bearer())
        assertEquals("r1", store.saved?.refreshToken)
    }

    @Test
    fun theAccessTokenIsUsedUntilAMinuteBeforeItRunsOut() = runBlocking {
        var n = 0
        val session = session(MemoryStore()) { request ->
            when (request.url.encodedPath) {
                "/v1/auth/otp/verify" -> tokens("a1", "r1")
                "/v1/auth/refresh" -> tokens("a${++n + 1}", "r${n + 1}")
                else -> respond("", HttpStatusCode.NoContent)
            }
        }
        session.verify("dad@example.com", "123456", "Pixel 10")

        now += 839_000
        session.call { postAuthLogout() }
        now += 1_000
        session.call { postAuthLogout() }

        assertEquals(listOf("/v1/auth/otp/verify", "/v1/auth/logout", "/v1/auth/refresh", "/v1/auth/logout"), paths)
        assertEquals("Bearer a1", requests[1].bearer())
        assertEquals("Bearer a2", requests[3].bearer())
    }

    @Test
    fun a401SwapsTheTokensAndTriesOnceMore() = runBlocking {
        val store = MemoryStore()
        var logouts = 0
        val session = session(store) { request ->
            when (request.url.encodedPath) {
                "/v1/auth/otp/verify" -> tokens("a1", "r1")
                "/v1/auth/refresh" -> tokens("a2", "r2")
                else -> if (++logouts == 1) unauthorized() else respond("", HttpStatusCode.NoContent)
            }
        }
        session.verify("dad@example.com", "123456", "Pixel 10")

        session.call { postAuthLogout() }

        assertEquals(listOf("/v1/auth/otp/verify", "/v1/auth/logout", "/v1/auth/refresh", "/v1/auth/logout"), paths)
        assertEquals("""{"refreshToken":"r1"}""", requests[2].bodyText())
        assertEquals("Bearer a2", requests[3].bearer())
        assertEquals("r2", store.saved?.refreshToken)
    }

    @Test
    fun callsAtTheSameTimeSwapTheTokensOnce() = runBlocking {
        val session = session(MemoryStore(Saved("r0", me))) { request ->
            if (request.url.encodedPath == "/v1/auth/refresh") {
                delay(50)
                tokens("a1", "r1")
            } else {
                respond("", HttpStatusCode.NoContent)
            }
        }

        (1..3).map { async { session.call { postAuthLogout() } } }.awaitAll()

        assertEquals(1, paths.count { it == "/v1/auth/refresh" })
        assertEquals(3, paths.count { it == "/v1/auth/logout" })
    }

    @Test
    fun aRefreshTokenTheServerRefusesSignsOut() = runBlocking {
        val store = MemoryStore(Saved("r0", me))
        val session = session(store) { unauthorized() }

        assertThrows<SignedOutException> { runBlocking { session.call { getToday() } } }

        assertNull(store.saved)
        assertEquals(SessionState.SignedOut, session.state.value)
    }

    @Test
    fun noConnectionOrAnotherErrorKeepsTheSignIn() = runBlocking {
        val store = MemoryStore(Saved("r0", me))
        var first = true
        val session = session(store) { request ->
            when {
                first -> {
                    first = false
                    throw IOException("offline")
                }
                request.url.encodedPath == "/v1/auth/refresh" -> tokens("a1", "r1")
                else -> respond("""{"error":{"code":"internal","message":"x"}}""", HttpStatusCode.InternalServerError, json)
            }
        }

        assertThrows<IOException> { runBlocking { session.call { getToday() } } }
        val e = assertThrows<ApiException> { runBlocking { session.call { getToday() } } }

        assertEquals(500, e.status)
        assertEquals("r1", store.saved?.refreshToken)
        assertEquals(SessionState.SignedIn(me), session.state.value)
    }

    @Test
    fun signOutTellsTheServerAndForgetsEvenOffline() = runBlocking {
        val online = MemoryStore(Saved("r0", me))
        val session = session(online) { request ->
            if (request.url.encodedPath == "/v1/auth/refresh") tokens("a1", "r1") else respond("", HttpStatusCode.NoContent)
        }
        session.signOut()
        assertEquals(listOf("/v1/auth/refresh", "/v1/auth/logout"), paths)
        assertNull(online.saved)
        assertEquals(SessionState.SignedOut, session.state.value)

        val offline = MemoryStore(Saved("r0", me))
        val cut = session(offline) { throw IOException("offline") }
        cut.signOut()
        assertNull(offline.saved)
        assertTrue(cut.state.value == SessionState.SignedOut)
    }
}
```

### 5.7 `…/test/…/auth/SignInTest.kt`

New. 4 tests of the sign-in helpers (6.4).

```kotlin
package au.screentime.parent.auth

import au.screentime.core.model.api.ApiException
import java.io.IOException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SignInTest {
    @Test
    fun theEmailIsTrimmedAndLowerCase() {
        assertEquals("dad@example.com", cleanEmail("  Dad@Example.COM "))
    }

    @Test
    fun anEmailNeedsOneAtAndADotAfterIt() {
        assertTrue(looksLikeEmail("dad@example.com"))
        assertTrue(looksLikeEmail("j.g@mail.gallagherhome.au"))
        assertFalse(looksLikeEmail(""))
        assertFalse(looksLikeEmail("dad"))
        assertFalse(looksLikeEmail("@example.com"))
        assertFalse(looksLikeEmail("dad@example"))
        assertFalse(looksLikeEmail("dad@.com"))
        assertFalse(looksLikeEmail("dad@example."))
        assertFalse(looksLikeEmail("dad@@example.com"))
        assertFalse(looksLikeEmail("da d@example.com"))
    }

    @Test
    fun theCodeKeepsSixDigits() {
        assertEquals("123456", cleanCode(" 123 456 "))
        assertEquals("123456", cleanCode("1234567"))
        assertEquals("12", cleanCode("1a2"))
    }

    @Test
    fun eachProblemHasItsOwnWords() {
        assertEquals(
            "That code didn't work. Check it, or send a new code.",
            signInError(ApiException(401, null), verifying = true),
        )
        assertEquals("Too many tries. Wait a few minutes, then try again.", signInError(ApiException(429, null), verifying = true))
        assertEquals("Too many tries. Wait a few minutes, then try again.", signInError(ApiException(429, null), verifying = false))
        assertEquals("Check the email address and try again.", signInError(ApiException(422, null), verifying = false))
        assertEquals("Something went wrong on the server. Try again soon.", signInError(ApiException(500, null), verifying = false))
        assertEquals("Something went wrong on the server. Try again soon.", signInError(ApiException(401, null), verifying = false))
        assertEquals(
            "Can't reach Screen Time. Check the internet connection and try again.",
            signInError(IOException("offline"), verifying = true),
        )
    }
}
```

### 5.8 `…/test/…/lock/AppLockTest.kt`

New. 3 tests of the app lock (6.8).

```kotlin
package au.screentime.parent.lock

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppLockTest {
    private val left = 10_000_000L

    @Test
    fun aFreshStartIsLocked() {
        assertTrue(shouldLock(null, left))
    }

    @Test
    fun fiveMinutesAwayLocks() {
        assertFalse(shouldLock(left, left))
        assertFalse(shouldLock(left, left + 299_999))
        assertTrue(shouldLock(left, left + 300_000))
        assertTrue(shouldLock(left, left + 3_600_000))
    }

    @Test
    fun theLockFollowsLeavingAndComingBack() {
        AppLock.unlock()
        AppLock.left(left)
        AppLock.opened(left + 60_000, secure = true)
        assertFalse(AppLock.locked.value)

        AppLock.left(left + 70_000)
        AppLock.opened(left + 370_000, secure = true)
        assertTrue(AppLock.locked.value)

        // Coming back again soon does not unlock it: only unlock() does.
        AppLock.left(left + 371_000)
        AppLock.opened(left + 372_000, secure = true)
        assertTrue(AppLock.locked.value)

        // A phone with no screen lock is never locked.
        AppLock.opened(left + 373_000, secure = false)
        assertFalse(AppLock.locked.value)
    }
}
```

### 5.9 `…/test/…/today/TodayViewTest.kt`

New. 9 tests of how Today reads (6.10).

```kotlin
package au.screentime.parent.today

import au.screentime.core.model.api.AvatarColor
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.LockReason
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayDevice
import au.screentime.core.model.api.TodayDeviceParentMode
import au.screentime.core.model.api.TodayKid
import au.screentime.core.model.api.TodayPool
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class TodayViewTest {
    private val now = Instant.parse("2026-10-28T05:00:00Z")

    private fun pool(
        allowanceMin: Int = 120,
        grantedMin: Int = 0,
        usedSec: Int = 0,
        remainingSec: Int = 7200,
        locked: Boolean = false,
        lockReason: LockReason? = null,
        overspendSec: Int = 0,
        devices: List<TodayDevice> = emptyList(),
        which: Pool = Pool.SCREENS,
    ) = TodayPool(which, allowanceMin, grantedMin, usedSec, remainingSec, locked, lockReason, null, overspendSec, devices)

    private fun device(
        id: String = "d1",
        name: String = "PC",
        inUse: Boolean = false,
        lastSeenAt: String? = "2026-10-28T04:59:00Z",
        parentMode: TodayDeviceParentMode? = null,
    ) = TodayDevice(id, name, DeviceForm.PC, inUse, lastSeenAt, parentMode)

    @Test
    fun aPoolWithTimeLeft() {
        assertEquals(
            PoolView("Screens", "45m left", "1h 15m used of 2h", 0.375f, Tone.OK),
            poolView(pool(usedSec = 4500, remainingSec = 2700)),
        )
        assertEquals("Nothing used of 2h 30m", poolView(pool(grantedMin = 30, remainingSec = 9000)).detail)
        assertEquals("Phone", poolView(pool(which = Pool.PHONE)).name)
    }

    @Test
    fun fifteenMinutesIsAmberAndFiveIsOrange() {
        assertEquals(Tone.OK, poolView(pool(remainingSec = 901)).tone)
        assertEquals(Tone.WARNING, poolView(pool(remainingSec = 900)).tone)
        assertEquals(Tone.WARNING, poolView(pool(remainingSec = 301)).tone)
        assertEquals(Tone.CRITICAL, poolView(pool(remainingSec = 300)).tone)
        assertEquals("less than a minute left", poolView(pool(remainingSec = 59)).status)
    }

    @Test
    fun aLockedPoolSaysWhy() {
        assertEquals(
            PoolView("Screens", "Locked · bedtime", "2h used of 2h", 0f, Tone.LOCKED),
            poolView(pool(usedSec = 7200, remainingSec = 0, locked = true, lockReason = LockReason.BEDTIME)),
        )
        assertEquals("Locked · out of time", poolView(pool(locked = true, lockReason = LockReason.OUT_OF_TIME)).status)
        assertEquals("Locked · before wake-up", poolView(pool(locked = true, lockReason = LockReason.BEFORE_WAKE)).status)
        assertEquals("Locked · out of time", poolView(pool(locked = true)).status)
    }

    @Test
    fun noTimeToday() {
        assertEquals("No time today", poolView(pool(allowanceMin = 0, remainingSec = 0, locked = true)).detail)
        assertEquals("20m used", poolView(pool(allowanceMin = 0, usedSec = 1200, remainingSec = 0, locked = true)).detail)
        // Time taken away below zero is no time.
        assertEquals(0f, poolView(pool(allowanceMin = 30, grantedMin = -60, remainingSec = 0)).fraction)
    }

    @Test
    fun theBarNeverGoesPastFull() {
        assertEquals(1f, poolView(pool(remainingSec = 9000)).fraction)
    }

    @Test
    fun chipsForUseParentModeAndOfflineDevices() {
        val kid = TodayKid(
            "k1",
            "Alex",
            AvatarColor._0F766E,
            listOf(
                pool(
                    devices = listOf(
                        device(id = "pc", name = "alex on Dev PC", inUse = true),
                        device(id = "tab", name = "Tablet", lastSeenAt = "2026-10-27T22:00:00Z"),
                    ),
                ),
                pool(
                    which = Pool.PHONE,
                    devices = listOf(
                        device(
                            id = "ph",
                            name = "Pixel 7",
                            parentMode = TodayDeviceParentMode("2026-10-28T05:09:30Z", "Dad"),
                        ),
                    ),
                ),
            ),
        )

        assertEquals(
            listOf(
                Chip("Using alex on Dev PC now", ChipTone.PRIMARY),
                Chip("Tablet offline 7h", ChipTone.NEUTRAL),
                Chip("Parent mode on Pixel 7 · 10 min", ChipTone.NEUTRAL),
            ),
            kidChips(kid, now),
        )
    }

    @Test
    fun moreChipRules() {
        val endless = device(parentMode = TodayDeviceParentMode(null, "Mum"))
        val ending = device(parentMode = TodayDeviceParentMode("2026-10-28T04:59:00Z", "Mum"))
        val days = device(lastSeenAt = "2026-10-25T05:00:00Z")
        val never = device(lastSeenAt = null)
        val inUseLongAgo = device(inUse = true, lastSeenAt = "2026-10-27T05:00:00Z")
        fun chips(d: TodayDevice) = kidChips(TodayKid("k", "Sam", AvatarColor._7C3AED, listOf(pool(devices = listOf(d)))), now)

        assertEquals(listOf(Chip("Parent mode on PC", ChipTone.NEUTRAL)), chips(endless))
        assertEquals(listOf(Chip("Parent mode on PC · 1 min", ChipTone.NEUTRAL)), chips(ending))
        assertEquals(listOf(Chip("PC offline 3d", ChipTone.NEUTRAL)), chips(days))
        assertEquals(emptyList<Chip>(), chips(never))
        assertEquals(listOf(Chip("Using PC now", ChipTone.PRIMARY)), chips(inUseLongAgo))
    }

    @Test
    fun aDeviceInBothPoolsIsListedOnceAndOverspendIsAmber() {
        val pc = device(inUse = true)
        val kid = TodayKid(
            "k1",
            "Alex",
            AvatarColor._0F766E,
            listOf(pool(devices = listOf(pc), overspendSec = 720), pool(which = Pool.PHONE, devices = listOf(pc), overspendSec = 59)),
        )

        assertEquals(
            listOf(
                Chip("Using PC now", ChipTone.PRIMARY),
                Chip("Screens: 12m over (a device was offline)", ChipTone.WARNING),
            ),
            kidChips(kid, now),
        )
    }

    @Test
    fun theDayAndTheInitial() {
        assertEquals("Wednesday 28 October", dayTitle("2026-10-28"))
        assertEquals("A", initial(" alex"))
        assertEquals("?", initial(""))
    }
}
```

### 5.10 `server/scripts/dev-usage.ts`

New. For the emulator run only: it makes a kid look busy on a pretend Windows PC, so Today has something to show. It enrols the PC through the API and uploads one open usage segment that started some minutes ago.

```typescript
// Makes a kid of the development database look busy on a PC, for the parent app's Today screen: it enrols a pretend
// Windows PC through the API and uploads one usage segment that started some minutes ago and is still open, so Today
// shows the time as used and the PC as in use. The PC counts as in use for 10 minutes, as a real one that stops
// syncing would. Run it once per kid: a second run adds the minutes again.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-usage.ts Alex 140 [http://localhost:8080]
// Minutes are 1 to 720. Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { enrolmentCodes, kids, parents } from '../src/db/schema.js';
import { newEnrolmentCode } from '../src/devices/token.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const minutes = Number(process.argv[3]);
const apiUrl = (process.argv[4] ?? 'http://localhost:8080').replace(/\/+$/, '');
if (!databaseUrl || !kidName || !Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-usage.ts <kid name> <minutes, 1 to 720> [api url]');
  process.exit(1);
}

async function post(path: string, body: unknown, token?: string): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: the API said ${response.status}: ${await response.text()}`);
  return response.json();
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
  const code = newEnrolmentCode();
  await db.insert(enrolmentCodes).values({
    familyId: kid.familyId,
    kidId: kid.id,
    form: 'pc',
    code,
    expiresAt: sql`now() + interval '10 minutes'`,
    createdBy: parent.id,
  });

  const user = kid.name.toLowerCase();
  const enrolled = (await post('/v1/enrol', {
    code,
    platform: 'windows',
    hasCellular: false,
    model: 'Dev PC',
    osVersion: 'Windows 11',
    appVersion: 'dev',
    machineId: `dev-pc-${kid.id}`,
    windowsUserSid: `S-1-5-21-dev-${kid.id}`,
    windowsUserName: user,
  })) as { deviceToken: string };
  const startedAt = new Date(Date.now() - minutes * 60_000).toISOString();
  await post(
    '/v1/device/usage',
    { segments: [{ id: randomUUID(), startedAt, endedAt: null, recordedOffline: false }] },
    enrolled.deviceToken,
  );
  console.log(`${kid.name} has been using "${user} on Dev PC" for ${minutes} min, and still is.`);
} finally {
  await pool.end();
}
```

## 6. What to write

Everything in this section is under `android/app-parent/src/main/kotlin/au/screentime/parent/`. Names in `code` are exact: the tests, the other files or the emulator run use them. Imports you will need from the project: `au.screentime.core.model.api.*` (the API client and its models: `ApiClient`, `ApiException`, `Me`, `Today`, `TodayKid`, `TodayPool`, `TodayDevice`, `Pool`, `LockReason`, `AvatarColor`, `OtpRequest`, `OtpVerifyRequest`, `OtpVerifyRequestClient`, `RefreshRequest`, `AuthResponse`, `ApiJson`), `au.screentime.core.time.formatDuration` (`formatDuration(4500L)` is `"1h 15m"`, `formatDuration(7200L)` is `"2h"`, under 60 seconds it is `"less than a minute"`), and `au.screentime.core.ui.ScreenTimeTheme` and `AvatarColors`.

Colours: always from the theme, never a hex value in Kotlin, except `Color.White` for the avatar initial. `MaterialTheme.colorScheme.primary`, `.onPrimary`, `.background`, `.onBackground`, `.surface`, `.onSurface`, `.surfaceVariant`; and `ScreenTimeTheme.colors.muted`, `.outline`, `.warning`, `.critical`, `.danger`. Text styles: `MaterialTheme.typography.*`. Light and dark both follow the phone; nothing to do for that.

### 6.1 `ParentApp.kt`

`class ParentApp : Application()`, the application class named in the manifest. It has `lateinit var session: Session` with a `private set`, made in `onCreate()`:

```kotlin
Session(BuildConfig.SERVER, OkHttp.create(), PrefsTokenStore(this), SystemClock::elapsedRealtime)
```

(`OkHttp` is `io.ktor.client.engine.okhttp.OkHttp`.) Every screen gets the session with `(application as ParentApp).session`. There is one session for the whole app.

### 6.2 `auth/Session.kt`

The sign-in and every call to the server (docs/SPEC.md §11.1). In this one file:

- `const val ACCESS_MARGIN_MS = 60_000L`: an access token is used until one minute before it runs out.
- `data class Saved(val refreshToken: String, val me: Me)`: what is kept between starts.
- `interface TokenStore` with `fun load(): Saved?`, `fun save(saved: Saved)` and `fun clear()`.
- `sealed interface SessionState` with `data object SignedOut` and `data class SignedIn(val me: Me)` inside it.
- `class SignedOutException : Exception("signed out")`.
- `class Session(baseUrl: String, engine: HttpClientEngine, private val store: TokenStore, private val clock: () -> Long)`.

`Session` holds the access token and the time (on `clock`) until which it may be used, in memory only (two `@Volatile` fields), and **one** `ApiClient(baseUrl, engine, token = { <the access token field> })`. Its public members:

| Member | What it does |
|---|---|
| `val state: StateFlow<SessionState>` | Starts as `SignedIn(saved.me)` when `store.load()` gives a `Saved`, else `SignedOut`. Changes only as described below. |
| `suspend fun requestCode(email: String)` | `postAuthOtpRequest(OtpRequest(email))`. Errors are thrown as they are. |
| `suspend fun verify(email: String, code: String, label: String)` | `postAuthOtpVerify(OtpVerifyRequest(email, code, OtpVerifyRequestClient.ANDROID, label))`, then **keep** the answer (below). The answer's `refreshToken` must not be null for Android: if it is, throw `IllegalStateException` (use `checkNotNull`). |
| `suspend fun <T> call(block: suspend ApiClient.() -> T): T` | Every other call goes through this, for example `session.call { getToday() }`. See the rules below. |
| `suspend fun signOut()` | `call { postAuthLogout() }`, ignoring **any** error except `CancellationException` (rethrow that one), then **forget** (below). |

**Keep** an `AuthResponse`: set the access token to `accessToken`, and the time until which it may be used to `clock() + expiresIn * 1000L - ACCESS_MARGIN_MS`; `store.save(Saved(refreshToken, me))`; set the state to `SignedIn(me)`.

**Forget**: clear the access token (null) and its time (0), `store.clear()`, state `SignedOut`.

**Swap** (private, `refresh` in the rest of this card): swap the refresh token for a new pair. The server **rotates** the refresh token every time: the old one stops working at once. So swaps must never run side by side: put the whole swap inside a `kotlinx.coroutines.sync.Mutex` (`withLock`). The swap takes the access token the caller was using (`stale`, maybe null). Inside the lock:

1. If there is now an access token, it is **not** `stale`, and its time has not run out: another call has just swapped. Do nothing.
2. `store.load()`. If null: forget and throw `SignedOutException`.
3. `postAuthRefresh(RefreshRequest(saved.refreshToken))`. If that throws `ApiException` with status 401: forget and throw `SignedOutException`. Any other error (another status, no connection): throw it as it is, and **do not** forget: a parent must never be signed out because the Wi-Fi dropped.
4. Keep the answer, with its `refreshToken`, or the saved one if the answer has none.

**`call`**, step by step:

1. Remember the current access token as `used`. If it is null, or `clock()` is at or past its time: swap with `used`, then set `used` to the new access token.
2. Run `block` on the `ApiClient` and return its result.
3. If it throws `ApiException` with status 401: swap with `used`, then run `block` once more and return that (a second error is thrown). Any other error is thrown as it is.

`SessionTest` checks each of these rules; when a test fails, its name says which rule.

### 6.3 `auth/PrefsTokenStore.kt`

`class PrefsTokenStore(context: Context) : TokenStore`. SharedPreferences named `session` (`context.applicationContext.getSharedPreferences("session", Context.MODE_PRIVATE)`) with two strings:

- `refreshToken`: the refresh token **encrypted**, as `<iv>.<ciphertext>`, both Base64 with `android.util.Base64.NO_WRAP`.
- `me`: `ApiJson.encodeToString(Me.serializer(), saved.me)`, plain (it is no secret).

Encryption: AES-GCM with a key kept in the Android Keystore, never in the app's files.

- The key: `KeyStore.getInstance("AndroidKeyStore")`, `load(null)`, then `getKey("session", null) as? SecretKey`. If there is none, make it: `KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")`, `init(KeyGenParameterSpec.Builder("session", PURPOSE_ENCRYPT or PURPOSE_DECRYPT).setBlockModes(BLOCK_MODE_GCM).setEncryptionPaddings(ENCRYPTION_PADDING_NONE).setKeySize(256).build())`, `generateKey()`. Do **not** call `setUserAuthenticationRequired`: the app lock is separate (6.8), and later cards refresh tokens in the background.
- Encrypt: `Cipher.getInstance("AES/GCM/NoPadding")`, `init(ENCRYPT_MODE, key)` (the Keystore picks the IV; read it back with `cipher.iv`), `doFinal(token.toByteArray(Charsets.UTF_8))`.
- Decrypt: `init(DECRYPT_MODE, key, GCMParameterSpec(128, iv))`, `doFinal(ciphertext)`.

`save` writes both strings with `.commit()` (not `apply()`: a rotated token must be on disk before the app goes on). `clear` removes everything in `session` with `.commit()`. `load` returns null when either string is missing, and also when the token cannot be decrypted or read back: catch `GeneralSecurityException` and `IllegalArgumentException` (bad Base64, or `me` not readable), log one warning with tag `PrefsTokenStore` and the exception's class name only (never the token), and return null. Null means signed out.

### 6.4 `auth/SignIn.kt`

Four top-level functions, no Android in them (`SignInTest` checks each):

| Function | Rule |
|---|---|
| `fun cleanEmail(text: String): String` | trimmed, lower case |
| `fun looksLikeEmail(email: String): Boolean` | exactly one `@`, not first; a `.` after the `@` with at least one character between them; not ending in `.`; no whitespace anywhere |
| `fun cleanCode(text: String): String` | only the digits `0` to `9`, at most the first 6 |
| `fun signInError(e: Exception, verifying: Boolean): String` | the words in the table below, checked in this order |

| `e` | Words |
|---|---|
| `ApiException`, status 429 | `Too many tries. Wait a few minutes, then try again.` |
| `ApiException`, status 401, and `verifying` | `That code didn't work. Check it, or send a new code.` |
| `ApiException`, status 422 | `Check the email address and try again.` |
| any other `ApiException` | `Something went wrong on the server. Try again soon.` |
| anything else (no connection) | `Can't reach Screen Time. Check the internet connection and try again.` |

### 6.5 `auth/SignInViewModel.kt`

`data class SignInState(val email: String = "", val code: String = "", val codeSent: Boolean = false, val busy: Boolean = false, val error: String? = null, val note: String? = null)`. `codeSent` false is the email step, true the code step.

`class SignInViewModel(app: Application) : AndroidViewModel(app)` with `var state by mutableStateOf(SignInState())` and a `private set`, and these functions, all called from the screen:

| Function | What it does |
|---|---|
| `setEmail(text)` | email = `text` as typed; error cleared |
| `setCode(text)` | code = `cleanCode(text)`; error and note cleared |
| `sendCode()` | `cleanEmail(state.email)`. If not `looksLikeEmail`: error `Enter your email address, like name@example.com.` and stop. Else, busy: `session.requestCode(email)`; then email = the cleaned email, code = `""`, `codeSent` = true, note = `We sent a new code.` if `codeSent` was already true (this is **Send a new code**), else null. |
| `verify()` | If the code is not 6 digits: error `The code is 6 digits.` and stop. Else, busy: `session.verify(state.email, state.code, Build.MODEL)`; then `AppLock.unlock()` (the code was proof enough, 6.8); then `state = SignInState(email = state.email)`, so after a later sign-out the screen starts again at the email step with the email filled in. The app leaves this screen by itself, because the session's state changes. |
| `changeEmail()` | code `""`, `codeSent` false, error and note cleared (**Use a different email**) |

"Busy" means: do nothing if `busy` is already true; else set `busy` true and clear error and note; launch in `viewModelScope`; at the end set `busy` false; on an error (rethrow `CancellationException`), `busy` false and error = `signInError(e, verifying)`, with `verifying` true only for `verify()`.

### 6.6 `AppMark.kt`

`@Composable fun AppMark(modifier: Modifier = Modifier)`: a 72 dp circle filled with `colorScheme.primary`, and in its centre `ic_hourglass` at 36 dp, tinted `colorScheme.onPrimary`, `contentDescription = null`. Used on the sign-in and lock screens.

### 6.7 `auth/SignInScreen.kt`

`@Composable fun SignInScreen(vm: SignInViewModel)`. The look, top to bottom:

- The whole screen is `colorScheme.background`, with `safeDrawingPadding()` and `imePadding()`. In it, centred both ways, one `Column` at most **400 dp** wide (`widthIn(max = 400.dp)` and `fillMaxWidth()`), scrollable (`verticalScroll`), 24 dp padding, content centred horizontally.
- `AppMark()`; 24 dp; `Screen Time` in `headlineMedium`, `FontWeight.SemiBold`, `onBackground`; 4 dp; `Parent sign-in` in `bodyLarge`, `muted`; 32 dp.
- **Email step** (`codeSent` false):
  - An `OutlinedTextField`, full width, label `Email`, single line, `KeyboardType.Email`, `ImeAction.Send` (Send on the keyboard calls `sendCode()`), disabled while busy, `isError` while there is an error.
  - The message (below).
  - 16 dp; the pill button `Send code` (below), calling `sendCode()`.
- **Code step** (`codeSent` true):
  - `We emailed a 6-digit code to <email>. It works for 10 minutes.` in `bodyLarge`, `onBackground`, centred; 16 dp.
  - An `OutlinedTextField`, full width, label `Code`, single line, text style `headlineSmall` with `letterSpacing = 6.sp` and centred text, `KeyboardType.NumberPassword`, `ImeAction.Done` (Done calls `verify()`), disabled while busy, `isError` while there is an error.
  - The message; 16 dp; the pill button `Sign in`, calling `verify()`; 8 dp.
  - Two `TextButton`s one under the other, centred, disabled while busy: `Send a new code` (`sendCode()`) and `Use a different email` (`changeEmail()`).
- **The message**, only when there is an error or a note: 8 dp, then the error in `danger`, or else the note in `muted`, `bodyMedium`, full width.
- **The pill button**: a Material 3 `Button` (its default shape is the pill), full width, at least 48 dp high (`heightIn(min = 48.dp)`), disabled while busy. Its text in `labelLarge`; while busy, instead of the text, a `CircularProgressIndicator` of 20 dp with a 2 dp stroke in `onPrimary`.

### 6.8 `lock/AppLock.kt`

- `const val LOCK_AFTER_MS = 5 * 60_000L`.
- `fun shouldLock(leftAtMs: Long?, nowMs: Long): Boolean`: true when `leftAtMs` is null (a fresh start) or `nowMs - leftAtMs >= LOCK_AFTER_MS`.
- `object AppLock`, for the whole process:
  - `val locked: StateFlow<Boolean>`, starting **true**.
  - `fun opened(nowMs: Long, secure: Boolean)`: when not `secure` (the phone has no fingerprint, PIN, pattern or password), locked = false. Else, when `shouldLock(<last left time>, nowMs)`, locked = true. Otherwise nothing changes (coming back soon never unlocks; only `unlock()` does).
  - `fun left(nowMs: Long)`: remembers `nowMs` as the last left time.
  - `fun unlock()`: locked = false.

Times are `SystemClock.elapsedRealtime()`, passed in by `MainActivity` (6.15), so `AppLock` itself has no Android in it and `AppLockTest` can run on the PC. Turning the phone stops and starts the activity a moment apart, so it does not lock; a fresh start of the app always does.

### 6.9 `lock/LockScreen.kt`

`@Composable fun LockScreen(onUnlock: () -> Unit)`. It calls `onUnlock()` once as soon as it shows (`LaunchedEffect(Unit)`), so the fingerprint/PIN prompt comes up by itself. The look: the whole screen `colorScheme.background`, `safeDrawingPadding()`, 24 dp padding, everything centred both ways, in a column:

- `AppMark()`; 24 dp;
- `Screen Time is locked` in `headlineSmall`, `FontWeight.SemiBold`, `onBackground`; 8 dp;
- `Use your fingerprint or this phone's PIN to open it.` in `bodyLarge`, `muted`, centred; 32 dp;
- a `Button` `Unlock` (text `labelLarge`), at least 200 dp wide and 48 dp high, calling `onUnlock`. After the parent cancelled the prompt, this asks again.

### 6.10 `today/TodayView.kt`

How Today reads, with no Android in it. It follows the web app's Today (`web/src/lib/today.ts`, `poolView` and `kidChips`) with one difference: durations come from the Kotlin `formatDuration` ("1h 5m", not the web's "1h 05m"). `TodayViewTest` checks every rule here.

- `const val REFRESH_MS = 30_000L` and `const val OFFLINE_AFTER_MS = 6 * 60 * 60_000L`.
- `fun poolName(pool: Pool): String`: `Screens` or `Phone`.
- `enum class Tone { OK, WARNING, CRITICAL, LOCKED }`.
- `data class PoolView(val name: String, val status: String, val detail: String, val fraction: Float, val tone: Tone)`.
- `fun poolView(pool: TodayPool): PoolView`:
  - total = `(allowanceMin + grantedMin) * 60` seconds, at least 0.
  - used text: null when `usedSec` < 60, else `<formatDuration(usedSec)> used`. Total text: null when total < 60, else `formatDuration(total)`.
  - detail: when the total text is null, the used text, or `No time today` when that is null too; when only the used text is null, `Nothing used of <total>`; else `<used> of <total>` (for example `1h 15m used of 2h`).
  - When `locked`: status `Locked · out of time`, `Locked · bedtime` or `Locked · before wake-up` for `OUT_OF_TIME`, `BEDTIME`, `BEFORE_WAKE`, and `Locked · out of time` when `lockReason` is null; fraction 0; tone `LOCKED`.
  - Else: status `<formatDuration(remainingSec)> left`; fraction = remainingSec / total, kept between 0 and 1 (0 when total is 0); tone `CRITICAL` when remainingSec ≤ 300, `WARNING` when ≤ 900, else `OK`.
- `enum class ChipTone { NEUTRAL, PRIMARY, WARNING }` and `data class Chip(val text: String, val tone: ChipTone)`.
- `fun kidChips(kid: TodayKid, now: Instant): List<Chip>` (`java.time.Instant`), in this order:
  1. For each device of each pool, in order, **once per device id** (a device can be in both pools):
     - in use: `Using <name> now`, `PRIMARY`;
     - in parent mode: `Parent mode on <name> · <N> min` when `endsAt` is set, N = the minutes from `now` to `endsAt` **rounded up**, at least 1; `Parent mode on <name>` when `endsAt` is null; `NEUTRAL`. (Do not use `Math.ceilDiv`: it is not on Android. Add 59 999 ms and divide by 60 000.)
     - not in use, `lastSeenAt` set, and silent for `OFFLINE_AFTER_MS` or longer: `<name> offline <H>h` with H the whole hours, or `<D>d` (whole days) from 48 hours; `NEUTRAL`.
  2. Then for each pool with `overspendSec` ≥ 60: `<Screens|Phone>: <formatDuration(overspendSec)> over (a device was offline)`, `WARNING`.
- `fun initial(name: String): String`: the first character of the trimmed name in upper case, or `?` for an empty name.
- `fun dayTitle(date: String): String`: `2026-10-28` becomes `Wednesday 28 October`: `LocalDate.parse(date)` formatted with `DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.forLanguageTag("en-AU"))`.

### 6.11 `today/TodayViewModel.kt`

`data class TodayState(val today: Today? = null, val refreshing: Boolean = false, val error: String? = null)`.

`class TodayViewModel(app: Application) : AndroidViewModel(app)` with `var state by mutableStateOf(TodayState())`, `private set`, and:

- `suspend fun load(pulled: Boolean = false)`: when `pulled`, set `refreshing` true first. Then `session.call { getToday() }`:
  - success: `today` = the answer, `refreshing` false, `error` null;
  - `CancellationException`: `refreshing` false, then rethrow;
  - `SignedOutException`: only `refreshing` false (the app goes to the sign-in screen by itself);
  - `ApiException`: `refreshing` false, error `Something went wrong on the server. Pull down to try again.`;
  - any other exception: `refreshing` false, error `Can't reach Screen Time. Check the internet connection.`
  
  The last answer stays on screen when a later try fails.
- `fun clear()`: back to `TodayState()`, called after a sign-out so the next parent never sees the last one's kids.

### 6.12 `today/TodayScreen.kt`

`@Composable fun TodayScreen(vm: TodayViewModel)`.

**Loading.** While the app is on screen, load every 30 seconds:

```kotlin
val lifecycle = LocalLifecycleOwner.current.lifecycle
LaunchedEffect(lifecycle) {
    lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        while (true) {
            vm.load()
            delay(REFRESH_MS)
        }
    }
}
```

So it loads at once when Today shows, stops when the app is in the background, and loads again when it comes back.

**Layout**, a `Column` filling the screen:

1. `ScreenHeader("Today", <dayTitle(today.date), or null before the first answer>)` (6.13).
2. A Material 3 `PullToRefreshBox` (package `androidx.compose.material3.pulltorefresh`; it needs `@OptIn(ExperimentalMaterial3Api::class)`) filling the rest, `isRefreshing = state.refreshing`, `onRefresh` launching `vm.load(pulled = true)` in a `rememberCoroutineScope()`. In it, one of:
   - no answer yet and no error: a `CircularProgressIndicator` in the centre;
   - no answer yet and an error: a column filling the box, **scrollable** (so pulling down still works), 24 dp padding, centred: 96 dp space, the error in `bodyLarge` `muted`, centred; 16 dp; a `FilledTonalButton` `Try again` that launches `vm.load(pulled = true)`;
   - an answer: a `LazyColumn` filling the box, content padding 16 dp left, right and bottom (none on top: the header has it), 12 dp between items:
     - when there is an error: first an item with the error in `bodyMedium`, `critical` colour;
     - when `today.kids` is empty: an item `No kids yet. Add them in the Screen Time web app.` in `bodyLarge` `muted`;
     - one `KidCard` per kid (`key` = the kid's id). Work out `Instant.now()` once per composition and pass it to every card.

**Kid card**: a Material 3 `Card`, full width, shape `MaterialTheme.shapes.medium` (16 dp corners), container colour `colorScheme.surface`, a 1 dp `outline` border (`BorderStroke`). Inside, 16 dp padding, a column:

- A row, centred vertically: the **avatar**, a 40 dp circle in the kid's colour with `initial(kid.name)` in `titleMedium`, `FontWeight.Bold`, `Color.White` in its centre; 12 dp; the name in `titleLarge`, `FontWeight.SemiBold`, `onSurface`. The kid's colour: `AvatarColors[kid.avatarColor.ordinal]` (the 8 colours are in the same order in both), falling back to `AvatarColors[0]` (`getOrElse`).
- For each pool, in the server's order: 16 dp, then the **pool row** of `poolView(pool)`.
- When `kidChips(kid, now)` is not empty: 16 dp, then a `FlowRow` (`androidx.compose.foundation.layout.FlowRow`) with 8 dp between chips both ways.

**Pool row**, a column:

- A full-width row, centred vertically: the pool name in `bodyLarge`, `FontWeight.Medium`, `onSurface`, taking the free width (`weight(1f)`); the status in `bodyLarge`, `FontWeight.SemiBold`, in the tone colour.
- 6 dp; the **bar**: full width, 8 dp high, fully rounded (`clip(CircleShape)`), `surfaceVariant`; inside it, when `fraction` > 0, a fully rounded box of `fillMaxWidth(fraction)` and full height in the tone colour.
- 4 dp; the detail in `bodySmall`, `muted`.

Tone colours: `OK` `colorScheme.primary`, `WARNING` `warning`, `CRITICAL` `critical`, `LOCKED` `muted`.

**Chip**: the text in `labelMedium` with 12 dp padding left and right and 6 dp top and bottom, on a fully rounded background (`RoundedCornerShape(50)`): `NEUTRAL` text `onSurface` on `surfaceVariant`; `PRIMARY` text `primary` on `primary` at 12% (`copy(alpha = 0.12f)`); `WARNING` text `warning` on `warning` at 15%.

### 6.13 `home/HomeScreen.kt`

- `enum class Tab(val label: String, @param:DrawableRes val icon: Int)` with, in this order, `TODAY("Today", R.drawable.ic_today)`, `INBOX("Inbox", R.drawable.ic_inbox)`, `KIDS("Kids", R.drawable.ic_kids)`, `SETTINGS("Settings", R.drawable.ic_settings)`. (`@param:DrawableRes` puts the annotation on the constructor parameter; Kotlin 2.4 warns without the `param:`.)
- `@Composable fun HomeScreen(me: Me, today: TodayViewModel, secure: Boolean, onSignOut: () -> Unit)`: the open tab in `rememberSaveable { mutableStateOf(Tab.TODAY) }`. A Material 3 `Scaffold` with `containerColor = colorScheme.background` and as `bottomBar` a `NavigationBar` (`containerColor = colorScheme.surface`) with one `NavigationBarItem` per tab: its icon (`Icon(painterResource(tab.icon), contentDescription = null)`) and its label. The content, in a `Box` with the Scaffold's padding:
  - Today: `TodayScreen(today)`;
  - Inbox: the coming-soon page with `Inbox` and `Time requests, messages and events will show here.`;
  - Kids: the coming-soon page with `Kids` and `Schedules, devices and contacts will show here. Use the web app for now.`;
  - Settings: `SettingsScreen(me, secure, onSignOut)`.
- `@Composable fun ScreenHeader(title: String, subtitle: String? = null)`: the title of a tab. A column with padding 16 dp left and right, 24 dp top, 16 dp bottom: the title in `headlineMedium`, `FontWeight.SemiBold`, `onBackground`; under it, when given, the subtitle in `bodyLarge` `muted`.
- The coming-soon page (private): a column filling the screen: `ScreenHeader(title)`, then the line in `bodyLarge` `muted` with 16 dp padding left and right.
- `@Composable fun NoFamilyScreen(me: Me, onSignOut: () -> Unit)`: for a sign-in that has no family (the super admin only, docs/SPEC.md §6.2). The whole screen `background`, `safeDrawingPadding()`, 24 dp padding, centred both ways: `No family here` in `headlineSmall` `SemiBold` `onBackground`; 8 dp; `This sign-in is the super admin only. Set up families in the Screen Time web app.` in `bodyLarge` `muted`, centred; 32 dp; an `OutlinedButton` `Sign out`, full width, at least 48 dp high, calling `onSignOut`.

### 6.14 `home/SettingsScreen.kt`

`@Composable fun SettingsScreen(me: Me, secure: Boolean, onSignOut: () -> Unit)`. A scrollable column filling the screen: `ScreenHeader("Settings")`, then a column with 16 dp padding left and right and 12 dp between its items:

1. A settings card `Signed in as`: the parent's `displayName` in `titleMedium` `SemiBold` `onSurface`; their `email` in `bodyMedium` `muted`; the family's `name` in `bodyMedium` `muted` (only when there is a family).
2. A settings card `App lock`: in `bodyMedium` `onSurface`, when `secure`: `The app locks when you have been away from it for 5 minutes. Open it with your fingerprint or this phone's PIN.`, else: `This phone has no screen lock, so the app can't lock itself. Set a PIN in the phone's settings.`
3. An `OutlinedButton` `Sign out`, full width, at least 48 dp high. It does not sign out: it opens the confirm dialog.
4. `Version <BuildConfig.VERSION_NAME>` (shows `Version 0.1.0`) in `bodySmall` `muted`, full width, centred, 16 dp padding below.

A **settings card** (private): like the kid card (full width, `shapes.medium`, `surface`, 1 dp `outline` border), 16 dp padding, a column with 2 dp between items: the label in `labelMedium` `muted`, then the card's content.

The **confirm dialog**, a Material 3 `AlertDialog` while a `remember { mutableStateOf(false) }` is true: title `Sign out of Screen Time?`, text `You'll need a new code from your email to sign in again.`, confirm `TextButton` `Sign out` (closes the dialog, then calls `onSignOut`), dismiss `TextButton` `Cancel` (closes it). Tapping outside closes it too.

### 6.15 `MainActivity.kt`

Replace the placeholder. `class MainActivity : ComponentActivity()` with `by viewModels()` for a `SignInViewModel` and a `TodayViewModel`, and the session from `ParentApp`.

- `onCreate`: `enableEdgeToEdge()`, then `setContent`: collect `session.state` and `AppLock.locked` (`collectAsState()`); when the state becomes `SignedOut`, call `today.clear()` (`LaunchedEffect(state)`); inside `ScreenTimeTheme { }` show:
  - `SignedOut`: `SignInScreen(signIn)`;
  - `SignedIn` and locked: `LockScreen(onUnlock = <ask to unlock>)`;
  - `SignedIn` and `me.family` is null: `NoFamilyScreen(me, <sign out>)`;
  - else `HomeScreen(me, today, secure = <is secure>, <sign out>)`.
- `onStart`: after `super.onStart()`, `AppLock.opened(SystemClock.elapsedRealtime(), <is secure>)`.
- `onStop`: `AppLock.left(SystemClock.elapsedRealtime())`, then `super.onStop()`.
- **Is secure**: `getSystemService(BiometricManager::class.java).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS`, with `AUTHENTICATORS = Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL`. These are the **framework** classes `android.hardware.biometrics.BiometricManager` and `android.hardware.biometrics.BiometricPrompt`, not AndroidX.
- **Ask to unlock**: if a prompt is already showing (a private `prompting` flag), do nothing. If not secure, `AppLock.unlock()` and stop. Else set `prompting`, and show:
  ```kotlin
  BiometricPrompt.Builder(this)
      .setTitle("Unlock Screen Time")
      .setAllowedAuthenticators(AUTHENTICATORS)
      .build()
      .authenticate(CancellationSignal(), mainExecutor, callback)
  ```
  The callback (`BiometricPrompt.AuthenticationCallback`): `onAuthenticationSucceeded`: clear `prompting`, log `unlocked` (tag `MainActivity`, `Log.i`), `AppLock.unlock()`. `onAuthenticationError(errorCode, errString)`: clear `prompting`, log `unlock stopped: <errorCode>` (`Log.i`); the lock screen stays. Do not override `onAuthenticationFailed` (a wrong finger: the prompt stays up and lets the parent try again). Do not call `setNegativeButton`: Android does not allow it together with `DEVICE_CREDENTIAL`, and the prompt has its own cancel.
- **Sign out**: `lifecycleScope.launch { session.signOut() }`.

The log lines `unlocked` and `unlock stopped` are what the emulator run reads (8.2). Log nothing else about the sign-in, and never a token, a code or an email.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-040-parent-sign-in
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-040-parent-sign-in.md` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Copy the files of section 5. Write the files of section 6, in the order of the section (each one only uses the ones before it, except `TodayScreen` and `HomeScreen`, which use each other). Build and test:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat assembleDebug test
   cd ..
   ```
   Until it passes, fix **your** code, never the tests or the copied files. Commit: `CARD-040: Parent app sign-in, app lock and Today`.
3. Run the acceptance checks in section 8, including the emulator run (8.2), in this session. If the emulator run shows a problem in your code, fix it, build and test again, commit (`CARD-040: <what you fixed>`), and run the emulator run again from step 1.
4. Push and open the PR (section 10).
5. Wait for the CI check to finish (`gh pr checks <number> --watch`).
6. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token, refresh or access token, or sign-in code in the PR or the handback. The throwaway `local-dev-only-…` values and the PIN `1234` below are fine.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`, with no compiler warning in the `app-parent` files (paste any `w:` lines under "Deviations").
- [ ] The tests really ran. From `android`, this prints four lines:
  ```powershell
  Select-String -Path app-parent\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.parent.auth.SessionTest tests="9" failures="0" errors="0"
  au.screentime.parent.auth.SignInTest tests="4" failures="0" errors="0"
  au.screentime.parent.lock.AppLockTest tests="3" failures="0" errors="0"
  au.screentime.parent.today.TodayViewTest tests="9" failures="0" errors="0"
  ```
- [ ] The tests and the copied files are unchanged: Claude compares every one of them byte for byte with this card.

### 8.2 On the emulator

Run every step below **in this session**, one after another without long breaks, exactly as written, and paste the **real terminal output** of each step into the handback. A summary is not accepted. If your context was summarised partway through, run the steps again from step 1. Paste any extra command you ran, with its output, under "Deviations". **Never do this run on a real phone.**

**The emulator.** Use `Medium_Phone_API_37.0`, wiped or not; no wipe is needed for this card. The parent app is not Device Owner. Start it, and when `& $adb devices` lists exactly one `emulator-5554   device` and `& $adb shell getprop sys.boot_completed` prints `1`:

```powershell
& $adb shell am task lock stop
& $adb uninstall au.screentime.parent
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
& $adb shell svc wifi enable
& $adb shell svc data enable
& $adb shell locksettings set-pin 1234
& $adb shell locksettings get-disabled
```

The first two may print an error; that is fine. `set-pin` prints `Pin set to '1234'`. If it says a PIN is already set, run `& $adb shell locksettings clear --old 1234` first, then `set-pin` again; if that fails too, wipe the emulator (`emulator -avd Medium_Phone_API_37.0 -wipe-data`) and start again. `get-disabled` prints `false`.

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). The `deploy\.env` has no SMTP values, so the server writes sign-in codes to its log:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pnpm --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex 120 150
pnpm --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam 120 0
```

`seed-dev.ts` prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` The two `dev-bedtime.ts` give Alex 150 minutes of each pool today and Sam none. If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`. Do the run between 6 am and 9:30 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Screen-Text` prints every piece of text on the screen, joined with ` | `. `Code` prints the newest sign-in code for dad@example.com from the server's log. `Hide-Keyboard` closes the on-screen keyboard if it is open. `Sessions` prints the server's sign-ins. `Stored` prints what the app keeps in `shared_prefs/session.xml` without printing the token: whether it is there, its length and whether it has the `iv.ciphertext` shape. `AppLog` prints the app's `unlocked` and `unlock stopped` lines since the last `AppLog`, then clears the log.

```powershell
function Dump-Ui {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml](Get-Content "$t\ui.xml" -Raw -Encoding UTF8)
}
function Screen-Text {
  $ui = Dump-Ui
  ($ui.SelectNodes('//node') | Where-Object { $_.text } | ForEach-Object { $_.text }) -join ' | '
}
function Tap-Text([string]$text, [int]$wait = 2) {
  $ui = Dump-Ui
  $node = $ui.SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -Last 1
  if (-not $node) { throw "No '$text' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds $wait
}
function Hide-Keyboard {
  if (& $adb shell dumpsys input_method | Select-String 'mInputShown=true') {
    & $adb shell input keyevent KEYCODE_BACK
    Start-Sleep -Seconds 1
  }
}
function Shot([string]$name) {
  & $adb shell screencap -p /sdcard/shot.png
  & $adb pull /sdcard/shot.png "$t\$name.png" | Out-Null
}
function Open-App {
  & $adb shell am start -n au.screentime.parent/.MainActivity | Out-Null
  Start-Sleep -Seconds 3
}
function Code {
  $line = docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api | Select-String 'sign-in code for dad@example.com is (\d{6})' | Select-Object -Last 1
  $line.Matches[0].Groups[1].Value
}
function Sessions {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select client, client_label, revoked_at is not null as revoked from parent_sessions order by created_at"
}
function Stored {
  $xml = (& $adb exec-out run-as au.screentime.parent cat shared_prefs/session.xml) -join "`n"
  $token = [regex]::Match($xml, '<string name="refreshToken">([^<]*)</string>').Groups[1].Value
  $me = $xml -match '<string name="me">'
  "refreshToken: length {0}, iv.ciphertext shape: {1}, me saved: {2}" -f $token.Length, ($token -match '^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'), $me
}
function AppLog {
  & $adb logcat -d -s MainActivity:I | Select-String 'unlocked|unlock stopped' | ForEach-Object { $_.Line.Trim() }
  & $adb logcat -c
}
```

**The run.** From `android`, one step at a time; check each expected result before the next step.

1. Install and open:
   ```powershell
   & $adb install -r app-parent\build\outputs\apk\debug\app-parent-debug.apk
   & $adb logcat -c
   Open-App
   Shot "1-signin"
   Screen-Text
   ```
   `install` prints `Success`. `1-signin` shows the sign-in screen: the teal circle with the white hourglass, "Screen Time", "Parent sign-in", the **Email** field and a full-width **Send code** pill. `Screen-Text` has `Screen Time | Parent sign-in | Email | Send code` (the field's label may come in another place in the list).
2. An email that is not one, then the right one:
   ```powershell
   Tap-Text "Email"
   & $adb shell input text "dad"
   Hide-Keyboard
   Tap-Text "Send code"
   Screen-Text
   Tap-Text "dad"
   & $adb shell input keyevent KEYCODE_MOVE_END
   & $adb shell input text "@example.com"
   Hide-Keyboard
   Tap-Text "Send code" 4
   Shot "2-code"
   Screen-Text
   ```
   The first `Screen-Text` has `Enter your email address, like name@example.com.` The second has `We emailed a 6-digit code to dad@example.com. It works for 10 minutes. | Code | Sign in | Send a new code | Use a different email`. `2-code` shows that step: the sentence centred, the **Code** field, the **Sign in** pill and the two text buttons under it.
3. A wrong code:
   ```powershell
   Code
   Tap-Text "Code"
   & $adb shell input text "000000"
   Hide-Keyboard
   Tap-Text "Sign in" 4
   Shot "3-wrong-code"
   Screen-Text
   Sessions
   ```
   `Code` prints 6 digits (do not paste them into the handback: write `<6 digits>`). If they are `000000`, run step 2 from `Tap-Text "Send code" 4` again instead (one in a million). `3-wrong-code` shows the code step with the field in red and `That code didn't work. Check it, or send a new code.` in red under it; `Screen-Text` has that line. `Sessions` prints `(0 rows)`.
4. The right code, with Alex busy on a PC:
   ```powershell
   pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-usage.ts Alex 140
   $code = Code
   Tap-Text "000000"
   & $adb shell input keyevent KEYCODE_MOVE_END
   1..6 | ForEach-Object { & $adb shell input keyevent KEYCODE_DEL }
   & $adb shell input text $code
   Hide-Keyboard
   Tap-Text "Sign in" 6
   Shot "4-today"
   Screen-Text
   Sessions
   Stored
   AppLog
   ```
   `dev-usage.ts` prints `Alex has been using "alex on Dev PC" for 140 min, and still is.` `4-today` shows Today, with **no** lock screen in between (the code was enough), and the bottom bar with Today selected: "Today" and today's date ("Wednesday 28 October" style) at the top; a card for **Alex** (teal circle with "A"): Screens `Nm left` in **amber** (N from 5 to 10; orange if it is 5 or less) with a short amber bar and `2h 20m used of 2h 30m` (or a minute more), Phone `2h 30m left` in teal with a full teal bar and `Nothing used of 2h 30m`, and a teal chip `Using alex on Dev PC now`; a card for **Sam** (violet circle with "S"): both pools `Locked · out of time` in grey with empty bars and `No time today`. `Screen-Text` has all of these words. `Sessions` has one row: `android | <the emulator's model, like sdk_gphone64_x86_64> | f`. `Stored` prints `refreshToken: length` 50 or more, `iv.ciphertext shape: True`, `me saved: True`. `AppLog` prints nothing.
5. Today asks the server again every 30 seconds:
   ```powershell
   pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-grant.ts Alex screens 30
   Start-Sleep -Seconds 35
   Shot "5-today-later"
   Screen-Text
   ```
   `dev-grant.ts` prints `Added 30 min of screens for Alex today, as Dad.` Without touching the app, `5-today-later` shows Alex's Screens at `3Nm left` (about 30 minutes more than in step 4) in **teal**, and `… used of 3h`. `Screen-Text` has `used of 3h`.
6. The other tabs:
   ```powershell
   Tap-Text "Inbox"
   Screen-Text
   Tap-Text "Kids"
   Screen-Text
   Tap-Text "Settings"
   Shot "6-settings"
   Screen-Text
   ```
   The first `Screen-Text` has `Inbox | Time requests, messages and events will show here.`, the second `Kids | Schedules, devices and contacts will show here. Use the web app for now.`, both with `Today | Inbox | Kids | Settings` from the bottom bar. `6-settings` shows Settings: the "Signed in as" card (Dad, dad@example.com, Dev family), the "App lock" card, the **Sign out** outlined pill and "Version 0.1.0". `Screen-Text` has `Signed in as | Dad | dad@example.com | Dev family | App lock | The app locks when you have been away from it for 5 minutes. Open it with your fingerprint or this phone's PIN. | Sign out | Version 0.1.0`.
7. A fresh start locks; the PIN opens it:
   ```powershell
   & $adb shell am force-stop au.screentime.parent
   Open-App
   Shot "7-lock-prompt"
   Screen-Text
   & $adb shell input text 1234
   & $adb shell input keyevent KEYCODE_ENTER
   Start-Sleep -Seconds 3
   Screen-Text
   AppLog
   ```
   `7-lock-prompt` shows Android's own prompt titled "Unlock Screen Time" asking for the PIN, over (or instead of) the app's lock screen. The first `Screen-Text` has `Unlock Screen Time`. After the PIN, the second `Screen-Text` has `Today` and `Alex` and no `Screen Time is locked`. `AppLog` has `unlocked`.
8. Cancel the prompt, then **Unlock**:
   ```powershell
   & $adb shell am force-stop au.screentime.parent
   Open-App
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   Shot "8-locked"
   Screen-Text
   Tap-Text "Unlock" 3
   & $adb shell input text 1234
   & $adb shell input keyevent KEYCODE_ENTER
   Start-Sleep -Seconds 3
   Screen-Text
   AppLog
   ```
   `8-locked` shows the app's lock screen: the hourglass circle, "Screen Time is locked", the line under it and the **Unlock** pill. The first `Screen-Text` has `Screen Time is locked | Use your fingerprint or this phone's PIN to open it. | Unlock`. The second has `Today` and no `Screen Time is locked`. `AppLog` has `unlock stopped: 10` (10 is "cancelled by the user"; another number is fine, paste it) and then `unlocked`.
9. Away 1 minute: still open. Away 5 minutes: locked.
   ```powershell
   & $adb shell input keyevent KEYCODE_HOME
   Start-Sleep -Seconds 60
   Open-App
   Screen-Text
   & $adb shell input keyevent KEYCODE_HOME
   Start-Sleep -Seconds 305
   Open-App
   Screen-Text
   & $adb shell input text 1234
   & $adb shell input keyevent KEYCODE_ENTER
   Start-Sleep -Seconds 3
   AppLog
   ```
   The first `Screen-Text` has `Today` and no `Unlock Screen Time` (1 minute is not enough). The second has `Unlock Screen Time`. `AppLog` has `unlocked` once.
10. Sign out:
    ```powershell
    Tap-Text "Settings"
    Tap-Text "Sign out"
    Screen-Text
    Tap-Text "Sign out" 4
    Screen-Text
    Sessions
    Stored
    ```
    The first `Screen-Text` has `Sign out of Screen Time? | You'll need a new code from your email to sign in again. | Cancel | Sign out` (the dialog; the order may differ). After the second `Sign out`, the second `Screen-Text` is the sign-in screen's email step with `dad@example.com` in the field: `Screen Time | Parent sign-in | ... | dad@example.com | Send code`. `Sessions` shows the one row with `revoked` `t`. `Stored` prints `refreshToken: length 0, iv.ciphertext shape: False, me saved: False` (or a `No such file` error: also fine).
11. Undo, so the emulator can be used again:
    ```powershell
    & $adb uninstall au.screentime.parent
    & $adb shell locksettings clear --old 1234
    & $adb shell settings put system screen_off_timeout 60000
    cd ..
    docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
    Remove-Item Env:DATABASE_URL
    Remove-Item Env:JWT_SECRET
    ```
    `uninstall` prints `Success`; `clear` prints `Lock credential cleared`.

- [ ] Steps 1 to 11 gave the expected results, run in this session. Paste the real output of every helper and command in steps 1 to 10 into the handback (`Screen-Text`, `Code` as `<6 digits>`, `Sessions`, `Stored`, `AppLog`, and the scripts' lines).
- [ ] The eight screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c40\`: `1-signin.png`, `2-code.png`, `3-wrong-code.png`, `4-today.png`, `5-today-later.png`, `6-settings.png`, `7-lock-prompt.png`, `8-locked.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/app-parent/` changed except `server/scripts/dev-usage.ts`.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png` or `.xml` from the temp folder.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 30 files:
  ```
  android/app-parent/build.gradle.kts
  android/app-parent/src/debug/AndroidManifest.xml
  android/app-parent/src/debug/res/xml/network_security_config.xml
  android/app-parent/src/main/AndroidManifest.xml
  android/app-parent/src/main/kotlin/au/screentime/parent/AppMark.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/MainActivity.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/ParentApp.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/auth/PrefsTokenStore.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/auth/Session.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/auth/SignIn.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/auth/SignInScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/auth/SignInViewModel.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/home/HomeScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/home/SettingsScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/lock/AppLock.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/lock/LockScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/today/TodayScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/today/TodayView.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/today/TodayViewModel.kt
  android/app-parent/src/main/res/drawable/ic_hourglass.xml
  android/app-parent/src/main/res/drawable/ic_inbox.xml
  android/app-parent/src/main/res/drawable/ic_kids.xml
  android/app-parent/src/main/res/drawable/ic_settings.xml
  android/app-parent/src/main/res/drawable/ic_today.xml
  android/app-parent/src/main/res/xml/data_extraction_rules.xml
  android/app-parent/src/test/kotlin/au/screentime/parent/auth/SessionTest.kt
  android/app-parent/src/test/kotlin/au/screentime/parent/auth/SignInTest.kt
  android/app-parent/src/test/kotlin/au/screentime/parent/lock/AppLockTest.kt
  android/app-parent/src/test/kotlin/au/screentime/parent/today/TodayViewTest.kt
  server/scripts/dev-usage.ts
  ```

## 9. Tests

The four test files are copied (5.6 to 5.9) and must pass **unchanged**: 25 tests.

| Suite | Tests | Checks |
|---|---|---|
| `SessionTest` | 9 | starting signed in or out; the code sign-in as `android` with the phone's name; a swap before the first call; the one-minute margin; a 401 swaps and tries once more; three calls at once swap once; a refused refresh token signs out; no connection or a 500 keeps the sign-in; sign out tells the server and forgets, also offline |
| `SignInTest` | 4 | the email cleaned; what looks like an email; the code's 6 digits; each error's words |
| `AppLockTest` | 3 | a fresh start locks; 5 minutes away locks, less does not; leaving, coming back, `unlock()` and a phone with no screen lock |
| `TodayViewTest` | 9 | time left, used and of what; the 15 and 5 minute colours; why a pool is locked; no time today; the bar's limits; the chips and their order; parent mode, offline and in-use rules; a device in both pools and overspend; the date and the initial |

The other suites of the project are unchanged and must still pass. The screens are checked by the emulator run in 8.2.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit (step 2). Message format: `CARD-040: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-040-parent-sign-in`
5. Open a PR into `main` titled `CARD-040: Parent app sign-in, app lock and Today`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (create the folder first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-040-parent-sign-in --title "CARD-040: Parent app sign-in, app lock and Today" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-040-parent-sign-in.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`, no app-parent warnings
   - [x] tests ran — output: four suites, 25 tests, all `failures="0"`
   - [x] tests and copied files unchanged
   - [x] emulator run steps 1 to 11 — results as expected
   - [x] eight screenshots in C:\Users\james\OpenCode\Testing\temp\c40\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 30 files

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

- **A test fails**: fix your code until it passes. Never change a test, never skip one, never add `@Disabled`. Read the test: it says exactly what is expected. If you are sure a test contradicts this card, quote both under "Blockers / questions" and stop.
- **`Unresolved reference: repeatOnLifecycle`, `lifecycleScope` or `LocalLifecycleOwner`**: check the imports: `androidx.lifecycle.repeatOnLifecycle`, `androidx.lifecycle.lifecycleScope`, `androidx.lifecycle.compose.LocalLifecycleOwner` (not `androidx.compose.ui.platform.LocalLifecycleOwner`, which is deprecated). Do **not** add a dependency for them; Claude's build of this card has none.
- **`FlowRow` is experimental** (`ExperimentalLayoutApi`): with Compose BOM 2026.09.00 it is not; if your build says it is, add `@OptIn(ExperimentalLayoutApi::class)` on the function and say so under "Deviations".
- **`SessionTest` `callsAtTheSameTimeSwapTheTokensOnce` fails with 2 or 3 refreshes**: the swap's first rule (6.2, "Swap", step 1) is missing, or the check happens outside the `Mutex`.
- **`SessionTest` `noConnectionOrAnotherErrorKeepsTheSignIn` fails**: something catches every exception during the swap and signs out. Only an `ApiException` with status 401 signs out.
- **Step 2: `Tap-Text "Email"` says `No 'Email' on screen`**: paste `Screen-Text` and stop.
- **Step 2: `Tap-Text "dad"` fails**: the field shows the text in another node. Use `Tap-Text "Email"` instead (the label moves up but stays a node) and say so under "Deviations".
- **Step 3 or 4: `Code` prints nothing**: paste `docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api --tail 20` with every 6-digit number replaced by `<6 digits>`, and stop.
- **Step 4: "That code didn't work" with the code from `Code`**: the code is from before the last `down -v`, was used already, is older than 10 minutes, or the field still had `000000` in it (paste `Screen-Text`). Go back to step 2's `Tap-Text "Send code" 4`: on the code step it is called `Send a new code` now, so run `Tap-Text "Send a new code" 4`, then step 4 from `$code = Code`. Never type a code twice.
- **Step 4: `Can't reach Screen Time`**: paste `curl.exe -s http://localhost:8080/health` and `& $adb shell ping -c 1 10.0.2.2`, and stop. Check that you installed the **debug** APK.
- **Step 4: the lock screen shows instead of Today**: `verify()` does not call `AppLock.unlock()` (6.5). Fix and run again.
- **Step 4: Today shows Alex's Screens at more than 10m left**: `dev-usage.ts` ran twice, or `dev-bedtime.ts` did not run. Run `down -v` and the server block again, then the run from step 1.
- **Step 5: Screens did not change after 35 seconds**: paste `& $adb logcat -d | Select-String 'okhttp|Ktor|today' | Select-Object -Last 10` and stop.
- **Step 7: no prompt and Today shows at once**: `Stored` and the PIN: run `& $adb shell locksettings get-disabled` (must print `false`) and paste it; if the PIN is set, the lock rule in `onStart` or `opened` is wrong.
- **Step 7: `Unlock Screen Time` is not in `Screen-Text`, but the screenshot shows the prompt**: that is fine; say so under "Deviations".
- **Step 7 or 8: the PIN is typed but the prompt stays**: run `& $adb shell input keyevent KEYCODE_ENTER` once more, then `Screen-Text`; paste both.
- **Step 9: the second `Screen-Text` has `Today` (no lock after 5 minutes)**: paste the step's output and stop.
- **`Hide-Keyboard` closed the app** (the screen shows the launcher): the keyboard was already closed and BACK left the app. Run `Open-App` and go on, and say so under "Deviations".
- **`Bedtime` / `dev-bedtime.ts` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **Never tap Emergency 000**, never run this on a real phone, and never install a release build.
- **Temporary files** (the PR body, `ui.xml`, the screenshots, any helper scripts) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **Every difference from the card is a deviation**: a copied file that differs, a name, a word on screen, a size or colour, a different way of running a check. List each one under "Deviations". If you explain why something happened, say whether you checked it or are guessing.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-040. Please review and merge if it is good.

CARD: CARD-040 Parent app sign-in, app lock and Today
PR: <full PR URL>
Branch: bob/card-040-parent-sign-in
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
