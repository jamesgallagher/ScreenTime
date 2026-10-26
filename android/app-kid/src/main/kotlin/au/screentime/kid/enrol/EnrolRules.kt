package au.screentime.kid.enrol

import java.net.URI

// The small decisions of enrolment, kept free of Android so the JVM tests can check them.

/** What the kid typed, as at most 6 digits: spaces, dashes and letters are dropped. */
fun cleanCode(input: String): String = input.filter { it in '0'..'9' }.take(6)

/**
 * The server's base URL from what a parent typed or the QR code held, or null when it is not a server address.
 * Without a scheme it is `https://`. `http://` only works when [allowHttp] is true (debug builds, for a server
 * on the PC). A trailing `/` is dropped; a path, query or user name is refused.
 */
fun serverUrl(input: String, allowHttp: Boolean): String? {
    val text = input.trim()
    if (text.isEmpty() || text.any { it.isWhitespace() }) return null
    val withScheme = if ("://" in text) text else "https://$text"
    val uri = try {
        URI(withScheme)
    } catch (e: Exception) {
        return null
    }
    val scheme = uri.scheme?.lowercase()
    if (scheme != "https" && !(scheme == "http" && allowHttp)) return null
    if (uri.host.isNullOrEmpty() || uri.userInfo != null) return null
    if ((uri.rawPath ?: "") !in listOf("", "/") || uri.rawQuery != null || uri.rawFragment != null) return null
    val port = if (uri.port == -1) "" else ":${uri.port}"
    return "$scheme://${uri.host.lowercase()}$port"
}

/** The server address without `https://`, to show under the code boxes. */
fun serverLabel(url: String): String = url.removePrefix("https://")

/** `Google` + `Pixel 7` → `Google Pixel 7`; `samsung` + `SM-S916B` → `Samsung SM-S916B`. At most 100 characters. */
fun deviceModel(manufacturer: String, model: String): String {
    val maker = manufacturer.trim().replaceFirstChar { it.uppercase() }
    val name = model.trim()
    val full = when {
        maker.isEmpty() -> name
        name.isEmpty() -> maker
        name.startsWith(maker, ignoreCase = true) -> name
        else -> "$maker $name"
    }
    return full.ifEmpty { "Android device" }.take(100)
}

/** What the kid sees when enrolment fails. [status] is null when the server could not be reached. */
fun enrolErrorMessage(status: Int?): String = when (status) {
    null -> "Can't reach Screen Time. Check the Wi-Fi and try again."
    401 -> "That code didn't work. Check it, or ask for a new one."
    409 -> "That code is for a PC. Ask for a phone or tablet code."
    429 -> "Too many tries. Wait 15 minutes, then try again."
    else -> "Something went wrong. Try again."
}
