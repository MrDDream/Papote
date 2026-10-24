package fr.papote.app.data

import android.content.Context
import fr.papote.app.ui.theme.ThemeMode
import fr.papote.app.ui.theme.ThemeStyle
import fr.papote.app.ui.theme.ThemeLook
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Who is logged in where, persisted in SharedPreferences and observable from the UI. */
class Session(context: Context) {
    private val prefs = context.getSharedPreferences("papote", Context.MODE_PRIVATE)

    enum class LockMode { None, Pin, Biometric }

    data class State(
        val server: String?,
        val token: String?,
        val userId: Long?,
        val theme: ThemeMode,
        /** Pastel, Nuit étoilée, Carnet… */
        val look: ThemeLook = ThemeLook.Pastel,
        /** Colours; null = the theme's own ("D'origine"), Papote's violet with Pastel. */
        val style: ThemeStyle? = null,
        /** Keep the connection (and notifications) going when the app is closed. */
        val background: Boolean = false,
        val lock: LockMode = LockMode.None,
        /** Seconds in the background before the lock comes back. */
        val lockAfter: Int = 0,
    ) {
        val loggedIn get() = server != null && token != null && userId != null
    }

    private val _state = MutableStateFlow(read())
    val state: StateFlow<State> = _state.asStateFlow()

    val server get() = _state.value.server
    val token get() = _state.value.token
    val userId get() = _state.value.userId

    private fun read() = State(
        server = prefs.getString("server", null),
        token = prefs.getString("token", null),
        userId = prefs.getLong("userId", -1).takeIf { it > 0 },
        theme = runCatching { ThemeMode.valueOf(prefs.getString("theme", null) ?: "Auto") }.getOrDefault(ThemeMode.Auto),
        // 0.4.0 kept the themes in "style": a theme name there means that theme in its own colours.
        look = ThemeLook.entries.firstOrNull { it.name == prefs.getString("style", null) }
            ?: ThemeLook.entries.firstOrNull { it.name == prefs.getString("look", null) } ?: ThemeLook.Pastel,
        style = ThemeStyle.entries.firstOrNull { it.name == prefs.getString("style", null) },
        background = prefs.getBoolean("background", false),
        lock = runCatching { LockMode.valueOf(prefs.getString("lock", null) ?: "None") }.getOrDefault(LockMode.None),
        lockAfter = prefs.getInt("lockAfter", 0),
    )

    fun login(server: String, token: String, userId: Long) {
        prefs.edit().putString("server", server).putString("token", token).putLong("userId", userId).apply()
        _state.value = read()
    }

    /** After a merge this device's session belongs to another (the surviving) account. */
    fun switchUser(userId: Long) {
        if (userId == this.userId) return
        prefs.edit().putLong("userId", userId).apply()
        _state.value = read()
    }

    /** Keeps the server address so the join screen can prefill it. */
    fun logout() {
        prefs.edit().remove("token").remove("userId").remove("background").apply()
        _state.value = read()
    }

    fun setTheme(mode: ThemeMode) {
        prefs.edit().putString("theme", mode.name).apply()
        _state.value = read()
    }

    /** Colours; null = the theme's own. */
    fun setStyle(style: ThemeStyle?) {
        prefs.edit().putString("style", style?.name ?: "Default").apply()
        _state.value = read()
    }

    /** A new theme starts in its own colours. */
    fun setLook(look: ThemeLook) {
        prefs.edit().putString("look", look.name).putString("style", "Default").apply()
        _state.value = read()
    }

    fun setBackground(on: Boolean) {
        prefs.edit().putBoolean("background", on).apply()
        _state.value = read()
    }

    /** "Ne plus me demander" for the notifications / battery reminder at launch. */
    /** Voice messages playback speed (×1, ×1,5, ×2). */
    var voiceSpeed: Float
        get() = prefs.getFloat("voiceSpeed", 1f)
        set(v) = prefs.edit().putFloat("voiceSpeed", v).apply()

    /** Talkie mode: other people's voice messages play by themselves in that group. */
    fun talkie(groupId: Long) = prefs.getBoolean("talkie.$groupId", false)
    fun setTalkie(groupId: Long, on: Boolean) = prefs.edit().putBoolean("talkie.$groupId", on).apply()

    /** A new version the person chose "Plus tard" for: not offered again on the groups screen. */
    var dismissedUpdate: String?
        get() = prefs.getString("dismissedUpdate", null)
        set(v) = prefs.edit().putString("dismissedUpdate", v).apply()

    var notificationPromptOff: Boolean
        get() = prefs.getBoolean("notifPromptOff", false)
        set(v) = prefs.edit().putBoolean("notifPromptOff", v).apply()

    // --- app lock ------------------------------------------------------------------------

    fun setLock(mode: LockMode, pin: String? = null) {
        val e = prefs.edit().putString("lock", mode.name)
        if (mode == LockMode.Pin && pin != null) {
            val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
            e.putString("pinSalt", salt.toHex()).putString("pinHash", hashPin(pin, salt).toHex())
        }
        if (mode != LockMode.Pin) e.remove("pinSalt").remove("pinHash")
        e.apply()
        _state.value = read()
    }

    fun setLockAfter(seconds: Int) {
        prefs.edit().putInt("lockAfter", seconds).apply()
        _state.value = read()
    }

    fun checkPin(pin: String): Boolean {
        val salt = prefs.getString("pinSalt", null)?.fromHex() ?: return false
        val expected = prefs.getString("pinHash", null)?.fromHex() ?: return false
        return MessageDigest.isEqual(hashPin(pin, salt), expected)
    }

    // PBKDF2 so a copied preferences file doesn't give the PIN away in a few guesses per second.
    private fun hashPin(pin: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin.toCharArray(), salt, 120_000, 256)).encoded

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }
    private fun String.fromHex() = chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    companion object {
        /** "papote.example.fr" → "https://papote.example.fr"; strips trailing slashes. */
        fun normalizeServer(input: String): String? {
            val t = input.trim().trimEnd('/')
            if (t.isEmpty() || t.contains(' ')) return null
            val withScheme = if (t.startsWith("http://") || t.startsWith("https://")) t else "https://$t"
            return withScheme.toHttpUrlOrNull()?.let { withScheme }
        }
    }
}
