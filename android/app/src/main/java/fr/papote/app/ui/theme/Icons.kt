package fr.papote.app.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** The stroke icons drawn in the Papote mockups (24×24, round caps), tinted by Icon(). */
object PIcons {
    private fun stroke(d: String, width: Float = 2.2f) = ImageVector.Builder(
        defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f,
    ).addPath(
        pathData = addPathNodes(d),
        stroke = SolidColor(Color.Black),
        strokeLineWidth = width,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
    ).build()

    private fun fill(d: String) = ImageVector.Builder(
        defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f,
    ).addPath(pathData = addPathNodes(d), fill = SolidColor(Color.Black)).build()

    val Back = stroke("M15 5l-7 7 7 7", 2.4f)
    val Forward = stroke("M5 12h14M13 6l6 6-6 6", 2.4f)
    val Plus = stroke("M12 5v14M5 12h14", 2.4f)
    val Close = stroke("M6 6l12 12M18 6L6 18", 2.4f)
    val Check = stroke("M5 12l5 5 9-10", 2.6f)
    val Send = stroke("M4 12l16-8-6 16-3-7z", 2.4f)
    val Mic = stroke("M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3")
    val Pencil = stroke("M4 20l4-1 11-11-3-3L5 16zM14 6l3 3")
    val Photo = stroke("M4 7h3l2-2h6l2 2h3v12H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z")
    val Text = stroke("M4 6h16M4 12h10M4 18h7")
    val Trash = stroke("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13")
    val PersonPlus = stroke("M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M18 8v6M15 11h6")
    val People = stroke("M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .6 3 2.6 3 5")
    // A real cog: the old sun-like icon read as "brightness".
    val Settings = stroke(
        "M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
        2f,
    )
    val ChatPlus = stroke("M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM12 8.5v7M8.5 12h7")
    val Info = stroke("M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01")
    val Lock = stroke("M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4")
    val Bell = stroke("M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0")
    val Battery = stroke("M4 7h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM22 11v2M6 10v4M9 10v4")
    val Fingerprint = stroke("M12 11v3a8 8 0 0 0 1.5 4.7M8 21a12 12 0 0 1-2-7v-2a6 6 0 0 1 9-5.2M18 12v2a12 12 0 0 1-.8 4.3M2.5 12a9.5 9.5 0 0 1 17.6-5M9 14v-2a3 3 0 0 1 6 0v1")
    val Image = stroke("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21")
    val Palette = stroke("M12 3a9 9 0 0 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8zM7.5 11.5h.01M10.5 7.5h.01M15 7.5h.01M17.5 11h.01")
    val Server = stroke("M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01")
    val Shield = stroke("M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4")
    val Search = stroke("M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5")
    val Keypad = stroke("M6 7h12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3zM8 12h.01M12 12h.01M16 12h.01")
    val Copy = stroke("M9 9h10v11H9zM5 15V4h10")
    val Share = stroke("M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4")
    val Undo = stroke("M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3")
    val Redo = stroke("M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3")
    val Logout = stroke("M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11")
    val Crown = stroke("M4 18h16M4 18L3 7l5 4 4-6 4 6 5-4-1 11")
    val Exit = stroke("M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 16l4-4-4-4M18 12H9")

    // Mockup features
    val Download = stroke("M12 4v11M7 10l5 5 5-5M5 20h14")
    val Pin = stroke("M9 4h6l-1 6 4 4H6l4-4zM12 14v7")
    val Grid = stroke("M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z")
    val Poll = stroke("M5 20V10M12 20V4M19 20v-7")
    val Location = stroke("M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z")
    val Gif = stroke("M4 6h16v12H4zM9 10H7v4h2v-1.5M12 10v4M15 14v-4h2M15 12h1.5")
    val Qr = stroke("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2M16 16h2v2")
    val Scan = stroke("M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16")
    val Eye = stroke("M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z")
    val Cake = stroke("M4 21h16M5 21v-8h14v8M5 16c2 1.5 4 1.5 7 0s5-1.5 7 0M12 13V9M12 6a1.5 1.5 0 0 1 0-3c0 1 1.5 1.5 0 3z")
    val Sparkles = stroke("M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z")
    val Timer = stroke("M12 8v5l3 2M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z")
    val Mute = stroke("M11 5L6 9H3v6h3l5 4zM16 9l5 5M21 9l-5 5")
    val Refresh = stroke("M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7")
    val Crop = stroke("M6 2v16h16M2 6h16v16")
    val TextTool = stroke("M5 6h14M12 6v13M9 19h6")

    // Drawing tools
    val Brush = Pencil
    val Marker = stroke("M9 15l-5 5M14 4l6 6-9 9-6-6zM12 6l6 6")
    val Eraser = stroke("M8 20h12M5 15l8-8 6 6-5 5H9z")
    val Bucket = stroke("M5 11l7-7 7 7-7 7zM19 15c1 1.5 2 2.6 2 3.5a2 2 0 0 1-4 0c0-.9 1-2 2-3.5z")
    val Stamp = stroke("M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.3 6.8 19.1l1-5.8L3.5 9.2l5.9-.8z")

    // Group badges
    val Heart = stroke("M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z")
    val House = stroke("M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z")
    val Leaf = stroke("M5 19c0-8 6-14 15-14 0 9-6 15-14 15M5 19l7-7")
    val Dice = stroke("M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 9h.01M15 15h.01M15 9h.01M9 15h.01")
    val Star = Stamp
    val Music = stroke("M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z")
    val Game = stroke("M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 1.8L9 15h6l1.6 1.8A3 3 0 0 0 22 15l-.7-6.4A4 4 0 0 0 17.3 5z")
    val Book = stroke("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5")
    val Sun = stroke("M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4")
    val Moon = stroke("M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z")
    val Coffee = stroke("M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v3M10 2v3M14 2v3")
    val Plane = stroke("M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z")
    val Gift = stroke("M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z")
    val Paw = stroke("M11 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM17 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM21 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM12 11c-3 0-6 4.5-6 7.5A2.5 2.5 0 0 0 8.5 21c1.4 0 2.2-.8 3.5-.8s2.1.8 3.5.8a2.5 2.5 0 0 0 2.5-2.5c0-3-3-7.5-6-7.5z")
    val Briefcase = stroke("M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M3 13h18")
    val Ball = stroke("M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9M12 3c-2.5 2.5-3.8 5.5-3.8 9s1.3 6.5 3.8 9M3.5 9h17M3.5 15h17")
    val Car = stroke("M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M3 17v-5l2-5h14l2 5v5M3 12h18")
    val School = stroke("M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6")

    // Reactions
    val Laugh = stroke("M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0M8 13q4 5 8 0zM9 9h.01M15 9h.01")
    val Smile = stroke("M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0M8.5 14q3.5 3.5 7 0M9 9.5h.01M15 9.5h.01")
    val Popcorn = stroke("M7 10h10l-2 10H9zM8 10a2.5 2.5 0 0 1 4-3 2.5 2.5 0 0 1 4 3")
    val Thumb = stroke("M7 11v9H4v-9zM7 11l4-7c2 0 3 1 2.5 3L13 10h5a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 17 20H7")

    val Play = fill("M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z")
    val Pause = fill("M7.5 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM13.5 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z")

    private val groupIcons = linkedMapOf(
        "heart" to Heart, "house" to House, "leaf" to Leaf, "dice" to Dice, "star" to Star,
        "music" to Music, "game" to Game, "book" to Book, "sun" to Sun, "moon" to Moon,
        "coffee" to Coffee, "plane" to Plane, "gift" to Gift, "paw" to Paw, "briefcase" to Briefcase,
        "ball" to Ball, "palette" to Palette, "car" to Car, "school" to School, "camera" to Photo,
    )

    fun group(key: String?) = groupIcons[key] ?: Heart

    /** Same keys as the server's GROUP_ICONS. */
    val GroupIcons = groupIcons.keys.toList()

    data class Reaction(val key: String, val label: String, val icon: ImageVector, val bg: Color, val fg: Color)

    val Reactions = listOf(
        Reaction("heart", "Cœur", Heart, Color(0xFFFFE0E8), Color(0xFFB0305A)),
        Reaction("star", "Étoile", Star, Color(0xFFFFF0B8), Color(0xFF7A5F00)),
        Reaction("laugh", "Rire", Laugh, Color(0xFFFFE3C7), Color(0xFF9A4F0C)),
        Reaction("popcorn", "Pop-corn", Popcorn, Color(0xFFFFF8E6), Color(0xFF8A5A00)),
        Reaction("thumb", "Pouce", Thumb, Color(0xFFD6E8FF), Color(0xFF2E5FA8)),
    )

    fun reaction(key: String) = Reactions.firstOrNull { it.key == key }
}
