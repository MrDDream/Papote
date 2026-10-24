package fr.papote.app.ui.members

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Event
import fr.papote.app.data.GroupSummary
import fr.papote.app.data.Member
import fr.papote.app.data.jsonOf
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.GroupBadge
import fr.papote.app.ui.components.GroupLookPicker
import fr.papote.app.ui.chat.prepareImage
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.FieldLabel
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.components.TintPicker
import fr.papote.app.ui.components.TopBar
import fr.papote.app.ui.lastSeen
import fr.papote.app.ui.roleLabel
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import kotlinx.coroutines.launch

private sealed interface Confirm {
    data class Mute(val m: Member) : Confirm
    data class Remove(val m: Member) : Confirm
    data class Transfer(val m: Member) : Confirm
    data object Leave : Confirm
    data object Delete : Confirm
}

/** Members, roles and the group's own settings (name, colour, leave, delete). */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun MembersScreen(groupId: Long, onBack: () -> Unit, onInvite: () -> Unit, onLeft: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var group by remember { mutableStateOf<GroupSummary?>(null) }
    var members by remember { mutableStateOf<List<Member>>(emptyList()) }
    var open by remember { mutableStateOf<Long?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    var name by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("rose") }
    var icon by remember { mutableStateOf("heart") }
    val context = androidx.compose.ui.platform.LocalContext.current
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            try {
                group = app.api.setGroupPhoto(groupId, prepareImage(context, uri).bytes)
            } catch (e: ApiException) {
                error = e.message
            } catch (e: Exception) {
                error = tr("Cette image n’a pas pu être lue")
            }
        }
    }

    suspend fun reload() {
        try {
            val g = app.api.group(groupId)
            group = g
            name = g.name
            color = g.color
            icon = g.icon
            members = app.api.members(groupId)
        } catch (e: ApiException) {
            if (e.code == "group_not_found") onLeft() else error = e.message
        }
    }

    LaunchedEffect(groupId) {
        reload()
        app.realtime.events.collect { e ->
            when (e) {
                is Event.MemberJoined, is Event.MemberLeft, is Event.MemberUpdated, is Event.MemberPending, is Event.GroupUpdated, is Event.GroupRefresh -> reload()
                is Event.Presence -> members = members.map { if (it.id == e.userId) it.copy(online = e.online) else it }
                is Event.GroupRemoved -> if (e.groupId == groupId) onLeft()
                else -> Unit
            }
        }
    }

    fun act(block: suspend () -> Unit) {
        error = null
        scope.launch {
            try {
                block()
                reload()
            } catch (e: ApiException) {
                error = e.message
            }
        }
    }

    val meId = app.session.userId
    val me = members.firstOrNull { it.id == meId }
    val g = group

    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        val direct = g?.direct == true
        TopBar(
            if (direct) tr("Discussion") else tr("Membres"),
            onBack,
            subtitle = g?.let { it.name + if (me?.isOwner == true && !direct) tr(" · tu l’as créé") else "" },
        ) {
            if (!direct && (g?.settings?.anyoneInvites != false || me?.isAdmin == true)) SquareIconButton(PIcons.PersonPlus, tr("Inviter quelqu’un"), onInvite, background = c.primary, tint = c.onPrimary)
        }
        val waiting = members.filter { it.pending }
        if (me?.isAdmin == true && waiting.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().clip(pShape(24.dp)).background(c.soft).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(tr("Veulent rejoindre"), style = MaterialTheme.typography.titleMedium, color = c.ink)
                for (m in waiting) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Avatar(m.name, m.color, m.photo, size = 40.dp, initialOnly = true)
                    Column(Modifier.weight(1f)) {
                        Text(m.name, style = MaterialTheme.typography.labelLarge, color = c.ink)
                        Text(tr("attend que tu valides"), style = MaterialTheme.typography.bodySmall, color = c.muted)
                    }
                    SecondaryButton(tr("Refuser"), { act { app.api.refuse(groupId, m.id) } }, height = 40.dp)
                    SecondaryButton(tr("Accepter"), { act { app.api.approve(groupId, m.id) } }, height = 40.dp, icon = PIcons.Check)
                }
            }
        }
        if (!direct && g != null && (g.settings.anyoneInvites || me?.isAdmin == true)) {
            // Inviting is the first thing people come here for: make it obvious.
            SecondaryButton(tr("Inviter quelqu’un dans le groupe"), onInvite, Modifier.fillMaxWidth(), icon = PIcons.PersonPlus)
        }
        Text(if (direct) tr("Avec") else tr("Membres"), style = MaterialTheme.typography.titleMedium, color = c.ink)

        Column(Modifier.fillMaxWidth().clip(pShape(24.dp)).background(c.card).padding(8.dp)) {
            for (m in members.filter { !it.pending }) {
                val isOpen = open == m.id
                val canManage = me != null && m.id != meId && !m.isOwner && (me.isOwner || (me.isAdmin && m.role == "member"))
                Row(
                    Modifier.fillMaxWidth().clip(pShape(18.dp))
                        .clickable(enabled = canManage || me?.isOwner == true && m.id != meId, role = Role.Button) { open = if (isOpen) null else m.id }
                        .semantics { stateDescription = if (isOpen) tr("actions affichées") else "" }
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Avatar(m.name, m.color, m.photo, size = 44.dp, online = m.online, zoomable = true)
                    Column(Modifier.weight(1f)) {
                        Text(m.name + if (m.id == meId) " (toi)" else "", style = MaterialTheme.typography.titleMedium, color = c.ink)
                        Text(
                            listOfNotNull(if ((m.mutedUntil ?: 0) > System.currentTimeMillis()) tr("en sourdine") else null, lastSeen(m), m.bio.takeIf { it.isNotBlank() }).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = c.muted,
                            maxLines = 1,
                        )
                    }
                    Row(
                        Modifier.clip(pShape(10.dp)).background(if (m.isAdmin) c.soft else c.field).padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        if (m.isOwner) Icon(PIcons.Crown, null, tint = c.muted, modifier = Modifier.size(14.dp))
                        Text(roleLabel(m.role), style = MaterialTheme.typography.labelMedium, color = c.muted)
                    }
                }
                if (isOpen && me != null) {
                    FlowRow(
                        Modifier.fillMaxWidth().padding(start = 66.dp, end = 10.dp, bottom = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (me.isOwner) {
                            SecondaryButton(
                                if (m.role == "admin") tr("Retirer admin") else tr("Nommer admin"),
                                { act { app.api.setRole(groupId, m.id, if (m.role == "admin") "member" else "admin") } },
                                height = 40.dp,
                            )
                            SecondaryButton(tr("Lui confier le groupe"), { confirm = Confirm.Transfer(m) }, height = 40.dp)
                        }
                        if (canManage && !direct) {
                            if ((m.mutedUntil ?: 0) > System.currentTimeMillis()) SecondaryButton(tr("Rendre la parole"), { act { app.api.unmute(groupId, m.id) } }, height = 40.dp)
                            else SecondaryButton(tr("Rendre muet·te"), { confirm = Confirm.Mute(m) }, height = 40.dp, icon = PIcons.Mute)
                        }
                        if (canManage) SecondaryButton(tr("Retirer du groupe"), { confirm = Confirm.Remove(m) }, danger = true, height = 40.dp)
                    }
                }
            }
        }

        if (me?.isAdmin == true && g != null && !direct) {
            Column(
                Modifier.fillMaxWidth().clip(pShape(24.dp)).background(c.card).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(tr("Règles du groupe"), style = MaterialTheme.typography.titleMedium, color = c.ink, modifier = Modifier.weight(1f))
                    Text("(admins seulement)", style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
                for ((key, label, on) in listOf(
                    Triple("anyoneInvites", tr("Tout le monde peut inviter"), g.settings.anyoneInvites),
                    Triple("adminsTheme", tr("Seuls les admins changent le thème"), g.settings.adminsTheme),
                    Triple("approval", tr("Valider les nouveaux membres"), g.settings.approval),
                )) Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(label, Modifier.weight(1f), color = c.ink)
                    fr.papote.app.ui.components.PapoteSwitch(on, { v -> act { app.api.groupSettings(groupId, jsonOf(key to v)) } }, label)
                }
            }
            Column(
                Modifier.fillMaxWidth().clip(pShape(24.dp)).background(c.card).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    GroupBadge(color, icon, size = 48.dp, photo = g.photo)
                    Text(tr("Le groupe"), style = MaterialTheme.typography.titleMedium, color = c.ink)
                }
                FieldLabel(tr("Nom"))
                PapoteField(name, { name = it.take(40) }, label = tr("Nom du groupe"))
                FieldLabel(tr("Couleur"))
                TintPicker(color, { color = it })
                GroupLookPicker(
                    icon = icon,
                    onIcon = { icon = it },
                    hasImage = g.photo != null,
                    onPickImage = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    onClearImage = { act { app.api.deleteGroupPhoto(groupId) } },
                )
                if (name.trim() != g.name || color != g.color || icon != g.icon) {
                    SecondaryButton(tr("Enregistrer"), {
                        act { app.api.updateGroup(groupId, jsonOf("name" to name.trim(), "color" to color, "icon" to icon)) }
                    }, Modifier.fillMaxWidth(), icon = PIcons.Check)
                }
            }
        }

        ErrorText(error)
        Spacer(Modifier.height(4.dp))
        SecondaryButton(if (direct) tr("Quitter la discussion") else tr("Quitter le groupe"), { confirm = Confirm.Leave }, Modifier.fillMaxWidth(), icon = PIcons.Exit, danger = true)
        if (me?.isOwner == true && !direct) {
            SecondaryButton(tr("Supprimer le groupe pour tout le monde"), { confirm = Confirm.Delete }, Modifier.fillMaxWidth(), icon = PIcons.Trash, danger = true)
        }
    }

    confirm?.let { what ->
        if (what is Confirm.Mute) {
            AlertDialog(
                onDismissRequest = { confirm = null },
                containerColor = c.card,
                title = { Text(tr("Rendre {} muet·te", what.m.name), style = MaterialTheme.typography.titleLarge, color = c.ink) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(tr("{} pourra lire le groupe, mais pas y écrire.", what.m.name), color = c.muted)
                        for ((d, l) in listOf("1h" to "Pendant 1 heure", "24h" to "Pendant 24 heures", "7d" to "Pendant 7 jours", "forever" to tr("Jusqu’à nouvel ordre"))) {
                            SecondaryButton(l, {
                                confirm = null
                                act { app.api.mute(groupId, what.m.id, d) }
                            }, Modifier.fillMaxWidth(), height = 44.dp)
                        }
                    }
                },
                confirmButton = {},
                dismissButton = { TextButton(onClick = { confirm = null }) { Text(tr("Annuler"), style = MaterialTheme.typography.labelLarge, color = c.ink) } },
            )
            return@let
        }
        val (title, body) = when (what) {
            is Confirm.Remove -> "Retirer ${what.m.name} ?" to tr("{} ne verra plus les messages du groupe.", what.m.name)
            is Confirm.Transfer -> tr("Confier le groupe à {} ?", what.m.name) to tr("Tu deviendras admin, et {} aura le dernier mot sur le groupe.", what.m.name)
            Confirm.Leave -> tr("Quitter le groupe ?") to (if (me?.isOwner == true) tr("Le groupe sera confié à un autre membre. ") else "") + tr("Il te faudra un nouveau code pour revenir.")
            Confirm.Delete -> tr("Supprimer le groupe ?") to tr("Le groupe disparaîtra pour tout le monde. L’admin du serveur pourra encore le restaurer pendant 30 jours, puis il sera effacé avec ses messages et ses médias.")
            is Confirm.Mute -> "" to ""
        }
        AlertDialog(
            onDismissRequest = { confirm = null },
            containerColor = c.card,
            title = { Text(title, style = MaterialTheme.typography.titleLarge, color = c.ink) },
            text = { Text(body, style = MaterialTheme.typography.bodyLarge, color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    when (what) {
                        is Confirm.Remove -> act { app.api.removeMember(groupId, what.m.id) }
                        is Confirm.Transfer -> act { app.api.setRole(groupId, what.m.id, "owner") }
                        Confirm.Leave -> scope.launch {
                            try {
                                app.api.leaveGroup(groupId)
                                onLeft()
                            } catch (e: ApiException) {
                                error = e.message
                            }
                        }
                        is Confirm.Mute -> Unit
                        Confirm.Delete -> scope.launch {
                            try {
                                app.api.deleteGroup(groupId)
                                onLeft()
                            } catch (e: ApiException) {
                                error = e.message
                            }
                        }
                    }
                }) { Text(tr("Confirmer"), style = MaterialTheme.typography.labelLarge, color = c.danger) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(tr("Annuler"), style = MaterialTheme.typography.labelLarge, color = c.ink) } },
        )
    }
}
