package au.screentime.core.ui

import androidx.compose.ui.graphics.Color

/** Screen Time colour tokens (docs/SPEC.md §16.1). */
data class ScreenTimeColors(
    val primary: Color,
    val onPrimary: Color,
    val background: Color,
    val surface: Color,
    val surfaceVariant: Color,
    val onSurface: Color,
    val muted: Color,
    val outline: Color,
    val warning: Color,
    val critical: Color,
    val danger: Color,
    val nightTop: Color,
    val nightBottom: Color,
    val onNight: Color,
)

val LightColors = ScreenTimeColors(
    primary = Color(0xFF0F766E),
    onPrimary = Color(0xFFFFFFFF),
    background = Color(0xFFF7F7F5),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFEFEFEB),
    onSurface = Color(0xFF1C1917),
    muted = Color(0xFF57534E),
    outline = Color(0xFFD6D3D1),
    warning = Color(0xFFD97706),
    critical = Color(0xFFEA580C),
    danger = Color(0xFFDC2626),
    nightTop = Color(0xFF1E1B4B),
    nightBottom = Color(0xFF312E81),
    onNight = Color(0xFFE0E7FF),
)

val DarkColors = ScreenTimeColors(
    primary = Color(0xFF2DD4BF),
    onPrimary = Color(0xFF042F2E),
    background = Color(0xFF0C0A09),
    surface = Color(0xFF1C1917),
    surfaceVariant = Color(0xFF292524),
    onSurface = Color(0xFFF5F5F4),
    muted = Color(0xFFA8A29E),
    outline = Color(0xFF44403C),
    warning = Color(0xFFFBBF24),
    critical = Color(0xFFFB923C),
    danger = Color(0xFFF87171),
    nightTop = Color(0xFF1E1B4B),
    nightBottom = Color(0xFF312E81),
    onNight = Color(0xFFE0E7FF),
)

/** Kid avatar colours, in this order (docs/SPEC.md §16.1). */
val AvatarColors = listOf(
    Color(0xFF0F766E), // teal
    Color(0xFF7C3AED), // violet
    Color(0xFFDB2777), // pink
    Color(0xFF2563EB), // blue
    Color(0xFFEA580C), // orange
    Color(0xFF16A34A), // green
    Color(0xFFCA8A04), // gold
    Color(0xFF475569), // slate
)
