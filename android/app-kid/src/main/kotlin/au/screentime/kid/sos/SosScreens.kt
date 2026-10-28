package au.screentime.kid.sos

import android.os.SystemClock
import android.widget.Toast
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.ask.Look
import au.screentime.kid.calls.ContactRow
import au.screentime.kid.calls.EmergencyButton
import au.screentime.kid.service.KidService
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The light theme's danger red (docs/SPEC.md §16.1): the SOS button and the countdown. */
private val SosRed = Color(0xFFDC2626)

/** The background of the SOS screen while it is on: a very dark red, calm but unmistakable. */
private val SosDeep = Color(0xFF450A0A)

/** The green of "I'm safe" and "Dad has seen your SOS". */
private val SafeGreen = Color(0xFF16A34A)

/** How long the SOS button and **I'm safe** must be held (docs/SPEC.md §15). */
private const val HOLD_MS = 2_000

/**
 * The hold always takes 2 real seconds: with "Remove animations" on, Android makes every animation instant, and a
 * tap would then count as a hold.
 */
private object RealTime : MotionDurationScale {
    override val scaleFactor = 1f
}

/** The countdown after the hold, in seconds. */
private const val COUNTDOWN_SEC = 5

/** [StatusHub.sosCountdown] once the countdown has finished, until the service shows the SOS. */
const val SOS_FIRED = -1L

/**
 * The SOS screens over everything else (docs/SPEC.md §15): the SOS while one is on, the countdown while it runs,
 * otherwise [content]. The main screen and the block screen both use it, so an SOS shows whichever is in front.
 */
@Composable
fun SosLayer(content: @Composable () -> Unit) {
    val sos by StatusHub.sos.collectAsState()
    val countdown by StatusHub.sosCountdown.collectAsState()
    val view = sos
    val from = countdown
    when {
        view != null -> SosOn(view)
        from != null -> Countdown(from)
        else -> content()
    }
}

/**
 * The red **SOS** button, 72 dp, for the top corner of the main screen and the block screen. Hold it for 2 seconds:
 * a ring fills around it, then the countdown starts. A short tap only says to hold it.
 */
@Composable
fun SosButton(look: Look, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val track = if (look == Look.DAY) MaterialTheme.colorScheme.surfaceVariant else ScreenTimeTheme.colors.onNight.copy(alpha = 0.3f)
    Box(
        modifier = modifier
            .size(72.dp)
            .semantics { contentDescription = "SOS. Press and hold for 2 seconds." }
            .hold(
                progress = progress,
                scope = scope,
                onTap = { Toast.makeText(context, "Hold the SOS button for 2 seconds", Toast.LENGTH_SHORT).show() },
                onDone = { StatusHub.sosCountdown.value = SystemClock.elapsedRealtime() },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 5.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            drawArc(track, 0f, 360f, useCenter = false, topLeft = Offset(inset, inset), size = arcSize, style = Stroke(stroke))
            if (progress.value > 0f) {
                drawArc(
                    SosRed,
                    startAngle = -90f,
                    sweepAngle = 360f * progress.value,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
            }
        }
        Box(
            modifier = Modifier
                .size(58.dp)
                .background(SosRed, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "SOS",
                modifier = Modifier.clearAndSetSemantics { },
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
    }
}

/**
 * The 5-second countdown on full-screen red, with a big white **Cancel** (docs/SPEC.md §15 step 1). At zero it asks
 * the service to start the SOS once, even when the main screen and the block screen both show it.
 */
@Composable
private fun Countdown(from: Long) {
    val context = LocalContext.current
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(from) {
        if (from == SOS_FIRED) return@LaunchedEffect
        while (now - from < COUNTDOWN_SEC * 1000L) {
            delay(100)
            now = SystemClock.elapsedRealtime()
        }
        if (StatusHub.sosCountdown.compareAndSet(from, SOS_FIRED)) KidService.startSos(context)
    }
    val left = if (from == SOS_FIRED) 0L else maxOf(0L, COUNTDOWN_SEC - (now - from) / 1000)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SosRed)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Text("SOS", fontSize = 48.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Spacer(Modifier.height(32.dp))
        if (left > 0) {
            Text("Sending in", style = MaterialTheme.typography.titleLarge, color = Color.White)
            Text("$left", fontSize = 120.sp, fontWeight = FontWeight.Bold, color = Color.White)
        } else {
            CircularProgressIndicator(color = Color.White)
            Spacer(Modifier.height(16.dp))
            Text("Sending…", style = MaterialTheme.typography.titleLarge, color = Color.White)
        }
        Spacer(Modifier.height(24.dp))
        Text(
            text = "Your parents will get an alert and a text with where you are.",
            style = MaterialTheme.typography.titleMedium,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(48.dp))
        if (left > 0) {
            Button(
                onClick = { StatusHub.sosCountdown.compareAndSet(from, null) },
                modifier = Modifier
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
                    .height(72.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = SosRed),
            ) {
                Text("Cancel", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/**
 * While an SOS is on (docs/SPEC.md §15 step 6): "SOS is on", how far it got, who has seen it, a call button for each
 * parent, **Emergency 000**, and **I'm safe** to hold for 2 seconds.
 */
@Composable
private fun SosOn(view: SosView) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SosDeep)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(32.dp))
        Text("SOS is on", fontSize = 36.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (view.stage == SosStage.SENDING) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                Spacer(Modifier.width(12.dp))
            }
            Text(
                text = view.line(),
                style = MaterialTheme.typography.titleMedium,
                color = Color.White.copy(alpha = 0.85f),
                textAlign = TextAlign.Center,
            )
        }
        view.seenLine()?.let {
            Spacer(Modifier.height(20.dp))
            Text(
                text = "✓ $it",
                modifier = Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = SafeGreen,
            )
        }
        Spacer(Modifier.height(40.dp))
        if (view.parents.isNotEmpty()) {
            ContactRow(view.parents)
            Spacer(Modifier.height(20.dp))
        }
        EmergencyButton(view.emergencyNumber)
        Spacer(Modifier.height(40.dp))
        HoldButton("Hold: I'm safe") { KidService.endSos(context) }
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Hold for 2 seconds when you are safe.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.7f),
        )
    }
}

/** A white 72 dp pill that fills with green from the left while it is held; [onDone] after 2 seconds. */
@Composable
private fun HoldButton(text: String, onDone: () -> Unit) {
    val context = LocalContext.current
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    Box(
        modifier = Modifier
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .height(72.dp)
            .clip(RoundedCornerShape(36.dp))
            .background(Color.White)
            .semantics { contentDescription = "$text. Press and hold for 2 seconds." }
            .hold(
                progress = progress,
                scope = scope,
                onTap = { Toast.makeText(context, "Hold it for 2 seconds", Toast.LENGTH_SHORT).show() },
                onDone = onDone,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .fillMaxHeight()
                .fillMaxWidth(progress.value)
                .background(SafeGreen.copy(alpha = 0.35f)),
        )
        Text(
            text = text,
            modifier = Modifier.clearAndSetSemantics { },
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = SafeGreen,
        )
    }
}

/**
 * Press and hold: [progress] runs from 0 to 1 in 2 seconds while the finger stays down, then [onDone]. Let go
 * sooner and it runs back to 0; a short tap is [onTap].
 */
private fun Modifier.hold(
    progress: Animatable<Float, AnimationVector1D>,
    scope: CoroutineScope,
    onTap: () -> Unit,
    onDone: () -> Unit,
): Modifier = composed {
    val tap by rememberUpdatedState(onTap)
    val done by rememberUpdatedState(onDone)
    pointerInput(Unit) {
        detectTapGestures(
            onPress = {
                val run = scope.launch(RealTime) {
                    progress.snapTo(0f)
                    progress.animateTo(1f, tween(HOLD_MS, easing = LinearEasing))
                    done()
                    progress.snapTo(0f)
                }
                tryAwaitRelease()
                if (run.isActive) {
                    run.cancel()
                    if (progress.value < 0.15f) tap()
                    scope.launch { progress.animateTo(0f, tween(200)) }
                }
            },
        )
    }
}
