package fr.papote.app.service

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.graphics.drawable.toBitmap
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import fr.papote.app.MainActivity
import fr.papote.app.PapoteApp
import fr.papote.app.data.GroupSummary
import fr.papote.app.ui.theme.tint

/**
 * The latest conversations, offered right in Android's "Partager" sheet (Direct Share) and on a long
 * press on the app icon. Picking one there sends the shared text or picture straight to it.
 */
object ShareShortcuts {
    /** Same category as res/xml/shortcuts.xml. */
    private const val CATEGORY = "fr.papote.app.SHARE_TARGET"
    private const val PREFIX = "group_"
    private const val COUNT = 6

    private var published: List<Any?>? = null

    fun groupIdOf(shortcutId: String?): Long? = shortcutId?.takeIf { it.startsWith(PREFIX) }?.removePrefix(PREFIX)?.toLongOrNull()

    suspend fun publish(context: Context, groups: List<GroupSummary>) {
        val app = PapoteApp.instance
        val top = groups.take(COUNT.coerceAtMost(ShortcutManagerCompat.getMaxShortcutCountPerActivity(context)))
        // The list refreshes on every message: only touch the system when the shortcuts would change.
        val signature = top.map { listOf(it.id, it.name, it.photo, it.peer?.photo, it.color) }
        if (signature == published) return
        published = signature
        val shortcuts = top.mapIndexed { rank, g ->
            val photo = (if (g.direct) g.peer?.photo else g.photo)?.let { app.mediaUrl(it) }
            ShortcutInfoCompat.Builder(context, "$PREFIX${g.id}")
                .setShortLabel(g.name)
                .setIcon(icon(context, photo, g.name, if (g.direct) g.peer?.color ?: g.color else g.color))
                .setIntent(Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).putExtra(Notifier.EXTRA_GROUP_ID, g.id))
                .setCategories(setOf(CATEGORY))
                .setLongLived(true)
                .setRank(rank)
                .build()
        }
        runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts) }
    }

    /** Lets the launcher rank the conversations people share to most. */
    fun used(context: Context, groupId: Long) {
        runCatching { ShortcutManagerCompat.reportShortcutUsed(context, "$PREFIX$groupId") }
    }

    fun clear(context: Context) {
        published = null
        runCatching { ShortcutManagerCompat.removeAllDynamicShortcuts(context) }
    }

    /** The group's (or person's) picture, else its initial on its colour. */
    private suspend fun icon(context: Context, photo: String?, name: String, color: String): IconCompat {
        val size = 192
        if (photo != null) {
            val result = context.imageLoader.execute(ImageRequest.Builder(context).data(photo).size(size).allowHardware(false).build())
            // Adaptive icons crop the edges a little: fine for a face.
            if (result is SuccessResult) return IconCompat.createWithAdaptiveBitmap(result.drawable.toBitmap(size, size))
        }
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(tint(color).tint.toArgb())
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = 0xFF2E2442.toInt()
            textSize = size * 0.4f
            textAlign = Paint.Align.CENTER
            typeface = Typeface.DEFAULT_BOLD
        }
        canvas.drawText(name.take(1).uppercase(), size / 2f, size / 2f - (paint.descent() + paint.ascent()) / 2, paint)
        return IconCompat.createWithAdaptiveBitmap(bitmap)
    }
}
