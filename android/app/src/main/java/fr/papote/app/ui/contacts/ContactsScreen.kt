package fr.papote.app.ui.contacts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.User
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.TopBar
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import kotlinx.coroutines.launch

/** "Nouvelle discussion": anyone from your groups, one tap to a two-person conversation. */
@Composable
fun ContactsScreen(onBack: () -> Unit, onOpen: (Long) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var contacts by remember { mutableStateOf<List<User>?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var opening by remember { mutableStateOf<Long?>(null) }

    LaunchedEffect(Unit) {
        try {
            contacts = app.api.contacts()
        } catch (e: ApiException) {
            error = e.message
            contacts = emptyList()
        }
    }

    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TopBar("Nouvelle discussion", onBack, subtitle = "Avec une personne de tes groupes")
        PapoteField(query, { query = it }, placeholder = "Chercher quelqu’un…", leading = PIcons.Search, background = c.card, radius = 18.dp, label = "Chercher quelqu’un")
        ErrorText(error)
        val list = contacts
        when {
            list == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.primary) }
            list.isEmpty() -> Text(
                "Personne pour l’instant : invite quelqu’un dans un groupe, puis tu pourras lui écrire ici.",
                style = MaterialTheme.typography.bodyLarge,
                color = c.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(24.dp),
            )
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(list.filter { query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) }, key = { it.id }) { u ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(c.card)
                            .clickable(enabled = opening == null, role = Role.Button) {
                                opening = u.id
                                scope.launch {
                                    try {
                                        onOpen(app.api.direct(u.id).id)
                                    } catch (e: ApiException) {
                                        error = e.message
                                    } finally {
                                        opening = null
                                    }
                                }
                            }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(u.name, u.color, u.photo, size = 44.dp, online = u.online)
                        Column(Modifier.weight(1f)) {
                            Text(u.name, style = MaterialTheme.typography.titleMedium, color = c.ink)
                            if (u.bio.isNotBlank()) {
                                Text(u.bio, style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        if (opening == u.id) CircularProgressIndicator(Modifier.padding(4.dp), color = c.primary, strokeWidth = 3.dp)
                    }
                }
            }
        }
    }
}
