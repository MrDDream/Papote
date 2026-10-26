package fr.papote.app.ui.profile

import fr.papote.app.tr

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
private fun rememberEnabler(): () -> Unit {
    val app = PapoteApp.instance
    val context = LocalContext.current
    fun finish() {
        app.session.setBackground(true)
        if (!Notifier.ignoresBatteryOptimizations(context)) context.startActivity(Notifier.batteryIntent(context))
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
                    tr("Android impose alors une notification « Papote reste connecté » : tu peux la masquer, la connexion continue. ") +
                    tr("Sur certains téléphones, il faut aussi désactiver l’optimisation de batterie, sinon Android coupe la connexion."),
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
        // Android requires it while the connection runs; turning its channel off hides it, the service keeps going.
        if (r.background) {
            val hidden = remember(tick) { Notifier.connectionHidden(context) }
            StatusRow(
                PIcons.Bell,
                tr("Notification « Papote reste connecté »"),
                if (hidden) tr("Masquée : tu ne vois que les nouveaux messages") else tr("Visible en bas de tes notifications"),
                true,
                if (hidden) tr("Régler") else tr("Masquer"),
            ) { context.startActivity(Notifier.connectionSettingsIntent(context)) }
        }
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

/**
 * After signing in, like the other messengers: the system "Autoriser les notifications ?" once (Android 13+),
 * nothing else. Everything else is in Paramètres → Notifications.
 */
@Composable
fun NotificationPermissionRequest() {
    if (Build.VERSION.SDK_INT < 33) return
    val app = PapoteApp.instance
    val context = LocalContext.current
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (!app.session.notificationPermissionAsked && !Notifier.canNotify(context)) {
            app.session.notificationPermissionAsked = true
            ask.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
