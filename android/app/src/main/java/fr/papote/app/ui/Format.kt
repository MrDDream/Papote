package fr.papote.app.ui

import fr.papote.app.data.Member
import fr.papote.app.data.Message
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

private val FR = Locale.FRENCH
private val HOUR = DateTimeFormatter.ofPattern("HH:mm", FR)

private fun Long.toLocalDate(): LocalDate = Instant.ofEpochMilli(this).atZone(ZoneId.systemDefault()).toLocalDate()

fun timeOf(ts: Long): String = Instant.ofEpochMilli(ts).atZone(ZoneId.systemDefault()).format(HOUR)

/** "10:12", "Hier", "Lun.", "12 oct." like the groups list in the mockups. */
fun shortWhen(ts: Long): String {
    val d = ts.toLocalDate()
    val days = ChronoUnit.DAYS.between(d, LocalDate.now())
    return when {
        days <= 0L -> timeOf(ts)
        days == 1L -> "Hier"
        days < 7L -> d.dayOfWeek.getDisplayName(TextStyle.SHORT, FR).replaceFirstChar { it.uppercase() }
        else -> d.format(DateTimeFormatter.ofPattern("d MMM", FR))
    }
}

fun dayLabel(ts: Long): String {
    val d = ts.toLocalDate()
    val days = ChronoUnit.DAYS.between(d, LocalDate.now())
    return when (days) {
        0L -> "Aujourd’hui"
        1L -> "Hier"
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
    m.online -> "En ligne"
    m.lastSeenAt == null -> "Pas encore venu·e"
    else -> {
        val mins = ChronoUnit.MINUTES.between(Instant.ofEpochMilli(m.lastSeenAt), Instant.now())
        when {
            mins < 1 -> "Vu·e à l’instant"
            mins < 60 -> "Vu·e il y a $mins min"
            mins < 24 * 60 -> "Vu·e il y a ${mins / 60} h"
            else -> "Vu·e ${shortWhen(m.lastSeenAt).lowercase()}"
        }
    }
}

/** One-line preview of a message for the groups list. */
fun preview(m: Message, author: String?): String {
    val who = author?.let { "$it : " }.orEmpty()
    val sent = if (author == "Toi") "Tu as envoyé" else "${author ?: "Quelqu’un"} a envoyé"
    return when {
        m.deleted -> "Message supprimé"
        m.type == "text" -> who + m.text
        m.type == "photo" -> "$sent une photo"
        m.type == "drawing" -> "$sent un dessin"
        m.type == "voice" -> "${author ?: "Quelqu’un"} · vocal ${duration(m.durationMs ?: 0)}"
        m.type == "system" -> systemText(m, author)
        m.type == "gif" -> "$sent un GIF"
        m.type == "sticker" -> "$sent un sticker"
        m.type == "poll" -> "${author ?: "Quelqu’un"} : sondage « ${m.text} »"
        m.type == "location" -> "${author ?: "Quelqu’un"} a partagé sa position"
        m.type == "game" -> "${author ?: "Quelqu’un"} a lancé une partie"
        m.type == "recap" -> "${author ?: "Quelqu’un"} a partagé le récap du mois"
        else -> who + m.text
    }
}

fun systemText(m: Message, name: String?): String {
    val who = name ?: "Quelqu’un"
    return when (m.systemEvent) {
        "created" -> "$who a créé le groupe"
        "joined" -> "$who a rejoint le groupe"
        "left" -> "$who est parti·e"
        "removed" -> "$who a été retiré·e du groupe"
        "livedraw" -> "$who a lancé une toile commune"
        else -> "Le groupe a changé"
    }
}

fun roleLabel(role: String) = when (role) {
    "owner" -> "Créateur·rice"
    "admin" -> "Admin"
    else -> "Membre"
}
