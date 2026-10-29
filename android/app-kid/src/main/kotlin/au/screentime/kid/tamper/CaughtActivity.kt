package au.screentime.kid.tamper

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.animateColor
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.service.KidService
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.delay

/** The two colours the caught screen fades between, like the lights on a police car. */
private val PoliceBlue = Color(0xFF1D4ED8)
private val PoliceRed = Color(0xFFB91C1C)

/**
 * The "caught" screen (docs/SPEC.md §14): after a tamper attempt, cheesy on purpose, over everything for 8 seconds,
 * then it closes itself. Back does nothing. It opens in the block screen's task, so while the device is blocked it
 * sits on top of the block screen in Lock Task, and the block screen is what is left when it closes. The status and
 * navigation bars stay, over its colours: hiding them makes Android show its "Viewing full screen" hint on top, the
 * first time, which covers the screen for most of its 8 seconds.
 */
class CaughtActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // White status bar icons on the dark background, in light and dark mode.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })
        setContent {
            val line by StatusHub.caught.collectAsState()
            var left by remember { mutableIntStateOf(CAUGHT_SEC) }
            LaunchedEffect(Unit) {
                while (left > 0) {
                    delay(1_000)
                    left -= 1
                }
                close()
            }
            ScreenTimeTheme {
                line?.let { CaughtScreen(it, left) }
            }
        }
    }

    private fun close() {
        StatusHub.caught.value = null
        Log.i(TAG, "closed")
        finish()
        // Whatever applies now (the block screen, or nothing) shows at once, not at the next tick.
        KidService.syncSoon(this)
    }

    companion object {
        private const val TAG = "CaughtActivity"

        /** Shows [StatusHub.caught], from the service. */
        fun show(context: Context) {
            context.startActivity(Intent(context, CaughtActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/**
 * Full screen, fading between police blue and red. In the middle: the emoji (96 sp), the headline (34 sp, black
 * weight), the line under it (20 sp), a white "REPORTED" stamp tipped to one side, and "Back in 8 s" counting down.
 */
@Composable
private fun CaughtScreen(line: CaughtLine, left: Int) {
    val lights = rememberInfiniteTransition(label = "lights")
    val background by lights.animateColor(
        initialValue = PoliceBlue,
        targetValue = PoliceRed,
        animationSpec = infiniteRepeatable(tween(600, easing = LinearEasing), RepeatMode.Reverse),
        label = "background",
    )
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
            .safeDrawingPadding()
            .padding(horizontal = 32.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(line.emoji, fontSize = 96.sp)
        Spacer(Modifier.height(24.dp))
        Text(
            text = line.title,
            fontSize = 34.sp,
            lineHeight = 40.sp,
            fontWeight = FontWeight.Black,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = line.body,
            fontSize = 20.sp,
            lineHeight = 28.sp,
            color = Color.White.copy(alpha = 0.9f),
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(40.dp))
        Text(
            text = "REPORTED",
            modifier = Modifier
                .rotate(-8f)
                .border(3.dp, Color.White, RoundedCornerShape(8.dp))
                .padding(horizontal = 16.dp, vertical = 8.dp),
            fontSize = 28.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 4.sp,
            color = Color.White,
        )
        Spacer(Modifier.height(40.dp))
        Text(
            text = "Back in $left s",
            fontSize = 14.sp,
            color = Color.White.copy(alpha = 0.7f),
        )
    }
}
