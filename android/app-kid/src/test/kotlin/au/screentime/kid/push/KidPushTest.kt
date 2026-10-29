package au.screentime.kid.push

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** CARD-034b: what the kid app makes of a `grant_added` push. Copied verbatim from the card. */
class KidPushTest {
    private fun frame(minutes: Int, pool: String = "phone", requestId: String? = null, type: String = "grant_added") =
        """{"v":1,"type":"$type","at":"2026-10-29T05:00:00Z","data":{"byName":"Dad","grant":{"id":"g1","pool":"$pool",""" +
            """"minutes":$minutes,"day":"2026-10-29","createdAt":"2026-10-29T05:00:00Z","byName":"Dad","note":null,""" +
            """"requestId":${requestId?.let { "\"$it\"" } ?: "null"}}}}"""

    @Test
    fun grantsAreRead() {
        assertEquals(GrantNews("g1", "phone", 15, "Dad", false), grantNewsOf(frame(15)))
        assertEquals(GrantNews("g1", "screens", -90, "Dad", false), grantNewsOf(frame(-90, "screens")))
        assertEquals(GrantNews("g1", "phone", 30, "Dad", true), grantNewsOf(frame(30, requestId = "r1")))
    }

    @Test
    fun otherFramesAreNotGrants() {
        assertNull(grantNewsOf(frame(15, type = "state_changed")))
        assertNull(grantNewsOf("""{"v":1,"type":"grant_added","at":"2026-10-29T05:00:00Z","data":{}}"""))
        assertNull(grantNewsOf("not json"))
        assertNull(grantNewsOf("[1,2]"))
    }

    @Test
    fun theNotificationWords() {
        assertEquals("Dad added 15 min of Phone time", grantText(GrantNews("g", "phone", 15, "Dad", false)))
        assertEquals("Mum added 2h of Screens time", grantText(GrantNews("g", "screens", 120, "Mum", false)))
        assertEquals("Dad took away 1h 30m of Screens time", grantText(GrantNews("g", "screens", -90, "Dad", false)))
        // A yes to "Ask for more time" already shows "Dad said yes!", so its grant shows nothing more.
        assertNull(grantText(GrantNews("g", "phone", 30, "Dad", true)))
        assertNull(grantText(GrantNews("g", "phone", 0, "Dad", false)))
    }
}
