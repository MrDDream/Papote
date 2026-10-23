package fr.papote.app.ui.lock

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import fr.papote.app.PapoteApp
import fr.papote.app.data.Session
import fr.papote.app.ui.components.Mascot
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import kotlinx.coroutines.delay

/** Fingerprint/face, with the phone's own PIN as a fallback. */
object Biometric {
    private const val AUTHENTICATORS = BIOMETRIC_STRONG or BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    fun available(activity: FragmentActivity) =
        BiometricManager.from(activity).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

    fun prompt(activity: FragmentActivity, title: String, onSuccess: () -> Unit) {
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("Papote")
                .setAllowedAuthenticators(AUTHENTICATORS)
                .build(),
        )
    }
}

/** Covers the whole app until the PIN or the fingerprint is given. */
@Composable
fun LockScreen(mode: Session.LockMode, onUnlocked: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val activity = LocalContext.current as FragmentActivity
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf(false) }
    var tries by remember { mutableStateOf(0) }

    fun askBiometric() = Biometric.prompt(activity, "Déverrouiller Papote", onUnlocked)
    LaunchedEffect(mode) { if (mode == Session.LockMode.Biometric) askBiometric() }

    fun press(d: String) {
        if (pin.length >= 6) return
        pin += d
        error = false
        if (pin.length >= 4 && app.session.checkPin(pin)) onUnlocked()
    }

    Column(
        Modifier.fillMaxSize().background(c.ground).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Mascot(width = 88.dp)
        Spacer(Modifier.height(12.dp))
        Text("Papote est verrouillé", style = MaterialTheme.typography.headlineSmall, color = c.ink)
        Spacer(Modifier.height(24.dp))
        if (mode == Session.LockMode.Biometric) {
            SecondaryButton("Déverrouiller", ::askBiometric, icon = PIcons.Fingerprint)
            return@Column
        }
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.semantics { contentDescription = "${pin.length} chiffre(s) saisi(s)" }) {
            repeat(maxOf(4, pin.length)) { i ->
                Box(Modifier.size(14.dp).clip(CircleShape).background(if (i < pin.length) (if (error) c.danger else c.primary) else c.line))
            }
        }
        Text(
            if (error) "Code incorrect" else " ",
            style = MaterialTheme.typography.bodySmall,
            color = c.danger,
            modifier = Modifier.padding(top = 10.dp),
        )
        Spacer(Modifier.height(16.dp))
        val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫")
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            keys.chunked(3).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    row.forEach { k ->
                        Box(
                            Modifier.size(72.dp).clip(CircleShape).background(if (k.isEmpty()) c.ground else c.card)
                                .clickable(enabled = k.isNotEmpty(), role = Role.Button) {
                                    if (k == "⌫") pin = pin.dropLast(1) else press(k)
                                }
                                .semantics { if (k == "⌫") contentDescription = "Effacer" },
                            contentAlignment = Alignment.Center,
                        ) { Text(k, fontFamily = Baloo, fontSize = 28.sp, color = c.ink) }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        SecondaryButton("Valider", {
            if (app.session.checkPin(pin)) {
                onUnlocked()
            } else {
                error = true
                tries++
                pin = ""
            }
        }, enabled = pin.length >= 4)
    }

    // A few wrong PINs in a row: slow down guessing.
    LaunchedEffect(tries) {
        if (tries >= 5) {
            delay(30_000)
            tries = 0
        }
    }
}
