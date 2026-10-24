package fr.papote.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.fragment.app.FragmentActivity
import fr.papote.app.data.Session
import fr.papote.app.service.Notifier
import fr.papote.app.ui.contacts.ContactsScreen
import fr.papote.app.ui.lock.LockScreen
import fr.papote.app.ui.profile.NotificationPrompt
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import fr.papote.app.ui.chat.ChatScreen
import fr.papote.app.ui.draw.DrawScreen
import fr.papote.app.ui.draw.DrawingScreen
import fr.papote.app.ui.draw.LiveDrawScreen
import fr.papote.app.ui.games.GameScreen
import fr.papote.app.ui.games.GamesScreen
import fr.papote.app.ui.group.GalleryScreen
import fr.papote.app.ui.group.GroupSettingsScreen
import fr.papote.app.ui.group.RecapScreen
import fr.papote.app.ui.group.SearchScreen
import fr.papote.app.ui.photo.PhotoEditScreen
import fr.papote.app.ui.groups.GroupsScreen
import fr.papote.app.ui.invite.InviteScreen
import fr.papote.app.ui.join.JoinScreen
import fr.papote.app.ui.members.MembersScreen
import fr.papote.app.ui.profile.ProfileScreen
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.PapoteTheme
import androidx.core.content.IntentCompat
import fr.papote.app.service.ShareShortcuts
import fr.papote.app.ui.chat.PendingPhoto
import fr.papote.app.ui.chat.PendingShare
import fr.papote.app.ui.share.ShareScreen
import fr.papote.app.ui.share.Shared

/** An invitation opened from a shared papote://join link. */
data class PendingInvite(val server: String?, val code: String?)

/** "Partager" → Papote from another app; [groupId] when a conversation was picked in the share sheet itself. */
data class IncomingShare(val shared: Shared, val groupId: Long?)

// FragmentActivity (not ComponentActivity): the fingerprint prompt needs it.
class MainActivity : FragmentActivity() {
    private val pendingInvite = mutableStateOf<PendingInvite?>(null)
    private val pendingChat = mutableStateOf<Long?>(null)
    private val incomingShare = mutableStateOf<IncomingShare?>(null)
    /** What the share screen offers to send, until a conversation is picked. */
    private val sharing = mutableStateOf<Shared?>(null)
    private val locked = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        pendingInvite.value = parseInvite(intent?.data)
        pendingChat.value = intent?.getLongExtra(Notifier.EXTRA_GROUP_ID, -1)?.takeIf { it > 0 }
        if (savedInstanceState == null) incomingShare.value = parseShare(intent)
        val app = application as PapoteApp
        locked.value = savedInstanceState == null && app.session.state.value.lock != Session.LockMode.None
        setContent {
            val session by app.session.state.collectAsStateWithLifecycle()
            // Hide the content from the recent-apps screen and screenshots when the app lock is on.
            LaunchedEffect(session.lock) {
                if (session.lock != Session.LockMode.None) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
            PapoteTheme(session.theme, session.style) {
                Box(Modifier.fillMaxSize().background(Papote.colors.ground).safeDrawingPadding()) {
                    val nav = rememberNavController()
                    val invite = pendingInvite.value
                    LaunchedEffect(invite) {
                        if (invite != null) {
                            nav.navigate(Routes.join(invite.server, invite.code))
                            pendingInvite.value = null
                        }
                    }
                    val chat = pendingChat.value
                    LaunchedEffect(chat, session.loggedIn) {
                        if (chat != null && session.loggedIn) {
                            nav.navigate(Routes.chat(chat)) { launchSingleTop = true }
                            pendingChat.value = null
                        }
                    }
                    val share = incomingShare.value
                    LaunchedEffect(share, session.loggedIn) {
                        if (share != null && session.loggedIn) {
                            incomingShare.value = null
                            if (share.groupId != null) {
                                sendShared(nav, share.groupId, share.shared)
                            } else {
                                sharing.value = share.shared
                                nav.navigate(Routes.SHARE) { launchSingleTop = true }
                            }
                        }
                    }
                    // Logged out (by hand or because the token died): back to the join screen.
                    LaunchedEffect(session.loggedIn) {
                        if (!session.loggedIn && nav.currentDestination?.route?.startsWith("join") != true) {
                            nav.navigate(Routes.join(null, null)) { popUpTo(0) }
                        }
                    }
                    PapoteNav(nav, startLoggedIn = session.loggedIn, sharing = sharing.value, onShareTo = { id ->
                        sharing.value?.let { sendShared(nav, id, it) }
                    })
                    if (session.loggedIn && !locked.value) NotificationPrompt()
                    if (locked.value && session.lock != Session.LockMode.None) {
                        LockScreen(session.lock) { locked.value = false }
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val app = application as PapoteApp
        val s = app.session.state.value
        // Coming back after more than the chosen delay: lock again.
        if (s.lock != Session.LockMode.None && app.backgroundSince > 0 &&
            System.currentTimeMillis() - app.backgroundSince >= s.lockAfter * 1000L
        ) {
            locked.value = true
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        parseInvite(intent.data)?.let { pendingInvite.value = it }
        intent.getLongExtra(Notifier.EXTRA_GROUP_ID, -1).takeIf { it > 0 }?.let { pendingChat.value = it }
        parseShare(intent)?.let { incomingShare.value = it }
    }

    private fun parseShare(intent: Intent?): IncomingShare? {
        if (intent?.action != Intent.ACTION_SEND) return null
        // Apps often repeat the title inside the text (a link and its page title): keep each piece once.
        val parts = listOfNotNull(intent.getStringExtra(Intent.EXTRA_SUBJECT), intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString())
            .map { it.trim() }.filter { it.isNotEmpty() }
        val text = parts.filterIndexed { i, p -> parts.withIndex().none { (j, o) -> j != i && o.contains(p) && (o.length > p.length || j < i) } }
            .joinToString("\n").takeIf { it.isNotEmpty() }
        val image = if (intent.type?.startsWith("image/") == true) IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) else null
        if (text == null && image == null) return null
        return IncomingShare(Shared(text, image), ShareShortcuts.groupIdOf(intent.getStringExtra(androidx.core.content.pm.ShortcutManagerCompat.EXTRA_SHORTCUT_ID)))
    }

    /** Opens the conversation with the shared text in its field; a picture goes through "Décorer la photo" first. */
    private fun sendShared(nav: NavHostController, groupId: Long, shared: Shared) {
        ShareShortcuts.used(this, groupId)
        PendingShare.text = shared.text
        nav.navigate(Routes.chat(groupId)) { popUpTo(Routes.GROUPS) }
        if (shared.image != null) {
            PendingPhoto.uri = shared.image
            nav.navigate(Routes.photo(groupId, false))
        }
    }

    private fun parseInvite(uri: Uri?): PendingInvite? {
        if (uri?.scheme != "papote" || uri.host != "join") return null
        return PendingInvite(uri.getQueryParameter("server"), uri.getQueryParameter("code"))
    }
}

object Routes {
    const val GROUPS = "groups"
    const val PROFILE = "profile"
    const val NEW_GROUP = "newgroup"
    const val CONTACTS = "contacts"
    const val SHARE = "share"
    fun join(server: String?, code: String?) =
        "join?server=${Uri.encode(server.orEmpty())}&code=${Uri.encode(code.orEmpty())}"
    fun chat(id: Long) = "chat/$id"
    fun draw(id: Long) = "draw/$id"
    fun invite(id: Long) = "invite/$id"
    fun members(id: Long) = "members/$id"
    fun settings(id: Long) = "settings/$id"
    fun search(id: Long) = "search/$id"
    fun gallery(id: Long) = "gallery/$id"
    fun games(id: Long) = "games/$id"
    fun game(id: Long) = "game/$id"
    fun live(id: Long) = "live/$id"
    fun recap(id: Long, month: String? = null) = "recap/$id?month=${month.orEmpty()}"
    fun photo(id: Long, story: Boolean) = "photo/$id?story=$story"
    fun drawing(groupId: Long, messageId: Long) = "drawing/$groupId/$messageId"
    fun drawOver(groupId: Long, messageId: Long, url: String) = "draw/$groupId?base=$messageId&img=${Uri.encode(url)}"
    fun chatAt(id: Long, messageId: Long) = "chat/$id?at=$messageId"
}

@Composable
private fun PapoteNav(nav: NavHostController, startLoggedIn: Boolean, sharing: Shared?, onShareTo: (Long) -> Unit) {
    val groupArg = listOf(navArgument("id") { type = NavType.LongType })
    // Fixed for the activity's lifetime: changing it would reset the back stack on login/logout.
    val start = remember { if (startLoggedIn) Routes.GROUPS else "join?server=&code=" }
    NavHost(nav, startDestination = start) {
        composable(
            "join?server={server}&code={code}",
            arguments = listOf(
                navArgument("server") { defaultValue = "" },
                navArgument("code") { defaultValue = "" },
            ),
        ) { entry ->
            JoinScreen(
                initialServer = entry.arguments?.getString("server").orEmpty(),
                initialCode = entry.arguments?.getString("code").orEmpty(),
                onBack = if (nav.previousBackStackEntry != null) ({ nav.popBackStack() }) else null,
                onJoined = { groupId ->
                    nav.navigate(Routes.GROUPS) { popUpTo(0) }
                    if (groupId != null) nav.navigate(Routes.chat(groupId))
                },
            )
        }
        composable(Routes.GROUPS) {
            GroupsScreen(
                onOpen = { nav.navigate(Routes.chat(it)) },
                onJoinCode = { nav.navigate(Routes.join(null, null)) },
                onNewGroup = { nav.navigate(Routes.NEW_GROUP) },
                onProfile = { nav.navigate(Routes.PROFILE) },
                onContacts = { nav.navigate(Routes.CONTACTS) },
            )
        }
        composable(Routes.SHARE) {
            // Nothing left to share (the app was restarted meanwhile): straight back.
            if (sharing == null) LaunchedEffect(Unit) { nav.popBackStack() }
            else ShareScreen(sharing, onBack = { nav.popBackStack() }, onPick = { onShareTo(it.id) })
        }
        composable(Routes.CONTACTS) {
            ContactsScreen(onBack = { nav.popBackStack() }, onOpen = { id -> nav.navigate(Routes.chat(id)) { popUpTo(Routes.GROUPS) } })
        }
        composable("chat/{id}?at={at}", groupArg + navArgument("at") { type = NavType.LongType; defaultValue = 0L }) { entry ->
            val id = entry.arguments!!.getLong("id")
            ChatScreen(
                groupId = id,
                onBack = { nav.popBackStack() },
                onDraw = { nav.navigate(Routes.draw(id)) },
                onSettings = { nav.navigate(Routes.settings(id)) },
                onGone = { nav.popBackStack(Routes.GROUPS, inclusive = false) },
                onMembers = { nav.navigate(Routes.members(id)) },
                onSearch = { nav.navigate(Routes.search(id)) },
                onGallery = { nav.navigate(Routes.gallery(id)) },
                onGames = { nav.navigate(Routes.games(id)) },
                onGame = { nav.navigate(Routes.game(it)) },
                onLive = { nav.navigate(Routes.live(id)) },
                onDrawing = { nav.navigate(Routes.drawing(id, it)) },
                onDrawOver = { mid, url -> nav.navigate(Routes.drawOver(id, mid, url)) },
                onRecap = { nav.navigate(Routes.recap(id, it)) },
                onPhoto = { story -> nav.navigate(Routes.photo(id, story)) },
            )
        }
        composable(
            "draw/{id}?base={base}&img={img}",
            groupArg + listOf(navArgument("base") { type = NavType.LongType; defaultValue = 0L }, navArgument("img") { defaultValue = "" }),
        ) { entry ->
            val a = entry.arguments!!
            DrawScreen(
                groupId = a.getLong("id"),
                onClose = { nav.popBackStack() },
                baseMessageId = a.getLong("base").takeIf { it > 0 },
                baseUrl = a.getString("img")?.takeIf { it.startsWith("/api/media/") },
            )
        }
        composable("live/{id}", groupArg) { entry -> LiveDrawScreen(entry.arguments!!.getLong("id"), onClose = { nav.popBackStack() }) }
        composable("drawing/{gid}/{mid}", listOf(navArgument("gid") { type = NavType.LongType }, navArgument("mid") { type = NavType.LongType })) { entry ->
            val gid = entry.arguments!!.getLong("gid")
            DrawingScreen(gid, entry.arguments!!.getLong("mid"), onBack = { nav.popBackStack() }, onDrawOver = { mid, url -> nav.navigate(Routes.drawOver(gid, mid, url)) })
        }
        composable("settings/{id}", groupArg) { entry ->
            val id = entry.arguments!!.getLong("id")
            GroupSettingsScreen(
                groupId = id,
                onBack = { nav.popBackStack() },
                onMembers = { nav.navigate(Routes.members(id)) },
                onInvite = { nav.navigate(Routes.invite(id)) },
                onGallery = { nav.navigate(Routes.gallery(id)) },
                onSearch = { nav.navigate(Routes.search(id)) },
                onGames = { nav.navigate(Routes.games(id)) },
                onRecap = { nav.navigate(Routes.recap(id)) },
                onLeft = { nav.popBackStack(Routes.GROUPS, inclusive = false) },
            )
        }
        composable("search/{id}", groupArg) { entry ->
            val id = entry.arguments!!.getLong("id")
            SearchScreen(id, onBack = { nav.popBackStack() }, onOpen = { mid -> nav.navigate(Routes.chatAt(id, mid)) { popUpTo(Routes.GROUPS) } })
        }
        composable("gallery/{id}", groupArg) { entry ->
            val id = entry.arguments!!.getLong("id")
            GalleryScreen(id, onBack = { nav.popBackStack() }, onDrawing = { nav.navigate(Routes.drawing(id, it)) })
        }
        composable("games/{id}", groupArg) { entry ->
            GamesScreen(entry.arguments!!.getLong("id"), onBack = { nav.popBackStack() }, onOpen = { nav.navigate(Routes.game(it)) })
        }
        composable("game/{id}", groupArg) { entry -> GameScreen(entry.arguments!!.getLong("id"), onBack = { nav.popBackStack() }) }
        composable("recap/{id}?month={month}", groupArg + navArgument("month") { defaultValue = "" }) { entry ->
            RecapScreen(entry.arguments!!.getLong("id"), entry.arguments!!.getString("month"), onBack = { nav.popBackStack() })
        }
        composable("photo/{id}?story={story}", groupArg + navArgument("story") { type = NavType.BoolType; defaultValue = false }) { entry ->
            PhotoEditScreen(entry.arguments!!.getLong("id"), entry.arguments!!.getBoolean("story"), onDone = { nav.popBackStack() })
        }
        composable(Routes.NEW_GROUP) {
            InviteScreen(
                groupId = null,
                onBack = { nav.popBackStack() },
                onDone = { id -> nav.navigate(Routes.chat(id)) { popUpTo(Routes.GROUPS) } },
            )
        }
        composable("invite/{id}", groupArg) { entry ->
            InviteScreen(groupId = entry.arguments!!.getLong("id"), onBack = { nav.popBackStack() }, onDone = { nav.popBackStack() })
        }
        composable("members/{id}", groupArg) { entry ->
            val id = entry.arguments!!.getLong("id")
            MembersScreen(
                groupId = id,
                onBack = { nav.popBackStack() },
                onInvite = { nav.navigate(Routes.invite(id)) },
                onLeft = { nav.popBackStack(Routes.GROUPS, inclusive = false) },
            )
        }
        composable(Routes.PROFILE) {
            ProfileScreen(onBack = { nav.popBackStack() })
        }
    }
}
