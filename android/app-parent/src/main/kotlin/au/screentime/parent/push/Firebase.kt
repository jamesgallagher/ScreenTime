package au.screentime.parent.push

import android.content.Context
import android.util.Log
import au.screentime.core.model.api.PushTokenPut
import au.screentime.parent.BuildConfig
import au.screentime.parent.auth.Session
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * The parent app's push (docs/SPEC.md §13): start Firebase, send this app's FCM token to the server, and show
 * the pushes.
 */
object Push {
    @Volatile
    var started: Boolean = false
        private set

    /** Start Firebase with the values from google-services.json; false when they are empty. */
    fun start(context: Context): Boolean {
        if (BuildConfig.FIREBASE_APP_ID.isEmpty()) {
            started = false
            return false
        }
        if (started) return true
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        started = true
        return true
    }

    /** Send this app's FCM token to the server after a sign-in; does nothing unless [start] worked. */
    fun register(session: Session, scope: CoroutineScope) {
        if (!started) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            scope.launch { send(session, token) }
        }
    }

    /** Send [token] to the server; a failure is logged (never the token) and dropped: the next start sends it again. */
    suspend fun send(session: Session, token: String) {
        try {
            session.call { putMePushToken(PushTokenPut(token)) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w("Push", "token not sent: ${e.javaClass.simpleName}")
        }
    }
}
