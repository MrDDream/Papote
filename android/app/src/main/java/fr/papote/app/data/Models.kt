package fr.papote.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.JsonArray

@Serializable
data class User(
    val id: Long,
    val name: String,
    val bio: String = "",
    val birthday: String? = null,
    val color: String = "rose",
    val photo: String? = null,
    val online: Boolean = false,
    val lastSeenAt: Long? = null,
    /** Only filled for the signed-in user: 2FA asked when the personal code opens the account. */
    val totp: Boolean = false,
    /** "dispo", "fatigue", "jeu", "cine", "dnd" or null. */
    val mood: String? = null,
)

@Serializable
data class Member(
    val id: Long,
    val name: String,
    val bio: String = "",
    val birthday: String? = null,
    val color: String = "rose",
    val photo: String? = null,
    val online: Boolean = false,
    val lastSeenAt: Long? = null,
    val role: String = "member",
    val joinedAt: Long = 0,
    val mood: String? = null,
    /** "pending" while waiting for an admin's approval (only admins see those). */
    val status: String = "active",
    val mutedUntil: Long? = null,
) {
    val pending get() = status == "pending"
    val isOwner get() = role == "owner"
    val isAdmin get() = role == "owner" || role == "admin"
}

@Serializable
data class Media(val id: String, val url: String, val mime: String? = null)

@Serializable
data class Message(
    val id: Long,
    val groupId: Long,
    val authorId: Long? = null,
    val type: String,
    val text: String = "",
    val media: Media? = null,
    val meta: JsonObject? = null,
    val replyTo: Long? = null,
    val deleted: Boolean = false,
    val reactions: Map<String, List<Long>> = emptyMap(),
    /** Poll answers: option index -> user ids. */
    val votes: Map<String, List<Long>>? = null,
    val pinnedAt: Long? = null,
    val pinnedBy: Long? = null,
    /** Ephemeral photo: gone after this. */
    val expiresAt: Long? = null,
    val createdAt: Long,
) {
    fun metaString(key: String): String? = meta?.get(key)?.jsonPrimitive?.contentOrNull
    fun metaLong(key: String): Long? = meta?.get(key)?.jsonPrimitive?.longOrNull
    fun metaDouble(key: String): Double? = meta?.get(key)?.jsonPrimitive?.doubleOrNull
    fun metaBool(key: String): Boolean = meta?.get(key)?.jsonPrimitive?.booleanOrNull ?: false
    val options: List<String> get() = (meta?.get("options") as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
    val transcript: String? get() = metaString("transcript")
    val durationMs: Long? get() = meta?.get("durationMs")?.jsonPrimitive?.longOrNull
    val width: Int? get() = meta?.get("width")?.jsonPrimitive?.intOrNull
    val height: Int? get() = meta?.get("height")?.jsonPrimitive?.intOrNull
    val waveform: List<Int> get() = meta?.get("waveform")?.jsonArray?.map { it.jsonPrimitive.int } ?: emptyList()
    val systemEvent: String? get() = meta?.get("event")?.jsonPrimitive?.content
    val systemUserId: Long? get() = meta?.get("userId")?.jsonPrimitive?.longOrNull
}

@Serializable
data class GroupSummary(
    val id: Long,
    val name: String,
    val color: String = "rose",
    val icon: String = "heart",
    val createdAt: Long = 0,
    val role: String = "member",
    val memberCount: Int = 1,
    val unread: Int = 0,
    val lastMessage: Message? = null,
    val lastAuthorName: String? = null,
    val photo: String? = null,
    /** A two-person conversation: shown as [peer], no invitations or renaming. */
    val direct: Boolean = false,
    val peer: User? = null,
    val settings: GroupSettings = GroupSettings(),
    /** Members whose birthday is today (empty when the group switched birthdays off). */
    val birthdaysToday: List<Long> = emptyList(),
    /** Set when an admin muted me in this group. */
    val mutedUntil: Long? = null,
)

@Serializable
data class GroupSettings(
    val pattern: String = "none",
    val reactions: List<String> = listOf("heart", "star", "laugh", "popcorn", "thumb"),
    val birthdays: Boolean = true,
    val approval: Boolean = false,
    val adminsTheme: Boolean = false,
    val anyoneInvites: Boolean = true,
)

@Serializable
data class Features(val gifs: Boolean = false, val transcription: Boolean = false)

@Serializable
data class Story(
    val id: Long,
    val url: String,
    val caption: String = "",
    val createdAt: Long = 0,
    val expiresAt: Long = 0,
    val seen: Boolean = false,
    val viewers: List<Viewer>? = null,
)

@Serializable
data class Viewer(val id: Long, val name: String)

@Serializable
data class StoryGroup(val user: User, val stories: List<Story>, val unseen: Boolean = false)

@Serializable
data class Gif(val id: String, val title: String = "", val width: Int = 200, val height: Int = 200, val preview: String)

@Serializable
data class Sticker(val id: Long, val groupId: Long = 0, val url: String, val createdBy: Long? = null)

@Serializable
data class Favorite(val kind: String, val ref: String, val data: JsonObject? = null)

@Serializable
data class LiveSession(
    val id: String,
    val groupId: Long,
    val startedBy: Long,
    val base: LiveBase? = null,
    val artists: List<Long> = emptyList(),
    val strokes: List<JsonObject> = emptyList(),
)

@Serializable
data class LiveBase(val messageId: Long, val url: String)

@Serializable
data class Game(
    val id: Long,
    val groupId: Long,
    val kind: String,
    val name: String = "",
    val status: String = "playing",
    val createdBy: Long? = null,
    val state: JsonObject,
    val strokes: List<JsonObject>? = null,
)

@Serializable
data class Gallery(val items: List<Message>, val total: Int = 0, val memory: Message? = null)

@Serializable
data class Recap(val month: String, val label: String, val stats: RecapStats, val badges: List<Badge> = emptyList())

@Serializable
data class RecapStats(val messages: Int = 0, val drawings: Int = 0, val voices: Int = 0, val photos: Int = 0, val gifs: Int = 0)

@Serializable
data class Badge(val kind: String, val user: User? = null, val value: Long = 0, val title: String? = null)

@Serializable
data class PendingGroup(val id: Long, val name: String, val color: String = "rose", val icon: String = "heart")

@Serializable
data class Invite(
    val code: String,
    val groupId: Long? = null,
    val expiresAt: Long? = null,
    val maxUses: Int? = null,
    val uses: Int = 0,
    val revoked: Boolean = false,
    val createdAt: Long = 0,
)

@Serializable
data class JoinResponse(val token: String? = null, val user: User, val groupId: Long? = null, val pending: Boolean = false)

@Serializable
data class PersonalCode(val code: String)

@Serializable
data class TotpSetup(val secret: String, val url: String)

@Serializable
data class RecoveryCodes(val recoveryCodes: List<String>)

@Serializable
data class LinkResponse(val token: String? = null, val user: User)

@Serializable
data class Device(
    val id: Long,
    val label: String,
    val createdAt: Long = 0,
    val lastUsedAt: Long = 0,
    val current: Boolean = false,
    val online: Boolean = false,
)

@Serializable
data class ServerInfo(val name: String, val version: String, val features: Features = Features())

@Serializable
data class ApiError(val error: String = "error", val message: String? = null)
