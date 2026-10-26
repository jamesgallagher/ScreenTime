package au.screentime.core.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Screen Time colours that Material 3 has no slot for (warning, critical, night...). */
val LocalScreenTimeColors = staticCompositionLocalOf { LightColors }

/** Shortcut: `ScreenTimeTheme.colors.warning` inside a composable. */
object ScreenTimeTheme {
    val colors: ScreenTimeColors
        @Composable
        @ReadOnlyComposable
        get() = LocalScreenTimeColors.current
}

private val BaseTypography = Typography()

/** Material 3 type scale; the big remaining-time number is displayLarge, bold, tabular figures. */
val ScreenTimeTypography = BaseTypography.copy(
    displayLarge = BaseTypography.displayLarge.copy(
        fontWeight = FontWeight.Bold,
        fontFeatureSettings = "tnum",
    ),
)

/** Cards 16 dp radius (medium); sheets 28 dp radius (extraLarge). */
val ScreenTimeShapes = Shapes(
    medium = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

private fun colorSchemeOf(c: ScreenTimeColors, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.primary,
        onPrimary = c.onPrimary,
        background = c.background,
        onBackground = c.onSurface,
        surface = c.surface,
        onSurface = c.onSurface,
        surfaceVariant = c.surfaceVariant,
        onSurfaceVariant = c.muted,
        // Tonal buttons ("Check again", "Scan QR code") use these: our neutral chip grey, not Material's lavender.
        secondaryContainer = c.surfaceVariant,
        onSecondaryContainer = c.onSurface,
        outline = c.outline,
        error = c.danger,
    )
}

/** Wrap every screen of both apps in this. Light or dark follows the system setting. */
@Composable
fun ScreenTimeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors
    CompositionLocalProvider(LocalScreenTimeColors provides colors) {
        MaterialTheme(
            colorScheme = colorSchemeOf(colors, darkTheme),
            typography = ScreenTimeTypography,
            shapes = ScreenTimeShapes,
            content = content,
        )
    }
}
