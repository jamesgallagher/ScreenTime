# CARD-038: SOS on the kid phone

| Field | Value |
|---|---|
| Card | CARD-038 |
| Title | SOS on the kid phone |
| Size | L |
| Depends on | CARD-037 (parent mode on the kid phone), merged to `main` |
| Spec sections | docs/SPEC.md §9.3 (the SOS device endpoints), §9.4 (the snapshot's `activeSos`), §10 (`sos_ack`, `sos_extended`, `sos_ended` messages), §15 ("SOS", "As built (CARD-038)"), §16.2 (main screen, block screen) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-038-sos` |
| PR title | `CARD-038: SOS on the kid phone` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

**SOS** is for a kid in trouble: on their phone, in any state (counting, out of time, bedtime, parent mode, offline), they hold one red button, and every parent gets an alert and a text with where the kid is, and goes on getting the position every 30 seconds until it ends. The server side was built in earlier cards. This card builds it on the Android kid app:

- **The SOS button**, a red circle in the top corner of the main screen and the block screen, only on a phone with a SIM. A tap only shows "Hold the SOS button for 2 seconds". Held for 2 seconds (a red ring fills around it), it starts a full-screen red countdown from 5 with a big white **Cancel**.
- **At zero the SOS starts**: the phone takes its position, texts every parent who has a mobile number ("SOS from Alex. Location: https://maps.google.com/?q=… (±20 m). Battery 54%."), and tells the server, which alerts every parent (a push, and an email). Every 30 seconds, screen on or off, the newest position goes to the server. With no internet, everything waits on the phone, and the phone texts the position again every 5 minutes.
- **The SOS screen** covers the main screen or the block screen: "SOS is on", how far it got ("Sent to Dad. They can see where you are." or "No internet. We texted Dad where you are."), "✓ Dad has seen your SOS" once a parent taps "I'm on it", a call button for each parent, **Emergency 000**, and **Hold: I'm safe** (held 2 seconds, it ends the SOS). A parent can also end it from their app, and it stops by itself after 2 hours unless a parent keeps it on. When it ends, every parent gets a text.
- **Nothing counts** during an SOS.

How it works:

- `sos/Sos.kt` is the pure logic, with unit tests: the SOS as the phone keeps it (`LocalSos`), what changes it (a position, a text, the kid's end, a parent's message, the snapshot), the texts, what the screen shows, and the calls to the server.
- `sos/SosStore.kt` keeps the SOS in SharedPreferences, so it survives a restart and nothing is lost offline. `sos/SosController.kt` runs it for the service: positions from Android's own location providers, the texts with `SmsManager`, and the calls to the server.
- `sos/SosScreens.kt` holds the button, the countdown and the SOS screen. The service (`service/KidService.kt`) starts and ends it, ticks it every 30 seconds, and does not count while it is on.
- The manifest asks for `SEND_SMS` and the location permissions. The app is Device Owner, which grants them without a prompt (the existing `Policies.grantRuntimePermissions`), and turns location on when an SOS starts.

Claude added `server/scripts/dev-sos.ts`: it plays the parent, so the run in 8.2 can say "I'm on it", end the SOS, or show what the server has, without the parent app (which does not exist yet).

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `SosTest` (9 tests); on the emulator the **SOS** button shows on the main screen and the block screen; a tap only shows the hint; **Cancel** in the countdown sends nothing; a hold and the countdown start an SOS, which texts Dad the emulator's position, reaches the server and emails Dad; positions keep going up every 30 seconds and no time is counted; Dad's "I'm on it" shows "✓ Dad has seen your SOS"; the SOS screen covers the block screen at bedtime; **Hold: I'm safe**, Dad's end from his phone, and an SOS started offline that reaches the server once back online, all work and text Dad; the eleven screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No parent app screens (a later card), no "caught" screen (CARD-039), no FCM (CARD-034b): the phone hears a parent's "I'm on it" and end over the live channel while the screen is on, as in CARD-037.
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/`, `server/` or `docs/`, and no change to any `build.gradle.kts` or `libs.versions.toml`. The only manifest change is the one in 5.1. No new dependency of any kind: no Google Play services.
- Never run the app on a real phone or tablet in this card: an SOS on a real phone sends real texts to real people. Never install a **release** build anywhere.
- **Never tap Emergency 000**, on the emulator or anywhere, in this card, and never place a call to an emergency number.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, Room 2.8.5, KSP 2.3.12, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. No new library: positions come from `android.location.LocationManager` and texts from `android.telephony.SmsManager`, both part of Android.

Claude built this exact code in GitHub Actions before writing the card, so it compiles and the tests pass, and ran `dev-sos.ts` against the real server.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c38"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `·` (U+00B7), `…` (U+2026), `±` (U+00B1), `✓` (U+2713) and `’` nowhere (every apostrophe is a plain `'`); copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/sos/Sos.kt` | create (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosStore.kt` | create (5.3) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosController.kt` | create (5.4) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosScreens.kt` | create (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt` | replace (5.6) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt` | replace (5.7) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt` | replace (5.8) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt` | replace (5.9) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | replace (5.10) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/sos/SosTest.kt` | create (5.11) |

That is 11 files.

### 5.1 `android/app-kid/src/main/AndroidManifest.xml`

Replace the whole file. Compared with `main`: a comment, the four permissions `SEND_SMS`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION` (in that order: Device Owner grants them in manifest order, and background location only after fine location), and the GPS feature as not required.

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <!-- Scanning the enrolment QR code. Device Owner grants it, so the kid is never asked (docs/SPEC.md §12.1). -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <!-- The always-on service (docs/SPEC.md §12.1). systemExempted is allowed because the app is Device Owner. -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <!-- The short buzz at the second warning on a phone (docs/SPEC.md §16.2). -->
    <uses-permission android:name="android.permission.VIBRATE" />
    <!--
        The call buttons on the block screen (docs/SPEC.md §12.1). Device Owner grants it. Tablets have no phone,
        so it is not required.
    -->
    <uses-permission android:name="android.permission.CALL_PHONE" />
    <uses-feature android:name="android.hardware.telephony" android:required="false" />
    <!--
        SOS (docs/SPEC.md §15): a text to every parent, and the phone's position every 30 seconds, also with the
        screen off. Device Owner grants all four, fine location before background location.
    -->
    <uses-permission android:name="android.permission.SEND_SMS" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />

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

        <!--
            The block screen (docs/SPEC.md §12.1): its own task, kept out of Recents, pinned with Lock Task while
            the device is locked. Only the app itself opens it.
        -->
        <activity
            android:name=".block.BlockActivity"
            android:exported="false"
            android:excludeFromRecents="true"
            android:launchMode="singleTask"
            android:taskAffinity="au.screentime.kid.block" />

        <service
            android:name=".service.KidService"
            android:exported="false"
            android:foregroundServiceType="systemExempted" />

        <!--
            Stops calls to numbers off the kid's list while blocked (docs/SPEC.md §12.1). Android only uses it once
            the app holds the call redirection role, given with adb when the phone is set up.
        -->
        <service
            android:name=".calls.CallGuard"
            android:exported="true"
            android:permission="android.permission.BIND_CALL_REDIRECTION_SERVICE">
            <intent-filter>
                <action android:name="android.telecom.CallRedirectionService" />
            </intent-filter>
        </service>

        <receiver
            android:name=".service.BootReceiver"
            android:exported="false">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>

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

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/sos/Sos.kt`

```kotlin
package au.screentime.kid.sos

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.DeviceStateActiveSos
import au.screentime.core.model.api.Opt
import au.screentime.core.model.api.SosLocationIn
import au.screentime.core.model.api.SosLocationInVia
import au.screentime.core.model.api.SosLocationsUpload
import au.screentime.core.model.api.SosStart
import au.screentime.kid.calls.Callable
import au.screentime.kid.status.parentsText
import java.time.DateTimeException
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.roundToInt
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** An SOS stops by itself this long after it starts, unless a parent keeps it on (docs/SPEC.md §15). */
const val SOS_RUN_MS = 2 * 60 * 60_000L

/** How often the phone takes a position and sends what it has during an SOS. */
const val SOS_TICK_MS = 30_000L

/** Without a connection to the server, a text with the position this often. */
const val SOS_TEXT_EVERY_MS = 5 * 60_000L

/** One position. [atMs] is trusted-clock time; [bySms] is true once a text carried it to the parents. */
data class SosFix(
    val atMs: Long,
    val lat: Double,
    val lng: Double,
    /** Radius in metres. */
    val accuracyM: Double?,
    val batteryPct: Int?,
    val bySms: Boolean = false,
)

/** Who ended an SOS. */
enum class SosEnd { KID, PARENT, AUTO }

/**
 * The SOS on this phone, from the countdown until the server has everything (docs/SPEC.md §15). Times are trusted-clock
 * epoch milliseconds. An ended SOS stays until its start, its positions, its end and the "ended" text have all gone.
 */
data class LocalSos(
    val id: String,
    val startedAtMs: Long,
    val autoStopAtMs: Long,
    /** The position in the first text, sent with the start. */
    val startFix: SosFix? = null,
    /** When the server got the start; null until then. */
    val startReportedAtMs: Long? = null,
    /** Positions the server does not have yet, oldest first. */
    val queue: List<SosFix> = emptyList(),
    /** The newest position taken in. */
    val lastFix: SosFix? = null,
    /** The last time the server answered. */
    val lastDataAtMs: Long? = null,
    /** The last text to the parents. */
    val lastTextAtMs: Long? = null,
    /** "Dad", in the order they said "I'm on it". */
    val seenBy: List<String> = emptyList(),
    val endedAtMs: Long? = null,
    val endedBy: SosEnd? = null,
    /** The parent who ended it, when the server said. */
    val endedByName: String? = null,
    /** False until the server has the kid's "I'm safe". */
    val endReported: Boolean = false,
    val endTextSent: Boolean = false,
) {
    val active: Boolean get() = endedAtMs == null

    /** Ended, and nothing more to send: the phone can forget it. */
    val done: Boolean
        get() = !active && endReported && endTextSent && startReportedAtMs != null && queue.isEmpty()
}

/** A new SOS at [nowMs], when the countdown has finished. */
fun startSos(id: String, nowMs: Long): LocalSos = LocalSos(id, nowMs, nowMs + SOS_RUN_MS)

/** Takes [fix] in, if it is newer than the last one: it goes to the server with the next send. */
fun LocalSos.withFix(fix: SosFix): LocalSos {
    if (!active || fix.atMs <= (lastFix?.atMs ?: Long.MIN_VALUE)) return this
    return copy(queue = queue + fix, lastFix = fix)
}

/** No answer from the server for 5 minutes since the last text: time to text the position again. */
fun LocalSos.textDue(nowMs: Long): Boolean =
    active && nowMs - maxOf(lastTextAtMs ?: startedAtMs, lastDataAtMs ?: Long.MIN_VALUE) >= SOS_TEXT_EVERY_MS

/** A text went at [nowMs] with [lastFix], which the server then gets as `via: sms`. */
fun LocalSos.textSent(nowMs: Long): LocalSos {
    val sent = lastFix?.atMs
    return copy(lastTextAtMs = nowMs, queue = queue.map { if (it.atMs == sent) it.copy(bySms = true) else it })
}

/** The kid held **I'm safe**. */
fun LocalSos.endedByKid(nowMs: Long): LocalSos =
    if (active) copy(endedAtMs = nowMs, endedBy = SosEnd.KID) else this

/** Past [LocalSos.autoStopAtMs]: it stops by itself, and the server does the same on its own (docs/SPEC.md §15 step 9). */
fun LocalSos.autoStopped(nowMs: Long): LocalSos =
    if (active && nowMs >= autoStopAtMs) copy(endedAtMs = autoStopAtMs, endedBy = SosEnd.AUTO, endReported = true) else this

/**
 * The snapshot says no SOS, or another one, although the server had this one before the snapshot was made: a parent
 * ended it and the message did not reach the phone.
 */
fun LocalSos.checkedAgainst(activeSos: DeviceStateActiveSos?, serverTimeMs: Long, nowMs: Long): LocalSos {
    val reported = startReportedAtMs ?: return this
    if (!active || serverTimeMs <= reported || activeSos?.id == id) return this
    return copy(endedAtMs = nowMs, endedBy = SosEnd.PARENT, endReported = true)
}

/** What a parent did, from a `sos_ack`, `sos_extended` or `sos_ended` message (docs/SPEC.md §10). */
data class SosNews(val type: String, val sosId: String, val byName: String, val autoStopAtMs: Long?)

/** The [SosNews] in an envelope, or null for any other frame. */
fun sosNewsOf(frame: String): SosNews? = try {
    val envelope = Json.parseToJsonElement(frame) as? JsonObject
    val type = envelope?.get("type")?.jsonPrimitive?.contentOrNull
    val data = envelope?.get("data") as? JsonObject
    val sosId = data?.get("sosId")?.jsonPrimitive?.contentOrNull
    val byName = data?.get("byName")?.jsonPrimitive?.contentOrNull
    if (type == null || type !in SOS_NEWS || sosId == null || byName == null) {
        null
    } else {
        val autoStopAt = data["autoStopAt"]?.jsonPrimitive?.contentOrNull
        SosNews(type, sosId, byName, autoStopAt?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() })
    }
} catch (e: IllegalArgumentException) {
    // Not JSON (SerializationException is an IllegalArgumentException).
    null
} catch (e: DateTimeException) {
    // An `autoStopAt` that is not a time.
    null
}

private val SOS_NEWS = setOf("sos_ack", "sos_extended", "sos_ended")

/** [news] for this SOS: who has seen it, a later auto stop, or a parent's end. News for another SOS changes nothing. */
fun LocalSos.withNews(news: SosNews, nowMs: Long): LocalSos {
    if (news.sosId != id || !active) return this
    return when (news.type) {
        "sos_ack" -> if (news.byName in seenBy) this else copy(seenBy = seenBy + news.byName)
        "sos_extended" -> news.autoStopAtMs?.let { copy(autoStopAtMs = it) } ?: this
        "sos_ended" -> copy(endedAtMs = nowMs, endedBy = SosEnd.PARENT, endedByName = news.byName, endReported = true)
        else -> this
    }
}

/** "https://maps.google.com/?q=-33.86880,151.20930 (±20 m)". */
fun mapsText(fix: SosFix): String {
    val link = String.format(Locale.ROOT, "https://maps.google.com/?q=%.5f,%.5f", fix.lat, fix.lng)
    return fix.accuracyM?.let { "$link (±${it.roundToInt()} m)" } ?: link
}

/**
 * The text to every parent with a mobile (docs/SPEC.md §15 step 2): "SOS from Alex. Location: https://maps…
 * (±20 m). Battery 54%." [again] for the texts every 5 minutes without data, which also say how old the position is.
 */
fun sosText(kidName: String, fix: SosFix?, batteryPct: Int?, nowMs: Long, again: Boolean = false): String {
    val head = if (again) "SOS from $kidName, still on." else "SOS from $kidName."
    val place = when {
        fix == null -> " No location yet."
        again && nowMs - fix.atMs >= 60_000L -> " Location ${(nowMs - fix.atMs) / 60_000L} min ago: ${mapsText(fix)}."
        else -> " Location: ${mapsText(fix)}."
    }
    val battery = batteryPct?.let { " Battery $it%." } ?: ""
    return head + place + battery
}

/** "Alex is safe: SOS ended. Last location: https://maps…", and the same for a parent's end or the auto stop. */
fun sosEndText(kidName: String, sos: LocalSos): String {
    val head = when (sos.endedBy) {
        SosEnd.KID -> "$kidName is safe: SOS ended."
        SosEnd.PARENT -> sos.endedByName?.let { "$kidName's SOS was ended by $it." } ?: "$kidName's SOS has ended."
        SosEnd.AUTO, null -> "$kidName's SOS has stopped by itself."
    }
    return head + (sos.lastFix?.let { " Last location: ${mapsText(it)}." } ?: "")
}

/** How far the SOS has got, for the screen. */
enum class SosStage {
    /** Waiting for a position and the server. */
    SENDING,

    /** The server has it: every parent got a push and an email. */
    SENT,

    /** No server yet, but the parents got a text. */
    TEXTED,
}

/** What the SOS screen shows (docs/SPEC.md §15 step 6). */
data class SosView(
    val stage: SosStage,
    /** "Dad", "Mum": the parents who said "I'm on it". */
    val seenBy: List<String>,
    /** The call buttons: the parents with a mobile. */
    val parents: List<Callable>,
    /** "Mum and Dad". */
    val parentsAnd: String,
    val emergencyNumber: String,
) {
    /** "Telling Mum and Dad…", "Sent to Mum and Dad. They can see where you are.", or the no-internet line. */
    fun line(): String = when (stage) {
        SosStage.SENDING -> "Telling $parentsAnd…"
        SosStage.SENT -> "Sent to $parentsAnd. They can see where you are."
        SosStage.TEXTED -> "No internet. We texted $parentsAnd where you are."
    }

    /** "Dad has seen your SOS", "Mum and Dad have seen your SOS", or null before anyone has. */
    fun seenLine(): String? = when (seenBy.size) {
        0 -> null
        1 -> "${seenBy[0]} has seen your SOS"
        else -> "${parentsText(seenBy, "and")} have seen your SOS"
    }
}

/** The screen's view of an active SOS; null when there is none. */
fun LocalSos?.view(parents: List<Callable>, parentNames: List<String>, emergencyNumber: String): SosView? {
    if (this == null || !active) return null
    val stage = when {
        startReportedAtMs != null -> SosStage.SENT
        lastTextAtMs != null -> SosStage.TEXTED
        else -> SosStage.SENDING
    }
    return SosView(stage, seenBy, parents, parentsText(parentNames, "and"), emergencyNumber)
}

/** The SOS calls to the server (docs/SPEC.md §9.3). */
class SosApi(private val api: ApiClient) {
    /**
     * Sends what the server does not have yet, in order: the start, the positions (100 at a time), the kid's end.
     * Stops at the first call that does not get through, and returns [sos] with what went marked. Any answer from the
     * server counts as sent: sending it again would get the same answer.
     */
    suspend fun flush(sos: LocalSos, nowMs: Long): LocalSos {
        var out = sos
        if (out.startReportedAtMs == null) {
            val start = SosStart(
                id = sos.id,
                startedAt = iso(sos.startedAtMs),
                location = sos.startFix?.let { Opt.Value(it.toApi()) } ?: Opt.Absent,
            )
            if (!deliver { api.postDeviceSos(start) }) return out
            out = out.copy(startReportedAtMs = nowMs, lastDataAtMs = nowMs)
        }
        while (out.queue.isNotEmpty()) {
            val batch = out.queue.take(100)
            if (!deliver { api.postDeviceSosLocations(sos.id, SosLocationsUpload(batch.map { it.toApi() })) }) return out
            out = out.copy(queue = out.queue.drop(batch.size), lastDataAtMs = nowMs)
        }
        if (!out.active && !out.endReported) {
            if (!deliver { api.postDeviceSosEnd(sos.id) }) return out
            out = out.copy(endReported = true, lastDataAtMs = nowMs)
        }
        return out
    }

    private suspend fun deliver(call: suspend () -> Unit): Boolean = try {
        call()
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        true
    } catch (e: Exception) {
        false
    }
}

private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

private fun SosFix.toApi() = SosLocationIn(
    at = iso(atMs),
    lat = lat,
    lng = lng,
    accuracyM = accuracyM?.let { Opt.Value(it) } ?: Opt.Absent,
    batteryPct = batteryPct?.let { Opt.Value(it) } ?: Opt.Absent,
    via = if (bySms) SosLocationInVia.SMS else SosLocationInVia.DATA,
)
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosStore.kt`

```kotlin
package au.screentime.kid.sos

import android.content.Context

/**
 * [LocalSos] in SharedPreferences, so an SOS goes on after the app restarts and what the server has not got yet is
 * still sent. Only the service writes it, one change at a time.
 */
class SosStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("sos", Context.MODE_PRIVATE)

    fun load(): LocalSos? {
        val id = prefs.getString(ID, null) ?: return null
        return LocalSos(
            id = id,
            startedAtMs = prefs.getLong(STARTED, 0),
            autoStopAtMs = prefs.getLong(AUTO_STOP, 0),
            startFix = prefs.getString(START_FIX, null)?.let(::fixOf),
            startReportedAtMs = long(START_REPORTED),
            queue = prefs.getString(QUEUE, "").orEmpty().split(';').filter { it.isNotEmpty() }.mapNotNull(::fixOf),
            lastFix = prefs.getString(LAST_FIX, null)?.let(::fixOf),
            lastDataAtMs = long(LAST_DATA),
            lastTextAtMs = long(LAST_TEXT),
            seenBy = prefs.getString(SEEN_BY, "").orEmpty().split('\n').filter { it.isNotEmpty() },
            endedAtMs = long(ENDED),
            endedBy = prefs.getString(ENDED_BY, null)?.let(SosEnd::valueOf),
            endedByName = prefs.getString(ENDED_BY_NAME, null),
            endReported = prefs.getBoolean(END_REPORTED, false),
            endTextSent = prefs.getBoolean(END_TEXT_SENT, false),
        )
    }

    /** Saves [sos], or forgets the SOS when it is null. Written at once: the next thing may be a reboot. */
    fun save(sos: LocalSos?) {
        val edit = prefs.edit().clear()
        if (sos != null) {
            edit.putString(ID, sos.id)
                .putLong(STARTED, sos.startedAtMs)
                .putLong(AUTO_STOP, sos.autoStopAtMs)
                .putString(QUEUE, sos.queue.joinToString(";", transform = ::textOf))
                .putString(SEEN_BY, sos.seenBy.joinToString("\n"))
                .putBoolean(END_REPORTED, sos.endReported)
                .putBoolean(END_TEXT_SENT, sos.endTextSent)
            sos.startFix?.let { edit.putString(START_FIX, textOf(it)) }
            sos.startReportedAtMs?.let { edit.putLong(START_REPORTED, it) }
            sos.lastFix?.let { edit.putString(LAST_FIX, textOf(it)) }
            sos.lastDataAtMs?.let { edit.putLong(LAST_DATA, it) }
            sos.lastTextAtMs?.let { edit.putLong(LAST_TEXT, it) }
            sos.endedAtMs?.let { edit.putLong(ENDED, it) }
            sos.endedBy?.let { edit.putString(ENDED_BY, it.name) }
            sos.endedByName?.let { edit.putString(ENDED_BY_NAME, it) }
        }
        edit.commit()
    }

    private fun long(key: String): Long? = if (prefs.contains(key)) prefs.getLong(key, 0) else null

    /** "atMs|lat|lng|accuracy|battery|sms", with nothing between the bars for a missing value. */
    private fun textOf(fix: SosFix): String =
        listOf(fix.atMs, fix.lat, fix.lng, fix.accuracyM ?: "", fix.batteryPct ?: "", if (fix.bySms) 1 else 0)
            .joinToString("|")

    private fun fixOf(text: String): SosFix? {
        val parts = text.split('|')
        if (parts.size != 6) return null
        return SosFix(
            atMs = parts[0].toLongOrNull() ?: return null,
            lat = parts[1].toDoubleOrNull() ?: return null,
            lng = parts[2].toDoubleOrNull() ?: return null,
            accuracyM = parts[3].toDoubleOrNull(),
            batteryPct = parts[4].toIntOrNull(),
            bySms = parts[5] == "1",
        )
    }

    private companion object {
        const val ID = "id"
        const val STARTED = "startedAtMs"
        const val AUTO_STOP = "autoStopAtMs"
        const val START_FIX = "startFix"
        const val START_REPORTED = "startReportedAtMs"
        const val QUEUE = "queue"
        const val LAST_FIX = "lastFix"
        const val LAST_DATA = "lastDataAtMs"
        const val LAST_TEXT = "lastTextAtMs"
        const val SEEN_BY = "seenBy"
        const val ENDED = "endedAtMs"
        const val ENDED_BY = "endedBy"
        const val ENDED_BY_NAME = "endedByName"
        const val END_REPORTED = "endReported"
        const val END_TEXT_SENT = "endTextSent"
    }
}
```

### 5.4 `android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosController.kt`

```kotlin
package au.screentime.kid.sos

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.SystemClock
import android.telephony.SmsManager
import android.util.Log
import au.screentime.core.model.api.DeviceState
import au.screentime.kid.admin.KidDeviceAdminReceiver
import au.screentime.kid.calls.callablesOf
import au.screentime.kid.status.StatusHub
import au.screentime.kid.sync.TrustedClock
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

private const val TAG = "Sos"

/**
 * The SOS on this phone (docs/SPEC.md §15), for the service: the positions, the texts to the parents, the calls to
 * the server, and the SOS screen through [StatusHub.sos]. Every change goes through one lock, so a news message, a
 * tick and the start never mix.
 */
class SosController(private val context: Context, private val clock: TrustedClock, private val api: SosApi) {
    private val store = SosStore(context)
    private val locator = Locator(context, clock, ::battery)
    private val lock = Mutex()
    private var sos: LocalSos? = store.load()

    /** From the last snapshot: who to text and call, and what to call the kid. */
    private var state: DeviceState? = null

    /** An SOS is on: nothing counts and the service ticks every 30 seconds. */
    val active: Boolean get() = sos?.active == true

    /** Something is still to send for an SOS that has ended. */
    val pending: Boolean get() = sos != null

    /** After a restart of the app: an SOS that was on goes on taking positions. */
    fun resume() {
        if (!active) return
        turnOnLocation()
        locator.start()
    }

    /** The snapshot the service just loaded, with the server's time when it was made. */
    suspend fun onSnapshot(snapshot: DeviceState, serverTimeMs: Long) = lock.withLock {
        state = snapshot
        sos?.let { update(it.checkedAgainst(snapshot.activeSos, serverTimeMs, clock.nowMs())) }
        publish()
    }

    /**
     * The countdown finished (docs/SPEC.md §15 steps 1 to 3): the SOS starts now. The first text waits up to 10
     * seconds for a position, then the server hears about it.
     */
    suspend fun start() = lock.withLock {
        if (active) return@withLock
        var next = startSos(UUID.randomUUID().toString(), clock.nowMs())
        Log.i(TAG, "sos: started")
        update(next)
        turnOnLocation()
        locator.start()
        val fix = locator.fresh()
        if (fix != null) next = next.withFix(fix).copy(startFix = fix)
        text(sosText(kidName(), fix, battery(), clock.nowMs()))
        next = next.textSent(clock.nowMs())
        update(next)
        send()
    }

    /** The kid held **I'm safe**. */
    suspend fun endByKid() = lock.withLock {
        sos?.let { update(it.endedByKid(clock.nowMs())) }
        send()
    }

    /** `sos_ack`, `sos_extended` or `sos_ended` from the live channel. */
    suspend fun onNews(news: SosNews) = lock.withLock {
        val before = sos ?: return@withLock
        val after = before.withNews(news, clock.nowMs())
        if (after.seenBy != before.seenBy) Log.i(TAG, "sos: seen by ${news.byName}")
        if (after.autoStopAtMs != before.autoStopAtMs) Log.i(TAG, "sos: kept on for longer by ${news.byName}")
        update(after)
        send()
    }

    /** Every 30 seconds while an SOS is on, and at each sync while an ended one still has something to send. */
    suspend fun tick() = lock.withLock {
        val now = clock.nowMs()
        sos?.let { current ->
            var next = current.autoStopped(now)
            if (next.active) locator.latest()?.let { next = next.withFix(it) }
            update(next)
        }
        send()
    }

    /** Sends what the server does not have, texts when there is no connection, and finishes an ended SOS. */
    private suspend fun send() {
        var next = sos ?: return
        val now = clock.nowMs()
        val before = next
        next = api.flush(next, now)
        if (before.startReportedAtMs == null && next.startReportedAtMs != null) Log.i(TAG, "sos: sent to the server")
        val sent = before.queue.size - next.queue.size
        if (sent > 0) Log.i(TAG, "sos: $sent position(s) sent")
        if (next.textDue(now)) {
            text(sosText(kidName(), next.lastFix, battery(), now, again = true))
            next = next.textSent(now)
        }
        if (!next.active && !next.endTextSent) {
            Log.i(TAG, "sos: ended by ${next.endedBy?.name?.lowercase()}")
            locator.stop()
            text(sosEndText(kidName(), next))
            next = next.copy(endTextSent = true)
        }
        update(next)
    }

    /** Keeps [next], forgets it once it is [LocalSos.done], and shows it. */
    private fun update(next: LocalSos) {
        sos = next.takeIf { !it.done }
        store.save(sos)
        publish()
    }

    private fun publish() {
        val snapshot = state
        StatusHub.sos.value = if (snapshot == null) {
            null
        } else {
            sos.view(
                parents = callablesOf(snapshot.parents, emptyList()),
                parentNames = snapshot.parents.map { it.displayName },
                emergencyNumber = snapshot.family.emergencyNumber,
            )
        }
    }

    private fun kidName(): String = state?.kid?.name ?: "your kid"

    /** A text to every parent with a mobile; it works without data (docs/SPEC.md §15 step 2). */
    private fun text(message: String) {
        val numbers = state?.parents.orEmpty().mapNotNull { it.phoneE164 }
        if (numbers.isEmpty()) {
            Log.w(TAG, "sos: no parent has a mobile number, so no text")
            return
        }
        try {
            val sms = context.getSystemService(SmsManager::class.java)
            for (number in numbers) sms.sendMultipartTextMessage(number, null, sms.divideMessage(message), null, null)
            Log.i(TAG, "sos: texted ${numbers.size} parent(s)")
        } catch (e: Exception) {
            // No permission, or no SIM: the push and the email still go.
            Log.w(TAG, "sos: the text failed: ${e.javaClass.simpleName}")
        }
    }

    /** Device Owner may turn location on, and does for an SOS: the kid may have turned it off. */
    private fun turnOnLocation() {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        if (context.getSystemService(LocationManager::class.java).isLocationEnabled) return
        dpm.setLocationEnabled(KidDeviceAdminReceiver.component(context), true)
        Log.i(TAG, "sos: location turned on")
    }

    private fun battery(): Int? = context.getSystemService(BatteryManager::class.java)
        .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        .takeIf { it in 0..100 }

    /**
     * The phone's position from Android's own location providers (fused, GPS and network), every 30 seconds while
     * an SOS is on. Device Owner keeps location on and grants the permission (docs/SPEC.md §12.1).
     */
    private class Locator(
        private val context: Context,
        private val clock: TrustedClock,
        private val battery: () -> Int?,
    ) {
        private val manager = context.getSystemService(LocationManager::class.java)
        private val listener = LocationListener { offer(it) }
        private var running = false

        /** The newest position and its trusted time. */
        @Volatile
        private var best: Pair<Location, Long>? = null

        fun start() {
            if (running) return
            running = true
            for (provider in providers()) {
                try {
                    manager.getLastKnownLocation(provider)?.let(::offer)
                    manager.requestLocationUpdates(provider, SOS_TICK_MS, 0f, context.mainExecutor, listener)
                } catch (e: SecurityException) {
                    Log.w(TAG, "sos: no location permission")
                }
            }
        }

        fun stop() {
            if (!running) return
            running = false
            manager.removeUpdates(listener)
        }

        /** The newest position, unless it is older than [maxAgeMs]. */
        fun latest(maxAgeMs: Long = 10 * 60_000L): SosFix? {
            val (location, atMs) = best ?: return null
            if (clock.nowMs() - atMs > maxAgeMs) return null
            return SosFix(
                atMs = atMs,
                lat = location.latitude,
                lng = location.longitude,
                accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                batteryPct = battery(),
            )
        }

        /** A position from the last 2 minutes, waiting up to 10 seconds for one. */
        suspend fun fresh(): SosFix? = latest(2 * 60_000L) ?: withTimeoutOrNull(10_000L) {
            var fix: SosFix? = null
            while (fix == null) {
                delay(500)
                fix = latest(2 * 60_000L)
            }
            fix
        }

        private fun offer(location: Location) {
            val ageMs = (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000
            val current = best
            if (current == null || location.elapsedRealtimeNanos > current.first.elapsedRealtimeNanos) {
                best = location to clock.nowMs() - ageMs
                val accuracy = if (location.hasAccuracy()) " ±${location.accuracy.toInt()} m" else ""
                Log.i(TAG, "sos: position from ${location.provider}$accuracy")
            }
        }

        private fun providers(): List<String> =
            listOf(LocationManager.FUSED_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .filter { manager.allProviders.contains(it) && manager.isProviderEnabled(it) }
    }
}
```

### 5.5 `android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosScreens.kt`

```kotlin
package au.screentime.kid.sos

import android.os.SystemClock
import android.widget.Toast
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.ask.Look
import au.screentime.kid.calls.ContactRow
import au.screentime.kid.calls.EmergencyButton
import au.screentime.kid.service.KidService
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The light theme's danger red (docs/SPEC.md §16.1): the SOS button and the countdown. */
private val SosRed = Color(0xFFDC2626)

/** The background of the SOS screen while it is on: a very dark red, calm but unmistakable. */
private val SosDeep = Color(0xFF450A0A)

/** The green of "I'm safe" and "Dad has seen your SOS". */
private val SafeGreen = Color(0xFF16A34A)

/** How long the SOS button and **I'm safe** must be held (docs/SPEC.md §15). */
private const val HOLD_MS = 2_000

/**
 * The hold always takes 2 real seconds: with "Remove animations" on, Android makes every animation instant, and a
 * tap would then count as a hold.
 */
private object RealTime : MotionDurationScale {
    override val scaleFactor = 1f
}

/** The countdown after the hold, in seconds. */
private const val COUNTDOWN_SEC = 5

/** [StatusHub.sosCountdown] once the countdown has finished, until the service shows the SOS. */
const val SOS_FIRED = -1L

/**
 * The SOS screens over everything else (docs/SPEC.md §15): the SOS while one is on, the countdown while it runs,
 * otherwise [content]. The main screen and the block screen both use it, so an SOS shows whichever is in front.
 */
@Composable
fun SosLayer(content: @Composable () -> Unit) {
    val sos by StatusHub.sos.collectAsState()
    val countdown by StatusHub.sosCountdown.collectAsState()
    val view = sos
    val from = countdown
    when {
        view != null -> SosOn(view)
        from != null -> Countdown(from)
        else -> content()
    }
}

/**
 * The red **SOS** button, 72 dp, for the top corner of the main screen and the block screen. Hold it for 2 seconds:
 * a ring fills around it, then the countdown starts. A short tap only says to hold it.
 */
@Composable
fun SosButton(look: Look, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val track = if (look == Look.DAY) MaterialTheme.colorScheme.surfaceVariant else ScreenTimeTheme.colors.onNight.copy(alpha = 0.3f)
    Box(
        modifier = modifier
            .size(72.dp)
            .semantics { contentDescription = "SOS. Press and hold for 2 seconds." }
            .hold(
                progress = progress,
                scope = scope,
                onTap = { Toast.makeText(context, "Hold the SOS button for 2 seconds", Toast.LENGTH_SHORT).show() },
                onDone = { StatusHub.sosCountdown.value = SystemClock.elapsedRealtime() },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 5.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            drawArc(track, 0f, 360f, useCenter = false, topLeft = Offset(inset, inset), size = arcSize, style = Stroke(stroke))
            if (progress.value > 0f) {
                drawArc(
                    SosRed,
                    startAngle = -90f,
                    sweepAngle = 360f * progress.value,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
            }
        }
        Box(
            modifier = Modifier
                .size(58.dp)
                .background(SosRed, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "SOS",
                modifier = Modifier.clearAndSetSemantics { },
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
    }
}

/**
 * The 5-second countdown on full-screen red, with a big white **Cancel** (docs/SPEC.md §15 step 1). At zero it asks
 * the service to start the SOS once, even when the main screen and the block screen both show it.
 */
@Composable
private fun Countdown(from: Long) {
    val context = LocalContext.current
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(from) {
        if (from == SOS_FIRED) return@LaunchedEffect
        while (now - from < COUNTDOWN_SEC * 1000L) {
            delay(100)
            now = SystemClock.elapsedRealtime()
        }
        if (StatusHub.sosCountdown.compareAndSet(from, SOS_FIRED)) KidService.startSos(context)
    }
    val left = if (from == SOS_FIRED) 0L else maxOf(0L, COUNTDOWN_SEC - (now - from) / 1000)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SosRed)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Text("SOS", fontSize = 48.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Spacer(Modifier.height(32.dp))
        if (left > 0) {
            Text("Sending in", style = MaterialTheme.typography.titleLarge, color = Color.White)
            Text("$left", fontSize = 120.sp, fontWeight = FontWeight.Bold, color = Color.White)
        } else {
            CircularProgressIndicator(color = Color.White)
            Spacer(Modifier.height(16.dp))
            Text("Sending…", style = MaterialTheme.typography.titleLarge, color = Color.White)
        }
        Spacer(Modifier.height(24.dp))
        Text(
            text = "Your parents will get an alert and a text with where you are.",
            style = MaterialTheme.typography.titleMedium,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(48.dp))
        if (left > 0) {
            Button(
                onClick = { StatusHub.sosCountdown.compareAndSet(from, null) },
                modifier = Modifier
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
                    .height(72.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = SosRed),
            ) {
                Text("Cancel", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/**
 * While an SOS is on (docs/SPEC.md §15 step 6): "SOS is on", how far it got, who has seen it, a call button for each
 * parent, **Emergency 000**, and **I'm safe** to hold for 2 seconds.
 */
@Composable
private fun SosOn(view: SosView) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SosDeep)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(32.dp))
        Text("SOS is on", fontSize = 36.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (view.stage == SosStage.SENDING) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                Spacer(Modifier.width(12.dp))
            }
            Text(
                text = view.line(),
                style = MaterialTheme.typography.titleMedium,
                color = Color.White.copy(alpha = 0.85f),
                textAlign = TextAlign.Center,
            )
        }
        view.seenLine()?.let {
            Spacer(Modifier.height(20.dp))
            Text(
                text = "✓ $it",
                modifier = Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = SafeGreen,
            )
        }
        Spacer(Modifier.height(40.dp))
        if (view.parents.isNotEmpty()) {
            ContactRow(view.parents)
            Spacer(Modifier.height(20.dp))
        }
        EmergencyButton(view.emergencyNumber)
        Spacer(Modifier.height(40.dp))
        HoldButton("Hold: I'm safe") { KidService.endSos(context) }
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Hold for 2 seconds when you are safe.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.7f),
        )
    }
}

/** A white 72 dp pill that fills with green from the left while it is held; [onDone] after 2 seconds. */
@Composable
private fun HoldButton(text: String, onDone: () -> Unit) {
    val context = LocalContext.current
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    Box(
        modifier = Modifier
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .height(72.dp)
            .clip(RoundedCornerShape(36.dp))
            .background(Color.White)
            .semantics { contentDescription = "$text. Press and hold for 2 seconds." }
            .hold(
                progress = progress,
                scope = scope,
                onTap = { Toast.makeText(context, "Hold it for 2 seconds", Toast.LENGTH_SHORT).show() },
                onDone = onDone,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .fillMaxHeight()
                .fillMaxWidth(progress.value)
                .background(SafeGreen.copy(alpha = 0.35f)),
        )
        Text(
            text = text,
            modifier = Modifier.clearAndSetSemantics { },
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = SafeGreen,
        )
    }
}

/**
 * Press and hold: [progress] runs from 0 to 1 in 2 seconds while the finger stays down, then [onDone]. Let go
 * sooner and it runs back to 0; a short tap is [onTap].
 */
private fun Modifier.hold(
    progress: Animatable<Float, AnimationVector1D>,
    scope: CoroutineScope,
    onTap: () -> Unit,
    onDone: () -> Unit,
): Modifier = composed {
    val tap by rememberUpdatedState(onTap)
    val done by rememberUpdatedState(onDone)
    pointerInput(Unit) {
        detectTapGestures(
            onPress = {
                val run = scope.launch(RealTime) {
                    progress.snapTo(0f)
                    progress.animateTo(1f, tween(HOLD_MS, easing = LinearEasing))
                    done()
                    progress.snapTo(0f)
                }
                tryAwaitRelease()
                if (run.isActive) {
                    run.cancel()
                    if (progress.value < 0.15f) tap()
                    scope.launch { progress.animateTo(0f, tween(200)) }
                }
            },
        )
    }
}
```

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt`

Replace the whole file. Compared with `main`: one import and two new flows, `sos` and `sosCountdown`.

```kotlin
package au.screentime.kid.status

import au.screentime.kid.live.Answer
import au.screentime.kid.live.ParentModeNews
import au.screentime.kid.sos.SosView
import kotlinx.coroutines.flow.MutableStateFlow

/** The latest status, from the service to the screens of the same process. Null until the first sync. */
object StatusHub {
    val status = MutableStateFlow<KidStatus?>(null)

    /** A parent's answer that just came in; the screen showing it sets it back to null after 4 seconds. */
    val answer = MutableStateFlow<Answer?>(null)

    /** True while the "Hand to a parent" sheet is open: the service keeps the live channel open for the answer. */
    val parentModeAsked = MutableStateFlow(false)

    /** The last `parent_mode` message; the "Hand to a parent" sheet shows a no. */
    val parentModeNews = MutableStateFlow<ParentModeNews?>(null)

    /** The SOS that is on (docs/SPEC.md §15); the screens show it over everything. */
    val sos = MutableStateFlow<SosView?>(null)

    /**
     * `SystemClock.elapsedRealtime()` when the SOS countdown started, `SOS_FIRED` once it finished, null when there is
     * none. The service sets it back to null when it shows the SOS.
     */
    val sosCountdown = MutableStateFlow<Long?>(null)
}
```

### 5.7 `android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt`

Replace the whole file. Compared with `main`: the comment, imports, `SosLayer` around the screen, room at the end of the greeting, and the **SOS** button in the top corner.

```kotlin
package au.screentime.kid.home

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.screentime.core.time.formatDuration
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.ask.AskAndMessage
import au.screentime.kid.ask.Look
import au.screentime.kid.parentmode.ParentButton
import au.screentime.kid.parentmode.ParentModeBanner
import au.screentime.kid.sos.SosButton
import au.screentime.kid.sos.SosLayer
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Level
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.delay

/**
 * The kid's main screen (docs/SPEC.md §16.2): "Hi Alex", the ring with the time left, bedtime, "Offline · still
 * counting" when the last sync failed, **Ask for more time**, **Message Mum and Dad** and **I'm the parent**; in
 * parent mode the parent mode banner with **End now**. A phone with a SIM has the **SOS** button in the top corner,
 * and the SOS screens cover everything while they are up.
 */
@Composable
fun HomeScreen() {
    val status by StatusHub.status.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        val s = status
        if (s == null) Waiting() else SosLayer { Home(s) }
    }
}

/** Before the first sync after the app started. */
@Composable
private fun Waiting() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text("Getting your time…", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Home(s: KidStatus) {
    // The time left counts down every second on the screen; the service sends a new status at least once a minute.
    var elapsed by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            elapsed = SystemClock.elapsedRealtime()
        }
    }
    val left = s.leftSecAt(elapsed)

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(24.dp),
    ) {
        if (maxWidth >= 600.dp) {
            // Tablet or landscape: the ring on the left half, the words and buttons on the right.
            Row(modifier = Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    Ring(s, left)
                }
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Greeting(s.kidName)
                    Spacer(Modifier.height(16.dp))
                    Details(s, TextAlign.Start)
                    Spacer(Modifier.height(24.dp))
                    KidActions(s)
                }
            }
        } else {
            Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                Greeting(s.kidName, Modifier.fillMaxWidth().padding(end = 80.dp))
                Spacer(Modifier.weight(1f))
                Ring(s, left)
                Spacer(Modifier.height(24.dp))
                Details(s, TextAlign.Center)
                Spacer(Modifier.weight(1f))
                KidActions(s)
            }
        }
        if (s.canCall) SosButton(Look.DAY, Modifier.align(Alignment.TopEnd))
    }
}

/**
 * **Ask for more time**, **Message Mum and Dad** and **I'm the parent**; while parent mode is on, the parent mode
 * banner with **End now** instead.
 */
@Composable
private fun KidActions(s: KidStatus) {
    if (s.parentMode) {
        ParentModeBanner(s)
    } else {
        AskAndMessage(s, Look.DAY)
        Spacer(Modifier.height(8.dp))
        ParentButton(
            s,
            Look.DAY,
            Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth(),
        )
    }
}

@Composable
private fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(
        text = "Hi $name",
        modifier = modifier,
        style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** "Bedtime 8:30 pm" (or when a locked device is back), and the offline line. */
@Composable
private fun Details(s: KidStatus, align: TextAlign) {
    s.subline()?.let {
        Text(
            text = it,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = align,
        )
    }
    if (!s.online && !s.parentMode) {
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Offline · still counting",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = align,
        )
    }
}

/** The 240 dp ring: the time left (or why it is locked) in the middle, the arc coloured by how much is left. */
@Composable
private fun Ring(s: KidStatus, left: Long) {
    val colors = ScreenTimeTheme.colors
    val track = MaterialTheme.colorScheme.surfaceVariant
    val arc: Color = when (s.level(left)) {
        Level.PLENTY -> colors.primary
        Level.LOW -> colors.warning
        Level.CRITICAL -> colors.critical
        Level.LOCKED -> track
    }
    val fraction = s.ringFraction(left)
    val description = s.lockReason?.let { s.headline(it) } ?: "${formatDuration(left)} of ${s.poolName} left"

    Box(
        modifier = Modifier
            .size(240.dp)
            .clearAndSetSemantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 20.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            val topLeft = Offset(inset, inset)
            drawArc(track, 0f, 360f, useCenter = false, topLeft = topLeft, size = arcSize, style = Stroke(stroke))
            if (fraction > 0f) {
                drawArc(
                    arc,
                    startAngle = -90f,
                    sweepAngle = 360f * fraction,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
            }
        }
        Column(modifier = Modifier.width(176.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val reason = s.lockReason
            if (reason == null) {
                Text(
                    text = s.ringText(left),
                    style = MaterialTheme.typography.displayMedium.copy(fontFeatureSettings = "tnum"),
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 1,
                )
                Text(
                    text = "${s.poolName} left",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(
                    text = s.headline(reason),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
```

### 5.8 `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt`

Replace the whole file. Compared with `main`: the comment, imports, `SosLayer` around the screen, and the clock in a full-width box with the **SOS** button at its end.

```kotlin
package au.screentime.kid.block

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.time.LockReason
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.ask.AskAndMessage
import au.screentime.kid.ask.Look
import au.screentime.kid.calls.ContactRow
import au.screentime.kid.calls.EmergencyButton
import au.screentime.kid.parentmode.ParentButton
import au.screentime.kid.sos.SosButton
import au.screentime.kid.sos.SosLayer
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.clockText
import java.time.LocalTime
import kotlinx.coroutines.delay

/**
 * The block screen's content (docs/SPEC.md §16.2): the time at the top, a moon or an hourglass, "It's bedtime",
 * when the device is back, and **Ask for more time** and **Message Mum and Dad**. A phone with a SIM also has the
 * row of call buttons above them, **Emergency 000** under them and the **SOS** button in the top corner; the SOS
 * screens cover everything while they are up. **I'm the parent** is last.
 * When it all does not fit (a phone on its side), the screen scrolls; otherwise the gaps share the spare height.
 */
@Composable
fun BlockScreen(status: KidStatus) {
    val reason = status.lockReason ?: return
    SosLayer { Blocked(status, reason) }
}

@Composable
private fun Blocked(status: KidStatus, reason: LockReason) {
    val colors = ScreenTimeTheme.colors
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(colors.nightTop, colors.nightBottom)))
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Clock(colors.onNight.copy(alpha = 0.7f))
            if (status.canCall) SosButton(Look.NIGHT, Modifier.align(Alignment.CenterEnd))
        }
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            if (reason == LockReason.OUT_OF_TIME) Hourglass(colors.onNight) else MoonAndStars(colors.onNight)
            Spacer(Modifier.height(32.dp))
            Text(
                text = status.headline(reason),
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                color = colors.onNight,
                textAlign = TextAlign.Center,
            )
            status.subline()?.let {
                Spacer(Modifier.height(12.dp))
                Text(
                    text = it,
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.onNight,
                    textAlign = TextAlign.Center,
                )
            }
        }
        Spacer(Modifier.weight(1f))
        Spacer(Modifier.height(24.dp))
        if (status.canCall && status.callables.isNotEmpty()) {
            ContactRow(status.callables)
            Spacer(Modifier.height(20.dp))
        }
        AskAndMessage(status, Look.NIGHT)
        if (status.canCall) {
            Spacer(Modifier.height(12.dp))
            EmergencyButton(status.emergencyNumber)
        }
        Spacer(Modifier.height(8.dp))
        ParentButton(status, Look.NIGHT)
    }
}

/** The time of day, small, updated every 10 seconds. The device's clock is set automatically (docs/SPEC.md §12.1). */
@Composable
private fun Clock(color: Color) {
    var now by remember { mutableStateOf(clockText(LocalTime.now())) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(10_000)
            now = clockText(LocalTime.now())
        }
    }
    Text(text = now, style = MaterialTheme.typography.titleMedium, color = color)
}

/** Bedtime and early morning: a crescent moon with three stars, 160 dp, flat. */
@Composable
private fun MoonAndStars(color: Color) {
    Canvas(
        modifier = Modifier
            .size(160.dp)
            .clearAndSetSemantics { },
    ) {
        val w = size.width
        val moon = Path().apply { addOval(Rect(Offset(w * 0.42f, w * 0.5f), w * 0.3f)) }
        val bite = Path().apply { addOval(Rect(Offset(w * 0.58f, w * 0.38f), w * 0.26f)) }
        drawPath(Path.combine(PathOperation.Difference, moon, bite), color)
        drawCircle(color, radius = w * 0.035f, center = Offset(w * 0.78f, w * 0.22f))
        drawCircle(color, radius = w * 0.025f, center = Offset(w * 0.9f, w * 0.46f))
        drawCircle(color, radius = w * 0.02f, center = Offset(w * 0.66f, w * 0.1f))
    }
}

/** Out of time: an hourglass, 160 dp, flat. */
@Composable
private fun Hourglass(color: Color) {
    Canvas(
        modifier = Modifier
            .size(160.dp)
            .clearAndSetSemantics { },
    ) {
        val w = size.width
        val h = size.height
        val glass = Path().apply {
            moveTo(w * 0.28f, h * 0.16f)
            lineTo(w * 0.72f, h * 0.16f)
            lineTo(w * 0.5f, h * 0.5f)
            lineTo(w * 0.72f, h * 0.84f)
            lineTo(w * 0.28f, h * 0.84f)
            lineTo(w * 0.5f, h * 0.5f)
            close()
        }
        drawPath(glass, color.copy(alpha = 0.35f))
        // The sand has all run to the bottom.
        val sand = Path().apply {
            moveTo(w * 0.5f, h * 0.62f)
            lineTo(w * 0.66f, h * 0.84f)
            lineTo(w * 0.34f, h * 0.84f)
            close()
        }
        drawPath(sand, color)
        val bar = h * 0.05f
        drawLine(color, Offset(w * 0.22f, h * 0.14f), Offset(w * 0.78f, h * 0.14f), strokeWidth = bar)
        drawLine(color, Offset(w * 0.22f, h * 0.86f), Offset(w * 0.78f, h * 0.86f), strokeWidth = bar)
    }
}
```

### 5.9 `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt`

Replace the whole file. Compared with `main`: one import, the comment, and `showStatus` takes the SOS: the title "SOS is on", the line under it, and no countdown during an SOS.

```kotlin
package au.screentime.kid.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.VibrationEffect
import android.os.VibratorManager
import au.screentime.kid.MainActivity
import au.screentime.kid.R
import au.screentime.kid.ask.answerText
import au.screentime.kid.live.Answer
import au.screentime.kid.sos.SosView
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Warning
import au.screentime.kid.status.warningText
import au.screentime.kid.status.warningTitle

/**
 * The kid app's notifications (docs/SPEC.md §16.2): the silent status notification of the foreground service (with
 * **End now** while parent mode is on), the heads-up warnings before a lock, and a parent's answer to "Ask for more
 * time".
 */
class Notifier(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(
            NotificationChannel(STATUS_CHANNEL, "Screen Time", NotificationManager.IMPORTANCE_LOW),
        )
        manager.createNotificationChannel(
            NotificationChannel(WARNING_CHANNEL, "Time warnings", NotificationManager.IMPORTANCE_HIGH).apply {
                // Heads-up without a sound; the phone buzzes itself at the second warning.
                setSound(null, null)
                enableVibration(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(ANSWER_CHANNEL, "Answers from your parents", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(false)
            },
        )
    }

    /** Opens the main screen. */
    private val openApp: PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** Ends parent mode through the service. */
    private val endParentMode: PendingIntent = PendingIntent.getService(
        context,
        1,
        Intent(context, KidService::class.java).setAction(KidService.ACTION_END_PARENT_MODE),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** What the service shows before the first sync. */
    fun starting(): Notification = Notification.Builder(context, STATUS_CHANNEL)
        .setSmallIcon(R.drawable.ic_status)
        .setContentTitle("Screen Time")
        .setContentText("Screen Time is on")
        .setContentIntent(openApp)
        .setOngoing(true)
        .build()

    /**
     * "Phone · 1h 12m left", "Bedtime 8:30 pm", with the system chronometer counting down to the lock. The
     * chronometer runs on the wall clock, so the lock is moved by the gap between the trusted clock ([nowMs]) and it.
     * In parent mode: "Parent mode · ends 4:15 pm", "Time isn't counting" and **End now**. During an [sos]: "SOS is
     * on" and who has seen it, or how far it got.
     */
    fun showStatus(status: KidStatus, nowMs: Long, sos: SosView? = null) {
        val builder = Notification.Builder(context, STATUS_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(if (sos != null) "SOS is on" else status.title())
            .setContentText(sos?.let { it.seenLine() ?: it.line() } ?: status.subline())
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
        if (!status.online) builder.setSubText("Offline")
        if (status.parentMode) {
            builder.addAction(Notification.Action.Builder(null, "End now", endParentMode).build())
        }
        val lockAt = status.lockAtMs
        if (lockAt != null && sos == null) {
            builder
                .setWhen(System.currentTimeMillis() + (lockAt - nowMs))
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        } else {
            builder.setShowWhen(false)
        }
        manager.notify(STATUS_ID, builder.build())
    }

    /** A heads-up warning; it goes away by itself when the device locks. The second one buzzes on a phone. */
    fun showWarning(status: KidStatus, warning: Warning) {
        val notification = Notification.Builder(context, WARNING_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(warningTitle(status, warning))
            .setContentText(warningText(status, warning))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setTimeoutAfter(maxOf(1_000L, status.leftSec * 1000))
            .build()
        manager.notify(WARNING_ID, notification)
        if (warning == Warning.SECOND && status.deviceWord == "phone") {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
                .vibrate(VibrationEffect.createWaveform(longArrayOf(0, 250, 150, 250), -1))
        }
    }

    /** "Dad said yes! +15 min 🎉" or "Dad said not this time", heads-up; it goes away by itself after a minute. */
    fun showAnswer(answer: Answer) {
        val notification = Notification.Builder(context, ANSWER_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(answerText(answer))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000L)
            .build()
        manager.notify(ANSWER_ID, notification)
    }

    fun cancelWarning() {
        manager.cancel(WARNING_ID)
    }

    companion object {
        const val STATUS_ID = 1
        private const val WARNING_ID = 2
        private const val ANSWER_ID = 3
        private const val STATUS_CHANNEL = "status"
        private const val WARNING_CHANNEL = "warnings"
        private const val ANSWER_CHANNEL = "answers"
    }
}
```

### 5.10 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

Replace the whole file. Compared with `main`: the comment, four imports, the `SosController` and the `sosOn` flag (an SOS is on: nothing counts), the SOS news from the live channel, the loop's 30-second wait and tick during an SOS, the two new actions in `onStartCommand`, the SOS in `inUse`, `onScreenOn`, `sync`, `report()` and `updateLive`, and the two new functions in the companion.

```kotlin
package au.screentime.kid.service

import android.app.KeyguardManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import au.screentime.core.model.api.ApiClient
import au.screentime.core.time.evaluate
import au.screentime.kid.admin.Policies
import au.screentime.kid.block.BlockActivity
import au.screentime.kid.data.FileStateStore
import au.screentime.kid.data.KidDatabase
import au.screentime.kid.data.PrefsClockStore
import au.screentime.kid.data.RoomSegmentStore
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.live.Answer
import au.screentime.kid.live.LiveChannel
import au.screentime.kid.live.answerOf
import au.screentime.kid.live.liveUrl
import au.screentime.kid.live.parentModeNewsOf
import au.screentime.kid.parentmode.CodeSession
import au.screentime.kid.parentmode.ParentModeApi
import au.screentime.kid.parentmode.ParentModeStore
import au.screentime.kid.parentmode.parentModeNow
import au.screentime.kid.sos.SOS_TICK_MS
import au.screentime.kid.sos.SosApi
import au.screentime.kid.sos.SosController
import au.screentime.kid.sos.sosNewsOf
import au.screentime.kid.status.StatusHub
import au.screentime.kid.status.WarningTracker
import au.screentime.kid.status.kidStatus
import au.screentime.kid.status.nextCheckAtMs
import au.screentime.kid.sync.Syncer
import au.screentime.kid.sync.TrustedClock
import au.screentime.kid.usage.Recorder
import au.screentime.kid.usage.dayStartMs
import au.screentime.kid.usage.todayInput
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import java.time.OffsetDateTime
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The always-on part of the kid app (docs/SPEC.md §12.1, "Foreground service"): records usage segments from the
 * screen and unlock broadcasts, syncs with the server (§8.3), and keeps the notification, the warnings and the main
 * screen up to date (§16.2), and shows the block screen while the engine says the device is locked (§12.1). While the
 * block screen can be seen, or the kid waits for an answer to "Ask for more time" or "I'm the parent", or parent mode is
 * on, or an SOS is on, it also keeps the live channel open (§8.3), so a parent's grant or answer shows within
 * seconds. While parent mode is on (§12.3) the device is not blocked and nothing counts. While an SOS is on (§15)
 * nothing counts either, and [SosController] takes a position and sends it every 30 seconds, screen on or off.
 * Everything runs one at a time on [scope], so the database and the parent mode store see one change after another.
 */
class KidService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    private lateinit var clock: TrustedClock
    private lateinit var recorder: Recorder
    private lateinit var segments: RoomSegmentStore
    private lateinit var states: FileStateStore
    private lateinit var syncer: Syncer
    private lateinit var notifier: Notifier
    private lateinit var parentStore: ParentModeStore
    private var parentApi: ParentModeApi? = null
    private lateinit var sos: SosController
    private var engine: HttpClientEngine? = null
    private var api: ApiClient? = null
    private var live: LiveChannel? = null
    private var liveJob: Job? = null
    private var started = false

    /** [SystemClock.elapsedRealtime] of the last sync, for "every 5 minutes" and "if the last sync is older than 2 minutes". */
    private var lastSyncElapsed = 0L
    private var lastSyncOk = true

    /**
     * The live channel has news (or just connected), or a screen sent something; the loop syncs, so a sync never runs
     * inside the live channel.
     */
    @Volatile
    private var syncWanted = false

    /** One sync at a time: a slow sync that is failing must not overlap the next one. */
    private val syncLock = Mutex()

    /** The engine said locked at the last run: the block screen is up and nothing counts (docs/SPEC.md §12.1). */
    private var blocked = false

    /** Parent mode was on at the last run: not blocked, and nothing counts (docs/SPEC.md §12.3). */
    private var paused = false

    /** An SOS was on at the last run: nothing counts (docs/SPEC.md §15 step 8). */
    private var sosOn = false

    private val warnings = WarningTracker()

    /** Trusted time of the next warning, lock or new period, so the loop wakes up for it (at least once a minute). */
    private var nextCheckAt = 0L

    /** Wakes the loop early, when an unlock or a sync has moved [nextCheckAt], or the live channel has news. */
    private val wake = Channel<Unit>(Channel.CONFLATED)

    private val screen = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val at = clock.nowMs()
            when (intent.action) {
                Intent.ACTION_USER_PRESENT, Intent.ACTION_SCREEN_ON -> scope.launch { onScreenOn(at) }
                Intent.ACTION_SCREEN_OFF -> scope.launch {
                    recorder.stop(at)
                    sync()
                }
            }
        }
    }

    private val network = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            scope.launch { if (!lastSyncOk) sync() }
        }
    }

    override fun onCreate() {
        super.onCreate()
        // A service started with startForegroundService must call startForeground first, even if it stops at once.
        notifier = Notifier(this)
        startForeground(Notifier.STATUS_ID, notifier.starting(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
        val enrolment = EnrolmentStore(this).load()
        if (enrolment?.confirmed != true) {
            stopSelf()
            return
        }
        // Again on every start, so an app update gets the policies it added (Lock Task in CARD-033).
        Policies.apply(this)

        clock = TrustedClock(
            store = PrefsClockStore(this),
            elapsed = SystemClock::elapsedRealtime,
            wall = System::currentTimeMillis,
            bootCount = { Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT, 0) },
        )
        parentStore = ParentModeStore(this)
        segments = RoomSegmentStore(KidDatabase.open(this).segments())
        states = FileStateStore(this)
        recorder = Recorder(segments) { UUID.randomUUID().toString() }
        val http = OkHttp.create()
        val client = ApiClient(enrolment.serverUrl, http, token = { enrolment.deviceToken })
        engine = http
        api = client
        parentApi = ParentModeApi(client)
        sos = SosController(this, clock, SosApi(client))
        sos.resume()
        syncer = Syncer(client, segments, states, clock, log = { Log.w(TAG, it) })
        live = LiveChannel(
            engine = http,
            url = liveUrl(enrolment.serverUrl),
            token = { enrolment.deviceToken },
            onNews = { frame ->
                frame?.let(::answerOf)?.let(::onAnswer)
                frame?.let(::parentModeNewsOf)?.let {
                    Log.i(TAG, "parent mode: news active=${it.active}")
                    StatusHub.parentModeNews.value = it
                }
                frame?.let(::sosNewsOf)?.let { news ->
                    scope.launch {
                        sos.onNews(news)
                        report()
                    }
                }
                syncWanted = true
                wake.trySend(Unit)
            },
            log = { Log.i(TAG, "live: $it") },
        )

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED)
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(network)
        started = true

        scope.launch {
            // A segment left open by a crash, a reboot or an update ends where it was last seen.
            recorder.closeOpen()
            if (inUse()) recorder.start(clock.nowMs())
            sync()
            while (isActive) {
                // While in use, or in parent mode with the screen on, until the next warning, lock, period or end of
                // parent mode (at least once a minute; in parent mode a sync then if the live channel is down, to see
                // a parent end it). Blocked with the screen on, the same while the live channel is open; while it is
                // down, at least every 30 seconds, to see a parent's grant soon. Otherwise a minute. During an SOS, at
                // least every 30 seconds whatever the screen does.
                val untilNext = (nextCheckAt - clock.nowMs()).coerceIn(SECOND, MINUTE)
                val normal = when {
                    inUse() || (paused && screenOn()) -> untilNext
                    blocked && screenOn() -> if (live?.connected == true) untilNext else minOf(untilNext, BLOCKED_POLL)
                    else -> MINUTE
                }
                val wait = if (sos.active) minOf(normal, SOS_TICK_MS) else normal
                // Woken early: sync if the live channel asked for it, then work out the wait again.
                if (withTimeoutOrNull(wait) { wake.receive() } != null) {
                    if (syncWanted) sync()
                    continue
                }
                if (sos.active) sos.tick()
                when {
                    inUse() -> {
                        recorder.tick(clock.nowMs())
                        if (SystemClock.elapsedRealtime() - lastSyncElapsed >= 5 * MINUTE) sync() else report()
                    }
                    blocked && screenOn() -> if (live?.connected == true) report() else sync()
                    paused && screenOn() -> if (live?.connected == true) report() else sync()
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!started) return START_STICKY
        when (intent?.action) {
            // A screen just sent something (docs/SPEC.md §16.2): sync soon, so the next snapshot shows it.
            ACTION_SYNC -> {
                syncWanted = true
                wake.trySend(Unit)
            }
            ACTION_PARENT_CODE -> {
                val minutes = intent.getIntExtra(EXTRA_MINUTES, 0).takeIf { it > 0 }
                scope.launch { startWithCode(minutes) }
            }
            ACTION_END_PARENT_MODE -> scope.launch { endParentMode() }
            ACTION_SOS_START -> scope.launch {
                sos.start()
                StatusHub.sosCountdown.value = null
                report()
            }
            ACTION_SOS_END -> scope.launch {
                sos.endByKid()
                report()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (started) {
            unregisterReceiver(screen)
            getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(network)
        }
        scope.cancel()
        live?.close()
        api?.close()
        engine?.close()
        super.onDestroy()
    }

    private fun screenOn(): Boolean = getSystemService(PowerManager::class.java).isInteractive

    /**
     * The screen is on and unlocked, not blocked by us, not in parent mode and no SOS: counting (docs/SPEC.md §3, Q19,
     * §12, §15).
     */
    private fun inUse(): Boolean =
        screenOn() && !getSystemService(KeyguardManager::class.java).isKeyguardLocked && !blocked && !paused && !sosOn

    private suspend fun onScreenOn(at: Long) {
        val stale = !lastSyncOk || SystemClock.elapsedRealtime() - lastSyncElapsed >= 2 * MINUTE
        if (blocked || paused || sosOn) {
            // The block screen comes back up through report(); a fresh sync may bring a grant, or the end of parent
            // mode.
            if (stale) sync() else report()
            return
        }
        // Screen on without a lock screen, or the unlock after it: only one segment either way.
        if (!inUse() || segments.open() != null) return
        recorder.start(at)
        if (stale) sync() else report()
    }

    /** A parent answered "Ask for more time": the screens show it for 4 seconds, and a heads-up says it too. */
    private fun onAnswer(answer: Answer) {
        Log.i(TAG, "answer: approved=${answer.approved} minutes=${answer.minutes}")
        StatusHub.answer.value = answer
        notifier.showAnswer(answer)
    }

    /** The parent code was right and a parent picked how long (docs/SPEC.md §12.3): parent mode starts here and now. */
    private suspend fun startWithCode(minutes: Int?) {
        val local = parentStore.load()
        parentStore.save(local.copy(code = CodeSession(UUID.randomUUID().toString(), minutes, clock.nowMs())))
        Log.i(TAG, "parent mode: started with the code for ${minutes?.let { "$it min" } ?: "until ended"}")
        sync()
    }

    /** **End now**, on the main screen or the notification. */
    private suspend fun endParentMode() {
        parentStore.save(parentStore.load().copy(endedAtMs = clock.nowMs(), endReported = false))
        Log.i(TAG, "parent mode: ended on this device")
        sync()
    }

    private suspend fun sync() {
        syncLock.withLock {
            // This sync also brings whatever the live channel announced.
            syncWanted = false
            // What the server must hear about parent mode goes first, so the snapshot after it shows it.
            val local = parentStore.load()
            if (local.pending) parentApi?.let { parentStore.save(it.flush(local, clock.nowMs())) }
            // And whatever an SOS still has to send.
            if (sos.pending) sos.tick()
            val ok = syncer.sync()
            lastSyncElapsed = SystemClock.elapsedRealtime()
            lastSyncOk = ok
            if (ok) {
                segments.prune(clock.nowMs() - KEEP_DAYS * 24 * 60 * MINUTE)
            } else {
                recorder.markOffline()
            }
        }
        report()
    }

    /**
     * Runs the engine and shows what it says: the notification, a warning when one is due (only while in use), the
     * main screen through [StatusHub], the block screen, the live channel, and the log (`adb logcat -s KidService`).
     * Becoming locked ends the open segment; becoming unlocked starts one if the device is in use.
     */
    private suspend fun report() {
        val now = clock.nowMs()
        nextCheckAt = now + MINUTE
        val cached = states.load() ?: return
        val own = segments.since(dayStartMs(cached.state, now))
        val result = evaluate(todayInput(cached.state, own, now))
        val serverTimeMs = OffsetDateTime.parse(cached.state.serverTime).toInstant().toEpochMilli()
        val parentMode = parentModeNow(cached.state.parentMode, serverTimeMs, parentStore.load(), now)
        val status = kidStatus(cached.state, result, now, lastSyncOk, SystemClock.elapsedRealtime(), parentMode)
        sos.onSnapshot(cached.state, serverTimeMs)

        // Counting stops when the device becomes blocked, parent mode starts or an SOS starts, and starts again after
        // all three.
        val wasCounting = !blocked && !paused && !sosOn
        blocked = status.locked
        if (paused != (parentMode != null)) Log.i(TAG, "parent mode: ${if (parentMode != null) "on" else "off"}")
        paused = parentMode != null
        if (sosOn != sos.active) Log.i(TAG, "sos: ${if (sos.active) "on" else "off"}")
        sosOn = sos.active
        val counting = !blocked && !paused && !sosOn
        if (wasCounting && !counting) recorder.stop(now)
        if (!wasCounting && counting && inUse()) recorder.start(now)

        StatusHub.status.value = status
        // The block screen closes itself when StatusHub says unlocked.
        if (blocked && screenOn()) BlockActivity.show(this)
        updateLive(waiting = status.pendingMinutes != null || StatusHub.parentModeAsked.value)
        notifier.showStatus(status, now, StatusHub.sos.value)
        if (status.locked) {
            notifier.cancelWarning()
        } else if (inUse()) {
            warnings.check(status)?.let { notifier.showWarning(status, it) }
        }
        nextCheckAt = nextCheckAtMs(status, now)
        wake.trySend(Unit)
        Log.i(
            TAG,
            "pool=${cached.state.device.pool.wire} used=${result.usedSec}s remaining=${result.remainingSec}s " +
                "left=${status.leftSec}s locked=${status.locked} parentMode=$paused sos=$sosOn online=$lastSyncOk " +
                "segments=${own.size}",
        )
    }

    /**
     * The live channel is open only while the screen is on and something may come: blocked (docs/SPEC.md §8.3),
     * [waiting] for an answer to "Ask for more time" or "I'm the parent", in parent mode (a parent may end it), or
     * during an SOS (a parent's "I'm on it"). Otherwise FCM covers the rest (CARD-034b).
     */
    private fun updateLive(waiting: Boolean) {
        val channel = live ?: return
        val want = screenOn() && (blocked || waiting || paused || sosOn)
        if (want && liveJob == null) {
            Log.i(TAG, "live: started")
            liveJob = scope.launch { channel.run() }
        } else if (!want && liveJob != null) {
            Log.i(TAG, "live: stopped")
            liveJob?.cancel()
            liveJob = null
        }
    }

    companion object {
        private const val TAG = "KidService"
        private const val SECOND = 1_000L
        private const val MINUTE = 60_000L

        /** How often a blocked device with the screen on asks the server for news while the live channel is down. */
        private const val BLOCKED_POLL = 30_000L

        /** Sent segments are kept this long, then forgotten (docs/SPEC.md §8.3, offline buffer). */
        private const val KEEP_DAYS = 30L

        private const val ACTION_SYNC = "au.screentime.kid.action.SYNC"
        private const val ACTION_PARENT_CODE = "au.screentime.kid.action.PARENT_CODE"
        private const val EXTRA_MINUTES = "minutes"

        /** **End now** in the notification uses it too. */
        const val ACTION_END_PARENT_MODE = "au.screentime.kid.action.END_PARENT_MODE"

        private const val ACTION_SOS_START = "au.screentime.kid.action.SOS_START"
        private const val ACTION_SOS_END = "au.screentime.kid.action.SOS_END"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, KidService::class.java))
        }

        /** From a screen of the app, which is in front: sync as soon as the service can. */
        fun syncSoon(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_SYNC))
        }

        /** After a right parent code: parent mode for [minutes], or until ended when null. */
        fun startParentMode(context: Context, minutes: Int?) {
            context.startService(
                Intent(context, KidService::class.java)
                    .setAction(ACTION_PARENT_CODE)
                    .putExtra(EXTRA_MINUTES, minutes ?: 0),
            )
        }

        /** **End now** on the main screen. */
        fun endParentMode(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_END_PARENT_MODE))
        }

        /** The SOS countdown finished: the SOS starts (docs/SPEC.md §15). */
        fun startSos(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_SOS_START))
        }

        /** The kid held **I'm safe**. */
        fun endSos(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_SOS_END))
        }
    }
}
```

### 5.11 `android/app-kid/src/test/kotlin/au/screentime/kid/sos/SosTest.kt`

```kotlin
package au.screentime.kid.sos

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.DeviceStateActiveSos
import au.screentime.kid.calls.Callable
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
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SosTest {
    private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

    private val start = ms("2026-10-27T05:00:00Z")
    private val minute = 60_000L

    private fun fix(at: Long, lat: Double = -33.8688, lng: Double = 151.2093) =
        SosFix(atMs = at, lat = lat, lng = lng, accuracyM = 20.4, batteryPct = 54)

    @Test
    fun anSosRunsForTwoHoursAndTakesOnlyNewerPositions() {
        val sos = startSos("s1", start)

        assertTrue(sos.active)
        assertFalse(sos.done)
        assertEquals(start + 2 * 60 * minute, sos.autoStopAtMs)
        val one = sos.withFix(fix(start + 1_000))
        assertEquals(listOf(fix(start + 1_000)), one.queue)
        assertEquals(one, one.withFix(fix(start + 1_000)))
        assertEquals(one, one.withFix(fix(start)))
        val two = one.withFix(fix(start + 31_000))
        assertEquals(2, two.queue.size)
        assertEquals(fix(start + 31_000), two.lastFix)
        val ended = two.endedByKid(start + 40_000)
        assertEquals(ended, ended.withFix(fix(start + 61_000)))
    }

    @Test
    fun withoutTheServerItTextsAgainEveryFiveMinutes() {
        val sos = startSos("s1", start).withFix(fix(start + 1_000)).textSent(start + 2_000)

        assertTrue(sos.queue.single().bySms)
        assertFalse(sos.textDue(start + 2_000 + 5 * minute - 1))
        assertTrue(sos.textDue(start + 2_000 + 5 * minute))
        // The server answered a minute ago: no text.
        val online = sos.copy(lastDataAtMs = start + 4 * minute)
        assertFalse(online.textDue(start + 2_000 + 5 * minute))
        assertTrue(online.textDue(start + 9 * minute))
        assertFalse(sos.endedByKid(start + minute).textDue(start + 10 * minute))
    }

    @Test
    fun itEndsByTheKidByItselfOrWhenTheSnapshotNoLongerHasIt() {
        val sos = startSos("s1", start)

        val safe = sos.endedByKid(start + minute)
        assertEquals(SosEnd.KID, safe.endedBy)
        assertFalse(safe.endReported)
        assertEquals(safe, safe.endedByKid(start + 2 * minute))

        assertEquals(sos, sos.autoStopped(sos.autoStopAtMs - 1))
        val auto = sos.autoStopped(sos.autoStopAtMs + minute)
        assertEquals(SosEnd.AUTO, auto.endedBy)
        assertEquals(sos.autoStopAtMs, auto.endedAtMs)
        assertTrue(auto.endReported)

        // Not on the server yet, or the snapshot is older than the start: nothing to learn from it.
        assertEquals(sos, sos.checkedAgainst(null, start + minute, start + minute))
        val reported = sos.copy(startReportedAtMs = start + 1_000)
        assertEquals(reported, reported.checkedAgainst(null, start + 500, start + minute))
        assertEquals(reported, reported.checkedAgainst(DeviceStateActiveSos("s1", "2026-10-27T05:00:00Z"), start + minute, start + minute))
        val gone = reported.checkedAgainst(null, start + 2_000, start + minute)
        assertEquals(SosEnd.PARENT, gone.endedBy)
        assertNull(gone.endedByName)
        assertTrue(gone.endReported)
    }

    @Test
    fun theParentsNewsIsReadFromTheThreeSosMessages() {
        val ack = """{"v":1,"type":"sos_ack","at":"2026-10-27T05:01:00Z","data":{"sosId":"s1","byName":"Dad"}}"""
        val extended = """{"v":1,"type":"sos_extended","at":"2026-10-27T06:59:00Z","data":""" +
            """{"sosId":"s1","byName":"Mum","autoStopAt":"2026-10-27T09:00:00.000Z"}}"""
        val ended = """{"v":1,"type":"sos_ended","at":"2026-10-27T05:20:00Z","data":{"sosId":"s1","byName":"Dad"}}"""

        assertEquals(SosNews("sos_ack", "s1", "Dad", null), sosNewsOf(ack))
        assertEquals(SosNews("sos_extended", "s1", "Mum", ms("2026-10-27T09:00:00Z")), sosNewsOf(extended))
        assertEquals(SosNews("sos_ended", "s1", "Dad", null), sosNewsOf(ended))
        assertNull(sosNewsOf("""{"v":1,"type":"grant_added","data":{"sosId":"s1","byName":"Dad"}}"""))
        assertNull(sosNewsOf("""{"v":1,"type":"sos_ack","data":{"sosId":"s1"}}"""))
        assertNull(sosNewsOf("""{"v":1,"type":"sos_extended","data":{"sosId":"s1","byName":"Mum","autoStopAt":"soon"}}"""))
        assertNull(sosNewsOf("not json"))
    }

    @Test
    fun newsChangesOnlyThisSos() {
        val sos = startSos("s1", start)

        val seen = sos.withNews(SosNews("sos_ack", "s1", "Dad", null), start + minute)
        assertEquals(listOf("Dad"), seen.seenBy)
        assertEquals(seen, seen.withNews(SosNews("sos_ack", "s1", "Dad", null), start + 2 * minute))
        assertEquals(listOf("Dad", "Mum"), seen.withNews(SosNews("sos_ack", "s1", "Mum", null), start + 2 * minute).seenBy)
        assertEquals(sos, sos.withNews(SosNews("sos_ack", "other", "Dad", null), start + minute))
        assertEquals(start + 4 * 60 * minute, sos.withNews(SosNews("sos_extended", "s1", "Mum", start + 4 * 60 * minute), start).autoStopAtMs)
        val ended = sos.withNews(SosNews("sos_ended", "s1", "Dad", null), start + 3 * minute)
        assertEquals(SosEnd.PARENT, ended.endedBy)
        assertEquals("Dad", ended.endedByName)
        assertEquals(start + 3 * minute, ended.endedAtMs)
        assertTrue(ended.endReported)
    }

    @Test
    fun theTextsSayWhereAndHowLongAgo() {
        val now = start + 10 * minute

        assertEquals("https://maps.google.com/?q=-33.86880,151.20930 (±20 m)", mapsText(fix(now)))
        assertEquals("https://maps.google.com/?q=1.50000,-0.12346", mapsText(fix(now, 1.5, -0.123456).copy(accuracyM = null)))
        assertEquals(
            "SOS from Alex. Location: https://maps.google.com/?q=-33.86880,151.20930 (±20 m). Battery 54%.",
            sosText("Alex", fix(now - 5_000), 54, now),
        )
        assertEquals("SOS from Alex. No location yet. Battery 54%.", sosText("Alex", null, 54, now))
        assertEquals("SOS from Alex. No location yet.", sosText("Alex", null, null, now))
        assertEquals(
            "SOS from Alex, still on. Location 3 min ago: https://maps.google.com/?q=-33.86880,151.20930 (±20 m). Battery 51%.",
            sosText("Alex", fix(now - 3 * minute - 5_000), 51, now, again = true),
        )
        assertEquals(
            "SOS from Alex, still on. Location: https://maps.google.com/?q=-33.86880,151.20930 (±20 m).",
            sosText("Alex", fix(now - 30_000), null, now, again = true),
        )

        val sos = startSos("s1", start).withFix(fix(start + 1_000))
        assertEquals(
            "Alex is safe: SOS ended. Last location: https://maps.google.com/?q=-33.86880,151.20930 (±20 m).",
            sosEndText("Alex", sos.endedByKid(now)),
        )
        assertEquals(
            "Alex's SOS was ended by Dad.",
            sosEndText("Alex", startSos("s1", start).withNews(SosNews("sos_ended", "s1", "Dad", null), now)),
        )
        assertEquals("Alex's SOS has ended.", sosEndText("Alex", startSos("s1", start).copy(endedAtMs = now, endedBy = SosEnd.PARENT)))
        assertEquals("Alex's SOS has stopped by itself.", sosEndText("Alex", startSos("s1", start).autoStopped(start + 3 * 60 * minute)))
    }

    @Test
    fun theScreenSaysHowFarItGotAndWhoHasSeenIt() {
        val parents = listOf(Callable("Dad", "+61412345678"))
        val sos = startSos("s1", start)

        val sending = sos.view(parents, listOf("Mum", "Dad"), "000")!!
        assertEquals(SosStage.SENDING, sending.stage)
        assertEquals("Telling Mum and Dad…", sending.line())
        assertNull(sending.seenLine())
        assertEquals(parents, sending.parents)
        assertEquals("000", sending.emergencyNumber)
        assertEquals("No internet. We texted Mum and Dad where you are.", sos.textSent(start).view(parents, listOf("Mum", "Dad"), "000")!!.line())
        val sent = sos.copy(startReportedAtMs = start, lastTextAtMs = start, seenBy = listOf("Dad"))
            .view(parents, listOf("Mum", "Dad"), "000")!!
        assertEquals(SosStage.SENT, sent.stage)
        assertEquals("Sent to Mum and Dad. They can see where you are.", sent.line())
        assertEquals("Dad has seen your SOS", sent.seenLine())
        assertEquals("Mum and Dad have seen your SOS", sent.copy(seenBy = listOf("Mum", "Dad")).seenLine())
        assertNull(sos.endedByKid(start).view(parents, listOf("Mum", "Dad"), "000"))
        assertNull((null as LocalSos?).view(parents, listOf("Mum", "Dad"), "000"))
    }

    private val requests = mutableListOf<HttpRequestData>()

    private fun api(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = SosApi(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
    )

    private val stored = """{"id":"s1","kidId":"k1","kidName":"Alex","deviceId":"d1","deviceName":"Pixel 7",""" +
        """"status":"active","startedAt":"2026-10-27T05:00:00.000Z","autoStopAt":"2026-10-27T07:00:00.000Z",""" +
        """"endedAt":null,"endedBy":null,"endedByName":null,"lastLocation":null,"acks":[]}"""

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private fun MockRequestHandleScope.ok(request: HttpRequestData) = when {
        request.url.encodedPath == "/v1/device/sos" ->
            respond(stored, HttpStatusCode.Created, headersOf(HttpHeaders.ContentType, "application/json"))
        else -> respond("", HttpStatusCode.NoContent)
    }

    @Test
    fun flushSendsTheStartThePositionsAndTheEndInThatOrder() = runBlocking {
        val first = fix(start)
        val sos = startSos("s1", start).withFix(first).copy(startFix = first).withFix(fix(start + 30_000)).textSent(start)
            .endedByKid(start + minute)

        val done = api { ok(it) }.flush(sos, start + 2 * minute)

        assertEquals(listOf("/v1/device/sos", "/v1/device/sos/s1/locations", "/v1/device/sos/s1/end"), requests.map { it.url.encodedPath })
        assertEquals(
            """{"id":"s1","startedAt":"2026-10-27T05:00:00Z","location":{"at":"2026-10-27T05:00:00Z","lat":-33.8688,""" +
                """"lng":151.2093,"accuracyM":20.4,"batteryPct":54,"via":"data"}}""",
            requests[0].bodyText(),
        )
        assertEquals(
            """{"locations":[{"at":"2026-10-27T05:00:00Z","lat":-33.8688,"lng":151.2093,"accuracyM":20.4,"batteryPct":54,""" +
                """"via":"data"},{"at":"2026-10-27T05:00:30Z","lat":-33.8688,"lng":151.2093,"accuracyM":20.4,""" +
                """"batteryPct":54,"via":"sms"}]}""",
            requests[1].bodyText(),
        )
        assertEquals(start + 2 * minute, done.startReportedAtMs)
        assertEquals(start + 2 * minute, done.lastDataAtMs)
        assertTrue(done.queue.isEmpty())
        assertTrue(done.endReported)
        assertFalse(done.done)
        assertTrue(done.copy(endTextSent = true).done)
    }

    @Test
    fun offlineNothingIsMarkedSentAndAnAnswerFromTheServerCountsAsSent() = runBlocking {
        val sos = startSos("s1", start).withFix(fix(start + 1_000))

        assertEquals(sos, api { throw IOException("no network") }.flush(sos, start + minute))
        assertEquals(1, requests.size)

        // The start went; the positions did not.
        requests.clear()
        val half = api { if (it.url.encodedPath == "/v1/device/sos") ok(it) else throw IOException("gone") }.flush(sos, start + minute)
        assertEquals(start + minute, half.startReportedAtMs)
        assertEquals(1, half.queue.size)

        // A 409 (another SOS is on) is an answer: sending again would not help.
        val conflict = """{"error":{"code":"conflict","message":"An SOS is already on."}}"""
        val answered = api { respond(conflict, HttpStatusCode.Conflict, headersOf(HttpHeaders.ContentType, "application/json")) }
            .flush(sos, start + minute)
        assertEquals(start + minute, answered.startReportedAtMs)
        assertTrue(answered.queue.isEmpty())
    }
}
```

## 6. Detailed spec

### 6.1 What the kid and the parent see

| Where | What |
|---|---|
| Main screen, phone with a SIM | A 72 dp red circle "SOS" with a grey ring around it, in the top right corner, level with "Hi Alex" |
| Block screen, phone with a SIM | The same red circle at the right end of the clock row, with a faint light ring |
| Tablet, or phone without a SIM | No **SOS** button anywhere |
| Tap **SOS** | Only a short message at the bottom: "Hold the SOS button for 2 seconds" |
| Hold **SOS** | The red ring fills clockwise in 2 seconds; let go sooner and it runs back. At 2 seconds: the countdown |
| Countdown | Full-screen red: "SOS", "Sending in", a huge white 5, 4, 3, 2, 1, "Your parents will get an alert and a text with where you are.", and a big white **Cancel** (red text). At zero: a white spinner and "Sending…" |
| SOS screen | Full-screen dark red: "SOS is on" (big, bold, white), then "Telling Dad…" while it waits for a position, "Sent to Dad. They can see where you are." once the server has it, or "No internet. We texted Dad where you are."; "✓ Dad has seen your SOS" in a green pill after "I'm on it"; a call button for each parent with a mobile; **Emergency 000**; a white pill **Hold: I'm safe** in green that fills with green from the left while held; "Hold for 2 seconds when you are safe." |
| Notification during an SOS | Title "SOS is on", text "Dad has seen your SOS" or the line from the SOS screen, no countdown |
| Texts to every parent with a mobile | At the start: "SOS from Alex. Location: https://maps.google.com/?q=-33.86880,151.20930 (±20 m). Battery 54%." Every 5 minutes without internet: "SOS from Alex, still on. Location 3 min ago: …". At the end: "Alex is safe: SOS ended. Last location: …", "Alex's SOS was ended by Dad. Last location: …" or "Alex's SOS has stopped by itself. Last location: …" |

### 6.2 What happens

| Event | What the app does (log tag `Sos`, or `KidService` where it says so) |
|---|---|
| The countdown reaches zero | `sos: started`; location is turned on if it was off (`sos: location turned on`); a position (`sos: position from gps ±N m`); up to 10 seconds' wait for it; the text (`sos: texted 1 parent(s)`); `POST /v1/device/sos` with the position (`sos: sent to the server`); `KidService`: `sos: on`, and the report line says `sos=true` |
| Every 30 seconds during an SOS | The newest position, if it is newer than the last one, goes to `POST /v1/device/sos/{id}/locations` (`sos: 1 position(s) sent`) |
| No answer from the server for 5 minutes | A text with the newest position; that position goes up later as `via: sms` |
| `sos_ack` on the live channel | `sos: seen by Dad`; the SOS screen shows "✓ Dad has seen your SOS" |
| `sos_extended` on the live channel | `sos: kept on for longer by Dad`; it now stops 2 hours later |
| **Hold: I'm safe** | `POST /v1/device/sos/{id}/end`; `sos: ended by kid`; the end text; `KidService`: `sos: off` |
| `sos_ended` on the live channel, or a snapshot without it | `sos: ended by parent`; the end text; `KidService`: `sos: off` |
| 2 hours after the start (or after `sos_extended`'s new time) | `sos: ended by auto`; the end text |
| Offline | Everything waits on the phone (SharedPreferences `sos`) and goes at the next tick or sync that gets through |

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-038-sos
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-038-sos.md` and `server/scripts/dev-sos.ts` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.10. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-038: SOS on the kid phone`.
3. Create 5.11. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-038: SOS tests`.
4. Run the acceptance checks in section 8, including the emulator run (8.2), in this session.
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback. The throwaway `local-dev-only-…` values below are fine, and so are the made-up phone number `+61412345678` and the emulator's position.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints sixteen lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml, app-kid\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.api.ApiClientTest tests="13" failures="0" errors="0"
  au.screentime.kid.ask.SenderTest tests="5" failures="0" errors="0"
  au.screentime.kid.calls.CallsTest tests="5" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolLinkTest tests="4" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolRulesTest tests="7" failures="0" errors="0"
  au.screentime.kid.live.LiveTest tests="7" failures="0" errors="0"
  au.screentime.kid.parentmode.ParentModeTest tests="9" failures="0" errors="0"
  au.screentime.kid.sos.SosTest tests="9" failures="0" errors="0"
  au.screentime.kid.status.KidStatusTest tests="12" failures="0" errors="0"
  au.screentime.kid.status.WarningTrackerTest tests="5" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```

### 8.2 On the emulator

Run every step below **in this session**, and paste the **real terminal output** of each step into the handback. A summary is not accepted, and neither is "run earlier in this session" for output you no longer have. If your context was summarised partway through, run the steps again from step 1.

The emulator has a pretend SIM, so it can "send" texts: they go nowhere, but Android keeps them in its list of sent messages, which `Texts` below prints. **Never do this run on a real phone.**

**The emulator.** Use the same emulator as in CARD-037, with nobody signed in. Remove the app from CARD-037 first (each command prints `Success...`, or an error if there was nothing to remove; both are fine), keep the screen from turning off by itself for 30 minutes, make sure Wi-Fi and mobile data are on, and put the emulator in Sydney:

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
& $adb shell svc wifi enable
& $adb shell svc data enable
& $adb emu geo fix 151.2093 -33.8688
```

`geo fix` prints `OK`. `& $adb devices` must list exactly one `emulator-5554   device`. If it says `offline` for more than a minute, use the cold boot steps James gave you for CARD-030b; do not wait longer than 5 minutes. If `uninstall` fails with `DELETE_FAILED_INTERNAL_ERROR` and `remove-active-admin` with a `SecurityException` (the app is still Device Owner), wipe the emulator (Device Manager › **Wipe Data**), cold boot it, and run the commands above again. That is not a deviation, but say that you did it under "Outside the repo".

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). `dev-sos.ts` and `dev-contacts.ts` sign a parent token with `JWT_SECRET`, so `$env:JWT_SECRET` must be the same value as in `deploy\.env`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pnpm --filter @screentime/server exec tsx scripts/dev-contacts.ts Alex +61412345678
```

`seed-dev.ts` prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` `dev-contacts.ts` gives Dad the mobile number `+61412345678` (made up), so the SOS texts go to it. If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Tap-Text` taps the words on the screen (with a package, only words of that app). `Tap-Desc` taps, and `Hold-Desc` presses and holds for 2.6 seconds, the thing on the screen whose description (what a screen reader says) is the given text. `Sos` runs `dev-sos.ts` for Alex: `Sos show`, `Sos seen`, `Sos end`. `SosLog` prints the app's `sos:` log lines and its last report line **since the last `SosLog`**, then clears the log. `Wait-Log` waits until a log line with the given words shows up (it does not clear the log). `Texts` prints the texts the emulator has sent, newest first. `Emails` prints the server's SOS emails (with no email set up, the server only logs them). `Wait-Unblocked` and `Wait-Blocked` wait until the block screen goes or comes back. `Top` prints the screen in front.

```powershell
function Find-Node([string]$attribute, [string]$value) {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.GetAttribute($attribute) -eq $value } | Select-Object -First 1
  if (-not $node) { throw "No '$value' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  @([int](($b[0] + $b[2]) / 2), [int](($b[1] + $b[3]) / 2))
}
function Tap-Text([string]$text, [int]$wait = 2, [string]$package = "") {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.text -eq $text -and (-not $package -or $_.package -eq $package) } | Select-Object -First 1
  if (-not $node) { throw "No '$text' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds $wait
}
function Tap-Desc([string]$desc) {
  $p = Find-Node "content-desc" $desc
  & $adb shell input tap $p[0] $p[1]
}
function Hold-Desc([string]$desc) {
  $p = Find-Node "content-desc" $desc
  & $adb shell input swipe $p[0] $p[1] $p[0] $p[1] 2600
}
function Shot([string]$name) {
  & $adb shell screencap -p /sdcard/shot.png
  & $adb pull /sdcard/shot.png "$t\$name.png" | Out-Null
}
function Open-Link([string]$link) {
  & $adb shell "am start -W -a android.intent.action.VIEW -d '$link' au.screentime.kid"
  Start-Sleep -Seconds 3
}
function Open-App {
  & $adb shell am start -n au.screentime.kid/.MainActivity | Out-Null
  Start-Sleep -Seconds 3
}
function Screen-On {
  & $adb shell input keyevent KEYCODE_WAKEUP
  Start-Sleep -Seconds 1
  & $adb shell wm dismiss-keyguard
  Start-Sleep -Seconds 2
}
function Screen-Off {
  & $adb shell input keyevent KEYCODE_SLEEP
  Start-Sleep -Seconds 5
}
function Bedtime([int]$minutes, [int]$allowance = 720) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex $minutes $allowance
}
function Sos([string]$action) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-sos.ts Alex $action
}
function SosLog {
  $lines = & $adb logcat -d -s Sos:I Sos:W KidService:I
  $lines | Select-String 'sos:' | ForEach-Object { $_.Line.Trim() }
  $lines | Select-String 'pool=' | Select-Object -Last 1 | ForEach-Object { $_.Line.Trim() }
  & $adb logcat -c
}
function Wait-Log([string]$words, [int]$max = 90) {
  $start = Get-Date
  do {
    Start-Sleep -Seconds 2
    $hit = & $adb logcat -d -s Sos:I | Select-String -SimpleMatch $words | Select-Object -First 1
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($hit -or $seconds -gt $max)
  if ($hit) { "'$words' after {0:N0} s" -f $seconds } else { "No '$words' after $max s" }
}
function Texts {
  & $adb shell content query --uri content://sms --projection address:type:body --sort "date DESC"
}
function Emails {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api | Select-String 'alert for'
}
function Top {
  & $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
}
function Wait-Unblocked([int]$max = 45) {
  $start = Get-Date
  do {
    Start-Sleep -Milliseconds 500
    $top = (& $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1).Line
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($top -notmatch 'BlockActivity' -or $seconds -gt $max)
  if ($top -match 'BlockActivity') { "Still blocked after $max s" } else { "Unblocked after {0:N0} s" -f $seconds }
}
function Wait-Blocked([int]$max = 45) {
  $start = Get-Date
  do {
    Start-Sleep -Milliseconds 500
    $top = (& $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1).Line
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($top -match 'BlockActivity' -or $seconds -gt $max)
  if ($top -match 'BlockActivity') { "Blocked after {0:N0} s" -f $seconds } else { "Still not blocked after $max s" }
}
$sosButton = "SOS. Press and hold for 2 seconds."
$safeButton = "Hold: I'm safe. Press and hold for 2 seconds."
```

In the texts below, `<lat>,<lng>` is the emulator's position with 5 decimals, for example `-33.86880,151.20930`; the last digit may differ a little. `(±N m)` may be missing if the emulator gives no accuracy, and `Battery N%.` if it gives no battery level; both are fine.

**The run.** From `android`, one step at a time; check each expected result before the next step.

1. Install, make it Device Owner, and pair. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`, run `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` and copy the `Emulator link`. Back in the first window:
   ```powershell
   Bedtime 60
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb shell cmd role add-role-holder android.app.role.CALL_REDIRECTION au.screentime.kid
   & $adb logcat -c
   Open-App
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Start-Sleep -Seconds 10
   Shot "1-home"
   & $adb shell dumpsys package au.screentime.kid | Select-String '(SEND_SMS|_LOCATION): granted'
   ```
   `1-home` shows the main screen as in CARD-037 ("Hi Alex", the ring, **Ask for more time**, **Message Dad**, **I'm the parent**) and the red **SOS** circle in the top right corner, not on top of "Hi Alex". The `dumpsys` line prints four lines, one each for `android.permission.SEND_SMS`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION`, each with `granted=true`.
2. A tap only shows the hint:
   ```powershell
   Tap-Desc $sosButton
   Shot "2-tap-hint"
   Start-Sleep -Seconds 4
   Top
   ```
   `2-tap-hint` shows the main screen with the message "Hold the SOS button for 2 seconds" near the bottom. `Top` shows `au.screentime.kid/.MainActivity`: no countdown.
3. Hold, then **Cancel**: nothing is sent. Run the first two lines **together, in one go**, so **Cancel** is tapped within the 5 seconds:
   ```powershell
   Hold-Desc $sosButton; Tap-Text "Cancel" 2
   Start-Sleep -Seconds 8
   Shot "3-cancelled"
   SosLog
   Sos show
   ```
   `3-cancelled` shows the main screen as in `1-home`. `SosLog` prints no `sos:` line, only the report line, with `sos=false`. `Sos show` fails with `Error: Alex has never sent an SOS` (that is the expected result here).
4. Hold, and let the countdown run out:
   ```powershell
   Hold-Desc $sosButton; Start-Sleep -Seconds 1; Shot "4-countdown"
   Start-Sleep -Seconds 20
   Shot "5-sos-on"
   SosLog
   Sos show
   Texts
   Emails
   ```
   `4-countdown` shows the full-screen red countdown: "SOS", "Sending in", a big 4 or 3, the line about the alert, and the white **Cancel**. `5-sos-on` shows the dark red SOS screen: "SOS is on", "Sent to Dad. They can see where you are.", a call button for Dad, **Emergency 000**, and the white **Hold: I'm safe**. `SosLog` has, in this order, `sos: started`, a `sos: position from …` line, `sos: texted 1 parent(s)`, `sos: sent to the server`, and `sos: on` (from `KidService`); the last line has `sos=true` and `used=<U>s`: write down `<U>`. `Sos show` prints `Alex's SOS is active; seen by nobody; N position(s), …` with N 1 or 2, and `Last position: <lat>,<lng> …`. `Texts` prints a row with `address=+61412345678, type=2, body=SOS from Alex. Location: https://maps.google.com/?q=<lat>,<lng> (±N m). Battery N%.` (`type=2` means sent). `Emails` prints a line with `SMTP not configured: alert for dad@example.com: SOS from Alex`.
5. Positions keep going up, and nothing counts:
   ```powershell
   & $adb emu geo fix 151.2100 -33.8700
   Start-Sleep -Seconds 65
   SosLog
   Sos show
   ```
   `SosLog` has at least one `sos: 1 position(s) sent`. If it has a report line, that line has `sos=true` and the **same** `used=<U>s` as in step 4. `Sos show` prints `2 position(s)` or more, and `Last position: -33.87000,151.21000 …`.
6. Dad says "I'm on it":
   ```powershell
   Sos seen
   Start-Sleep -Seconds 5
   Shot "6-seen"
   & $adb shell cmd statusbar expand-notifications
   Start-Sleep -Seconds 2
   Shot "7-notification"
   & $adb shell cmd statusbar collapse
   Start-Sleep -Seconds 1
   SosLog
   ```
   `Sos seen` prints `Dad is on it (Alex).` `6-seen` shows the SOS screen with the green "✓ Dad has seen your SOS". `7-notification` shows the app's notification "SOS is on", "Dad has seen your SOS", with no countdown. `SosLog` has `sos: seen by Dad`.
7. Bedtime during the SOS: the SOS screen stays in front:
   ```powershell
   Bedtime 60 0
   Start-Sleep -Seconds 15
   Shot "8-sos-over-block"
   Top
   SosLog
   ```
   `8-sos-over-block` shows the SOS screen as in `6-seen` (not the block screen's "Out of Phone time"). `Top` shows `au.screentime.kid/.block.BlockActivity` (the block screen is up, under the SOS). The last `SosLog` line has `locked=true` and `sos=true`.
8. **Hold: I'm safe**:
   ```powershell
   Hold-Desc $safeButton
   Start-Sleep -Seconds 10
   Shot "9-safe-blocked"
   SosLog
   Sos show
   Texts
   ```
   `9-safe-blocked` shows the block screen ("Out of Phone time", **Ask for more time**, **Message Dad**, **Emergency 000**, **I'm the parent**) with the red **SOS** circle at the right of the clock. `SosLog` has `sos: ended by kid`, `sos: texted 1 parent(s)` and `sos: off`; the last line has `locked=true` and `sos=false`. `Sos show` prints `Alex's SOS is ended, ended by kid; seen by Dad; …`. The newest `Texts` row has `body=Alex is safe: SOS ended. Last location: https://maps.google.com/?q=-33.87000,151.21000 …`.
9. A new SOS from the main screen; Dad ends it from his phone:
   ```powershell
   Bedtime 60
   Wait-Unblocked
   Hold-Desc $sosButton
   Start-Sleep -Seconds 20
   SosLog
   Sos end
   Start-Sleep -Seconds 10
   Shot "10-ended-by-dad"
   SosLog
   Sos show
   Texts
   ```
   `Wait-Unblocked` prints `Unblocked after N s`. The first `SosLog` has `sos: started`, `sos: sent to the server` and `sos: on`. `Sos end` prints `Dad ended the SOS (Alex).` `10-ended-by-dad` shows the main screen as in `1-home`. The second `SosLog` has `sos: ended by parent`, `sos: texted 1 parent(s)` and `sos: off`. `Sos show` prints `Alex's SOS is ended, ended by parent (Dad); …`. The newest `Texts` row has `body=Alex's SOS was ended by Dad. Last location: …`.
10. An SOS with no internet, then back online:
    ```powershell
    & $adb shell svc wifi disable
    & $adb shell svc data disable
    Start-Sleep -Seconds 5
    Hold-Desc $sosButton
    Start-Sleep -Seconds 25
    Shot "11-offline"
    SosLog
    Sos show
    & $adb shell svc wifi enable
    & $adb shell svc data enable
    Wait-Log "sent to the server" 120
    Start-Sleep -Seconds 3
    SosLog
    Sos show
    Hold-Desc $safeButton
    Start-Sleep -Seconds 10
    SosLog
    Texts
    ```
    `11-offline` shows the SOS screen with "No internet. We texted Dad where you are." The first `SosLog` has `sos: started` and `sos: texted 1 parent(s)`, and **no** `sos: sent to the server`. The first `Sos show` still prints the step 9 SOS (`… is ended, ended by parent (Dad); …`): the server has not heard of the new one. `Wait-Log` prints `'sent to the server' after N s` with N **90 or less**. The second `Sos show` prints `Alex's SOS is active; …`. The last `SosLog` has `sos: ended by kid` and `sos: off`. `Texts` now has, newest first: `Alex is safe: SOS ended. …`, `SOS from Alex. …`, `Alex's SOS was ended by Dad. …`, `SOS from Alex. …`, `Alex is safe: SOS ended. …`, `SOS from Alex. …`: six rows, all `address=+61412345678, type=2`.
11. Undo, so the emulator can be used again:
    ```powershell
    & $adb shell svc wifi enable
    & $adb shell svc data enable
    & $adb shell am task lock stop
    & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
    & $adb uninstall au.screentime.kid
    & $adb shell settings put system screen_off_timeout 60000
    cd ..
    docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
    Remove-Item Env:DATABASE_URL
    Remove-Item Env:JWT_SECRET
    ```
    `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 11 gave the expected results, run in this session. Paste the real output of every command in steps 1 to 10 into the handback (the `dumpsys`, `Bedtime`, `Sos`, `SosLog`, `Texts`, `Emails`, `Top`, `Wait-Log`, `Wait-Unblocked` lines).
- [ ] The eleven screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c38\`: `1-home.png`, `2-tap-hint.png`, `3-cancelled.png`, `4-countdown.png`, `5-sos-on.png`, `6-seen.png`, `7-notification.png`, `8-sos-over-block.png`, `9-safe-blocked.png`, `10-ended-by-dad.png`, `11-offline.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 11 files (in any order):
  ```
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/sos/Sos.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosController.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosScreens.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosStore.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/sos/SosTest.kt
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/sos/SosTest.kt` | An SOS runs for 2 hours and takes only newer positions; without the server it texts again every 5 minutes, and the texted position goes up as `via: sms`; it ends by the kid, by itself at its stop time, or when a snapshot made after the server got it no longer has it (and not before); the three SOS messages are read from the live channel and anything else is not; a message changes only its own SOS; the texts say where, how accurate, the battery, and how long ago; the screen says how far it got and who has seen it; the start, the positions and the end go to the server in that order, with the exact JSON; offline nothing is marked sent, and any answer from the server counts as sent. |

The button, the countdown, the SOS screen, the texts, the positions and the service are checked by the emulator run in 8.2, not by unit tests. The 5-minute text without internet is checked only by the unit test.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-038: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-038-sos`
5. Open a PR into `main` titled `CARD-038: SOS on the kid phone`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-038-sos --title "CARD-038: SOS on the kid phone" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-038-sos.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: sixteen suites, SosTest 9, all `failures="0"`
   - [x] emulator run steps 1 to 11 — results as expected
   - [x] eleven screenshots in C:\Users\james\OpenCode\Testing\temp\c38\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 11 files

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

- **Step 1: no SOS button in `1-home`**: the app thinks the emulator has no SIM. Paste `& $adb shell getprop gsm.sim.state` and `& $adb logcat -d -s KidService:I | Select-Object -Last 5`, and stop there.
- **Step 1: a permission shows `granted=false`, or is missing**: paste the `dumpsys` output and `& $adb logcat -d -s Policies:W | Select-Object -Last 10`, and stop there.
- **Step 3: `Tap-Text` says `No 'Cancel' on screen`, or the SOS started**: the countdown ran out before the tap. Paste `SosLog`, end the SOS with `Hold-Desc $safeButton`, wait 10 seconds, and run step 3 once more. If it happens again, say so under "Deviations" and go on with step 4 (in that case `Sos show` in step 4 prints the newer SOS and the counts may be one higher; say so).
- **`Hold-Desc` or `Tap-Desc` says `No '…' on screen`**: take a screenshot `no-button` and paste `Top`, and stop there.
- **Step 4: no `sos: position from …` line, and the text says "No location yet."**: location is off or the emulator has no position. Run `& $adb emu geo fix 151.2093 -33.8688` again, paste `& $adb shell settings get secure location_mode` and `SosLog`, and stop there.
- **`Texts` prints an error about permission, or nothing**: paste the error and the `sos: texted …` lines from `SosLog`, and go on with the run; say so under "Deviations". If `Texts` shows `type=5` (failed) rows, paste them and go on.
- **`Sos` says `the API said 401`**: `$env:JWT_SECRET` is not the same as `JWT_SECRET` in `deploy\.env`. Set it again as in "The server" and repeat.
- **Step 5: the `used=` number grew**: paste both `SosLog` outputs (step 4 and step 5) and stop there. Do not try to fix it.
- **Step 6 or 9: the screen does not change within 10 seconds of `Sos seen` or `Sos end`**: the live channel is down. Paste `& $adb logcat -d -s KidService:I | Select-String 'live:'` and `SosLog`, and stop there.
- **Step 10: `Wait-Log` prints `No 'sent to the server' after 120 s`**: paste `SosLog`, `& $adb shell svc wifi enable` again, and `Sos show`, and stop there.
- **You are stuck in the block screen** and need the emulator back: `& $adb shell am task lock stop`, then `Bedtime 60`.
- **`Bedtime` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **`wm dismiss-keyguard` does nothing** (the lock screen stays): swipe up with `& $adb shell input swipe 540 1800 540 600` instead and say so under "Deviations".
- **`dpm set-device-owner` says there are accounts, several users, or already provisioned**: use a fresh emulator (Device Manager › **Wipe Data**), do not sign in, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
- **Never tap Emergency 000**, and never run this on a real phone.
- **Temporary files** (the PR body, `ui.xml`, the screenshots, any helper scripts) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **Every difference from the card is a deviation**, in any file, including tests, comments and how you ran a check. List each one under "Deviations". If you explain why something happened, say whether you checked it or are guessing.
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-038. Please review and merge if it is good.

CARD: CARD-038 SOS on the kid phone
PR: <full PR URL>
Branch: bob/card-038-sos
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
