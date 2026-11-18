package au.screentime.parent.update

import kotlin.math.roundToLong
import kotlinx.coroutines.flow.StateFlow

/**
 * Where the parent app's own update stands (docs/SPEC.md §12.7). The app checks and downloads by itself; installing
 * waits for a parent to tap **Update**, because Android (the first time) and Play Protect (for a version it has not
 * seen) may ask a question, and a question should come right after a tap, never out of nowhere.
 */
sealed interface UpdateState {
    /** Not checked yet, or the last check failed: nothing to say. */
    data object Unknown : UpdateState

    /** A check a parent asked for is running. */
    data object Checking : UpdateState

    /** The server has nothing newer. */
    data object UpToDate : UpdateState

    /** A newer version is offered but not downloaded yet (the phone is on mobile data). **Update** downloads it first. */
    data class Available(val versionName: String, val sizeBytes: Long) : UpdateState

    /** The newer version is being downloaded. */
    data class Downloading(val versionName: String) : UpdateState

    /** The newer version is here and checked: **Update** installs it. */
    data class Ready(val versionName: String) : UpdateState

    /** Android is installing it; the app closes and opens again on the new version. */
    data class Installing(val versionName: String) : UpdateState

    /** The last try did not finish: a question was answered no, or the download or install failed. */
    data class Failed(val versionName: String) : UpdateState
}

/**
 * The one thing the screens listen to. Everything behind it (checking, downloading, Android's installer) is the
 * updater's job, not the screens'.
 */
interface UpdateSource {
    val state: StateFlow<UpdateState>

    /** **Check for updates** in Settings. */
    fun checkNow()

    /** **Update**: downloads first when needed, then installs. */
    fun update()
}

/** The app's one [UpdateSource]; set once when the app starts. */
object ParentUpdates {
    lateinit var source: UpdateSource
}

/** Whether the row at the top of the app shows (it never shows while an SOS is on: an install would stop the alarm). */
fun showsUpdateRow(state: UpdateState, sosActive: Boolean): Boolean = !sosActive && when (state) {
    is UpdateState.Available, is UpdateState.Downloading, is UpdateState.Ready, is UpdateState.Installing,
    is UpdateState.Failed -> true
    UpdateState.Unknown, UpdateState.Checking, UpdateState.UpToDate -> false
}

/** The row's first line. */
fun updateTitle(state: UpdateState): String = when (state) {
    is UpdateState.Available -> "ST Parent ${state.versionName} is out"
    is UpdateState.Downloading -> "Getting ST Parent ${state.versionName}…"
    is UpdateState.Ready -> "ST Parent ${state.versionName} is ready"
    is UpdateState.Installing -> "Updating ST Parent…"
    is UpdateState.Failed -> "ST Parent ${state.versionName} didn't install"
    UpdateState.Unknown, UpdateState.Checking, UpdateState.UpToDate -> ""
}

/** The row's second line, or null for none. */
fun updateDetail(state: UpdateState): String? = when (state) {
    is UpdateState.Available -> "Update downloads ${megabytes(state.sizeBytes)}."
    is UpdateState.Ready -> "Takes a few seconds. The app opens again by itself."
    is UpdateState.Installing -> "The app closes and opens again."
    is UpdateState.Failed -> "Tap Update to try again."
    else -> null
}

/** Whether the row has an **Update** button (no button while something is already happening). */
fun updateButton(state: UpdateState): Boolean =
    state is UpdateState.Available || state is UpdateState.Ready || state is UpdateState.Failed

/** The status under "Version 0.1.2" in Settings, or null for none. */
fun versionStatus(state: UpdateState): String? = when (state) {
    UpdateState.Unknown -> null
    UpdateState.Checking -> "Checking for updates…"
    UpdateState.UpToDate -> "Up to date"
    is UpdateState.Available -> "${state.versionName} is out"
    is UpdateState.Downloading -> "Getting ${state.versionName}…"
    is UpdateState.Ready -> "${state.versionName} is ready"
    is UpdateState.Installing -> "Updating…"
    is UpdateState.Failed -> "${state.versionName} didn't install"
}

/** Settings shows **Check for updates** only when there is nothing newer to act on. */
fun canCheck(state: UpdateState): Boolean = state == UpdateState.Unknown || state == UpdateState.UpToDate

/** "34 MB" (whole megabytes, at least 1). */
fun megabytes(bytes: Long): String = "${(bytes / 1_000_000.0).roundToLong().coerceAtLeast(1)} MB"
