package au.screentime.kid.enrol

import java.net.URI
import java.net.URLDecoder

/** What the enrolment QR code holds: the server to use and the 6-digit code (docs/SPEC.md §11.3). */
data class EnrolLink(val server: String, val code: String)

/** A host name or IP address with an optional port, like `screentime.gallagherhome.au` or `10.0.2.2:8080`. */
private val HOST = Regex("[A-Za-z0-9.-]+(:[0-9]{1,5})?")

/**
 * Reads `screentime://enrol?host=<host>&code=<6 digits>`, or returns null when [text] is anything else.
 * The host is reached over `https://`. When [allowHttp] is true (debug builds), a host with a port uses
 * `http://`, for a server on the PC like `10.0.2.2:8080`.
 */
fun parseEnrolLink(text: String, allowHttp: Boolean): EnrolLink? {
    val uri = try {
        URI(text.trim())
    } catch (e: Exception) {
        return null
    }
    if (uri.scheme?.lowercase() != "screentime" || uri.host?.lowercase() != "enrol") return null
    if ((uri.rawPath ?: "") !in listOf("", "/")) return null
    val params = (uri.rawQuery ?: return null).split('&').associate { part ->
        val name = part.substringBefore('=')
        val value = part.substringAfter('=', "")
        name to try {
            URLDecoder.decode(value, Charsets.UTF_8)
        } catch (e: IllegalArgumentException) {
            return null
        }
    }
    val host = params["host"] ?: return null
    val code = params["code"] ?: return null
    if (!HOST.matches(host) || code.length != 6 || code.any { it !in '0'..'9' }) return null
    val scheme = if (allowHttp && ':' in host) "http" else "https"
    val server = serverUrl("$scheme://$host", allowHttp) ?: return null
    return EnrolLink(server, code)
}
