package fr.papote.app.ui.profile

import fr.papote.app.tr

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import fr.papote.app.PapoteApp
import fr.papote.app.service.Notifier
import fr.papote.app.ui.components.PapoteSwitch
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote

/** What has to be on for messages to arrive while Papote is closed. */
private data class Readiness(val background: Boolean, val notifications: Boolean, val battery: Boolean) {
    val all get() = background && notifications && battery
}

@Composable
private fun rememberReadiness(): Readiness {
    val app = PapoteApp.instance
    val context = LocalContext.current
    val session by app.session.state.collectAsStateWithLifecycle()
    // Re-read the system state each time we come back from its settings screens.
    var tick by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { tick++ }
    return remember(tick, session.background) {
        Readiness(session.background, Notifier.canNotify(context), Notifier.ignoresBatteryOptimizations(context))
    }
}

/** Turns everything on: notification permission, background connection, then the battery exemption. */
@Composable
private fun rememberEnabler(onDone: () -> Unit = {}): () -> Unit {
    val app = PapoteApp.instance
    val context = LocalContext.current
    fun finish() {
        app.session.setBackground(true)
        if (!Notifier.ignoresBatteryOptimizations(context)) context.startActivity(Notifier.batteryIntent(context))
        onDone()
    }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { finish() }
    return {
        if (Build.VERSION.SDK_INT >= 33 && !Notifier.canNotify(context)) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) else finish()
    }
}

@Composable
fun NotificationsCard() {
    val app = PapoteApp.instance
    val c = Papote.colors
    val context = LocalContext.current
    val r = rememberReadiness()
    val enable = rememberEnabler()
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    SettingsCard(
        tr("Notifications et batterie"),
        action = {
            InfoButton(
                tr("Recevoir les messages app fermée"),
                tr("Papote n’utilise pas les services de Google : pour te prévenir des nouveaux messages, l’app garde une connexion ouverte avec ton serveur. ") +
                    tr("Android affiche alors une petite notification discrète « Papote reste connecté ». ") +
                    tr("Il faut aussi autoriser Papote à tourner en arrière-plan (optimisation de batterie désactivée), sinon Android coupe la connexion."),
            )
        },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Text(tr("Recevoir les messages app fermée"), style = MaterialTheme.typography.labelLarge, color = c.ink)
                Text(if (r.background) tr("Connexion gardée en arrière-plan") else tr("Seulement quand Papote est ouvert"), style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
            PapoteSwitch(r.background, { on -> if (on) enable() else app.session.setBackground(false) }, tr("Recevoir les messages app fermée"))
        }
        StatusRow(
            PIcons.Bell,
            tr("Notifications"),
            if (r.notifications) tr("Autorisées") else tr("Bloquées : tu ne verras pas les nouveaux messages"),
            r.notifications,
            if (r.notifications) tr("Régler") else tr("Autoriser"),
        ) {
            if (!r.notifications && Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            else context.startActivity(Notifier.notificationSettingsIntent(context))
        }
        // Like the other messengers: a pop-up at the top of the screen, and bubbles (Android 11+).
        var tick by remember { mutableIntStateOf(0) }
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { tick++ }
        val popsUp = remember(tick) { Notifier.popsUp(context) }
        val bubbles = remember(tick) { Notifier.bubblesAllowed(context) }
        if (r.notifications) StatusRow(
            PIcons.Bell,
            tr("Pop-up en haut de l’écran"),
            if (popsUp) tr("Les nouveaux messages s’affichent par-dessus ce que tu fais") else tr("Désactivé : les messages arrivent seulement dans la barre de notification"),
            popsUp,
            if (popsUp) null else tr("Activer"),
        ) { context.startActivity(Notifier.channelSettingsIntent(context)) }
        if (r.notifications && Build.VERSION.SDK_INT >= 30) StatusRow(
            PIcons.Chat,
            tr("Bulles de discussion"),
            if (bubbles) tr("Touche l’icône de bulle d’une notification pour garder la discussion à portée de main") else tr("Une petite bulle flottante pour répondre sans ouvrir l’appli"),
            bubbles,
            if (bubbles) tr("Régler") else tr("Activer"),
        ) { context.startActivity(Notifier.bubbleSettingsIntent(context)) }
        StatusRow(
            PIcons.Battery,
            tr("Optimisation de batterie"),
            if (r.battery) tr("Désactivée pour Papote") else tr("Active : Android peut couper Papote en arrière-plan"),
            r.battery,
            if (r.battery) null else tr("Désactiver"),
        ) { context.startActivity(Notifier.batteryIntent(context)) }
    }
}

@Composable
private fun StatusRow(icon: ImageVector, title: String, detail: String, ok: Boolean, action: String?, onAction: () -> Unit) {
    val c = Papote.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, null, tint = if (ok) c.ok else c.danger)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.labelLarge, color = c.ink)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = c.muted)
        }
        if (action != null) SecondaryButton(action, onAction, height = 40.dp)
    }
}

private var promptShownThisLaunch = false

/** At launch, once per app start, when something keeps messages from arriving app closed. */
@Composable
fun NotificationPrompt() {
    val app = PapoteApp.instance
    val c = Papote.colors
    val r = rememberReadiness()
    var visible by remember { mutableStateOf(!promptShownThisLaunch && !app.session.notificationPromptOff && !r.all) }
    fun close() {
        promptShownThisLaunch = true
        visible = false
    }
    val enable = rememberEnabler(onDone = ::close)
    if (!visible) return
    AlertDialog(
        onDismissRequest = ::close,
        containerColor = c.card,
        icon = { Icon(PIcons.Bell, null, tint = c.primary) },
        title = { Text(tr("Recevoir tes messages"), style = MaterialTheme.typography.titleLarge, color = c.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    tr("Pour être prévenu·e des nouveaux messages même quand Papote est fermé, autorise les notifications et laisse Papote tourner en arrière-plan."),
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.muted,
                )
                TextButton(onClick = {
                    app.session.notificationPromptOff = true
                    close()
                }, modifier = Modifier.fillMaxWidth()) {
                    Text(tr("Ne plus me demander"), style = MaterialTheme.typography.labelLarge, color = c.muted)
                }
            }
        },
        confirmButton = { TextButton(onClick = enable) { Text(tr("Activer"), style = MaterialTheme.typography.labelLarge, color = c.primary) } },
        dismissButton = { TextButton(onClick = ::close) { Text(tr("Plus tard"), style = MaterialTheme.typography.labelLarge, color = c.ink) } },
    )
}
