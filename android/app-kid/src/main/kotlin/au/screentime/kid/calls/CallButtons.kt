package au.screentime.kid.calls

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.telecom.TelecomManager
import android.util.Log
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.screentime.core.ui.AvatarColors
import au.screentime.core.ui.ScreenTimeTheme

private const val TAG = "Calls"

/** The dark theme's danger red (docs/SPEC.md §16.1): the light one is too dark to read on the night background. */
private val EmergencyRed = Color(0xFFF87171)

/**
 * The row of round call buttons on the block screen (docs/SPEC.md §16.2): a 64 dp circle with the initials in the
 * avatar colours, the name under it. One tap calls. The row scrolls sideways when it does not fit.
 */
@Composable
fun ContactRow(callables: List<Callable>, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
    ) {
        callables.forEachIndexed { i, who ->
            ContactButton(who, AvatarColors[i % AvatarColors.size]) { call(context, who) }
        }
    }
}

@Composable
private fun ContactButton(who: Callable, color: Color, onTap: () -> Unit) {
    val colors = ScreenTimeTheme.colors
    Column(
        modifier = Modifier
            .width(72.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClickLabel = "Call ${who.label}", role = Role.Button, onClick = onTap),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .background(color, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = initials(who.label),
                modifier = Modifier.clearAndSetSemantics { },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = who.label,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.onNight,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** **Emergency 000**, outlined in red: opens the phone's dialer with the number filled in (docs/SPEC.md §12.1). */
@Composable
fun EmergencyButton(number: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    OutlinedButton(
        onClick = { dialEmergency(context, number) },
        modifier = modifier
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .height(56.dp),
        border = BorderStroke(1.5.dp, EmergencyRed),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = EmergencyRed),
    ) {
        Text("Emergency $number", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

/**
 * Calls [who] straight away through Android's own phone app, which shows its call screen over the block screen
 * (the policies let it run in Lock Task). The app has the phone permission because it is Device Owner.
 */
fun call(context: Context, who: Callable) {
    try {
        context.getSystemService(TelecomManager::class.java)
            .placeCall(Uri.fromParts("tel", who.number, null), Bundle())
        Log.i(TAG, "call: placing to ${who.label}")
    } catch (e: SecurityException) {
        Log.w(TAG, "call: no phone permission", e)
        Toast.makeText(context, "Calls don't work on this phone yet", Toast.LENGTH_LONG).show()
    }
}

/**
 * Opens the dialer with [number] filled in, for the kid to press the green button: an app cannot place an
 * emergency call itself (docs/SPEC.md §12.1).
 */
fun dialEmergency(context: Context, number: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)))
        Log.i(TAG, "call: dialer opened for the emergency number")
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "call: no dialer", e)
    }
}
