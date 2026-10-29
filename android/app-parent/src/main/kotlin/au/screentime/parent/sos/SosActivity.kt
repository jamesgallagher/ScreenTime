package au.screentime.parent.sos

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import au.screentime.core.model.api.SosDetail
import au.screentime.core.model.api.SosLocation
import au.screentime.core.model.api.SosStatus
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.ParentApp
import au.screentime.parent.auth.Session
import au.screentime.parent.auth.SessionState
import au.screentime.parent.inbox.answerError
import au.screentime.parent.inbox.timeOfDay
import au.screentime.parent.today.REFRESH_MS
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The SOS page (docs/SPEC.md §15, CARD-044): a full-screen red page, over the lock screen, that shows
 * where the kid is and who is on it.
 */
class SosActivity : ComponentActivity() {
    private val idState = androidx.compose.runtime.mutableStateOf("")
    private val kidNameState = androidx.compose.runtime.mutableStateOf("Your kid")
    private val deviceNameState = androidx.compose.runtime.mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // White status bar icons on the red page, in light and dark mode.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        readExtras(intent)
        setContent {
            ScreenTimeTheme {
                SosScreen(
                    id = idState.value,
                    kidName = kidNameState.value,
                    deviceName = deviceNameState.value,
                    session = (application as ParentApp).session,
                    onClose = { finish() },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readExtras(intent)
    }

    /** Read the SOS extras off the intent; a newer SOS replaces the page's id. */
    private fun readExtras(intent: Intent) {
        intent.getStringExtra(SosAlarm.EXTRA_SOS_ID)?.let { idState.value = it }
        intent.getStringExtra(SosAlarm.EXTRA_KID_NAME)?.let { kidNameState.value = it }
        deviceNameState.value = intent.getStringExtra(SosAlarm.EXTRA_DEVICE_NAME)
    }
}

/** The SOS page's background once the SOS has ended. */
private val EndedBackground = Color(0xFF44403C)

/** The SOS page's content (docs/SPEC.md §15). */
@Composable
fun SosScreen(id: String, kidName: String, deviceName: String?, session: Session, onClose: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val me = (session.state.value as? SessionState.SignedIn)?.me
    val parentId = me?.parent?.id
    val tz = me?.family?.timezone
    val zone = if (tz != null) runCatching { ZoneId.of(tz) }.getOrDefault(ZoneId.systemDefault()) else ZoneId.systemDefault()
    val ringing by SosAlarm.ringing.collectAsState()

    var sos by remember { mutableStateOf<SosDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var failedAction by remember { mutableStateOf<String?>(null) }
    var showEndDialog by remember { mutableStateOf(false) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        try {
            val s = session.call { getSosById(id) }
            sos = s
            error = null
            if (s.status == SosStatus.ENDED) SosAlarm.stop(context)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Can't reach the server. Trying again…"
        }
    }

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (me != null) {
                load()
                launch {
                    while (true) {
                        delay(REFRESH_MS)
                        load()
                    }
                }
                SosNews.changed.collect {
                    load()
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }

    fun openMaps(loc: SosLocation) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(mapsUri(loc, kidName))))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, "No maps app on this phone.", Toast.LENGTH_SHORT).show()
        }
    }

    suspend fun ack() {
        try {
            session.call { postSosAck(id) }
            SosAlarm.stop(context)
            load()
            failedAction = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failedAction = answerError(e)
            load()
        }
    }

    suspend fun extend() {
        try {
            session.call { postSosExtend(id) }
            load()
            failedAction = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failedAction = answerError(e)
            load()
        }
    }

    suspend fun end() {
        try {
            session.call { postSosEnd(id) }
            SosAlarm.stop(context)
            load()
            failedAction = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failedAction = answerError(e)
            load()
        }
    }

    if (me == null) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(ScreenTimeTheme.colors.danger)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(sosTitle(kidName), fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Spacer(Modifier.height(16.dp))
            Text("Sign in to Screen Time Parent to see this SOS.", fontSize = 16.sp, color = Color.White)
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = onClose,
                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = ScreenTimeTheme.colors.danger),
            ) {
                Text("Close", fontSize = 18.sp, fontWeight = FontWeight.Bold)
            }
        }
        return
    }

    // Alarm red while the SOS is on; a calm dark stone once it has ended.
    val ended = sos?.let { it.status != SosStatus.ACTIVE } ?: false
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(if (ended) EndedBackground else ScreenTimeTheme.colors.danger)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Text(sosTitle(kidName), fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Color.White)
        val s = sos
        if (s != null) {
            if (s.status == SosStatus.ACTIVE) {
                Text(
                    "Started ${timeOfDay(Instant.parse(s.startedAt), zone)} · ${agoText(Instant.parse(s.startedAt), Instant.ofEpochMilli(now))}",
                    fontSize = 16.sp,
                    color = Color.White,
                )
            } else {
                Text("SOS ended", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text(endedText(s.endedBy?.wire, s.endedByName, kidName), fontSize = 16.sp, color = Color.White)
            }
        }

        Spacer(Modifier.height(20.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = Color.White,
            shape = RoundedCornerShape(20.dp),
        ) {
            Column {
                val loc = s?.lastLocation
                if (loc != null) {
                    SosMap(
                        loc = loc,
                        onTap = { openMaps(loc) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(240.dp)
                            .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)),
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(160.dp)
                            .background(Color(0xFFF5F5F4)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Waiting for $kidName's location…", fontSize = 16.sp, color = Color(0xFF57534E))
                    }
                }
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            seenText(loc, Instant.ofEpochMilli(now)),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color(0xFF1C1917),
                        )
                        batteryText(loc)?.let {
                            Text(it, fontSize = 14.sp, color = Color(0xFF57534E))
                        }
                    }
                    if (loc != null) {
                        Button(
                            onClick = { openMaps(loc) },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = ScreenTimeTheme.colors.danger,
                                contentColor = Color.White,
                            ),
                        ) {
                            Text("Directions", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        if (!ended || s?.acks?.isNotEmpty() == true) {
            Text(acksText(s?.acks ?: emptyList()), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        }

        Spacer(Modifier.height(24.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (s != null && s.status == SosStatus.ACTIVE) {
                if (parentId != null && s.acks.any { it.parentId == parentId }) {
                    Text(
                        "✓ You're on it",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                    )
                } else {
                    Button(
                        onClick = { scope.launch { ack() } },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = ScreenTimeTheme.colors.danger),
                    ) {
                        Text("I'm on it", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                }
                if (ringing == id) {
                    TextButton(
                        onClick = { SosAlarm.stop(context) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                        colors = ButtonDefaults.textButtonColors(contentColor = Color.White),
                    ) {
                        Text("Silence alarm", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                OutlinedButton(
                    onClick = { scope.launch { extend() } },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                    border = BorderStroke(1.5.dp, Color.White.copy(alpha = 0.8f)),
                ) {
                    Text("Keep on 2 more hours", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
                OutlinedButton(
                    onClick = { showEndDialog = true },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                    border = BorderStroke(1.5.dp, Color.White.copy(alpha = 0.8f)),
                ) {
                    Text("End SOS", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            } else {
                Button(
                    onClick = onClose,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = ScreenTimeTheme.colors.danger),
                ) {
                    Text("Close", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        failedAction?.let {
            Text(it, fontSize = 14.sp, color = Color.White)
        }
    }

    if (showEndDialog) {
        AlertDialog(
            onDismissRequest = { showEndDialog = false },
            title = { Text("End $kidName's SOS?") },
            text = { Text("Only end it when you know $kidName is safe. Everyone gets told.") },
            confirmButton = {
                TextButton(onClick = {
                    showEndDialog = false
                    scope.launch { end() }
                }) {
                    Text("Yes, end it")
                }
            },
            dismissButton = {
                TextButton(onClick = { showEndDialog = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}
