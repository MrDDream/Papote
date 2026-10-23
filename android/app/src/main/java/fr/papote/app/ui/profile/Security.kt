package fr.papote.app.ui.profile

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Session
import fr.papote.app.data.TotpSetup
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.Segmented
import fr.papote.app.ui.lock.Biometric
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.ThemeStyle
import kotlinx.coroutines.launch

/** Account 2FA (asked when the personal code opens the account elsewhere) and the app lock. */
@Composable
fun SecurityCard(totpEnabled: Boolean, onTotpChanged: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val activity = LocalContext.current as FragmentActivity
    val session by app.session.state.collectAsStateWithLifecycle()
    var settingUpTotp by remember { mutableStateOf(false) }
    var disablingTotp by remember { mutableStateOf(false) }
    var settingPin by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    /** Changing or removing the lock first needs the current one. */
    fun confirmCurrent(then: () -> Unit) {
        when (session.lock) {
            Session.LockMode.Biometric -> Biometric.prompt(activity, "Confirmer", then)
            else -> then()
        }
    }

    SettingsCard("Sécurité") {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(PIcons.Shield, null, tint = if (totpEnabled) c.ok else c.muted)
            Column(Modifier.weight(1f)) {
                Text("Double authentification", style = MaterialTheme.typography.labelLarge, color = c.ink)
                Text(
                    if (totpEnabled) "Activée : un code est demandé en plus du code personnel" else "Désactivée",
                    style = MaterialTheme.typography.bodySmall,
                    color = c.muted,
                )
            }
            InfoButton(
                "Double authentification",
                "Quand ton code personnel sert à ouvrir ton compte sur un nouvel appareil, Papote demande aussi le code à 6 chiffres " +
                    "de ton application d’authentification (Aegis, 2FAS, Google Authenticator…). Quelqu’un qui verrait ton code personnel ne pourrait donc pas s’en servir seul.",
            )
        }
        if (totpEnabled) {
            SecondaryButton("Désactiver la double authentification", { disablingTotp = true }, Modifier.fillMaxWidth(), height = 44.dp, danger = true)
        } else {
            SecondaryButton("Activer la double authentification", { settingUpTotp = true }, Modifier.fillMaxWidth(), icon = PIcons.Shield, height = 44.dp)
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 6.dp)) {
            Icon(PIcons.Lock, null, tint = if (session.lock != Session.LockMode.None) c.ok else c.muted)
            Column(Modifier.weight(1f)) {
                Text("Verrouillage de l’app", style = MaterialTheme.typography.labelLarge, color = c.ink)
                Text("Demandé à l’ouverture de Papote", style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
        }
        Segmented(
            listOf(Session.LockMode.None to "Aucun", Session.LockMode.Pin to "Code", Session.LockMode.Biometric to "Empreinte"),
            session.lock,
            { mode ->
                error = null
                if (mode == session.lock) return@Segmented
                confirmCurrent {
                    when (mode) {
                        Session.LockMode.None -> app.session.setLock(Session.LockMode.None)
                        Session.LockMode.Pin -> settingPin = true
                        Session.LockMode.Biometric ->
                            if (Biometric.available(activity)) {
                                Biometric.prompt(activity, "Activer le verrouillage") { app.session.setLock(Session.LockMode.Biometric) }
                            } else {
                                error = "Aucune empreinte ni verrouillage d’écran configuré sur ce téléphone"
                            }
                    }
                }
            },
        )
        if (session.lock != Session.LockMode.None) {
            Text("Verrouiller après", style = MaterialTheme.typography.bodySmall, color = c.muted)
            Segmented(listOf(0 to "Tout de suite", 60 to "1 min", 300 to "5 min", 1800 to "30 min"), session.lockAfter, app.session::setLockAfter)
        }
        ErrorText(error)
    }

    if (settingUpTotp) TotpSetupDialog(onDismiss = { settingUpTotp = false }, onDone = onTotpChanged)
    if (disablingTotp) {
        CodeDialog(
            title = "Désactiver la double authentification",
            body = "Entre un code de ton application (ou un code de secours).",
            confirm = "Désactiver",
            onDismiss = { disablingTotp = false },
            action = { code ->
                app.api.disableTotp(code)
                onTotpChanged()
            },
        )
    }
    if (settingPin) PinSetupDialog(onDismiss = { settingPin = false })
}

@Composable
private fun TotpSetupDialog(onDismiss: () -> Unit, onDone: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var setup by remember { mutableStateOf<TotpSetup?>(null) }
    var code by remember { mutableStateOf("") }
    var recovery by remember { mutableStateOf<List<String>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            setup = app.api.startTotp()
        } catch (e: ApiException) {
            error = e.message
        }
    }

    val codes = recovery
    AlertDialog(
        onDismissRequest = { if (codes == null) onDismiss() },
        containerColor = c.card,
        title = { Text(if (codes == null) "Double authentification" else "Codes de secours", style = MaterialTheme.typography.titleLarge, color = c.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (codes != null) {
                    Text(
                        "Note-les maintenant (gestionnaire de mots de passe, papier…) : ils ne seront plus affichés. Chacun remplace une fois le code de l’application.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = c.muted,
                    )
                    Text(codes.joinToString("\n"), fontFamily = Baloo, fontSize = 18.sp, letterSpacing = 1.sp, color = c.ink)
                    SecondaryButton("Copier les codes", { clipboard.setText(AnnotatedString(codes.joinToString("\n"))) }, Modifier.fillMaxWidth(), icon = PIcons.Copy, height = 44.dp)
                } else {
                    val s = setup
                    Text("1. Ajoute Papote à ton application d’authentification :", style = MaterialTheme.typography.bodyMedium, color = c.muted)
                    if (s != null) {
                        SecondaryButton("Ouvrir l’application", {
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(s.url)))
                            } catch (_: ActivityNotFoundException) {
                                error = "Aucune application d’authentification installée : copie la clé à la main"
                            }
                        }, Modifier.fillMaxWidth(), icon = PIcons.Shield, height = 44.dp)
                        Text("ou saisis la clé :", style = MaterialTheme.typography.bodySmall, color = c.muted)
                        Text(s.secret.chunked(4).joinToString(" "), fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.ink)
                        SecondaryButton("Copier la clé", { clipboard.setText(AnnotatedString(s.secret)) }, Modifier.fillMaxWidth(), icon = PIcons.Copy, height = 40.dp)
                    }
                    Text("2. Entre le code à 6 chiffres qu’elle affiche :", style = MaterialTheme.typography.bodyMedium, color = c.muted)
                    PapoteField(code, { code = it.filter(Char::isDigit).take(6) }, placeholder = "123456", keyboardType = KeyboardType.Number, label = "Code à 6 chiffres")
                }
                ErrorText(error)
            }
        },
        confirmButton = {
            if (codes != null) {
                TextButton(onClick = {
                    onDone()
                    onDismiss()
                }) { Text("C’est noté", style = MaterialTheme.typography.labelLarge, color = c.primary) }
            } else {
                TextButton(enabled = code.length == 6, onClick = {
                    scope.launch {
                        try {
                            recovery = app.api.confirmTotp(code).recoveryCodes
                            error = null
                        } catch (e: ApiException) {
                            error = e.message
                        }
                    }
                }) { Text("Activer", style = MaterialTheme.typography.labelLarge, color = c.primary) }
            }
        },
        dismissButton = {
            if (codes == null) TextButton(onClick = onDismiss) { Text("Annuler", style = MaterialTheme.typography.labelLarge, color = c.ink) }
        },
    )
}

/** Asks for one code, runs [action], shows its error if any. */
@Composable
private fun CodeDialog(title: String, body: String, confirm: String, onDismiss: () -> Unit, action: suspend (String) -> Unit) {
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = c.card,
        title = { Text(title, style = MaterialTheme.typography.titleLarge, color = c.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(body, style = MaterialTheme.typography.bodyMedium, color = c.muted)
                PapoteField(code, { code = it.take(12) }, placeholder = "123456", label = title)
                ErrorText(error)
            }
        },
        confirmButton = {
            TextButton(enabled = code.isNotBlank(), onClick = {
                scope.launch {
                    try {
                        action(code.trim())
                        onDismiss()
                    } catch (e: ApiException) {
                        error = e.message
                    }
                }
            }) { Text(confirm, style = MaterialTheme.typography.labelLarge, color = c.danger) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler", style = MaterialTheme.typography.labelLarge, color = c.ink) } },
    )
}

@Composable
private fun PinSetupDialog(onDismiss: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    var first by remember { mutableStateOf("") }
    var second by remember { mutableStateOf("") }
    val mismatch = second.length >= 4 && second != first
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = c.card,
        title = { Text("Choisis un code", style = MaterialTheme.typography.titleLarge, color = c.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("4 à 6 chiffres, demandés à l’ouverture de Papote.", style = MaterialTheme.typography.bodyMedium, color = c.muted)
                PapoteField(first, { first = it.filter(Char::isDigit).take(6) }, placeholder = "Code", keyboardType = KeyboardType.NumberPassword, label = "Nouveau code")
                PapoteField(second, { second = it.filter(Char::isDigit).take(6) }, placeholder = "Encore une fois", keyboardType = KeyboardType.NumberPassword, label = "Confirmer le code")
                if (mismatch) ErrorText("Les deux codes ne sont pas identiques")
            }
        },
        confirmButton = {
            TextButton(enabled = first.length >= 4 && first == second, onClick = {
                app.session.setLock(Session.LockMode.Pin, first)
                onDismiss()
            }) { Text("Activer", style = MaterialTheme.typography.labelLarge, color = c.primary) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler", style = MaterialTheme.typography.labelLarge, color = c.ink) } },
    )
}

/** The complete looks, each previewed with its own colours. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StylePicker(selected: ThemeStyle, onPick: (ThemeStyle) -> Unit) {
    val c = Papote.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (style in ThemeStyle.entries) {
            val on = style == selected
            val p = if (c.dark) style.night else style.light
            Row(
                Modifier.clip(RoundedCornerShape(16.dp)).background(p.ground)
                    .border(2.dp, if (on) c.primary else c.line, RoundedCornerShape(16.dp))
                    .clickable(role = Role.RadioButton) { onPick(style) }
                    .semantics { stateDescription = if (on) "choisi" else "" }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(18.dp).clip(CircleShape).background(p.primary))
                Box(Modifier.size(12.dp).clip(CircleShape).background(p.soft))
                Text(style.label, style = MaterialTheme.typography.labelLarge, color = p.ink)
            }
        }
    }
}
