package au.screentime.kid.home

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.screentime.core.time.formatDuration
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.ask.AskAndMessage
import au.screentime.kid.ask.Look
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Level
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.delay

/**
 * The kid's main screen (docs/SPEC.md §16.2): "Hi Alex", the ring with the time left, bedtime, "Offline · still
 * counting" when the last sync failed, and **Ask for more time** and **Message Mum and Dad**. SOS and "I'm the
 * parent" come with their cards.
 */
@Composable
fun HomeScreen() {
    val status by StatusHub.status.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        val s = status
        if (s == null) Waiting() else Home(s)
    }
}

/** Before the first sync after the app started. */
@Composable
private fun Waiting() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text("Getting your time…", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Home(s: KidStatus) {
    // The time left counts down every second on the screen; the service sends a new status at least once a minute.
    var elapsed by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            elapsed = SystemClock.elapsedRealtime()
        }
    }
    val left = s.leftSecAt(elapsed)

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(24.dp),
    ) {
        if (maxWidth >= 600.dp) {
            // Tablet or landscape: the ring on the left half, the words and buttons on the right.
            Row(modifier = Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    Ring(s, left)
                }
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Greeting(s.kidName)
                    Spacer(Modifier.height(16.dp))
                    Details(s, TextAlign.Start)
                    Spacer(Modifier.height(24.dp))
                    AskAndMessage(s, Look.DAY)
                }
            }
        } else {
            Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                Greeting(s.kidName, Modifier.fillMaxWidth())
                Spacer(Modifier.weight(1f))
                Ring(s, left)
                Spacer(Modifier.height(24.dp))
                Details(s, TextAlign.Center)
                Spacer(Modifier.weight(1f))
                AskAndMessage(s, Look.DAY)
            }
        }
    }
}

@Composable
private fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(
        text = "Hi $name",
        modifier = modifier,
        style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** "Bedtime 8:30 pm" (or when a locked device is back), and the offline line. */
@Composable
private fun Details(s: KidStatus, align: TextAlign) {
    s.subline()?.let {
        Text(
            text = it,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = align,
        )
    }
    if (!s.online) {
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Offline · still counting",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = align,
        )
    }
}

/** The 240 dp ring: the time left (or why it is locked) in the middle, the arc coloured by how much is left. */
@Composable
private fun Ring(s: KidStatus, left: Long) {
    val colors = ScreenTimeTheme.colors
    val track = MaterialTheme.colorScheme.surfaceVariant
    val arc: Color = when (s.level(left)) {
        Level.PLENTY -> colors.primary
        Level.LOW -> colors.warning
        Level.CRITICAL -> colors.critical
        Level.LOCKED -> track
    }
    val fraction = s.ringFraction(left)
    val description = s.lockReason?.let { s.headline(it) } ?: "${formatDuration(left)} of ${s.poolName} left"

    Box(
        modifier = Modifier
            .size(240.dp)
            .clearAndSetSemantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 20.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            val topLeft = Offset(inset, inset)
            drawArc(track, 0f, 360f, useCenter = false, topLeft = topLeft, size = arcSize, style = Stroke(stroke))
            if (fraction > 0f) {
                drawArc(
                    arc,
                    startAngle = -90f,
                    sweepAngle = 360f * fraction,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
            }
        }
        Column(modifier = Modifier.width(176.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val reason = s.lockReason
            if (reason == null) {
                Text(
                    text = s.ringText(left),
                    style = MaterialTheme.typography.displayMedium.copy(fontFeatureSettings = "tnum"),
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 1,
                )
                Text(
                    text = "${s.poolName} left",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(
                    text = s.headline(reason),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
