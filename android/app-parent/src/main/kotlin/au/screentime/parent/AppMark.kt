package au.screentime.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp

/** The app's mark on the sign-in and lock screens: a 72 dp circle with the hourglass. */
@Composable
fun AppMark(modifier: Modifier = Modifier) {
    Icon(
        painter = painterResource(R.drawable.ic_hourglass),
        contentDescription = null,
        modifier = modifier
            .size(72.dp)
            .background(MaterialTheme.colorScheme.primary, CircleShape)
            .padding(18.dp),
        tint = MaterialTheme.colorScheme.onPrimary,
    )
}
