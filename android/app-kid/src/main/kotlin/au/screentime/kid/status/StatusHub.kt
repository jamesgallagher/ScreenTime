package au.screentime.kid.status

import kotlinx.coroutines.flow.MutableStateFlow

/** The latest status, from the service to the screens of the same process. Null until the first sync. */
object StatusHub {
    val status = MutableStateFlow<KidStatus?>(null)
}
