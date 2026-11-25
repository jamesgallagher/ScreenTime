package au.screentime.kid.searches

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import au.screentime.kid.apps.APPS_PREFS
import au.screentime.kid.apps.PARENT_FROM
import au.screentime.kid.apps.Span
import au.screentime.kid.apps.parseSpans
import au.screentime.kid.data.KidDatabase
import au.screentime.kid.data.RoomSearchStore
import kotlinx.coroutines.cancel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Captures only complete search URLs in Chrome and searches submitted through the Google app. */
class SearchService : AccessibilityService() {
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val googleSearch = GoogleAppSearch()
    private val chromeSearch = ChromeSentSearch()

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: return
        if (pkg != CHROME && pkg != GOOGLE_APP) return
        val root = rootInActiveWindow ?: return
        try {
            val observed = inspect(root, pkg)
            val atMs = System.currentTimeMillis()
            when (pkg) {
                CHROME -> chromeSearch.observe(observed.chromeAddress)?.let { record(it, pkg, atMs) }
                GOOGLE_APP -> {
                    observed.googleBox?.let { googleSearch.text(it.text, it.isHint) }
                    if (observed.webView) googleSearch.resultsOpened()?.let { record(Found("google", it), pkg, atMs) }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "searches: capture failed ${e.javaClass.simpleName}")
        } finally {
            root.recycle()
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        io.cancel()
        super.onDestroy()
    }

    private fun record(found: Found, pkg: String, atMs: Long) {
        if (!outsideParentMode(atMs, parentModeSpans(atMs))) return
        io.launch {
            try {
                RoomSearchStore(KidDatabase.open(this@SearchService).searches())
                    .record(SearchSighting(atMs, found.engine, found.query, pkg))
                Log.i(TAG, "searches: found ${found.engine} $pkg")
            } catch (e: Exception) {
                Log.w(TAG, "searches: store failed ${e.javaClass.simpleName}")
            }
        }
    }

    private fun parentModeSpans(nowMs: Long): List<Span> {
        val prefs = getSharedPreferences(APPS_PREFS, Context.MODE_PRIVATE)
        val spans = parseSpans(prefs.getString(SPANS, null).orEmpty()).toMutableList()
        val started = prefs.getLong(PARENT_FROM, -1).takeIf { it >= 0 }
        if (started != null) spans += Span(started, nowMs)
        return spans
    }

    private fun inspect(root: AccessibilityNodeInfo, pkg: String): Observed {
        var chromeAddress: String? = null
        var googleBox: GoogleBox? = null
        var webView = false

        fun walk(node: AccessibilityNodeInfo, depth: Int) {
            if (depth > MAX_DEPTH) return
            val viewId = node.viewIdResourceName
            if (pkg == CHROME && viewId == CHROME_URL_BAR) {
                chromeAddress = node.text?.toString()
            } else if (pkg == GOOGLE_APP && viewId == GOOGLE_SEARCH_BOX) {
                googleBox = GoogleBox(node.text?.toString().orEmpty(), node.isShowingHintText)
            }
            if (pkg == GOOGLE_APP && node.className?.toString()?.contains("WebView") == true) webView = true

            for (index in 0 until node.childCount) {
                val child = node.getChild(index) ?: continue
                try {
                    walk(child, depth + 1)
                } finally {
                    child.recycle()
                }
            }
        }

        walk(root, 0)
        return Observed(chromeAddress, googleBox, webView)
    }

    private data class GoogleBox(val text: String, val isHint: Boolean)
    private data class Observed(val chromeAddress: String?, val googleBox: GoogleBox?, val webView: Boolean)

    private companion object {
        const val TAG = "Searches"
        const val MAX_DEPTH = 40
        const val CHROME = "com.android.chrome"
        const val GOOGLE_APP = "com.google.android.googlequicksearchbox"
        const val YOUTUBE_APP = "com.google.android.youtube"
        const val CHROME_URL_BAR = "com.android.chrome:id/url_bar"
        const val GOOGLE_SEARCH_BOX = "com.google.android.googlequicksearchbox:id/googleapp_search_box"
        const val SPANS = "spans"
    }
}
