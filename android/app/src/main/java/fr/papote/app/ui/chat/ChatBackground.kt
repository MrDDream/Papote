package fr.papote.app.ui.chat

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import fr.papote.app.PapoteApp
import fr.papote.app.data.GroupSummary
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.tint

/** An illustrated background: one 48×48 tile repeated (same drawings as the web app). */
class BgTile(val d: String, val fill: Boolean)

private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0"
private fun paw(x: Float, y: Float) = circle(x, y + 3, 3.5f) + circle(x - 4.2f, y - 1.5f, 1.6f) + circle(x - 1.4f, y - 3.6f, 1.6f) + circle(x + 1.4f, y - 3.6f, 1.6f) + circle(x + 4.2f, y - 1.5f, 1.6f)

val BgTiles = mapOf(
    "hearts" to BgTile("M12 19c-4-3-7-5-7-8a3.5 3.5 0 0 1 7-1 3.5 3.5 0 0 1 7 1c0 3-3 5-7 8zM36 43c-3-2.2-5-3.7-5-5.8a2.5 2.5 0 0 1 5-.8 2.5 2.5 0 0 1 5 .8c0 2.1-2 3.6-5 5.8z", true),
    "stars" to BgTile("M12 4l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L5.2 9l4.7-.7zM36 28l1.4 2.9 3.2.5-2.3 2.2.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.2 3.2-.5z" + circle(38f, 9f, 1.5f) + circle(10f, 38f, 1.5f), true),
    "waves" to BgTile("M0 12q6-6 12 0t12 0 12 0 12 0M0 36q6-6 12 0t12 0 12 0 12 0", false),
    "leaves" to BgTile("M8 20c0-8 6-12 13-12 0 8-6 12-13 12zM8 20l8-7M28 44c0-7 5-11 12-11 0 7-5 11-12 11zM28 44l7-6", false),
    "confetti" to BgTile("M6 8l4 2M20 4l-2 4M34 9l4-1M42 21l-3 3M8 30l3 3M24 25l4 1M15 42l-2-3M36 38l3 2", false),
    "clouds" to BgTile("M8 18a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5 3.3 3.3 0 0 1 0 6.5zM30 42a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5 3.3 3.3 0 0 1 0 6.5z", false),
    "paws" to BgTile(paw(12f, 12f) + paw(36f, 36f), true),
    "notes" to BgTile("M10 18V7l8-2v11M36 42V32l5 2" + circle(7.5f, 18f, 2.5f) + circle(15.5f, 16f, 2.5f) + circle(33.5f, 42f, 2.5f), false),
)

/** The pattern choices, in the order of the picker. */
val BgPatterns = listOf("none", "dots", "stripes", "grid") + BgTiles.keys

/**
 * What's behind a group's messages: its background picture (dimmed so messages stay readable)
 * and/or its pattern, drawn faintly in the group's colour.
 */
@Composable
fun ChatBackground(pattern: String, color: String?, wallpaper: String?, modifier: Modifier = Modifier) {
    val c = Papote.colors
    val t = tint(color)
    val ink = (if (c.dark) t.tint else t.text).copy(alpha = 0.17f)
    val line = c.primary.copy(alpha = if (c.dark) 0.18f else 0.12f)
    val tile = BgTiles[pattern]
    val path = remember(pattern) { tile?.let { PathParser().parsePathString(it.d).toPath() } }
    Box(modifier) {
        if (wallpaper != null) {
            AsyncImage(PapoteApp.instance.mediaUrl(wallpaper), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(c.ground.copy(alpha = 0.45f)))
        }
        Canvas(Modifier.fillMaxSize()) {
            when (pattern) {
                "dots" -> {
                    val step = 16.dp.toPx()
                    var y = step / 2
                    while (y < size.height) {
                        var x = step / 2
                        while (x < size.width) {
                            drawCircle(line, 2.dp.toPx(), Offset(x, y))
                            x += step
                        }
                        y += step
                    }
                }
                "stripes" -> {
                    val step = 18.dp.toPx()
                    var x = -size.height
                    while (x < size.width) {
                        drawLine(line, Offset(x, size.height), Offset(x + size.height, 0f), 6.dp.toPx())
                        x += step
                    }
                }
                "grid" -> {
                    val step = 18.dp.toPx()
                    var x = 0f
                    while (x < size.width) {
                        drawLine(line, Offset(x, 0f), Offset(x, size.height), 1.dp.toPx())
                        x += step
                    }
                    var y = 0f
                    while (y < size.height) {
                        drawLine(line, Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
                        y += step
                    }
                }
                else -> if (tile != null && path != null) {
                    val unit = 1.dp.toPx()
                    val step = 48 * unit
                    val style = if (tile.fill) Fill else Stroke(2f, cap = StrokeCap.Round, join = StrokeJoin.Round)
                    var y = 0f
                    while (y < size.height) {
                        var x = 0f
                        while (x < size.width) {
                            translate(x, y) { scale(unit, unit, Offset.Zero) { drawPath(path, ink, style = style) } }
                            x += step
                        }
                        y += step
                    }
                }
            }
        }
    }
}
