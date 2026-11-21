package au.screentime.core.ui.update

import kotlin.math.roundToLong
import kotlinx.coroutines.flow.StateFlow

/**
 * Where an app's own update stands (docs/SPEC.md §12.11): the one thing the Updates sheet listens to, the same in
 * the kid app and the parent app (the Windows tray has its own copy in C#; `test-vectors/update-words.json` keeps
 * the words of all three equal).
 */
sealed interface UpdateState {
    /** Not checked yet: nothing to say. */
    data object Unknown : UpdateState

    /** A check is running. */
    data object Checking : UpdateState

    /** The server has nothing newer. */
    data object UpToDate : UpdateState

    /** The last check could not reach the server. Shown until the next check. */
    data object CheckFailed : UpdateState

    /** A newer version is offered but not downloaded yet. **Update now** downloads it first. */
    data class Available(val versionName: String, val sizeBytes: Long) : UpdateState

    /** The newer version is being downloaded. */
    data class Downloading(val versionName: String) : UpdateState

    /** The newer version is here and checked: **Update now** installs it. */
    data class Ready(val versionName: String) : UpdateState

    /** Android is installing it; the app closes and opens again on the new version. */
    data class Installing(val versionName: String) : UpdateState

    /** The last try did not finish: the download or install failed, or a question was answered no. */
    data class Failed(val versionName: String) : UpdateState
}

/**
 * What the screens call. Everything behind it (checking, downloading, Android's installer) is the updater's job,
 * not the screens'. The kid app's real one is `KidUpdateSource`, the parent app's is `ParentUpdater`.
 */
interface UpdateSource {
    val state: StateFlow<UpdateState>

    /** **Check for updates**: checks at once, whatever the automatic timer says, and shows `Checking` meanwhile. */
    fun checkNow()

    /** **Update now** (or **Try again**): downloads first when needed, then installs at once. */
    fun update()
}

/** "34 MB" (whole megabytes, at least 1). */
fun megabytes(bytes: Long): String = "${(bytes / 1_000_000.0).roundToLong().coerceAtLeast(1)} MB"

/** The status line under "Version 0.1.8", or null for none (docs/SPEC.md §12.11). */
fun statusLine(state: UpdateState): String? = when (state) {
    UpdateState.Unknown -> null
    UpdateState.Checking -> "Checking for updates…"
    UpdateState.UpToDate -> "You're up to date"
    UpdateState.CheckFailed -> "Couldn't check. Check the internet and try again."
    is UpdateState.Available -> "${state.versionName} is out (${megabytes(state.sizeBytes)}). Update now?"
    is UpdateState.Downloading -> "Getting ${state.versionName}…"
    is UpdateState.Ready -> "${state.versionName} is ready. Update now?"
    is UpdateState.Installing -> "Updating…"
    is UpdateState.Failed -> "${state.versionName} didn't install."
}

/** The main button's words, or null when a spinner is shown instead. */
fun mainButton(state: UpdateState): String? = when (state) {
    UpdateState.Unknown, UpdateState.UpToDate, UpdateState.CheckFailed -> "Check for updates"
    is UpdateState.Available, is UpdateState.Ready -> "Update now"
    is UpdateState.Failed -> "Try again"
    UpdateState.Checking, is UpdateState.Downloading, is UpdateState.Installing -> null
}

/** Whether the main button applies an update (rather than checking for one); **Later** shows then too. */
fun mainButtonUpdates(state: UpdateState): Boolean =
    state is UpdateState.Available || state is UpdateState.Ready || state is UpdateState.Failed

/** The line under **Update now** in each app (docs/SPEC.md §12.11). */
object WhatWillHappen {
    const val KID = "Screen Time restarts in a few seconds. Parent mode stays on."
    const val PARENT = "Takes a few seconds. The app opens again by itself."
}

/** A check finished less than this long ago is not repeated when the sheet opens. */
const val RECENT_CHECK_SECONDS = 60L

/**
 * Whether opening Updates checks at once: not while something is already under way (checking, getting, ready,
 * updating, or a failed try waiting for **Try again**), and not when a check finished in the last minute.
 */
fun checkOnOpen(state: UpdateState, secondsSinceLastCheck: Long?): Boolean = when (state) {
    UpdateState.Checking, is UpdateState.Downloading, is UpdateState.Ready, is UpdateState.Installing,
    is UpdateState.Failed -> false
    UpdateState.Unknown, UpdateState.UpToDate, UpdateState.CheckFailed, is UpdateState.Available ->
        secondsSinceLastCheck == null || secondsSinceLastCheck >= RECENT_CHECK_SECONDS
}
