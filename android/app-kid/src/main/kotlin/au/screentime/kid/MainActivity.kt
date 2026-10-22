package au.screentime.kid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import au.screentime.core.ui.PlaceholderScreen
import au.screentime.core.ui.ScreenTimeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ScreenTimeTheme {
                PlaceholderScreen(
                    title = "Screen Time",
                    subtitle = "Kid app. Real screens come in later cards.",
                )
            }
        }
    }
}
