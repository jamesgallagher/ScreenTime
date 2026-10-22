# CARD-004: Android Gradle skeleton

| Field | Value |
|---|---|
| Card | CARD-004 |
| Title | Android Gradle skeleton |
| Size | M |
| Depends on | CARD-001 (merged to `main`) |
| Spec sections | docs/SPEC.md §4.1, §5, §12.1 (minSdk), §16.1 (design tokens) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-004-android-skeleton` |
| PR title | `CARD-004: Android Gradle skeleton` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

So far the repo has the TypeScript parts (`packages/schemas`, `packages/engine`, `server`) and a TypeScript CI workflow. The `android/` folder has only a `README.md` and the **Gradle wrapper**, which is already committed for you:

```
android/gradlew
android/gradlew.bat
android/gradle/wrapper/gradle-wrapper.jar
android/gradle/wrapper/gradle-wrapper.properties   (Gradle 9.8.2)
```

**Do not regenerate, edit or delete the wrapper files.** You do not need Gradle installed; always run `.\gradlew.bat` from the `android` folder.

This card creates one Gradle project in `android/` with five modules. Later cards fill them in. This card only proves that the project builds, that both apps open a placeholder screen, and that the shared theme has the right colours.

| Module | Kind | What it is for later |
|---|---|---|
| `app-kid` | Android app, package `au.screentime.kid` | the kid enforcer app (Device Owner) |
| `app-parent` | Android app, package `au.screentime.parent` | the parent app |
| `core-ui` | Android library, namespace `au.screentime.core.ui` | Compose theme and shared components |
| `core-time` | plain Kotlin (JVM) library, package `au.screentime.core.time` | the Kotlin time engine |
| `core-model` | plain Kotlin (JVM) library, package `au.screentime.core.model` | API models and the generated API client |

## 2. Goal

`android/` is a working Gradle project. `.\gradlew.bat assembleDebug test` passes on James's PC and in a new GitHub Actions workflow, producing two debug APKs (kid and parent) that each open one placeholder screen styled with the Screen Time theme.

## 3. Out of scope

Do **not** do any of these in this card:

- No Device Owner code, no services, no permissions, no receivers, no notifications. The manifest has only the one activity.
- No networking, no Ktor, no kotlinx.serialization, no Room, no Firebase, no `google-services.json`.
- No real screens (main screen, block screen, setup). Only the placeholder screen in section 6.
- No launcher icons, no app icon resources, no `res/` folders at all. The apps use the default icon for now.
- No navigation library, no dependency injection (no Hilt, Koin), no KSP or kapt.
- No `kotlin-android` plugin (`org.jetbrains.kotlin.android`). AGP 9 compiles Kotlin by itself ("built-in Kotlin"); adding that plugin breaks the build.
- No Android instrumented tests (`androidTest`), no Espresso, no Robolectric.
- No signing config, no release builds, no ProGuard/R8 rules.
- No lint configuration, no ktlint, no detekt.
- Do not change the Gradle wrapper, any TypeScript file, `docs/`, or `AGENTS.md`.

## 4. Tech and versions

Use **exactly** these versions. Do not upgrade or downgrade any of them, even if Android Studio suggests it.

| Item | Version |
|---|---|
| Gradle (from the committed wrapper) | 9.8.2 |
| Android Gradle Plugin (AGP) | 9.4.0 |
| Kotlin (Kotlin JVM plugin and Compose compiler plugin) | 2.4.21 |
| Compose BOM | 2026.09.00 |
| `androidx.activity:activity-compose` | 1.13.0 |
| JUnit (BOM) | 6.1.3 |
| Java bytecode target | 17 |
| `compileSdk` / `targetSdk` | 36 |
| `minSdk` | 34 (Android 14) |

### Tools James must install first

1. **Android Studio** (current stable) from https://developer.android.com/studio. Open it once and finish the setup wizard (Standard install). This installs the Android SDK to `C:\Users\james\AppData\Local\Android\Sdk` and a Java runtime (JBR, Java 21) to `C:\Program Files\Android\Android Studio\jbr`.
2. In Android Studio: **More Actions › SDK Manager › SDK Platforms**, tick **Android 16 (API 36)** (named "Android 16.0 (Baklava)" or similar), then **Apply**. Accept the licences.

### Check the tools (PowerShell)

```powershell
Test-Path "C:\Program Files\Android\Android Studio\jbr\bin\java.exe"
Test-Path "$env:LOCALAPPDATA\Android\Sdk\platforms\android-36"
```

Both must print `True`. If either prints `False`, stop and ask James to do the install steps above.

### Set Java for this terminal

Gradle needs `JAVA_HOME`. In **every new PowerShell window** where you run Gradle, first run:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

Check: `& "$env:JAVA_HOME\bin\java.exe" -version` prints a version starting with `21`.

## 5. Files

Create the files below with **exactly** these contents. Paths are relative to the repo root. Kotlin files use 4-space indentation (`.editorconfig` already says so).

Final tree (the four wrapper files already exist):

```
android/
├── README.md                          (replace, 5.16)
├── build.gradle.kts                   (5.3)
├── gradle.properties                  (5.4)
├── settings.gradle.kts                (5.1)
├── gradle/
│   ├── libs.versions.toml             (5.2)
│   └── wrapper/...                    (already there, do not touch)
├── gradlew, gradlew.bat               (already there, do not touch)
├── core-time/
│   ├── build.gradle.kts               (5.5)
│   └── src/
│       ├── main/kotlin/au/screentime/core/time/DurationFormat.kt       (5.6)
│       └── test/kotlin/au/screentime/core/time/DurationFormatTest.kt   (5.7)
├── core-model/
│   ├── build.gradle.kts               (5.5, same as core-time)
│   └── src/
│       ├── main/kotlin/au/screentime/core/model/Pool.kt                (5.8)
│       └── test/kotlin/au/screentime/core/model/PoolTest.kt            (5.9)
├── core-ui/
│   ├── build.gradle.kts               (5.10)
│   └── src/main/
│       ├── AndroidManifest.xml        (5.11)
│       └── kotlin/au/screentime/core/ui/
│           ├── Colors.kt              (5.12)
│           ├── Theme.kt               (5.13)
│           └── PlaceholderScreen.kt   (5.14)
├── app-kid/
│   ├── build.gradle.kts               (5.15)
│   └── src/main/
│       ├── AndroidManifest.xml        (5.15)
│       └── kotlin/au/screentime/kid/MainActivity.kt                    (5.15)
└── app-parent/
    ├── build.gradle.kts               (5.15)
    └── src/main/
        ├── AndroidManifest.xml        (5.15)
        └── kotlin/au/screentime/parent/MainActivity.kt                 (5.15)
```

Plus one workflow file at the repo root: `.github/workflows/android.yml` (5.17).

Note the source folders are `src/main/kotlin/...` (not `src/main/java/...`).

### 5.1 `android/settings.gradle.kts`

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ScreenTime"

include(":app-kid")
include(":app-parent")
include(":core-ui")
include(":core-time")
include(":core-model")
```

### 5.2 `android/gradle/libs.versions.toml`

```toml
[versions]
agp = "9.4.0"
kotlin = "2.4.21"
composeBom = "2026.09.00"
activityCompose = "1.13.0"
junit = "6.1.3"

[libraries]
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
junit-bom = { group = "org.junit", name = "junit-bom", version.ref = "junit" }
junit-jupiter = { group = "org.junit.jupiter", name = "junit-jupiter" }
junit-platform-launcher = { group = "org.junit.platform", name = "junit-platform-launcher" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
```

### 5.3 `android/build.gradle.kts`

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
```

### 5.4 `android/gradle.properties`

```properties
org.gradle.jvmargs=-Xmx4g -Dfile.encoding=UTF-8
org.gradle.caching=true
kotlin.code.style=official
```

### 5.5 `android/core-time/build.gradle.kts` and `android/core-model/build.gradle.kts`

Both files have exactly this content:

```kotlin
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
}
```

### 5.6 `android/core-time/src/main/kotlin/au/screentime/core/time/DurationFormat.kt`

```kotlin
package au.screentime.core.time

/**
 * Formats a duration for people, as in docs/SPEC.md §16.1:
 * "1h 12m", "45m", "2h", or "less than a minute".
 * Seconds are rounded down to whole minutes. Zero or negative gives "less than a minute".
 */
fun formatDuration(seconds: Long): String {
    val totalMinutes = seconds / 60
    if (totalMinutes < 1) return "less than a minute"
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    return when {
        hours == 0L -> "${minutes}m"
        minutes == 0L -> "${hours}h"
        else -> "${hours}h ${minutes}m"
    }
}
```

### 5.7 `android/core-time/src/test/kotlin/au/screentime/core/time/DurationFormatTest.kt`

```kotlin
package au.screentime.core.time

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

class DurationFormatTest {
    @ParameterizedTest(name = "{0} s -> {1}")
    @CsvSource(
        "-5, less than a minute",
        "0, less than a minute",
        "59, less than a minute",
        "60, 1m",
        "2700, 45m",
        "3600, 1h",
        "4320, 1h 12m",
        "4379, 1h 12m",
        "36000, 10h",
    )
    fun formats(seconds: Long, expected: String) {
        assertEquals(expected, formatDuration(seconds))
    }
}
```

### 5.8 `android/core-model/src/main/kotlin/au/screentime/core/model/Pool.kt`

```kotlin
package au.screentime.core.model

/**
 * A daily pool of time for one kid (docs/SPEC.md §6).
 * [apiValue] is the exact text used in the API and the database.
 */
enum class Pool(val apiValue: String) {
    SCREENS("screens"),
    PHONE("phone");

    companion object {
        /** Returns the pool for an API value, or null if the value is unknown. */
        fun fromApiValue(value: String): Pool? = entries.firstOrNull { it.apiValue == value }
    }
}
```

### 5.9 `android/core-model/src/test/kotlin/au/screentime/core/model/PoolTest.kt`

```kotlin
package au.screentime.core.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class PoolTest {
    @Test
    fun apiValuesMatchTheSpec() {
        assertEquals("screens", Pool.SCREENS.apiValue)
        assertEquals("phone", Pool.PHONE.apiValue)
    }

    @Test
    fun fromApiValueRoundTrips() {
        for (pool in Pool.entries) {
            assertEquals(pool, Pool.fromApiValue(pool.apiValue))
        }
    }

    @Test
    fun fromApiValueReturnsNullForUnknown() {
        assertNull(Pool.fromApiValue("tablet"))
    }
}
```

### 5.10 `android/core-ui/build.gradle.kts`

```kotlin
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "au.screentime.core.ui"
    compileSdk = 36

    defaultConfig {
        minSdk = 34
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    api(platform(libs.androidx.compose.bom))
    api(libs.androidx.compose.material3)
}
```

### 5.11 `android/core-ui/src/main/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest />
```

### 5.12 `android/core-ui/src/main/kotlin/au/screentime/core/ui/Colors.kt`

These are the design tokens from docs/SPEC.md §16.1. Copy the hex values exactly.

```kotlin
package au.screentime.core.ui

import androidx.compose.ui.graphics.Color

/** Screen Time colour tokens (docs/SPEC.md §16.1). */
data class ScreenTimeColors(
    val primary: Color,
    val onPrimary: Color,
    val background: Color,
    val surface: Color,
    val surfaceVariant: Color,
    val onSurface: Color,
    val muted: Color,
    val outline: Color,
    val warning: Color,
    val critical: Color,
    val danger: Color,
    val nightTop: Color,
    val nightBottom: Color,
    val onNight: Color,
)

val LightColors = ScreenTimeColors(
    primary = Color(0xFF0F766E),
    onPrimary = Color(0xFFFFFFFF),
    background = Color(0xFFF7F7F5),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFEFEFEB),
    onSurface = Color(0xFF1C1917),
    muted = Color(0xFF57534E),
    outline = Color(0xFFD6D3D1),
    warning = Color(0xFFD97706),
    critical = Color(0xFFEA580C),
    danger = Color(0xFFDC2626),
    nightTop = Color(0xFF1E1B4B),
    nightBottom = Color(0xFF312E81),
    onNight = Color(0xFFE0E7FF),
)

val DarkColors = ScreenTimeColors(
    primary = Color(0xFF2DD4BF),
    onPrimary = Color(0xFF042F2E),
    background = Color(0xFF0C0A09),
    surface = Color(0xFF1C1917),
    surfaceVariant = Color(0xFF292524),
    onSurface = Color(0xFFF5F5F4),
    muted = Color(0xFFA8A29E),
    outline = Color(0xFF44403C),
    warning = Color(0xFFFBBF24),
    critical = Color(0xFFFB923C),
    danger = Color(0xFFF87171),
    nightTop = Color(0xFF1E1B4B),
    nightBottom = Color(0xFF312E81),
    onNight = Color(0xFFE0E7FF),
)

/** Kid avatar colours, in this order (docs/SPEC.md §16.1). */
val AvatarColors = listOf(
    Color(0xFF0F766E), // teal
    Color(0xFF7C3AED), // violet
    Color(0xFFDB2777), // pink
    Color(0xFF2563EB), // blue
    Color(0xFFEA580C), // orange
    Color(0xFF16A34A), // green
    Color(0xFFCA8A04), // gold
    Color(0xFF475569), // slate
)
```

### 5.13 `android/core-ui/src/main/kotlin/au/screentime/core/ui/Theme.kt`

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

### 5.14 `android/core-ui/src/main/kotlin/au/screentime/core/ui/PlaceholderScreen.kt`

A temporary screen that both apps show until real screens exist. It also shows four colour dots so James can check the theme by eye.

```kotlin
package au.screentime.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Centered title and subtitle, plus a row of theme colour dots. */
@Composable
fun PlaceholderScreen(title: String, subtitle: String) {
    val colors = ScreenTimeTheme.colors
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ColorDot(colors.primary)
            ColorDot(colors.warning)
            ColorDot(colors.critical)
            ColorDot(colors.danger)
        }
    }
}

@Composable
private fun ColorDot(color: Color) {
    Box(
        modifier = Modifier
            .size(24.dp)
            .background(color, CircleShape),
    )
}
```

### 5.15 The two apps

The two apps are the same except for the values in this table. Create both.

| Value | `app-kid` | `app-parent` |
|---|---|---|
| Folder | `android/app-kid` | `android/app-parent` |
| `namespace` and `applicationId` | `au.screentime.kid` | `au.screentime.parent` |
| Kotlin package / folder | `au.screentime.kid` / `src/main/kotlin/au/screentime/kid/` | `au.screentime.parent` / `src/main/kotlin/au/screentime/parent/` |
| App label (`android:label`) | `Screen Time` | `Screen Time Parent` |
| Placeholder title | `Screen Time` | `Screen Time Parent` |
| Placeholder subtitle | `Kid app. Real screens come in later cards.` | `Parent app. Real screens come in later cards.` |

The package `au.screentime.kid` must be exact: the Device Owner setup command later is `adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver`.

**`android/app-kid/build.gradle.kts`** (for `app-parent`, replace both `au.screentime.kid` with `au.screentime.parent`):

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "au.screentime.kid"
    compileSdk = 36

    defaultConfig {
        applicationId = "au.screentime.kid"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(project(":core-ui"))
    implementation(project(":core-time"))
    implementation(project(":core-model"))
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.activity.compose)
}
```

**`android/app-kid/src/main/AndroidManifest.xml`** (for `app-parent`, change the label to `Screen Time Parent`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:label="Screen Time"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Material.Light.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>

</manifest>
```

**`android/app-kid/src/main/kotlin/au/screentime/kid/MainActivity.kt`**:

```kotlin
package au.screentime.kid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import au.screentime.core.ui.PlaceholderScreen
import au.screentime.core.ui.ScreenTimeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ScreenTimeTheme {
                PlaceholderScreen(
                    title = "Screen Time",
                    subtitle = "Kid app. Real screens come in later cards.",
                )
            }
        }
    }
}
```

**`android/app-parent/src/main/kotlin/au/screentime/parent/MainActivity.kt`**: the same file with `package au.screentime.parent`, title `"Screen Time Parent"` and subtitle `"Parent app. Real screens come in later cards."`.

### 5.16 `android/README.md` (replace the whole file)

````markdown
# android

One Gradle project with two apps and shared modules, all Kotlin + Jetpack Compose (docs/SPEC.md §4.1, §5).

| Module | Kind | Purpose |
|---|---|---|
| `app-kid/` | Android app `au.screentime.kid` | kid enforcer app (Device Owner) |
| `app-parent/` | Android app `au.screentime.parent` | parent app |
| `core-ui/` | Android library | Compose theme (design tokens, SPEC §16.1) and shared components |
| `core-time/` | Kotlin JVM library | time engine (must pass `test-vectors/`) and time formatting |
| `core-model/` | Kotlin JVM library | API models and generated API client |

## Build

Needs Android Studio (for its Java runtime and the Android SDK with API 36). From this folder in PowerShell:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
```

APKs: `app-kid/build/outputs/apk/debug/app-kid-debug.apk` and `app-parent/build/outputs/apk/debug/app-parent-debug.apk`.

Versions live in `gradle/libs.versions.toml`. AGP 9 compiles Kotlin itself: never add the `org.jetbrains.kotlin.android` plugin.
````

### 5.17 `.github/workflows/android.yml`

```yaml
name: Android

on:
  pull_request:
    paths:
      - "android/**"
      - ".github/workflows/android.yml"
  push:
    branches: [main]
    paths:
      - "android/**"
      - ".github/workflows/android.yml"

concurrency:
  group: android-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  build:
    name: build and test
    runs-on: ubuntu-latest
    timeout-minutes: 30
    defaults:
      run:
        working-directory: android
    steps:
      - name: Check out
        uses: actions/checkout@v5

      - name: Set up Java
        uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: "21"

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v5

      - name: Build and test
        run: ./gradlew assembleDebug test --stacktrace
```

## 6. Detailed spec

### 6.1 What the placeholder screen looks like

Both apps open straight to `PlaceholderScreen`:

- Full-screen background `background` token: `#F7F7F5` in light mode, `#0C0A09` in dark mode. Light or dark follows the phone's system setting.
- Vertically and horizontally centred:
  1. Title in Material 3 `headlineMedium`, colour `onSurface` (`#1C1917` light / `#F5F5F4` dark).
  2. 8 dp gap, then the subtitle in `bodyLarge`, colour `muted` (`#57534E` light / `#A8A29E` dark).
  3. 24 dp gap, then a row of four 24 dp circles, 12 dp apart, left to right: teal `primary`, amber `warning`, orange `critical`, red `danger`.
- Content stays clear of the status bar and navigation bar (`safeDrawingPadding`).

### 6.2 Theme rules

- All screens in both apps are wrapped in `ScreenTimeTheme { ... }`.
- Material colours come from the Screen Time tokens (`primary`, `background`, `surface`, `surfaceVariant`, `onSurface`, `outline`; `muted` is used as `onSurfaceVariant`; `danger` as `error`).
- Colours with no Material slot (`warning`, `critical`, `danger`, `muted`, `nightTop`, `nightBottom`, `onNight`) are read with `ScreenTimeTheme.colors.<name>`.
- No dynamic colour (Material You wallpaper colours). The app always uses our tokens.

### 6.3 Build rules

- `minSdk = 34`, `compileSdk = 36`, `targetSdk = 36` (apps). Bytecode target Java 17.
- Kotlin JVM modules (`core-time`, `core-model`) must not depend on any Android library, so they stay usable from a future iOS or desktop target.
- `core-ui` exposes Compose Material 3 through `api(...)`, so apps that use `core-ui` see Material 3 too.

## 7. Steps

All commands in PowerShell.

1. Check the tools (section 4). If either check prints `False`, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-004-android-skeleton
   ```
3. Check the wrapper is there: `Get-Content android\gradle\wrapper\gradle-wrapper.properties` must show `gradle-9.8.2-bin.zip`.
4. Create the root files: 5.1 to 5.4. Commit: `CARD-004: add Gradle settings and version catalog`.
5. Create `core-time` and `core-model` (5.5 to 5.9). Commit: `CARD-004: add core-time and core-model modules`.
6. Create `core-ui` (5.10 to 5.14). Commit: `CARD-004: add core-ui theme`.
7. Create both apps (5.15). Commit: `CARD-004: add kid and parent app shells`.
8. Replace `android/README.md` (5.16) and add `.github/workflows/android.yml` (5.17). Commit: `CARD-004: add Android CI and README`.
9. Build and test (the first run downloads a lot and can take 5 to 15 minutes):
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime\android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat assembleDebug test
   ```
   If Gradle says the SDK location is not found, create `android\local.properties` (it is git-ignored, never commit it) with this one line, then run the build again:
   ```properties
   sdk.dir=C:/Users/james/AppData/Local/Android/Sdk
   ```
10. Run the acceptance checks in section 8.
11. Push and open the PR (section 10).

## 8. Acceptance criteria

Run from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with `JAVA_HOME` set as in section 4.

- [ ] `.\gradlew.bat --version` prints `Gradle 9.8.2`.
- [ ] `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] Both APKs exist. This prints `True` twice:
  ```powershell
  Test-Path app-kid\build\outputs\apk\debug\app-kid-debug.apk
  Test-Path app-parent\build\outputs\apk\debug\app-parent-debug.apk
  ```
- [ ] The tests really ran: 9 in `core-time`, 3 in `core-model`, 0 failures. This prints two lines, `tests="9" ... failures="0"` and `tests="3" ... failures="0"`:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*(tests="\d+").*(failures="\d+").*', '$1 $2' }
  ```
- [ ] The GitHub Actions **Android / build and test** check is green on the PR.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 23 files and nothing else (in any order):
  ```
  .github/workflows/android.yml
  android/README.md
  android/app-kid/build.gradle.kts
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/MainActivity.kt
  android/app-parent/build.gradle.kts
  android/app-parent/src/main/AndroidManifest.xml
  android/app-parent/src/main/kotlin/au/screentime/parent/MainActivity.kt
  android/build.gradle.kts
  android/core-model/build.gradle.kts
  android/core-model/src/main/kotlin/au/screentime/core/model/Pool.kt
  android/core-model/src/test/kotlin/au/screentime/core/model/PoolTest.kt
  android/core-time/build.gradle.kts
  android/core-time/src/main/kotlin/au/screentime/core/time/DurationFormat.kt
  android/core-time/src/test/kotlin/au/screentime/core/time/DurationFormatTest.kt
  android/core-ui/build.gradle.kts
  android/core-ui/src/main/AndroidManifest.xml
  android/core-ui/src/main/kotlin/au/screentime/core/ui/Colors.kt
  android/core-ui/src/main/kotlin/au/screentime/core/ui/PlaceholderScreen.kt
  android/core-ui/src/main/kotlin/au/screentime/core/ui/Theme.kt
  android/gradle.properties
  android/gradle/libs.versions.toml
  android/settings.gradle.kts
  ```
  In particular: no `local.properties`, no `build/` folders, no `.idea/`, no `.gradle/`, and no change to the wrapper files.

Optional (not needed for the PR): if a phone or emulator is connected, `adb install -r app-kid\build\outputs\apk\debug\app-kid-debug.apk` and open "Screen Time". It shows the screen in 6.1.

## 9. Tests

| File | What it asserts |
|---|---|
| `android/core-time/src/test/kotlin/au/screentime/core/time/DurationFormatTest.kt` | 9 cases of `formatDuration`: negative, 0 and 59 s give "less than a minute"; 60 s "1m"; 2700 s "45m"; 3600 s "1h"; 4320 s and 4379 s "1h 12m" (rounded down); 36000 s "10h". |
| `android/core-model/src/test/kotlin/au/screentime/core/model/PoolTest.kt` | API values are `screens` and `phone`; `fromApiValue` round-trips; an unknown value gives `null`. |

No tests for `core-ui` or the apps in this card.

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 4 to 8). Message format: `CARD-004: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-004-android-skeleton`
5. Open a PR into `main` titled `CARD-004: Android Gradle skeleton`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-004-android-skeleton --title "CARD-004: Android Gradle skeleton" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-004-android-skeleton.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] Gradle 9.8.2 — output: `...`
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL in ...`
   - [x] both APKs exist — output: `True True`
   - [x] tests ran — output: `tests="9" failures="0"`, `tests="3" failures="0"`
   - [x] only expected files changed — output: 23 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the **first** error from the Gradle output (the lines after `What went wrong:`), not the whole log.

Known traps, and what to do:

- **"Plugin [id: 'org.jetbrains.kotlin.android'] ..." or "kotlin-android is not compatible with built-in Kotlin"**: you added the `kotlin-android` plugin. Remove it; the card never uses it.
- **"SDK location not found"**: create `android\local.properties` as in step 9.
- **"Failed to find target with hash string 'android-36'"** or a licence error: ask James to install Android 16 (API 36) in the SDK Manager (section 4).
- **"JAVA_HOME is not set"** or a Java version error: run the `$env:JAVA_HOME = ...` line from section 4 in this terminal.
- **A version cannot be found** (for example "Could not find com.android.tools.build:gradle:9.4.0"): do **not** pick another version yourself. Stop and report the exact message in the PR.
- **Gradle prints deprecation warnings** but ends with `BUILD SUCCESSFUL`: that is fine, ignore them.
