package fr.papote.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import fr.papote.app.data.Api
import fr.papote.app.data.Event
import fr.papote.app.data.Realtime
import fr.papote.app.data.Session
import fr.papote.app.service.LiveService
import fr.papote.app.service.ShareShortcuts
import fr.papote.app.service.Notifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

class PapoteApp : Application(), ImageLoaderFactory {
    lateinit var session: Session
        private set
    lateinit var api: Api
        private set
    lateinit var realtime: Realtime
        private set
    lateinit var http: OkHttpClient
        private set

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /** True while an activity is visible. */
    @Volatile var inForeground = false
        private set

    /** The conversation on screen, if any: no notification for it. */
    @Volatile var openGroupId: Long? = null

    /** When the app last went to the background, for the app lock. */
    var backgroundSince: Long = 0L
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        I18n.init(this)
        session = Session(this)
        http = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
            .build()
        api = Api(http, { session.server }, { session.token })
        realtime = Realtime(http, session, scope)

        // Live connection only while some activity is visible.
        Notifier.createChannels(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                inForeground = true
                if (session.state.value.loggedIn) realtime.start()
            }

            override fun onStop(owner: LifecycleOwner) {
                inForeground = false
                backgroundSince = System.currentTimeMillis()
                // With "rester connecté", the LiveService keeps the socket open for notifications.
                if (!session.state.value.background) realtime.stop()
            }
        })
        scope.launch {
            realtime.events.collect { e ->
                if (e is Event.NewMessage) notifyIfNeeded(e)
            }
        }
        // A merge done on another device moves this session to the surviving account.
        scope.launch {
            realtime.events.collect { e ->
                if (e == Event.Reconnected) runCatching { api.me() }.getOrNull()?.let { session.switchUser(it.id) }
            }
        }
        scope.launch {
            session.state.distinctUntilChangedBy { it.token to it.server }.collect {
                if (it.loggedIn) {
                    realtime.restart()
                } else {
                    realtime.stop()
                    ShareShortcuts.clear(this@PapoteApp)
                }
            }
        }
        scope.launch {
            session.state.distinctUntilChangedBy { it.loggedIn to it.background }.collect { LiveService.sync(this@PapoteApp) }
        }
    }

    private fun notifyIfNeeded(e: Event.NewMessage) {
        val m = e.message
        if (m.type == "system" || m.authorId == null || m.authorId == session.userId) return
        // On screen already: the chat itself, or the groups list with its badges.
        if (inForeground && (openGroupId == m.groupId || openGroupId == null)) return
        Notifier.message(this, m, e.groupName, e.authorName, e.direct)
    }

    /** Coil fetches media through the same client, with the session token for our own server only. */
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .okHttpClient {
            http.newBuilder().addInterceptor { chain ->
                val req = chain.request()
                val server = session.server?.toHttpUrlOrNull()
                val token = session.token
                if (server != null && token != null && req.url.host == server.host && req.url.port == server.port) {
                    chain.proceed(req.newBuilder().header("Authorization", "Bearer $token").build())
                } else {
                    chain.proceed(req)
                }
            }.build()
        }
        .diskCache { DiskCache.Builder().directory(cacheDir.resolve("media")).maxSizeBytes(200L * 1024 * 1024).build() }
        .crossfade(true)
        // GIFs and stickers play animated.
        .components {
            if (android.os.Build.VERSION.SDK_INT >= 28) add(coil.decode.ImageDecoderDecoder.Factory()) else add(coil.decode.GifDecoder.Factory())
        }
        .build()

    /** Absolute URL for a server-relative media path such as "/api/media/abc". */
    fun mediaUrl(path: String?): String? = path?.let { p -> session.server?.let { it.trimEnd('/') + p } }

    companion object {
        lateinit var instance: PapoteApp
            private set
    }
}
