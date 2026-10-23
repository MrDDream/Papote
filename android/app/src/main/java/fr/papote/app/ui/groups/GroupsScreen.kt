package fr.papote.app.ui.groups

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.border
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Event
import fr.papote.app.data.GroupSummary
import fr.papote.app.data.User
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.GroupAvatar
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import fr.papote.app.ui.components.Mascot
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.preview
import fr.papote.app.ui.shortWhen
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.tint
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class GroupsViewModel : ViewModel() {
    private val app = PapoteApp.instance

    data class State(
        val me: User? = null,
        val groups: List<GroupSummary> = emptyList(),
        /** Groups that still have to approve me. */
        val waiting: List<fr.papote.app.data.PendingGroup> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
    )

    val state = MutableStateFlow(State())
    val connected = app.realtime.connected
    private var pending: Job? = null

    init {
        refresh()
        viewModelScope.launch {
            app.realtime.events.collect { e ->
                when (e) {
                    is Event.NewMessage, is Event.UpdatedMessage, is Event.GroupUpdated, is Event.GroupRemoved,
                    is Event.MemberJoined, is Event.MemberLeft, is Event.GroupRead, is Event.GroupRefresh, is Event.GroupApproved, Event.Reconnected -> refreshSoon()
                    is Event.UserUpdated -> if (e.user.id == app.session.userId) state.update { it.copy(me = e.user) }
                    else -> Unit
                }
            }
        }
    }

    // Bursts of events (a group of people chatting) collapse into one reload.
    private fun refreshSoon() {
        pending?.cancel()
        pending = viewModelScope.launch {
            delay(300)
            refresh()
        }
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                val me = app.api.me()
                val groups = app.api.groups()
                val waiting = runCatching { app.api.pendingGroups() }.getOrDefault(emptyList())
                state.update { it.copy(me = me, groups = groups, waiting = waiting, loading = false, error = null) }
            } catch (e: ApiException) {
                state.update { it.copy(loading = false, error = e.message) }
            }
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun GroupsScreen(onOpen: (Long) -> Unit, onJoinCode: () -> Unit, onNewGroup: () -> Unit, onProfile: () -> Unit, onContacts: () -> Unit) {
    val vm: GroupsViewModel = viewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    val connected by vm.connected.collectAsStateWithLifecycle()
    val c = Papote.colors
    var query by rememberSaveable { mutableStateOf("") }
    val server = PapoteApp.instance.session.server?.substringAfter("://")

    // Coming back from a chat: unread counts changed.
    LaunchedEffect(Unit) { vm.refresh() }

    var filter by rememberSaveable { mutableStateOf(GroupFilter.All) }
    val visible = state.groups.filter {
        (query.isBlank() || it.name.contains(query.trim(), ignoreCase = true)) &&
            when (filter) {
                GroupFilter.All -> true
                GroupFilter.Groups -> !it.direct
                GroupFilter.Direct -> it.direct
                GroupFilter.Unread -> it.unread > 0
            }
    }

    Column(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val me = state.me
            Box(Modifier.size(48.dp).clip(CircleShape).background(c.card).padding(3.dp)) {
                Avatar(me?.name.orEmpty(), me?.color ?: "rose", me?.photo, size = 42.dp)
            }
            Column(Modifier.weight(1f)) {
                Text(
                    if (me != null) "Coucou ${me.name} !" else "Coucou !",
                    style = MaterialTheme.typography.headlineMedium,
                    color = c.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(if (connected) c.ok else c.line))
                    Text(
                        if (connected) "Connecté·e à $server" else "Connexion à $server…",
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal),
                        color = c.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            SquareIconButton(PIcons.ChatPlus, "Nouvelle discussion avec quelqu’un", onContacts)
            SquareIconButton(PIcons.Settings, "Paramètres", onProfile)
        }

        PapoteField(query, { query = it }, placeholder = "Chercher…", leading = PIcons.Search, background = c.card, radius = 18.dp, label = "Chercher un groupe ou une discussion")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (f in GroupFilter.entries) {
                val on = f == filter
                val n = when (f) {
                    GroupFilter.Unread -> state.groups.count { it.unread > 0 }
                    else -> null
                }
                Text(
                    f.label + (n?.takeIf { it > 0 }?.let { " · $it" } ?: ""),
                    style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp),
                    color = if (on) c.onPrimary else c.ink,
                    modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(if (on) c.primary else c.card)
                        .clickable(role = Role.RadioButton) { filter = f }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
        ErrorText(state.error)

        PullToRefreshBox(isRefreshing = false, onRefresh = vm::refresh, modifier = Modifier.weight(1f)) {
            when {
                state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.primary) }
                state.groups.isEmpty() -> EmptyGroups()
                visible.isEmpty() -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.TopCenter) {
                    Text("Rien ici avec ce filtre.", style = MaterialTheme.typography.bodyLarge, color = c.muted)
                }
                else -> LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(state.waiting, key = { "w${it.id}" }) { w ->
                        Row(
                            Modifier.fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(22.dp)).background(Papote.colors.card)
                                .then(Modifier.border(2.dp, Papote.colors.line, androidx.compose.foundation.shape.RoundedCornerShape(22.dp))).padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            fr.papote.app.ui.components.GroupBadge(w.color, w.icon, size = 40.dp)
                            Column(Modifier.weight(1f)) {
                                Text(w.name, style = MaterialTheme.typography.titleMedium, color = Papote.colors.ink)
                                Text("En attente : un·e admin du groupe doit valider ton arrivée", style = MaterialTheme.typography.bodySmall, color = Papote.colors.muted)
                            }
                        }
                    }
                    items(visible, key = { it.id }) { g -> GroupCard(g, state.me?.id, onClick = { onOpen(g.id) }) }
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
            PrimaryButton("Nouveau groupe", onNewGroup, Modifier.weight(1.15f), textSize = 17.sp)
            SecondaryButton("Rejoindre", onJoinCode, Modifier.weight(0.85f).padding(bottom = 5.dp), icon = PIcons.Keypad, height = 56.dp)
        }
    }
}

private enum class GroupFilter(val label: String) { All("Tous"), Groups("Groupes"), Direct("Discussions"), Unread("Non lus") }

@Composable
private fun EmptyGroups() {
    val c = Papote.colors
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Mascot(width = 96.dp)
        Spacer(Modifier.height(12.dp))
        Text("Pas encore de groupe", style = MaterialTheme.typography.titleLarge, color = c.ink)
        Text(
            "Crée le tien et partage son code, ou entre celui qu’on t’a donné.",
            style = MaterialTheme.typography.bodyLarge,
            color = c.muted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun GroupCard(g: GroupSummary, meId: Long?, onClick: () -> Unit) {
    val c = Papote.colors
    val t = tint(g.color)
    val last = g.lastMessage
    val author = if (last?.authorId != null && last.authorId == meId) "Toi" else g.lastAuthorName
    val kindIcon = when (last?.type) {
        "drawing" -> PIcons.Pencil
        "voice" -> PIcons.Mic
        "photo" -> PIcons.Photo
        else -> PIcons.Text
    }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.surfaceOf(t))
            .clickable(role = Role.Button, onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        GroupAvatar(g)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(g.name, style = MaterialTheme.typography.titleMedium, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(shortWhen(last?.createdAt ?: g.createdAt), style = MaterialTheme.typography.labelMedium, color = c.muted)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(kindIcon, null, tint = c.muted, modifier = Modifier.size(16.dp))
                Text(
                    last?.let { if (g.direct && author != "Toi" && it.type == "text") it.text else preview(it, author) }
                        ?: if (g.direct) "Dis bonjour !" else "${g.memberCount} membre${if (g.memberCount > 1) "s" else ""}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (g.unread > 0) {
                    Box(
                        Modifier.defaultMinSize(24.dp, 24.dp).clip(RoundedCornerShape(12.dp)).background(c.primary).padding(horizontal = 7.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (g.unread > 99) "99+" else "${g.unread}", style = MaterialTheme.typography.labelMedium, color = c.onPrimary)
                    }
                }
            }
        }
    }
}
