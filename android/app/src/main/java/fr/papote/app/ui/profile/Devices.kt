package fr.papote.app.ui.profile

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Device
import fr.papote.app.data.User
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.shortWhen
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.lookOutline
import fr.papote.app.ui.theme.lookShadow
import kotlinx.coroutines.launch

private val CODE_CHARS = Regex("[A-HJ-NP-Z2-9]")

/** One settings block: a rounded card with its title. */
@Composable
fun SettingsCard(title: String, action: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = Papote.colors
    Column(
        Modifier.fillMaxWidth().lookShadow(pShape(28.dp), c.ink).clip(pShape(28.dp)).background(c.card)
            .lookOutline(pShape(28.dp), if (fr.papote.app.ui.theme.ActiveLook.value.dashed) c.muted else c.line).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = c.ink, modifier = Modifier.weight(1f))
            action?.invoke()
        }
        content()
    }
}

/** Small round "i" that opens an explanation instead of a paragraph on screen. */
@Composable
fun InfoButton(title: String, text: String) {
    val c = Papote.colors
    var open by remember { mutableStateOf(false) }
    Box(
        Modifier.size(36.dp).clip(CircleShape).clickable(role = Role.Button) { open = true }.semantics { contentDescription = tr("Plus d’infos : {}", title) },
        contentAlignment = Alignment.Center,
    ) { Icon(PIcons.Info, null, tint = c.muted, modifier = Modifier.size(20.dp)) }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            containerColor = c.card,
            title = { Text(title, style = MaterialTheme.typography.titleLarge, color = c.ink) },
            text = { Text(text, style = MaterialTheme.typography.bodyLarge, color = c.muted) },
            confirmButton = { TextButton(onClick = { open = false }) { Text(tr("Compris"), style = MaterialTheme.typography.labelLarge, color = c.primary) } },
        )
    }
}

@Composable
fun PersonalCodeCard() {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var code by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    var confirmRegen by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            code = app.api.personalCode().code
        } catch (e: ApiException) {
            error = e.message
        }
    }

    SettingsCard(
        tr("Mon code personnel"),
        action = {
            InfoButton(
                tr("Ton code personnel"),
                tr("Sur un autre appareil (téléphone, tablette, ordinateur), choisis « J’ai déjà un compte » puis entre l’adresse du serveur et ce code : ") +
                    tr("c’est ton compte qui s’ouvre, avec tes groupes. Il sert aussi à fusionner un compte créé en double.\n\n") +
                    tr("Garde-le pour toi : il sert de mot de passe. Si quelqu’un l’a vu, régénère-le."),
            )
        },
    ) {
        Column(
            Modifier.fillMaxWidth().clip(pShape(20.dp)).background(c.soft).padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(code ?: "…", fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 32.sp, letterSpacing = 3.sp, color = if (c.dark) c.ink else c.primaryDark)
            Text(app.session.server.orEmpty(), style = MaterialTheme.typography.bodySmall, color = c.muted)
            code?.let {
                fr.papote.app.ui.extras.QrCode(fr.papote.app.ui.extras.inviteLink(app.session.server.orEmpty(), it, personal = true), 150.dp, Modifier.padding(top = 10.dp).clip(pShape(14.dp)))
                Text(tr("À scanner depuis ton autre appareil (« J’ai déjà un compte »)"), style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton(if (copied) tr("Copié !") else tr("Copier"), {
                code?.let { clipboard.setText(AnnotatedString(it)) }
                copied = true
            }, Modifier.weight(1f), icon = if (copied) PIcons.Check else PIcons.Copy, height = 44.dp)
            SecondaryButton(tr("Régénérer"), { confirmRegen = true }, Modifier.weight(1f), height = 44.dp)
        }
        ErrorText(error)
    }

    if (confirmRegen) {
        AlertDialog(
            onDismissRequest = { confirmRegen = false },
            containerColor = c.card,
            title = { Text(tr("Régénérer ton code ?"), style = MaterialTheme.typography.titleLarge, color = c.ink) },
            text = {
                Text(
                    tr("L’ancien code ne marchera plus. Les appareils déjà connectés le restent : déconnecte-les ci-dessous si besoin."),
                    style = MaterialTheme.typography.bodyLarge,
                    color = c.muted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmRegen = false
                    scope.launch {
                        try {
                            code = app.api.regeneratePersonalCode().code
                            copied = false
                        } catch (e: ApiException) {
                            error = e.message
                        }
                    }
                }) { Text(tr("Régénérer"), style = MaterialTheme.typography.labelLarge, color = c.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmRegen = false }) { Text(tr("Annuler"), style = MaterialTheme.typography.labelLarge, color = c.ink) } },
        )
    }
}

/** "Mes appareils", and merging an account created by mistake. */
@Composable
fun DevicesCard(onMerged: (User) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<Device>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var merging by remember { mutableStateOf(false) }
    var revoking by remember { mutableStateOf<Device?>(null) }

    suspend fun reload() {
        try {
            devices = app.api.devices()
        } catch (e: ApiException) {
            error = e.message
        }
    }
    LaunchedEffect(Unit) { reload() }

    SettingsCard(tr("Mes appareils")) {
        for (d in devices) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(if (d.current || d.online) c.ok else c.line))
                Column(Modifier.weight(1f)) {
                    Text(d.label, style = MaterialTheme.typography.labelLarge, color = c.ink)
                    Text(
                        when {
                            d.current -> tr("Cet appareil")
                            d.online -> tr("Connecté en ce moment")
                            else -> tr("Utilisé {}", shortWhen(d.lastUsedAt).lowercase())
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = c.muted,
                    )
                }
                if (!d.current) SecondaryButton(tr("Déconnecter"), { revoking = d }, danger = true, height = 40.dp)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            SecondaryButton(tr("Fusionner avec mon autre compte"), { merging = true }, Modifier.weight(1f), icon = PIcons.People, height = 44.dp)
            InfoButton(
                tr("Fusionner deux comptes"),
                tr("Tu as rejoint avec une invitation sur un autre appareil et tu te retrouves avec deux comptes ? ") +
                    tr("Depuis le compte en trop, entre le code personnel du bon compte : groupes, messages et appareils y seront regroupés."),
            )
        }
        ErrorText(error)
    }

    if (merging) {
        MergeDialog(onDismiss = { merging = false }, onMerged = {
            merging = false
            scope.launch { reload() }
            onMerged(it)
        })
    }

    revoking?.let { d ->
        AlertDialog(
            onDismissRequest = { revoking = null },
            containerColor = c.card,
            title = { Text(tr("Déconnecter « {} » ?", d.label), style = MaterialTheme.typography.titleLarge, color = c.ink) },
            text = { Text(tr("Il faudra ton code personnel pour revenir sur cet appareil."), style = MaterialTheme.typography.bodyLarge, color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    revoking = null
                    scope.launch {
                        try {
                            app.api.revokeDevice(d.id)
                            reload()
                        } catch (e: ApiException) {
                            error = e.message
                        }
                    }
                }) { Text(tr("Déconnecter"), style = MaterialTheme.typography.labelLarge, color = c.danger) }
            },
            dismissButton = { TextButton(onClick = { revoking = null }) { Text(tr("Annuler"), style = MaterialTheme.typography.labelLarge, color = c.ink) } },
        )
    }
}

@Composable
private fun MergeDialog(onDismiss: () -> Unit, onMerged: (User) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    var totp by remember { mutableStateOf("") }
    var needsTotp by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val clean = input.uppercase().filter { CODE_CHARS.matches(it.toString()) }.take(8)

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        containerColor = c.card,
        title = { Text(tr("Fusionner avec mon autre compte"), style = MaterialTheme.typography.titleLarge, color = c.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    tr("Entre le code personnel de ton autre compte. Ce compte-ci y sera fondu ; tu garderas le nom et la photo de l’autre."),
                    style = MaterialTheme.typography.bodyLarge,
                    color = c.muted,
                )
                PapoteField(input, { input = it.take(9) }, placeholder = "ABCD-EF23", label = tr("Code personnel de l’autre compte"))
                if (needsTotp) {
                    PapoteField(totp, { totp = it.take(12) }, placeholder = tr("Code à 6 chiffres"), label = tr("Code de l’application d’authentification"))
                }
                Text(tr("C’est définitif."), style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold), color = c.danger)
                ErrorText(error)
            }
        },
        confirmButton = {
            TextButton(enabled = clean.length == 8 && !busy, onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        val res = app.api.merge(clean, totp.ifBlank { null })
                        app.session.switchUser(res.user.id)
                        onMerged(res.user)
                    } catch (e: ApiException) {
                        if (e.code == "totp_required") needsTotp = true
                        error = e.message
                    } finally {
                        busy = false
                    }
                }
            }) { Text(tr("Fusionner"), style = MaterialTheme.typography.labelLarge, color = if (clean.length == 8) c.danger else c.muted) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(tr("Annuler"), style = MaterialTheme.typography.labelLarge, color = c.ink) } },
    )
}
