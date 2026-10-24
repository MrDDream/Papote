package fr.papote.app.ui.chat

import fr.papote.app.tr

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import fr.papote.app.service.Notifier
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import coil.compose.AsyncImage
import fr.papote.app.PapoteApp
import fr.papote.app.data.Member
import fr.papote.app.data.Message
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.EmojiPicker
import fr.papote.app.ui.components.Emojis
import fr.papote.app.ui.components.GroupAvatar
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.dayLabel
import fr.papote.app.ui.duration
import fr.papote.app.ui.sameDay
import fr.papote.app.ui.systemText
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.tint
import fr.papote.app.ui.timeOf
import fr.papote.app.ui.extras.Bubu
import fr.papote.app.ui.extras.ConfettiOverlay
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import fr.papote.app.data.ReplyPreview
import kotlin.math.roundToInt

/** A picked picture travels to the photo editor through here (a Uri can't go in a route safely). */
object PendingPhoto {
    var uri: android.net.Uri? = null
}

/** Text shared to Papote from another app, waiting in the chosen conversation's message field. */
object PendingShare {
    var text: String? = null
    fun take(): String? = text.also { text = null }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    groupId: Long,
    onBack: () -> Unit,
    onDraw: () -> Unit,
    onSettings: () -> Unit,
    onGone: () -> Unit,
    onMembers: () -> Unit = {},
    onSearch: () -> Unit = {},
    onGallery: () -> Unit = {},
    onGames: () -> Unit = {},
    onGame: (Long) -> Unit = {},
    onLive: () -> Unit = {},
    onDrawing: (Long) -> Unit = {},
    onDrawOver: (Long, String) -> Unit = { _, _ -> },
    onRecap: (String) -> Unit = {},
    onPhoto: (Boolean) -> Unit = {},
) {
    val vm: ChatViewModel = viewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    val playback by vm.player.state.collectAsStateWithLifecycle()
    val c = Papote.colors
    val context = LocalContext.current
    var text by rememberSaveable { mutableStateOf(PendingShare.take().orEmpty()) }
    var recording by remember { mutableStateOf(false) }
    val fieldFocus = remember { FocusRequester() }
    fun reply(m: Message) {
        vm.startReply(m)
        if (!recording) runCatching { fieldFocus.requestFocus() }
    }
    var sheetFor by remember { mutableStateOf<Message?>(null) }
    var viewing by remember { mutableStateOf<Message?>(null) }
    var playingVideo by remember { mutableStateOf<Message?>(null) }
    var attachOpen by remember { mutableStateOf(false) }
    var sheetPicker by remember { mutableStateOf(false) }
    var pollSheet by remember { mutableStateOf(false) }
    var locationSheet by remember { mutableStateOf(false) }
    var gifSheet by remember { mutableStateOf(false) }
    var storyAt by remember { mutableStateOf<Int?>(null) }
    var confetti by remember { mutableStateOf(0) }
    var bubuTip by remember { mutableStateOf(false) }
    var voiceFilter by remember { mutableStateOf("") }

    LaunchedEffect(state.gone) { if (state.gone) onGone() }
    // This conversation is on screen: no notification for it, and clear the one already shown.
    DisposableEffect(groupId) {
        val app = PapoteApp.instance
        app.openGroupId = groupId
        Notifier.clear(app, groupId)
        onDispose { if (app.openGroupId == groupId) app.openGroupId = null }
    }

    // A picked photo goes through "Décorer la photo" (text, stickers, filters, ephemeral) before being sent.
    // "Photo et vidéo": a picture goes through "Décorer la photo", a video is sent as it is.
    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            if (context.contentResolver.getType(uri)?.startsWith("video/") == true) {
                vm.sendPicked(uri, video = true)
            } else {
                PendingPhoto.uri = uri
                onPhoto(false)
            }
        }
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.sendPicked(uri, video = false)
    }
    val pickStory = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            PendingPhoto.uri = uri
            onPhoto(true)
        }
    }
    val askMic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) recording = vm.startVoice()
    }
    fun startRecording() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            recording = vm.startVoice()
        } else {
            askMic.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    val group = state.group
    val t = tint(group?.color)
    val listState = rememberLazyListState()
    // Newest first because the list is reversed (sticks to the bottom like a chat).
    val items = remember(state.messages) { state.messages.asReversed() }

    LaunchedEffect(items.firstOrNull()?.id) {
        if (state.highlight == null && listState.firstVisibleItemIndex <= 2) listState.animateScrollToItem(0)
    }
    // Opened on a search result or a pinned message: scroll to it.
    LaunchedEffect(state.highlight, items.size) {
        val h = state.highlight ?: return@LaunchedEffect
        val i = items.indexOfFirst { it.id == h }
        if (i >= 0) {
            listState.scrollToItem(i + 1)
            kotlinx.coroutines.delay(2500)
            vm.clearHighlight()
        }
    }
    val nearTop by remember { derivedStateOf { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= items.size - 5 } ?: false } }
    LaunchedEffect(nearTop) { if (nearTop) vm.loadOlder() }
    val nearBottom by remember { derivedStateOf { listState.firstVisibleItemIndex <= 1 } }
    LaunchedEffect(nearBottom, state.reachedEnd) { if (nearBottom && !state.reachedEnd) vm.loadNewer() }

    Column(Modifier.fillMaxSize()) {
        // Header
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp)).background(c.surfaceOf(t))
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SquareIconButton(PIcons.Back, tr("Retour aux groupes"), onBack, size = 40.dp)
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).clickable(role = Role.Button, onClick = onMembers),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GroupAvatar(group, size = 40.dp, zoomable = true)
                Column(Modifier.weight(1f)) {
                    Text(group?.name ?: "…", style = MaterialTheme.typography.headlineSmall.copy(fontSize = 20.sp), color = c.ink, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    val n = state.members.size
                    val peer = group?.peer?.let { p -> state.members[p.id] }
                    Text(
                        when {
                            group?.direct == true && peer != null -> fr.papote.app.ui.lastSeen(peer)
                            group?.direct == true -> tr("Discussion")
                            else -> tr("{} membre{} · {} en ligne", n, if (n > 1) "s" else "", state.onlineCount)
                        },
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Normal),
                        color = c.muted,
                    )
                }
            }
            // Bubu, the mascot: its face follows what happens in the group.
            val bubu = state.bubu
            Box {
                Box(
                    Modifier.clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button) {
                        bubuTip = true
                        if (bubu == fr.papote.app.ui.extras.BubuState.Party) confetti++
                    }.semantics { contentDescription = tr("Bubu, la mascotte : {}", bubu.line) },
                ) { Bubu(bubu, 34.dp) }
                if (bubuTip) {
                    LaunchedEffect(Unit) {
                        kotlinx.coroutines.delay(2500)
                        bubuTip = false
                    }
                    DropdownMenu(true, { bubuTip = false }, containerColor = c.card) {
                        Text(bubu.line, fontFamily = Baloo, fontWeight = FontWeight.Bold, color = c.ink, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
                    }
                }
            }
            SquareIconButton(PIcons.Search, tr("Rechercher dans la discussion"), onSearch, size = 38.dp)
            SquareIconButton(PIcons.Settings, if (group?.direct == true) tr("Réglages de la discussion") else tr("Réglages du groupe"), onSettings, size = 38.dp)
        }

        // Stories, pinned message, birthdays, shared drawing, people waiting for approval
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.stories.isNotEmpty()) StoriesBar(state.stories, state.members, vm.meId, onOpen = { storyAt = it })
            ChatBanners(
                group = group, pins = state.pins, live = state.live, pending = state.pending, isAdmin = state.me?.isAdmin == true,
                members = state.members, meId = vm.meId, onPins = onSearch, onConfetti = { confetti++ }, onLive = onLive, onPending = onMembers,
            )
        }

        // Messages
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.loading) {
                CircularProgressIndicator(Modifier.align(Alignment.Center), color = c.primary)
            } else {
                LazyColumn(
                    state = listState,
                    reverseLayout = true,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    item(key = "typing") { TypingRow(state.typing.keys.mapNotNull { state.members[it] }, state.typing.values.firstOrNull()?.kind) }
                    itemsIndexed(items, key = { _, m -> m.id }) { i, m ->
                        val older = items.getOrNull(i + 1)
                        val newer = items.getOrNull(i - 1)
                        val mine = m.authorId != null && m.authorId == vm.meId
                        // Ticks like the other messengers, shown where they change in a run of my messages (not on every one).
                        val seen = if (mine && !m.deleted) state.readState(m) else null
                        val newerMine = newer != null && newer.authorId == m.authorId && newer.type != "system" && !newer.deleted
                        val showSeen = seen != null && (!newerMine || state.readState(newer!!)::class != seen::class)
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (older == null || !sameDay(older.createdAt, m.createdAt)) DayChip(dayLabel(m.createdAt))
                            MessageRow(
                                m = m,
                                author = m.authorId?.let { state.members[it] },
                                mine = mine,
                                showName = older == null || older.authorId != m.authorId || older.type == "system" || !sameDay(older.createdAt, m.createdAt),
                                showAvatar = newer == null || newer.authorId != m.authorId || newer.type == "system",
                                members = state.members,
                                playing = playback.messageId == m.id && playback.playing,
                                progress = if (playback.messageId == m.id && playback.durationMs > 0) playback.positionMs.toFloat() / playback.durationMs else 0f,
                                onPlay = { vm.play(m) },
                                onLong = { if (!m.deleted && m.type != "system") sheetFor = m },
                                onOpen = { if (m.type == "video") playingVideo = m else viewing = m },
                                onReact = { vm.toggleReaction(m, it) },
                                meId = vm.meId,
                                highlighted = state.highlight == m.id,
                                vm = vm,
                                onGame = onGame,
                                onRecap = onRecap,
                                onDrawing = onDrawing,
                                seen = if (showSeen) seen else null,
                                direct = group?.direct == true,
                                onReply = if (state.muted || m.deleted) null else ({ reply(m) }),
                                onQuote = vm::showMessage,
                            )
                        }
                    }
                    if (state.loadingOlder) item(key = "older") {
                        Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(24.dp), color = c.primary, strokeWidth = 3.dp)
                        }
                    }
                }
            }
        }

        state.error?.let { err ->
            Text(
                err,
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                color = c.danger,
                modifier = Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.dangerBg)
                    .clickable(onClick = vm::dismissError).padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
        state.info?.let { info ->
            Text(
                info,
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                color = c.ink,
                modifier = Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.soft)
                    .clickable(onClick = vm::dismissInfo).padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
        if (!state.reachedEnd) {
            Text(
                tr("Revenir aux derniers messages"),
                style = MaterialTheme.typography.labelLarge,
                color = c.onPrimary,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(4.dp).clip(RoundedCornerShape(16.dp)).background(c.primary)
                    .clickable(role = Role.Button, onClick = vm::backToLatest).padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
        if (state.uploads > 0) {
            Text(
                tr("Envoi en cours…"),
                style = MaterialTheme.typography.labelMedium,
                color = c.muted,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
            )
        }

        state.replyingTo?.takeIf { !state.muted }?.let { r ->
            ReplyBar(r, state.members, vm.meId, onCancel = vm::cancelReply)
        }

        // Composer
        if (state.muted) {
            Row(
                Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 14.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(c.soft).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(PIcons.Mute, null, tint = c.muted)
                Text(tr("Un·e admin t’a mis·e en sourdine : tu peux lire mais pas écrire pour l’instant."), style = MaterialTheme.typography.bodyMedium, color = c.muted)
            }
        } else if (recording) {
            VoiceFilterChips(voiceFilter) { voiceFilter = it }
            RecordingBar(
                vm = vm,
                onCancel = {
                    vm.cancelVoice()
                    recording = false
                },
                onSend = {
                    vm.sendVoice(voiceFilter)
                    recording = false
                },
            )
        } else {
            // Text first; photo and drawing behind the "+" inside the field; voice or send on the right.
            Row(
                Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 14.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PapoteField(
                    text,
                    {
                        text = it
                        if (it.isNotBlank()) vm.typing()
                    },
                    modifier = Modifier.weight(1f).focusRequester(fieldFocus),
                    placeholder = tr("Écris un petit mot…"),
                    singleLine = false,
                    radius = 24.dp,
                    background = c.card,
                    label = "Message",
                    trailing = {
                        Box {
                            Box(
                                Modifier.size(34.dp).clip(CircleShape).background(if (attachOpen) c.primary else c.soft)
                                    .clickable(role = Role.Button) { attachOpen = !attachOpen }
                                    .semantics { contentDescription = tr("Plus d’options : photo, vidéo, fichier, story, dessin, GIF, sondage, position, jeu") },
                                contentAlignment = Alignment.Center,
                            ) { Icon(PIcons.Plus, null, tint = if (attachOpen) c.onPrimary else c.ink, modifier = Modifier.size(18.dp)) }
                        }
                    },
                )
                if (text.isBlank()) {
                    SquareIconButton(PIcons.Mic, tr("Enregistrer un vocal"), ::startRecording, background = c.primary, tint = c.onPrimary, size = 48.dp)
                } else {
                    SquareIconButton(PIcons.Send, tr("Envoyer"), {
                        vm.sendText(text)
                        text = ""
                    }, background = c.primary, tint = c.onPrimary, size = 48.dp)
                }
            }
        }
    }

    sheetFor?.let { m ->
        ModalBottomSheet(onDismissRequest = {
            sheetFor = null
            sheetPicker = false
        }, containerColor = c.card) {
            val mine = m.authorId == vm.meId
            val canDelete = mine || state.me?.isAdmin == true
            Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(tr("Réagir"), style = MaterialTheme.typography.titleLarge, color = c.ink)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    // The group's own quick reactions (Réglages du groupe).
                    for (key in group?.settings?.reactions ?: PIcons.Reactions.map { it.key }) {
                        val r = PIcons.reaction(key)
                        val on = vm.meId in (m.reactions[key] ?: emptyList())
                        if (r == null) {
                            Box(
                                Modifier.size(54.dp).clip(RoundedCornerShape(18.dp)).background(c.field)
                                    .border(3.dp, if (on) c.primary else Color.Transparent, RoundedCornerShape(18.dp))
                                    .clickable(role = Role.Button) {
                                        vm.toggleReaction(m, key)
                                        sheetFor = null
                                    },
                                contentAlignment = Alignment.Center,
                            ) { Text(key, fontSize = 26.sp) }
                            continue
                        }
                        Box(
                            Modifier.size(54.dp).clip(RoundedCornerShape(18.dp)).background(r.bg)
                                .border(3.dp, if (on) c.primary else Color.Transparent, RoundedCornerShape(18.dp))
                                .clickable(role = Role.Button) {
                                    vm.toggleReaction(m, r.key)
                                    sheetFor = null
                                }
                                .semantics { contentDescription = r.label + if (on) " (retirer)" else "" },
                            contentAlignment = Alignment.Center,
                        ) { Icon(r.icon, null, tint = r.fg, modifier = Modifier.size(26.dp)) }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    for (e in Emojis.quickReactions) {
                        val on = vm.meId in (m.reactions[e] ?: emptyList())
                        Box(
                            Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(if (on) c.soft else c.field)
                                .border(2.dp, if (on) c.primary else Color.Transparent, RoundedCornerShape(14.dp))
                                .clickable(role = Role.Button) {
                                    vm.toggleReaction(m, e)
                                    sheetFor = null
                                },
                            contentAlignment = Alignment.Center,
                        ) { Text(e, fontSize = 22.sp) }
                    }
                    Box(
                        Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(if (sheetPicker) c.soft else c.field)
                            .clickable(role = Role.Button) { sheetPicker = !sheetPicker }
                            .semantics { contentDescription = tr("Plus d’emoji") },
                        contentAlignment = Alignment.Center,
                    ) { Icon(PIcons.Plus, null, tint = c.ink, modifier = Modifier.size(20.dp)) }
                }
                if (sheetPicker) {
                    EmojiPicker({ e ->
                        vm.toggleReaction(m, e)
                        sheetFor = null
                        sheetPicker = false
                    }, height = 260.dp)
                }
                @Composable
                fun Action(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) = Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.field).clickable(role = Role.Button) {
                        sheetFor = null
                        onClick()
                    }.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(icon, null, tint = c.ink)
                    Text(label, style = MaterialTheme.typography.labelLarge, color = c.ink)
                }
                if (!state.muted) Action(PIcons.Reply, tr("Répondre")) { reply(m) }
                Action(PIcons.Pin, if (m.pinnedAt != null) tr("Désépingler") else tr("Épingler")) { vm.pin(m) }
                if (m.type in listOf("drawing", "photo", "gif")) Action(PIcons.Stamp, tr("En faire un sticker")) { vm.makeSticker(m) }
                if (m.type == "photo") Action(PIcons.Pencil, tr("Dessiner dessus")) { m.media?.url?.let { onDrawOver(m.id, it) } }
                if (canDelete) {
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.dangerBg)
                            .clickable(role = Role.Button) {
                                vm.delete(m)
                                sheetFor = null
                            }.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(PIcons.Trash, null, tint = c.danger)
                        Text(if (mine) tr("Supprimer mon message") else tr("Supprimer ce message"), style = MaterialTheme.typography.labelLarge, color = c.danger)
                    }
                }
            }
        }
    }

    if (attachOpen) AttachSheet(onClose = { attachOpen = false }, items = listOf(
        AttachItem(PIcons.Photo, tr("Photo et vidéo"), Color(0xFFFFC2D1)) { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
        AttachItem(PIcons.File, tr("Fichier"), Color(0xFFCFE3FF)) { pickFile.launch(arrayOf("*/*")) },
        AttachItem(PIcons.Sparkles, "Story", Color(0xFFFFE38A)) { pickStory.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        AttachItem(PIcons.Pencil, tr("Dessin"), Color(0xFFFFD3A8), onDraw),
        AttachItem(PIcons.Palette, tr("Toile commune"), Color(0xFFD9CCFF), onLive),
        AttachItem(PIcons.Gif, "GIF", Color(0xFFBFEBD7)) { gifSheet = true },
        AttachItem(PIcons.Poll, tr("Sondage"), Color(0xFFC9F0F5)) { pollSheet = true },
        AttachItem(PIcons.Location, tr("Position"), Color(0xFFFFCFC2)) { locationSheet = true },
        AttachItem(PIcons.Game, tr("Jeu"), Color(0xFFE3D5FF), onGames),
    ))
    playingVideo?.let { m -> VideoPlayer(m) { playingVideo = null } }
    if (pollSheet) PollSheet({ pollSheet = false }) { q, o, multi -> vm.sendPoll(q, o, multi) }
    if (locationSheet) LocationSheet({ locationSheet = false }) { lat, lon, acc, minutes, label -> vm.sendLocation(lat, lon, acc, minutes, label) }
    if (gifSheet) GifSheet(groupId, state.features.gifs, { gifSheet = false }, vm::sendGif, vm::sendSticker)
    storyAt?.let { i ->
        StoryViewer(state.stories, i, vm.meId) {
            storyAt = null
            vm.viewModelScope.launch { vm.refreshStories() }
        }
    }
    ConfettiOverlay(confetti)

    viewing?.let { m ->
        Dialog(onDismissRequest = { viewing = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.92f)).clickable { viewing = null }, contentAlignment = Alignment.Center) {
                AsyncImage(
                    model = PapoteApp.instance.mediaUrl(m.media?.url),
                    contentDescription = if (m.type == "drawing") tr("Dessin") else tr("Photo"),
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                )
                SquareIconButton(PIcons.Close, tr("Fermer"), { viewing = null }, Modifier.align(Alignment.TopEnd).padding(16.dp))
            }
        }
    }
}

@Composable
private fun DayChip(label: String) {
    val c = Papote.colors
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = c.muted,
            modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(c.soft).padding(horizontal = 12.dp, vertical = 4.dp),
        )
    }
}

/** One line about the message a reply answers ("Photo", "Vocal", the start of the text…). */
private fun replySnippet(type: String, text: String, deleted: Boolean): String {
    if (deleted) return tr("Message supprimé")
    val label = mapOf(
        "photo" to tr("Photo"), "video" to tr("Vidéo"), "file" to tr("Fichier"), "drawing" to tr("Dessin"), "voice" to tr("Vocal"), "gif" to "GIF", "sticker" to "Sticker",
        "location" to tr("Position"), "game" to tr("Partie de jeu"), "recap" to tr("Récap du mois"),
    )[type]
    return when {
        type == "poll" -> tr("Sondage « {} »", text)
        label != null -> if (text.isNotBlank()) "$label · $text" else label
        else -> text
    }
}

private fun nameOf(id: Long?, members: Map<Long, Member>, meId: Long?) =
    if (id != null && id == meId) tr("Toi") else id?.let { members[it]?.name } ?: tr("Ancien membre")

/** The bit of the answered message shown above a reply; tapping it goes to that message. */
@Composable
private fun ReplyQuote(r: ReplyPreview, members: Map<Long, Member>, meId: Long?, onClick: () -> Unit) {
    val c = Papote.colors
    val rt = tint(r.authorId?.let { members[it]?.color } ?: "lilas")
    val who = nameOf(r.authorId, members, meId)
    val snippet = replySnippet(r.type, r.text, r.deleted)
    Row(
        Modifier.widthIn(max = 260.dp).clip(RoundedCornerShape(12.dp)).background(c.soft)
            .clickable(role = Role.Button, onClickLabel = tr("Voir ce message"), onClick = onClick)
            .semantics { contentDescription = tr("En réponse à {} : {}", who, snippet) },
    ) {
        Box(Modifier.width(4.dp).height(40.dp).background(rt.tint))
        Column(Modifier.padding(horizontal = 10.dp, vertical = 4.dp)) {
            Text(who, style = MaterialTheme.typography.labelMedium, color = c.nameOf(rt), maxLines = 1)
            Text(snippet, style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Above the message field while answering a message. */
@Composable
private fun ReplyBar(m: Message, members: Map<Long, Member>, meId: Long?, onCancel: () -> Unit) {
    val c = Papote.colors
    val rt = tint(m.authorId?.let { members[it]?.color } ?: "lilas")
    Row(
        Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.width(4.dp).height(52.dp).background(rt.tint))
        Icon(PIcons.Reply, null, tint = c.primary, modifier = Modifier.size(18.dp))
        Column(Modifier.weight(1f)) {
            Text(tr("Répondre à {}", nameOf(m.authorId, members, meId)), style = MaterialTheme.typography.labelMedium, color = c.nameOf(rt), maxLines = 1)
            Text(replySnippet(m.type, m.text, m.deleted), style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        SquareIconButton(PIcons.Close, tr("Annuler la réponse"), onCancel, size = 36.dp)
        Spacer(Modifier.width(2.dp))
    }
}

private val ReadBlue = Color(0xFF2F8FE0)

/** ✓ sent, nobody has read it yet · ✓✓ read by some · blue ✓✓ read by everyone. */
@Composable
private fun SeenTicks(seen: ChatViewModel.ReadState, at: Long, direct: Boolean) {
    val c = Papote.colors
    val label = when (seen) {
        ChatViewModel.ReadState.Sent -> tr("Envoyé, pas encore lu")
        is ChatViewModel.ReadState.Some -> if (direct) tr("Lu") else tr("Lu par {} sur {}", seen.read, seen.of)
        ChatViewModel.ReadState.All -> if (direct) tr("Lu") else tr("Lu par tout le monde")
    }
    Row(
        Modifier.padding(horizontal = 4.dp).semantics(mergeDescendants = true) { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(timeOf(at), style = MaterialTheme.typography.labelSmall, color = c.muted)
        Icon(
            if (seen == ChatViewModel.ReadState.Sent) PIcons.Check else PIcons.Checks,
            null,
            tint = if (seen == ChatViewModel.ReadState.All) ReadBlue else c.muted,
            modifier = Modifier.size(15.dp),
        )
    }
}

@OptIn(ExperimentalFoundationApi::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun MessageRow(
    m: Message,
    author: Member?,
    mine: Boolean,
    showName: Boolean,
    showAvatar: Boolean,
    members: Map<Long, Member>,
    playing: Boolean,
    progress: Float,
    onPlay: () -> Unit,
    onLong: () -> Unit,
    onOpen: () -> Unit,
    onReact: (String) -> Unit,
    meId: Long?,
    highlighted: Boolean = false,
    vm: ChatViewModel? = null,
    onGame: (Long) -> Unit = {},
    onRecap: (String) -> Unit = {},
    onDrawing: (Long) -> Unit = {},
    seen: ChatViewModel.ReadState? = null,
    direct: Boolean = false,
    onReply: (() -> Unit)? = null,
    onQuote: (Long) -> Unit = {},
) {
    val c = Papote.colors
    if (m.type == "system") {
        val who = m.systemUserId?.let { members[it]?.name }
        Text(
            systemText(m, who),
            style = MaterialTheme.typography.bodySmall,
            color = c.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        )
        return
    }
    val t = tint(author?.color)
    val bubbleShape = if (mine) RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp) else RoundedCornerShape(20.dp, 20.dp, 20.dp, 6.dp)
    // Dragging a message to the right answers it, like in the other messengers.
    val scope = rememberCoroutineScope()
    val drag = remember { Animatable(0f) }
    val haptics = LocalHapticFeedback.current
    val threshold = with(LocalDensity.current) { 64.dp.toPx() }
    Box(
        Modifier.fillMaxWidth().then(
            if (onReply == null) Modifier else Modifier.pointerInput(m.id) {
                var armed = false
                detectHorizontalDragGestures(
                    onDragStart = { armed = false },
                    onDragEnd = {
                        if (drag.value >= threshold) onReply()
                        scope.launch { drag.animateTo(0f) }
                    },
                    onDragCancel = { scope.launch { drag.animateTo(0f) } },
                ) { change, amount ->
                    val next = (drag.value + amount).coerceIn(0f, threshold * 1.4f)
                    if (next > 0f) change.consume()
                    if (!armed && next >= threshold) {
                        armed = true
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    }
                    scope.launch { drag.snapTo(next) }
                }
            },
        ),
    ) {
        if (onReply != null) Box(
            Modifier.align(Alignment.CenterStart).size(32.dp).graphicsLayer {
                val p = (drag.value / threshold).coerceIn(0f, 1f)
                alpha = p
                scaleX = 0.5f + p / 2
                scaleY = 0.5f + p / 2
            }.clip(CircleShape).background(c.soft),
            contentAlignment = Alignment.Center,
        ) { Icon(PIcons.Reply, null, tint = c.primary, modifier = Modifier.size(18.dp)) }
        Row(
            Modifier.fillMaxWidth().offset { IntOffset(drag.value.roundToInt(), 0) },
            horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Bottom,
        ) {
            if (!mine) {
                if (showAvatar) Box {
                    Avatar(author?.name ?: "?", author?.color ?: "lilas", author?.photo, size = 32.dp, initialOnly = true, zoomable = true)
                    MoodBadge(author?.mood, Modifier.align(Alignment.BottomEnd).offset(4.dp, 4.dp))
                }
                else Spacer(Modifier.width(32.dp))
                Spacer(Modifier.width(8.dp))
            }
            Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (!mine && showName) {
                    Text(author?.name ?: tr("Ancien membre"), style = MaterialTheme.typography.labelMedium, color = c.nameOf(t), modifier = Modifier.padding(start = 4.dp))
                }
                m.reply?.takeIf { !m.deleted }?.let { r -> ReplyQuote(r, members, meId) { onQuote(r.id) } }
                val bigEmoji = m.type == "text" && !m.deleted && Emojis.isEmojiOnly(m.text)
                val bubbleBg = if (bigEmoji || (m.type == "sticker" && !m.deleted)) Color.Transparent else if (mine && m.type == "text") c.primary else c.card
                Box(
                    Modifier.widthIn(max = 260.dp).clip(bubbleShape).background(if (m.deleted) c.soft else bubbleBg)
                        .then(if (highlighted) Modifier.border(3.dp, c.primary, bubbleShape) else Modifier)
                        .combinedClickable(
                            onClick = {
                                when (m.type) {
                                    "drawing" -> onDrawing(m.id)
                                    "photo", "gif", "video" -> onOpen()
                                }
                            },
                            onLongClick = onLong,
                        ),
                ) {
                    when {
                        m.deleted -> Text(
                            tr("Message supprimé"),
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = c.muted,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        )
                        bigEmoji -> Text(m.text.trim(), fontSize = 44.sp, lineHeight = 52.sp, modifier = Modifier.padding(horizontal = 4.dp))
                        m.type == "text" -> Text(
                            m.text,
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (mine) c.onPrimary else c.ink,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        )
                        m.type == "photo" || m.type == "drawing" -> Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            val ratio = (m.width ?: 4).toFloat() / (m.height ?: 3).coerceAtLeast(1)
                            AsyncImage(
                                model = PapoteApp.instance.mediaUrl(m.media?.url),
                                contentDescription = if (m.type == "drawing") tr("Dessin de {}", author?.name ?: tr("quelqu’un")) else tr("Photo de {}", author?.name ?: tr("quelqu’un")),
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.width(220.dp).aspectRatio(ratio.coerceIn(0.6f, 1.8f)).clip(RoundedCornerShape(14.dp))
                                    .background(if (m.type == "drawing") Color(0xFFFFF8E6) else c.soft),
                            )
                            if (m.text.isNotBlank()) Text(m.text, style = MaterialTheme.typography.bodyLarge, color = c.ink, modifier = Modifier.padding(horizontal = 4.dp))
                            Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Icon(if (m.type == "drawing") PIcons.Pencil else PIcons.Photo, null, tint = c.muted, modifier = Modifier.size(14.dp))
                                Text(
                                    (if (m.type == "drawing") (if (m.metaBool("live")) tr("Toile commune · ") else tr("Dessin · ")) else tr("Photo · ")) + timeOf(m.createdAt),
                                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                                    color = c.muted,
                                )
                                m.expiresAt?.let { exp ->
                                    Icon(PIcons.Timer, null, tint = c.danger, modifier = Modifier.size(13.dp))
                                    Text("${((exp - System.currentTimeMillis()) / 3_600_000).coerceAtLeast(1)} h", style = MaterialTheme.typography.labelMedium, color = c.danger)
                                }
                            }
                        }
                        m.type == "video" -> VideoBubble(m)
                    m.type == "file" -> FileBubble(m)
                    m.type == "voice" -> VoiceBubble(m, t.tint, t.text, playing, progress, onPlay, vm)
                        m.type == "poll" -> PollBubble(m, members, meId, { vm?.vote(m, it) }, { vm?.closePoll(m) })
                        m.type == "location" -> LocationBubble(m, mine) { vm?.stopLocation(m) }
                        m.type == "gif" -> GifBubble(m, onOpen)
                        m.type == "sticker" -> StickerBubble(m)
                        m.type == "game" -> GameBubble(m, members, meId, onGame)
                        m.type == "recap" -> RecapBubble(m, onRecap)
                    }
                }
                if (seen != null) SeenTicks(seen, m.createdAt, direct)
                if (m.pinnedAt != null) Row(Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    Icon(PIcons.Pin, null, tint = c.primary, modifier = Modifier.size(12.dp))
                    Text(tr("Épinglé"), style = MaterialTheme.typography.labelSmall, color = c.primary)
                }
                if (m.reactions.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(horizontal = 6.dp)) {
                        for ((kind, users) in m.reactions) {
                            val r = PIcons.reaction(kind)
                            val on = meId in users
                            val bg = r?.bg ?: c.card
                            val fg = r?.fg ?: c.ink
                            Row(
                                Modifier.clip(RoundedCornerShape(10.dp)).background(bg)
                                    .border(2.dp, if (on) (r?.fg ?: c.primary).copy(alpha = 0.5f) else if (r == null) c.line else Color.Transparent, RoundedCornerShape(10.dp))
                                    .clickable(role = Role.Button) { onReact(kind) }
                                    .padding(horizontal = 8.dp, vertical = 2.dp)
                                    .semantics { contentDescription = "${r?.label ?: kind} : ${users.size}" + if (on) tr(", dont toi") else "" },
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                if (r != null) Icon(r.icon, null, tint = r.fg, modifier = Modifier.size(13.dp))
                                else Text(kind, fontSize = 13.sp)
                                Text("${users.size}", style = MaterialTheme.typography.labelMedium, color = fg)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceBubble(m: Message, tintBg: Color, tintFg: Color, playing: Boolean, progress: Float, onPlay: () -> Unit, vm: ChatViewModel?) {
    val c = Papote.colors
    var open by remember { mutableStateOf(false) }
    Column {
        VoiceRow(m, tintBg, tintFg, playing, progress, onPlay, vm)
        val filter = mapOf("souris" to "souris", "robot" to "robot", "echo" to tr("écho"), "geant" to tr("géant"))[m.metaString("filter")]
        if (filter != null || m.transcript != null || m.metaBool("transcribing")) {
            Row(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (filter != null) Text("Voix $filter", style = MaterialTheme.typography.labelSmall, color = c.primary, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(c.soft).padding(horizontal = 8.dp, vertical = 2.dp))
                if (m.metaBool("transcribing")) Text(tr("Transcription…"), style = MaterialTheme.typography.bodySmall, color = c.muted)
                if (m.transcript != null) Text(
                    if (open) tr("Masquer le texte") else tr("Voir le texte"),
                    style = MaterialTheme.typography.labelLarge,
                    color = c.primary,
                    modifier = Modifier.clickable(role = Role.Button) { open = !open },
                )
            }
        }
        if (open && m.transcript != null) {
            Column(Modifier.widthIn(max = 260.dp).padding(start = 14.dp, end = 14.dp, bottom = 12.dp)) {
                Text("« ${m.transcript} »", style = MaterialTheme.typography.bodyMedium.copy(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic), color = c.ink)
                Text(tr("Transcrit sur ton serveur"), style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
        }
    }
}

@Composable
private fun VoiceRow(m: Message, tintBg: Color, tintFg: Color, playing: Boolean, progress: Float, onPlay: () -> Unit, vm: ChatViewModel?) {
    val c = Papote.colors
    val bars = m.waveform.ifEmpty { List(24) { 30 + (it * 37 % 50) } }
    Row(
        Modifier.padding(start = 8.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(tintBg).clickable(role = Role.Button, onClick = onPlay)
                .semantics { contentDescription = if (playing) tr("Mettre en pause le vocal") else tr("Écouter le vocal") },
            contentAlignment = Alignment.Center,
        ) { Icon(if (playing) PIcons.Pause else PIcons.Play, null, tint = c.onPastel, modifier = Modifier.size(18.dp)) }
        Row(Modifier.height(32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            val played = (progress * bars.size).toInt()
            bars.take(28).forEachIndexed { i, v ->
                Box(
                    Modifier.width(3.dp).height((6 + v * 26 / 100).dp).clip(RoundedCornerShape(2.dp))
                        .background(if (i < played) (if (c.dark) tintBg else tintFg) else tintBg.copy(alpha = if (c.dark) 0.45f else 1f)),
                )
            }
        }
        Text(duration(m.durationMs ?: 0), style = MaterialTheme.typography.labelMedium, color = c.muted)
        if (vm != null) {
            val speed = PapoteApp.instance.session.voiceSpeed
            val label = "×" + (if (speed % 1f == 0f) speed.toInt().toString() else speed.toString().replace('.', ','))
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = c.primary,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(c.soft).clickable(role = Role.Button, onClick = vm::cycleSpeed)
                    .semantics { contentDescription = tr("Vitesse de lecture {}, changer", label) }.padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
    }
}

@Composable
private fun TypingRow(who: List<Member>, kind: String?) {
    if (who.isEmpty()) return
    val c = Papote.colors
    val names = who.joinToString(", ") { it.name }
    val verb = when (kind) {
        "draw" -> tr("dessine")
        "voice" -> tr("enregistre un vocal")
        else -> tr("écrit")
    }
    Row(Modifier.padding(start = 40.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier.clip(RoundedCornerShape(16.dp)).background(c.card).padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            listOf(0xFF8FB6EF, 0xFF6A9BE6, 0xFF4A7FD6).forEach { Box(Modifier.size(7.dp).clip(CircleShape).background(Color(it))) }
        }
        Text("$names $verb…", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold), color = c.muted)
    }
}

@Composable
private fun RecordingBar(vm: ChatViewModel, onCancel: () -> Unit, onSend: () -> Unit) {
    val c = Papote.colors
    val levels by vm.recorder.levels.collectAsStateWithLifecycle()
    val elapsed by vm.recorder.elapsed.collectAsStateWithLifecycle()
    Row(
        Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 14.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(c.dangerBg).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.size(44.dp).clip(CircleShape).background(c.card).clickable(role = Role.Button, onClick = onCancel)
                .semantics { contentDescription = tr("Annuler le vocal") },
            contentAlignment = Alignment.Center,
        ) { Icon(PIcons.Trash, null, tint = c.danger, modifier = Modifier.size(20.dp)) }
        Box(Modifier.size(10.dp).clip(CircleShape).background(Color(0xFFE0456A)))
        Text(duration(elapsed), fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.ink)
        Row(
            Modifier.weight(1f).heightIn(min = 28.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp, Alignment.End),
        ) {
            levels.takeLast(24).forEach { v ->
                Box(Modifier.width(3.dp).height((4 + v * 24 / 100).dp).clip(RoundedCornerShape(2.dp)).background(Color(0xFFE0456A)))
            }
        }
        Box(
            Modifier.size(48.dp).clip(CircleShape).background(c.primary).clickable(role = Role.Button, onClick = onSend)
                .semantics { contentDescription = tr("Envoyer le vocal") },
            contentAlignment = Alignment.Center,
        ) { Icon(PIcons.Send, null, tint = c.onPrimary, modifier = Modifier.size(22.dp)) }
    }
}
