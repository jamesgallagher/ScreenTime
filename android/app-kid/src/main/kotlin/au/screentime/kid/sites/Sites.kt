package au.screentime.kid.sites

import au.screentime.kid.apps.Span
import au.screentime.kid.data.SiteLookupRow
import kotlin.coroutines.cancellation.CancellationException

/**
 * A DNS hostname as the kid app stores it (docs/SPEC.md §12.10): lower case, trimmed, the trailing dot dropped.
 * Empty hosts and IP literals (IPv4 and IPv6) are not sites: null.
 */
fun normalizeHost(raw: String): String? {
    val host = raw.trim().lowercase().trimEnd('.')
    if (host.isEmpty()) return null
    // A colon only happens in IPv6 (and zone) literals.
    if (host.contains(':')) return null
    if (host.isIpv4()) return null
    return host
}

/** Four dot-separated groups of 1 to 3 digits, each 255 or less. */
private fun String.isIpv4(): Boolean {
    val parts = split('.')
    if (parts.size != 4) return false
    return parts.all { it.isNotEmpty() && it.length <= 3 && it.all(Char::isDigit) && it.toInt() <= 255 }
}

/**
 * Whether a DNS lookup is kept (docs/SPEC.md §12.10): not the kid app itself, not an empty package, and not
 * inside a parent mode span (a span's ends count as inside).
 */
fun keepLookup(host: String?, pkg: String?, atMs: Long, ownPackage: String, parentModeSpans: List<Span>): Boolean {
    if (host == null) return false
    if (pkg == null || pkg.isEmpty()) return false
    if (pkg == ownPackage) return false
    if (parentModeSpans.any { atMs in it.fromMs..it.toMs }) return false
    return true
}

/** What one sync's upload did: rows sent and deleted, and how many of them the server had not seen. */
data class SitesSent(val sent: Int, val received: Int)

/**
 * One sync's upload (docs/SPEC.md §12.10): the oldest [batchSize] rows, deleted only once the server took them,
 * then the next, at most [maxCalls] calls. It stops at the first failure (the rows wait for the next sync) or when
 * nothing is left. [send] answers the server's `received` and throws on any failure.
 */
suspend fun uploadLookups(
    oldest: suspend (Int) -> List<SiteLookupRow>,
    send: suspend (List<SiteLookupRow>) -> Int,
    delete: suspend (List<Long>) -> Unit,
    onFailure: (batch: Int, e: Exception) -> Unit = { _, _ -> },
    batchSize: Int = 1000,
    maxCalls: Int = 10,
): SitesSent {
    var sent = 0
    var received = 0
    for (call in 1..maxCalls) {
        val batch = oldest(batchSize)
        if (batch.isEmpty()) break
        val new = try {
            send(batch)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            onFailure(batch.size, e)
            break
        }
        delete(batch.map { it.id })
        sent += batch.size
        received += new
    }
    return SitesSent(sent, received)
}
