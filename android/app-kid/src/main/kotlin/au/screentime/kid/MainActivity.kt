package au.screentime.kid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.setup.SetupScreen
import au.screentime.kid.setup.SetupViewModel

class MainActivity : ComponentActivity() {
    private val setup: SetupViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ScreenTimeTheme {
                SetupScreen(setup)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Picks up a Device Owner set while the app was open, and applies the policies again once enrolled.
        setup.refresh()
    }
}
