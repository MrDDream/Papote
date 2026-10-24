package fr.papote.app.ui.chat

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import fr.papote.app.PapoteApp
import fr.papote.app.data.Message
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.duration
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.timeOf

data class AttachItem(val icon: ImageVector, val label: String, val color: Color, val onClick: () -> Unit)

/** The "+" of the message field: a grid of round, coloured icons (like the other messengers). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachSheet(onClose: () -> Unit, items: List<AttachItem>) {
    val c = Papote.colors
    ModalBottomSheet(onDismissRequest = onClose, containerColor = c.card) {
        Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            for (row in items.chunked(4)) {
                Row(Modifier.fillMaxWidth()) {
                    for (item in row) {
                        Column(
                            Modifier.weight(1f).clip(pShape(18.dp))
                                .clickable(role = Role.Button) {
                                    onClose()
                                    item.onClick()
                                }
                                .padding(vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Box(Modifier.size(56.dp).clip(pShape(20.dp)).background(item.color), contentAlignment = Alignment.Center) {
                                Icon(item.icon, null, tint = Color(0xFF2E2442), modifier = Modifier.size(26.dp))
                            }
                            Text(item.label, style = MaterialTheme.typography.labelMedium, color = c.ink, textAlign = TextAlign.Center, maxLines = 2)
                        }
                    }
                    repeat(4 - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A video in the conversation: its shape, a big play button and its length; tapping opens the player. */
@Composable
fun VideoBubble(m: Message) {
    val c = Papote.colors
    val ratio = ((m.width ?: 16).toFloat() / (m.height ?: 9).coerceAtLeast(1)).coerceIn(0.56f, 1.8f)
    Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier.width(220.dp).aspectRatio(ratio).clip(pShape(14.dp)).background(Color(0xFF1C1628)),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(52.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.9f)), contentAlignment = Alignment.Center) {
                Icon(PIcons.Play, tr("Lire la vidéo"), tint = Color(0xFF2E2442), modifier = Modifier.size(26.dp))
            }
        }
        if (m.text.isNotBlank()) Text(m.text, style = MaterialTheme.typography.bodyLarge, color = c.ink, modifier = Modifier.padding(horizontal = 4.dp))
        Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(PIcons.Video, null, tint = c.muted, modifier = Modifier.size(14.dp))
            Text(
                tr("Vidéo") + (m.durationMs?.let { " · ${duration(it)}" } ?: "") + " · " + timeOf(m.createdAt),
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                color = c.muted,
            )
        }
    }
}

/** A document: its name and size; tapping downloads it (Android's notification then opens it). */
@Composable
fun FileBubble(m: Message) {
    val c = Papote.colors
    val context = LocalContext.current
    val name = m.metaString("name") ?: "fichier"
    val size = m.metaLong("size")
    Row(
        Modifier.widthIn(min = 200.dp, max = 260.dp).clickable(role = Role.Button, onClickLabel = tr("Télécharger")) { download(context, m, name) }
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .semantics(mergeDescendants = true) { contentDescription = "Fichier $name, ${fileSize(size)}" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(42.dp).clip(pShape(12.dp)).background(Color(0xFFCFE3FF)), contentAlignment = Alignment.Center) {
            Icon(PIcons.File, null, tint = Color(0xFF2E2442), modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.labelLarge, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOf(fileSize(size), timeOf(m.createdAt)).filter { it.isNotEmpty() }.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.muted)
        }
        Icon(PIcons.Download, null, tint = c.primary, modifier = Modifier.size(20.dp))
    }
}

private fun download(context: Context, m: Message, name: String) {
    val app = PapoteApp.instance
    val url = app.mediaUrl(m.media?.url) ?: return
    val safe = name.replace(Regex("""[\\/:*?"<>|]"""), "_")
    val request = DownloadManager.Request(Uri.parse(url))
        .addRequestHeader("Authorization", "Bearer ${app.session.token}")
        .setTitle(name)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
    // Android 10+: straight into Téléchargements/Papote; before, the app's own folder (no permission needed).
    if (Build.VERSION.SDK_INT >= 29) request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Papote/$safe")
    else request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, safe)
    runCatching { context.getSystemService(DownloadManager::class.java).enqueue(request) }
        .onSuccess { Toast.makeText(context, tr("Téléchargement de « {} »…", name), Toast.LENGTH_SHORT).show() }
        .onFailure { Toast.makeText(context, tr("Téléchargement impossible"), Toast.LENGTH_SHORT).show() }
}

/** Full-screen player; the session token goes with the request, like for pictures. */
@Composable
fun VideoPlayer(m: Message, onClose: () -> Unit) {
    val app = PapoteApp.instance
    val url = app.mediaUrl(m.media?.url) ?: return onClose()
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            AndroidView(
                factory = { ctx ->
                    VideoView(ctx).apply {
                        val controller = MediaController(ctx)
                        controller.setAnchorView(this)
                        setMediaController(controller)
                        setVideoURI(Uri.parse(url), mapOf("Authorization" to "Bearer ${app.session.token}"))
                        setOnPreparedListener { start() }
                        setOnErrorListener { _, _, _ ->
                            Toast.makeText(ctx, tr("Lecture impossible"), Toast.LENGTH_SHORT).show()
                            true
                        }
                    }
                },
                onRelease = { it.stopPlayback() },
                modifier = Modifier.fillMaxWidth(),
            )
            SquareIconButton(PIcons.Close, tr("Fermer"), onClose, Modifier.align(Alignment.TopEnd).padding(16.dp))
        }
    }
}
