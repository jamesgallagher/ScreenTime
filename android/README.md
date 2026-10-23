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

Needs Android Studio (for its Java runtime and the Android SDK with API 37). From this folder in PowerShell:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
```

APKs: `app-kid/build/outputs/apk/debug/app-kid-debug.apk` and `app-parent/build/outputs/apk/debug/app-parent-debug.apk`.

Versions live in `gradle/libs.versions.toml`. AGP 9 compiles Kotlin itself: never add the `org.jetbrains.kotlin.android` plugin.
