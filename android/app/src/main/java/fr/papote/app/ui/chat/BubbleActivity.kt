package fr.papote.app.ui.chat

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import fr.papote.app.MainActivity
import fr.papote.app.PapoteApp
import fr.papote.app.data.Session
import fr.papote.app.service.Notifier
import fr.papote.app.ui.lock.LockScreen
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.PapoteTheme

/**
 * A conversation in a bubble, floating over the other apps (like the other messengers). Anything
 * that needs a full screen (drawing, settings, a game…) opens Papote itself on that conversation.
 */
class BubbleActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val app = application as PapoteApp
        val groupId = intent.getLongExtra("id", -1)
        if (groupId <= 0 || !app.session.state.value.loggedIn) {
            finish()
            return
        }
        fun openApp() = startActivity(
            Intent(this, MainActivity::class.java)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(Notifier.EXTRA_GROUP_ID, groupId),
        )
        setContent {
            val session by app.session.state.collectAsStateWithLifecycle()
            var locked by remember { mutableStateOf(savedInstanceState == null && session.lock != Session.LockMode.None) }
            PapoteTheme(session.theme, session.look, session.style) {
                Box(Modifier.fillMaxSize().background(Papote.colors.ground).safeDrawingPadding()) {
                    if (locked && session.lock != Session.LockMode.None) {
                        LockScreen(session.lock) { locked = false }
                    } else {
                        ChatScreen(
                            groupId = groupId,
                            onBack = { finish() },
                            onDraw = ::openApp,
                            onSettings = ::openApp,
                            onGone = { finish() },
                            onMembers = ::openApp,
                            onSearch = ::openApp,
                            onGallery = ::openApp,
                            onGames = ::openApp,
                            onGame = { openApp() },
                            onLive = ::openApp,
                            onDrawing = { openApp() },
                            onDrawOver = { _, _ -> openApp() },
                            onRecap = { openApp() },
                            onPhoto = { openApp() },
                        )
                    }
                }
            }
        }
    }
}
