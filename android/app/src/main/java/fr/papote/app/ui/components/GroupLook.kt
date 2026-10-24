package fr.papote.app.ui.components

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote

/** Icon grid plus "own picture" choice, used when creating a group and in its settings. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GroupLookPicker(icon: String, onIcon: (String) -> Unit, hasImage: Boolean, onPickImage: () -> Unit, onClearImage: () -> Unit) {
    val c = Papote.colors
    Column(verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp)) {
        FieldLabel(if (hasImage) "Image" else tr("Icône ou image"))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton(if (hasImage) tr("Changer l’image") else tr("Choisir une image"), onPickImage, icon = PIcons.Image, height = 42.dp)
            if (hasImage) SecondaryButton(tr("Revenir à l’icône"), onClearImage, height = 42.dp)
        }
        if (!hasImage) {
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (key in PIcons.GroupIcons) {
                    val on = key == icon
                    Box(
                        Modifier.size(46.dp).clip(pShape(15.dp)).background(if (on) c.soft else c.card)
                            .border(2.dp, if (on) c.primary else c.line, pShape(15.dp))
                            .clickable(role = Role.RadioButton) { onIcon(key) }
                            .semantics {
                                contentDescription = tr("Icône {}", key)
                                stateDescription = if (on) "choisie" else ""
                            },
                        contentAlignment = Alignment.Center,
                    ) { Icon(PIcons.group(key), null, tint = c.ink, modifier = Modifier.size(22.dp)) }
                }
            }
        }
    }
}
