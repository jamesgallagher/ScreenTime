package au.screentime.parent.update

import au.screentime.core.ui.update.UpdateSource
import au.screentime.core.ui.update.UpdateState
import au.screentime.core.ui.update.megabytes

/**
 * The parent app's own update source (docs/SPEC.md §12.7, §12.11): the shared [UpdateSource] (check now, update)
 * plus the app coming to the front, which checks when one is due. The state and words are in `core-ui`.
 */
interface ParentUpdateSource : UpdateSource {
    /**
     * The app came to the front with a parent signed in: check when one is due (the first time since the app
     * started, then at most every 6 hours). Leaves what is shown alone until the answer comes.
     */
    fun onForeground()
}

/** The app's one [ParentUpdateSource]; set once when the app starts. */
object ParentUpdates {
    lateinit var source: ParentUpdateSource
}

/** Whether the row at the top of the app shows (it never shows while an SOS is on: an install would stop the alarm). */
fun showsUpdateRow(state: UpdateState, sosActive: Boolean): Boolean = !sosActive && when (state) {
    is UpdateState.Available, is UpdateState.Downloading, is UpdateState.Ready, is UpdateState.Installing,
    is UpdateState.Failed -> true
    UpdateState.Unknown, UpdateState.Checking, UpdateState.UpToDate, UpdateState.CheckFailed -> false
}

/** The row's first line. */
fun updateTitle(state: UpdateState): String = when (state) {
    is UpdateState.Available -> "ST Parent ${state.versionName} is out"
    is UpdateState.Downloading -> "Getting ST Parent ${state.versionName}…"
    is UpdateState.Ready -> "ST Parent ${state.versionName} is ready"
    is UpdateState.Installing -> "Updating ST Parent…"
    is UpdateState.Failed -> "ST Parent ${state.versionName} didn't install"
    UpdateState.Unknown, UpdateState.Checking, UpdateState.UpToDate, UpdateState.CheckFailed -> ""
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
