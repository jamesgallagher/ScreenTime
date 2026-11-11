package au.screentime.kid.block

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.SystemClock
import android.util.Log
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.status.FreeApp
import au.screentime.kid.status.StatusHub

/**
 * **Apps you can still use** (docs/SPEC.md §12.4, §16.2): on the block screen while time is up, the always-allowed
 * apps a parent chose for this device, in a sheet of icons. Each one opens in Lock Task, and Back comes here again.
 */
@Composable
fun FreeAppsButton(apps: List<FreeApp>, modifier: Modifier = Modifier) {
    if (apps.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    val colors = ScreenTimeTheme.colors
    OutlinedButton(
        onClick = { open = true },
        modifier = modifier.widthIn(max = 420.dp).fillMaxWidth().height(56.dp),
        border = BorderStroke(1.5.dp, colors.onNight),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.onNight),
    ) {
        Text("Apps you can still use", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
    if (open) FreeAppsSheet(apps, onDone = { open = false })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FreeAppsSheet(apps: List<FreeApp>, onDone: () -> Unit) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDone, sheetState = sheetState) {
        Column(modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 24.dp)) {
            Text("Apps you can still use", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(
                "Mum and Dad said these are OK any time before bed. They don't use up your time.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 88.dp),
                modifier = Modifier.heightIn(max = 420.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(apps, key = { it.packageName }) { app ->
                    AppTile(app) {
                        onDone()
                        openFreeApp(context, app.packageName)
                    }
                }
            }
        }
    }
}

@Composable
private fun AppTile(app: FreeApp, onClick: () -> Unit) {
    val context = LocalContext.current
    val icon = remember(app.packageName) { iconOf(context, app.packageName) }
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        icon?.let { Image(bitmap = it, contentDescription = null, modifier = Modifier.size(56.dp)) }
        Spacer(Modifier.height(8.dp))
        Text(
            app.label,
            style = MaterialTheme.typography.labelLarge,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun iconOf(context: Context, packageName: String): ImageBitmap? = try {
    val drawable = context.packageManager.getApplicationIcon(packageName)
    val size = 144
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    drawable.setBounds(0, 0, size, size)
    drawable.draw(Canvas(bitmap))
    bitmap.asImageBitmap()
} catch (e: Exception) {
    null
}

/** Opens the app in front of the block screen; Lock Task lets it run because it is always allowed. */
private fun openFreeApp(context: Context, packageName: String) {
    val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: return
    StatusHub.freeOpenedAt.value = SystemClock.elapsedRealtime()
    try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        Log.i("BlockActivity", "opened always-allowed $packageName")
    } catch (e: Exception) {
        Log.w("BlockActivity", "could not open $packageName: $e")
    }
}
