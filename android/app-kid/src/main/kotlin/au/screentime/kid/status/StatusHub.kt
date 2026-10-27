package au.screentime.kid.status

import au.screentime.kid.live.Answer
import kotlinx.coroutines.flow.MutableStateFlow

/** The latest status, from the service to the screens of the same process. Null until the first sync. */
object StatusHub {
    val status = MutableStateFlow<KidStatus?>(null)

    /** A parent's answer that just came in; the screen showing it sets it back to null after 4 seconds. */
    val answer = MutableStateFlow<Answer?>(null)
}
