# CARD-034: Live channel while blocked

| Field | Value |
|---|---|
| Card | CARD-034 |
| Title | Live channel while blocked |
| Size | M |
| Depends on | CARD-033 (block screen in Lock Task), merged to `main` |
| Spec sections | docs/SPEC.md §8.3 ("When devices sync"), §10 ("WebSocket details"), §12.1 ("As built (CARD-033)" and "As built (CARD-034)") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-034-live-channel` |
| PR title | `CARD-034: Live channel while blocked` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

After CARD-033 a blocked phone asks the server for news every 30 seconds, so a parent's extra time takes up to 30 seconds to unlock it. This card makes it **about a second**:

- **The live channel** (`live/LiveChannel.kt`): a WebSocket to the server's `GET /v1/device/ws`, which already exists (CARD-017). It sends `{"type":"ping"}` every 30 seconds, and calls back when it connects and for every message from the server except `pong`. If the socket fails or closes, it waits 1, 2, 4 … 60 seconds (±20%) and tries again.
- **Small pure functions** (`live/Live.kt`): the socket address (`http` becomes `ws`, `https` becomes `wss`), the reconnect wait, and "does this message mean sync now". They have unit tests (`LiveTest`, 5 tests).
- **The service** (`service/KidService.kt`): the channel is open only while blocked with the screen on. Any news makes the service's own loop sync at once. While the socket is open the 30-second poll stops; while it is down the poll runs as before.

Claude added `server/scripts/dev-grant.ts`: it adds or removes time for a kid through the API, as a parent would in the app, so the server pushes the change down the socket. The run in 8.2 uses it. FCM (pushes while not blocked) comes in a later card, CARD-034b.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with the new `LiveTest` (5 tests); on the emulator a blocked phone opens the live channel, a grant unlocks it within 10 seconds, the channel reconnects after the server restarts, and it closes when the screen goes off; the four screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No FCM, no Firebase, no `google-services.json` (CARD-034b). No notification for "Dad added 15 minutes" (with FCM). No buttons on the block screen (CARD-035 to CARD-038). No handling of a revoked device (a later card).
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/`, `server/` or `docs/`, and no change to `build.gradle.kts`, `libs.versions.toml` or `AndroidManifest.xml` files. No new dependency of any kind: the WebSocket client is already part of `ktor-client-core`, and the OkHttp engine supports it.
- Never run the app on a real phone or tablet in this card, and never install a **release** build anywhere.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, Room 2.8.5, KSP 2.3.12, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. No new library.

Claude built this exact code in GitHub Actions before writing the card, so it compiles and the tests pass. Claude also ran `LiveChannel` on a PC against the real server: a grant arrived in about a second, the socket stayed up for minutes on its pings, and it came back after the server was restarted.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c34"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `…` (U+2026) and `±` (U+00B1); copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt` | create (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/live/LiveChannel.kt` | create (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | replace (5.3) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt` | create (5.4) |

That is 4 files.

### 5.1 `android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt`

```kotlin
package au.screentime.kid.live

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** What the device sends every 30 seconds to keep the socket alive (docs/SPEC.md §10). */
const val PING = """{"type":"ping"}"""

/**
 * The live channel's address for [serverUrl] (`GET /v1/device/ws`, docs/SPEC.md §9): `https` becomes `wss` and
 * `http` becomes `ws`.
 */
fun liveUrl(serverUrl: String): String {
    val base = serverUrl.trimEnd('/')
    val socket = when {
        base.startsWith("https://") -> "wss://" + base.removePrefix("https://")
        base.startsWith("http://") -> "ws://" + base.removePrefix("http://")
        else -> throw IllegalArgumentException("not an http or https address: $serverUrl")
    }
    return "$socket/v1/device/ws"
}

/**
 * How long to wait before reconnect number [attempt] (0 for the first): 1, 2, 4 … 60 seconds, times [jitter],
 * which is between 0.8 and 1.2 (docs/SPEC.md §8.3, ±20%).
 */
fun backoffMs(attempt: Int, jitter: Double): Long {
    val base = minOf(1_000L shl attempt.coerceIn(0, 6), 60_000L)
    return (base * jitter).toLong()
}

/**
 * True when a frame from the server means "sync now": any envelope (docs/SPEC.md §10) except `pong`. A frame that
 * is not a JSON object with a `type` means nothing.
 */
fun asksForSync(frame: String): Boolean {
    val type = try {
        (Json.parseToJsonElement(frame) as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull
    } catch (e: IllegalArgumentException) {
        // Not JSON (SerializationException is an IllegalArgumentException), or a `type` that is not a string.
        null
    }
    return type != null && type != "pong"
}
```

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/live/LiveChannel.kt`

```kotlin
package au.screentime.kid.live

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlin.coroutines.cancellation.CancellationException
import kotlin.random.Random
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The WebSocket to the server (docs/SPEC.md §8.3, §10). [run] connects with the device token, sends [PING] every
 * 30 seconds, and calls [onNews] when it connects (a message may have been missed while it was down) and for every
 * message that is not a pong. A socket that has said nothing for 75 seconds is dead. After a failure or a close it
 * waits 1, 2, 4 … 60 seconds (±20%) and connects again, until the coroutine is cancelled. [onNews] must return at
 * once: the service only takes note and syncs in its own loop.
 */
class LiveChannel(
    engine: HttpClientEngine,
    private val url: String,
    private val token: () -> String,
    private val onNews: () -> Unit,
    private val log: (String) -> Unit = {},
    private val random: () -> Double = Random::nextDouble,
) : AutoCloseable {
    private val http = HttpClient(engine) { install(WebSockets) }

    /** True while a socket is open. */
    @Volatile
    var connected = false
        private set

    suspend fun run() {
        var attempt = 0
        while (true) {
            try {
                http.webSocket(url, request = { header(HttpHeaders.Authorization, "Bearer ${token()}") }) {
                    connected = true
                    attempt = 0
                    log("connected")
                    onNews()
                    val pinger = launch {
                        while (true) {
                            send(Frame.Text(PING))
                            delay(PING_MS)
                        }
                    }
                    try {
                        while (true) {
                            val next = withTimeoutOrNull(DEAD_MS) { incoming.receiveCatching() }
                            if (next == null) {
                                log("nothing for 75 s, reconnecting")
                                break
                            }
                            val frame = next.getOrNull()
                            if (frame == null) {
                                log("closed: ${withTimeoutOrNull(1_000) { closeReason.await() }}")
                                break
                            }
                            if (frame is Frame.Text && asksForSync(frame.readText())) onNews()
                        }
                    } finally {
                        pinger.cancel()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log("failed: $e")
            } finally {
                connected = false
            }
            val wait = backoffMs(attempt, 0.8 + 0.4 * random())
            attempt++
            delay(wait)
        }
    }

    override fun close() = http.close()

    private companion object {
        const val PING_MS = 30_000L
        const val DEAD_MS = 75_000L
    }
}
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

Replace the whole file. Compared with `main`: the `live`, `liveJob` and `syncWanted` fields, the `LiveChannel` made in `onCreate`, the loop (no poll while the socket is open; a sync when woken with `syncWanted`), `live?.close()` in `onDestroy`, `syncWanted = false` in `sync()`, `updateLive()` called from `report()`, and the `updateLive()` function itself.

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
import au.screentime.kid.live.LiveChannel
import au.screentime.kid.live.liveUrl
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
 * block screen can be seen it also keeps the live channel open (§8.3), so a parent's grant unlocks within seconds.
 * Everything runs one at a time on [scope], so the database sees one change after another.
 */
class KidService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    private lateinit var clock: TrustedClock
    private lateinit var recorder: Recorder
    private lateinit var segments: RoomSegmentStore
    private lateinit var states: FileStateStore
    private lateinit var syncer: Syncer
    private lateinit var notifier: Notifier
    private var engine: HttpClientEngine? = null
    private var api: ApiClient? = null
    private var live: LiveChannel? = null
    private var liveJob: Job? = null
    private var started = false

    /** [SystemClock.elapsedRealtime] of the last sync, for "every 5 minutes" and "if the last sync is older than 2 minutes". */
    private var lastSyncElapsed = 0L
    private var lastSyncOk = true

    /** The live channel has news (or just connected); the loop syncs, so a sync never runs inside the live channel. */
    private var syncWanted = false

    /** One sync at a time: a slow sync that is failing must not overlap the next one. */
    private val syncLock = Mutex()

    /** The engine said locked at the last run: the block screen is up and nothing counts (docs/SPEC.md §12.1). */
    private var blocked = false

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
        segments = RoomSegmentStore(KidDatabase.open(this).segments())
        states = FileStateStore(this)
        recorder = Recorder(segments) { UUID.randomUUID().toString() }
        val http = OkHttp.create()
        val client = ApiClient(enrolment.serverUrl, http, token = { enrolment.deviceToken })
        engine = http
        api = client
        syncer = Syncer(client, segments, states, clock, log = { Log.w(TAG, it) })
        live = LiveChannel(
            engine = http,
            url = liveUrl(enrolment.serverUrl),
            token = { enrolment.deviceToken },
            onNews = {
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
                // While in use, until the next warning, lock or period (at least once a minute). Blocked with the
                // screen on, the same while the live channel is open; while it is down, at least every 30 seconds,
                // to see a parent's grant soon. Otherwise a minute.
                val untilNext = (nextCheckAt - clock.nowMs()).coerceIn(SECOND, MINUTE)
                val wait = when {
                    inUse() -> untilNext
                    blocked && screenOn() -> if (live?.connected == true) untilNext else minOf(untilNext, BLOCKED_POLL)
                    else -> MINUTE
                }
                // Woken early: sync if the live channel asked for it, then work out the wait again.
                if (withTimeoutOrNull(wait) { wake.receive() } != null) {
                    if (syncWanted) sync()
                    continue
                }
                when {
                    inUse() -> {
                        recorder.tick(clock.nowMs())
                        if (SystemClock.elapsedRealtime() - lastSyncElapsed >= 5 * MINUTE) sync() else report()
                    }
                    blocked && screenOn() -> if (live?.connected == true) report() else sync()
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

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

    /** The screen is on and unlocked, and not blocked by us: counting (docs/SPEC.md §3, Q19, §12.1). */
    private fun inUse(): Boolean =
        screenOn() && !getSystemService(KeyguardManager::class.java).isKeyguardLocked && !blocked

    private suspend fun onScreenOn(at: Long) {
        val stale = !lastSyncOk || SystemClock.elapsedRealtime() - lastSyncElapsed >= 2 * MINUTE
        if (blocked) {
            // The block screen comes back up through report(); a fresh sync may bring a grant.
            if (stale) sync() else report()
            return
        }
        // Screen on without a lock screen, or the unlock after it: only one segment either way.
        if (!inUse() || segments.open() != null) return
        recorder.start(at)
        if (stale) sync() else report()
    }

    private suspend fun sync() {
        syncLock.withLock {
            // This sync also brings whatever the live channel announced.
            syncWanted = false
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
        val status = kidStatus(cached.state, result, now, lastSyncOk, SystemClock.elapsedRealtime())

        val wasBlocked = blocked
        blocked = status.locked
        if (blocked && !wasBlocked) recorder.stop(now)
        if (!blocked && wasBlocked && inUse()) recorder.start(now)

        StatusHub.status.value = status
        // The block screen closes itself when StatusHub says unlocked.
        if (blocked && screenOn()) BlockActivity.show(this)
        updateLive()
        notifier.showStatus(status, now)
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
                "left=${status.leftSec}s locked=${result.locked} online=$lastSyncOk segments=${own.size}",
        )
    }

    /**
     * The live channel is open only while the block screen can be seen: blocked with the screen on (docs/SPEC.md
     * §8.3). Otherwise the device is not waiting for anyone, and FCM covers the rest (CARD-034b).
     */
    private fun updateLive() {
        val channel = live ?: return
        val want = blocked && screenOn()
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

        fun start(context: Context) {
            context.startForegroundService(Intent(context, KidService::class.java))
        }
    }
}
```

### 5.4 `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt`

```kotlin
package au.screentime.kid.live

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class LiveTest {
    @Test
    fun theAddressSwapsTheSchemeAndAddsThePath() {
        assertEquals("ws://10.0.2.2:8080/v1/device/ws", liveUrl("http://10.0.2.2:8080"))
        assertEquals("wss://screentime.gallagherhome.au/v1/device/ws", liveUrl("https://screentime.gallagherhome.au/"))
        assertThrows<IllegalArgumentException> { liveUrl("ftp://example.com") }
    }

    @Test
    fun theBackoffDoublesUpToAMinute() {
        val waits = (0..8).map { backoffMs(it, 1.0) }

        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L, 60_000L), waits)
    }

    @Test
    fun theJitterIsTwentyPercentEitherWay() {
        assertEquals(800L, backoffMs(0, 0.8))
        assertEquals(1_200L, backoffMs(0, 1.2))
        assertEquals(48_000L, backoffMs(10, 0.8))
        assertEquals(72_000L, backoffMs(10, 1.2))
        assertEquals(60_000L, backoffMs(Int.MAX_VALUE, 1.0))
    }

    @Test
    fun everyEnvelopeButAPongAsksForASync() {
        assertTrue(asksForSync("""{"v":1,"type":"grant_added","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertTrue(asksForSync("""{"v":1,"type":"state_changed","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertTrue(asksForSync("""{"v":1,"type":"something_new","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertFalse(asksForSync("""{"v":1,"type":"pong","at":"2026-10-27T09:00:00Z","data":{}}"""))
    }

    @Test
    fun aFrameThatIsNotAnEnvelopeMeansNothing() {
        assertFalse(asksForSync("hello"))
        assertFalse(asksForSync(""))
        assertFalse(asksForSync("[1, 2]"))
        assertFalse(asksForSync("""{"v":1}"""))
        assertFalse(asksForSync("""{"type":{"a":1}}"""))
        assertFalse(asksForSync("""{"type":null}"""))
    }
}
```

## 6. Detailed spec

### 6.1 What happens

| Event | What the app does |
|---|---|
| The device becomes blocked with the screen on, or the screen comes on while blocked | logs `live: started` and connects to `ws://10.0.2.2:8080/v1/device/ws` (debug) with `Authorization: Bearer <device token>` |
| The socket connects | logs `live: connected`, and the service syncs (a message may have been missed) |
| Every 30 seconds while connected | sends `{"type":"ping"}`; the server answers `pong`, which changes nothing |
| A message other than `pong` (`grant_added`, `state_changed`, …) | the service syncs at once; a grant that gives time unlocks the device |
| Blocked, screen on, socket open | no 30-second poll; the loop only runs the engine at least once a minute |
| Blocked, screen on, socket down | the 30-second poll of CARD-033 |
| The socket fails or closes | logs `live: failed: …` or `live: closed: …`, waits 1, 2, 4, 8, 16, 32, 60, 60 … seconds (each ±20%), and connects again; a successful connect starts the waits from 1 second again |
| Nothing from the server for 75 seconds | logs `live: nothing for 75 s, reconnecting`, then as above |
| The device unlocks, or the screen goes off | logs `live: stopped` and closes the socket |

### 6.2 Why the sync is not done inside the channel

The channel's callback only sets `syncWanted` and wakes the service's loop. The loop does the sync. A sync can unblock the device, and unblocking stops the channel; if the channel's own coroutine ran that sync, it would cancel itself halfway through. Do not "simplify" this.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-034-live-channel
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-034-live-channel.md` and `server/scripts/dev-grant.ts` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create 5.1 and 5.2, and replace 5.3. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-034: live channel while blocked`.
3. Create 5.4. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-034: live channel tests`.
4. Run the acceptance checks in section 8, including the emulator run (8.2), in this session.
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback. The throwaway `local-dev-only-…` values below are fine.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints twelve lines:
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
  au.screentime.kid.live.LiveTest tests="5" failures="0" errors="0"
  au.screentime.kid.status.KidStatusTest tests="7" failures="0" errors="0"
  au.screentime.kid.status.WarningTrackerTest tests="5" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```

### 8.2 On the emulator

Run every step below **in this session**, and paste the **real terminal output** of each step into the handback. A summary is not accepted, and neither is "run earlier in this session" for output you no longer have. If your context was summarised partway through, run the steps again from step 1.

**The emulator.** Use the same emulator as in CARD-033, with nobody signed in. Remove the app from CARD-033 first (each command prints `Success...`, or an error if there was nothing to remove; both are fine), and keep the screen from turning off by itself for 30 minutes:

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
```

`& $adb devices` must list exactly one `emulator-5554   device`. If it says `offline` for more than a minute, use the cold boot steps James gave you for CARD-030b; do not wait longer than 5 minutes.

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). `dev-grant.ts` signs a parent token with `JWT_SECRET`, so `$env:JWT_SECRET` must be the same value as in `deploy\.env`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
```

The last line prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Bedtime 60 0` moves Alex's bedtime to 60 minutes from now and sets today's allowance to 0 minutes, so the phone is out of time. `Grant 15` adds 15 minutes of Phone time for Alex today, as Dad (`Grant -15` takes 15 away). `Wait-Unblocked` waits until the block screen is gone and prints how many seconds that took. `LiveLog` prints the service's `live:` log lines with their times.

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
function Grant([int]$minutes) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-grant.ts Alex phone $minutes
}
function Top {
  & $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
}
function Wait-Unblocked {
  $start = Get-Date
  do {
    Start-Sleep -Milliseconds 500
    $top = (& $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1).Line
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($top -notmatch 'BlockActivity' -or $seconds -gt 45)
  if ($top -match 'BlockActivity') { "Still blocked after 45 s" } else { "Unblocked after {0:N0} s" -f $seconds }
}
function LiveLog {
  & $adb logcat -d -s KidService:I | Select-String 'live:' | ForEach-Object { $_.Line.Trim() }
}
```

`Grant` prints `Added 15 min of phone for Alex today, as Dad.` (or `Removed ...`). Each `LiveLog` line looks like `10-27 10:15:02.123  4321  4350 I KidService: live: connected`.

**The run.** From `android`, one step at a time; check each expected result before the next step. Times and seconds depend on how fast you go; what matters is what the card says about them.

1. Install, make it Device Owner and pair. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`, run `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` and copy the `Emulator link`. Back in the first window:
   ```powershell
   Bedtime 60
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   Open-App
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Start-Sleep -Seconds 10
   Shot "1-home"
   LiveLog
   ```
   `1-home` shows "Hi Alex" and the teal ring with about `1h`, as in CARD-033. `LiveLog` prints nothing: the phone is not blocked, so there is no live channel.
2. Out of time, and the channel opens:
   ```powershell
   Bedtime 60 0
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 15
   Shot "2-out-of-time"
   Top
   LiveLog
   ```
   `2-out-of-time` shows the block screen with the hourglass and "Out of Phone time". `Top` shows `au.screentime.kid/.block.BlockActivity`. `LiveLog` has `live: started`, then `live: connected`.
3. A grant comes down the socket. Run these three lines straight after each other, without a pause:
   ```powershell
   Grant 15
   Wait-Unblocked
   Shot "3-unblocked"
   LiveLog
   ```
   `Wait-Unblocked` prints `Unblocked after N s` with N **10 or less** (the 30-second poll alone would often take longer; the socket makes it about 1 to 3). `3-unblocked` shows the main screen with about `15m` in the ring, or the launcher, not the block screen. `LiveLog` now ends with `live: stopped`.
4. Lock again, and leave the socket open for 2 minutes, to see that the pings keep it alive:
   ```powershell
   Grant -15
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 120
   Top
   LiveLog
   ```
   `Top` shows `BlockActivity`. `LiveLog` has a new `live: started` and `live: connected` after the `live: stopped` of step 3, and **no** `failed`, `closed` or `nothing for 75 s` line after them: the socket stayed up for 2 minutes.
5. The server goes away and comes back. Stop the API for 20 seconds, start it again, and give the channel 75 seconds to reconnect:
   ```powershell
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env stop api
   Start-Sleep -Seconds 20
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env start api
   Start-Sleep -Seconds 75
   curl.exe -s http://localhost:8080/health
   LiveLog
   ```
   `curl.exe` shows `"status":"ok"`. `LiveLog`, after step 4's lines: one `live: closed: ...` or `live: failed: ...` line when the API stopped, a few `live: failed: ...` lines (for example `ConnectException`) a few seconds apart, the gaps growing, then `live: connected` again. No `live: stopped`: the phone stayed blocked.
6. The reconnected socket still works:
   ```powershell
   Grant 15
   Wait-Unblocked
   Shot "4-unblocked-again"
   ```
   `Unblocked after N s` with N 10 or less. `4-unblocked-again` shows the main screen or the launcher, not the block screen.
7. Screen off closes the socket:
   ```powershell
   Grant -15
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 10
   Top
   Screen-Off
   LiveLog
   ```
   `Top` shows `BlockActivity`. `LiveLog` ends with `live: started`, `live: connected`, `live: stopped`, in that order (the last one from the final `Screen-Off`).
8. Undo, so the emulator can be used again:
   ```powershell
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

- [ ] Steps 1 to 8 gave the expected results, run in this session. Paste the real output of every command in steps 2 to 7 into the handback (the `Bedtime`, `Grant`, `Top`, `Wait-Unblocked`, `curl.exe` and `LiveLog` lines).
- [ ] The four screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c34\`: `1-home.png`, `2-out-of-time.png`, `3-unblocked.png`, `4-unblocked-again.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 4 files (in any order):
  ```
  android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/live/LiveChannel.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt` | The socket address for `http` and `https` servers (and an error for anything else); the reconnect waits 1, 2, 4 … 60 seconds; the ±20% jitter; every envelope but `pong` asks for a sync; a frame that is not an envelope means nothing. |

The channel itself and the service's use of it are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-034: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-034-live-channel`
5. Open a PR into `main` titled `CARD-034: Live channel while blocked`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-034-live-channel --title "CARD-034: Live channel while blocked" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-034-live-channel.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: twelve suites, LiveTest 5, all `failures="0"`
   - [x] emulator run steps 1 to 8 — results as expected
   - [x] four screenshots in C:\Users\james\OpenCode\Testing\temp\c34\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 4 files

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

- **`LiveLog` has `live: started` but never `live: connected`**, only `live: failed: ...` lines: paste the first three `failed` lines and `curl.exe -s http://localhost:8080/health`, and stop there. Do not change the code.
- **`Grant` says `the API said 401`**: `$env:JWT_SECRET` is not the same as `JWT_SECRET` in `deploy\.env`. Set it again as in "The server" and repeat the step.
- **`Wait-Unblocked` prints `Still blocked after 45 s`**: paste `LiveLog` and `& $adb logcat -d -s KidService:I | Select-Object -Last 10`, and stop there.
- **`Wait-Unblocked` prints a number over 10**: run the step once more (do `Grant -15`, `Screen-Off`, `Screen-On`, wait 15 seconds, then the step). If it is over 10 again, report both numbers and `LiveLog`.
- **Step 5 has no `live: connected` after the failures**: wait 60 seconds more and run `LiveLog` again. If there is still none, paste it and stop there.
- **You are stuck in the block screen** and need the emulator back: `& $adb shell am task lock stop`, then `Grant 60`.
- **`Bedtime` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **`wm dismiss-keyguard` does nothing** (the lock screen stays): swipe up with `& $adb shell input swipe 540 1800 540 600` instead and say so under "Deviations".
- **`dpm set-device-owner` says there are accounts, several users, or already provisioned**: use a fresh emulator (Device Manager › **Wipe Data**), do not sign in, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
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
Claude, here is Bob's handback for CARD-034. Please review and merge if it is good.

CARD: CARD-034 Live channel while blocked
PR: <full PR URL>
Branch: bob/card-034-live-channel
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
