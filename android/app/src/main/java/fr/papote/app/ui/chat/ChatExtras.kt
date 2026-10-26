package fr.papote.app.ui.chat

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Favorite
import fr.papote.app.data.Gif
import fr.papote.app.data.GroupSummary
import fr.papote.app.data.LiveSession
import fr.papote.app.data.Member
import fr.papote.app.data.Message
import fr.papote.app.data.Sticker
import fr.papote.app.data.StoryGroup
import fr.papote.app.data.jsonOf
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.PapoteSwitch
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.Segmented
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.extras.BuiltinStickerView
import fr.papote.app.ui.extras.BuiltinStickers
import fr.papote.app.ui.extras.currentLocation
import fr.papote.app.ui.extras.moodOf
import fr.papote.app.ui.extras.openInMaps
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.timeOf
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.Locale
import kotlin.math.roundToInt

private val InkColor = Color(0xFF2E2442)

/** "d’Inès", "de Lou". */
fun of(name: String) = if (name.firstOrNull()?.lowercaseChar()?.let { it in "aeiouyhéèêàâîïôû" } == true) tr("d’{}", name) else "de $name"

// --- stories --------------------------------------------------------------------------------------

@Composable
/** The group's stories (24 h); only shown when someone has one. Adding one is in the "+" menu. */
fun StoriesBar(stories: List<StoryGroup>, members: Map<Long, Member>, meId: Long?, onOpen: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        stories.forEachIndexed { i, g ->
            val mine = g.user.id == meId
            val m = members[g.user.id]
            StoryItem(
                if (mine) tr("Toi") else g.user.name,
                ring = !mine && g.unseen,
                add = false,
                label = if (mine) tr("Voir ma story") else "${g.user.name} : " + if (g.unseen) tr("nouvelle story") else tr("story déjà vue"),
                onClick = { onOpen(i) },
            ) {
                Avatar(g.user.name, m?.color ?: g.user.color, m?.photo ?: g.user.photo, size = 46.dp, initialOnly = true)
            }
        }
    }
}

@Composable
private fun StoryItem(name: String, ring: Boolean, add: Boolean, label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    val c = Papote.colors
    Column(
        Modifier.clip(pShape(12.dp)).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box {
            Box(
                Modifier.size(58.dp).border(3.dp, if (ring) c.primary else c.line, CircleShape).padding(3.dp),
                contentAlignment = Alignment.Center,
            ) { content() }
            if (add) Box(
                Modifier.align(Alignment.BottomEnd).size(22.dp).clip(CircleShape).background(c.primary).border(2.dp, c.ground, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(PIcons.Plus, null, tint = c.onPrimary, modifier = Modifier.size(14.dp)) }
        }
        Text(name, style = MaterialTheme.typography.labelMedium, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(64.dp), textAlign = TextAlign.Center)
    }
}

@Composable
fun StoryViewer(stories: List<StoryGroup>, start: Int, meId: Long?, onClose: () -> Unit) {
    val app = PapoteApp.instance
    val scope = rememberCoroutineScope()
    var gi by remember { mutableIntStateOf(start) }
    var si by remember { mutableIntStateOf(0) }
    val list = remember { mutableStateListOf<StoryGroup>().apply { addAll(stories) } }
    fun next() {
        val g = list.getOrNull(gi) ?: return onClose()
        if (si < g.stories.size - 1) si++ else if (gi < list.size - 1) {
            gi++
            si = 0
        } else onClose()
    }
    fun prev() {
        if (si > 0) si-- else if (gi > 0) {
            gi--
            si = list[gi].stories.size - 1
        }
    }
    val g = list.getOrNull(gi) ?: return
    val s = g.stories.getOrNull(si) ?: return
    val mine = g.user.id == meId
    LaunchedEffect(gi, si) {
        if (!mine && !s.seen) runCatching { app.api.viewStory(s.id) }
        delay(6000)
        next()
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xFF120D1C))) {
            AsyncImage(app.mediaUrl(s.url), s.caption.ifBlank { "Story ${of(g.user.name)}" }, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxHeight().clickable(role = Role.Button, onClick = ::prev).semantics { contentDescription = tr("Story précédente") })
                Box(Modifier.weight(1f).fillMaxHeight().clickable(role = Role.Button, onClick = ::next).semantics { contentDescription = tr("Story suivante") })
            }
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    g.stories.indices.forEach { i ->
                        Box(Modifier.weight(1f).height(4.dp).clip(pShape(2.dp)).background(if (i <= si) Color.White else Color.White.copy(alpha = 0.3f)))
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(g.user.name, g.user.color, g.user.photo, size = 36.dp, initialOnly = true)
                    Column(Modifier.weight(1f)) {
                        Text(if (mine) tr("Toi") else g.user.name, color = Color.White, fontWeight = FontWeight.Bold)
                        Text(tr("{} · encore {} h", timeOf(s.createdAt), ((s.expiresAt - System.currentTimeMillis()) / 3_600_000).coerceAtLeast(1)), color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall)
                    }
                    if (mine) SquareIconButton(PIcons.Trash, tr("Supprimer cette story"), {
                        scope.launch {
                            runCatching { app.api.deleteStory(s.id) }
                            val left = g.stories - s
                            if (left.isEmpty()) onClose() else {
                                list[gi] = g.copy(stories = left)
                                si = si.coerceAtMost(left.size - 1)
                            }
                        }
                    }, background = Color.White.copy(alpha = 0.15f), tint = Color.White)
                    SquareIconButton(PIcons.Close, tr("Fermer"), onClose, background = Color.White.copy(alpha = 0.15f), tint = Color.White)
                }
            }
            Column(Modifier.align(Alignment.BottomCenter).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (s.caption.isNotBlank()) Text(s.caption, color = Color.White, fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 20.sp, textAlign = TextAlign.Center)
                if (mine) Text(
                    s.viewers?.takeIf { it.isNotEmpty() }?.let { v -> tr("Vue par ") + v.joinToString(", ") { it.name } } ?: tr("Pas encore vue"),
                    color = Color.White.copy(alpha = 0.85f),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

// --- banners ---------------------------------------------------------------------------------------

@Composable
private fun Banner(bg: Color, fg: Color, onClick: () -> Unit, label: String, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(pShape(18.dp)).background(bg).clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label }.padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) { androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides fg) { content() } }
}

@Composable
fun ChatBanners(
    group: GroupSummary?,
    pins: List<Message>,
    live: LiveSession?,
    pending: List<Member>,
    isAdmin: Boolean,
    members: Map<Long, Member>,
    meId: Long?,
    onPins: () -> Unit,
    onConfetti: () -> Unit,
    onLive: () -> Unit,
    onPending: () -> Unit,
) {
    val c = Papote.colors
    pins.firstOrNull()?.let { p ->
        val text = if (p.type == "text" || p.type == "poll") p.text else mapOf("photo" to tr("Photo"), "drawing" to tr("Dessin"), "voice" to tr("Vocal"), "location" to tr("Position"), "gif" to "GIF")[p.type] ?: "Message"
        Banner(c.card, c.ink, onPins, tr("Message épinglé : {}. Voir les épinglés", text)) {
            Icon(PIcons.Pin, null, tint = c.primary, modifier = Modifier.size(16.dp))
            Text(tr("Épinglé :"), fontWeight = FontWeight.ExtraBold, color = c.primary, style = MaterialTheme.typography.labelLarge)
            Text(text, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            if (pins.size > 1) Text("+${pins.size - 1}", color = c.muted, style = MaterialTheme.typography.labelMedium)
        }
    }
    val bdays = group?.birthdaysToday.orEmpty().mapNotNull { id -> if (id == meId) "toi" else members[id]?.name }
    if (bdays.isNotEmpty()) {
        Banner(Color(0xFFFFF0B8), InkColor, onConfetti, tr("Joyeux anniversaire {}, lancer les confettis", bdays.joinToString(" et "))) {
            Icon(PIcons.Cake, null, modifier = Modifier.size(28.dp))
            Column(Modifier.weight(1f)) {
                Text(tr("Joyeux anniversaire {} !", bdays.joinToString(" et ")), style = MaterialTheme.typography.titleMedium, color = InkColor)
                Text(tr("Tape pour lancer les confettis"), style = MaterialTheme.typography.bodySmall, color = InkColor)
            }
        }
    }
    live?.let { s ->
        val who = members[s.startedBy]?.name ?: tr("Quelqu’un")
        Banner(Color(0xFFFFF0B8), InkColor, onLive, tr("{} a lancé une toile commune, rejoindre", who)) {
            Icon(PIcons.Palette, null, modifier = Modifier.size(20.dp))
            Text(tr("{} a lancé une toile commune", who), Modifier.weight(1f), fontWeight = FontWeight.Bold, color = InkColor)
            Text(tr("Rejoindre"), style = MaterialTheme.typography.titleMedium, color = Color(0xFF4A2FA8))
        }
    }
    if (isAdmin && pending.isNotEmpty()) {
        val text = if (pending.size == 1) tr("{} veut rejoindre le groupe", pending[0].name) else tr("{} personnes veulent rejoindre le groupe", pending.size)
        Banner(c.soft, c.ink, onPending, "$text, voir") {
            Icon(PIcons.PersonPlus, null, modifier = Modifier.size(20.dp))
            Text(text, Modifier.weight(1f), fontWeight = FontWeight.Bold)
            Text(tr("Voir"), style = MaterialTheme.typography.titleMedium, color = c.primary)
        }
    }
}

// --- bubbles ---------------------------------------------------------------------------------------

@Composable
fun PollBubble(m: Message, members: Map<Long, Member>, meId: Long?, onVote: (Int) -> Unit, onClose: () -> Unit) {
    val c = Papote.colors
    val votes = m.votes.orEmpty()
    val total = votes.values.flatten().toSet().size
    val mine = votes.filterValues { meId in it }.keys.mapNotNull { it.toIntOrNull() }
    val closed = m.metaBool("closed")
    val author = members[m.authorId]?.name ?: tr("quelqu’un")
    val canClose = !closed && (m.authorId == meId || members[meId]?.isAdmin == true)
    Column(Modifier.width(260.dp).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(PIcons.Poll, null, tint = c.primary, modifier = Modifier.size(18.dp))
            Text(tr("Sondage {} · {} vote{}{}", if (m.authorId == meId) tr("de toi") else of(author), total, if (total > 1) "s" else "", if (closed) tr(" · terminé") else ""), style = MaterialTheme.typography.labelMedium, color = c.muted)
        }
        Text(m.text, fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.ink)
        m.options.forEachIndexed { i, label ->
            val n = votes["$i"]?.size ?: 0
            val pct = if (total > 0) n * 100f / total else 0f
            val on = i in mine
            Box(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(pShape(14.dp)).background(c.field)
                    .border(2.dp, if (on) c.primary else c.line, pShape(14.dp))
                    .clickable(enabled = !closed, role = Role.Button) { onVote(i) }
                    .semantics { contentDescription = "$label : ${pct.roundToInt()} %" + if (on) tr(", ton vote") else "" },
            ) {
                // Tinted from the option's background: pastel in light mode, dark enough for light text in dark mode.
                Box(Modifier.fillMaxWidth(pct / 100f).height(44.dp).background(if (i % 2 == 0) lerp(c.field, c.primary, 0.18f) else lerp(c.field, Color(0xFFFF7A93), 0.2f)))
                Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(label + if (on) tr(" (ton vote)") else "", Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, color = c.ink, style = MaterialTheme.typography.bodyMedium)
                    Text("${pct.roundToInt()} %", fontWeight = FontWeight.ExtraBold, color = c.muted, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        if (m.metaBool("multiple")) Text(tr("Plusieurs réponses possibles"), style = MaterialTheme.typography.bodySmall, color = c.muted)
        if (canClose) Text(tr("Terminer le sondage"), style = MaterialTheme.typography.labelLarge, color = c.primary, modifier = Modifier.clickable(role = Role.Button, onClick = onClose).padding(4.dp))
    }
}

@Composable
fun LocationBubble(m: Message, mine: Boolean, onStop: () -> Unit) {
    val c = Papote.colors
    val context = LocalContext.current
    val lat = m.metaDouble("lat") ?: 0.0
    val lon = m.metaDouble("lon") ?: 0.0
    val acc = m.metaLong("accuracy") ?: 0
    val until = m.metaLong("until")
    val updated = m.metaLong("updatedAt") ?: m.createdAt
    val liveNow = until != null && until > System.currentTimeMillis()
    Column(Modifier.width(260.dp).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier.fillMaxWidth().height(72.dp).clip(pShape(14.dp))
                .background(Brush.linearGradient(listOf(Color(0xFFDDF4E9), Color(0xFFCDEFE0), Color(0xFFDDF4E9)))),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(48.dp).clip(CircleShape).background(Color(0xFF6A47D6)), contentAlignment = Alignment.Center) {
                Icon(PIcons.Location, null, tint = Color.White, modifier = Modifier.size(28.dp))
            }
        }
        Text(m.text.ifBlank { tr("Ma position") }, style = MaterialTheme.typography.titleMedium, color = c.ink)
        val mins = ((System.currentTimeMillis() - updated) / 60_000).toInt()
        Text(
            when {
                liveNow -> tr("En direct jusqu’à {} · mise à jour ", timeOf(until!!)) + if (mins < 1) tr("à l’instant") else "il y a $mins min"
                until != null -> tr("Partage terminé")
                else -> tr("Envoyée à {}", timeOf(m.createdAt))
            },
            style = MaterialTheme.typography.bodySmall,
            color = c.muted,
        )
        Text(
            String.format(Locale.FRANCE, "%.4f, %.4f", lat, lon) + if (acc > 0) tr(" · à {} près", if (acc < 1000) "$acc m" else String.format(fr.papote.app.I18n.locale, "%.1f km", acc / 1000.0)) else "",
            style = MaterialTheme.typography.bodySmall,
            color = c.muted,
        )
        SecondaryButton(tr("Ouvrir dans mon appli de cartes"), { openInMaps(context, lat, lon, m.text) }, Modifier.fillMaxWidth(), icon = PIcons.Location, height = 44.dp)
        if (mine && liveNow) Text(tr("Arrêter le partage"), style = MaterialTheme.typography.labelLarge, color = c.primary, modifier = Modifier.clickable(role = Role.Button, onClick = onStop).padding(4.dp))
    }
}

@Composable
fun GifBubble(m: Message, onOpen: () -> Unit) {
    val c = Papote.colors
    val w = m.width ?: 200
    val h = m.height ?: 150
    Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AsyncImage(
            PapoteApp.instance.mediaUrl(m.media?.url),
            m.metaString("title")?.let { tr("GIF « {} »", it) } ?: "GIF",
            contentScale = ContentScale.Crop,
            modifier = Modifier.width(220.dp).aspectRatio((w.toFloat() / h).coerceIn(0.6f, 1.8f)).clip(pShape(14.dp)).background(c.soft).clickable(onClick = onOpen),
        )
        Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(PIcons.Gif, null, tint = c.muted, modifier = Modifier.size(14.dp))
            Text(tr("GIF · ") + timeOf(m.createdAt), style = MaterialTheme.typography.labelMedium, color = c.muted)
        }
    }
}

@Composable
fun StickerBubble(m: Message) {
    val builtin = m.metaString("builtin")
    if (builtin != null) BuiltinStickerView(builtin, 110.dp)
    else AsyncImage(PapoteApp.instance.mediaUrl(m.media?.url), "Sticker", contentScale = ContentScale.Fit, modifier = Modifier.size(120.dp))
}

data class GameInfo(val name: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val bg: Color)

fun gameInfo(kind: String?) = when (kind) {
    "tictactoe" -> GameInfo(tr("Morpion"), PIcons.Grid, Color(0xFFEDE6FF))
    "connect4" -> GameInfo("Puissance 4", PIcons.Grid, Color(0xFFFFE0E8))
    "rps" -> GameInfo(tr("Chifoumi"), PIcons.Thumb, Color(0xFFFFE3C7))
    "hangman" -> GameInfo(tr("Pendu"), PIcons.TextTool, Color(0xFFDDF4E9))
    "quiz" -> GameInfo(tr("Qui a dit ça ?"), PIcons.ChatPlus, Color(0xFFD6E8FF))
    "pictionary" -> GameInfo("Pictionary", PIcons.Pencil, Color(0xFFFFF0B8))
    else -> GameInfo(tr("Jeu"), PIcons.Game, Color(0xFFEDE6FF))
}

@Composable
fun GameBubble(m: Message, members: Map<Long, Member>, meId: Long?, onOpen: (Long) -> Unit) {
    val info = gameInfo(m.metaString("kind"))
    val opp = m.metaLong("opponentId")
    val vs = when {
        opp == null -> ""
        opp == meId -> tr(" contre toi")
        else -> tr(" contre {}", members[opp]?.name ?: "?")
    }
    // Whole sentences, so that they translate.
    val line = if (m.authorId == meId) tr("Tu as lancé une partie{}", vs) else tr("{} a lancé une partie{}", members[m.authorId]?.name ?: tr("Quelqu’un"), vs)
    Row(
        Modifier.width(260.dp).background(info.bg).clickable(role = Role.Button) { m.metaLong("gameId")?.let(onOpen) }.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(44.dp).clip(pShape(14.dp)).background(Color.White.copy(alpha = 0.7f)), contentAlignment = Alignment.Center) { Icon(info.icon, null, tint = InkColor) }
        Column(Modifier.weight(1f)) {
            Text(info.name, style = MaterialTheme.typography.titleMedium, color = InkColor)
            Text(line, style = MaterialTheme.typography.bodySmall, color = InkColor)
        }
        Text(tr("Jouer"), style = MaterialTheme.typography.titleMedium, color = Color(0xFF4A2FA8), modifier = Modifier.clip(pShape(12.dp)).background(Color.White).padding(horizontal = 12.dp, vertical = 8.dp))
    }
}

@Composable
fun RecapBubble(m: Message, onOpen: (String) -> Unit) {
    val month = m.metaString("month") ?: ""
    val label = m.metaString("label") ?: ""
    val stats = m.meta?.get("stats") as? kotlinx.serialization.json.JsonObject
    fun n(k: String) = stats?.get(k)?.jsonPrimitive?.intOrNull ?: 0
    Column(
        Modifier.width(240.dp).background(Brush.linearGradient(listOf(Color(0xFFFFE0E8), Color(0xFFEDE6FF)))).clickable(role = Role.Button) { onOpen(month) }.padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = Color(0xFF4A2FA8), fontWeight = FontWeight.ExtraBold)
        Text(tr("Le récap du mois"), fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = InkColor)
        Text(tr("{} messages · {} dessins · {} vocaux", n("messages"), n("drawings"), n("voices")), style = MaterialTheme.typography.bodySmall, color = InkColor)
    }
}

// --- sheets ------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PollSheet(onDismiss: () -> Unit, onSend: (String, List<String>, Boolean) -> Unit) {
    val c = Papote.colors
    var question by remember { mutableStateOf("") }
    val options = remember { mutableStateListOf("", "") }
    var multiple by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.card) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(tr("Nouveau sondage"), style = MaterialTheme.typography.titleLarge, color = c.ink)
            PapoteField(question, { question = it.take(200) }, Modifier.fillMaxWidth(), placeholder = tr("Ciné samedi ou dimanche ?"), label = tr("Question"))
            options.forEachIndexed { i, v ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PapoteField(v, { options[i] = it.take(80) }, Modifier.weight(1f), placeholder = tr("Réponse {}", i + 1), label = tr("Réponse {}", i + 1))
                    if (options.size > 2) SquareIconButton(PIcons.Close, tr("Retirer la réponse {}", i + 1), { options.removeAt(i) })
                }
            }
            if (options.size < 6) SecondaryButton(tr("Ajouter une réponse"), { options += "" }, Modifier.fillMaxWidth(), icon = PIcons.Plus, height = 44.dp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(tr("Plusieurs réponses possibles"), Modifier.weight(1f), color = c.ink)
                PapoteSwitch(multiple, { multiple = it }, tr("Plusieurs réponses possibles"))
            }
            ErrorText(error)
            PrimaryButton(tr("Envoyer le sondage"), {
                val opts = options.map { it.trim() }.filter { it.isNotEmpty() }
                if (question.isBlank() || opts.size < 2) error = tr("Une question et au moins deux réponses")
                else {
                    onSend(question.trim(), opts, multiple)
                    onDismiss()
                }
            }, Modifier.fillMaxWidth(), icon = PIcons.Send)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationSheet(onDismiss: () -> Unit, onSend: (Double, Double, Int, Int, String) -> Unit) {
    val c = Papote.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var label by remember { mutableStateOf(tr("Je suis là !")) }
    var minutes by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun locate() {
        busy = true
        error = null
        scope.launch {
            val loc = currentLocation(context)
            busy = false
            if (loc == null) error = tr("Position introuvable : active la localisation du téléphone")
            else {
                onSend(loc.latitude, loc.longitude, loc.accuracy.roundToInt(), minutes, label.trim())
                onDismiss()
            }
        }
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) locate() else error = tr("Position refusée : autorise-la dans les réglages d’Android")
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.card) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(tr("Partager ma position"), style = MaterialTheme.typography.titleLarge, color = c.ink)
            Text(
                tr("Seules les coordonnées sont envoyées, sur ton serveur. Pas de carte : chacun l’ouvre dans sa propre appli de cartes s’il le souhaite."),
                style = MaterialTheme.typography.bodySmall,
                color = c.muted,
            )
            PapoteField(label, { label = it.take(80) }, Modifier.fillMaxWidth(), label = tr("Petit mot"))
            Text(tr("Partager"), style = MaterialTheme.typography.labelLarge, color = c.ink)
            Segmented(listOf(0 to tr("Une fois"), 15 to "15 min", 60 to "1 h", 480 to "8 h"), minutes, { minutes = it }, Modifier.fillMaxWidth())
            Text(tr("En direct, la position se met à jour tant que Papote tourne sur ce téléphone."), style = MaterialTheme.typography.bodySmall, color = c.muted)
            ErrorText(error)
            PrimaryButton(tr("Envoyer ma position"), {
                val ok = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                if (ok) locate() else ask.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            }, Modifier.fillMaxWidth(), loading = busy, icon = PIcons.Location)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GifSheet(groupId: Long, gifsEnabled: Boolean, onDismiss: () -> Unit, onGif: (String) -> Unit, onSticker: (Long?, String?) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(if (gifsEnabled) "gif" else "stickers") }
    var query by remember { mutableStateOf("") }
    var gifs by remember { mutableStateOf<List<Gif>>(emptyList()) }
    var favs by remember { mutableStateOf<List<Favorite>>(emptyList()) }
    var groupStickers by remember { mutableStateOf<List<Sticker>>(emptyList()) }
    var note by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { app.api.favorites() }.onSuccess { favs = it }
        runCatching { app.api.stickers(groupId) }.onSuccess { groupStickers = it }
    }
    LaunchedEffect(tab, query) {
        if (tab != "gif" || !gifsEnabled) return@LaunchedEffect
        delay(350)
        note = tr("Chargement…")
        try {
            gifs = if (query.isBlank()) app.api.gifsTrending() else app.api.gifsSearch(query.trim())
            note = if (gifs.isEmpty()) tr("Aucun GIF trouvé") else null
        } catch (e: ApiException) {
            note = e.message
        }
    }
    fun isFav(kind: String, ref: String) = favs.any { it.kind == kind && it.ref == ref }
    fun toggleFav(kind: String, ref: String, data: kotlinx.serialization.json.JsonObject? = null) {
        scope.launch {
            runCatching {
                if (isFav(kind, ref)) app.api.removeFavorite(kind, ref) else app.api.addFavorite(kind, ref, data)
                favs = app.api.favorites()
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.card) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Segmented(listOf("favs" to tr("Favoris"), "gif" to "GIF", "stickers" to "Stickers", "group" to tr("Du groupe")), tab, { tab = it }, Modifier.fillMaxWidth())
            if (tab == "gif" && gifsEnabled) PapoteField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = tr("Rechercher"), leading = PIcons.Search, label = tr("Rechercher un GIF"))
            @Composable
            fun Tile(label: String, kind: String, ref: String, data: kotlinx.serialization.json.JsonObject? = null, onPick: () -> Unit, content: @Composable () -> Unit) {
                Box(Modifier.aspectRatio(1f).clip(pShape(14.dp)).background(c.soft).clickable(role = Role.Button, onClick = onPick).semantics { contentDescription = label }) {
                    content()
                    val on = isFav(kind, ref)
                    Box(
                        Modifier.align(Alignment.TopEnd).padding(4.dp).size(28.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.85f))
                            .clickable(role = Role.Button) { toggleFav(kind, ref, data) }
                            .semantics { contentDescription = if (on) tr("Retirer des favoris") else tr("Ajouter aux favoris") },
                        contentAlignment = Alignment.Center,
                    ) { Icon(PIcons.Star, null, tint = if (on) Color(0xFFE0A800) else Color(0xFF8A7AA8), modifier = Modifier.size(16.dp)) }
                }
            }
            @Composable
            fun GifTile(id: String, title: String, preview: String, w: Int, h: Int) = Tile(tr("Envoyer le GIF {}", title), "gif", id, jsonOf("title" to title, "width" to w, "height" to h), {
                onGif(id)
                onDismiss()
            }) { AsyncImage(app.mediaUrl(preview), title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
            @Composable
            fun BuiltinTile(key: String) = Tile(tr("Envoyer le sticker"), "builtin", key, null, {
                onSticker(null, key)
                onDismiss()
            }) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { BuiltinStickerView(key, 64.dp) } }
            @Composable
            fun GroupTile(s: Sticker) = Tile(tr("Envoyer ce sticker"), "sticker", "${s.id}", null, {
                onSticker(s.id, null)
                onDismiss()
            }) { AsyncImage(app.mediaUrl(s.url), tr("Sticker du groupe"), contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(6.dp)) }

            Box(Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 420.dp)) {
                when {
                    tab == "gif" && !gifsEnabled -> Text(tr("Les GIF ne sont pas activés sur ce serveur (clé GIPHY à ajouter par l’admin)."), color = c.muted)
                    tab == "favs" && favs.isEmpty() -> Text(tr("Touche l’étoile d’un GIF ou d’un sticker pour le retrouver ici."), color = c.muted)
                    tab == "gif" && note != null -> Text(note!!, color = c.muted)
                    else -> LazyVerticalGrid(GridCells.Adaptive(96.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        when (tab) {
                            "gif" -> items(gifs, key = { it.id }) { g -> GifTile(g.id, g.title, g.preview, g.width, g.height) }
                            "stickers" -> items(BuiltinStickers, key = { it.key }) { BuiltinTile(it.key) }
                            "group" -> items(groupStickers, key = { it.id }) { GroupTile(it) }
                            else -> items(favs, key = { it.kind + it.ref }) { f ->
                                when (f.kind) {
                                    "gif" -> GifTile(f.ref, f.data?.get("title")?.jsonPrimitive?.contentOrNull.orEmpty(), "/api/gifs/${f.ref}/preview", 200, 200)
                                    "builtin" -> BuiltinTile(f.ref)
                                    else -> f.data?.let { d -> d["url"]?.jsonPrimitive?.contentOrNull?.let { url -> GroupTile(Sticker(f.ref.toLong(), url = url)) } }
                                }
                            }
                        }
                    }
                }
            }
            if (tab == "group") Text(tr("Pour créer un sticker : appuie longuement sur un dessin ou une photo du groupe, puis « En faire un sticker »."), style = MaterialTheme.typography.bodySmall, color = c.muted)
            if (gifsEnabled) Text(tr("Powered by GIPHY · via ton serveur"), style = MaterialTheme.typography.bodySmall, color = c.muted, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        }
    }
}

/** A small mood badge drawn on an avatar's corner. */
@Composable
fun MoodBadge(mood: String?, modifier: Modifier = Modifier) {
    val m = moodOf(mood) ?: return
    val c = Papote.colors
    Box(modifier.size(18.dp).clip(CircleShape).background(c.card).border(2.dp, c.ground, CircleShape).semantics { contentDescription = m.label }, contentAlignment = Alignment.Center) {
        Icon(m.icon, null, tint = c.primary, modifier = Modifier.size(12.dp))
    }
}

@Composable
fun VoiceFilterChips(selected: String, onPick: (String) -> Unit) {
    val c = Papote.colors
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf("" to tr("Normale"), "souris" to tr("Souris"), "robot" to "Robot", "echo" to tr("Écho"), "geant" to tr("Géant")).forEach { (k, label) ->
            val on = k == selected
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = c.ink,
                modifier = Modifier.clip(pShape(12.dp)).background(if (on) c.soft else c.card).border(2.dp, if (on) c.primary else Color.Transparent, pShape(12.dp))
                    .clickable(role = Role.RadioButton) { onPick(k) }.padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}
