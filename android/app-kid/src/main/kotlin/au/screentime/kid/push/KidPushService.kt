package au.screentime.kid.push

import au.screentime.kid.service.KidService
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * The kid app's FCM service (docs/SPEC.md §10, CARD-034b): a push is handed to [KidService] exactly like a
 * WebSocket frame, and a new token goes to the server.
 */
class KidPushService : FirebaseMessagingService() {
    override fun onCreate() {
        KidFirebase.start(this)
        super.onCreate()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        message.data["msg"]?.let { KidService.push(this, it) }
    }

    override fun onNewToken(token: String) {
        KidService.newToken(this)
    }
}
