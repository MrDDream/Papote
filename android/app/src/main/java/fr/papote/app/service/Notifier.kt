package fr.papote.app.service

import fr.papote.app.tr

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import fr.papote.app.ui.chat.BubbleActivity
import androidx.core.content.ContextCompat
import fr.papote.app.MainActivity
import fr.papote.app.R
import fr.papote.app.data.Message
import fr.papote.app.ui.preview

/** Notification channels, message notifications, and the system settings Papote depends on. */
object Notifier {
    // A new channel id: the first one could have been lowered (no pop-up), and a channel's importance
    // can't be raised by the app afterwards.
    const val CHANNEL_MESSAGES = "chats"
    private const val OLD_CHANNEL_MESSAGES = "messages"
    const val CHANNEL_CONNECTION = "connection"
    const val EXTRA_GROUP_ID = "groupId"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.deleteNotificationChannel(OLD_CHANNEL_MESSAGES)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
                description = tr("Nouveaux messages de tes groupes")
                enableVibration(true)
                if (Build.VERSION.SDK_INT >= 29) setAllowBubbles(true)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_CONNECTION, tr("Connexion en arrière-plan"), NotificationManager.IMPORTANCE_MIN).apply {
                description = tr("Indique que Papote reste connecté pour recevoir les messages")
                setShowBadge(false)
            },
        )
    }

    fun canNotify(context: Context) =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun ignoresBatteryOptimizations(context: Context) =
        context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)

    /** The system dialog "Autoriser Papote à s'exécuter en arrière-plan ?". */
    fun batteryIntent(context: Context) =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))

    fun notificationSettingsIntent(context: Context) =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)

    fun openChatIntent(context: Context, groupId: Long): PendingIntent = PendingIntent.getActivity(
        context,
        groupId.toInt(),
        Intent(context, MainActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_GROUP_ID, groupId),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** The last messages of each group's notification, shown as a conversation (until opened). */
    private val history = HashMap<Long, MutableList<NotificationCompat.MessagingStyle.Message>>()

    /** Floating chat for a bubble: a small window with the conversation. */
    private fun bubbleIntent(context: Context, groupId: Long): PendingIntent = PendingIntent.getActivity(
        context,
        groupId.toInt(),
        Intent(context, BubbleActivity::class.java).putExtra("id", groupId),
        // Bubbles need a mutable PendingIntent (Android 12+).
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0),
    )

    /**
     * A conversation notification, like the other messengers: it pops up at the top of the screen,
     * shows the group's picture and the last messages, and can become a bubble (Android 11+).
     */
    suspend fun message(context: Context, m: Message, groupName: String?, authorName: String?, direct: Boolean) {
        if (!canNotify(context)) return
        val title = groupName ?: "Papote"
        val icon = ShareShortcuts.ensure(context, m.groupId, title)
        val who = authorName ?: tr("Quelqu’un")
        val author = Person.Builder().setName(who).setKey("u${m.authorId}").build()
        val text = if (m.type == "text") m.text else preview(m, null)
        val lines = synchronized(history) {
            history.getOrPut(m.groupId) { mutableListOf() }.also {
                it += NotificationCompat.MessagingStyle.Message(text, m.createdAt, author)
                while (it.size > 6) it.removeAt(0)
            }.toList()
        }
        val style = NotificationCompat.MessagingStyle(Person.Builder().setName(tr("Toi")).setKey("me").build())
            .setConversationTitle(if (direct) null else title)
            .setGroupConversation(!direct)
        lines.forEach(style::addMessage)
        val bubble = NotificationCompat.BubbleMetadata.Builder(bubbleIntent(context, m.groupId), icon)
            .setDesiredHeight(640)
            .setAutoExpandBubble(false)
            .setSuppressNotification(false)
            .build()
        val n = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(null as android.graphics.Bitmap?)
            .setContentTitle(title)
            .setContentText(if (direct) text else "$who : $text")
            .setStyle(style)
            .setShortcutId(ShareShortcuts.idOf(m.groupId))
            .setLocusId(androidx.core.content.LocusIdCompat(ShareShortcuts.idOf(m.groupId)))
            .setBubbleMetadata(bubble)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setWhen(m.createdAt)
            .setShowWhen(true)
            .setAutoCancel(true)
            .setContentIntent(openChatIntent(context, m.groupId))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(m.groupId.toInt(), n)
        } catch (_: SecurityException) {
            // Permission withdrawn in the meantime.
        }
    }

    /** Pop-ups need the channel at "high" importance (the person may have lowered it). */
    fun popsUp(context: Context): Boolean =
        context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL_MESSAGES)?.importance?.let { it >= NotificationManager.IMPORTANCE_HIGH } ?: true

    /** Bubbles are allowed by the person, per app (Android 11+). */
    fun bubblesAllowed(context: Context): Boolean = when {
        Build.VERSION.SDK_INT >= 31 -> context.getSystemService(NotificationManager::class.java).bubblePreference != NotificationManager.BUBBLE_PREFERENCE_NONE
        Build.VERSION.SDK_INT >= 29 -> @Suppress("DEPRECATION") context.getSystemService(NotificationManager::class.java).areBubblesAllowed()
        else -> false
    }

    fun channelSettingsIntent(context: Context) =
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_MESSAGES)

    fun bubbleSettingsIntent(context: Context) =
        if (Build.VERSION.SDK_INT >= 30) Intent(Settings.ACTION_APP_NOTIFICATION_BUBBLE_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        else notificationSettingsIntent(context)

    /** Opening or reading a group clears its notification. */
    fun clear(context: Context, groupId: Long) {
        synchronized(history) { history.remove(groupId) }
        NotificationManagerCompat.from(context).cancel(groupId.toInt())
        context.getSharedPreferences("papote_notifs", Context.MODE_PRIVATE).edit().remove("unread_$groupId").apply()
    }
}
