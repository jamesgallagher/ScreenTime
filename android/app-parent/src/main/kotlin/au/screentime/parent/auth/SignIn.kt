package au.screentime.parent.auth

import au.screentime.core.model.api.ApiException

/** The typed email, trimmed and lower case. */
fun cleanEmail(text: String): String = text.trim().lowercase()

/**
 * A plausible email address: exactly one `@` (not first), a `.` after the `@` with at least one character
 * between them, not ending in `.`, and no whitespace anywhere (docs/SPEC.md §11.1).
 */
fun looksLikeEmail(email: String): Boolean {
    if (email.count { it == '@' } != 1) return false
    val at = email.indexOf('@')
    if (at == 0) return false
    val domain = email.substring(at + 1)
    if (domain.indexOf('.') < 1) return false
    if (email.endsWith('.')) return false
    if (email.any { it.isWhitespace() }) return false
    return true
}

/** The typed code, keeping only the digits 0 to 9, at most the first six. */
fun cleanCode(text: String): String = text.filter { it in '0'..'9' }.take(6)

/** The words for a sign-in problem (docs/SPEC.md §11.1). */
fun signInError(e: Exception, verifying: Boolean): String {
    if (e is ApiException) {
        return when (e.status) {
            429 -> "Too many tries. Wait a few minutes, then try again."
            401 -> if (verifying) "That code didn't work. Check it, or send a new code." else "Something went wrong on the server. Try again soon."
            422 -> "Check the email address and try again."
            else -> "Something went wrong on the server. Try again soon."
        }
    }
    return "Can't reach Screen Time. Check the internet connection and try again."
}
