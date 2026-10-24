package fr.papote.app.ui.chat

import fr.papote.app.tr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** A photo ready to upload: re-encoded JPEG, at most [MAX_SIDE] px on its long side. */
class PreparedImage(val bytes: ByteArray, val width: Int, val height: Int)

private const val MAX_SIDE = 1600

suspend fun prepareImage(context: Context, uri: Uri): PreparedImage = withContext(Dispatchers.Default) {
    val bitmap: Bitmap = if (Build.VERSION.SDK_INT >= 28) {
        // ImageDecoder applies EXIF rotation for us and can downscale while decoding.
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val (w, h) = info.size.width to info.size.height
            val scale = MAX_SIDE.toFloat() / max(w, h)
            if (scale < 1f) decoder.setTargetSize((w * scale).roundToInt(), (h * scale).roundToInt())
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
        val decoded = context.contentResolver.openInputStream(uri)!!.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: error(tr("Image illisible"))
        val scale = MAX_SIDE.toFloat() / max(decoded.width, decoded.height)
        if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).roundToInt(), (decoded.height * scale).roundToInt(), true) else decoded
    }
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
    PreparedImage(out.toByteArray(), bitmap.width, bitmap.height)
}

/** Records AAC voice notes and samples the level for the live bars and the stored waveform. */
class VoiceRecorder(private val context: Context, private val scope: CoroutineScope) {
    class Result(val file: File, val durationMs: Long, val waveform: List<Int>)

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    private var sampler: Job? = null
    private val samples = mutableListOf<Int>()

    private val _levels = MutableStateFlow<List<Int>>(emptyList())
    /** Most recent levels (0–100), newest last. */
    val levels: StateFlow<List<Int>> = _levels
    private val _elapsed = MutableStateFlow(0L)
    val elapsed: StateFlow<Long> = _elapsed

    val recording get() = recorder != null

    fun start() {
        if (recorder != null) return
        val f = File.createTempFile("vocal", ".m4a", context.cacheDir)
        @Suppress("DEPRECATION")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioChannels(1)
        r.setAudioSamplingRate(44_100)
        r.setAudioEncodingBitRate(64_000)
        r.setMaxDuration(5 * 60 * 1000)
        r.setOutputFile(f.absolutePath)
        r.prepare()
        r.start()
        recorder = r
        file = f
        startedAt = System.currentTimeMillis()
        samples.clear()
        _levels.value = emptyList()
        sampler = scope.launch {
            while (isActive) {
                delay(80)
                val amp = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
                // sqrt makes quiet speech visible without clipping loud bits.
                val level = (sqrt(amp / 32767.0) * 100).roundToInt().coerceIn(4, 100)
                samples += level
                _levels.value = (_levels.value + level).takeLast(40)
                _elapsed.value = System.currentTimeMillis() - startedAt
            }
        }
    }

    fun stop(): Result? {
        val r = recorder ?: return null
        sampler?.cancel()
        recorder = null
        val duration = System.currentTimeMillis() - startedAt
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val f = file ?: return null
        if (!ok || duration < 600) {
            f.delete()
            return null
        }
        return Result(f, duration, downsample(samples, 40))
    }

    fun cancel() {
        val r = recorder ?: return
        sampler?.cancel()
        recorder = null
        runCatching { r.stop() }
        r.release()
        file?.delete()
    }

    private fun downsample(src: List<Int>, n: Int): List<Int> {
        if (src.isEmpty()) return emptyList()
        if (src.size <= n) return src
        return List(n) { i ->
            val from = i * src.size / n
            val to = ((i + 1) * src.size / n).coerceAtLeast(from + 1)
            src.subList(from, to).max()
        }
    }
}

/** Plays one voice note at a time, straight from the server with the session token. */
class VoicePlayer(private val context: Context, private val scope: CoroutineScope) {
    data class State(val messageId: Long? = null, val playing: Boolean = false, val positionMs: Long = 0, val durationMs: Long = 0)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var player: MediaPlayer? = null
    private var ticker: Job? = null

    private var speed = 1f
    private var filter = ""
    private var reverb: android.media.audiofx.PresetReverb? = null

    /** Speed and the sender's voice filter ("souris", "geant"… change the pitch; "echo", "robot" add reverb). */
    private fun applyParams(mp: MediaPlayer) {
        val pitch = when (filter) {
            "souris" -> 1.45f
            "geant" -> 0.72f
            "robot" -> 0.85f
            else -> 1f
        }
        runCatching { mp.playbackParams = mp.playbackParams.setSpeed(speed * pitch).setPitch(pitch) }
        if (filter == "echo" || filter == "robot") runCatching {
            val r = reverb ?: android.media.audiofx.PresetReverb(1, 0).also { reverb = it }
            r.preset = if (filter == "echo") android.media.audiofx.PresetReverb.PRESET_LARGEHALL else android.media.audiofx.PresetReverb.PRESET_SMALLROOM
            r.enabled = true
            mp.attachAuxEffect(r.id)
            mp.setAuxEffectSendLevel(1f)
        }
    }

    fun setSpeed(value: Float) {
        speed = value
        player?.let { if (it.isPlaying) applyParams(it) }
    }

    fun toggle(messageId: Long, url: String, token: String?, speed: Float = 1f, filter: String = "") {
        this.speed = speed
        this.filter = filter
        val s = _state.value
        val p = player
        if (s.messageId == messageId && p != null) {
            if (p.isPlaying) {
                p.pause()
                _state.value = s.copy(playing = false)
            } else {
                p.start()
                _state.value = s.copy(playing = true)
                tick()
            }
            return
        }
        release()
        val mp = MediaPlayer()
        player = mp
        _state.value = State(messageId = messageId, playing = true)
        mp.setDataSource(context, Uri.parse(url), token?.let { mapOf("Authorization" to "Bearer $it") } ?: emptyMap())
        mp.setOnPreparedListener {
            applyParams(it)
            it.start()
            _state.value = _state.value.copy(durationMs = it.duration.toLong())
            tick()
        }
        mp.setOnCompletionListener { release() }
        mp.setOnErrorListener { _, _, _ ->
            release()
            true
        }
        mp.prepareAsync()
    }

    private fun tick() {
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive) {
                val p = player ?: break
                runCatching { _state.value = _state.value.copy(positionMs = p.currentPosition.toLong()) }
                if (!_state.value.playing) break
                delay(100)
            }
        }
    }

    fun release() {
        ticker?.cancel()
        reverb?.release()
        reverb = null
        player?.release()
        player = null
        _state.value = State()
    }
}

/** A video or a document picked to be sent as it is (no re-encoding). */
class PickedFile(val bytes: ByteArray, val mime: String, val name: String, val fields: Map<String, String>)

class TooBigException(val size: Long) : Exception()

/** Reads a picked video or document, refusing it before upload when it's over [maxMb]. */
suspend fun readPicked(context: Context, uri: Uri, maxMb: Int, video: Boolean): PickedFile = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    var name = if (video) "video.mp4" else "fichier"
    var size = -1L
    resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
            c.getString(0)?.let { name = it }
            if (!c.isNull(1)) size = c.getLong(1)
        }
    }
    val max = maxMb * 1024L * 1024L
    if (size > max) throw TooBigException(size)
    val bytes = resolver.openInputStream(uri)?.use { input ->
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > max) throw TooBigException(total)
            out.write(buf, 0, n)
        }
        out.toByteArray()
    } ?: throw java.io.IOException(tr("Fichier illisible"))
    val mime = resolver.getType(uri) ?: if (video) "video/mp4" else "application/octet-stream"
    val fields = mutableMapOf<String, String>()
    if (video) {
        // Size and length, so the bubble has the right shape before the video loads.
        runCatching {
            android.media.MediaMetadataRetriever().apply {
                setDataSource(context, uri)
                val w = extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
                val h = extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
                val rot = extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                val d = extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                if (w != null && h != null) {
                    fields["width"] = "${if (rot % 180 == 0) w else h}"
                    fields["height"] = "${if (rot % 180 == 0) h else w}"
                }
                if (d != null && d > 0) fields["durationMs"] = "$d"
                release()
            }
        }
    } else {
        fields["name"] = name
    }
    PickedFile(bytes, mime, name, fields)
}

/** "3,2 Mo" */
fun fileSize(bytes: Long?): String {
    if (bytes == null) return ""
    val units = listOf(tr("o"), tr("Ko"), tr("Mo"), tr("Go"))
    var v = bytes.toDouble()
    var i = 0
    while (v >= 1024 && i < units.size - 1) {
        v /= 1024
        i++
    }
    return if (i == 0) "${v.toLong()} ${units[i]}" else String.format(fr.papote.app.I18n.locale, "%.1f %s", v, units[i])
}
