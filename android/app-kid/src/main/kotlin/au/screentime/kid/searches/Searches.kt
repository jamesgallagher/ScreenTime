package au.screentime.kid.searches

import au.screentime.kid.apps.Span
import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/** A complete search found in a browser address or app search box. */
data class Found(val engine: String, val query: String)

/** A search sighting before it is merged into the local queue. */
data class SearchSighting(
    val atMs: Long,
    val engine: String,
    val query: String,
    val packageName: String,
)

/** A locally queued search, including its version for at-least-once upload. */
data class SearchRow(
    val atMs: Long,
    val lastAtMs: Long,
    val count: Int,
    val engine: String,
    val query: String,
    val packageName: String,
    val version: Long,
    val sentVersion: Long,
)

/** Decode and normalize a query, or return null when it has no words. */
fun cleanQuery(raw: String): String? {
    val normalized = raw.replace(Regex("\\s+"), " ").trim()
    if (normalized.isEmpty()) return null
    return normalized.take(200).trimEnd().ifEmpty { null }
}

/**
 * Read a completed search from a browser address. Bare addresses get https://, but typed words and non-search pages
 * are ignored. Search terms come only from a result URL, not from an address-bar edit.
 */
fun searchFromUrl(text: String): Found? {
    val raw = text.trim()
    if (raw.isEmpty()) return null
    val address = if (SCHEME.containsMatchIn(raw)) raw else "https://$raw"
    val uri = try {
        URI(address)
    } catch (_: URISyntaxException) {
        return null
    }
    if (uri.scheme?.lowercase() !in setOf("http", "https")) return null
    val host = uri.host?.lowercase() ?: return null
    val path = uri.rawPath?.ifEmpty { "/" } ?: "/"
    val (engine, key) = when {
        GOOGLE_HOST.matches(host) && path == "/search" -> "google" to "q"
        (host == "bing.com" || host == "www.bing.com") && path == "/search" -> "bing" to "q"
        (host == "duckduckgo.com" || host == "www.duckduckgo.com") && path in setOf("/", "/html") -> "duckduckgo" to "q"
        host in setOf("youtube.com", "www.youtube.com", "m.youtube.com") && path == "/results" -> "youtube" to "search_query"
        else -> return null
    }
    val rawQuery = uri.rawQuery ?: return null
    val encodedValue = rawQuery.split('&').firstNotNullOfOrNull { part ->
        val separator = part.indexOf('=')
        if (separator < 0 || part.substring(0, separator) != key) null else part.substring(separator + 1)
    } ?: return null
    val decoded = try {
        URLDecoder.decode(encodedValue, StandardCharsets.UTF_8)
    } catch (_: IllegalArgumentException) {
        return null
    }
    return cleanQuery(decoded)?.let { Found(engine, it) }
}

/** Emits a Chrome search once per transition into a result URL, not on every accessibility content event. */
class ChromeSentSearch {
    private var lastEngine: String? = null
    private var lastQuery: String? = null
    private var pendingQuery: String? = null
    private var pendingAtMs = 0L

    fun observe(address: String?, focused: Boolean, atMs: Long): Found? {
        if (address == null) return null
        val found = searchFromUrl(address)
        if (found == null) {
            if (focused) {
                pendingQuery = cleanQuery(address)
                pendingAtMs = atMs
            }
            return null
        }
        val same = lastEngine == found.engine && lastQuery.equals(found.query, ignoreCase = true)
        val wasSubmittedAgain = pendingQuery.equals(found.query, ignoreCase = true) && atMs - pendingAtMs in 0..60_000L
        pendingQuery = null
        pendingAtMs = 0
        if (same && !wasSubmittedAgain) return null
        lastEngine = found.engine
        lastQuery = found.query
        return found
    }
}

/**
 * Add one sighting. The same engine, case-insensitive words and package merge when the sighting is at most ten
 * minutes after that row's last sighting; every changed row gets a new version.
 */
fun addSighting(rows: List<SearchRow>, sighting: SearchSighting): List<SearchRow> {
    val query = cleanQuery(sighting.query) ?: return rows
    val repeatedIndex = rows.indices.lastOrNull { index ->
        val row = rows[index]
        val elapsed = sighting.atMs - row.lastAtMs
        row.engine == sighting.engine &&
            row.query.equals(query, ignoreCase = true) &&
            row.packageName == sighting.packageName &&
            elapsed in 0..REPEAT_WINDOW_MS
    }
    if (repeatedIndex == null) {
        return rows + SearchRow(
            atMs = sighting.atMs,
            lastAtMs = sighting.atMs,
            count = 1,
            engine = sighting.engine,
            query = query,
            packageName = sighting.packageName,
            version = 1,
            sentVersion = 0,
        )
    }
    return rows.mapIndexed { index, row ->
        if (index != repeatedIndex) row
        else row.copy(lastAtMs = sighting.atMs, count = row.count + 1, version = row.version + 1)
    }
}

/** Add this accessibility service without removing Bark or any other service; null means no setting change is needed. */
fun withService(current: String?, me: String): String? {
    val services = current.orEmpty().split(':').filter { it.isNotEmpty() }
    if (services.any { it == me }) return null
    return (services + me).joinToString(":")
}

/** Whether this search is outside every inclusive parent-mode span. */
fun outsideParentMode(atMs: Long, spans: List<Span>): Boolean =
    spans.none { atMs in it.fromMs..it.toMs }

/** Holds the last non-hint Google-app query until results open, and emits it once. */
class GoogleAppSearch {
    private var currentText = ""
    private var showingHint = false
    private var emitted = false

    fun text(value: String, isHint: Boolean) {
        if (currentText != value || showingHint != isHint) emitted = false
        currentText = value
        showingHint = isHint
    }

    fun resultsOpened(): String? {
        if (showingHint || emitted) return null
        val query = cleanQuery(currentText) ?: return null
        emitted = true
        return query
    }
}

private const val REPEAT_WINDOW_MS = 10 * 60 * 1000L
private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")
private val GOOGLE_HOST = Regex("^(?:www\\.)?google\\.[a-z]{2,}(?:\\.[a-z]{2,})?$")
