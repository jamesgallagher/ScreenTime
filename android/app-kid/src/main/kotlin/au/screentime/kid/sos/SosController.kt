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
import java.util.concurrent.Executors
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

    /**
     * Texts go out on their own thread. While sending, Android calls the default messaging app, and a slow or stuck
     * one must never hold up the SOS: the server, the positions and the screen go on without it.
     */
    private val texter = Executors.newSingleThreadExecutor()
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

    /**
     * A text to every parent with a mobile; it works without data (docs/SPEC.md §15 step 2). It returns at once:
     * [texter] sends it.
     */
    private fun text(message: String) {
        val numbers = state?.parents.orEmpty().mapNotNull { it.phoneE164 }
        if (numbers.isEmpty()) {
            Log.w(TAG, "sos: no parent has a mobile number, so no text")
            return
        }
        texter.execute {
            try {
                val sms = context.getSystemService(SmsManager::class.java)
                val parts = sms.divideMessage(message)
                for (number in numbers) sms.sendMultipartTextMessage(number, null, parts, null, null)
                Log.i(TAG, "sos: texted ${numbers.size} parent(s)")
            } catch (e: Exception) {
                // No permission, or no SIM: the push and the email still go.
                Log.w(TAG, "sos: the text failed", e)
            }
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
