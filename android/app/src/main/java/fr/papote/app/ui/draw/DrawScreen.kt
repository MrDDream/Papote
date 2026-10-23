package fr.papote.app.ui.draw

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.os.Build
import android.provider.MediaStore
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Event
import fr.papote.app.data.LiveSession
import fr.papote.app.data.Message
import fr.papote.app.data.PapoteJson
import fr.papote.app.data.jsonOf
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.Segmented
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.dayLabel
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.timeOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import java.io.ByteArrayOutputStream
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

enum class Tool(val label: String, val wire: String) {
    Brush("Pinceau", "pen"), Marker("Feutre", "marker"), Eraser("Gomme", "eraser"), Bucket("Pot de peinture", "fill"), Stamp("Tampons", "stamp")
}

/** Everything is stored in 0..1 coordinates so the same ops render on screen and at export size. */
sealed interface Op {
    data class Stroke(val points: List<Offset>, val color: Int, val width: Float, val tool: Tool) : Op
    data class Stamp(val at: Offset, val color: Int, val size: Float) : Op
    data class Fill(val color: Int) : Op
}

val Inks = listOf(
    0xFF2E2442 to "Encre", 0xFFFF7A93 to "Rose bonbon", 0xFFFF9F43 to "Mandarine", 0xFFFFD66B to "Citron",
    0xFF4CC38A to "Menthe", 0xFF4A9BEF to "Ciel", 0xFF8B6CF0 to "Lilas", 0xFFFFFFFF to "Blanc",
)
private val Sizes = listOf(0.008f, 0.016f, 0.03f, 0.05f)
private const val PAPER = 0xFFFFFDF6.toInt()
const val EXPORT_SIZE = 1024

/** Draws [ops]; [base] (a picture to draw over) replaces the paper unless the bucket filled it. */
fun renderDrawing(canvas: android.graphics.Canvas, w: Float, h: Float, ops: List<Op>, base: Bitmap? = null) {
    val fill = ops.filterIsInstance<Op.Fill>().lastOrNull()
    canvas.drawColor(fill?.color ?: PAPER)
    if (fill == null && base != null) {
        val s = max(w / base.width, h / base.height)
        val bw = base.width * s
        val bh = base.height * s
        canvas.drawBitmap(base, null, android.graphics.RectF((w - bw) / 2, (h - bh) / 2, (w + bw) / 2, (h + bh) / 2), Paint(Paint.FILTER_BITMAP_FLAG))
    }
    // Strokes live in their own layer so the eraser clears them without punching through the paper colour.
    val layer = canvas.saveLayer(0f, 0f, w, h, null)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    for (op in ops) when (op) {
        is Op.Stroke -> {
            if (op.points.isEmpty()) continue
            paint.reset()
            paint.isAntiAlias = true
            paint.style = Paint.Style.STROKE
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            paint.strokeWidth = op.width * w
            paint.color = op.color
            when (op.tool) {
                Tool.Marker -> {
                    paint.alpha = 140
                    paint.strokeWidth = op.width * w * 1.6f
                }
                Tool.Eraser -> {
                    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
                    paint.strokeWidth = op.width * w * 2f
                }
                else -> Unit
            }
            val pts = op.points
            if (pts.size == 1) {
                canvas.drawPoint(pts[0].x * w, pts[0].y * h, paint)
            } else {
                val path = android.graphics.Path()
                path.moveTo(pts[0].x * w, pts[0].y * h)
                for (i in 1 until pts.size) {
                    val p = pts[i - 1]
                    val q = pts[i]
                    // Quadratic through midpoints: smooth curves from jittery touch input.
                    path.quadTo(p.x * w, p.y * h, (p.x + q.x) / 2 * w, (p.y + q.y) / 2 * h)
                }
                path.lineTo(pts.last().x * w, pts.last().y * h)
                canvas.drawPath(path, paint)
            }
        }
        is Op.Stamp -> {
            paint.reset()
            paint.isAntiAlias = true
            val r = op.size * w
            val star = android.graphics.Path()
            for (i in 0 until 10) {
                val rad = if (i % 2 == 0) r else r * 0.45f
                val a = Math.PI / 5 * i - Math.PI / 2
                val x = op.at.x * w + (rad * cos(a)).toFloat()
                val y = op.at.y * h + (rad * sin(a)).toFloat()
                if (i == 0) star.moveTo(x, y) else star.lineTo(x, y)
            }
            star.close()
            paint.style = Paint.Style.FILL
            paint.color = op.color
            canvas.drawPath(star, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeJoin = Paint.Join.ROUND
            paint.strokeWidth = r * 0.12f
            paint.color = 0xFF2E2442.toInt()
            canvas.drawPath(star, paint)
        }
        is Op.Fill -> Unit
    }
    canvas.restoreToCount(layer)
}

fun exportPng(ops: List<Op>, base: Bitmap? = null): ByteArray {
    val bmp = Bitmap.createBitmap(EXPORT_SIZE, EXPORT_SIZE, Bitmap.Config.ARGB_8888)
    renderDrawing(android.graphics.Canvas(bmp), EXPORT_SIZE.toFloat(), EXPORT_SIZE.toFloat(), ops, base)
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
    bmp.recycle()
    return out.toByteArray()
}

// --- wire format shared with the server and the web app: {t, c, w, p: [x, y, …]} in 0..1000 ---

private fun hex(color: Int) = String.format("#%06X", color and 0xFFFFFF)
private fun parseColor(s: String?) = runCatching { android.graphics.Color.parseColor(s) }.getOrDefault(0xFF2E2442.toInt())
private fun k(v: Float) = (v * 1000).roundToInt()

fun Op.toWire(fromPoint: Int = 0): JsonObject = when (this) {
    is Op.Fill -> jsonOf("t" to "fill", "c" to hex(color), "w" to 1, "p" to JsonArray(listOf(JsonPrimitive(0), JsonPrimitive(0))))
    is Op.Stamp -> jsonOf("t" to "stamp", "c" to hex(color), "w" to k(size), "p" to JsonArray(listOf(JsonPrimitive(k(at.x)), JsonPrimitive(k(at.y)))))
    is Op.Stroke -> jsonOf(
        "t" to tool.wire,
        "c" to hex(color),
        "w" to max(1, k(width)),
        "p" to JsonArray(points.drop(fromPoint).flatMap { listOf(JsonPrimitive(k(it.x)), JsonPrimitive(k(it.y))) }),
    )
}

fun pointsOf(o: JsonObject): List<Offset> {
    val p = (o["p"] as? JsonArray)?.map { it.jsonPrimitive.int } ?: emptyList()
    return (0 until p.size / 2).map { Offset(p[2 * it] / 1000f, p[2 * it + 1] / 1000f) }
}

fun opFromWire(o: JsonObject): Op {
    val color = parseColor(o["c"]?.jsonPrimitive?.contentOrNull)
    val w = (o["w"]?.jsonPrimitive?.int ?: 8) / 1000f
    return when (val t = o["t"]?.jsonPrimitive?.contentOrNull) {
        "fill" -> Op.Fill(color)
        "stamp" -> Op.Stamp(pointsOf(o).firstOrNull() ?: Offset(0.5f, 0.5f), color, w)
        else -> Op.Stroke(pointsOf(o), color, w, Tool.entries.firstOrNull { it.wire == t } ?: Tool.Brush)
    }
}

// --- the canvas and its tools ------------------------------------------------------------------------

/** Keeps the ops of a drawing, local and remote (key "userId:strokeKey"), in drawing order. */
class BoardModel {
    val entries = mutableStateListOf<Pair<String, Op>>()
    private val undone = mutableListOf<Pair<String, Op>>()
    val ops: List<Op> get() = entries.map { it.second }
    private var n = 0

    fun newKey() = "me:" + System.currentTimeMillis().toString(36) + (n++).toString(36)

    fun commit(key: String, op: Op) {
        val i = entries.indexOfFirst { it.first == key }
        if (i >= 0) entries[i] = key to op else entries += key to op
        undone.clear()
    }

    fun undoMine(): String? {
        val i = entries.indexOfLast { it.first.startsWith("me:") }
        if (i < 0) return null
        val e = entries.removeAt(i)
        undone += e
        return e.first
    }

    fun redo() {
        undone.removeLastOrNull()?.let { entries += it }
    }

    val canUndo get() = entries.any { it.first.startsWith("me:") }
    val canRedo get() = undone.isNotEmpty()

    fun applyRemote(key: String, data: JsonObject) {
        if (data["clear"]?.jsonPrimitive?.booleanOrNull == true) return entries.clear()
        if (data["undo"]?.jsonPrimitive?.booleanOrNull == true) {
            entries.removeAll { it.first == key }
            return
        }
        val i = entries.indexOfFirst { it.first == key }
        val existing = entries.getOrNull(i)?.second
        if (existing is Op.Stroke) entries[i] = key to existing.copy(points = existing.points + pointsOf(data))
        else if (i < 0) entries += key to opFromWire(data)
    }

    fun reset(list: List<JsonObject>) {
        entries.clear()
        list.forEachIndexed { i, s -> entries += "${s["u"]?.jsonPrimitive?.contentOrNull ?: "0"}:init$i" to opFromWire(s) }
    }
}

/** Sends local strokes over the WebSocket in small pieces while they are drawn. */
class LiveSender(private val send: (JsonObject) -> Unit, private val envelope: () -> Map<String, Any?>) {
    private val sent = HashMap<String, Int>()
    private var lastAt = 0L

    fun onLive(key: String, op: Op.Stroke, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastAt < 50) return
        lastAt = now
        val from = sent[key] ?: 0
        if (from >= op.points.size && from > 0) return
        piece(key, op.toWire(from))
        sent[key] = op.points.size
    }

    fun onCommit(key: String, op: Op) {
        if (op is Op.Stroke) onLive(key, op, force = true) else piece(key, op.toWire())
    }

    fun undo(key: String) = piece(key, jsonOf("undo" to true))

    private fun piece(key: String, wire: JsonObject) {
        val body = LinkedHashMap<String, kotlinx.serialization.json.JsonElement>()
        for ((k, v) in envelope()) body[k] = when (v) {
            is Number -> JsonPrimitive(v)
            else -> JsonPrimitive(v?.toString())
        }
        body["k"] = JsonPrimitive(key.removePrefix("me:"))
        body.putAll(wire)
        send(JsonObject(body))
    }
}

@Composable
fun DrawBoard(
    model: BoardModel,
    base: Bitmap?,
    tool: Tool,
    ink: Int,
    thickness: Int,
    editable: Boolean = true,
    onLive: (String, Op.Stroke) -> Unit = { _, _ -> },
    onCommit: (String, Op) -> Unit = { _, _ -> },
) {
    val c = Papote.colors
    var live by remember { mutableStateOf<Pair<String, Op.Stroke>?>(null) }
    Box(
        Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(24.dp)).border(3.dp, c.line, RoundedCornerShape(24.dp))
            .semantics { contentDescription = "Zone de dessin" }
            .then(
                if (!editable) Modifier else Modifier.pointerInput(tool, ink, thickness) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        val w = this.size.width.toFloat()
                        val h = this.size.height.toFloat()
                        fun norm(o: Offset) = Offset((o.x / w).coerceIn(0f, 1f), (o.y / h).coerceIn(0f, 1f))
                        val key = model.newKey()
                        when (tool) {
                            Tool.Stamp -> Op.Stamp(norm(down.position), ink, Sizes[thickness] * 2.4f + 0.02f).let {
                                model.commit(key, it)
                                onCommit(key, it)
                            }
                            Tool.Bucket -> Op.Fill(ink).let {
                                model.commit(key, it)
                                onCommit(key, it)
                            }
                            else -> {
                                var stroke = Op.Stroke(listOf(norm(down.position)), ink, Sizes[thickness], tool)
                                live = key to stroke
                                onLive(key, stroke)
                                while (true) {
                                    val event = awaitPointerEvent()
                                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                    if (!change.pressed) break
                                    if (change.positionChange() != Offset.Zero) {
                                        stroke = stroke.copy(points = stroke.points + norm(change.position))
                                        live = key to stroke
                                        onLive(key, stroke)
                                        change.consume()
                                    }
                                }
                                live = null
                                model.commit(key, stroke)
                                onCommit(key, stroke)
                            }
                        }
                    }
                },
            ),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val current = live?.let { model.ops + it.second } ?: model.ops
            drawIntoCanvas { renderDrawing(it.nativeCanvas, size.width, size.height, current, base) }
        }
    }
}

@Composable
fun ToolPanel(tool: Tool, onTool: (Tool) -> Unit, ink: Int, onInk: (Int) -> Unit, thickness: Int, onThickness: (Int) -> Unit, tools: Boolean = true) {
    val c = Papote.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.card).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (tools) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            for (t in Tool.entries) {
                val on = t == tool
                val icon = when (t) {
                    Tool.Brush -> PIcons.Brush
                    Tool.Marker -> PIcons.Marker
                    Tool.Eraser -> PIcons.Eraser
                    Tool.Bucket -> PIcons.Bucket
                    Tool.Stamp -> PIcons.Stamp
                }
                Box(
                    Modifier.size(56.dp, 48.dp).clip(RoundedCornerShape(16.dp)).background(if (on) c.primary else c.soft)
                        .clickable(role = Role.RadioButton) { onTool(t) }
                        .semantics {
                            contentDescription = t.label
                            stateDescription = if (on) "choisi" else ""
                        },
                    contentAlignment = Alignment.Center,
                ) { Icon(icon, null, tint = if (on) c.onPrimary else c.ink, modifier = Modifier.size(24.dp)) }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            for ((argb, label) in Inks) {
                val on = argb.toInt() == ink
                Box(
                    Modifier.size(34.dp).clip(CircleShape).border(3.dp, if (on) c.primary else c.line, CircleShape).padding(4.dp)
                        .clip(CircleShape).background(Color(argb))
                        .clickable(role = Role.RadioButton) { onInk(argb.toInt()) }
                        .semantics {
                            contentDescription = label
                            stateDescription = if (on) "choisie" else ""
                        },
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Épaisseur", style = MaterialTheme.typography.labelLarge, color = c.ink, modifier = Modifier.weight(1f))
            Sizes.forEachIndexed { i, _ ->
                val on = i == thickness
                Box(
                    Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(if (on) c.soft else c.field)
                        .border(2.dp, if (on) c.primary else c.line, RoundedCornerShape(14.dp))
                        .clickable(role = Role.RadioButton) { onThickness(i) }
                        .semantics {
                            contentDescription = "Taille ${i + 1}"
                            stateDescription = if (on) "choisie" else ""
                        },
                    contentAlignment = Alignment.Center,
                ) { Box(Modifier.size((6 + i * 5).dp).clip(CircleShape).background(c.ink)) }
            }
        }
    }
}

suspend fun loadBitmap(path: String): Bitmap? = runCatching {
    val bytes = PapoteApp.instance.api.bytes(path)
    withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
}.getOrNull()

// --- "Un petit dessin" (optionally over a picture of the group) --------------------------------------

@Composable
fun DrawScreen(groupId: Long, onClose: () -> Unit, baseMessageId: Long? = null, baseUrl: String? = null) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    val model = remember { BoardModel() }
    var tool by remember { mutableStateOf(Tool.Brush) }
    var ink by remember { mutableIntStateOf(Inks[0].first.toInt()) }
    var thickness by remember { mutableIntStateOf(1) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var groupName by remember { mutableStateOf<String?>(null) }
    var base by remember { mutableStateOf<Bitmap?>(null) }
    var lastTyping by remember { mutableStateOf(0L) }

    LaunchedEffect(groupId) {
        groupName = runCatching { app.api.group(groupId).name }.getOrNull()
        if (baseUrl != null) base = loadBitmap(baseUrl) ?: run {
            error = "Impossible de charger l’image de fond"
            null
        }
    }

    fun send() {
        sending = true
        error = null
        scope.launch {
            try {
                val ops = model.ops
                val png = withContext(Dispatchers.Default) { exportPng(ops, base) }
                val fields = mutableMapOf("width" to "$EXPORT_SIZE", "height" to "$EXPORT_SIZE", "ops" to PapoteJson.encodeToString(ops.map { it.toWire() }))
                baseMessageId?.let { fields["base"] = "$it" }
                app.api.sendMedia(groupId, "drawing", png, "image/png", "dessin.png", fields)
                onClose()
            } catch (e: ApiException) {
                error = e.message
            } finally {
                sending = false
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SquareIconButton(PIcons.Close, "Fermer le dessin", onClose)
            Column(Modifier.weight(1f)) {
                Text(if (baseUrl != null) "Dessiner dessus" else "Un petit dessin", style = MaterialTheme.typography.headlineSmall, color = c.ink)
                Text(groupName?.let { "pour $it" } ?: "", style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
            SquareIconButton(PIcons.Undo, "Annuler le dernier trait", { model.undoMine() }, enabled = model.canUndo)
            SquareIconButton(PIcons.Redo, "Rétablir", { model.redo() }, enabled = model.canRedo)
        }
        DrawBoard(model, base, tool, ink, thickness, onLive = { _, _ ->
            val now = System.currentTimeMillis()
            if (now - lastTyping > 3000) {
                lastTyping = now
                app.realtime.sendTyping(groupId, "draw")
            }
        })
        ToolPanel(tool, { tool = it }, ink, { ink = it }, thickness, { thickness = it })
        ErrorText(error)
        PrimaryButton("Envoyer le dessin", ::send, Modifier.fillMaxWidth(), enabled = model.entries.isNotEmpty(), loading = sending, icon = PIcons.Send)
    }
}

// --- "Toile commune": everyone draws on the same canvas, live ---------------------------------------

@Composable
fun LiveDrawScreen(groupId: Long, onClose: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    val model = remember { BoardModel() }
    var session by remember { mutableStateOf<LiveSession?>(null) }
    var artists by remember { mutableStateOf(listOf<Long>()) }
    var members by remember { mutableStateOf(mapOf<Long, fr.papote.app.data.Member>()) }
    var base by remember { mutableStateOf<Bitmap?>(null) }
    var tool by remember { mutableStateOf(Tool.Brush) }
    var ink by remember { mutableIntStateOf(Inks[0].first.toInt()) }
    var thickness by remember { mutableIntStateOf(1) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val sender = remember { LiveSender({ app.realtime.sendLive(groupId, "draw", it) }, { mapOf("sid" to session?.id) }) }

    suspend fun load() {
        try {
            members = app.api.members(groupId).associateBy { it.id }
            val s = app.api.liveDraw(groupId) ?: app.api.startLiveDraw(groupId)
            session = s
            artists = s.artists
            s.base?.let { base = loadBitmap(it.url) }
            model.reset(s.strokes)
        } catch (e: ApiException) {
            error = e.message
        }
    }

    LaunchedEffect(groupId) {
        load()
        app.realtime.events.collect { e ->
            when (e) {
                is Event.LiveStroke -> if (e.groupId == groupId && e.channel == "draw" && e.data["sid"]?.jsonPrimitive?.contentOrNull == session?.id) {
                    model.applyRemote("${e.userId}:${e.data["k"]?.jsonPrimitive?.contentOrNull}", e.data)
                    if (e.userId !in artists) artists = artists + e.userId
                }
                is Event.LiveDraw -> if (e.groupId == groupId && e.session == null && !sending) {
                    error = "La toile a été envoyée dans le groupe"
                    kotlinx.coroutines.delay(1200)
                    onClose()
                }
                Event.Reconnected -> load()
                else -> Unit
            }
        }
    }

    fun send() {
        sending = true
        scope.launch {
            try {
                val ops = model.ops
                val png = withContext(Dispatchers.Default) { exportPng(ops, base) }
                val fields = mutableMapOf(
                    "width" to "$EXPORT_SIZE", "height" to "$EXPORT_SIZE", "live" to "1",
                    "ops" to PapoteJson.encodeToString(ops.map { it.toWire() }),
                    "artists" to PapoteJson.encodeToString(artists),
                )
                session?.base?.let { fields["base"] = "${it.messageId}" }
                app.api.sendMedia(groupId, "drawing", png, "image/png", "toile.png", fields)
                onClose()
            } catch (e: ApiException) {
                error = e.message
                sending = false
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SquareIconButton(PIcons.Back, "Retour au groupe", onClose)
            Column(Modifier.weight(1f)) {
                Text("Toile commune", style = MaterialTheme.typography.headlineSmall, color = c.ink)
                Text("En direct · ${artists.size} artiste${if (artists.size > 1) "s" else ""}", style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
            SquareIconButton(PIcons.Undo, "Annuler mon dernier trait", { model.undoMine()?.let(sender::undo) }, enabled = model.canUndo)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            artists.forEach { id -> members[id]?.let { Avatar(it.name, it.color, it.photo, size = 32.dp, initialOnly = true) } }
        }
        DrawBoard(model, base, tool, ink, thickness, onLive = { k, s -> if (session != null) sender.onLive(k, s) }, onCommit = { k, op -> if (session != null) sender.onCommit(k, op) })
        ToolPanel(tool, { tool = it }, ink, { ink = it }, thickness, { thickness = it })
        ErrorText(error)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            SecondaryButton("Arrêter", {
                scope.launch {
                    runCatching { app.api.endLiveDraw(groupId) }
                    onClose()
                }
            }, Modifier.weight(1f))
            PrimaryButton("Envoyer", ::send, Modifier.weight(1f), loading = sending, icon = PIcons.Send)
        }
    }
}

// --- a drawing, its timelapse, and what can be done with it ----------------------------------------

@Composable
fun DrawingScreen(groupId: Long, messageId: Long, onBack: () -> Unit, onDrawOver: (Long, String) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<Message?>(null) }
    var author by remember { mutableStateOf<fr.papote.app.data.Member?>(null) }
    var ops by remember { mutableStateOf<List<Op>?>(null) }
    var image by remember { mutableStateOf<Bitmap?>(null) }
    var base by remember { mutableStateOf<Bitmap?>(null) }
    var progress by remember { mutableFloatStateOf(1f) }
    var speed by remember { mutableIntStateOf(1) }
    var run by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var stickerDone by remember { mutableStateOf(false) }

    LaunchedEffect(messageId) {
        try {
            val m = app.api.messagesAround(groupId, messageId).firstOrNull { it.id == messageId }
            if (m == null || m.deleted) throw ApiException(404, "gone", "Ce dessin a été supprimé")
            message = m
            author = app.api.members(groupId).firstOrNull { it.id == m.authorId }
            m.metaLong("base")?.let { b -> app.api.messagesAround(groupId, b).firstOrNull { it.id == b }?.media?.url?.let { base = loadBitmap(it) } }
            m.metaString("opsId")?.let { id ->
                val json = PapoteJson.parseToJsonElement(app.api.mediaBytes("/api/media/$id")).jsonObject
                ops = json["strokes"]!!.jsonArray.map { opFromWire(it.jsonObject) }
            }
            if (ops == null) image = m.media?.url?.let { loadBitmap(it) }
            run++
        } catch (e: ApiException) {
            error = e.message
        }
    }
    LaunchedEffect(run, speed) {
        if (ops == null || run == 0) return@LaunchedEffect
        val length = 6000f / speed
        val start = withFrameMillis { it }
        progress = 0f
        while (progress < 1f) withFrameMillis { progress = ((it - start) / length).coerceAtMost(1f) }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SquareIconButton(PIcons.Back, "Retour", onBack)
            author?.let { Avatar(it.name, it.color, it.photo, size = 40.dp, initialOnly = true) }
            Column(Modifier.weight(1f)) {
                Text(if (message?.metaBool("live") == true) "Toile commune" else "Dessin", style = MaterialTheme.typography.headlineSmall, color = c.ink)
                message?.let { m ->
                    Text(
                        "${author?.name ?: "Ancien membre"} · ${dayLabel(m.createdAt).lowercase()} ${timeOf(m.createdAt)}" + (m.metaLong("strokes")?.let { " · $it traits" } ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                        color = c.muted,
                    )
                }
            }
        }
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(24.dp)).semantics { contentDescription = "Dessin" }) {
            Canvas(Modifier.fillMaxSize()) {
                drawIntoCanvas { cv ->
                    val o = ops
                    if (o != null) {
                        val total = o.sumOf { if (it is Op.Stroke) it.points.size else 1 }
                        var budget = (total * progress).roundToInt()
                        val partial = mutableListOf<Op>()
                        for (op in o) {
                            if (budget <= 0) break
                            if (op is Op.Stroke) {
                                partial += op.copy(points = op.points.take(budget))
                                budget -= op.points.size
                            } else {
                                partial += op
                                budget--
                            }
                        }
                        renderDrawing(cv.nativeCanvas, size.width, size.height, partial, base)
                    } else image?.let { cv.nativeCanvas.drawBitmap(it, null, android.graphics.RectF(0f, 0f, size.width, size.height), null) }
                }
            }
        }
        if (ops != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(6.dp)).background(c.soft)) {
                    Box(Modifier.fillMaxWidth(progress).height(10.dp).clip(RoundedCornerShape(6.dp)).background(c.primary))
                }
                SquareIconButton(PIcons.Play, "Rejouer le timelapse", { run++ })
                Segmented(listOf(1 to "×1", 4 to "×4"), speed, { speed = it }, Modifier.size(120.dp, 44.dp))
            }
        }
        message?.let { m ->
            SecondaryButton(if (stickerDone) "Sticker créé !" else "En faire un sticker", {
                if (!stickerDone) scope.launch {
                    try {
                        app.api.makeSticker(groupId, m.id)
                        stickerDone = true
                    } catch (e: ApiException) {
                        error = e.message
                    }
                }
            }, Modifier.fillMaxWidth(), icon = PIcons.Stamp)
            SecondaryButton("Dessiner dessus", { m.media?.url?.let { onDrawOver(m.id, it) } }, Modifier.fillMaxWidth(), icon = PIcons.Pencil)
            SecondaryButton("Télécharger", {
                scope.launch {
                    error = saveToGallery(context, m.media?.url ?: return@launch, "dessin-${m.id}.png", "image/png")
                }
            }, Modifier.fillMaxWidth(), icon = PIcons.Download)
        }
        ErrorText(error)
    }
}

/** Saves a media file in the phone's Pictures/Papote; returns an error text, or a confirmation. */
suspend fun saveToGallery(context: Context, path: String, name: String, mime: String): String? {
    if (Build.VERSION.SDK_INT < 29) return "Il faut Android 10 ou plus pour enregistrer ici"
    return try {
        val bytes = PapoteApp.instance.api.bytes(path)
        withContext(Dispatchers.IO) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/Papote")
            }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: error("stockage indisponible")
            context.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
        }
        "Enregistré dans Images › Papote"
    } catch (e: Exception) {
        "Enregistrement impossible : ${e.message}"
    }
}
