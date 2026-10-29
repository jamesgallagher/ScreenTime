package au.screentime.parent.push

import au.screentime.parent.ParentApp
import au.screentime.parent.auth.SessionState
import au.screentime.parent.sos.SosAlarm
import au.screentime.parent.sos.SosNews
import au.screentime.parent.sos.ringsAlarm
import au.screentime.parent.sos.sosIdOf
import au.screentime.parent.sos.stopsAlarm
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** The FCM service (docs/SPEC.md §13): show each push, and send a new token to the server. */
class ParentPushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        message.data["msg"]?.let(::parseEnvelope)?.let { e ->
            when {
                // A started SOS is the one notification: the alarm's, not a second one.
                ringsAlarm(e) -> SosAlarm.ring(this, sosIdOf(e)!!, e.kidName ?: "Your kid", e.deviceName)
                stopsAlarm(e) -> {
                    SosAlarm.stop(this)
                    show(this, e)
                }
                else -> show(this, e)
            }
            if (sosIdOf(e) != null) SosNews.bump()
        }
    }

    override fun onNewToken(token: String) {
        val session = (application as ParentApp).session
        if (session.state.value is SessionState.SignedIn) {
            CoroutineScope(Dispatchers.IO).launch {
                Push.send(session, token)
            }
        }
    }
}
