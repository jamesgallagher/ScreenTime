package au.screentime.parent

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
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
    private val session get() = (application as ParentApp).session

    @Volatile
    private var prompting = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val state by session.state.collectAsState()
            val locked by AppLock.locked.collectAsState()
            LaunchedEffect(state) {
                if (state is SessionState.SignedOut) {
                    today.clear()
                    inbox.clear()
                    kids.clear()
                }
            }
            ScreenTimeTheme {
                when (val s = state) {
                    SessionState.SignedOut -> SignInScreen(signIn)
                    is SessionState.SignedIn -> when {
                        locked -> LockScreen(onUnlock = ::askToUnlock)
                        s.me.family == null -> NoFamilyScreen(s.me, ::signOut)
                        else -> HomeScreen(s.me, today, inbox, kids, secure = isSecure(), ::signOut)
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        AppLock.opened(SystemClock.elapsedRealtime(), isSecure())
    }

    override fun onStop() {
        AppLock.left(SystemClock.elapsedRealtime())
        super.onStop()
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
