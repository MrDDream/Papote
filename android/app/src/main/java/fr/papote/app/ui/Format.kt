package fr.papote.app.ui

import fr.papote.app.tr

import fr.papote.app.data.Member
import fr.papote.app.data.Message
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

// Dates in the app's language (Paramètres → Langue).
private val FR get() = fr.papote.app.I18n.locale
private val HOUR = DateTimeFormatter.ofPattern("HH:mm", FR)

private fun Long.toLocalDate(): LocalDate = Instant.ofEpochMilli(this).atZone(ZoneId.systemDefault()).toLocalDate()

fun timeOf(ts: Long): String = Instant.ofEpochMilli(ts).atZone(ZoneId.systemDefault()).format(HOUR)

/** "10:12", "Hier", "Lun.", "12 oct." like the groups list in the mockups. */
fun shortWhen(ts: Long): String {
    val d = ts.toLocalDate()
    val days = ChronoUnit.DAYS.between(d, LocalDate.now())
    return when {
        days <= 0L -> timeOf(ts)
        days == 1L -> tr("Hier")
        days < 7L -> d.dayOfWeek.getDisplayName(TextStyle.SHORT, FR).replaceFirstChar { it.uppercase() }
        else -> d.format(DateTimeFormatter.ofPattern("d MMM", FR))
    }
}

fun dayLabel(ts: Long): String {
    val d = ts.toLocalDate()
    val days = ChronoUnit.DAYS.between(d, LocalDate.now())
    return when (days) {
        0L -> tr("Aujourd’hui")
        1L -> tr("Hier")
        else -> d.format(DateTimeFormatter.ofPattern(if (d.year == LocalDate.now().year) "EEEE d MMMM" else "d MMMM yyyy", FR))
            .replaceFirstChar { it.uppercase() }
    }
}

fun sameDay(a: Long, b: Long) = a.toLocalDate() == b.toLocalDate()

fun duration(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

fun lastSeen(m: Member): String = when {
    m.online -> tr("En ligne")
    m.lastSeenAt == null -> tr("Pas encore venu·e")
    else -> {
        val mins = ChronoUnit.MINUTES.between(Instant.ofEpochMilli(m.lastSeenAt), Instant.now())
        when {
            mins < 1 -> tr("Vu·e à l’instant")
            mins < 60 -> tr("Vu·e il y a {} min", mins)
            mins < 24 * 60 -> tr("Vu·e il y a {} h", mins / 60)
            else -> "Vu·e ${shortWhen(m.lastSeenAt).lowercase()}"
        }
    }
}

/** One-line preview of a message for the groups list. */
fun preview(m: Message, author: String?): String {
    val who = author?.let { "$it : " }.orEmpty()
    val sent = if (author == tr("Toi")) tr("Tu as envoyé") else tr("{} a envoyé", author ?: tr("Quelqu’un"))
    return when {
        m.deleted -> tr("Message supprimé")
        m.type == "text" -> who + m.text
        m.type == "photo" -> tr("{} une photo", sent)
        m.type == "drawing" -> tr("{} un dessin", sent)
        m.type == "video" -> tr("{} une vidéo", sent)
        m.type == "file" -> "$sent « ${m.metaString("name") ?: tr("un fichier")} »"
        m.type == "voice" -> tr("{} · vocal {}", author ?: tr("Quelqu’un"), duration(m.durationMs ?: 0))
        m.type == "system" -> systemText(m, author)
        m.type == "gif" -> "$sent un GIF"
        m.type == "sticker" -> tr("{} un sticker", sent)
        m.type == "poll" -> tr("{} : sondage « {} »", author ?: tr("Quelqu’un"), m.text)
        m.type == "location" -> tr("{} a partagé sa position", author ?: tr("Quelqu’un"))
        m.type == "game" -> tr("{} a lancé une partie", author ?: tr("Quelqu’un"))
        m.type == "recap" -> tr("{} a partagé le récap du mois", author ?: tr("Quelqu’un"))
        else -> who + m.text
    }
}

fun systemText(m: Message, name: String?): String {
    val who = name ?: tr("Quelqu’un")
    return when (m.systemEvent) {
        "created" -> tr("{} a créé le groupe", who)
        "joined" -> tr("{} a rejoint le groupe", who)
        "left" -> tr("{} est parti·e", who)
        "removed" -> tr("{} a été retiré·e du groupe", who)
        "livedraw" -> tr("{} a lancé une toile commune", who)
        else -> tr("Le groupe a changé")
    }
}

fun roleLabel(role: String) = when (role) {
    "owner" -> tr("Créateur·rice")
    "admin" -> "Admin"
    else -> tr("Membre")
}
