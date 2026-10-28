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
            // Back online: what an SOS still has to send goes at once, not at the next tick.
            scope.launch { if (!lastSyncOk || sos.pending) sync() }
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
                // least every 30 seconds whatever the screen does, and a sync every 5 minutes (every tick while the
                // live channel is down), so a parent's end or a new schedule still arrives.
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
                    sosOn -> {
                        val recent = SystemClock.elapsedRealtime() - lastSyncElapsed < 5 * MINUTE
                        if (live?.connected == true && recent) report() else sync()
                    }
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
