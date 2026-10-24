package fr.papote.app.ui.extras

import fr.papote.app.tr

import android.graphics.Bitmap
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameMillis
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlin.random.Random

private val pathCache = HashMap<String, Path>()
private fun svg(d: String): Path = pathCache.getOrPut(d) { PathParser().parsePathString(d).toPath() }

private val Ink = Color(0xFF2E2442)

/** Bubu's moods (mockup "Mascotte réactive"). */
enum class BubuState(val label: String, val line: String, val bg: Color) {
    Sleepy(tr("Endormie"), tr("Chut… je fais la sieste"), Color(0xFFE2EEFF)),
    Happy(tr("Contente"), tr("Coucou tout le monde !"), Color(0xFFFFE0E8)),
    Excited(tr("Surexcitée"), tr("Ouh, on dessine ensemble !"), Color(0xFFFFF0B8)),
    Party(tr("En fête"), tr("Joyeux anniv !"), Color(0xFFFFE3C7)),
    Surprised(tr("Étonnée"), tr("Waouh, ça bavarde !"), Color(0xFFDDF4E9)),
}

private fun DrawScope.strokePath(d: String, color: Color = Ink, width: Float = 3f) =
    drawPath(svg(d), color, style = Stroke(width, cap = StrokeCap.Round, join = StrokeJoin.Round))

/** Bubu, drawn from the mockup's SVG (viewBox 0 -18 112 122). */
@Composable
fun Bubu(state: BubuState, size: Dp = 40.dp, modifier: Modifier = Modifier) {
    val bob = rememberInfiniteTransition(label = "bubu")
    val period = when (state) {
        BubuState.Sleepy -> 5000
        BubuState.Excited, BubuState.Party -> 900
        else -> 3000
    }
    val dy by bob.animateFloat(0f, -3f, infiniteRepeatable(tween(period / 2), RepeatMode.Reverse), label = "bob")
    Canvas(modifier.size(size, size * 122f / 112f)) {
        val k = this.size.width / 112f
        translate(0f, dy * k) {
            scale(k, k, pivot = Offset.Zero) {
                translate(0f, 18f) {
                    val body = "M20 8 H92 a16 16 0 0 1 16 16 V64 a16 16 0 0 1 -16 16 H50 L30 98 L33 80 H20 a16 16 0 0 1 -16 -16 V24 a16 16 0 0 1 16 -16 Z"
                    drawPath(svg(body), Color(0xFFFFC2D1))
                    strokePath(body)
                    drawOval(Color(0xFFFF8FAB), Offset(24f, 50f), Size(12f, 8f))
                    drawOval(Color(0xFFFF8FAB), Offset(76f, 50f), Size(12f, 8f))
                    fun eyes() {
                        drawCircle(Ink, 5.5f, Offset(42f, 40f))
                        drawCircle(Ink, 5.5f, Offset(70f, 40f))
                        drawCircle(Color.White, 1.8f, Offset(44f, 38f))
                        drawCircle(Color.White, 1.8f, Offset(72f, 38f))
                    }
                    when (state) {
                        BubuState.Sleepy -> {
                            strokePath("M36 42q6 4 12 0M64 42q6 4 12 0")
                            strokePath("M52 56q4 2 8 0")
                            strokePath("M88 4h6l-6 7h6M98 -6h4l-4 5h4", Color(0xFF6A47D6), 2.2f)
                        }
                        BubuState.Happy -> {
                            eyes()
                            strokePath("M49 52 q7 7 14 0")
                        }
                        BubuState.Excited -> {
                            strokePath("M36 36l12 6-12 6M76 36l-12 6 12 6")
                            drawPath(svg("M46 52h20q0 12-10 12t-10-12z"), Ink)
                            strokePath("M4 10l6 4M108 14l-6 3M2 30h6", Color(0xFFFF9F43))
                        }
                        BubuState.Party -> {
                            strokePath("M36 42q6-6 12 0M64 42q6-6 12 0")
                            strokePath("M48 52q8 10 16 0")
                            drawPath(svg("M44 10l12-20 12 20z"), Color(0xFFFFD66B))
                            strokePath("M44 10l12-20 12 20z", width = 2.5f)
                            drawCircle(Color(0xFFFF7A93), 3f, Offset(56f, -10f))
                        }
                        BubuState.Surprised -> {
                            eyes()
                            drawCircle(Ink, 5f, Offset(56f, 56f), style = Stroke(3f))
                            strokePath("M92 4c0 4 4 4 4 8", Color(0xFF4A9BEF))
                        }
                    }
                }
            }
        }
    }
}

/** Confetti falling over the whole screen for a few seconds (birthdays, a won game). */
@Composable
fun ConfettiOverlay(trigger: Int) {
    if (trigger == 0) return
    val colors = listOf(Color(0xFFFF7A93), Color(0xFF8B6CF0), Color(0xFF4CC38A), Color(0xFF4A9BEF), Color(0xFFFF9F43), Color(0xFFFFD66B))
    val pieces = remember(trigger) { List(90) { Triple(Random.nextFloat(), Random.nextFloat() * 0.6f, 1.8f + Random.nextFloat() * 1.6f) } }
    var elapsed by remember(trigger) { mutableLongStateOf(0L) }
    LaunchedEffect(trigger) {
        val start = withFrameMillis { it }
        while (elapsed < 4000) withFrameMillis { elapsed = it - start }
    }
    if (elapsed >= 4000) return
    Canvas(Modifier.fillMaxSize()) {
        val t = elapsed / 1000f
        pieces.forEachIndexed { i, (x, delay, dur) ->
            val p = ((t - delay) / dur).coerceIn(0f, 1f)
            if (p <= 0f || p >= 1f) return@forEachIndexed
            val cx = x * size.width + p * 40f
            val cy = -12f + p * (size.height + 24f)
            rotate(p * 720f, Offset(cx, cy)) {
                drawRect(colors[i % colors.size], Offset(cx - 4f, cy - 6f), Size(8f * density / 2, 12f * density / 2))
            }
        }
    }
}

// --- built-in stickers, same keys as the web app ------------------------------------------------------

data class BuiltinSticker(val key: String, val label: String, val d: String, val fill: Color?, val color: Color = Ink, val circle: Color? = null)

val BuiltinStickers = listOf(
    BuiltinSticker("check", tr("Validé"), "M8 20l8 8 16-16", null, Color(0xFF4CC38A)),
    BuiltinSticker("star", tr("Étoile"), "M20 6l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z", Color(0xFFFFD66B)),
    BuiltinSticker("heart", tr("Cœur"), "M20 33s-12-7-12-16a6 6 0 0 1 12-3 6 6 0 0 1 12 3c0 9-12 16-12 16z", Color(0xFFFF7A93)),
    BuiltinSticker("smile", tr("Sourire"), "M10 26q10 10 20 0M14 15h.01M26 15h.01", null, Ink, Color(0xFFFFE58A)),
    BuiltinSticker("wave", tr("Vague"), "M6 24c6-10 10 10 16 0s10 10 14 0", null, Color(0xFF4A9BEF)),
    BuiltinSticker("plus", tr("Plus"), "M20 6v28M6 20h28", null, Color(0xFF8B6CF0)),
    BuiltinSticker("tent", tr("Tente"), "M10 30l10-22 10 22M14 22h12", null, Color(0xFF2C7A57)),
    BuiltinSticker("bag", tr("Valise"), "M8 12h24v18H8zM14 12V8h12v4", Color(0xFFFFD3A8)),
    BuiltinSticker("rainbow", "Arc-en-ciel", "", null),
)

fun DrawScope.drawBuiltinSticker(key: String) {
    val st = BuiltinStickers.firstOrNull { it.key == key } ?: BuiltinStickers[1]
    val k = size.minDimension / 40f
    scale(k, k, pivot = Offset.Zero) {
        st.circle?.let {
            drawCircle(it, 15f, Offset(20f, 20f))
            drawCircle(Ink, 15f, Offset(20f, 20f), style = Stroke(2.5f))
        }
        if (st.key == "rainbow") {
            listOf(Color(0xFFFF7A93) to 14f, Color(0xFFFFD66B) to 11f, Color(0xFF4CC38A) to 8f).forEach { (c, r) ->
                drawArc(c, 180f, 180f, false, Offset(20f - r, 30f - r), Size(2 * r, 2 * r), style = Stroke(3.2f, cap = StrokeCap.Round))
            }
        } else {
            st.fill?.let { drawPath(svg(st.d), it, style = Fill) }
            drawPath(svg(st.d), st.color, style = Stroke(if (st.fill == null) 3.4f else 2.5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

@Composable
fun BuiltinStickerView(key: String, size: Dp = 96.dp, modifier: Modifier = Modifier) {
    val label = BuiltinStickers.firstOrNull { it.key == key }?.label ?: "Sticker"
    Canvas(modifier.size(size).semantics { contentDescription = "Sticker $label" }) { drawBuiltinSticker(key) }
}

// --- moods ------------------------------------------------------------------------------------------------

data class Mood(val key: String, val label: String, val icon: ImageVector)

private fun moodIcon(d: String) = ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
    .addPath(addPathNodes(d), stroke = SolidColor(Color.Black), strokeLineWidth = 2.4f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
    .build()

val Moods = listOf(
    Mood("dispo", tr("Dispo"), moodIcon("M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0M8 14q4 4 8 0M9 9h.01M15 9h.01")),
    Mood("fatigue", tr("Fatigué·e"), moodIcon("M4 14a8 8 0 1 0 8-8 6 6 0 0 1-8 8z")),
    Mood("jeu", tr("En jeu"), moodIcon("M6 9h12a4 4 0 0 1 0 8l-3-2H9l-3 2a4 4 0 0 1 0-8zM8 12v2M7 13h2M16 12h.01")),
    Mood("cine", tr("Au ciné"), moodIcon("M4 6h16v12H4zM4 10h16M8 6l2 4M14 6l2 4")),
    Mood("dnd", tr("Ne pas déranger"), moodIcon("M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM7 12h10")),
)

fun moodOf(key: String?) = Moods.firstOrNull { it.key == key }

// --- QR codes -------------------------------------------------------------------------------------------------

fun qrBitmap(text: String, size: Int = 512): ImageBitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 1))
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val ink = 0xFF2E2442.toInt()
    val white = 0xFFFFFFFF.toInt()
    val row = IntArray(size)
    for (y in 0 until size) {
        for (x in 0 until size) row[x] = if (matrix[x, y]) ink else white
        bmp.setPixels(row, 0, size, 0, y, size, 1)
    }
    return bmp.asImageBitmap()
}

@Composable
fun QrCode(text: String, size: Dp = 160.dp, modifier: Modifier = Modifier) {
    val img = remember(text) { qrBitmap(text) }
    Box(modifier.size(size)) { Image(img, tr("QR code"), Modifier.fillMaxSize()) }
}

/** The link a QR code carries: the phone's camera opens it, Papote reads it back when scanned. */
fun inviteLink(server: String, code: String, personal: Boolean = false) =
    server.trimEnd('/') + "/web/#/join?" + (if (personal) "link=1&" else "") + "code=" + code.replace("-", "")
