package fr.papote.app.service

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
import androidx.core.content.ContextCompat
import fr.papote.app.MainActivity
import fr.papote.app.R
import fr.papote.app.data.Message
import fr.papote.app.ui.preview

/** Notification channels, message notifications, and the system settings Papote depends on. */
object Notifier {
    const val CHANNEL_MESSAGES = "messages"
    const val CHANNEL_CONNECTION = "connection"
    const val EXTRA_GROUP_ID = "groupId"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Nouveaux messages de tes groupes"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_CONNECTION, "Connexion en arrière-plan", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Indique que Papote reste connecté pour recevoir les messages"
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

    /** One notification per group, replaced by each new message (with a running count). */
    fun message(context: Context, m: Message, groupName: String?, authorName: String?, direct: Boolean) {
        if (!canNotify(context)) return
        val key = "unread_${m.groupId}"
        val prefs = context.getSharedPreferences("papote_notifs", Context.MODE_PRIVATE)
        val count = prefs.getInt(key, 0) + 1
        prefs.edit().putInt(key, count).apply()
        val text = preview(m, if (direct) null else authorName)
        val n = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(groupName ?: "Papote")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSubText(if (count > 1) "$count nouveaux messages" else null)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openChatIntent(context, m.groupId))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(m.groupId.toInt(), n)
        } catch (_: SecurityException) {
            // Permission withdrawn in the meantime.
        }
    }

    /** Opening or reading a group clears its notification. */
    fun clear(context: Context, groupId: Long) {
        NotificationManagerCompat.from(context).cancel(groupId.toInt())
        context.getSharedPreferences("papote_notifs", Context.MODE_PRIVATE).edit().remove("unread_$groupId").apply()
    }
}
