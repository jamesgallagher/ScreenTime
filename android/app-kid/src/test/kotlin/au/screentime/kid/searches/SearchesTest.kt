package au.screentime.kid.searches

import au.screentime.kid.apps.Span
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SearchesTest {
    @Test
    fun `18 searchFromUrl extracts the specified sent searches and rejects other text`() {
        assertEquals(
            Found("google", "how to bake a cake"),
            searchFromUrl("google.com/search?q=how+to+bake+a+cake&oq=how+to+bake+a+cake&gs_lcrp=EgZjaHJvbWUy"),
        )
        assertEquals(
            Found("google", "Minecraft cheats"),
            searchFromUrl("https://www.google.com.au/search?q=Minecraft+cheats&client=ms-android-xiaomi-terr1-rso2"),
        )
        assertEquals(
            Found("google", "best dog breeds"),
            searchFromUrl("google.com/search?q=best+dog+breeds&sca_esv=83a04e53a9fccb5f&source=hp"),
        )
        assertEquals(Found("bing", "is roblox down"), searchFromUrl("bing.com/search?q=is+roblox+down&form=QBLH"))
        assertEquals(Found("duckduckgo", "lego star wars"), searchFromUrl("duckduckgo.com/?q=lego+star+wars&ia=web"))
        assertEquals(Found("youtube", "funny cats"), searchFromUrl("m.youtube.com/results?search_query=funny+cats"))
        assertEquals(
            Found("google", "\"quoted\" 50% off"),
            searchFromUrl("google.com/search?q=%22quoted%22+50%25+off"),
        )
        assertEquals(Found("google", "spaced out"), searchFromUrl("google.com/search?q=++spaced+++out++"))
        assertEquals(
            Found("google", "a".repeat(200)),
            searchFromUrl("google.com/search?q=${"a".repeat(250)}"),
        )

        listOf(
            "how to bake a cage",
            "google.com",
            "google.com/#sbfbu=1&pi=",
            "Search Google or type URL",
            "google.com. Connection is not secure",
            "google.com/search?q=",
            "notgoogle.com/search?q=x",
            "en.wikipedia.org/wiki/Cake",
            "google.com/maps?q=cafe",
        ).forEach { assertNull(searchFromUrl(it), it) }
    }

    @Test
    fun `19 addSighting merges only same searches inside ten minutes and increments versions`() {
        val at = 10 * 60 * 60 * 1000L
        val first = SearchRow(
            atMs = at,
            lastAtMs = at,
            count = 1,
            engine = "google",
            query = "Minecraft cheats",
            packageName = "com.android.chrome",
            version = 1,
            sentVersion = 0,
        )

        val repeated = addSighting(
            listOf(first),
            SearchSighting(at + 9 * 60 * 1000 + 59 * 1000L, "google", "minecraft cheats", "com.android.chrome"),
        )
        assertEquals(
            listOf(first.copy(lastAtMs = at + 9 * 60 * 1000 + 59 * 1000L, count = 2, version = 2)),
            repeated,
        )

        val afterWindow = addSighting(
            repeated,
            SearchSighting(at + 20 * 60 * 1000L, "google", "minecraft cheats", "com.android.chrome"),
        )
        assertEquals(2, afterWindow.size)
        assertEquals(at + 20 * 60 * 1000L, afterWindow[1].atMs)
        assertEquals(1, afterWindow[1].version)

        val differentPackage = addSighting(
            repeated,
            SearchSighting(at + 5 * 60 * 1000L, "google", "Minecraft cheats", "com.google.android.googlequicksearchbox"),
        )
        assertEquals(2, differentPackage.size)
        assertEquals("com.google.android.googlequicksearchbox", differentPackage[1].packageName)

        val differentEngine = addSighting(
            repeated,
            SearchSighting(at + 5 * 60 * 1000L, "bing", "Minecraft cheats", "com.android.chrome"),
        )
        assertEquals(2, differentEngine.size)
        assertEquals("bing", differentEngine[1].engine)
    }

    @Test
    fun `20 GoogleAppSearch emits the last non-hint query once when results open`() {
        val search = GoogleAppSearch()
        search.text("we", false)
        search.text("weather", false)
        search.text("weather tomorrow", false)
        assertEquals("weather tomorrow", search.resultsOpened())
        assertNull(search.resultsOpened())

        search.text("Ask Google", true)
        assertNull(search.resultsOpened())

        search.text("cats", false)
        search.text("", false)
        assertNull(search.resultsOpened())
    }

    @Test
    fun `21 withService adds ours and keeps existing accessibility services`() {
        val ours = "au.screentime.kid/au.screentime.kid.searches.SearchService"
        val bark = "com.pt.bark/com.pt.bark.services.accessibility.BarkAccessibilityService"
        assertEquals(ours, withService(null, ours))
        assertEquals(ours, withService("", ours))
        assertEquals("$bark:$ours", withService(bark, ours))
        assertNull(withService("$bark:$ours", ours))
        assertNull(withService("$ours:$bark", ours))
    }

    @Test
    fun `22 drops a sighting inside parent mode and keeps one a second after it ends`() {
        val span = Span(1000, 2000)
        assertFalse(outsideParentMode(1500, listOf(span)))
        assertFalse(outsideParentMode(2000, listOf(span)))
        assertTrue(outsideParentMode(2001, listOf(span)))
    }
}
