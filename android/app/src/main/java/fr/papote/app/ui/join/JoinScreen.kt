package fr.papote.app.ui.join

import fr.papote.app.tr

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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import fr.papote.app.PapoteApp
import fr.papote.app.data.Api
import fr.papote.app.data.ApiException
import fr.papote.app.data.Session
import fr.papote.app.ui.components.Blob
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.FieldLabel
import fr.papote.app.ui.components.Mascot
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.components.TintPicker
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import kotlinx.coroutines.launch

private val CODE_CHARS = Regex("[A-HJ-NP-Z2-9]")

/** What a scanned QR code holds: an invitation or a personal code link, with its server. */
private data class Scanned(val server: String?, val code: String, val personal: Boolean)

private fun parseScan(text: String): Scanned? {
    val uri = runCatching { android.net.Uri.parse(text.trim()) }.getOrNull() ?: return null
    if (uri.scheme == "papote") return uri.getQueryParameter("code")?.let { Scanned(uri.getQueryParameter("server"), it, false) }
    if (uri.scheme == "http" || uri.scheme == "https") {
        // …/web/#/join?link=1&code=ABCD2345: the query is inside the fragment.
        val q = android.net.Uri.parse("x://x?" + (uri.fragment?.substringAfter('?', "") ?: ""))
        val code = q.getQueryParameter("code") ?: return null
        val server = "${uri.scheme}://${uri.authority}"
        return Scanned(server, code, q.getQueryParameter("link") == "1")
    }
    val raw = text.uppercase().filter { CODE_CHARS.matches(it.toString()) }
    return if (raw.length == 6 || raw.length == 8) Scanned(null, raw, raw.length == 8) else null
}

@Composable
fun JoinScreen(initialServer: String, initialCode: String, onBack: (() -> Unit)?, onJoined: (Long?) -> Unit) {
    val app = PapoteApp.instance
    val session by app.session.state.collectAsStateWithLifecycle()
    val loggedIn = session.loggedIn
    val c = Papote.colors
    val scope = rememberCoroutineScope()

    var server by rememberSaveable { mutableStateOf(initialServer.ifBlank { session.server.orEmpty() }) }
    var code by rememberSaveable { mutableStateOf(cleanCode(initialCode)) }
    var name by rememberSaveable { mutableStateOf("") }
    var color by rememberSaveable { mutableStateOf("rose") }
    // "J'ai déjà un compte": a one-time code from another of my devices instead of an invitation.
    var linking by rememberSaveable { mutableStateOf(false) }
    var totp by rememberSaveable { mutableStateOf("") }
    var needsTotp by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Joining another server than the one we are logged into would need a second account: not supported.
    val serverLocked = loggedIn
    val normalized = Session.normalizeServer(server)
    val ready = normalized != null && code.length == (if (linking) 8 else 6) && (loggedIn || linking || name.isNotBlank())

    val scanner = androidx.activity.compose.rememberLauncherForActivityResult(com.journeyapps.barcodescanner.ScanContract()) { result ->
        val text = result.contents ?: return@rememberLauncherForActivityResult
        val scanned = parseScan(text)
        if (scanned == null) {
            error = tr("Ce QR code n’est pas une invitation Papote")
            return@rememberLauncherForActivityResult
        }
        scanned.server?.let { server = it }
        if (!loggedIn) linking = scanned.personal
        code = cleanCode(scanned.code, if (scanned.personal && !loggedIn) 8 else 6)
        error = null
    }

    fun submit() {
        val base = normalized ?: return
        busy = true
        error = null
        scope.launch {
            try {
                val sameServer = base == session.server
                val api = Api(app.http, { base }, { if (sameServer) app.session.token else null })
                api.server()
                if (linking) {
                    val res = api.link(code, totp.ifBlank { null })
                    app.session.login(base, res.token ?: error("no token"), res.user.id)
                    onJoined(null)
                } else {
                    val res = api.join(code, name.trim().ifBlank { null }, color)
                    if (res.token != null) app.session.login(base, res.token, res.user.id)
                    onJoined(res.groupId)
                }
            } catch (e: ApiException) {
                if (e.code == "totp_required" || e.code == "totp_invalid") needsTotp = true
                error = if (e.code == "network" || e.status == 404 && e.code.startsWith("http")) {
                    tr("Pas de serveur Papote à cette adresse")
                } else {
                    e.message
                }
            } finally {
                busy = false
            }
        }
    }

    Box(Modifier.fillMaxSize().imePadding()) {
        Blob(Color(0xFFFFE3C7).copy(alpha = if (c.dark) 0.18f else 1f), 220.dp, Modifier.align(Alignment.TopEnd).offset(70.dp, (-60).dp))
        Blob(Color(0xFFCDEFE0).copy(alpha = if (c.dark) 0.18f else 1f), 110.dp, Modifier.offset((-50).dp, 120.dp))
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            if (onBack != null) SquareIconButton(PIcons.Back, tr("Retour"), onBack)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Mascot()
                Text("Papote", style = MaterialTheme.typography.displaySmall, color = c.ink)
                Text(
                    when {
                        loggedIn -> tr("Entre le code qu’on t’a donné pour rejoindre un groupe.")
                        linking -> tr("Retrouve ton compte avec ton code personnel : il est dans Paramètres → « Mon code personnel » sur ton autre appareil.")
                        else -> tr("Tes petits groupes à toi, sur ton propre serveur.")
                    },
                    style = MaterialTheme.typography.bodyLarge.copy(fontSize = 16.sp),
                    color = c.muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.width(290.dp),
                )
            }

            Column(
                Modifier.fillMaxWidth().shadow(0.dp).clip(RoundedCornerShape(28.dp)).background(c.card).padding(horizontal = 18.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    FieldLabel(tr("Adresse du serveur"))
                    if (serverLocked) {
                        Text(server, style = MaterialTheme.typography.bodyLarge, color = c.muted, modifier = Modifier.padding(vertical = 6.dp))
                    } else {
                        PapoteField(
                            server, { server = it.trim() },
                            placeholder = "https://papote.mondomaine.fr",
                            keyboardType = KeyboardType.Uri,
                            label = tr("Adresse du serveur"),
                        )
                        if (normalized?.startsWith("http://") == true) {
                            Text(tr("Connexion non chiffrée : à réserver au réseau local."), style = MaterialTheme.typography.bodySmall, color = c.muted)
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    FieldLabel(if (linking) tr("Mon code personnel") else tr("Code d’invitation"))
                    CodeInput(code, { code = it }, length = if (linking) 8 else 6)
                }
                if (linking && needsTotp) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FieldLabel(tr("Code de ton application d’authentification"))
                        PapoteField(
                            totp, { totp = it.take(12) },
                            placeholder = tr("123456 ou code de secours"),
                            keyboardType = KeyboardType.Ascii,
                            label = tr("Code de double authentification"),
                        )
                    }
                }
                if (!loggedIn && !linking) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FieldLabel(tr("Ton petit nom"))
                        PapoteField(name, { name = it.take(40) }, placeholder = "Lou", label = tr("Ton petit nom"), imeAction = ImeAction.Done, onIme = { if (ready) submit() })
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        FieldLabel(tr("Ta frimousse"))
                        TintPicker(color, { color = it }, face = true)
                    }
                }
                ErrorText(error)
            }

            Spacer(Modifier.weight(1f))
            PrimaryButton(if (linking) tr("Me connecter") else tr("Rejoindre"), ::submit, Modifier.fillMaxWidth(), enabled = ready, loading = busy, icon = PIcons.Forward)
            fr.papote.app.ui.components.SecondaryButton(tr("Scanner un QR code"), {
                scanner.launch(
                    com.journeyapps.barcodescanner.ScanOptions()
                        .setDesiredBarcodeFormats(com.journeyapps.barcodescanner.ScanOptions.QR_CODE)
                        .setPrompt(tr("Vise le QR code d’invitation"))
                        .setBeepEnabled(false)
                        .setOrientationLocked(false),
                )
            }, Modifier.fillMaxWidth(), icon = PIcons.Scan)
            if (!loggedIn) {
                Text(
                    if (linking) tr("Je suis nouveau·elle ici") else tr("J’ai déjà un compte sur un autre appareil"),
                    style = MaterialTheme.typography.labelLarge.copy(fontSize = 15.sp),
                    color = if (c.dark) c.ink else c.primaryDark,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp))
                        .clickable(role = Role.Button) {
                            linking = !linking
                            needsTotp = false
                            totp = ""
                            code = ""
                            error = null
                        }
                        .padding(vertical = 14.dp),
                )
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}

private fun cleanCode(s: String, length: Int = 6) = s.uppercase().filter { CODE_CHARS.matches(it.toString()) }.take(length)

/** Boxes backed by one hidden field, so typing, deleting and pasting "K7P-2Q9" all just work. */
@Composable
private fun CodeInput(code: String, onChange: (String) -> Unit, length: Int = 6) {
    val c = Papote.colors
    val focus = remember { FocusRequester() }
    BasicTextField(
        value = TextFieldValue(code, TextRange(code.length)),
        onValueChange = { onChange(cleanCode(it.text, length)) },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
        modifier = Modifier.focusRequester(focus).semantics { contentDescription = tr("Code, {} caractères", length) },
        decorationBox = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                for (i in 0 until length) {
                    if (i == length / 2) Box(Modifier.size(10.dp, 4.dp).clip(RoundedCornerShape(2.dp)).background(c.line))
                    val active = i == code.length.coerceAtMost(length - 1)
                    Box(
                        Modifier.size(if (length > 6) 32.dp else 40.dp, 52.dp).clip(RoundedCornerShape(14.dp))
                            .background(if (active) c.soft else c.field)
                            .border(2.dp, if (active) c.primary else c.line, RoundedCornerShape(14.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            code.getOrNull(i)?.toString().orEmpty(),
                            fontFamily = Baloo,
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            color = c.ink,
                        )
                    }
                }
            }
        },
    )
}
