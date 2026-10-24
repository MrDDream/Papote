package fr.papote.app.ui.photo

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.ui.chat.PendingPhoto
import fr.papote.app.ui.chat.prepareImage
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.Segmented
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.extras.BuiltinStickerView
import fr.papote.app.ui.extras.BuiltinStickers
import fr.papote.app.ui.extras.drawBuiltinSticker
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.roundToInt

private data class Item(val kind: String, val text: String = "", val color: Int = 0xFFFFFFFF.toInt(), val key: String = "", val x: Float = 0.5f, val y: Float = 0.5f, val s: Float = 1f)
private data class Line(val color: Int, val points: List<Offset>)

private val Filters = listOf("normal" to "Normal", "pastel" to "Pastel", "retro" to tr("Rétro"), "nb" to "N&B")
private val Crops = listOf("orig" to "Original", "square" to tr("Carré"), "portrait" to "4:5", "wide" to "16:9")
private val TextColors = listOf(0xFFFFFFFF, 0xFF2E2442, 0xFFFF7A93, 0xFFFFD66B, 0xFF4CC38A, 0xFF4A9BEF).map { it.toInt() }

private fun matrixOf(filter: String): ColorMatrix? = when (filter) {
    "pastel" -> ColorMatrix().apply {
        setSaturation(0.75f)
        postConcat(ColorMatrix().apply { setScale(1.06f, 1.06f, 1.06f, 1f) })
    }
    "retro" -> ColorMatrix(
        floatArrayOf(
            0.75f, 0.35f, 0.08f, 0f, 0f,
            0.16f, 0.82f, 0.07f, 0f, 0f,
            0.12f, 0.24f, 0.6f, 0f, 0f,
            0f, 0f, 0f, 1f, 0f,
        ),
    )
    "nb" -> ColorMatrix().apply { setSaturation(0f) }
    else -> null
}

private fun cropRect(bmp: Bitmap, crop: String): RectF {
    val w = bmp.width.toFloat()
    val h = bmp.height.toFloat()
    val ratio = when (crop) {
        "square" -> 1f
        "portrait" -> 0.8f
        "wide" -> 16f / 9f
        else -> return RectF(0f, 0f, w, h)
    }
    return if (w / h > ratio) RectF((w - h * ratio) / 2, 0f, (w + h * ratio) / 2, h) else RectF(0f, (h - w / ratio) / 2, w, (h + w / ratio) / 2)
}

/** Draws the photo with its filter, lines, texts and stickers into [canvas] of size [w]×[h]. */
private fun renderPhoto(canvas: android.graphics.Canvas, w: Float, h: Float, bmp: Bitmap, crop: String, filter: String, lines: List<Line>, items: List<Item>, stickerBitmaps: Map<String, Bitmap>) {
    val src = cropRect(bmp, crop)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply { matrixOf(filter)?.let { colorFilter = ColorMatrixColorFilter(it) } }
    canvas.drawBitmap(bmp, android.graphics.Rect(src.left.toInt(), src.top.toInt(), src.right.toInt(), src.bottom.toInt()), RectF(0f, 0f, w, h), paint)
    val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = w * 0.012f
    }
    for (l in lines) {
        if (l.points.isEmpty()) continue
        ink.color = l.color
        val p = android.graphics.Path()
        p.moveTo(l.points[0].x * w, l.points[0].y * h)
        l.points.drop(1).forEach { p.lineTo(it.x * w, it.y * h) }
        canvas.drawPath(p, ink)
    }
    for (it in items) {
        val size = w * 0.08f * it.s
        if (it.kind == "text") {
            val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                textSize = size
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                textAlign = Paint.Align.CENTER
            }
            tp.style = Paint.Style.STROKE
            tp.strokeWidth = size * 0.18f
            tp.color = if (it.color == 0xFFFFFFFF.toInt()) 0xFF2E2442.toInt() else 0xFFFFFFFF.toInt()
            canvas.drawText(it.text, it.x * w, it.y * h + size / 3, tp)
            tp.style = Paint.Style.FILL
            tp.color = it.color
            canvas.drawText(it.text, it.x * w, it.y * h + size / 3, tp)
        } else stickerBitmaps[it.key]?.let { sb ->
            canvas.drawBitmap(sb, null, RectF(it.x * w - size, it.y * h - size, it.x * w + size, it.y * h + size), Paint(Paint.FILTER_BITMAP_FLAG))
        }
    }
}

/** Built-in stickers rasterised once, so the same drawing code renders on screen and in the export. */
private fun stickerBitmap(key: String): Bitmap {
    val bmp = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
    val canvas = androidx.compose.ui.graphics.Canvas(bmp.asImageBitmap())
    androidx.compose.ui.graphics.drawscope.CanvasDrawScope().draw(
        androidx.compose.ui.unit.Density(1f),
        androidx.compose.ui.unit.LayoutDirection.Ltr,
        canvas,
        androidx.compose.ui.geometry.Size(256f, 256f),
    ) { drawBuiltinSticker(key) }
    return bmp
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotoEditScreen(groupId: Long, story: Boolean, onDone: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bmp by remember { mutableStateOf<Bitmap?>(null) }
    var filter by remember { mutableStateOf("normal") }
    var crop by remember { mutableStateOf("orig") }
    var drawing by remember { mutableStateOf(false) }
    var ink by remember { mutableIntStateOf(0xFFFFFFFF.toInt()) }
    var ephemeral by remember { mutableStateOf(false) }
    var caption by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var textSheet by remember { mutableStateOf(false) }
    var stickerSheet by remember { mutableStateOf(false) }
    var selected by remember { mutableIntStateOf(-1) }
    val items = remember { mutableStateListOf<Item>() }
    val lines = remember { mutableStateListOf<Line>() }
    val stickers = remember { HashMap<String, Bitmap>() }

    LaunchedEffect(Unit) {
        val uri = PendingPhoto.uri
        PendingPhoto.uri = null
        if (uri == null) return@LaunchedEffect onDone()
        try {
            val img = prepareImage(context, uri)
            bmp = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(img.bytes, 0, img.bytes.size) }
        } catch (e: Exception) {
            error = tr("Cette image n’a pas pu être lue")
        }
    }

    fun send() {
        val b = bmp ?: return
        sending = true
        scope.launch {
            try {
                val (bytes, w, h) = withContext(Dispatchers.Default) {
                    val r = cropRect(b, crop)
                    val scale = (1600f / maxOf(r.width(), r.height())).coerceAtMost(1f)
                    val w = (r.width() * scale).roundToInt()
                    val h = (r.height() * scale).roundToInt()
                    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    renderPhoto(android.graphics.Canvas(out), w.toFloat(), h.toFloat(), b, crop, filter, lines, items, stickers)
                    val stream = ByteArrayOutputStream()
                    out.compress(Bitmap.CompressFormat.JPEG, 88, stream)
                    Triple(stream.toByteArray(), w, h)
                }
                if (story) app.api.postStory(groupId, bytes, caption.trim())
                else {
                    val fields = mutableMapOf("width" to "$w", "height" to "$h")
                    if (caption.isNotBlank()) fields["caption"] = caption.trim()
                    if (ephemeral) fields["ephemeral"] = "1"
                    app.api.sendMedia(groupId, "photo", bytes, "image/jpeg", "photo.jpg", fields)
                }
                onDone()
            } catch (e: ApiException) {
                error = e.message
                sending = false
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SquareIconButton(PIcons.Close, tr("Annuler"), onDone)
            Column(Modifier.weight(1f)) {
                Text(if (story) tr("Ma story") else tr("Décorer la photo"), style = MaterialTheme.typography.headlineSmall, color = c.ink)
                Text(if (story) tr("Visible 24 h par le groupe") else "Texte, stickers, dessin, filtres", style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
        }
        val b = bmp
        if (b != null) {
            val r = cropRect(b, crop)
            Box(
                Modifier.fillMaxWidth().aspectRatio(r.width() / r.height()).clip(pShape(24.dp))
                    .semantics { contentDescription = tr("Photo à décorer") }
                    .pointerInput(drawing, ink) {
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            val w = size.width.toFloat()
                            val h = size.height.toFloat()
                            fun norm(o: Offset) = Offset((o.x / w).coerceIn(0f, 1f), (o.y / h).coerceIn(0f, 1f))
                            val start = norm(down.position)
                            if (drawing) lines += Line(ink, listOf(start))
                            else selected = items.indexOfLast { abs(it.x - start.x) < 0.1f * it.s && abs(it.y - start.y) < 0.08f * it.s * w / h }
                            val grab = items.getOrNull(selected)?.let { Offset(start.x - it.x, start.y - it.y) }
                            while (true) {
                                val ev = awaitPointerEvent()
                                val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                                if (!ch.pressed) break
                                if (ch.positionChange() != Offset.Zero) {
                                    val p = norm(ch.position)
                                    if (drawing) lines[lines.lastIndex] = lines.last().copy(points = lines.last().points + p)
                                    else if (grab != null && selected >= 0) items[selected] = items[selected].copy(x = p.x - grab.x, y = p.y - grab.y)
                                    ch.consume()
                                }
                            }
                        }
                    },
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    drawIntoCanvas { renderPhoto(it.nativeCanvas, size.width, size.height, b, crop, filter, lines, items, stickers) }
                    items.getOrNull(selected)?.let { s ->
                        val sz = size.width * 0.08f * s.s
                        drawRect(Color(0xFF6A47D6), Offset(s.x * size.width - sz * 1.2f, s.y * size.height - sz * 1.1f), androidx.compose.ui.geometry.Size(sz * 2.4f, sz * 2.2f), style = androidx.compose.ui.graphics.drawscope.Stroke(4f))
                    }
                }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            @Composable
            fun Tool(icon: ImageVector, short: String, label: String, on: Boolean = false, onClick: () -> Unit) = Column(
                Modifier.clip(pShape(16.dp)).background(if (on) c.soft else c.card).border(2.dp, if (on) c.primary else c.line, pShape(16.dp))
                    .clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label }.padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(icon, null, tint = c.ink)
                Text(short, style = MaterialTheme.typography.labelMedium, color = c.ink)
            }
            Tool(PIcons.TextTool, "Aa", tr("Ajouter du texte")) { textSheet = true }
            Tool(PIcons.Stamp, "Sticker", tr("Ajouter un sticker")) { stickerSheet = true }
            Tool(PIcons.Pencil, tr("Dessin"), tr("Dessiner dessus"), drawing) {
                drawing = !drawing
                selected = -1
            }
            Tool(PIcons.Crop, Crops.first { it.first == crop }.second, tr("Recadrer")) { crop = Crops[(Crops.indexOfFirst { it.first == crop } + 1) % Crops.size].first }
        }
        if (drawing) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            for (col in TextColors) Box(
                Modifier.size(34.dp).clip(CircleShape).border(3.dp, if (col == ink) c.primary else c.line, CircleShape).padding(4.dp).clip(CircleShape).background(Color(col))
                    .clickable(role = Role.RadioButton) { ink = col },
            )
            SquareIconButton(PIcons.Undo, tr("Annuler le dernier trait"), { lines.removeLastOrNull() })
        }
        if (selected >= 0 && !drawing) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SquareIconButton(PIcons.Close, tr("Plus petit"), { items[selected] = items[selected].let { it.copy(s = (it.s - 0.2f).coerceAtLeast(0.4f)) } })
            SquareIconButton(PIcons.Plus, tr("Plus grand"), { items[selected] = items[selected].let { it.copy(s = (it.s + 0.2f).coerceAtMost(4f)) } })
            SquareIconButton(PIcons.Trash, tr("Retirer"), {
                items.removeAt(selected)
                selected = -1
            })
        }
        Segmented(Filters, filter, { filter = it }, Modifier.fillMaxWidth())
        PapoteField(caption, { caption = it.take(140) }, Modifier.fillMaxWidth(), placeholder = if (story) tr("Un petit mot sur ta story") else tr("Ajouter une légende"), label = tr("Légende"))
        ErrorText(error)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!story) Row(
                Modifier.clip(pShape(20.dp)).background(if (ephemeral) Color(0xFFFFE0E8) else c.card)
                    .border(2.dp, if (ephemeral) Color(0xFFE0456A) else c.line, pShape(20.dp))
                    .clickable(role = Role.Switch) { ephemeral = !ephemeral }.padding(horizontal = 14.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(PIcons.Timer, null, tint = if (ephemeral) Color(0xFFA3204A) else c.ink, modifier = Modifier.size(18.dp))
                Text(if (ephemeral) tr("Disparaît en 24 h") else tr("Garder"), style = MaterialTheme.typography.labelLarge, color = if (ephemeral) Color(0xFFA3204A) else c.ink)
            }
            PrimaryButton(if (story) tr("Publier") else tr("Envoyer"), ::send, Modifier.weight(1f), enabled = bmp != null, loading = sending, icon = PIcons.Send)
        }
    }

    if (textSheet) ModalBottomSheet({ textSheet = false }, containerColor = c.card) {
        var text by remember { mutableStateOf("") }
        var color by remember { mutableIntStateOf(TextColors[0]) }
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(tr("Ajouter du texte"), style = MaterialTheme.typography.titleLarge, color = c.ink)
            PapoteField(text, { text = it.take(60) }, Modifier.fillMaxWidth(), placeholder = tr("Enfin la mer !"), label = tr("Texte"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (col in TextColors) Box(
                    Modifier.size(34.dp).clip(CircleShape).border(3.dp, if (col == color) c.primary else c.line, CircleShape).padding(4.dp).clip(CircleShape).background(Color(col))
                        .clickable(role = Role.RadioButton) { color = col },
                )
            }
            PrimaryButton(tr("Ajouter"), {
                if (text.isNotBlank()) {
                    items += Item("text", text = text.trim(), color = color)
                    selected = items.lastIndex
                    drawing = false
                }
                textSheet = false
            }, Modifier.fillMaxWidth())
        }
    }
    if (stickerSheet) ModalBottomSheet({ stickerSheet = false }, containerColor = c.card) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(tr("Ajouter un sticker"), style = MaterialTheme.typography.titleLarge, color = c.ink)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (st in BuiltinStickers) Box(
                    Modifier.size(72.dp).clip(pShape(14.dp)).background(c.field).clickable(role = Role.Button) {
                        stickers.getOrPut(st.key) { stickerBitmap(st.key) }
                        items += Item("sticker", key = st.key, s = 1.2f)
                        selected = items.lastIndex
                        drawing = false
                        stickerSheet = false
                    },
                    contentAlignment = Alignment.Center,
                ) { BuiltinStickerView(st.key, 56.dp) }
            }
        }
    }
}
