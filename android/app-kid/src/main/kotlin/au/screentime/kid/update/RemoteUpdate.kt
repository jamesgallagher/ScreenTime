package au.screentime.kid.update

import java.time.Instant

/** What a parent's remote "Update now" should do (docs/SPEC.md §12.11). WAIT means the install waits for the SOS to end. */
enum class RemoteUpdateAction { NOTHING, WAIT, ACT }

/**
 * The pure rule: act when the request is for a version above [currentCode] and its [requestedAt] is not the one this
 * device already acted on ([handledAtMs]); while an SOS is on, wait (do not install).
 */
fun remoteUpdateAction(
    versionCode: Int?,
    requestedAt: String?,
    currentCode: Int,
    handledAtMs: Long?,
    sosActive: Boolean,
): RemoteUpdateAction {
    if (versionCode == null || requestedAt == null) return RemoteUpdateAction.NOTHING
    if (versionCode <= currentCode) return RemoteUpdateAction.NOTHING
    val at = try { Instant.parse(requestedAt).toEpochMilli() } catch (e: Exception) { return RemoteUpdateAction.NOTHING }
    if (at == handledAtMs) return RemoteUpdateAction.NOTHING
    return if (sosActive) RemoteUpdateAction.WAIT else RemoteUpdateAction.ACT
}
