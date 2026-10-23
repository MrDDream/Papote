package fr.papote.app.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import fr.papote.app.MainActivity
import fr.papote.app.PapoteApp
import fr.papote.app.R

/**
 * Keeps the WebSocket open while the app is closed, so messages arrive as notifications without any
 * Google service. Shown as a quiet, low-priority "Papote reste connecté" notification (Android requires it).
 */
class LiveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as PapoteApp
        if (!app.session.state.value.loggedIn || !app.session.state.value.background) {
            stopSelf()
            return START_NOT_STICKY
        }
        val open = android.app.PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(this, Notifier.CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Papote reste connecté")
            .setContentText("Pour recevoir tes messages même app fermée")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setContentIntent(open)
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
            if (s.loggedIn && s.background) ContextCompat.startForegroundService(context, intent) else context.stopService(intent)
        }
    }
}
