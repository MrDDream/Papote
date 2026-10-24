package fr.papote.app.ui.components

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.papote.app.ui.theme.Papote
import java.text.BreakIterator

/** The same curated set as the web app (server/web/emoji.js), so both pickers feel alike. */
object Emojis {
    data class Category(val label: String, val icon: String, val emojis: List<String>)

    private fun split(s: String) = s.split(' ').filter { it.isNotBlank() }

    val categories = listOf(
        Category(tr("Sourires"), "😀", split("😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾")),
        Category(tr("Gestes"), "👋", split("👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦵 🦶 👂 👃 🧠 👀 👁️ 👅 👄 💋 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙋 🙆 🙅 🤷 🤦 💁 🙇 🧑‍🍳 🧑‍🎨 🧑‍💻 🧑‍🚀 🦸 🧙 🧚 💃 🕺 👯 🧘 🛀 👫 👭 👬 💏 💑 👪")),
        Category(tr("Cœurs"), "❤️", split("❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ❤️‍🔥 ❤️‍🩹 💌 💐 🌹 🥀 🌷 🌸 💮 🏵️ 🌻 🌼 ✨ 💫 ⭐ 🌟 🔥 💥 💯 💢 💦 💨 🕊️ 🫶 😻 💑 💏")),
        Category(tr("Animaux"), "🐶", split("🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🦓 🦒 🐘 🦛 🐪 🦘 🐕 🐈 🐇 🦔 🦥 🦦 🌵 🎄 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🍂 🍃 🍄 🌍 🌙 ☀️ ⛅ 🌧️ ⛈️ 🌈 ❄️ ☃️ 🌊")),
        Category(tr("Miam"), "🍕", split("🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥕 🌽 🌶️ 🥔 🥐 🥖 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍮 🍯 🍿 🥤 🧋 ☕ 🍵 🍺 🍻 🥂 🍷 🍸 🍹 🧉")),
        Category(tr("Fête"), "🎉", split("🎉 🎊 🎈 🎁 🎀 🎂 🪅 🎆 🎇 🧨 🎃 🎄 🎅 🤶 🎓 🏆 🥇 🥈 🥉 🏅 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥊 🛹 ⛸️ 🎿 🏊 🚴 🧗 🎮 🕹️ 🎲 🧩 ♟️ 🎯 🎳 🎨 🖍️ ✏️ 🎭 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 📸 🎥 📺 📚 📖")),
        Category(tr("Voyage"), "✈️", split("🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🚲 🛴 🛵 🏍️ 🚂 🚆 🚇 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛳️ ⚓ 🗺️ 🧭 🏔️ ⛰️ 🏕️ 🏖️ 🏝️ 🏠 🏡 🏰 🗼 🗽 ⛺ 🎡 🎢 🎠 🌅 🌄 🌃 🌉 🎑 ⌚ 📱 💻 ⌨️ 🖨️ 💡 🔦 🕯️ 💸 💰 💳 🔑 🗝️ 🔨 🧸 🛏️ 🛋️ 🚿 🧼 🧺 🧻 🎒 👓 🕶️ 👕 👖 👗 👙 👠 👟 🧢 👑 💍 ☂️")),
        Category(tr("Symboles"), "💬", split("💬 💭 🗯️ 💤 ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❓ ❔ ❗ ❕ ‼️ ⁉️ 💲 ♻️ ⚠️ 🚫 ⛔ 🔞 📵 🆗 🆒 🆕 🆙 🆓 🔝 🔜 ⏰ ⏳ 📅 📌 📍 📎 🔔 🔕 🎵 🎶 ➡️ ⬅️ ⬆️ ⬇️ 🔄 🔁 ▶️ ⏸️ ⏹️ ⏺️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 💠 🔷 🔶 🏳️‍🌈 🏴‍☠️ 🇫🇷 🇧🇪 🇨🇭 🇨🇦 🇪🇺")),
    )

    val quickReactions = listOf("😂", "😮", "😢", "🎉", "🔥", "👏")

    private const val PREFS = "papote"
    private const val KEY = "emojiRecents"

    fun recents(context: Context): List<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)?.split(' ')?.filter { it.isNotBlank() } ?: emptyList()

    fun remember(context: Context, emoji: String) {
        val list = (listOf(emoji) + recents(context).filter { it != emoji }).take(32)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, list.joinToString(" ")).apply()
    }

    private fun isEmojiCodePoint(cp: Int) =
        cp in 0x1F000..0x1FAFF || cp in 0x2600..0x27BF || cp in 0x2300..0x23FF || cp in 0x2B00..0x2BFF ||
            cp in 0x2190..0x21FF || cp in 0xE0020..0xE007F || cp == 0xFE0F || cp == 0x200D || cp == 0x20E3 ||
            cp == 0x00A9 || cp == 0x00AE || cp == 0x2122 || cp == 0x203C || cp == 0x2049 || cp == 0x3030 || cp == 0x303D

    /** 1 to 3 emoji and nothing else: shown big, without a bubble, like the web app. */
    fun isEmojiOnly(text: String): Boolean {
        val t = text.filterNot { it.isWhitespace() }
        if (t.isEmpty() || t.codePoints().anyMatch { !isEmojiCodePoint(it) }) return false
        val it = BreakIterator.getCharacterInstance()
        it.setText(t)
        var count = 0
        while (it.next() != BreakIterator.DONE) count++
        return count in 1..3
    }
}

/** Category tabs + grid. [height] keeps it the size of a keyboard. */
@Composable
fun EmojiPicker(onPick: (String) -> Unit, modifier: Modifier = Modifier, height: Dp = 280.dp) {
    val c = Papote.colors
    val context = LocalContext.current
    var recents by remember { mutableStateOf(Emojis.recents(context)) }
    var tab by rememberSaveable { mutableStateOf(if (Emojis.recents(context).isEmpty()) 1 else 0) }
    val tabs = listOf(Emojis.Category(tr("Récents"), "🕘", recents)) + Emojis.categories

    Column(modifier.fillMaxWidth().height(height).clip(pShape(24.dp)).background(c.card)) {
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            tabs.forEachIndexed { i, cat ->
                val on = i == tab
                Box(
                    Modifier.size(40.dp).clip(pShape(12.dp)).background(if (on) c.soft else Color.Transparent)
                        .clickable(role = Role.Tab) { tab = i }
                        .semantics {
                            contentDescription = cat.label
                            stateDescription = if (on) tr("affichée") else ""
                        },
                    contentAlignment = Alignment.Center,
                ) { Text(cat.icon, fontSize = 20.sp) }
            }
        }
        val list = tabs[tab].emojis
        if (list.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                Text(tr("Tes emoji récents apparaîtront ici."), style = MaterialTheme.typography.bodyMedium, color = c.muted)
            }
        } else {
            LazyVerticalGrid(GridCells.Adaptive(44.dp), Modifier.fillMaxWidth().padding(horizontal = 6.dp)) {
                items(list) { e ->
                    Box(
                        Modifier.size(44.dp).clip(pShape(12.dp)).clickable(role = Role.Button) {
                            Emojis.remember(context, e)
                            recents = Emojis.recents(context)
                            onPick(e)
                        },
                        contentAlignment = Alignment.Center,
                    ) { Text(e, fontSize = 26.sp) }
                }
            }
        }
    }
}
