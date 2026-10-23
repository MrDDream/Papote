package fr.papote.app.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts the background connection after the phone reboots or the app is updated. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            LiveService.sync(context)
        }
    }
}
