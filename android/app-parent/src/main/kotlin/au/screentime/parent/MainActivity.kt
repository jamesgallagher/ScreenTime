package au.screentime.parent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricManager.Authenticators
import android.hardware.biometrics.BiometricPrompt
import android.os.Bundle
import android.os.CancellationSignal
import android.os.SystemClock
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.auth.SessionState
import au.screentime.parent.auth.SignInScreen
import au.screentime.parent.auth.SignInViewModel
import au.screentime.parent.home.HomeScreen
import au.screentime.parent.home.NoFamilyScreen
import au.screentime.parent.inbox.InboxViewModel
import au.screentime.parent.kids.KidsViewModel
import au.screentime.parent.lock.AppLock
import au.screentime.parent.lock.LockScreen
import au.screentime.parent.push.EXTRA_DEVICE_NAME
import au.screentime.parent.push.EXTRA_KID_NAME
import au.screentime.parent.push.EXTRA_REQUEST_ID
import au.screentime.parent.push.ParentModeAsk
import au.screentime.parent.push.ParentModeScreen
import au.screentime.parent.push.ParentModeViewModel
import au.screentime.parent.push.Push
import au.screentime.parent.today.TodayViewModel
import kotlinx.coroutines.launch

/**
 * The parent app's main activity (docs/SPEC.md §16.4): the sign-in, the app lock, and the four tabs.
 */
class MainActivity : ComponentActivity() {
    private val signIn: SignInViewModel by viewModels()
    private val today: TodayViewModel by viewModels()
    private val inbox: InboxViewModel by viewModels()
    private val kids: KidsViewModel by viewModels()
    private val parentMode: ParentModeViewModel by viewModels()
    private val session get() = (application as ParentApp).session

    /** A parent-mode request opened from its notification, or null. */
    private var ask by mutableStateOf<ParentModeAsk?>(null)

    /** Ask the phone for the notification permission. */
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    @Volatile
    private var prompting = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        askFrom(intent)
        setContent {
            val state by session.state.collectAsState()
            val locked by AppLock.locked.collectAsState()
            LaunchedEffect(state) {
                if (state is SessionState.SignedOut) {
                    today.clear()
                    inbox.clear()
                    kids.clear()
                    ask = null
                }
                if (state is SessionState.SignedIn) {
                    Push.register(session, lifecycleScope)
                    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
            }
            ScreenTimeTheme {
                when (val s = state) {
                    SessionState.SignedOut -> SignInScreen(signIn)
                    is SessionState.SignedIn -> when {
                        locked -> LockScreen(onUnlock = ::askToUnlock)
                        s.me.family == null -> NoFamilyScreen(s.me, ::signOut)
                        ask != null -> ParentModeScreen(ask!!, parentMode) { ask = null }
                        else -> HomeScreen(s.me, today, inbox, kids, secure = isSecure(), ::signOut)
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        askFrom(intent)
    }

    override fun onStart() {
        super.onStart()
        AppLock.opened(SystemClock.elapsedRealtime(), isSecure())
    }

    override fun onStop() {
        AppLock.left(SystemClock.elapsedRealtime())
        super.onStop()
    }

    /** Read a parent-mode request from the intent's extras, and take the extras off the intent. */
    private fun askFrom(intent: Intent) {
        if (intent.getStringExtra(EXTRA_REQUEST_ID) != null) {
            ask = ParentModeAsk(
                requestId = intent.getStringExtra(EXTRA_REQUEST_ID)!!,
                kidName = intent.getStringExtra(EXTRA_KID_NAME) ?: "your kid",
                deviceName = intent.getStringExtra(EXTRA_DEVICE_NAME),
            )
            intent.removeExtra(EXTRA_REQUEST_ID)
            intent.removeExtra(EXTRA_KID_NAME)
            intent.removeExtra(EXTRA_DEVICE_NAME)
        }
    }

    /** Whether the phone has a fingerprint, PIN, pattern or password. */
    private fun isSecure(): Boolean {
        val manager = getSystemService(BiometricManager::class.java)
        return manager.canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /** Ask for the fingerprint or the phone's PIN to unlock the app. */
    private fun askToUnlock() {
        if (prompting) return
        if (!isSecure()) {
            AppLock.unlock()
            return
        }
        prompting = true
        BiometricPrompt.Builder(this)
            .setTitle("Unlock Screen Time")
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build()
            .authenticate(
                CancellationSignal(),
                mainExecutor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        prompting = false
                        Log.i(TAG, "unlocked")
                        AppLock.unlock()
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        prompting = false
                        Log.i(TAG, "unlock stopped: $errorCode")
                    }
                },
            )
    }

    /** Sign out: tell the server and forget the sign-in. */
    private fun signOut() {
        lifecycleScope.launch {
            session.signOut()
        }
    }

    companion object {
        private const val TAG = "MainActivity"
        private val AUTHENTICATORS = Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL
    }
}
