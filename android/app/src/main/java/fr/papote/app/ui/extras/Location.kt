package fr.papote.app.ui.extras

import fr.papote.app.tr

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Looper
import fr.papote.app.PapoteApp
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

// Position sharing without a map and without Google: the phone's own location providers, coordinates sent
// to the Papote server only. Opening them in a maps app is the person's choice (geo: link).

private fun providers(lm: LocationManager) =
    listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }

@SuppressLint("MissingPermission")
suspend fun currentLocation(context: Context): Location? {
    val lm = context.getSystemService(LocationManager::class.java) ?: return null
    val available = providers(lm)
    if (available.isEmpty()) return null
    // A recent fix is good enough (and instant).
    available.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
        .filter { System.currentTimeMillis() - it.time < 2 * 60_000 }
        .minByOrNull { it.accuracy }
        ?.let { return it }
    return withTimeoutOrNull(20_000) {
        suspendCancellableCoroutine { cont ->
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    lm.removeUpdates(this)
                    if (cont.isActive) cont.resume(location)
                }
            }
            available.forEach { lm.requestLocationUpdates(it, 0L, 0f, listener, Looper.getMainLooper()) }
            cont.invokeOnCancellation { lm.removeUpdates(listener) }
        }
    }
}

/** Live sharing ("Partagée 1 h"): sends the position every 20 s or so until the time is up. */
object LocationSharing {
    private val active = HashMap<Long, LocationListener>()

    @SuppressLint("MissingPermission")
    fun start(app: PapoteApp, messageId: Long, until: Long) {
        val lm = app.getSystemService(LocationManager::class.java) ?: return
        var last = 0L
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val now = System.currentTimeMillis()
                if (now > until) return stop(messageId)
                if (now - last < 20_000) return
                last = now
                app.scope.launch {
                    runCatching { app.api.moveLocation(messageId, location.latitude, location.longitude, location.accuracy.toInt()) }
                        .onFailure { stop(messageId) }
                }
            }
        }
        providers(lm).forEach { runCatching { lm.requestLocationUpdates(it, 20_000L, 10f, listener, Looper.getMainLooper()) } }
        active[messageId] = listener
    }

    fun stop(messageId: Long) {
        val l = active.remove(messageId) ?: return
        PapoteApp.instance.getSystemService(LocationManager::class.java)?.removeUpdates(l)
    }
}

fun openInMaps(context: Context, lat: Double, lon: Double, label: String) {
    val uri = Uri.parse("geo:$lat,$lon?q=$lat,$lon(${Uri.encode(label.ifBlank { tr("Position") })})")
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
