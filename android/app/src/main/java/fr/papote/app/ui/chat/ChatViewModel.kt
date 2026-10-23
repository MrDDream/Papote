package fr.papote.app.ui.chat

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Event
import fr.papote.app.data.GroupSummary
import fr.papote.app.data.Member
import fr.papote.app.data.Message
import fr.papote.app.data.PapoteJson
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import fr.papote.app.data.Features
import fr.papote.app.data.LiveSession
import fr.papote.app.data.StoryGroup
import fr.papote.app.data.jsonOf
import fr.papote.app.ui.extras.BubuState
import fr.papote.app.ui.extras.LocationSharing

class ChatViewModel(handle: SavedStateHandle) : ViewModel() {
    val groupId: Long = handle["id"]!!
    private val app = PapoteApp.instance
    val meId get() = app.session.userId

    data class Typing(val kind: String, val until: Long)

    data class State(
        val group: GroupSummary? = null,
        val members: Map<Long, Member> = emptyMap(),
        /** Oldest first. */
        val messages: List<Message> = emptyList(),
        val loading: Boolean = true,
        val loadingOlder: Boolean = false,
        val reachedStart: Boolean = false,
        val typing: Map<Long, Typing> = emptyMap(),
        val uploads: Int = 0,
        val error: String? = null,
        val gone: Boolean = false,
        val pins: List<Message> = emptyList(),
        val stories: List<StoryGroup> = emptyList(),
        val live: LiveSession? = null,
        val features: Features = Features(),
        /** false while looking at older messages (a search result, a pinned message). */
        val reachedEnd: Boolean = true,
        val highlight: Long? = null,
        val info: String? = null,
    ) {
        val pending get() = members.values.filter { it.pending }
        val muted get() = (group?.mutedUntil ?: 0) > System.currentTimeMillis()

        /** Bubu's mood, from what happens in the group. */
        val bubu: BubuState
            get() {
                if (group?.birthdaysToday?.isNotEmpty() == true) return BubuState.Party
                if (live != null) return BubuState.Excited
                val now = System.currentTimeMillis()
                val recent = messages.filter { it.type != "system" && now - it.createdAt < 15 * 60_000 }
                if (recent.size >= 50 || recent.any { it.type == "voice" && (it.durationMs ?: 0) > 60_000 }) return BubuState.Surprised
                val last = messages.lastOrNull { it.type != "system" }
                return if (last == null || now - last.createdAt > 3_600_000) BubuState.Sleepy else BubuState.Happy
            }
        val me get() = members.values.firstOrNull { it.id == PapoteApp.instance.session.userId }
        val onlineCount get() = members.values.count { it.online }
    }

    val state = MutableStateFlow(State())
    val recorder = VoiceRecorder(app, viewModelScope)
    val player = VoicePlayer(app, viewModelScope)
    private var lastRead = 0L
    private var lastTypingSent = 0L

    init {
        load()
        viewModelScope.launch { app.realtime.events.collect(::onEvent) }
        // Expire typing indicators.
        viewModelScope.launch {
            while (isActive) {
                delay(1000)
                val now = System.currentTimeMillis()
                if (state.value.typing.values.any { it.until < now }) {
                    state.update { s -> s.copy(typing = s.typing.filterValues { it.until >= now }) }
                }
            }
        }
    }

    private var jumpTo: Long? = handle.get<Long>("at")?.takeIf { it > 0 }

    private fun load() {
        viewModelScope.launch {
            try {
                val group = app.api.group(groupId)
                val members = app.api.members(groupId).associateBy { it.id }
                val at = jumpTo
                jumpTo = null
                val messages = if (at != null) app.api.messagesAround(groupId, at) else app.api.messages(groupId)
                state.update {
                    it.copy(
                        group = group, members = members, messages = messages, loading = false,
                        reachedStart = at == null && messages.size < 50, reachedEnd = at == null, highlight = at, error = null,
                    )
                }
                markRead()
                loadExtras()
            } catch (e: ApiException) {
                state.update { it.copy(loading = false, error = e.message, gone = e.code == "group_not_found") }
            }
        }
    }

    private fun loadExtras() {
        viewModelScope.launch { runCatching { app.api.pins(groupId) }.onSuccess { p -> state.update { it.copy(pins = p) } } }
        viewModelScope.launch { refreshStories() }
        viewModelScope.launch { runCatching { app.api.liveDraw(groupId) }.onSuccess { l -> state.update { it.copy(live = l) } } }
        viewModelScope.launch { runCatching { app.api.server() }.onSuccess { s -> state.update { it.copy(features = s.features) } } }
    }

    suspend fun refreshStories() {
        runCatching { app.api.stories(groupId) }.onSuccess { s -> state.update { it.copy(stories = s) } }
    }

    fun loadNewer() {
        val s = state.value
        if (s.reachedEnd || s.loadingOlder || s.messages.isEmpty()) return
        state.update { it.copy(loadingOlder = true) }
        viewModelScope.launch {
            try {
                val newer = app.api.messagesAfter(groupId, s.messages.last().id)
                state.update { it.copy(messages = (it.messages + newer).distinctBy { m -> m.id }.sortedBy { m -> m.id }, loadingOlder = false, reachedEnd = newer.size < 100) }
            } catch (e: ApiException) {
                state.update { it.copy(loadingOlder = false, error = e.message) }
            }
        }
    }

    fun backToLatest() {
        viewModelScope.launch {
            runCatching { app.api.messages(groupId) }.onSuccess { m ->
                state.update { it.copy(messages = m, reachedEnd = true, reachedStart = m.size < 50, highlight = null) }
                markRead()
            }
        }
    }

    fun clearHighlight() = state.update { it.copy(highlight = null) }

    fun loadOlder() {
        val s = state.value
        if (s.loadingOlder || s.reachedStart || s.messages.isEmpty()) return
        state.update { it.copy(loadingOlder = true) }
        viewModelScope.launch {
            try {
                val older = app.api.messages(groupId, before = s.messages.first().id)
                state.update { it.copy(messages = older + it.messages, loadingOlder = false, reachedStart = older.size < 50) }
            } catch (e: ApiException) {
                state.update { it.copy(loadingOlder = false, error = e.message) }
            }
        }
    }

    private fun onEvent(e: Event) {
        when (e) {
            is Event.NewMessage -> if (e.message.groupId == groupId && state.value.reachedEnd) {
                upsert(e.message)
                // Talkie mode: other people's voice messages play by themselves.
                if (app.session.talkie(groupId) && e.message.type == "voice" && e.message.authorId != meId && !player.state.value.playing) play(e.message)
                e.message.authorId?.let { a -> state.update { it.copy(typing = it.typing - a) } }
                markRead()
            }
            is Event.UpdatedMessage -> if (e.message.groupId == groupId) {
                val before = state.value.messages.firstOrNull { it.id == e.message.id }
                if (before != null || state.value.reachedEnd) upsert(e.message)
                if (before?.pinnedAt != e.message.pinnedAt || e.message.deleted) viewModelScope.launch {
                    runCatching { app.api.pins(groupId) }.onSuccess { p -> state.update { it.copy(pins = p) } }
                }
            }
            is Event.LiveDraw -> if (e.groupId == groupId) state.update { it.copy(live = e.session) }
            is Event.StoriesChanged -> if (e.groupId == groupId) viewModelScope.launch { refreshStories() }
            is Event.MemberPending -> if (e.groupId == groupId) viewModelScope.launch {
                runCatching { app.api.members(groupId) }.onSuccess { ms -> state.update { it.copy(members = ms.associateBy { m -> m.id }) } }
            }
            is Event.Typing -> if (e.groupId == groupId) {
                state.update { it.copy(typing = it.typing + (e.userId to Typing(e.kind, System.currentTimeMillis() + 5000))) }
            }
            is Event.Presence -> state.update { s ->
                val m = s.members[e.userId] ?: return@update s
                s.copy(members = s.members + (m.id to m.copy(online = e.online, lastSeenAt = if (e.online) m.lastSeenAt else System.currentTimeMillis())))
            }
            is Event.MemberJoined -> if (e.groupId == groupId) state.update { it.copy(members = it.members + (e.member.id to e.member)) }
            is Event.MemberLeft -> if (e.groupId == groupId) state.update { it.copy(members = it.members - e.userId) }
            is Event.MemberUpdated -> if (e.groupId == groupId) state.update { s ->
                val m = s.members[e.userId] ?: return@update s
                s.copy(members = s.members + (m.id to m.copy(role = e.role ?: m.role, mutedUntil = e.mutedUntil)))
            }
            is Event.UserUpdated -> state.update { s ->
                val m = s.members[e.user.id] ?: return@update s
                s.copy(members = s.members + (m.id to m.copy(name = e.user.name, color = e.user.color, photo = e.user.photo, bio = e.user.bio, mood = e.user.mood)))
            }
            is Event.GroupUpdated -> if (e.groupId == groupId) viewModelScope.launch {
                runCatching { app.api.group(groupId) }.getOrNull()?.let { g -> state.update { it.copy(group = g) } }
            }
            is Event.GroupRemoved -> if (e.groupId == groupId) state.update { it.copy(gone = true) }
            Event.Reconnected -> catchUp()
            is Event.GroupRead -> Unit
            is Event.GroupRefresh -> if (e.groupId == groupId) load()
            else -> Unit
        }
    }

    /** After a reconnect, fetch whatever arrived while the socket was down. */
    private fun catchUp() {
        viewModelScope.launch {
            runCatching {
                val latest = app.api.messages(groupId)
                latest.forEach(::upsert)
                val members = app.api.members(groupId).associateBy { it.id }
                state.update { it.copy(members = members) }
            }
            markRead()
        }
    }

    private fun upsert(m: Message) {
        state.update { s ->
            val i = s.messages.indexOfFirst { it.id == m.id }
            val list = if (i >= 0) s.messages.toMutableList().also { it[i] = m } else (s.messages + m).sortedBy { it.id }
            s.copy(messages = list)
        }
    }

    private fun markRead() {
        val last = state.value.messages.lastOrNull()?.id ?: return
        if (last <= lastRead) return
        lastRead = last
        viewModelScope.launch { runCatching { app.api.markRead(groupId, last) } }
    }

    fun typing(kind: String = "text") {
        val now = System.currentTimeMillis()
        if (now - lastTypingSent < 3000) return
        lastTypingSent = now
        app.realtime.sendTyping(groupId, kind)
    }

    private fun upload(block: suspend () -> Message) {
        state.update { it.copy(uploads = it.uploads + 1, error = null) }
        viewModelScope.launch {
            try {
                upsert(block())
            } catch (e: ApiException) {
                state.update { it.copy(error = e.message) }
            } catch (e: Exception) {
                state.update { it.copy(error = "Envoi impossible : ${e.message ?: "erreur inconnue"}") }
            } finally {
                state.update { it.copy(uploads = it.uploads - 1) }
            }
        }
    }

    fun sendText(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        upload { app.api.sendText(groupId, t) }
    }

    fun sendPhoto(uri: Uri) = upload {
        val img = prepareImage(app, uri)
        app.api.sendMedia(groupId, "photo", img.bytes, "image/jpeg", "photo.jpg", mapOf("width" to "${img.width}", "height" to "${img.height}"))
    }

    fun startVoice(): Boolean = runCatching {
        recorder.start()
        typing("voice")
    }.isSuccess

    fun cancelVoice() = recorder.cancel()

    fun sendVoice(filter: String = "") {
        val r = recorder.stop() ?: return
        upload {
            try {
                val fields = mutableMapOf("durationMs" to "${r.durationMs}", "waveform" to PapoteJson.encodeToString(r.waveform))
                if (filter.isNotEmpty()) fields["filter"] = filter
                app.api.sendMedia(groupId, "voice", r.file.readBytes(), "audio/mp4", "vocal.m4a", fields)
            } finally {
                r.file.delete()
            }
        }
    }

    fun toggleReaction(m: Message, kind: String) {
        val on = meId !in (m.reactions[kind] ?: emptyList())
        viewModelScope.launch {
            try {
                upsert(app.api.react(m.id, kind, on))
            } catch (e: ApiException) {
                state.update { it.copy(error = e.message) }
            }
        }
    }

    fun delete(m: Message) {
        viewModelScope.launch {
            try {
                app.api.deleteMessage(m.id)
            } catch (e: ApiException) {
                state.update { it.copy(error = e.message) }
            }
        }
    }

    fun play(m: Message) {
        val url = app.mediaUrl(m.media?.url) ?: return
        player.toggle(m.id, url, app.session.token, app.session.voiceSpeed, m.metaString("filter").orEmpty())
    }

    fun cycleSpeed() {
        val speeds = listOf(1f, 1.5f, 2f)
        val next = speeds[(speeds.indexOf(app.session.voiceSpeed).coerceAtLeast(0) + 1) % speeds.size]
        app.session.voiceSpeed = next
        player.setSpeed(next)
        state.update { it.copy() }
    }

    private fun act(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: ApiException) {
                state.update { it.copy(error = e.message) }
            }
        }
    }

    fun pin(m: Message) = act { upsert(app.api.pin(m.id, m.pinnedAt == null)) }
    fun makeSticker(m: Message) = act {
        app.api.makeSticker(groupId, m.id)
        state.update { it.copy(info = "Sticker ajouté au groupe") }
    }
    fun vote(m: Message, option: Int) = act {
        val mine = m.votes.orEmpty().filterValues { meId in it }.keys.mapNotNull { it.toIntOrNull() }
        val next = when {
            option in mine -> mine - option
            m.metaBool("multiple") -> mine + option
            else -> listOf(option)
        }
        upsert(app.api.vote(m.id, next))
    }
    fun closePoll(m: Message) = act { upsert(app.api.closePoll(m.id)) }
    fun sendPoll(question: String, options: List<String>, multiple: Boolean) = upload { app.api.sendPoll(groupId, question, options, multiple) }
    fun sendGif(id: String) = upload { app.api.sendGif(groupId, id) }
    fun sendSticker(stickerId: Long?, builtin: String?) = upload { app.api.sendSticker(groupId, stickerId, builtin) }
    fun sendLocation(lat: Double, lon: Double, accuracy: Int, minutes: Int, label: String) = upload {
        app.api.sendLocation(groupId, lat, lon, accuracy, minutes, label).also { m ->
            if (minutes > 0) LocationSharing.start(app, m.id, System.currentTimeMillis() + minutes * 60_000L)
        }
    }
    fun stopLocation(m: Message) = act {
        LocationSharing.stop(m.id)
        upsert(app.api.stopLocation(m.id))
    }
    fun dismissInfo() = state.update { it.copy(info = null) }

    fun dismissError() = state.update { it.copy(error = null) }

    override fun onCleared() {
        recorder.cancel()
        player.release()
    }
}
