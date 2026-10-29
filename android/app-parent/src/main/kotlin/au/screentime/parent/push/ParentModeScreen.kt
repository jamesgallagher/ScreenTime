package au.screentime.parent.push

import android.app.Application
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.core.model.api.ParentModeStart
import au.screentime.parent.ParentApp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.inbox.answerError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

/** A parent-mode request opened from its notification. */
data class ParentModeAsk(val requestId: String, val kidName: String, val deviceName: String?)

/** The approval page's state: approve or say no to one parent-mode request. */
class ParentModeViewModel(app: Application) : AndroidViewModel(app) {
    private val session = getApplication<ParentApp>().session

    /** Approve the request; null when it worked, else the error's words. */
    suspend fun approve(requestId: String, minutes: Int?): String? {
        val deferred = viewModelScope.async {
            try {
                session.call { postParentModeRequestsApprove(requestId, ParentModeStart(minutes)) }
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                answerError(e)
            }
        }
        return deferred.await()
    }

    /** Say no to the request; null when it worked, else the error's words. */
    suspend fun deny(requestId: String): String? {
        val deferred = viewModelScope.async {
            try {
                session.call { postParentModeRequestsDeny(requestId) }
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                answerError(e)
            }
        }
        return deferred.await()
    }
}

/**
 * A parent-mode request opened from its notification (docs/SPEC.md §12.3): how long, approve, or say no.
 */
@Composable
fun ParentModeScreen(ask: ParentModeAsk, vm: ParentModeViewModel, onDone: () -> Unit) {
    BackHandler(onBack = onDone)
    var minutes by remember { mutableStateOf<Int?>(15) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Text(
            text = approveTitle(ask.kidName),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = approveText(ask.deviceName),
            style = MaterialTheme.typography.bodyLarge,
            color = ScreenTimeTheme.colors.muted,
        )
        if (done == null) {
            Spacer(Modifier.height(24.dp))
            Text(
                text = "How long?",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            PARENT_MODE_MINUTES.forEach { m ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .selectable(selected = minutes == m, onClick = { minutes = m }, role = Role.RadioButton)
                        .heightIn(min = 48.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = minutes == m, onClick = null)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = durationText(m),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
            error?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.critical,
                )
            }
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        val e = vm.approve(ask.requestId, minutes)
                        busy = false
                        if (e == null) {
                            done = "Done. ${ask.deviceName ?: "The device"} is in parent mode ${if (minutes == null) "until you end it" else "for " + durationText(minutes)}."
                        } else {
                            error = e
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                enabled = !busy,
            ) {
                Text("Approve")
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    busy = true
                    scope.launch {
                        val e = vm.deny(ask.requestId)
                        busy = false
                        if (e == null) {
                            done = "Done. You said no to ${ask.deviceName ?: "the device"}."
                        } else {
                            error = e
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                enabled = !busy,
            ) {
                Text("Say no")
            }
        } else {
            Spacer(Modifier.height(24.dp))
            Text(
                text = done!!,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(24.dp))
            Button(onClick = onDone, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text("Close")
            }
        }
    }
}
