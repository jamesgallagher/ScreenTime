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
import androidx.compose.ui.unit.sp

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
    headlineMedium = BaseTypography.headlineMedium.copy(fontWeight = FontWeight.Bold),
    headlineSmall = BaseTypography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
    titleLarge = BaseTypography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
    titleMedium = BaseTypography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    labelLarge = BaseTypography.labelLarge.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
)

/** Chips and fields 12 dp (small); cards 16 dp (medium); sheets and dialogs 28 dp (extraLarge). */
val ScreenTimeShapes = Shapes(
    small = RoundedCornerShape(12.dp),
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
        outlineVariant = c.outline,
        error = c.danger,
        primaryContainer = c.primarySoft,
        onPrimaryContainer = c.onPrimarySoft,
        secondary = c.primary,
        onSecondary = c.onPrimary,
        tertiary = c.primary,
        onTertiary = c.onPrimary,
        // The clock picker's AM/PM and other tertiary bits: soft teal, not Material's pink.
        tertiaryContainer = c.primarySoft,
        onTertiaryContainer = c.onPrimarySoft,
        // Sheets, dialogs, menus, date and time pickers all draw on these. Material's defaults are lavender, which
        // fights the teal; ours are the plain neutrals (white sheets in light mode, warm charcoal in dark).
        surfaceTint = c.surface,
        surfaceBright = c.surface,
        surfaceDim = c.surfaceVariant,
        surfaceContainerLowest = c.surface,
        surfaceContainerLow = c.surface,
        surfaceContainer = c.surface,
        surfaceContainerHigh = c.raised,
        surfaceContainerHighest = c.surfaceVariant,
        inverseSurface = c.onSurface,
        inverseOnSurface = c.surface,
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
