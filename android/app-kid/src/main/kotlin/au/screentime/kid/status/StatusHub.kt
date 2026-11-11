package au.screentime.kid.status

import au.screentime.kid.live.Answer
import au.screentime.kid.live.ParentModeNews
import au.screentime.kid.sos.SosView
import au.screentime.kid.tamper.CaughtLine
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

    /** The kid's apps with a daily limit (docs/SPEC.md §12.4, §16.2). CARD-058 fills it; until then it is empty. */
    val appLimits = MutableStateFlow<List<AppLimitView>>(emptyList())

    /** What the caught screen says while it is up (docs/SPEC.md §14); it sets it back to null when it closes. */
    val caught = MutableStateFlow<CaughtLine?>(null)

    /** The always-allowed apps the block screen offers: only while time is up, never from bedtime to wake-up (§12.4). */
    val freeApps = MutableStateFlow<List<FreeApp>>(emptyList())

    /**
     * `SystemClock.elapsedRealtime()` when the kid opened one from the block screen: the service leaves the block
     * screen down for a moment, until Android's usage events show the app in front.
     */
    val freeOpenedAt = MutableStateFlow<Long?>(null)
}

/** An always-allowed app on the block screen. */
data class FreeApp(val packageName: String, val label: String)
