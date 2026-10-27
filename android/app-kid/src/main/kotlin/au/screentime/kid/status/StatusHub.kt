package au.screentime.kid.status

import au.screentime.kid.live.Answer
import au.screentime.kid.live.ParentModeNews
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
}
