package au.screentime.parent.inbox

import kotlinx.coroutines.flow.MutableStateFlow

/** The Inbox reloads when this changes: a push arrived while the app is open. */
object InboxNews {
    val changed = MutableStateFlow(0)

    /** Tell the Inbox to reload. */
    fun bump() {
        changed.value += 1
    }
}
