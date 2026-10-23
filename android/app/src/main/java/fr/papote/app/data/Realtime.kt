package fr.papote.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.boolean
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

sealed interface Event {
    /** [groupName] and [authorName] come with the event so a notification needs no extra request. */
    data class NewMessage(val message: Message, val groupName: String? = null, val authorName: String? = null, val direct: Boolean = false) : Event
    data class UpdatedMessage(val message: Message) : Event
    data class Typing(val groupId: Long, val userId: Long, val kind: String) : Event
    data class Presence(val userId: Long, val online: Boolean) : Event
    data class MemberJoined(val groupId: Long, val member: Member) : Event
    data class MemberLeft(val groupId: Long, val userId: Long) : Event
    data class MemberUpdated(val groupId: Long, val userId: Long, val role: String?, val mutedUntil: Long? = null) : Event
    data class MemberPending(val groupId: Long, val userId: Long, val name: String) : Event
    data class GroupApproved(val groupId: Long) : Event
    data class LiveDraw(val groupId: Long, val session: LiveSession?) : Event
    /** A piece of a stroke drawn by someone else (shared drawing, Pictionary). */
    data class LiveStroke(val groupId: Long, val channel: String, val userId: Long, val data: JsonObject) : Event
    data class StoriesChanged(val groupId: Long) : Event
    data class GameUpdated(val game: Game) : Event
    data class StickersChanged(val groupId: Long) : Event
    data class GroupUpdated(val groupId: Long) : Event
    data class GroupRemoved(val groupId: Long) : Event
    /** Members or authors changed (an account was merged): reload the group. */
    data class GroupRefresh(val groupId: Long) : Event
    /** Read on another of the user's devices. */
    data class GroupRead(val groupId: Long) : Event
    data class UserUpdated(val user: User) : Event
    /** Emitted after (re)connecting: screens refetch what they may have missed. */
    data object Reconnected : Event
}

/**
 * One WebSocket to the server while the app is in the foreground, reconnecting with backoff.
 * Notifications only arrive while it is open (no push service yet).
 */
class Realtime(private val client: OkHttpClient, private val session: Session, private val scope: CoroutineScope) {
    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 64)
    val events: SharedFlow<Event> = _events

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    private var socket: WebSocket? = null
    private var wanted = false
    private var retryJob: Job? = null
    private var attempt = 0

    fun start() {
        wanted = true
        if (socket == null) connect()
    }

    fun stop() {
        wanted = false
        retryJob?.cancel()
        socket?.close(1000, null)
        socket = null
        _connected.value = false
    }

    fun restart() {
        stop()
        start()
    }

    fun sendTyping(groupId: Long, kind: String) {
        socket?.send("""{"type":"typing","groupId":$groupId,"kind":"$kind"}""")
    }

    fun sendLive(groupId: Long, channel: String, data: JsonObject) {
        socket?.send(PapoteJson.encodeToString(JsonObject.serializer(), jsonOf("type" to "live", "groupId" to groupId, "channel" to channel, "data" to data)))
    }

    private fun connect() {
        val server = session.server ?: return
        val token = session.token ?: return
        val url = server.trimEnd('/').replaceFirst("http", "ws") + "/ws"
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempt = 0
                _connected.value = true
                _events.tryEmit(Event.Reconnected)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching { parse(text) }.getOrNull()?.let { _events.tryEmit(it) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket, code)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                dropped(webSocket, response?.code ?: 0)
        })
    }

    private fun dropped(ws: WebSocket, code: Int) {
        if (socket !== ws) return
        socket = null
        _connected.value = false
        // 401 on upgrade or 4001 "session revoked": the token is dead, don't hammer the server.
        if (code == 401 || code == 4001) {
            scope.launch { session.logout() }
            return
        }
        if (!wanted) return
        val wait = (1000L shl attempt.coerceAtMost(5)).coerceAtMost(30_000)
        attempt++
        retryJob = scope.launch {
            delay(wait)
            if (wanted && socket == null) connect()
        }
    }

    private fun parse(text: String): Event? {
        val o = PapoteJson.parseToJsonElement(text).jsonObject
        fun long(key: String) = o[key]!!.jsonPrimitive.long
        return when (o["type"]?.jsonPrimitive?.content) {
            "message.new" -> Event.NewMessage(
                PapoteJson.decodeFromJsonElement(o["message"]!!),
                o["groupName"]?.jsonPrimitive?.contentOrNull,
                o["authorName"]?.jsonPrimitive?.contentOrNull,
                o["direct"]?.jsonPrimitive?.booleanOrNull ?: false,
            )
            "message.updated" -> Event.UpdatedMessage(PapoteJson.decodeFromJsonElement(o["message"]!!))
            "typing" -> Event.Typing(long("groupId"), long("userId"), o["kind"]?.jsonPrimitive?.content ?: "text")
            "presence" -> Event.Presence(long("userId"), o["online"]!!.jsonPrimitive.boolean)
            "member.joined" -> Event.MemberJoined(long("groupId"), PapoteJson.decodeFromJsonElement(o["member"]!!))
            "member.left" -> Event.MemberLeft(long("groupId"), long("userId"))
            "member.updated" -> Event.MemberUpdated(long("groupId"), long("userId"), o["role"]?.jsonPrimitive?.contentOrNull, o["mutedUntil"]?.jsonPrimitive?.longOrNull)
            "member.pending" -> Event.MemberPending(long("groupId"), long("userId"), o["name"]?.jsonPrimitive?.content ?: "")
            "group.approved" -> Event.GroupApproved(long("groupId"))
            "livedraw" -> Event.LiveDraw(long("groupId"), (o["session"] as? JsonObject)?.let { PapoteJson.decodeFromJsonElement<LiveSession>(it) })
            "live" -> Event.LiveStroke(long("groupId"), o["channel"]!!.jsonPrimitive.content, long("userId"), o["data"] as JsonObject)
            "story.new", "story.removed" -> Event.StoriesChanged(long("groupId"))
            "sticker.new", "sticker.removed" -> Event.StickersChanged(long("groupId"))
            "game.updated" -> Event.GameUpdated(PapoteJson.decodeFromJsonElement(o["game"]!!))
            "group.updated" -> Event.GroupUpdated((o["group"] as JsonObject)["id"]!!.jsonPrimitive.longOrNull ?: return null)
            "group.removed" -> Event.GroupRemoved(long("groupId"))
            "group.read" -> Event.GroupRead(long("groupId"))
            "group.refresh" -> Event.GroupRefresh(long("groupId"))
            "user.updated" -> Event.UserUpdated(PapoteJson.decodeFromJsonElement(o["user"]!!))
            else -> null
        }
    }
}
