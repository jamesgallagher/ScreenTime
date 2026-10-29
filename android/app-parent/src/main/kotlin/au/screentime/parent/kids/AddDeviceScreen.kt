package au.screentime.parent.kids

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.EnrolmentCode
import au.screentime.core.model.api.Kid
import au.screentime.core.ui.ScreenTimeTheme
import java.time.Instant
import kotlinx.coroutines.delay

/**
 * The add-device page (docs/SPEC.md §16.4): the QR code and the 6 digits with a 10-minute countdown,
 * and it says Connected when the new device has enrolled.
 */
@Composable
fun AddDeviceScreen(
    kid: Kid,
    form: DeviceForm,
    code: EnrolmentCode,
    before: Set<String>,
    vm: KidsViewModel,
    onNewCode: () -> Unit,
    onClose: () -> Unit,
) {
    BackHandler(onBack = onClose)
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = Instant.now()
            delay(1_000)
        }
    }
    val expired = countdownText(code.expiresAt, now) == "0:00"
    val connected = newDevice(before, vm.state.devices, kid.id)
    if (connected == null && !expired) {
        LaunchedEffect(code) {
            while (true) {
                delay(3_000)
                vm.refreshDevices()
            }
        }
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = addTitle(kid.name, form),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = addHint(kid.name, form),
            style = MaterialTheme.typography.bodyLarge,
            color = ScreenTimeTheme.colors.muted,
            textAlign = TextAlign.Center,
        )
        if (form != DeviceForm.PC) {
            Spacer(Modifier.height(24.dp))
            Box(
                modifier = Modifier
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .padding(12.dp),
            ) {
                Canvas(modifier = Modifier.size(232.dp).semantics { contentDescription = "Enrolment QR code" }) {
                    val modules = qrModules(code.qrPayload)
                    val moduleSize = this.size.width / modules.size
                    for (y in modules.indices) {
                        for (x in modules[y].indices) {
                            if (modules[y][x]) {
                                drawRect(
                                    color = Color(0xFF1C1917),
                                    alpha = if (expired) 0.2f else 1f,
                                    topLeft = Offset(x * moduleSize, y * moduleSize),
                                    size = Size(moduleSize, moduleSize),
                                )
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
        Text(
            text = if (form == DeviceForm.PC) "The code" else "Or type this code",
            style = MaterialTheme.typography.bodyMedium,
            color = ScreenTimeTheme.colors.muted,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = spacedCode(code.code),
            fontSize = 48.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 2.sp,
            color = if (expired) ScreenTimeTheme.colors.muted else MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        when {
            connected != null -> {
                Text(
                    text = "Connected: ${connected.name}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            expired -> {
                Text(
                    text = "This code has expired.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.critical,
                )
            }
            else -> {
                Text(
                    text = "Works once. Expires in ${countdownText(code.expiresAt, now)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.muted,
                )
            }
        }
        Spacer(Modifier.height(32.dp))
        when {
            connected != null -> {
                Button(onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text("Done")
                }
            }
            expired -> {
                Button(onClick = onNewCode, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text("Make a new code")
                }
            }
            else -> {
                OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text("Cancel")
                }
            }
        }
    }
}
