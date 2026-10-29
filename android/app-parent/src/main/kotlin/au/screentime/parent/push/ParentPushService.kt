package au.screentime.parent.push

import au.screentime.parent.ParentApp
import au.screentime.parent.auth.SessionState
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** The FCM service (docs/SPEC.md §13): show each push, and send a new token to the server. */
class ParentPushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        message.data["msg"]?.let(::parseEnvelope)?.let { show(this, it) }
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
