package au.screentime.parent.push

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import au.screentime.core.model.api.EventItem
import au.screentime.parent.MainActivity
import au.screentime.parent.R
import au.screentime.parent.inbox.eventView
import au.screentime.parent.sos.SosActivity
import au.screentime.parent.sos.SosAlarm
import au.screentime.parent.sos.sosIdOf
import java.time.Instant
import java.time.ZoneId

/** The extras a `parent_mode.request` notification carries to the approval page. */
const val EXTRA_REQUEST_ID = "au.screentime.parent.REQUEST_ID"
const val EXTRA_KID_NAME = "au.screentime.parent.KID_NAME"
const val EXTRA_DEVICE_NAME = "au.screentime.parent.DEVICE_NAME"

/** The four notification channels (docs/SPEC.md §13). */
fun createChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannels(
        listOf(
            channel(CHANNEL_CRITICAL, "SOS", "When a kid presses SOS.", NotificationManager.IMPORTANCE_HIGH, true),
            channel(CHANNEL_ALERTS, "Alerts", "Parent mode and tamper alerts.", NotificationManager.IMPORTANCE_HIGH, false),
            channel(CHANNEL_REQUESTS, "Requests", "Time requests and messages from the kids.", NotificationManager.IMPORTANCE_DEFAULT, false),
            channel(CHANNEL_INFO, "Other news", "Everything else, like a new device or the other parent's changes.", NotificationManager.IMPORTANCE_LOW, false),
        ),
    )
}

private fun channel(id: String, name: String, description: String, importance: Int, bypassDnd: Boolean): NotificationChannel {
    val c = NotificationChannel(id, name, importance)
    c.description = description
    if (bypassDnd) c.setBypassDnd(true)
    return c
}

/** Show one push as a notification with the same words as the Inbox (docs/SPEC.md §13). */
fun show(context: Context, e: EventItem) {
    val v = eventView(e, ZoneId.systemDefault())
    val intent = if (sosIdOf(e) != null) {
        // An SOS push opens the SOS page, not the app.
        Intent(context, SosActivity::class.java)
            .putExtra(SosAlarm.EXTRA_SOS_ID, sosIdOf(e))
            .putExtra(SosAlarm.EXTRA_KID_NAME, e.kidName ?: "your kid")
            .putExtra(SosAlarm.EXTRA_DEVICE_NAME, e.deviceName)
    } else {
        Intent(context, MainActivity::class.java).apply {
            if (requestIdOf(e) != null) {
                putExtra(EXTRA_REQUEST_ID, requestIdOf(e))
                putExtra(EXTRA_KID_NAME, e.kidName ?: "your kid")
                putExtra(EXTRA_DEVICE_NAME, e.deviceName)
            }
        }
    }
    val pending = PendingIntent.getActivity(
        context,
        e.id.hashCode(),
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder = Notification.Builder(context, channelFor(e.kind))
        .setSmallIcon(R.drawable.ic_inbox)
        .setContentTitle(v.text)
        .setContentText(v.detail)
        .setWhen(Instant.parse(e.at).toEpochMilli())
        .setShowWhen(true)
        .setAutoCancel(true)
        .setContentIntent(pending)
    context.getSystemService(NotificationManager::class.java).notify(e.id.hashCode(), builder.build())
}
