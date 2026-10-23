package fr.papote.app.ui.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.User
import fr.papote.app.data.jsonOf
import fr.papote.app.ui.chat.prepareImage
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.FieldLabel
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.Segmented
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.components.TintPicker
import fr.papote.app.ui.components.TopBar
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.ThemeMode
import kotlinx.coroutines.launch

private val MONTHS = listOf("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre")

/** "--03-14" or "1990-03-14" → "14/03". */
private fun birthdayToField(b: String?): String {
    val m = Regex("""-(\d{2})-(\d{2})$""").find(b ?: return "") ?: return ""
    return "${m.groupValues[2]}/${m.groupValues[1]}"
}

/** "14/03", "14-3", "14 3" → "--03-14"; blank → null; anything else → error. */
private fun fieldToBirthday(s: String): Result<String?> {
    val t = s.trim()
    if (t.isEmpty()) return Result.success(null)
    val m = Regex("""^(\d{1,2})\s*[/.\- ]\s*(\d{1,2})$""").find(t) ?: return Result.failure(IllegalArgumentException())
    val (d, mo) = m.destructured
    val day = d.toInt()
    val month = mo.toInt()
    if (month !in 1..12 || day !in 1..31) return Result.failure(IllegalArgumentException())
    return Result.success("--%02d-%02d".format(month, day))
}

@Composable
fun ProfileScreen(onBack: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session by app.session.state.collectAsStateWithLifecycle()

    var me by remember { mutableStateOf<User?>(null) }
    var name by remember { mutableStateOf("") }
    var bio by remember { mutableStateOf("") }
    var birthday by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("rose") }
    var busy by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun fill(u: User) {
        me = u
        name = u.name
        bio = u.bio
        birthday = birthdayToField(u.birthday)
        color = u.color
    }

    LaunchedEffect(Unit) {
        try {
            fill(app.api.me())
        } catch (e: ApiException) {
            error = e.message
        }
    }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            try {
                val img = prepareImage(context, uri)
                fill(app.api.setPhoto(img.bytes, "image/jpeg"))
            } catch (e: ApiException) {
                error = e.message
            } catch (e: Exception) {
                error = "Cette image n’a pas pu être lue"
            } finally {
                busy = false
            }
        }
    }

    val u = me
    val dirty = u != null && (name.trim() != u.name || bio.trim() != u.bio || birthday != birthdayToField(u.birthday) || color != u.color)

    fun save() {
        val bday = fieldToBirthday(birthday).getOrElse {
            error = "Anniversaire : écris le jour puis le mois, par exemple 14/03"
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                fill(app.api.updateMe(jsonOf("name" to name.trim(), "bio" to bio.trim(), "birthday" to bday, "color" to color)))
                saved = true
            } catch (e: ApiException) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        TopBar("Paramètres", onBack)

        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(c.card).padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box {
                Avatar(name, color, u?.photo, size = 88.dp)
                SquareIconButton(
                    PIcons.Photo, "Changer la photo de profil",
                    { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    Modifier.align(Alignment.BottomEnd).padding(0.dp),
                    background = c.primary, tint = c.onPrimary, size = 36.dp,
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Image de profil", style = MaterialTheme.typography.labelLarge, color = c.ink)
                if (u?.photo != null) {
                    SecondaryButton("Revenir à la frimousse", {
                        scope.launch {
                            try {
                                fill(app.api.deletePhoto())
                            } catch (e: ApiException) {
                                error = e.message
                            }
                        }
                    }, height = 40.dp)
                } else {
                    Text("Ta frimousse prend ta couleur. Touche l’appareil photo pour mettre une photo.", style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
            }
        }

        SettingsCard("Mon profil") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                FieldLabel("Mon petit nom")
                PapoteField(name, { name = it.take(40); saved = false }, label = "Mon petit nom")
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                FieldLabel("Ma petite phrase")
                PapoteField(bio, { bio = it.take(140); saved = false }, placeholder = "Fan de pop-corn et de dessins ratés", label = "Ma petite phrase")
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                FieldLabel("Anniversaire")
                PapoteField(
                    birthday, { birthday = formatBirthdayInput(it); saved = false },
                    placeholder = "JJ/MM", keyboardType = KeyboardType.Number, imeAction = ImeAction.Done, label = "Anniversaire, jour et mois",
                )
                fieldToBirthday(birthday).getOrNull()?.let { b ->
                    val (mo, d) = b.removePrefix("--").split("-").map { it.toInt() }
                    Text("Le $d ${MONTHS[mo - 1]}", style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FieldLabel("Ma couleur")
                TintPicker(color, { color = it; saved = false })
            }
            ErrorText(error)
            if (dirty || saved) {
                PrimaryButton(if (saved && !dirty) "Enregistré !" else "Enregistrer", ::save, Modifier.fillMaxWidth(), enabled = dirty && name.isNotBlank(), loading = busy)
            }
        }

        PersonalCodeCard()
        DevicesCard(onMerged = ::fill)
        SecurityCard(totpEnabled = u?.totp == true, onTotpChanged = { scope.launch { runCatching { fill(app.api.me()) } } })

        SettingsCard("Apparence") {
            Text("Style", style = MaterialTheme.typography.labelLarge, color = c.ink)
            StylePicker(session.style, app.session::setStyle)
            Text("Mode", style = MaterialTheme.typography.labelLarge, color = c.ink)
            Segmented(listOf(ThemeMode.Light to "Clair", ThemeMode.Dark to "Sombre", ThemeMode.Auto to "Auto"), session.theme, app.session::setTheme)
        }

        NotificationsCard()

        SettingsCard("Serveur") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(c.ok))
                Column(Modifier.weight(1f)) {
                    Text(session.server?.substringAfter("://").orEmpty(), style = MaterialTheme.typography.labelLarge, color = c.ink)
                    Text("Papote auto-hébergé", style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
            }
            SecondaryButton("Se déconnecter", {
                scope.launch {
                    runCatching { app.api.logout() }
                    app.session.logout()
                }
            }, Modifier.fillMaxWidth(), icon = PIcons.Logout, danger = true)
        }
    }
}

/** Digits only, "/" added after the day: 1 4 0 3 → "14/03". */
private fun formatBirthdayInput(raw: String): String {
    val d = raw.filter { it.isDigit() }.take(4)
    return if (d.length > 2) "${d.take(2)}/${d.drop(2)}" else d
}
