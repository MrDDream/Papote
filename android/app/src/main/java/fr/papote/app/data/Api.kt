package fr.papote.app.data

import fr.papote.app.tr

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)

val PapoteJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

/** Builds a JSON object from pairs, dropping nothing: null values become JSON null. */
fun jsonOf(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject {
    for ((k, v) in pairs) {
        put(
            k,
            when (v) {
                null -> JsonNull
                is JsonElement -> v
                is Number -> JsonPrimitive(v)
                is Boolean -> JsonPrimitive(v)
                else -> JsonPrimitive(v.toString())
            },
        )
    }
}

/**
 * Thin client for the Papote server REST API. [baseUrl] and [token] are read on every call so a
 * login or logout takes effect without rebuilding anything.
 */
class Api(
    private val client: OkHttpClient,
    private val baseUrl: () -> String?,
    private val token: () -> String?,
) {
    private fun url(path: String): String {
        val base = baseUrl() ?: throw ApiException(0, "no_server", tr("Aucun serveur configuré"))
        return base.trimEnd('/') + path
    }

    private suspend fun call(method: String, path: String, body: RequestBody? = null, auth: Boolean = true): String =
        withContext(Dispatchers.IO) {
            val req = Request.Builder().url(url(path)).method(method, body ?: if (method == "GET" || method == "DELETE") null else ByteArray(0).toRequestBody())
            if (auth) token()?.let { req.header("Authorization", "Bearer $it") }
            // OkHttp rejects non-ASCII header values ("·", accents): the server URL-decodes it.
            req.header("X-Papote-Device", android.net.Uri.encode(DEVICE_LABEL))
            val res = try {
                client.newCall(req.build()).execute()
            } catch (e: IOException) {
                throw ApiException(0, "network", tr("Impossible de joindre le serveur"))
            }
            res.use {
                val text = it.body?.string().orEmpty()
                if (!it.isSuccessful) {
                    val err = runCatching { PapoteJson.decodeFromString<ApiError>(text) }.getOrNull()
                    throw ApiException(it.code, err?.error ?: "http_${it.code}", friendly(err?.error, err?.message, it.code))
                }
                text
            }
        }

    /** A proxy or a non-Papote server can answer 200 with HTML: report it instead of crashing. */
    private inline fun <reified T> decode(text: String): T = try {
        PapoteJson.decodeFromString(text)
    } catch (e: IllegalArgumentException) {
        throw ApiException(0, "bad_response", tr("Réponse inattendue du serveur"))
    }

    private suspend inline fun <reified T> get(path: String): T = decode(call("GET", path))

    private suspend inline fun <reified T> send(method: String, path: String, body: JsonObject = JsonObject(emptyMap())): T =
        decode(call(method, path, PapoteJson.encodeToString(body).toRequestBody(JSON_TYPE)))

    private suspend fun sendUnit(method: String, path: String, body: JsonObject? = null) {
        call(method, path, body?.let { PapoteJson.encodeToString(it).toRequestBody(JSON_TYPE) })
    }

    suspend fun server(): ServerInfo = decode(call("GET", "/api/server", auth = false))

    suspend fun join(code: String, name: String?, color: String?): JoinResponse =
        send("POST", "/api/join", jsonOf("code" to code, "name" to name, "color" to color))

    suspend fun link(code: String, totp: String? = null): LinkResponse = send("POST", "/api/link", jsonOf("code" to code, "totp" to totp))

    // Standard accounts: username and password
    suspend fun register(name: String, username: String, password: String, color: String, code: String?): JoinResponse =
        send("POST", "/api/register", jsonOf("name" to name, "username" to username, "password" to password, "color" to color, "code" to code))
    suspend fun login(username: String, password: String, totp: String? = null): LinkResponse =
        send("POST", "/api/login", jsonOf("username" to username, "password" to password, "totp" to totp))
    suspend fun setAccount(username: String, password: String?, currentPassword: String?): User =
        send("PUT", "/api/me/account", jsonOf("username" to username, "password" to password, "currentPassword" to currentPassword))
    suspend fun mergeWith(username: String, password: String, totp: String? = null): LinkResponse =
        send("POST", "/api/me/merge", jsonOf("username" to username, "password" to password, "totp" to totp))

    // Adding someone to a group, invitations
    suspend fun addToGroup(groupId: Long, userId: Long? = null, username: String? = null): AddResult =
        send("POST", "/api/groups/$groupId/add", if (userId != null) jsonOf("userId" to userId) else jsonOf("username" to username))
    suspend fun invitations(): List<Invitation> = get("/api/me/invitations")
    suspend fun acceptInvitation(groupId: Long): AcceptResult = send("POST", "/api/me/invitations/$groupId/accept")
    suspend fun declineInvitation(groupId: Long) = sendUnit("DELETE", "/api/me/invitations/$groupId")
    suspend fun personalCode(): PersonalCode = get("/api/me/code")
    suspend fun regeneratePersonalCode(): PersonalCode = send("POST", "/api/me/code")
    suspend fun merge(code: String, totp: String? = null): LinkResponse = send("POST", "/api/me/merge", jsonOf("code" to code, "totp" to totp))
    suspend fun startTotp(): TotpSetup = send("POST", "/api/me/2fa/start")
    suspend fun confirmTotp(code: String): RecoveryCodes = send("POST", "/api/me/2fa/confirm", jsonOf("code" to code))
    suspend fun disableTotp(code: String) = sendUnit("POST", "/api/me/2fa/disable", jsonOf("code" to code))

    suspend fun contacts(): List<User> = get("/api/contacts")
    suspend fun direct(userId: Long): GroupSummary = send("POST", "/api/direct", jsonOf("userId" to userId))
    suspend fun devices(): List<Device> = get("/api/me/devices")
    suspend fun revokeDevice(id: Long) = sendUnit("DELETE", "/api/me/devices/$id")

    suspend fun me(): User = get("/api/me")
    suspend fun updates(): UpdateInfo = get("/api/updates")
    suspend fun updateMe(changes: JsonObject): User = send("PATCH", "/api/me", changes)
    suspend fun setPhoto(bytes: ByteArray, mime: String): User =
        decode(call("PUT", "/api/me/photo", multipart(bytes, mime, "avatar.jpg")))
    suspend fun deletePhoto(): User = decode(call("DELETE", "/api/me/photo"))
    suspend fun logout() = sendUnit("POST", "/api/logout")

    suspend fun groups(): List<GroupSummary> = get("/api/groups")
    suspend fun group(id: Long): GroupSummary = get("/api/groups/$id")
    suspend fun createGroup(name: String, color: String, icon: String): GroupSummary =
        send("POST", "/api/groups", jsonOf("name" to name, "color" to color, "icon" to icon))
    suspend fun updateGroup(id: Long, changes: JsonObject): GroupSummary = send("PATCH", "/api/groups/$id", changes)
    suspend fun deleteGroup(id: Long) = sendUnit("DELETE", "/api/groups/$id")
    suspend fun setGroupPhoto(id: Long, bytes: ByteArray): GroupSummary =
        decode(call("PUT", "/api/groups/$id/photo", multipart(bytes, "image/jpeg", "groupe.jpg")))
    suspend fun deleteGroupPhoto(id: Long): GroupSummary = decode(call("DELETE", "/api/groups/$id/photo"))
    suspend fun setWallpaper(id: Long, bytes: ByteArray): GroupSummary =
        decode(call("PUT", "/api/groups/$id/wallpaper", multipart(bytes, "image/jpeg", "fond.jpg")))
    suspend fun deleteWallpaper(id: Long): GroupSummary = decode(call("DELETE", "/api/groups/$id/wallpaper"))
    suspend fun leaveGroup(id: Long) = sendUnit("POST", "/api/groups/$id/leave")

    suspend fun members(groupId: Long): List<Member> = get("/api/groups/$groupId/members")
    suspend fun setRole(groupId: Long, userId: Long, role: String) =
        sendUnit("PATCH", "/api/groups/$groupId/members/$userId", jsonOf("role" to role))
    suspend fun removeMember(groupId: Long, userId: Long) = sendUnit("DELETE", "/api/groups/$groupId/members/$userId")

    suspend fun invites(groupId: Long): List<Invite> = get("/api/groups/$groupId/invites")
    suspend fun createInvite(groupId: Long, expiresIn: String, singleUse: Boolean): Invite =
        send("POST", "/api/groups/$groupId/invites", jsonOf("expiresIn" to expiresIn, "singleUse" to singleUse))
    suspend fun revokeInvite(code: String) = sendUnit("DELETE", "/api/invites/$code")

    suspend fun messages(groupId: Long, before: Long? = null, limit: Int = 50): List<Message> =
        get("/api/groups/$groupId/messages?limit=$limit" + (before?.let { "&before=$it" } ?: ""))
    suspend fun sendText(groupId: Long, text: String, replyTo: Long? = null): Message =
        send("POST", "/api/groups/$groupId/messages", jsonOf("text" to text, "replyTo" to replyTo))

    suspend fun sendMedia(
        groupId: Long,
        type: String,
        bytes: ByteArray,
        mime: String,
        filename: String,
        fields: Map<String, String> = emptyMap(),
    ): Message {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("type", type)
        for ((k, v) in fields) body.addFormDataPart(k, v)
        body.addFormDataPart("file", filename, bytes.toRequestBody(mime.toMediaType()))
        return decode(call("POST", "/api/groups/$groupId/media", body.build()))
    }

    suspend fun deleteMessage(id: Long) = sendUnit("DELETE", "/api/messages/$id")
    suspend fun react(id: Long, kind: String, on: Boolean): Message =
        decode(call(if (on) "PUT" else "DELETE", "/api/messages/$id/reactions/${android.net.Uri.encode(kind)}", if (on) ByteArray(0).toRequestBody() else null))
    suspend fun markRead(groupId: Long, messageId: Long) = sendUnit("POST", "/api/groups/$groupId/read", jsonOf("messageId" to messageId))

    suspend fun messagesAround(groupId: Long, messageId: Long): List<Message> = get("/api/groups/$groupId/messages?limit=60&around=$messageId")
    suspend fun messagesAfter(groupId: Long, messageId: Long): List<Message> = get("/api/groups/$groupId/messages?limit=100&after=$messageId")

    // Members waiting for approval, mute, group settings
    suspend fun pendingGroups(): List<PendingGroup> = get("/api/me/pending")
    suspend fun approve(groupId: Long, userId: Long) = sendUnit("POST", "/api/groups/$groupId/members/$userId/approve")
    suspend fun refuse(groupId: Long, userId: Long) = sendUnit("POST", "/api/groups/$groupId/members/$userId/refuse")
    suspend fun mute(groupId: Long, userId: Long, duration: String) = sendUnit("PUT", "/api/groups/$groupId/members/$userId/mute", jsonOf("duration" to duration))
    suspend fun unmute(groupId: Long, userId: Long) = sendUnit("DELETE", "/api/groups/$groupId/members/$userId/mute")
    suspend fun groupSettings(groupId: Long, changes: JsonObject): GroupSummary = send("PATCH", "/api/groups/$groupId/settings", changes)

    // Pins, search, gallery
    suspend fun pins(groupId: Long): List<Message> = get("/api/groups/$groupId/pins")
    suspend fun pin(messageId: Long, on: Boolean): Message =
        decode(call(if (on) "PUT" else "DELETE", "/api/messages/$messageId/pin", if (on) ByteArray(0).toRequestBody() else null))
    suspend fun search(groupId: Long, q: String?, kind: String?, author: Long?): List<Message> {
        val params = buildList {
            if (!q.isNullOrBlank()) add("q=" + android.net.Uri.encode(q))
            if (kind != null) add("kind=$kind")
            if (author != null) add("author=$author")
        }.joinToString("&")
        return get("/api/groups/$groupId/search?$params")
    }
    suspend fun gallery(groupId: Long, kind: String?, author: Long?, before: Long? = null): Gallery {
        val params = buildList {
            if (kind != null) add("kind=$kind")
            if (author != null) add("author=$author")
            if (before != null) add("before=$before")
        }.joinToString("&")
        return get("/api/groups/$groupId/gallery?$params")
    }

    // Polls, location
    suspend fun sendPoll(groupId: Long, question: String, options: List<String>, multiple: Boolean): Message =
        send("POST", "/api/groups/$groupId/polls", jsonOf("question" to question, "options" to kotlinx.serialization.json.JsonArray(options.map { JsonPrimitive(it) }), "multiple" to multiple))
    suspend fun vote(messageId: Long, options: List<Int>): Message =
        send("PUT", "/api/messages/$messageId/vote", jsonOf("options" to kotlinx.serialization.json.JsonArray(options.map { JsonPrimitive(it) })))
    suspend fun closePoll(messageId: Long): Message = send("POST", "/api/messages/$messageId/close")
    suspend fun sendLocation(groupId: Long, lat: Double, lon: Double, accuracy: Int, minutes: Int, label: String): Message =
        send("POST", "/api/groups/$groupId/location", jsonOf("lat" to lat, "lon" to lon, "accuracy" to accuracy, "minutes" to minutes, "label" to label))
    suspend fun moveLocation(messageId: Long, lat: Double, lon: Double, accuracy: Int): Message =
        send("PATCH", "/api/messages/$messageId/location", jsonOf("lat" to lat, "lon" to lon, "accuracy" to accuracy))
    suspend fun stopLocation(messageId: Long): Message = decode(call("DELETE", "/api/messages/$messageId/location"))

    // Stories
    suspend fun stories(groupId: Long): List<StoryGroup> = get("/api/groups/$groupId/stories")
    suspend fun postStory(groupId: Long, bytes: ByteArray, caption: String): Story {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
        if (caption.isNotBlank()) body.addFormDataPart("caption", caption)
        body.addFormDataPart("file", "story.jpg", bytes.toRequestBody("image/jpeg".toMediaType()))
        return decode(call("POST", "/api/groups/$groupId/stories", body.build()))
    }
    suspend fun viewStory(storyId: Long) = sendUnit("POST", "/api/stories/$storyId/view")
    suspend fun deleteStory(storyId: Long) = sendUnit("DELETE", "/api/stories/$storyId")

    // GIFs, stickers, favourites
    suspend fun gifsTrending(): List<Gif> = get("/api/gifs/trending")
    suspend fun gifsSearch(q: String): List<Gif> = get("/api/gifs/search?q=" + android.net.Uri.encode(q))
    suspend fun sendGif(groupId: Long, gifId: String): Message = send("POST", "/api/groups/$groupId/gif", jsonOf("id" to gifId))
    suspend fun stickers(groupId: Long): List<Sticker> = get("/api/groups/$groupId/stickers")
    suspend fun makeSticker(groupId: Long, messageId: Long): Sticker = send("POST", "/api/groups/$groupId/stickers", jsonOf("messageId" to messageId))
    suspend fun sendSticker(groupId: Long, stickerId: Long?, builtin: String?): Message =
        send("POST", "/api/groups/$groupId/sticker", if (builtin != null) jsonOf("builtin" to builtin) else jsonOf("stickerId" to stickerId))
    suspend fun favorites(): List<Favorite> = get("/api/me/favorites")
    suspend fun addFavorite(kind: String, ref: String, data: JsonObject? = null) =
        sendUnit("PUT", "/api/me/favorites", jsonOf("kind" to kind, "ref" to ref, "data" to data))
    suspend fun removeFavorite(kind: String, ref: String) = sendUnit("DELETE", "/api/me/favorites/$kind/${android.net.Uri.encode(ref)}")

    // Shared drawing, games, recap
    suspend fun liveDraw(groupId: Long): LiveSession? = decode<LiveSession?>(call("GET", "/api/groups/$groupId/live-draw"))
    suspend fun startLiveDraw(groupId: Long, base: Long? = null): LiveSession = send("POST", "/api/groups/$groupId/live-draw", jsonOf("base" to base))
    suspend fun endLiveDraw(groupId: Long) = sendUnit("DELETE", "/api/groups/$groupId/live-draw")
    suspend fun games(groupId: Long): List<Game> = get("/api/groups/$groupId/games")
    suspend fun newGame(groupId: Long, kind: String, opponentId: Long?): Game = send("POST", "/api/groups/$groupId/games", jsonOf("kind" to kind, "opponentId" to opponentId))
    suspend fun game(gameId: Long): Game = get("/api/games/$gameId")
    suspend fun move(gameId: Long, body: JsonObject): Game = send("POST", "/api/games/$gameId/move", body)
    suspend fun quitGame(gameId: Long) = sendUnit("DELETE", "/api/games/$gameId")
    suspend fun recap(groupId: Long, month: String?): Recap = get("/api/groups/$groupId/recap" + (month?.let { "?month=$it" } ?: ""))
    suspend fun shareRecap(groupId: Long, month: String) = sendUnit("POST", "/api/groups/$groupId/recap/share", jsonOf("month" to month))

    /** The export .zip, written to [out]. */
    suspend fun export(groupId: Long, out: java.io.OutputStream) = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url("/api/groups/$groupId/export")).get()
        token()?.let { req.header("Authorization", "Bearer $it") }
        client.newCall(req.build()).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, "http_${res.code}", friendly(null, null, res.code))
            res.body!!.byteStream().copyTo(out)
        }
    }

    /** A drawing's strokes for the timelapse (JSON text). */
    suspend fun mediaBytes(path: String): String = call("GET", path)

    /** Raw bytes of a media file (base picture to draw on, download). */
    suspend fun bytes(path: String): ByteArray = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url(path)).get()
        token()?.let { req.header("Authorization", "Bearer $it") }
        val res = try {
            client.newCall(req.build()).execute()
        } catch (e: IOException) {
            throw ApiException(0, "network", tr("Impossible de joindre le serveur"))
        }
        res.use {
            if (!it.isSuccessful) throw ApiException(it.code, "http_${it.code}", friendly(null, null, it.code))
            it.body!!.bytes()
        }
    }

    private fun multipart(bytes: ByteArray, mime: String, filename: String) =
        MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", filename, bytes.toRequestBody(mime.toMediaType()))
            .build()

    companion object {
        /** Shown in "Mes appareils" on the person's other devices. */
        val DEVICE_LABEL: String = tr("Android · ") + listOf(android.os.Build.MANUFACTURER, android.os.Build.MODEL)
            .filter { it.isNotBlank() }
            .distinctBy { it.lowercase() }
            .joinToString(" ")
            .replaceFirstChar { it.uppercase() }
            .ifBlank { tr("téléphone") }

        fun friendly(code: String?, serverMessage: String?, status: Int): String = when (code) {
            "invalid_code" -> tr("Ce code n’existe pas ou a été révoqué")
            "invalid_personal_code" -> tr("Ce code personnel est inconnu (il a peut-être été régénéré)")
            "same_account" -> tr("C’est le code de ce compte-ci : entre celui de ton autre compte")
            "totp_required" -> tr("Entre le code de ton application d’authentification")
            "totp_invalid" -> tr("Code incorrect ou déjà utilisé")
            "direct_group" -> tr("Pas possible dans une discussion à deux")
            "contact_not_found" -> tr("Tu ne peux écrire qu’aux personnes de tes groupes")
            "code_expired" -> tr("Ce code a expiré")
            "code_used" -> tr("Ce code a déjà servi")
            "name_required" -> serverMessage?.let { tr(it) } ?: tr("Il manque un nom")
            "too_many_attempts" -> tr("Trop d’essais, réessaie dans quelques minutes")
            "unauthorized" -> tr("Ta session a expiré, reconnecte-toi")
            "group_not_found" -> tr("Ce groupe n’existe plus")
            "file_too_large" -> tr("Fichier trop lourd")
            "unsupported_media" -> tr("Format de fichier non pris en charge")
            "not_group_admin" -> tr("Réservé aux admins du groupe")
            "not_group_owner" -> tr("Réservé à la personne qui a créé le groupe")
            "muted" -> tr("Tu es en sourdine dans ce groupe pour l’instant")
            "gifs_disabled" -> tr("Les GIF ne sont pas activés sur ce serveur")
            "gifs_unavailable" -> tr("GIPHY ne répond pas pour l’instant")
            "not_your_turn" -> tr("Ce n’est pas ton tour")
            "not_a_player" -> tr("Cette partie se joue à deux, et tu n’en fais pas partie")
            "waiting_opponent" -> tr("On attend encore quelqu’un pour jouer")
            "game_over" -> tr("La partie est terminée")
            "poll_closed" -> tr("Le sondage est terminé")
            "location_ended" -> tr("Le partage de position est terminé")
            "not_enough_messages" -> tr("Pas encore assez de messages dans le groupe pour ce jeu")
            "not_enough_players" -> tr("Il faut au moins deux joueurs")
            "too_many_pins" -> tr("Déjà 30 messages épinglés")
            else -> serverMessage?.takeIf { status < 500 }?.let { tr(it) } ?: tr("Oups, le serveur a eu un souci ({})", status)
        }
    }
}
