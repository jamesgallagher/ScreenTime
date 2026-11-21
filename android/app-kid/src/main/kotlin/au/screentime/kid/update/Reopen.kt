package au.screentime.kid.update

/** 10 minutes, in milliseconds. */
private const val REOPEN_WINDOW_MS = 10 * 60 * 1_000L

/**
 * Whether the kid app should reopen its main screen after an update (docs/SPEC.md §12.11):
 * true only when a parent-asked install was noted and the replacement happened within 10 minutes.
 */
fun shouldReopen(askedAtMs: Long?, nowMs: Long): Boolean =
    askedAtMs != null && nowMs - askedAtMs in 0..REOPEN_WINDOW_MS
