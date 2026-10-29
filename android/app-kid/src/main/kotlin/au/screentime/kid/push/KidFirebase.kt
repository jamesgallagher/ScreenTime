package au.screentime.kid.push

import android.content.Context
import au.screentime.kid.BuildConfig
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging

/**
 * The kid app's Firebase (docs/SPEC.md §13, CARD-034b): start it from the values in google-services.json, and
 * get the app's FCM token.
 */
object KidFirebase {
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

    /** Get this app's FCM token; does nothing unless [start] worked. */
    fun token(onToken: (String) -> Unit) {
        if (!started) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { onToken(it) }
    }
}
