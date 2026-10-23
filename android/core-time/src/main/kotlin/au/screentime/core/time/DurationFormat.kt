package au.screentime.core.time

/**
 * Formats a duration for people, as in docs/SPEC.md §16.1:
 * "1h 12m", "45m", "2h", or "less than a minute".
 * Seconds are rounded down to whole minutes. Zero or negative gives "less than a minute".
 */
fun formatDuration(seconds: Long): String {
    val totalMinutes = seconds / 60
    if (totalMinutes < 1) return "less than a minute"
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    return when {
        hours == 0L -> "${minutes}m"
        minutes == 0L -> "${hours}h"
        else -> "${hours}h ${minutes}m"
    }
}
