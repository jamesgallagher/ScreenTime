package au.screentime.kid.push

import au.screentime.kid.status.minutesText
import kotlin.math.abs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * A parent's change of time, as a `grant_added` push (docs/SPEC.md §10, CARD-034b). [fromRequest] is true when it
 * answers the kid's "Ask for more time": the "Dad said yes!" answer already shows, so the grant shows nothing more.
 */
data class GrantNews(
    val grantId: String,
    /** "phone" or "screens". */
    val pool: String,
    val minutes: Int,
    val byName: String,
    val fromRequest: Boolean,
)

/**
 * The [GrantNews] in a `grant_added` envelope, or null for any other type, a missing field, or text that is not a
 * JSON object.
 */
fun grantNewsOf(frame: String): GrantNews? = try {
    val envelope = Json.parseToJsonElement(frame) as? JsonObject
    val data = envelope?.get("data") as? JsonObject
    val grant = data?.get("grant") as? JsonObject
    if (envelope?.get("type")?.jsonPrimitive?.contentOrNull != "grant_added" || grant == null) {
        null
    } else {
        val id = grant["id"]?.jsonPrimitive?.contentOrNull
        val pool = grant["pool"]?.jsonPrimitive?.contentOrNull
        val minutes = grant["minutes"]?.jsonPrimitive?.intOrNull
        val byName = grant["byName"]?.jsonPrimitive?.contentOrNull
        val requestId = grant["requestId"]?.jsonPrimitive?.contentOrNull
        if (id == null || pool == null || minutes == null || byName == null) null
        else GrantNews(id, pool, minutes, byName, requestId != null)
    }
} catch (e: IllegalArgumentException) {
    null
}

/**
 * The notification words for [news], or null: when [GrantNews.fromRequest] (the "Dad said yes!" answer already
 * shows), or when the minutes are 0.
 */
fun grantText(news: GrantNews): String? {
    if (news.fromRequest || news.minutes == 0) return null
    val pool = if (news.pool == "phone") "Phone" else "Screens"
    val amount = minutesText(abs(news.minutes))
    return if (news.minutes > 0) {
        "${news.byName} added $amount of $pool time"
    } else {
        "${news.byName} took away $amount of $pool time"
    }
}
