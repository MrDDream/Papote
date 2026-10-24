package fr.papote.app.ui.theme

import fr.papote.app.tr

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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
    Tint("rose", tr("Rose"), Color(0xFFFFE0E8), Color(0xFFFFC2D1), Color(0xFFB0305A)),
    Tint("peche", tr("Pêche"), Color(0xFFFFEBD6), Color(0xFFFFD3A8), Color(0xFF9A4F0C)),
    Tint("menthe", tr("Menthe"), Color(0xFFDDF4E9), Color(0xFFB5E6CF), Color(0xFF2C7A57)),
    Tint("ciel", tr("Ciel"), Color(0xFFE2EEFF), Color(0xFFC2DAFF), Color(0xFF2E5FA8)),
    Tint("citron", tr("Citron"), Color(0xFFFFF6D6), Color(0xFFFFE89A), Color(0xFF7A5F00)),
    Tint("lilas", tr("Lilas"), Color(0xFFEDE6FF), Color(0xFFD7C9FF), Color(0xFF5B3CC4)),
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
enum class ThemeStyle(val label: String, val light: PapoteColors, val night: PapoteColors, val look: Look = PapoteLook) {
    Papote(
        "Papote",
        palette(false, 0xFFF7F3FF, 0xFFFFFFFF, 0xFF2E2442, 0xFF5E5474, 0xFFE6DDFB, 0xFFFBF9FF, 0xFFEDE6FF, 0xFF6A47D6, 0xFF4A2FA8),
        palette(true, 0xFF1C1628, 0xFF2A2238, 0xFFF3EEFF, 0xFFBDB3D1, 0xFF43385A, 0xFF241D31, 0xFF3A2F55, 0xFF8B6CF0, 0xFF5B3CC4),
    ),
    Menthe(
        tr("Menthe"),
        palette(false, 0xFFF1FAF5, 0xFFFFFFFF, 0xFF1F3A2E, 0xFF4E6B5D, 0xFFCDEBDD, 0xFFF8FDFA, 0xFFDDF4E9, 0xFF23845A, 0xFF186543),
        palette(true, 0xFF14211B, 0xFF1E2E26, 0xFFEAF7F0, 0xFFA9C7B8, 0xFF33493E, 0xFF18261F, 0xFF24493A, 0xFF4CC38A, 0xFF2F9E6E, 0xFF0E2219),
    ),
    Ocean(
        tr("Océan"),
        palette(false, 0xFFF1F6FF, 0xFFFFFFFF, 0xFF1E2B45, 0xFF4D5E7E, 0xFFD2E0F7, 0xFFF8FBFF, 0xFFE2EEFF, 0xFF2E6FD6, 0xFF1F52A8),
        palette(true, 0xFF121A2B, 0xFF1C273D, 0xFFEAF1FF, 0xFFA9B9D6, 0xFF33415E, 0xFF161F33, 0xFF25385C, 0xFF5B93F0, 0xFF2E6FD6, 0xFF0B1530),
    ),
    Corail(
        tr("Corail"),
        palette(false, 0xFFFFF4F6, 0xFFFFFFFF, 0xFF3D1F2A, 0xFF7A5161, 0xFFF6D5DE, 0xFFFFFAFB, 0xFFFFE0E8, 0xFFC23660, 0xFF92284A),
        palette(true, 0xFF24151B, 0xFF331F27, 0xFFFFEFF3, 0xFFD3AEBB, 0xFF4E3540, 0xFF2A1920, 0xFF4A2433, 0xFFF0668E, 0xFFC2406A, 0xFF2A0A15),
    ),
    Soleil(
        tr("Soleil"),
        palette(false, 0xFFFFF8EE, 0xFFFFFFFF, 0xFF3A2A12, 0xFF725C3B, 0xFFF5E2C3, 0xFFFFFCF6, 0xFFFFEBD6, 0xFFA65A05, 0xFF7E4403),
        palette(true, 0xFF221A10, 0xFF30251A, 0xFFFFF4E4, 0xFFD3BD9C, 0xFF4B3B27, 0xFF281F14, 0xFF4A3518, 0xFFF29A2E, 0xFFC47616, 0xFF2A1800),
    ),
    Encre(
        tr("Encre"),
        palette(false, 0xFFF4F4F6, 0xFFFFFFFF, 0xFF1F2029, 0xFF55576A, 0xFFDCDDE5, 0xFFFAFAFC, 0xFFE8E9EF, 0xFF3A3D52, 0xFF1F2130),
        palette(true, 0xFF121216, 0xFF1D1E24, 0xFFF1F1F5, 0xFFA9AAB8, 0xFF34353F, 0xFF17181D, 0xFF2A2B33, 0xFFB8BBD4, 0xFF6A6D88, 0xFF121216),
    ),

    // Whole new looks: fonts and shapes change too (same as the web app).
    Nuit(
        tr("Nuit étoilée"),
        palette(false, 0xFFEEF0FB, 0xFFFFFFFF, 0xFF1A1F3D, 0xFF545B85, 0xFFD6DAF2, 0xFFF7F8FE, 0xFFE3E6FA, 0xFF5B43E0, 0xFF3D2BB0),
        palette(true, 0xFF0F1530, 0xFF1A2145, 0xFFE8EAFF, 0xFF9AA2D6, 0xFF2C3566, 0xFF141A3A, 0xFF26306A, 0xFF7C5CFF, 0xFF5A3EE0),
        Look({ SpaceGrotesk }, { SpaceGrotesk }, rounded(0.75f), bubble = { mine -> if (mine) RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp) else RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp) }),
    ),
    Carnet(
        tr("Carnet"),
        palette(false, 0xFFFBF6EA, 0xFFFFFDF7, 0xFF2B2B2B, 0xFF6E6553, 0xFFD9CDB3, 0xFFFFFFFF, 0xFFF1E8D2, 0xFF2B2B2B, 0xFF000000, 0xFFFFFDF7),
        palette(true, 0xFF23201B, 0xFF2E2A23, 0xFFF3EBDA, 0xFFBDB19A, 0xFF4A4337, 0xFF27231D, 0xFF3A342A, 0xFFF3EBDA, 0xFFBDB19A, 0xFF23201B),
        Look({ PatrickHand }, { PatrickHand }, rounded(max = 6.dp), outline = 1.5.dp, dashed = true, tilt = true, mine = listOf(0xFFFFE98A, 0xFF2B2B2B, 0xFF5A4B12, 0xFFFFF3C2), bubble = { RoundedCornerShape(4.dp) }),
    ),
    NeoPop(
        tr("Néo-pop"),
        palette(false, 0xFFFFF4D6, 0xFFFFFFFF, 0xFF111111, 0xFF4A4A4A, 0xFF111111, 0xFFFFFFFF, 0xFFFFE7A3, 0xFFFF5A5F, 0xFF111111, 0xFF111111),
        palette(true, 0xFF17161C, 0xFF24232B, 0xFFFFF7E0, 0xFFC9C2AE, 0xFFFFF7E0, 0xFF1E1D24, 0xFF3A3420, 0xFFFF6B70, 0xFFFFF7E0, 0xFF111111),
        Look({ SpaceGrotesk }, { SpaceGrotesk }, rounded(max = 10.dp), outline = 2.dp, offset = 3.dp, mine = listOf(0xFFFFD23F, 0xFF111111, 0xFFFFD23F, 0xFF111111), bubble = { RoundedCornerShape(10.dp) }),
    ),
    Sobre(
        tr("Sobre"),
        palette(false, 0xFFF4F5F7, 0xFFFFFFFF, 0xFF111827, 0xFF4B5563, 0xFFD9DEE5, 0xFFFFFFFF, 0xFFE8EDF5, 0xFF2563EB, 0xFF1D4ED8),
        palette(true, 0xFF0E1116, 0xFF1A1F27, 0xFFF3F4F6, 0xFFA7B0BE, 0xFF2E3542, 0xFF151A21, 0xFF222A36, 0xFF4F8BFF, 0xFF2F6AE0, 0xFF0B1220),
        Look({ FontFamily.Default }, { FontFamily.Default }, rounded(max = 12.dp), outline = 1.dp, plainSurfaces = true, bubble = { RoundedCornerShape(12.dp) }),
    ),
    Arcade(
        tr("Arcade"),
        palette(false, 0xFFE8F0D8, 0xFFF6FAEC, 0xFF1B2B14, 0xFF4D6440, 0xFF1B2B14, 0xFFFFFFFF, 0xFFD2E2B8, 0xFF2E7D32, 0xFF1B2B14, 0xFFF6FAEC),
        palette(true, 0xFF101010, 0xFF1A1A1A, 0xFFC8FFD4, 0xFF6FA67B, 0xFF39D353, 0xFF141414, 0xFF1F2B21, 0xFF39D353, 0xFF1E7A2E, 0xFF101010),
        Look({ PressStart }, { FontFamily.Monospace }, { RectangleShape }, outline = 2.dp, displayScale = 0.6f, plainSurfaces = true, bubble = { RectangleShape }),
    ),
    Foret(
        tr("Forêt"),
        palette(false, 0xFFF3EFE6, 0xFFFFFDF8, 0xFF26382B, 0xFF5C6B57, 0xFFDCD5C3, 0xFFFFFFFF, 0xFFE3E9D7, 0xFF2F5D3A, 0xFF1F4229, 0xFFF3EFE6),
        palette(true, 0xFF161D17, 0xFF202A22, 0xFFECEFE4, 0xFFA9B5A3, 0xFF34433A, 0xFF1A231C, 0xFF2A3A2D, 0xFF7DB38A, 0xFF4E8A5C, 0xFF102015),
        Look(
            { Fraunces }, { NunitoFamily }, { r -> RoundedCornerShape(topStart = r, topEnd = r * 0.3f, bottomEnd = r, bottomStart = r * 0.3f) },
            bubble = { mine -> if (mine) RoundedCornerShape(4.dp, 18.dp, 4.dp, 18.dp) else RoundedCornerShape(18.dp, 4.dp, 18.dp, 4.dp) },
        ),
    ),
}

// Read lazily: ThemeStyle's own initialisation calls palette() in this file, so a top-level value read
// from ThemeStyle here would run before ThemeStyle exists (crash at launch).
val LocalPapote = staticCompositionLocalOf { ThemeStyle.Papote.light }

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, weights: List<Int>) = FontFamily(
    weights.map { w -> Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) },
)

private val BalooFamily by lazy { variable(R.font.baloo2, listOf(500, 600, 700, 800)) }
private val NunitoFamily by lazy { variable(R.font.nunito, listOf(400, 600, 700, 800)) }
private val SpaceGrotesk by lazy { variable(R.font.space_grotesk, listOf(400, 500, 600, 700)) }
private val Fraunces by lazy { variable(R.font.fraunces, listOf(400, 500, 600, 700, 800)) }
private val PatrickHand by lazy { FontFamily(Font(R.font.patrick_hand)) }
private val PressStart by lazy { FontFamily(Font(R.font.press_start_2p)) }

/**
 * What a theme changes besides colours: fonts, corner shapes, outlines, the offset "comic" shadow,
 * and the colour of my own bubbles.
 */
@Immutable
data class Look(
    val display: () -> FontFamily,
    val body: () -> FontFamily,
    /** Corner radius for a requested one (the code is written for Papote's rounded look). */
    val corner: (Dp) -> Shape,
    /** Outline around cards, bubbles and buttons (0 = none), dashed or not. */
    val outline: Dp = 0.dp,
    val dashed: Boolean = false,
    /** Néo-pop's flat shadow, shifted down-right. */
    val offset: Dp = 0.dp,
    /** Titles are smaller in pixel fonts. */
    val displayScale: Float = 1f,
    /** Slightly tilted bubbles (post-its). */
    val tilt: Boolean = false,
    /** My bubbles, when not the primary colour: (light bg, light text, dark bg, dark text). */
    val mine: List<Long>? = null,
    /** Big headers and group cards on the plain card colour instead of the group's pastel. */
    val plainSurfaces: Boolean = false,
    /** Message bubbles (mine or someone else's); null = Papote's, with a small tail. */
    val bubble: ((Boolean) -> Shape)? = null,
) {
    val flat get() = this !== PapoteLook
}

/** A message bubble's shape in the current theme. */
fun bubbleShape(mine: Boolean): Shape = ActiveLook.value.bubble?.invoke(mine)
    ?: if (mine) RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp) else RoundedCornerShape(20.dp, 20.dp, 20.dp, 6.dp)

/** My bubble's colours in the current theme, or null for the primary colour. */
fun mineBubble(dark: Boolean): Pair<Color, Color>? = ActiveLook.value.mine?.let { m ->
    if (dark) Color(m[2]) to Color(m[3]) else Color(m[0]) to Color(m[1])
}

private fun rounded(scale: Float = 1f, max: Dp = Dp.Infinity): (Dp) -> Shape = { r -> RoundedCornerShape(minOf(r * scale, max)) }

val PapoteLook = Look({ BalooFamily }, { NunitoFamily }, rounded())

/** The look in use, read wherever shapes and fonts are drawn (changes with the theme, no restart). */
val ActiveLook = mutableStateOf(PapoteLook)

/** Rounded corners in the current theme's shape (square in Arcade, leaf-like in Forêt…). */
fun pShape(r: Dp): Shape = ActiveLook.value.corner(r)

val Baloo: FontFamily get() = ActiveLook.value.display()
val Nunito: FontFamily get() = ActiveLook.value.body()

/** Outline (plain or dashed) drawn over a surface already clipped to [shape]. */
fun Modifier.lookOutline(shape: Shape, color: Color): Modifier {
    val look = ActiveLook.value
    if (look.outline == 0.dp) return this
    return drawWithContent {
        drawContent()
        val o = shape.createOutline(size, layoutDirection, this)
        val w = look.outline.toPx()
        drawOutline(o, color, style = Stroke(w * 2, pathEffect = if (look.dashed) PathEffect.dashPathEffect(floatArrayOf(w * 4, w * 3)) else null))
    }
}

/** Néo-pop's flat shadow, shifted down-right: put it before the clip. */
fun Modifier.lookShadow(shape: Shape, color: Color): Modifier {
    val look = ActiveLook.value
    if (look.offset == 0.dp) return this
    return drawBehind {
        val d = look.offset.toPx()
        translate(d, d) { drawOutline(shape.createOutline(size, layoutDirection, this), color) }
    }
}

private fun typography(look: Look): Typography {
    val baloo = look.display()
    val nunito = look.body()
    val k = look.displayScale
    return Typography(
        displaySmall = TextStyle(fontFamily = baloo, fontWeight = FontWeight.ExtraBold, fontSize = 44.sp * k, lineHeight = 46.sp * k),
        headlineMedium = TextStyle(fontFamily = baloo, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp * k, lineHeight = 31.sp * k * 1.15f),
        headlineSmall = TextStyle(fontFamily = baloo, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp * k, lineHeight = 26.sp * k * 1.15f),
        titleLarge = TextStyle(fontFamily = baloo, fontWeight = FontWeight.Bold, fontSize = 20.sp * k, lineHeight = 24.sp * k * 1.15f),
        titleMedium = TextStyle(fontFamily = baloo, fontWeight = FontWeight.Bold, fontSize = 18.sp * k, lineHeight = 22.sp * k * 1.15f),
        bodyLarge = TextStyle(fontFamily = nunito, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 20.sp),
        bodyMedium = TextStyle(fontFamily = nunito, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 19.sp),
        bodySmall = TextStyle(fontFamily = nunito, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 17.sp),
        labelLarge = TextStyle(fontFamily = nunito, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, lineHeight = 18.sp),
        labelMedium = TextStyle(fontFamily = nunito, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp, lineHeight = 16.sp),
    )
}

enum class ThemeMode { Light, Dark, Auto }

@Composable
fun PapoteTheme(mode: ThemeMode = ThemeMode.Auto, style: ThemeStyle = ThemeStyle.Papote, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
        ThemeMode.Auto -> isSystemInDarkTheme()
    }
    val c = if (dark) style.night else style.light
    ActiveLook.value = style.look
    val typography = remember(style) { typography(style.look) }
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
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}

object Papote {
    val colors: PapoteColors
        @Composable get() = LocalPapote.current
}
