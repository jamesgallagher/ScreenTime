package au.screentime.parent.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.ParentApp
import au.screentime.parent.R
import au.screentime.parent.kids.spacedCode
import au.screentime.parent.push.codeAt
import au.screentime.parent.push.secondsLeft
import au.screentime.parent.today.Problem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * The parent code (docs/SPEC.md §16.4): the 6-digit code with a 30-second countdown, for a kid device that is
 * offline. The secret is kept in memory while the page is open.
 */
@Composable
fun ParentCodeScreen(onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val session = (LocalContext.current.applicationContext as ParentApp).session
    var secret by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    var attempt by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    suspend fun load() {
        try {
            secret = session.call { getFamilyParentCode() }.secret
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Can't reach Screen Time. Check the internet connection."
        }
    }
    LaunchedEffect(attempt) {
        load()
    }
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 16.dp, top = 16.dp, bottom = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "Back")
            }
            Text(
                text = "Parent code",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "Type this on the kid's device to start parent mode when it can't reach the internet.",
                style = MaterialTheme.typography.bodyLarge,
                color = ScreenTimeTheme.colors.muted,
                textAlign = TextAlign.Center,
            )
            when {
                error != null -> Problem(error!!) { attempt++ }
                secret == null -> CircularProgressIndicator()
                else -> {
                    Spacer(Modifier.height(24.dp))
                    Text(
                        text = spacedCode(codeAt(secret!!, now)!!),
                        fontSize = 48.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 2.sp,
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.semantics { contentDescription = "Parent code" },
                    )
                    Spacer(Modifier.height(16.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(progress = { secondsLeft(now) / 30f }, modifier = Modifier.size(24.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "New code in ${secondsLeft(now)}s",
                            style = MaterialTheme.typography.bodyMedium,
                            color = ScreenTimeTheme.colors.muted,
                        )
                    }
                }
            }
        }
    }
}
