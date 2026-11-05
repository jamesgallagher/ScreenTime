package au.screentime.kid.status

import au.screentime.core.time.formatDuration

/** One app with a daily limit, as the main screen shows it (docs/SPEC.md §16.2). */
data class AppLimitView(val label: String, val leftSec: Long)

/** "YouTube · 12m left", "YouTube · less than a minute left" or "YouTube · done for today". */
fun appLimitLine(view: AppLimitView): String =
    if (view.leftSec <= 0) "${view.label} · done for today" else "${view.label} · ${formatDuration(view.leftSec)} left"
