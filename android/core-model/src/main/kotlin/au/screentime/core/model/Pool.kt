package au.screentime.core.model

/**
 * A daily pool of time for one kid (docs/SPEC.md §6).
 * [apiValue] is the exact text used in the API and the database.
 */
enum class Pool(val apiValue: String) {
    SCREENS("screens"),
    PHONE("phone");

    companion object {
        /** Returns the pool for an API value, or null if the value is unknown. */
        fun fromApiValue(value: String): Pool? = entries.firstOrNull { it.apiValue == value }
    }
}
