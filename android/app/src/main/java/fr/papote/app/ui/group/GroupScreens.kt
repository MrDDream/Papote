package fr.papote.app.ui.group

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import android.content.ContentValues
import android.os.Build
import android.provider.MediaStore
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Event
import fr.papote.app.data.GroupSummary
import fr.papote.app.data.Member
import fr.papote.app.data.Message
import fr.papote.app.data.Recap
import fr.papote.app.data.jsonOf
import fr.papote.app.ui.chat.of
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.EmojiPicker
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.PapoteSwitch
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.Segmented
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.components.TintPicker
import fr.papote.app.ui.components.TopBar
import fr.papote.app.ui.dayLabel
import fr.papote.app.ui.duration
import fr.papote.app.ui.extras.Moods
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.tint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId

private val Ink = Color(0xFF2E2442)
private val MONTHS = listOf(tr("janvier"), tr("février"), tr("mars"), tr("avril"), tr("mai"), tr("juin"), tr("juillet"), tr("août"), tr("septembre"), tr("octobre"), tr("novembre"), tr("décembre"))

@Composable
private fun Card(content: @Composable () -> Unit) {
    val c = Papote.colors
    Column(Modifier.fillMaxWidth().clip(pShape(28.dp)).background(c.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
}

@Composable
private fun LinkRow(icon: ImageVector, title: String, sub: String?, onClick: () -> Unit) {
    val c = Papote.colors
    Row(
        Modifier.fillMaxWidth().clip(pShape(18.dp)).clickable(role = Role.Button, onClick = onClick).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).clip(pShape(14.dp)).background(c.soft), contentAlignment = Alignment.Center) { Icon(icon, null, tint = c.primary) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.labelLarge, color = c.ink)
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = c.muted)
        }
        Icon(PIcons.Forward, null, tint = c.muted, modifier = Modifier.size(18.dp))
    }
}

// --- Réglages du groupe ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GroupSettingsScreen(
    groupId: Long,
    onBack: () -> Unit,
    onMembers: () -> Unit,
    onInvite: () -> Unit,
    onGallery: () -> Unit,
    onSearch: () -> Unit,
    onGames: () -> Unit,
    onRecap: () -> Unit,
    onLeft: () -> Unit,
) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var group by remember { mutableStateOf<GroupSummary?>(null) }
    var members by remember { mutableStateOf<List<Member>>(emptyList()) }
    var me by remember { mutableStateOf<fr.papote.app.data.User?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    var addReaction by remember { mutableStateOf(false) }
    var talkie by remember { mutableStateOf(app.session.talkie(groupId)) }
    var exporting by remember { mutableStateOf(false) }
    // A picture behind the messages: resized like the others, dimmed when shown.
    val pickWallpaper = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            try {
                group = app.api.setWallpaper(groupId, fr.papote.app.ui.chat.prepareImage(context, uri).bytes)
            } catch (e: ApiException) {
                error = e.message
            }
        }
    }

    suspend fun load() {
        try {
            group = app.api.group(groupId)
            members = app.api.members(groupId)
            me = app.api.me()
        } catch (e: ApiException) {
            error = e.message
        }
    }
    fun act(block: suspend () -> Unit) = scope.launch {
        try {
            block()
            load()
        } catch (e: ApiException) {
            error = e.message
        }
    }
    LaunchedEffect(groupId) {
        load()
        app.realtime.events.collect { e ->
            when (e) {
                is Event.GroupUpdated -> if (e.groupId == groupId) load()
                is Event.MemberJoined, is Event.MemberLeft, is Event.MemberPending -> load()
                is Event.GroupRemoved -> if (e.groupId == groupId) onLeft()
                else -> Unit
            }
        }
    }

    val g = group
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        TopBar(if (g?.direct == true) tr("Réglages de la discussion") else tr("Réglages du groupe"), onBack, subtitle = g?.name)
        if (g == null) {
            ErrorText(error)
            return@Column
        }
        val mine = members.firstOrNull { it.id == app.session.userId }
        val admin = mine?.isAdmin == true
        val s = g.settings
        val canTheme = admin || !s.adminsTheme
        val active = members.filter { !it.pending }
        Card {
            LinkRow(PIcons.People, if (g.direct) tr("La discussion") else tr("Membres"), if (g.direct) null else "${active.size} membre${if (active.size > 1) "s" else ""}" + if (admin && members.any { it.pending }) tr(" · des demandes en attente") else "", onMembers)
            if (!g.direct && (s.anyoneInvites || admin)) LinkRow(PIcons.Share, tr("Inviter quelqu’un"), tr("Code et QR code"), onInvite)
            LinkRow(PIcons.Grid, tr("Galerie"), "Dessins, photos, GIF, vocaux", onGallery)
            LinkRow(PIcons.Search, tr("Épinglés et recherche"), null, onSearch)
            LinkRow(PIcons.Game, "Mini-jeux", null, onGames)
            LinkRow(PIcons.Sparkles, tr("Le récap du mois"), null, onRecap)
        }
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(tr("Thème"), style = MaterialTheme.typography.titleMedium, color = c.ink, modifier = Modifier.weight(1f))
                if (!canTheme) Text(tr("réservé aux admins"), style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
            if (!g.direct && canTheme) TintPicker(g.color, { col -> act { app.api.updateGroup(groupId, jsonOf("color" to col)) } })
            val labels = mapOf(
                "none" to tr("Uni"), "dots" to tr("Pois"), "stripes" to tr("Rayures"), "grid" to tr("Grille"),
                "hearts" to tr("Cœurs"), "stars" to tr("Étoiles"), "waves" to tr("Vagues"), "leaves" to tr("Feuilles"),
                "confetti" to tr("Confettis"), "clouds" to tr("Nuages"), "paws" to tr("Pattes"), "notes" to tr("Musique"),
            )
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (p in fr.papote.app.ui.chat.BgPatterns) {
                    val on = s.pattern == p
                    Column(
                        Modifier.clip(pShape(16.dp)).border(2.dp, if (on) c.primary else Color.Transparent, pShape(16.dp))
                            .clickable(enabled = canTheme, role = Role.RadioButton) { act { app.api.groupSettings(groupId, jsonOf("pattern" to p)) } }
                            .semantics { contentDescription = labels[p] ?: p }
                            .padding(4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        fr.papote.app.ui.chat.ChatBackground(
                            p, g.color, null,
                            Modifier.size(52.dp).clip(pShape(12.dp)).background(c.surfaceOf(tint(g.color))).border(1.dp, c.line, pShape(12.dp)),
                        )
                        Text(labels[p] ?: p, style = MaterialTheme.typography.labelMedium.copy(fontSize = 11.sp), color = c.ink)
                    }
                }
            }
            if (canTheme) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton(if (g.wallpaper != null) tr("Changer la photo de fond") else tr("Photo de fond"), {
                    pickWallpaper.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly))
                }, Modifier.weight(1f), icon = PIcons.Photo, height = 44.dp)
                if (g.wallpaper != null) SecondaryButton(tr("Retirer"), { act { app.api.deleteWallpaper(groupId) } }, height = 44.dp)
            }
        }
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(tr("Réactions du groupe"), style = MaterialTheme.typography.titleMedium, color = c.ink, modifier = Modifier.weight(1f))
                Text(tr("Tape pour changer"), style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (k in s.reactions) {
                    val r = PIcons.reaction(k)
                    Box(
                        Modifier.size(46.dp).clip(pShape(16.dp)).background(r?.bg ?: c.field)
                            .clickable(enabled = canTheme && s.reactions.size > 1, role = Role.Button) {
                                act { app.api.groupSettings(groupId, jsonOf("reactions" to kotlinx.serialization.json.JsonArray((s.reactions - k).map { kotlinx.serialization.json.JsonPrimitive(it) }))) }
                            }
                            .semantics { contentDescription = "${r?.label ?: k} : retirer" },
                        contentAlignment = Alignment.Center,
                    ) { if (r != null) Icon(r.icon, null, tint = r.fg) else Text(k, fontSize = 22.sp) }
                }
                if (canTheme && s.reactions.size < 8) Box(
                    Modifier.size(46.dp).clip(pShape(16.dp)).background(c.soft).clickable(role = Role.Button) { addReaction = !addReaction }
                        .semantics { contentDescription = tr("Ajouter une réaction") },
                    contentAlignment = Alignment.Center,
                ) { Icon(PIcons.Plus, null, tint = c.primary) }
            }
            if (addReaction) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PIcons.Reactions.filter { it.key !in s.reactions }.forEach { r ->
                        Box(
                            Modifier.size(46.dp).clip(pShape(16.dp)).background(r.bg).clickable(role = Role.Button) {
                                addReaction = false
                                act { app.api.groupSettings(groupId, jsonOf("reactions" to kotlinx.serialization.json.JsonArray((s.reactions + r.key).map { kotlinx.serialization.json.JsonPrimitive(it) }))) }
                            }.semantics { contentDescription = r.label },
                            contentAlignment = Alignment.Center,
                        ) { Icon(r.icon, null, tint = r.fg) }
                    }
                }
                EmojiPicker({ e ->
                    addReaction = false
                    act { app.api.groupSettings(groupId, jsonOf("reactions" to kotlinx.serialization.json.JsonArray((s.reactions + e).distinct().map { kotlinx.serialization.json.JsonPrimitive(it) }))) }
                }, height = 240.dp)
            }
        }
        Card {
            Text(tr("Mon humeur"), style = MaterialTheme.typography.titleMedium, color = c.ink)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (m in Moods) {
                    val on = me?.mood == m.key
                    Row(
                        Modifier.clip(pShape(14.dp)).background(if (on) c.soft else c.field).border(2.dp, if (on) c.primary else c.line, pShape(14.dp))
                            .clickable(role = Role.RadioButton) {
                                scope.launch {
                                    try {
                                        me = app.api.updateMe(jsonOf("mood" to if (on) null else m.key))
                                    } catch (e: ApiException) {
                                        error = e.message
                                    }
                                }
                            }.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(m.icon, null, tint = c.primary, modifier = Modifier.size(16.dp))
                        Text(m.label, style = MaterialTheme.typography.labelLarge, color = c.ink)
                    }
                }
            }
            Text(tr("Visible sur ton avatar, dans tous tes groupes."), style = MaterialTheme.typography.bodySmall, color = c.muted)
        }
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(tr("Fêter les anniversaires"), style = MaterialTheme.typography.labelLarge, color = c.ink)
                    Text(
                        me?.birthday?.let { b -> "Confettis le jour J · le tien : " + Regex("(\\d{2})-(\\d{2})$").find(b)?.let { "${it.groupValues[2].toInt()} ${MONTHS[it.groupValues[1].toInt() - 1]}" }.orEmpty() }
                            ?: tr("Confettis le jour J · ajoute ta date dans Paramètres"),
                        style = MaterialTheme.typography.bodySmall,
                        color = c.muted,
                    )
                }
                PapoteSwitch(s.birthdays, { on -> if (canTheme) act { app.api.groupSettings(groupId, jsonOf("birthdays" to on)) } }, tr("Fêter les anniversaires"))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(tr("Mode talkie"), style = MaterialTheme.typography.labelLarge, color = c.ink)
                    Text(tr("Les vocaux des autres se lancent tout seuls quand la discussion est ouverte"), style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
                PapoteSwitch(talkie, {
                    talkie = it
                    app.session.setTalkie(groupId, it)
                }, tr("Mode talkie"))
            }
        }
        ErrorText(error)
        info?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.ok) }
        SecondaryButton(if (exporting) tr("Export en cours…") else "Exporter (.zip)", {
            if (exporting) return@SecondaryButton
            if (Build.VERSION.SDK_INT < 29) {
                error = tr("Il faut Android 10 ou plus pour exporter ici")
                return@SecondaryButton
            }
            exporting = true
            scope.launch {
                try {
                    val name = "papote-${g.name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')}.zip"
                    withContext(Dispatchers.IO) {
                        val values = ContentValues().apply {
                            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                            put(MediaStore.MediaColumns.MIME_TYPE, "application/zip")
                            put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/Papote")
                        }
                        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error(tr("stockage indisponible"))
                        context.contentResolver.openOutputStream(uri)!!.use { out -> app.api.export(groupId, out) }
                    }
                    info = tr("Enregistré dans Téléchargements › Papote › {}", name)
                } catch (e: Exception) {
                    error = tr("Export impossible : {}", e.message)
                } finally {
                    exporting = false
                }
            }
        }, Modifier.fillMaxWidth(), icon = PIcons.Download)
        SecondaryButton(if (g.direct) tr("Quitter la discussion") else tr("Quitter le groupe"), {
            scope.launch {
                try {
                    app.api.leaveGroup(groupId)
                    onLeft()
                } catch (e: ApiException) {
                    error = e.message
                }
            }
        }, Modifier.fillMaxWidth(), icon = PIcons.Exit, danger = true)
    }
}

// --- Épinglés et recherche ---------------------------------------------------------------------------

@Composable
fun SearchScreen(groupId: Long, onBack: () -> Unit, onOpen: (Long) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    var members by remember { mutableStateOf<Map<Long, Member>>(emptyMap()) }
    var pins by remember { mutableStateOf<List<Message>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("all") }
    var results by remember { mutableStateOf<List<Message>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(groupId) {
        runCatching {
            members = app.api.members(groupId).associateBy { it.id }
            pins = app.api.pins(groupId)
        }.onFailure { error = it.message }
    }
    LaunchedEffect(query, filter) {
        delay(250)
        val author = filter.removePrefix("u").toLongOrNull()?.takeIf { filter.startsWith("u") }
        if (query.isBlank() && author == null) {
            results = null
            return@LaunchedEffect
        }
        results = try {
            app.api.search(groupId, query, filter.takeIf { it == "text" || it == "voice" }, author)
        } catch (e: ApiException) {
            error = e.message
            null
        }
    }
    fun label(m: Message) = if (m.type == "voice") m.transcript.orEmpty() else m.text.ifBlank {
        mapOf("photo" to tr("Photo"), "drawing" to tr("Dessin"), "voice" to tr("Vocal"), "location" to tr("Position"), "gif" to "GIF", "sticker" to "Sticker")[m.type] ?: "Message"
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SquareIconButton(PIcons.Back, tr("Retour"), onBack)
            PapoteField(query, { query = it }, Modifier.weight(1f), placeholder = tr("Rechercher"), leading = PIcons.Search, label = tr("Rechercher dans la discussion"))
        }
        Text(tr("Textes, sondages et vocaux transcrits"), style = MaterialTheme.typography.bodySmall, color = c.muted)
        if (pins.isNotEmpty()) {
            Text(tr("Épinglés"), style = MaterialTheme.typography.titleMedium, color = c.ink)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pins.forEachIndexed { i, p ->
                    Column(
                        Modifier.width(160.dp).clip(pShape(18.dp)).background(listOf(Color(0xFFFFF0B8), Color(0xFFD6E8FF), Color(0xFFFFE0E8), Color(0xFFCDEFE0))[i % 4])
                            .clickable(role = Role.Button) { onOpen(p.id) }.padding(12.dp),
                    ) {
                        Text(members[p.authorId]?.name.orEmpty(), style = MaterialTheme.typography.labelMedium, color = Ink, fontWeight = FontWeight.ExtraBold)
                        Text(label(p), style = MaterialTheme.typography.bodyMedium, color = Ink, maxLines = 3)
                    }
                }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val chips = listOf("all" to tr("Tout"), "text" to tr("Texte"), "voice" to tr("Vocaux")) +
                members.values.filter { !it.pending }.take(8).map { "u${it.id}" to if (it.id == app.session.userId) tr("Toi") else it.name }
            for ((k, l) in chips) {
                val on = k == filter
                Text(
                    l,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (on) c.onPrimary else c.ink,
                    modifier = Modifier.clip(pShape(14.dp)).background(if (on) c.primary else c.card).clickable(role = Role.RadioButton) { filter = k }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
        results?.let { list ->
            Text(tr("{} résultat{}", list.size, if (list.size > 1) "s" else "") + if (query.isNotBlank()) tr(" pour « {} »", query) else "", style = MaterialTheme.typography.titleMedium, color = c.ink)
            for (m in list) {
                val a = members[m.authorId]
                Row(
                    Modifier.fillMaxWidth().clip(pShape(18.dp)).background(c.card).clickable(role = Role.Button) { onOpen(m.id) }.padding(10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Avatar(a?.name ?: "?", a?.color ?: "lilas", a?.photo, size = 36.dp, initialOnly = true)
                    Column(Modifier.weight(1f)) {
                        Row {
                            Text(if (m.authorId == app.session.userId) tr("Toi") else a?.name ?: tr("Ancien membre"), style = MaterialTheme.typography.labelLarge, color = c.ink, modifier = Modifier.weight(1f))
                            Text(dayLabel(m.createdAt), style = MaterialTheme.typography.bodySmall, color = c.muted)
                        }
                        if (m.type == "voice") Text(tr("vocal transcrit"), style = MaterialTheme.typography.labelSmall, color = c.primary)
                        val text = label(m)
                        val i = text.lowercase().indexOf(query.lowercase().trim()).takeIf { query.isNotBlank() } ?: -1
                        Text(
                            buildAnnotatedString {
                                if (i < 0) append(text.take(160)) else {
                                    val start = (i - 40).coerceAtLeast(0)
                                    if (start > 0) append("…")
                                    append(text.substring(start, i))
                                    withStyle(SpanStyle(background = Color(0xFFFFF0B8), color = Ink)) { append(text.substring(i, i + query.trim().length)) }
                                    append(text.substring(i + query.trim().length).take(80))
                                }
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = c.muted,
                        )
                    }
                }
            }
        }
        ErrorText(error)
    }
}

// --- Galerie ------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GalleryScreen(groupId: Long, onBack: () -> Unit, onDrawing: (Long) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    var members by remember { mutableStateOf<Map<Long, Member>>(emptyMap()) }
    var tab by remember { mutableStateOf<String?>(null) }
    var who by remember { mutableStateOf<Long?>(null) }
    var items by remember { mutableStateOf<List<Message>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var memory by remember { mutableStateOf<Message?>(null) }
    var more by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<Message?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(groupId) { runCatching { members = app.api.members(groupId).associateBy { it.id } } }
    LaunchedEffect(tab, who) {
        try {
            val g = app.api.gallery(groupId, tab, who)
            items = g.items
            total = g.total
            memory = g.memory
            more = g.items.size == 60
        } catch (e: ApiException) {
            error = e.message
        }
    }
    fun open(m: Message) {
        if (m.type == "drawing") onDrawing(m.id) else if (m.type == "voice") {
            app.mediaUrl(m.media?.url)?.let { url ->
                runCatching {
                    android.media.MediaPlayer().apply {
                        setDataSource(app, android.net.Uri.parse(url), mapOf("Authorization" to "Bearer ${app.session.token}"))
                        setOnPreparedListener { it.start() }
                        setOnCompletionListener { it.release() }
                        prepareAsync()
                    }
                }
            }
        } else viewing = m
    }
    val bg = mapOf("drawing" to Color(0xFFFFF8E6), "photo" to Color(0xFFD6E8FF), "gif" to Color(0xFFFFE0E8), "voice" to Color(0xFFCDEFE0))
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar(tr("Galerie"), onBack, subtitle = "$total souvenir${if (total > 1) "s" else ""}")
        memory?.let { m ->
            Row(
                Modifier.fillMaxWidth().clip(pShape(22.dp)).background(Color(0xFFFFF0B8)).clickable(role = Role.Button) { open(m) }.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AsyncImage(app.mediaUrl(m.media?.url), null, contentScale = ContentScale.Crop, modifier = Modifier.size(64.dp).clip(pShape(14.dp)))
                Column {
                    Text(tr("Il y a un an jour pour jour…"), style = MaterialTheme.typography.titleMedium, color = Ink)
                    Text("${if (m.type == "drawing") tr("Le dessin") else tr("La photo")} ${of(members[m.authorId]?.name ?: tr("quelqu’un"))}", style = MaterialTheme.typography.bodySmall, color = Ink)
                }
            }
        }
        Segmented(listOf(null to tr("Tout"), "drawing" to tr("Dessins"), "photo" to tr("Photos"), "gif" to "GIF", "voice" to tr("Vocaux")), tab, { tab = it }, Modifier.fillMaxWidth())
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            members.values.filter { !it.pending }.forEach { m ->
                Box(
                    Modifier.clip(CircleShape).border(3.dp, if (who == m.id) c.primary else Color.Transparent, CircleShape)
                        .clickable(role = Role.RadioButton) { who = if (who == m.id) null else m.id }
                        .semantics { contentDescription = tr("Voir seulement {}", m.name) },
                ) { Avatar(m.name, m.color, m.photo, size = 44.dp, initialOnly = true) }
            }
        }
        if (items.isEmpty()) Text(tr("Rien par ici pour l’instant."), color = c.muted, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        items.groupBy {
            val d = Instant.ofEpochMilli(it.createdAt).atZone(ZoneId.systemDefault())
            "${MONTHS[d.monthValue - 1].replaceFirstChar { ch -> ch.uppercase() }} ${d.year}"
        }.forEach { (month, list) ->
            Text("$month · ${list.size}", style = MaterialTheme.typography.titleMedium, color = c.ink)
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 3) {
                for (m in list) {
                    Box(
                        Modifier.weight(1f).aspectRatio(1f).clip(pShape(18.dp)).background(bg[m.type] ?: c.soft).clickable(role = Role.Button) { open(m) }
                            .semantics { contentDescription = (mapOf("drawing" to tr("Dessin"), "photo" to tr("Photo"), "gif" to "GIF", "voice" to tr("Vocal"))[m.type] ?: "") + " " + of(members[m.authorId]?.name ?: tr("quelqu’un")) },
                    ) {
                        if (m.type == "voice") Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(PIcons.Play, null, tint = Ink)
                            Text(duration(m.durationMs ?: 0), style = MaterialTheme.typography.titleMedium, color = Ink)
                        } else AsyncImage(app.mediaUrl(m.media?.url), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        Box(
                            Modifier.align(Alignment.BottomStart).padding(6.dp).size(24.dp).clip(CircleShape).background(Color.White),
                            contentAlignment = Alignment.Center,
                        ) { Text((members[m.authorId]?.name ?: "?").take(1).uppercase(), fontFamily = Baloo, fontWeight = FontWeight.Bold, color = Ink, fontSize = 13.sp) }
                    }
                }
                repeat((3 - list.size % 3) % 3) { Box(Modifier.weight(1f)) }
            }
        }
        if (more) SecondaryButton(tr("Voir plus"), {
            scope.launch {
                runCatching { app.api.gallery(groupId, tab, who, items.lastOrNull()?.id) }.onSuccess {
                    items = items + it.items
                    more = it.items.size == 60
                }
            }
        }, Modifier.fillMaxWidth())
        ErrorText(error)
    }
    viewing?.let { m ->
        androidx.compose.ui.window.Dialog({ viewing = null }, androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.92f)).clickable { viewing = null }, contentAlignment = Alignment.Center) {
                AsyncImage(app.mediaUrl(m.media?.url), "Image", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().padding(12.dp))
            }
        }
    }
}

// --- Le récap du mois -------------------------------------------------------------------------------------

@Composable
fun RecapScreen(groupId: Long, initialMonth: String?, onBack: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var month by remember { mutableStateOf(initialMonth?.takeIf { it.isNotBlank() } ?: YearMonth.now().toString()) }
    var recap by remember { mutableStateOf<Recap?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(month) {
        try {
            recap = app.api.recap(groupId, month)
        } catch (e: ApiException) {
            error = e.message
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        TopBar(tr("Le récap"), onBack)
        val r = recap ?: return@Column ErrorText(error)
        Column(
            Modifier.fillMaxWidth().clip(pShape(28.dp)).background(Brush.linearGradient(listOf(Color(0xFFFFE0E8), Color(0xFFEDE6FF)))).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SquareIconButton(PIcons.Back, tr("Mois précédent"), { month = YearMonth.parse(month).minusMonths(1).toString() })
                Text(r.label, fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, color = Ink, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                SquareIconButton(PIcons.Forward, tr("Mois suivant"), { month = YearMonth.parse(month).plusMonths(1).toString() }, enabled = YearMonth.parse(month) < YearMonth.now())
            }
            Text(if (r.stats.messages > 0) tr("Quel mois de papotage !") else tr("Un mois tout calme"), fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Ink)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(Triple(r.stats.messages, "messages", Color(0xFFFFE0E8)), Triple(r.stats.drawings, "dessins", Color(0xFFFFF0B8)), Triple(r.stats.voices, "vocaux", Color(0xFFCDEFE0))).forEach { (n, l, bg) ->
                Column(Modifier.weight(1f).clip(pShape(20.dp)).background(bg).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$n", fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp, color = Ink)
                    Text(l, color = Ink)
                }
            }
        }
        for (b in r.badges) {
            val (title, icon, bg) = when (b.kind) {
                "picasso" -> Triple(tr("Picasso du mois"), PIcons.Pencil, Color(0xFFFFF0B8))
                "voice" -> Triple(tr("Pipelette vocale"), PIcons.Mic, Color(0xFFCDEFE0))
                "gif" -> Triple(tr("GIF chouchou"), PIcons.Gif, Color(0xFFFFE0E8))
                "early" -> Triple(tr("Lève-tôt"), PIcons.Sun, Color(0xFFFFE3C7))
                else -> Triple(tr("Pipelette du clavier"), PIcons.Text, Color(0xFFD6E8FF))
            }
            val detail = when (b.kind) {
                "picasso" -> tr("{} · {} dessin{}", b.user?.name, b.value, if (b.value > 1) "s" else "")
                "voice" -> tr("{} · vocal le plus long {}", b.user?.name, duration(b.value))
                "gif" -> tr("« {} » envoyé {} fois", b.title, b.value)
                "early" -> tr("{} · 1er message à {}h{}", b.user?.name, b.value / 60, (b.value % 60).toString().padStart(2, '0'))
                else -> tr("{} · {} messages", b.user?.name, b.value)
            }
            Row(
                Modifier.fillMaxWidth().clip(pShape(22.dp)).background(c.card).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(Modifier.size(52.dp).clip(CircleShape).background(bg).border(3.dp, Ink, CircleShape), contentAlignment = Alignment.Center) {
                    b.user?.let { Avatar(it.name, it.color, it.photo, size = 40.dp, initialOnly = true) } ?: Icon(icon, null, tint = Ink)
                }
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.labelLarge, color = c.ink)
                    Text(detail, style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
                Icon(icon, null, tint = c.muted, modifier = Modifier.size(20.dp))
            }
        }
        if (r.stats.messages > 0) PrimaryButton(tr("Partager dans le groupe"), {
            scope.launch {
                try {
                    app.api.shareRecap(groupId, r.month)
                    onBack()
                } catch (e: ApiException) {
                    error = e.message
                }
            }
        }, Modifier.fillMaxWidth(), icon = PIcons.Share)
        ErrorText(error)
    }
}
