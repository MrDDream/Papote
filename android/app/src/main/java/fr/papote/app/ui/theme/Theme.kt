package fr.papote.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import fr.papote.app.R

/** Pastel pair used by groups, avatars and bubbles: [bg] for large surfaces, [tint] for badges, [text] for names on white. */
@Immutable
data class Tint(val key: String, val label: String, val bg: Color, val tint: Color, val text: Color)

val Tints = listOf(
    Tint("rose", "Rose", Color(0xFFFFE0E8), Color(0xFFFFC2D1), Color(0xFFB0305A)),
    Tint("peche", "Pêche", Color(0xFFFFEBD6), Color(0xFFFFD3A8), Color(0xFF9A4F0C)),
    Tint("menthe", "Menthe", Color(0xFFDDF4E9), Color(0xFFB5E6CF), Color(0xFF2C7A57)),
    Tint("ciel", "Ciel", Color(0xFFE2EEFF), Color(0xFFC2DAFF), Color(0xFF2E5FA8)),
    Tint("citron", "Citron", Color(0xFFFFF6D6), Color(0xFFFFE89A), Color(0xFF7A5F00)),
    Tint("lilas", "Lilas", Color(0xFFEDE6FF), Color(0xFFD7C9FF), Color(0xFF5B3CC4)),
)

fun tint(key: String?): Tint = Tints.firstOrNull { it.key == key } ?: Tints[0]

@Immutable
data class PapoteColors(
    val dark: Boolean,
    val ground: Color,
    val card: Color,
    val ink: Color,
    val muted: Color,
    val line: Color,
    val field: Color,
    val soft: Color,
    val primary: Color,
    val primaryDark: Color,
    val onPrimary: Color,
    val ok: Color,
    val danger: Color,
    val dangerBg: Color,
    /** Ink drawn on pastel tints: stays dark in both themes. */
    val onPastel: Color = Color(0xFF2E2442),
) {
    /** Large pastel surface (group cards, chat header) toned down in dark mode. */
    fun surfaceOf(t: Tint): Color = if (dark) lerp(card, t.tint, 0.22f) else t.bg

    /** Coloured name label, readable on [card]. */
    fun nameOf(t: Tint): Color = if (dark) t.tint else t.text
}

private fun palette(
    dark: Boolean, ground: Long, card: Long, ink: Long, muted: Long, line: Long, field: Long, soft: Long,
    primary: Long, primaryDark: Long, onPrimary: Long = 0xFFFFFFFF,
) = PapoteColors(
    dark = dark,
    ground = Color(ground),
    card = Color(card),
    ink = Color(ink),
    muted = Color(muted),
    line = Color(line),
    field = Color(field),
    soft = Color(soft),
    primary = Color(primary),
    primaryDark = Color(primaryDark),
    onPrimary = Color(onPrimary),
    ok = if (dark) Color(0xFF4CC38A) else Color(0xFF2FA36B),
    danger = if (dark) Color(0xFFFF8FAB) else Color(0xFFA3204A),
    dangerBg = if (dark) Color(0xFF4A2433) else Color(0xFFFFE0E8),
)

/** Complete looks for the whole app (Profil → Apparence). Papote, the original, stays the default. */
enum class ThemeStyle(val label: String, val light: PapoteColors, val night: PapoteColors) {
    Papote(
        "Papote",
        palette(false, 0xFFF7F3FF, 0xFFFFFFFF, 0xFF2E2442, 0xFF5E5474, 0xFFE6DDFB, 0xFFFBF9FF, 0xFFEDE6FF, 0xFF6A47D6, 0xFF4A2FA8),
        palette(true, 0xFF1C1628, 0xFF2A2238, 0xFFF3EEFF, 0xFFBDB3D1, 0xFF43385A, 0xFF241D31, 0xFF3A2F55, 0xFF8B6CF0, 0xFF5B3CC4),
    ),
    Menthe(
        "Menthe",
        palette(false, 0xFFF1FAF5, 0xFFFFFFFF, 0xFF1F3A2E, 0xFF4E6B5D, 0xFFCDEBDD, 0xFFF8FDFA, 0xFFDDF4E9, 0xFF23845A, 0xFF186543),
        palette(true, 0xFF14211B, 0xFF1E2E26, 0xFFEAF7F0, 0xFFA9C7B8, 0xFF33493E, 0xFF18261F, 0xFF24493A, 0xFF4CC38A, 0xFF2F9E6E, 0xFF0E2219),
    ),
    Ocean(
        "Océan",
        palette(false, 0xFFF1F6FF, 0xFFFFFFFF, 0xFF1E2B45, 0xFF4D5E7E, 0xFFD2E0F7, 0xFFF8FBFF, 0xFFE2EEFF, 0xFF2E6FD6, 0xFF1F52A8),
        palette(true, 0xFF121A2B, 0xFF1C273D, 0xFFEAF1FF, 0xFFA9B9D6, 0xFF33415E, 0xFF161F33, 0xFF25385C, 0xFF5B93F0, 0xFF2E6FD6, 0xFF0B1530),
    ),
    Corail(
        "Corail",
        palette(false, 0xFFFFF4F6, 0xFFFFFFFF, 0xFF3D1F2A, 0xFF7A5161, 0xFFF6D5DE, 0xFFFFFAFB, 0xFFFFE0E8, 0xFFC23660, 0xFF92284A),
        palette(true, 0xFF24151B, 0xFF331F27, 0xFFFFEFF3, 0xFFD3AEBB, 0xFF4E3540, 0xFF2A1920, 0xFF4A2433, 0xFFF0668E, 0xFFC2406A, 0xFF2A0A15),
    ),
    Soleil(
        "Soleil",
        palette(false, 0xFFFFF8EE, 0xFFFFFFFF, 0xFF3A2A12, 0xFF725C3B, 0xFFF5E2C3, 0xFFFFFCF6, 0xFFFFEBD6, 0xFFA65A05, 0xFF7E4403),
        palette(true, 0xFF221A10, 0xFF30251A, 0xFFFFF4E4, 0xFFD3BD9C, 0xFF4B3B27, 0xFF281F14, 0xFF4A3518, 0xFFF29A2E, 0xFFC47616, 0xFF2A1800),
    ),
    Encre(
        "Encre",
        palette(false, 0xFFF4F4F6, 0xFFFFFFFF, 0xFF1F2029, 0xFF55576A, 0xFFDCDDE5, 0xFFFAFAFC, 0xFFE8E9EF, 0xFF3A3D52, 0xFF1F2130),
        palette(true, 0xFF121216, 0xFF1D1E24, 0xFFF1F1F5, 0xFFA9AAB8, 0xFF34353F, 0xFF17181D, 0xFF2A2B33, 0xFFB8BBD4, 0xFF6A6D88, 0xFF121216),
    ),
}

// Read lazily: ThemeStyle's own initialisation calls palette() in this file, so a top-level value read
// from ThemeStyle here would run before ThemeStyle exists (crash at launch).
val LocalPapote = staticCompositionLocalOf { ThemeStyle.Papote.light }

@OptIn(ExperimentalTextApi::class)
val Baloo = FontFamily(
    listOf(500, 600, 700, 800).map { w ->
        Font(R.font.baloo2, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    },
)

@OptIn(ExperimentalTextApi::class)
val Nunito = FontFamily(
    listOf(400, 600, 700, 800).map { w ->
        Font(R.font.nunito, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    },
)

private val PapoteTypography = Typography(
    displaySmall = TextStyle(fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 44.sp, lineHeight = 46.sp),
    headlineMedium = TextStyle(fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, lineHeight = 31.sp),
    headlineSmall = TextStyle(fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, lineHeight = 26.sp),
    titleLarge = TextStyle(fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 24.sp),
    titleMedium = TextStyle(fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontFamily = Nunito, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 20.sp),
    bodyMedium = TextStyle(fontFamily = Nunito, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 19.sp),
    bodySmall = TextStyle(fontFamily = Nunito, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = Nunito, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, lineHeight = 18.sp),
    labelMedium = TextStyle(fontFamily = Nunito, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp, lineHeight = 16.sp),
)

enum class ThemeMode { Light, Dark, Auto }

@Composable
fun PapoteTheme(mode: ThemeMode = ThemeMode.Auto, style: ThemeStyle = ThemeStyle.Papote, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
        ThemeMode.Auto -> isSystemInDarkTheme()
    }
    val c = if (dark) style.night else style.light
    val scheme = if (dark) {
        darkColorScheme(
            primary = c.primary, onPrimary = c.onPrimary, background = c.ground, onBackground = c.ink,
            surface = c.card, onSurface = c.ink, surfaceVariant = c.soft, onSurfaceVariant = c.muted,
            outline = c.line, error = c.danger, surfaceContainer = c.card, surfaceContainerHigh = c.card,
        )
    } else {
        lightColorScheme(
            primary = c.primary, onPrimary = c.onPrimary, background = c.ground, onBackground = c.ink,
            surface = c.card, onSurface = c.ink, surfaceVariant = c.soft, onSurfaceVariant = c.muted,
            outline = c.line, error = c.danger, surfaceContainer = c.card, surfaceContainerHigh = c.card,
        )
    }
    CompositionLocalProvider(LocalPapote provides c) {
        MaterialTheme(colorScheme = scheme, typography = PapoteTypography, content = content)
    }
}

object Papote {
    val colors: PapoteColors
        @Composable get() = LocalPapote.current
}
