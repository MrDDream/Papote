package fr.papote.app

import android.content.Context
import android.content.Intent
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * French is the language the app is written in: each French text is its own key. English comes from
 * assets/en.json (the same file as the web app's, server/web/i18n/en.json). Changing the language
 * restarts the app, so texts computed once (lists, labels) follow too.
 */
object I18n {
    /** code, name, flag */
    val LANGS = listOf(Triple("fr", "Français", "🇫🇷"), Triple("en", "English", "🇬🇧"))

    var lang = "fr"
        private set
    internal var dict: Map<String, String> = emptyMap()
        private set

    /** For dates and numbers. */
    val locale: Locale get() = if (lang == "en") Locale.UK else Locale.FRANCE

    fun init(context: Context) {
        lang = if (prefs(context).getString("lang", "fr") == "en") "en" else "fr"
        if (lang == "en") {
            dict = runCatching {
                val text = context.assets.open("en.json").bufferedReader().use { it.readText() }
                Json.parseToJsonElement(text).let { it as JsonObject }.mapValues { it.value.jsonPrimitive.content }
            }.getOrDefault(emptyMap())
        }
    }

    /** Saves the choice and starts the app again in that language. */
    fun set(context: Context, code: String) {
        if (code == lang) return
        prefs(context).edit().putString("lang", code).commit()
        val restart = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            ?.putExtra(EXTRA_OPEN_SETTINGS, true)
        if (restart != null) context.startActivity(restart)
        Runtime.getRuntime().exit(0)
    }

    /** Back in Paramètres after the restart, where the language was changed. */
    const val EXTRA_OPEN_SETTINGS = "papote.openSettings"

    private fun prefs(context: Context) = context.getSharedPreferences("papote", Context.MODE_PRIVATE)
}

private val PLACEHOLDER = Regex("""\{(\d*)\}""")

/** The text in the current language; {} are filled with [args] in order ({0} {1}… when a translation reorders them). */
fun tr(text: String, vararg args: Any?): String {
    val t = I18n.dict[text] ?: text
    if (args.isEmpty()) return t
    var i = 0
    return PLACEHOLDER.replace(t) { m ->
        val n = m.groupValues[1]
        (if (n.isEmpty()) args.getOrNull(i++) else args.getOrNull(n.toInt())).toString()
    }
}
