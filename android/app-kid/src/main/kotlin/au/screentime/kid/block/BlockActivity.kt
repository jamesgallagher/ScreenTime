package au.screentime.kid.block

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.status.StatusHub

/**
 * The block screen (docs/SPEC.md §12.1 "Blocked state", §16.2 "Block screen"): out of time, bedtime and before
 * wake-up. It pins itself with Lock Task, so Home, Recents and the notification shade are gone, and it lets go and
 * closes as soon as [StatusHub] says the device may be used again (a grant, wake-up, a new day).
 */
class BlockActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // White status bar icons on the dark background, in light and dark mode.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        window.insetsController?.let {
            it.hide(WindowInsets.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        // Back does nothing here.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })
        setContent {
            val status by StatusHub.status.collectAsState()
            val locked = status?.locked == true
            LaunchedEffect(locked) {
                if (!locked) unblock()
            }
            ScreenTimeTheme {
                status?.let { BlockScreen(it) }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (StatusHub.status.value?.locked == true && !inLockTask()) {
            try {
                startLockTask()
                Log.i(TAG, "Lock Task started")
            } catch (e: IllegalArgumentException) {
                // Not allowed: the app is not Device Owner, or the policies were not applied yet.
                Log.w(TAG, "could not start Lock Task", e)
            }
        }
    }

    private fun unblock() {
        if (inLockTask()) stopLockTask()
        Log.i(TAG, "unblocked")
        finish()
    }

    private fun inLockTask(): Boolean =
        getSystemService(ActivityManager::class.java).lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    companion object {
        private const val TAG = "BlockActivity"

        /** Shows the block screen, from the service. Showing it again while it is up does nothing. */
        fun show(context: Context) {
            context.startActivity(
                Intent(context, BlockActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
