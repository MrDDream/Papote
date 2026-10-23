package fr.papote.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import fr.papote.app.PapoteApp
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.Nunito
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import fr.papote.app.ui.theme.Tint
import fr.papote.app.ui.theme.Tints
import fr.papote.app.ui.theme.tint

private val BubblePath = PathParser().parsePathString(
    "M20 8 H92 a16 16 0 0 1 16 16 V64 a16 16 0 0 1 -16 16 H50 L30 98 L33 80 H20 a16 16 0 0 1 -16 -16 V24 a16 16 0 0 1 16 -16 Z",
).toPath()
private val SmilePath = PathParser().parsePathString("M49 52 q7 7 14 0").toPath()

/** Bubu, the speech-bubble mascot from the mockups. */
@Composable
fun Mascot(modifier: Modifier = Modifier, width: Dp = 112.dp) {
    val ink = Color(0xFF2E2442)
    Canvas(modifier.size(width, width * 104f / 112f)) {
        scale(size.width / 112f, size.height / 104f, pivot = Offset.Zero) {
            drawPath(BubblePath, Color(0xFFFFC2D1))
            drawPath(BubblePath, ink, style = Stroke(width = 3f, join = StrokeJoin.Round))
            drawCircle(ink, 5.5f, Offset(42f, 40f))
            drawCircle(ink, 5.5f, Offset(70f, 40f))
            drawCircle(Color.White, 1.8f, Offset(44f, 38f))
            drawCircle(Color.White, 1.8f, Offset(72f, 38f))
            drawPath(SmilePath, ink, style = Stroke(width = 3f, cap = StrokeCap.Round))
            drawOval(Color(0xFFFF8FAB), Offset(24f, 50f), Size(12f, 8f))
            drawOval(Color(0xFFFF8FAB), Offset(76f, 50f), Size(12f, 8f))
        }
    }
}

/** A little face on a pastel disc: the default avatar ("frimousse"). */
@Composable
fun Face(color: Color, modifier: Modifier = Modifier, size: Dp = 48.dp) {
    val ink = Color(0xFF2E2442)
    Canvas(modifier.size(size).clip(CircleShape).background(color)) {
        val s = this.size.width / 30f
        drawCircle(ink, 2.4f * s, Offset(10.5f * s, 13f * s))
        drawCircle(ink, 2.4f * s, Offset(19.5f * s, 13f * s))
        val smile = androidx.compose.ui.graphics.Path().apply {
            moveTo(11f * s, 19f * s)
            quadraticTo(15f * s, 23f * s, 19f * s, 19f * s)
        }
        drawPath(smile, ink, style = Stroke(width = 2.2f * s, cap = StrokeCap.Round))
    }
}

/** Profile photo when there is one, else the face in the user's colour. */
@Composable
fun Avatar(
    name: String,
    color: String,
    photo: String?,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    online: Boolean = false,
    initialOnly: Boolean = false,
) {
    val t = tint(color)
    Box(modifier.size(size)) {
        when {
            photo != null -> AsyncImage(
                model = PapoteApp.instance.mediaUrl(photo),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size).clip(CircleShape).background(t.tint),
            )
            initialOnly -> Box(
                Modifier.size(size).clip(CircleShape).background(t.tint),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    name.take(1).uppercase(),
                    fontFamily = Baloo,
                    fontWeight = FontWeight.Bold,
                    fontSize = (size.value * 0.44f).sp,
                    color = Papote.colors.onPastel,
                )
            }
            else -> Face(t.tint, size = size)
        }
        if (online) {
            Box(
                Modifier.align(Alignment.BottomEnd).size(size * 0.3f).clip(CircleShape)
                    .background(Papote.colors.card).padding(2.dp).clip(CircleShape).background(Papote.colors.ok),
            )
        }
    }
}

@Composable
fun GroupBadge(color: String, icon: String, modifier: Modifier = Modifier, size: Dp = 52.dp, photo: String? = null) {
    Box(
        modifier.size(size).rotate(-4f).clip(RoundedCornerShape(size * 0.35f)).background(tint(color).tint),
        contentAlignment = Alignment.Center,
    ) {
        if (photo != null) {
            AsyncImage(
                model = if (photo.startsWith("/")) PapoteApp.instance.mediaUrl(photo) else photo,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size),
            )
        } else {
            Icon(PIcons.group(icon), contentDescription = null, tint = Papote.colors.onPastel, modifier = Modifier.size(size * 0.5f))
        }
    }
}

/** A group's badge, or for a two-person conversation the other person's avatar. */
@Composable
fun GroupAvatar(g: fr.papote.app.data.GroupSummary?, size: Dp = 52.dp, modifier: Modifier = Modifier) {
    val peer = g?.peer
    if (g?.direct == true && peer != null) {
        Avatar(peer.name, peer.color, peer.photo, modifier, size = size, online = peer.online)
    } else {
        GroupBadge(g?.color ?: "rose", g?.icon ?: "heart", modifier, size = size, photo = g?.photo)
    }
}

/** Chunky primary button with the "pressed into the page" bottom edge from the mockups. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
    height: Dp = 56.dp,
    textSize: androidx.compose.ui.unit.TextUnit = 19.sp,
) {
    val c = Papote.colors
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val active = enabled && !loading
    val lift = if (pressed || !active) 1.dp else 5.dp
    Box(modifier.height(height + 5.dp)) {
        Box(
            Modifier.fillMaxWidth().height(height).offset(y = 5.dp).clip(RoundedCornerShape(20.dp))
                .background(if (active) c.primaryDark else c.line),
        )
        Row(
            Modifier.fillMaxWidth().height(height).offset(y = 5.dp - lift).clip(RoundedCornerShape(20.dp))
                .background(if (active) c.primary else c.soft)
                .clickable(source, null, enabled = active, role = Role.Button, onClick = onClick),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(22.dp), color = c.primary, strokeWidth = 3.dp)
            } else {
                Text(
                    text,
                    fontFamily = Baloo,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize,
                    maxLines = 1,
                    color = if (active) c.onPrimary else c.muted,
                )
                if (icon != null) Icon(icon, null, tint = if (active) c.onPrimary else c.muted, modifier = Modifier.size(22.dp))
            }
        }
    }
}

@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    danger: Boolean = false,
    enabled: Boolean = true,
    height: Dp = 52.dp,
) {
    val c = Papote.colors
    val fg = if (danger) c.danger else if (c.dark) c.ink else c.primaryDark
    Row(
        modifier.height(height).clip(RoundedCornerShape(18.dp))
            .background(if (danger) c.dangerBg else c.card)
            .border(BorderStroke(2.dp, if (danger) c.dangerBg else c.line), RoundedCornerShape(18.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, null, tint = fg, modifier = Modifier.size(20.dp))
        Text(text, style = MaterialTheme.typography.labelLarge.copy(fontSize = 15.sp), color = fg)
    }
}

/** 44–48dp rounded-square icon button (back, invite, settings…). */
@Composable
fun SquareIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    background: Color = Papote.colors.card,
    tint: Color = Papote.colors.ink,
    size: Dp = 44.dp,
    enabled: Boolean = true,
) {
    Box(
        modifier.size(size).clip(RoundedCornerShape(16.dp)).background(background)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = if (enabled) tint else tint.copy(alpha = 0.35f), modifier = Modifier.size(22.dp))
    }
}

@Composable
fun FieldLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = Papote.colors.ink, modifier = modifier)
}

@Composable
fun PapoteField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    leading: ImageVector? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    onIme: () -> Unit = {},
    singleLine: Boolean = true,
    height: Dp = 48.dp,
    radius: Dp = 16.dp,
    background: Color = Papote.colors.field,
    label: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = Papote.colors
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = singleLine,
        maxLines = if (singleLine) 1 else 5,
        textStyle = TextStyle(fontFamily = Nunito, fontSize = 15.sp, color = c.ink),
        cursorBrush = SolidColor(c.primary),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
        keyboardActions = KeyboardActions(onAny = { onIme() }),
        visualTransformation = VisualTransformation.None,
        modifier = modifier.semantics { if (label != null) contentDescription = label },
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().then(if (singleLine) Modifier.height(height) else Modifier)
                    .clip(RoundedCornerShape(radius)).background(background)
                    .border(2.dp, c.line, RoundedCornerShape(radius))
                    .padding(horizontal = 14.dp, vertical = if (singleLine) 0.dp else 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (leading != null) {
                    Icon(leading, null, tint = c.muted, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                }
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(placeholder, fontFamily = Nunito, fontSize = 15.sp, color = c.muted.copy(alpha = 0.8f))
                    inner()
                }
                if (trailing != null) trailing()
            }
        },
    )
}

/** Row of pastel swatches; [selected] is a tint key. */
@Composable
fun TintPicker(selected: String, onPick: (String) -> Unit, modifier: Modifier = Modifier, tints: List<Tint> = Tints, face: Boolean = false) {
    val c = Papote.colors
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        for (t in tints) {
            val on = t.key == selected
            Box(
                Modifier.size(48.dp).clip(CircleShape)
                    .border(3.dp, if (on) c.primary else c.card, CircleShape)
                    .padding(3.dp).clip(CircleShape).background(t.tint)
                    .clickable(role = Role.RadioButton) { onPick(t.key) }
                    .semantics {
                        contentDescription = (if (face) "Frimousse " else "Couleur ") + t.label
                        stateDescription = if (on) "choisie" else ""
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (face) Face(t.tint, size = 40.dp)
                else if (on) Icon(PIcons.Check, null, tint = c.onPastel, modifier = Modifier.size(20.dp))
            }
        }
    }
}

/** Segmented chips (theme, expiry…). */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onPick: (T) -> Unit, modifier: Modifier = Modifier) {
    val c = Papote.colors
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.soft).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for ((value, label) in options) {
            val on = value == selected
            Box(
                Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(12.dp))
                    .background(if (on) c.card else Color.Transparent)
                    .clickable(role = Role.RadioButton) { onPick(value) }
                    .semantics { stateDescription = if (on) "choisi" else "" },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), color = if (on) (if (c.dark) c.ink else c.primaryDark) else c.muted)
            }
        }
    }
}

@Composable
fun PapoteSwitch(checked: Boolean, onChange: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier) {
    val c = Papote.colors
    Box(
        modifier.width(56.dp).height(32.dp).clip(RoundedCornerShape(16.dp))
            .background(if (checked) c.primary else c.line)
            .clickable(role = Role.Switch) { onChange(!checked) }
            .semantics {
                contentDescription = label
                stateDescription = if (checked) "activé" else "désactivé"
            }
            .padding(3.dp),
        contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Box(Modifier.size(26.dp).clip(CircleShape).background(Color.White))
    }
}

@Composable
fun TopBar(
    title: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (onBack != null) SquareIconButton(PIcons.Back, "Retour", onBack)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineSmall, color = Papote.colors.ink, maxLines = 1)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Papote.colors.muted, maxLines = 1)
        }
        actions()
    }
}

@Composable
fun ErrorText(text: String?, modifier: Modifier = Modifier) {
    if (text == null) return
    Text(
        text,
        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
        color = Papote.colors.danger,
        modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Papote.colors.dangerBg).padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

/** Decorative pastel blobs behind the welcome screen. */
@Composable
fun Blob(color: Color, size: Dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}
