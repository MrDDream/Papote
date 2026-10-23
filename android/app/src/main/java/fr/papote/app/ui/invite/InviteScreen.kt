package fr.papote.app.ui.invite

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.GroupSummary
import fr.papote.app.data.Invite
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.FieldLabel
import fr.papote.app.ui.components.GroupBadge
import fr.papote.app.ui.components.GroupLookPicker
import fr.papote.app.ui.chat.prepareImage
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.PapoteSwitch
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.Segmented
import fr.papote.app.ui.components.TintPicker
import fr.papote.app.ui.components.TopBar
import fr.papote.app.ui.shortWhen
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.tint
import kotlinx.coroutines.launch

private val EXPIRIES = listOf("1h" to "1 h", "24h" to "24 h", "7d" to "7 jours", "never" to "Jamais")

/** Creates a group (groupId == null) or invites people into an existing one. */
@Composable
fun InviteScreen(groupId: Long?, onBack: () -> Unit, onDone: (Long) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    var group by remember { mutableStateOf<GroupSummary?>(null) }
    var name by rememberSaveable { mutableStateOf("") }
    var color by rememberSaveable { mutableStateOf("rose") }
    var icon by rememberSaveable { mutableStateOf("heart") }
    var image by remember { mutableStateOf<android.net.Uri?>(null) }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) image = uri }
    var expiry by rememberSaveable { mutableStateOf("24h") }
    var single by rememberSaveable { mutableStateOf(false) }
    var invite by remember { mutableStateOf<Invite?>(null) }
    val active = remember { mutableStateListOf<Invite>() }
    var busy by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(groupId) {
        if (groupId != null) {
            try {
                group = app.api.group(groupId)
                active.clear()
                active += app.api.invites(groupId)
            } catch (e: ApiException) {
                error = e.message
            }
        }
    }

    fun generate() {
        busy = true
        error = null
        copied = false
        scope.launch {
            try {
                val g = group ?: app.api.createGroup(name.trim(), color, icon).let { created ->
                    // The picture goes up right after the group exists (it needs the group's id).
                    val img = image?.let { prepareImage(context, it) }
                    (if (img != null) app.api.setGroupPhoto(created.id, img.bytes) else created).also { group = it }
                }
                val inv = app.api.createInvite(g.id, expiry, single)
                invite = inv
                active.add(0, inv)
            } catch (e: ApiException) {
                error = e.message
            } catch (e: Exception) {
                error = "Cette image n’a pas pu être lue"
            } finally {
                busy = false
            }
        }
    }

    fun share(inv: Invite) {
        val server = app.session.server.orEmpty()
        val raw = inv.code.replace("-", "")
        val text = "Rejoins « ${group?.name ?: name} » sur Papote !\nServeur : $server\nCode : ${inv.code}\n\n" +
            "Sur ordinateur ou iPhone : $server/web/#/join?code=$raw\n" +
            "Sur Android : papote://join?server=${Uri.encode(server)}&code=$raw"
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Partager le code"))
    }

    val creating = groupId == null
    val created = group != null

    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        TopBar(if (creating) "Nouveau groupe" else "Inviter", onBack, subtitle = if (!creating) group?.name else null)

        if (creating) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.surfaceOf(tint(color))).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                GroupBadge(color, icon, size = 56.dp, photo = group?.photo ?: image?.toString())
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    FieldLabel("Nom du groupe")
                    if (created) {
                        Text(group!!.name, style = MaterialTheme.typography.titleMedium, color = c.ink)
                    } else {
                        PapoteField(name, { name = it.take(40) }, placeholder = "Soirée jeux", background = c.card, label = "Nom du groupe")
                    }
                }
            }
            if (!created) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FieldLabel("Couleur")
                    TintPicker(color, { color = it })
                }
                GroupLookPicker(
                    icon = icon,
                    onIcon = { icon = it },
                    hasImage = image != null,
                    onPickImage = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    onClearImage = { image = null },
                )
            }
        }

        // The code card
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(c.card).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Code d’invitation", style = MaterialTheme.typography.titleMedium, color = c.ink, modifier = Modifier.weight(1f))
                Text("Généré par ton serveur", style = MaterialTheme.typography.labelMedium, color = c.muted)
            }
            val inv = invite
            if (inv != null) {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(c.soft).padding(vertical = 14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(inv.code, fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 38.sp, letterSpacing = 4.sp, color = if (c.dark) c.ink else c.primaryDark)
                    Text(expiryText(inv), style = MaterialTheme.typography.bodySmall, color = c.muted)
                    // Scanned with any phone camera: opens the invitation (web), or Papote when scanned from Papote.
                    fr.papote.app.ui.extras.QrCode(fr.papote.app.ui.extras.inviteLink(app.session.server.orEmpty(), inv.code), 168.dp, Modifier.padding(top = 10.dp).clip(RoundedCornerShape(14.dp)))
                    Text("Fais scanner ce QR code pour rejoindre", style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryButton(if (copied) "Copié !" else "Copier", {
                        clipboard.setText(AnnotatedString(inv.code))
                        copied = true
                    }, Modifier.weight(1f), icon = if (copied) PIcons.Check else PIcons.Copy)
                    SecondaryButton("Partager", { share(inv) }, Modifier.weight(1f), icon = PIcons.Share)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FieldLabel("Le code expire")
                Segmented(EXPIRIES, expiry, { expiry = it })
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Usage unique", style = MaterialTheme.typography.labelLarge, color = c.ink)
                    Text("Le code ne marche qu’une fois", style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
                PapoteSwitch(single, { single = it }, "Usage unique")
            }
            if (created) {
                SecondaryButton(if (inv == null) "Générer un code" else "Générer un autre code", ::generate, Modifier.fillMaxWidth(), icon = PIcons.Plus, enabled = !busy)
            }
        }

        if (!creating && active.size > (if (invite != null) 1 else 0)) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.card).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("Codes encore valables", style = MaterialTheme.typography.titleMedium, color = c.ink)
                for (a in active.filter { it.code != invite?.code }) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(a.code, fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 18.sp, letterSpacing = 1.sp, color = if (c.dark) c.ink else c.primaryDark)
                            Text(expiryText(a), style = MaterialTheme.typography.bodySmall, color = c.muted)
                        }
                        SecondaryButton("Révoquer", {
                            scope.launch {
                                try {
                                    app.api.revokeInvite(a.code)
                                    active.remove(a)
                                } catch (e: ApiException) {
                                    error = e.message
                                }
                            }
                        }, danger = true, height = 40.dp)
                    }
                }
            }
        }

        ErrorText(error)
        Spacer(Modifier.weight(1f))
        when {
            !created -> PrimaryButton("Créer le groupe", ::generate, Modifier.fillMaxWidth(), enabled = name.isNotBlank(), loading = busy)
            creating -> PrimaryButton("Aller au groupe", { onDone(group!!.id) }, Modifier.fillMaxWidth(), icon = PIcons.Forward)
            invite == null -> PrimaryButton("Générer un code", ::generate, Modifier.fillMaxWidth(), loading = busy)
            else -> PrimaryButton("C’est bon", { onDone(group!!.id) }, Modifier.fillMaxWidth())
        }
        Spacer(Modifier.height(4.dp))
    }
}

private fun expiryText(inv: Invite): String {
    val uses = inv.maxUses?.let { "${inv.uses}/$it utilisation" } ?: if (inv.uses > 0) "${inv.uses} utilisation${if (inv.uses > 1) "s" else ""}" else "illimité"
    val exp = inv.expiresAt?.let {
        val mins = (it - System.currentTimeMillis()) / 60_000
        when {
            mins < 60 -> "expire dans $mins min"
            mins < 48 * 60 -> "expire dans ${mins / 60} h"
            else -> "expire le ${shortWhen(it).lowercase()}".let { s -> if (mins > 7 * 24 * 60) s else "expire dans ${mins / (24 * 60)} jours" }
        }
    } ?: "sans date limite"
    return "$exp · $uses"
}
