package fr.papote.app.service

import fr.papote.app.tr

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import fr.papote.app.PapoteApp
import fr.papote.app.R

/**
 * Keeps the WebSocket open while the app is closed, so messages arrive as notifications without any
 * Google service. Android requires a notification for it: silent, at the bottom of the list, and a tap
 * opens its channel's settings so the person can turn it off (the connection keeps going).
 */
class LiveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as PapoteApp
        if (!app.session.state.value.loggedIn || !app.session.state.value.background) {
            stopSelf()
            return START_NOT_STICKY
        }
        val hide = android.app.PendingIntent.getActivity(
            this, 0, Notifier.connectionSettingsIntent(this).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(this, Notifier.CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(tr("Papote reste connecté"))
            .setContentText(tr("Touche ici pour masquer cette notification"))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setSilent(true)
            .setShowWhen(false)
            .setOngoing(true)
            .setContentIntent(hide)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        } else {
            startForeground(ID, n)
        }
        app.realtime.start()
        return START_STICKY
    }

    override fun onDestroy() {
        val app = application as PapoteApp
        if (!app.inForeground) app.realtime.stop()
        super.onDestroy()
    }

    companion object {
        private const val ID = 1

        fun sync(context: Context) {
            val app = context.applicationContext as PapoteApp
            val s = app.session.state.value
            val intent = Intent(context, LiveService::class.java)
            if (!(s.loggedIn && s.background)) {
                context.stopService(intent)
                return
            }
            // Android 12+ refuses a start while the app is in the background: it starts again on the next launch.
            runCatching { ContextCompat.startForegroundService(context, intent) }
        }
    }
}
