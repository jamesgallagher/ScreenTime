package au.screentime.parent.inbox

import au.screentime.core.model.api.TimeRequest
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * One thing that waits for a parent, shown in the "Waiting for you" strip at the top of every tab
 * (docs/SPEC.md §16.4). It stays there until a parent answers it, or, for a message, says "Got it".
 */
sealed interface Waiting {
    /** Unique across every kind: the strip's list key. */
    val key: String

    /** The event whose push made the notification, so the notification can be cleared; null when unknown. */
    val eventId: String?

    /** When it came in: an instant in UTC ISO 8601. */
    val at: String
    val kidName: String
    val deviceName: String?

    /** A time request: Other amount, No, Yes. */
    data class Time(val request: TimeRequest, override val eventId: String?) : Waiting {
        override val key get() = "time:${request.id}"
        override val at get() = request.createdAt
        override val kidName get() = request.kidName
        override val deviceName get() = request.deviceName
    }

    /** A parent-mode request (it waits 10 minutes): Answer opens the approval page. */
    data class ParentMode(
        val requestId: String,
        override val kidName: String,
        override val deviceName: String?,
        override val at: String,
        val expiresAt: String,
        override val eventId: String?,
    ) : Waiting {
        override val key get() = "parent-mode:$requestId"
    }

    /** A new app held until a parent answers (Android, docs/SPEC.md §12.4): Block, Allow. */
    data class NewApp(
        val kidId: String,
        override val kidName: String,
        val packageName: String,
        val label: String,
        /** `play`, `preinstalled`, `other`, or null when unknown. */
        val source: String?,
        override val deviceName: String?,
        override val at: String,
        override val eventId: String?,
    ) : Waiting {
        override val key get() = "app:$kidId:$packageName"
    }

    /** A message from a kid: Got it. */
    data class Message(
        val messageId: String,
        override val kidName: String,
        override val deviceName: String?,
        val body: String,
        override val at: String,
        override val eventId: String?,
    ) : Waiting {
        override val key get() = "message:$messageId"
    }
}

/** The strip's first line for an item. */
fun waitingTitle(w: Waiting): String = when (w) {
    is Waiting.Time -> requestTitle(w.request)
    is Waiting.ParentMode -> "${w.kidName} wants parent mode"
    is Waiting.NewApp -> "${w.kidName} installed ${w.label}"
    is Waiting.Message -> "Message from ${w.kidName}"
}

/** The strip's second line, or null for none. */
fun waitingDetail(w: Waiting): String? = when (w) {
    is Waiting.Time -> requestDetail(w.request)
    is Waiting.ParentMode -> null
    is Waiting.NewApp -> "${appSource(w.source)}. It stays blocked until you answer."
    is Waiting.Message -> "“${w.body}”"
}

/** The strip's small grey line: "Pixel 7 · 3:30 pm", and for parent mode " · answer by 3:40 pm". */
fun waitingMeta(w: Waiting, now: Instant, zone: ZoneId): String {
    val parts = listOfNotNull(w.deviceName, whenText(w.at, now, zone))
    val base = parts.joinToString(" · ")
    return if (w is Waiting.ParentMode) "$base · answer by ${timeOfDay(Instant.parse(w.expiresAt), zone)}" else base
}

/** "From Play Store", "Came with the device", "Installed another way". */
fun appSource(source: String?): String = when (source) {
    "play" -> "From Play Store"
    "preinstalled" -> "Came with the device"
    else -> "Installed another way"
}

/** The strip's header: "Waiting for you", with the number when there is more than one. */
fun waitingHeader(count: Int): String = if (count > 1) "Waiting for you · $count" else "Waiting for you"

/** The strip's toggle: "Show 2 more" when folded, "Show less" when open. */
fun waitingToggle(count: Int, expanded: Boolean): String = if (expanded) "Show less" else "Show ${count - 1} more"

/**
 * What the strip shows: newest first, without a parent-mode request whose 10 minutes are over (the server drops it
 * at the next load anyway; this hides it in between).
 */
fun visibleWaiting(items: List<Waiting>, now: Instant): List<Waiting> = items
    .filter { it !is Waiting.ParentMode || Instant.parse(it.expiresAt).isAfter(now) }
    .sortedWith(compareByDescending<Waiting> { Instant.parse(it.at) }.thenBy { it.key })

/** The strip opens (shows every item) when this changes: a notification for a waiting item was tapped. */
object WaitingNews {
    val open = MutableStateFlow(0)

    /** Open the strip. */
    fun open() {
        open.value += 1
    }
}
