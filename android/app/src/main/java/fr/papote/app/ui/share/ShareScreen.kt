package fr.papote.app.ui.share

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.GroupSummary
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.GroupAvatar
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.TopBar
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.tint

/** Something another app shared with Papote ("Partager" → Papote): some text, a picture, or both. */
data class Shared(val text: String?, val image: Uri?)

/** "Partager dans Papote": pick the group or the person it goes to. */
@Composable
fun ShareScreen(shared: Shared, onBack: () -> Unit, onPick: (GroupSummary) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    var groups by remember { mutableStateOf<List<GroupSummary>?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            groups = app.api.groups()
        } catch (e: ApiException) {
            error = e.message
            groups = emptyList()
        }
    }

    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TopBar(tr("Partager dans Papote"), onBack, subtitle = tr("Choisis un groupe ou une personne"))
        Row(
            Modifier.fillMaxWidth().clip(pShape(18.dp)).background(c.soft).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (shared.image != null) {
                AsyncImage(shared.image, tr("Image partagée"), contentScale = ContentScale.Crop, modifier = Modifier.size(56.dp).clip(pShape(12.dp)))
            } else {
                Icon(PIcons.Share, null, tint = c.primary)
            }
            Text(shared.text?.takeIf { it.isNotBlank() } ?: tr("Une image"), style = MaterialTheme.typography.bodyMedium, color = c.ink, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        PapoteField(query, { query = it }, placeholder = tr("Chercher un groupe ou quelqu’un…"), leading = PIcons.Search, background = c.card, radius = 18.dp, label = tr("Chercher un groupe ou quelqu’un"))
        ErrorText(error)
        val list = groups
        if (list == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.primary) }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(list.filter { query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) }, key = { it.id }) { g ->
                    Row(
                        Modifier.fillMaxWidth().clip(pShape(20.dp)).background(c.surfaceOf(tint(g.color)))
                            .clickable(role = Role.Button, onClickLabel = tr("Envoyer ici")) { onPick(g) }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        GroupAvatar(g, size = 44.dp)
                        Column(Modifier.weight(1f)) {
                            Text(g.name, style = MaterialTheme.typography.titleMedium, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                if (g.direct) tr("Discussion à deux") else "${g.memberCount} membre${if (g.memberCount > 1) "s" else ""}",
                                style = MaterialTheme.typography.bodySmall,
                                color = c.muted,
                            )
                        }
                        Icon(PIcons.Send, null, tint = c.primary, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
}
