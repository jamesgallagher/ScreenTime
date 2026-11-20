package au.screentime.kid.sites

import au.screentime.kid.apps.Span

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
