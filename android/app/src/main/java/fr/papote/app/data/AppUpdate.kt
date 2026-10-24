package fr.papote.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import fr.papote.app.BuildConfig
import kotlinx.serialization.Serializable

@Serializable
data class ApkAsset(val name: String = "", val url: String, val size: Long? = null)

@Serializable
data class LatestRelease(val version: String, val name: String = "", val url: String, val publishedAt: Long? = null, val apk: ApkAsset? = null)

/** What the server learnt from GitHub (the app never asks GitHub itself). */
@Serializable
data class UpdateInfo(val enabled: Boolean = false, val server: String = "", val latest: LatestRelease? = null)

/** A newer Papote APK than this one, from the latest GitHub release. */
object AppUpdates {
    val current: String get() = BuildConfig.VERSION_NAME

    private fun parse(v: String) = Regex("""^v?(\d+)\.(\d+)\.(\d+)""").find(v.trim())?.groupValues?.drop(1)?.map { it.toInt() }

    /** true when [a] is a strictly later version than [b]. */
    fun isNewer(a: String, b: String): Boolean {
        val x = parse(a) ?: return false
        val y = parse(b) ?: return false
        for (i in 0..2) if (x[i] != y[i]) return x[i] > y[i]
        return false
    }

    /** The release to offer, or null when this app is up to date (or the server can't tell: older server, check off). */
    suspend fun check(api: Api): LatestRelease? =
        runCatching { api.updates() }.getOrNull()?.latest?.takeIf { isNewer(it.version, current) }

    /** The APK opens in the browser, which downloads it; Android then offers to install it over this one. */
    fun download(context: Context, release: LatestRelease) {
        val url = release.apk?.url ?: release.url
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
