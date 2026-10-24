package fr.papote.app.ui.games

import fr.papote.app.ui.theme.pShape

import fr.papote.app.tr

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.papote.app.PapoteApp
import fr.papote.app.data.ApiException
import fr.papote.app.data.Event
import fr.papote.app.data.Game
import fr.papote.app.data.GroupSummary
import fr.papote.app.data.Member
import fr.papote.app.data.jsonOf
import fr.papote.app.ui.chat.gameInfo
import fr.papote.app.ui.components.Avatar
import fr.papote.app.ui.components.ErrorText
import fr.papote.app.ui.components.PapoteField
import fr.papote.app.ui.components.PrimaryButton
import fr.papote.app.ui.components.SecondaryButton
import fr.papote.app.ui.components.Segmented
import fr.papote.app.ui.components.SquareIconButton
import fr.papote.app.ui.draw.BoardModel
import fr.papote.app.ui.draw.DrawBoard
import fr.papote.app.ui.draw.Inks
import fr.papote.app.ui.draw.LiveSender
import fr.papote.app.ui.draw.Tool
import fr.papote.app.ui.draw.ToolPanel
import fr.papote.app.ui.extras.ConfettiOverlay
import fr.papote.app.ui.theme.Baloo
import fr.papote.app.ui.theme.PIcons
import fr.papote.app.ui.theme.Papote
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

private val Ink = Color(0xFF2E2442)

// Small readers for the games' JSON state.
private fun JsonObject.int(k: String) = this[k]?.jsonPrimitive?.intOrNull
private fun JsonObject.long(k: String) = (this[k] as? JsonPrimitive)?.longOrNull
private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.bool(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull ?: false
private fun JsonObject.arr(k: String) = (this[k] as? JsonArray) ?: JsonArray(emptyList())
private fun JsonObject.obj(k: String) = this[k] as? JsonObject
private fun cell(e: kotlinx.serialization.json.JsonElement) = if (e is JsonNull) null else e.jsonPrimitive.intOrNull
private fun longs(a: JsonArray) = a.map { if (it is JsonNull) null else it.jsonPrimitive.longOrNull }

private val Catalogue = listOf(
    Triple("tictactoe", tr("2 joueurs · tour par tour"), true),
    Triple("connect4", "2 joueurs", true),
    Triple("rps", tr("2 joueurs · express"), true),
    Triple("pictionary", tr("Groupe · dessin en direct"), false),
    Triple("quiz", tr("Groupe · vieux messages"), false),
    Triple("hangman", tr("Groupe · tout le monde devine"), false),
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun GamesScreen(groupId: Long, onBack: () -> Unit, onOpen: (Long) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var group by remember { mutableStateOf<GroupSummary?>(null) }
    var members by remember { mutableStateOf<List<Member>>(emptyList()) }
    var games by remember { mutableStateOf<List<Game>>(emptyList()) }
    var filter by remember { mutableStateOf("all") }
    var pickFor by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            group = app.api.group(groupId)
            members = app.api.members(groupId)
            games = app.api.games(groupId)
        } catch (e: ApiException) {
            error = e.message
        }
    }
    LaunchedEffect(groupId) {
        load()
        app.realtime.events.collect { if (it is Event.GameUpdated && it.game.groupId == groupId) load() }
    }
    fun start(kind: String, opponent: Long? = null) = scope.launch {
        try {
            onOpen(app.api.newGame(groupId, kind, opponent).id)
        } catch (e: ApiException) {
            error = e.message
        }
    }
    fun name(id: Long?) = if (id == app.session.userId) "toi" else members.firstOrNull { it.id == id }?.name ?: "?"

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        fr.papote.app.ui.components.TopBar("Mini-jeux", onBack, subtitle = group?.let { tr("{} · {} jeux", it.name, Catalogue.size) })
        val playing = games.filter { it.status == "playing" }
        if (playing.isNotEmpty()) {
            Text(tr("Parties en cours"), style = MaterialTheme.typography.titleMedium, color = c.ink)
            for (g in playing) {
                val info = gameInfo(g.kind)
                val s = g.state
                val summary = when (g.kind) {
                    "tictactoe", "connect4", "rps" -> {
                        val players = longs(s.arr("players"))
                        val other = players.firstOrNull { it != app.session.userId }
                        val myTurn = g.kind != "rps" && s["result"] is JsonNull && players.getOrNull(s.int("turn") ?: 0) == app.session.userId
                        (if (other != null) "contre ${name(other)}" else tr("en attente d’adversaire")) + " · " + if (myTurn) tr("à toi de jouer") else "manche ${s.int("round")}"
                    }
                    "quiz" -> if (s.bool("done")) "fini" else tr("{}/{} réponses", s.int("answered"), s.int("total"))
                    "pictionary" -> if (s.str("status") == "lobby") tr("{} joueur(s) · pas commencé", s.arr("players").size) else "manche ${s.int("round")}/${s.int("rounds")}"
                    else -> tr("mot {} · {} trouvé(s)", s.int("round"), s.int("wins"))
                }
                Row(
                    Modifier.fillMaxWidth().clip(pShape(22.dp)).background(info.bg).clickable(role = Role.Button) { onOpen(g.id) }.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.size(44.dp).clip(pShape(14.dp)).background(Color.White.copy(alpha = 0.7f)), contentAlignment = Alignment.Center) { Icon(info.icon, null, tint = Ink) }
                    Column(Modifier.weight(1f)) {
                        Text(info.name, style = MaterialTheme.typography.titleMedium, color = Ink)
                        Text(summary, style = MaterialTheme.typography.bodySmall, color = Ink)
                    }
                    Icon(PIcons.Forward, null, tint = Ink, modifier = Modifier.size(18.dp))
                }
            }
        }
        Segmented(listOf("all" to tr("Tous"), "duo" to tr("À deux"), "group" to tr("En groupe")), filter, { filter = it }, Modifier.fillMaxWidth())
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), maxItemsInEachRow = 2) {
            Catalogue.filter { (_, _, duo) -> filter == "all" || (filter == "duo") == duo }.forEach { (kind, meta, duo) ->
                val info = gameInfo(kind)
                Column(
                    Modifier.weight(1f).heightIn(min = 120.dp).clip(pShape(22.dp)).background(info.bg)
                        .clickable(role = Role.Button) { if (duo && group?.direct != true) pickFor = kind else start(kind) }.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(44.dp).clip(pShape(14.dp)).background(Color.White.copy(alpha = 0.7f)), contentAlignment = Alignment.Center) { Icon(info.icon, null, tint = Ink) }
                    Text(info.name, style = MaterialTheme.typography.titleMedium, color = Ink)
                    Text(meta, style = MaterialTheme.typography.bodySmall, color = Ink)
                }
            }
        }
        ErrorText(error)
    }

    pickFor?.let { kind ->
        ModalBottomSheet({ pickFor = null }, containerColor = c.card) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${gameInfo(kind).name} contre…", style = MaterialTheme.typography.titleLarge, color = c.ink)
                SecondaryButton(tr("La première personne qui joue"), {
                    pickFor = null
                    start(kind)
                }, Modifier.fillMaxWidth(), icon = PIcons.PersonPlus)
                members.filter { it.id != app.session.userId && !it.pending }.forEach { m ->
                    Row(
                        Modifier.fillMaxWidth().clip(pShape(18.dp)).clickable(role = Role.Button) {
                            pickFor = null
                            start(kind, m.id)
                        }.padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(m.name, m.color, m.photo, size = 40.dp, online = m.online)
                        Text(m.name, style = MaterialTheme.typography.titleMedium, color = c.ink)
                    }
                }
            }
        }
    }
}

// --- one game ------------------------------------------------------------------------------------------------

@Composable
fun GameScreen(gameId: Long, onBack: () -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val scope = rememberCoroutineScope()
    var game by remember { mutableStateOf<Game?>(null) }
    var members by remember { mutableStateOf<Map<Long, Member>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    var confetti by remember { mutableIntStateOf(0) }
    var celebrated by remember { mutableStateOf("") }
    val board = remember { BoardModel() }
    var boardVersion by remember { mutableIntStateOf(-1) }
    val me = app.session.userId

    fun play(body: JsonObject) = scope.launch {
        error = null
        try {
            game = app.api.move(gameId, body)
        } catch (e: ApiException) {
            error = e.message
        }
    }

    suspend fun load() {
        try {
            val g = app.api.game(gameId)
            if (members.isEmpty()) members = app.api.members(g.groupId).associateBy { it.id }
            game = g
            if (g.kind == "pictionary") {
                boardVersion = g.state.int("strokesVersion") ?: 0
                board.reset(g.strokes.orEmpty())
            }
        } catch (e: ApiException) {
            error = e.message
        }
    }

    LaunchedEffect(gameId) {
        load()
        app.realtime.events.collect { e ->
            when (e) {
                is Event.GameUpdated -> if (e.game.id == gameId) {
                    val v = e.game.state.int("strokesVersion") ?: 0
                    if (e.game.kind == "pictionary" && v != boardVersion) {
                        boardVersion = v
                        board.reset(emptyList())
                    }
                    game = e.game
                }
                is Event.LiveStroke -> if (e.channel == "game" && e.data.long("gameId") == gameId) {
                    board.applyRemote("${e.userId}:${e.data.str("k")}", e.data)
                }
                Event.Reconnected -> load()
                else -> Unit
            }
        }
    }

    fun nameOf(id: Long?) = if (id == me) tr("Toi") else members[id]?.name ?: "?"

    val g = game
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            val info = gameInfo(g?.kind)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SquareIconButton(PIcons.Back, tr("Retour"), onBack)
                Box(Modifier.size(44.dp).clip(pShape(14.dp)).background(info.bg), contentAlignment = Alignment.Center) { Icon(info.icon, null, tint = Ink) }
                Column(Modifier.weight(1f)) {
                    Text(info.name, style = MaterialTheme.typography.headlineSmall, color = c.ink)
                    if (g?.status == "done") Text(tr("Partie terminée"), style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
                if (g?.status == "playing") SquareIconButton(PIcons.Close, tr("Arrêter la partie"), {
                    scope.launch {
                        runCatching { app.api.quitGame(gameId) }
                        onBack()
                    }
                })
            }
            if (g == null) {
                ErrorText(error)
                return@Column
            }
            val s = g.state
            when (g.kind) {
                "tictactoe", "connect4" -> BoardGame(g, s, me, ::nameOf, ::play) { key ->
                    if (celebrated != key) {
                        celebrated = key
                        confetti++
                    }
                }
                "rps" -> Rps(s, me, ::nameOf, ::play)
                "hangman" -> Hangman(s, ::nameOf, ::play)
                "quiz" -> Quiz(s, me, members, ::nameOf, ::play)
                "pictionary" -> Pictionary(g, s, me, members, board, ::nameOf, ::play)
            }
            ErrorText(error)
        }
        ConfettiOverlay(confetti)
    }
}

@Composable
private fun Status(text: String, color: Color = Papote.colors.ink) =
    Text(text, fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = color, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())

@Composable
private fun ScoreCards(players: List<Long?>, scores: List<Int>, turn: Int?, nameOf: (Long?) -> String, marks: List<@Composable () -> Unit>) {
    val c = Papote.colors
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        for (i in 0..1) {
            Row(
                Modifier.weight(1f).clip(pShape(20.dp)).background(if (i == 0) Color(0xFFFFE0E8) else Color(0xFFEDE6FF))
                    .border(3.dp, if (turn == i && players.getOrNull(1) != null) c.primary else Color.Transparent, pShape(20.dp)).padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                marks[i]()
                Text(players.getOrNull(i)?.let(nameOf) ?: tr("En attente…"), style = MaterialTheme.typography.titleMedium, color = Ink, modifier = Modifier.weight(1f), maxLines = 1)
                Text("${scores.getOrNull(i) ?: 0}", fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, color = Ink)
            }
        }
    }
}

@Composable
private fun Mark(v: Int?, size: Int) {
    if (v == 0) Icon(PIcons.Heart, tr("cœur"), tint = Color(0xFFE0456A), modifier = Modifier.size(size.dp))
    else if (v == 1) Icon(PIcons.Star, tr("étoile"), tint = Color(0xFF6A47D6), modifier = Modifier.size(size.dp))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BoardGame(g: Game, s: JsonObject, me: Long?, nameOf: (Long?) -> String, play: (JsonObject) -> Unit, celebrate: (String) -> Unit) {
    val c = Papote.colors
    val players = longs(s.arr("players"))
    val scores = s.arr("scores").map { it.jsonPrimitive.intOrNull ?: 0 }
    val board = s.arr("board").map(::cell)
    val result = s.obj("result")
    val turn = s.int("turn") ?: 0
    val winner = result?.let { if (it["winner"] is JsonNull) null else it.int("winner") }
    val line = result?.arr("line")?.mapNotNull { it.jsonPrimitive.intOrNull }.orEmpty()
    val status = when {
        result != null && winner == null -> tr("Égalité, bien joué !")
        result != null && players.getOrNull(winner!!) == me -> tr("Tu gagnes ! Bravo !")
        result != null -> tr("{} gagne cette manche", nameOf(players.getOrNull(winner!!)))
        players.getOrNull(1) == null -> if (players[0] == me) tr("On attend quelqu’un pour jouer…") else tr("Place libre : joue pour la prendre !")
        players.getOrNull(turn) == me -> tr("À toi de jouer")
        else -> tr("À {} de jouer", nameOf(players.getOrNull(turn)))
    }
    if (result != null && winner != null && players.getOrNull(winner) == me) LaunchedEffect(s.int("round")) { celebrate("${g.id}:${s.int("round")}") }
    ScoreCards(players, scores, if (result == null) turn else null, nameOf, listOf({ Mark(0, 22) }, { Mark(1, 22) }))
    Status(status)
    if (g.kind == "tictactoe") {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (r in 0..2) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (col in 0..2) {
                    val i = r * 3 + col
                    val v = board.getOrNull(i)
                    Box(
                        Modifier.size(96.dp).clip(pShape(22.dp)).background(if (i in line) Color(0xFFFFF0B8) else c.card)
                            .clickable(enabled = v == null && result == null, role = Role.Button) { play(jsonOf("cell" to i)) }
                            .semantics { contentDescription = "Case ${r + 1}-${col + 1} : " + when (v) { 0 -> tr("cœur"); 1 -> tr("étoile"); else -> "vide" } },
                        contentAlignment = Alignment.Center,
                    ) { Mark(v, 44) }
                }
            }
        }
    } else {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (col in 0..6) Box(
                    Modifier.weight(1f).height(34.dp).clip(pShape(10.dp)).background(c.soft)
                        .clickable(enabled = result == null && board[col] == null, role = Role.Button) { play(jsonOf("col" to col)) }
                        .semantics { contentDescription = tr("Jouer colonne {}", col + 1) },
                    contentAlignment = Alignment.Center,
                ) { Text("↓", color = c.primary, fontWeight = FontWeight.ExtraBold) }
            }
            Column(Modifier.fillMaxWidth().clip(pShape(22.dp)).background(Color(0xFF6A47D6)).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (r in 0..5) Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (col in 0..6) {
                        val i = r * 7 + col
                        Box(
                            Modifier.weight(1f).aspectRatio(1f).clip(CircleShape)
                                .background(when (board.getOrNull(i)) { 0 -> Color(0xFFFF7A93); 1 -> Color(0xFFFFD66B); else -> c.ground })
                                .border(if (i in line) 3.dp else 0.dp, Color.White, CircleShape),
                        )
                    }
                }
            }
        }
    }
    if (result != null) PrimaryButton(tr("Manche suivante"), { play(jsonOf("action" to "next")) }, Modifier.fillMaxWidth(), icon = PIcons.Refresh)
}

@Composable
private fun Rps(s: JsonObject, me: Long?, nameOf: (Long?) -> String, play: (JsonObject) -> Unit) {
    val c = Papote.colors
    val players = longs(s.arr("players"))
    val scores = s.arr("scores").map { it.jsonPrimitive.intOrNull ?: 0 }
    val you = players.indexOf(me)
    val picks = s.arr("picks").map { if (it is JsonNull) null else it.jsonPrimitive.contentOrNull }
    val emo = linkedMapOf("pierre" to "✊", "feuille" to "✋", "ciseaux" to "✌️")
    ScoreCards(players, scores, null, nameOf, listOf({ Text("✊", fontSize = 20.sp) }, { Text("✌️", fontSize = 20.sp) }))
    s.obj("last")?.let { last ->
        val p = last.arr("picks").map { it.jsonPrimitive.content }
        val w = if (last["winner"] is JsonNull) null else last.int("winner")
        Status(tr("Manche {} : {} — {} · ", last.int("round"), emo[p[0]], emo[p[1]]) + if (w == null) tr("égalité") else "${nameOf(players.getOrNull(w))} gagne")
    }
    Text(if (you >= 0 && picks.getOrNull(you) != null) tr("Tu as joué, on attend l’autre…") else tr("Manche {} : choisis !", s.int("round")), color = c.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        for ((k, e) in emo) {
            val chosen = you >= 0 && picks.getOrNull(you) == k
            Column(
                Modifier.weight(1f).clip(pShape(22.dp)).background(c.card).border(3.dp, if (chosen) c.primary else Color.Transparent, pShape(22.dp))
                    .clickable(enabled = !(you >= 0 && picks.getOrNull(you) != null), role = Role.Button) { play(jsonOf("pick" to k)) }.padding(vertical = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(e, fontSize = 40.sp)
                Text(k.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleMedium, color = c.ink)
            }
        }
    }
}

private val HangParts = listOf("M75 12v14", "M75 34a8 8 0 1 1 0 .01", "M75 42v30", "M75 50l-14 12", "M75 50l14 12", "M75 72l-12 18", "M75 72l12 18")

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Hangman(s: JsonObject, nameOf: (Long?) -> String, play: (JsonObject) -> Unit) {
    val c = Papote.colors
    val wrong = s.int("wrong") ?: 0
    val max = s.int("maxWrong") ?: 7
    val result = s.str("result")
    val guessed = s.arr("guessed").map { it.jsonPrimitive.content }
    val mask = s.arr("mask").map { if (it is JsonNull) null else it.jsonPrimitive.content }
    Status(
        when (result) {
            "won" -> tr("Bravo, mot trouvé !")
            "lost" -> tr("Perdu… c’était {}", s.str("word"))
            else -> "${max - wrong} erreur(s) restante(s)"
        },
    )
    val ink = c.ink
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Canvas(Modifier.size(150.dp).semantics { contentDescription = "$wrong erreur(s) sur $max" }) {
        val k = size.width / 120f
        val paths = listOf("M20 110h60M35 110V12h40") + HangParts.take(wrong)
        for (d in paths) {
            val p = PathParser().parsePathString(d).toPath()
            scale(k) { drawPath(p, ink, style = Stroke(4f, cap = StrokeCap.Round)) }
        }
    } }
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
        for (ch in mask) Box(Modifier.width(28.dp).height(40.dp), contentAlignment = Alignment.BottomCenter) {
            Text(ch ?: "", fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, color = c.ink)
            Box(Modifier.fillMaxWidth().height(3.dp).background(c.ink))
        }
    }
    if (result == null) {
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), maxItemsInEachRow = 7) {
            for (l in 'A'..'Z') {
                val used = "$l" in guessed
                val ok = used && "$l" in mask
                Box(
                    Modifier.weight(1f).height(42.dp).clip(pShape(12.dp))
                        .background(if (!used) c.card else if (ok) Color(0xFFCDEFE0) else c.dangerBg)
                        .clickable(enabled = !used, role = Role.Button) { play(jsonOf("letter" to "$l")) },
                    contentAlignment = Alignment.Center,
                ) { Text("$l", style = MaterialTheme.typography.titleMedium, color = if (used) c.muted else c.ink) }
            }
        }
    } else PrimaryButton(tr("Mot suivant"), { play(jsonOf("action" to "next")) }, Modifier.fillMaxWidth(), icon = PIcons.Refresh)
    Text(tr("{} mot(s) trouvé(s) · {} raté(s) · tout le groupe joue ensemble", s.int("wins"), s.int("losses")), style = MaterialTheme.typography.bodySmall, color = c.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.scale(k: Float, block: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit) =
    withTransform({ scale(k, k, Offset.Zero) }) { block() }

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Quiz(s: JsonObject, me: Long?, members: Map<Long, Member>, nameOf: (Long?) -> String, play: (JsonObject) -> Unit) {
    val c = Papote.colors
    val total = s.int("total") ?: 0
    val answered = s.int("answered") ?: 0
    val questions = s.arr("questions").map { it.jsonObject }
    val cur = questions.lastOrNull()
    val last = questions.lastOrNull { it["answer"] != null }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(total) { i -> Box(Modifier.weight(1f).height(8.dp).clip(pShape(4.dp)).background(if (i < answered) c.primary else c.card)) }
    }
    if (!s.bool("done") && cur != null && cur["answer"] == null) {
        Column(Modifier.fillMaxWidth().clip(pShape(24.dp)).background(c.card).padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("« ${cur.str("quote")} »", fontFamily = Baloo, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.ink)
            cur.long("date")?.let { Text(tr("Message du {}", fr.papote.app.ui.dayLabel(it).lowercase()), style = MaterialTheme.typography.bodySmall, color = c.muted) }
        }
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), maxItemsInEachRow = 2) {
            for (ch in cur.arr("choices").map { it.jsonObject }) {
                val id = ch.long("id")
                Row(
                    Modifier.weight(1f).clip(pShape(20.dp)).background(c.card).clickable(role = Role.Button) { play(jsonOf("answer" to id)) }.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Avatar(ch.str("name") ?: "?", ch.str("color") ?: "lilas", null, size = 40.dp, initialOnly = true)
                    Text(if (id == me) tr("Moi") else ch.str("name").orEmpty(), style = MaterialTheme.typography.titleMedium, color = c.ink)
                }
            }
        }
    }
    last?.let { q ->
        val right = q.long("picked") == q.long("answer")
        val who = q.arr("choices").map { it.jsonObject }.firstOrNull { it.long("id") == q.long("answer") }?.str("name") ?: "?"
        Status(if (right) tr("Bien vu, +10 points !") else tr("Raté, c’était {} !", who), if (right) c.ok else c.danger)
    }
    if (s.bool("done")) Status(tr("Fini ! Tu as {} points.", s.obj("scores")?.int("$me") ?: 0))
    val scores = s.obj("scores")?.entries?.sortedByDescending { it.value.jsonPrimitive.intOrNull ?: 0 }.orEmpty()
    if (scores.isNotEmpty()) Column(Modifier.fillMaxWidth().clip(pShape(24.dp)).background(c.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(tr("Scores"), style = MaterialTheme.typography.titleMedium, color = c.ink)
        for ((uid, pts) in scores) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val m = members[uid.toLongOrNull()]
            Avatar(m?.name ?: "?", m?.color ?: "lilas", m?.photo, size = 32.dp, initialOnly = true)
            Text(nameOf(uid.toLongOrNull()), Modifier.weight(1f), color = c.ink)
            Text("${pts.jsonPrimitive.intOrNull ?: 0} pts", style = MaterialTheme.typography.titleMedium, color = c.ink)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Pictionary(g: Game, s: JsonObject, me: Long?, members: Map<Long, Member>, board: BoardModel, nameOf: (Long?) -> String, play: (JsonObject) -> Unit) {
    val app = PapoteApp.instance
    val c = Papote.colors
    val players = longs(s.arr("players")).filterNotNull()
    val status = s.str("status")
    val drawer = s.long("drawer")
    val isDrawer = drawer == me
    val scores = s.obj("scores")
    var ink by remember { mutableIntStateOf(Inks[0].first.toInt()) }
    var thickness by remember { mutableIntStateOf(1) }
    var guess by remember { mutableStateOf("") }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(status) {
        while (true) {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val sender = remember(g.id) { LiveSender({ app.realtime.sendLive(g.groupId, "game", it) }, { mapOf("gameId" to g.id) }) }

    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (p in players) Row(
            Modifier.clip(pShape(16.dp)).background(if (p == drawer) Color(0xFFFFF0B8) else c.card).padding(start = 4.dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val m = members[p]
            Avatar(m?.name ?: "?", m?.color ?: "lilas", m?.photo, size = 28.dp, initialOnly = true)
            Text(nameOf(p), fontWeight = FontWeight.ExtraBold, color = if (p == drawer) Ink else c.ink, style = MaterialTheme.typography.labelMedium)
            Text("${scores?.int("$p") ?: 0}", style = MaterialTheme.typography.titleMedium, color = if (p == drawer) Ink else c.ink)
        }
    }
    when (status) {
        "lobby" -> {
            Status(tr("Chacun son tour dessine, les autres devinent."))
            if (me !in players) PrimaryButton(tr("Rejoindre la partie"), { play(jsonOf("action" to "join")) }, Modifier.fillMaxWidth(), icon = PIcons.PersonPlus)
            else PrimaryButton(if (players.size < 2) tr("On attend un 2e joueur…") else tr("Lancer la partie"), { play(jsonOf("action" to "start")) }, Modifier.fillMaxWidth(), enabled = players.size >= 2, icon = PIcons.Play)
            return
        }
        "over" -> {
            val best = scores?.entries?.maxByOrNull { it.value.jsonPrimitive.intOrNull ?: 0 }
            Status(tr("Partie finie !") + (best?.let { tr(" {} gagne avec {} points", nameOf(it.key.toLongOrNull()), it.value.jsonPrimitive.intOrNull) } ?: ""))
            return
        }
    }
    // The server's own count of the time left: a phone whose clock is off still shows the right countdown.
    val remaining = s.long("remainingMs")
    val receivedAt = remember(s) { System.currentTimeMillis() }
    val deadline = remaining?.let { receivedAt + it } ?: s.long("deadline")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(tr("Manche {} sur {} · ", s.int("round"), s.int("rounds")) + if (isDrawer) tr("tu dessines") else "${nameOf(drawer)} dessine", style = MaterialTheme.typography.bodySmall, color = c.muted, modifier = Modifier.weight(1f))
        if (status == "drawing" && deadline != null) Box(Modifier.size(48.dp).clip(CircleShape).background(Color(0xFFFFF0B8)), contentAlignment = Alignment.Center) {
            Text("${((deadline - now) / 1000).coerceAtLeast(0)}", fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = Ink)
        }
    }
    val found = longs(s.arr("found"))
    when {
        status == "between" -> Status(tr("C’était « {} » ! ", s.str("word")) + if (found.isEmpty()) tr("Personne n’a trouvé") else tr("Trouvé par {}", found.joinToString(", ") { nameOf(it) }))
        isDrawer -> Status(tr("À dessiner : {}", s.str("word")))
        else -> FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
            for (e in s.arr("hint")) {
                val ch = if (e is JsonNull) null else e.jsonPrimitive.content
                val gap = ch == " " || ch == "-" || ch == "’"
                Box(Modifier.width(if (gap) 14.dp else 28.dp).height(40.dp), contentAlignment = Alignment.BottomCenter) {
                    Text(if (gap) "" else ch.orEmpty(), fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, color = c.ink)
                    if (!gap) Box(Modifier.fillMaxWidth().height(3.dp).background(c.ink))
                }
            }
        }
    }
    DrawBoard(
        board, null, Tool.Brush, ink, thickness, editable = isDrawer && status == "drawing",
        onLive = { k, st -> sender.onLive(k, st) },
        onCommit = { k, op -> sender.onCommit(k, op) },
    )
    if (isDrawer && status == "drawing") {
        ToolPanel(Tool.Brush, {}, ink, { ink = it }, thickness, { thickness = it }, tools = false)
        SecondaryButton(tr("Passer ce mot"), { play(jsonOf("action" to "skip")) }, Modifier.fillMaxWidth(), height = 44.dp)
    }
    for (gs in s.arr("guesses").map { it.jsonObject }.takeLast(8)) {
        val result = gs.str("result")
        Row(Modifier.fillMaxWidth().clip(pShape(14.dp)).background(c.card).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(nameOf(gs.long("userId")), fontWeight = FontWeight.ExtraBold, color = c.ink)
            Text(gs.str("text") ?: tr("a trouvé !"), Modifier.weight(1f), color = c.ink)
            Text(
                when (result) { "found" -> "+ points"; "close" -> tr("Presque !"); else -> tr("Non") },
                style = MaterialTheme.typography.labelMedium,
                color = Ink,
                modifier = Modifier.clip(pShape(8.dp)).background(when (result) { "found" -> Color(0xFFCDEFE0); "close" -> Color(0xFFFFF0B8); else -> c.soft }).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }
    if (!isDrawer && status == "drawing") {
        if (me in found) Status(tr("Trouvé ! On attend les autres…"), c.ok)
        else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PapoteField(guess, { guess = it.take(40) }, Modifier.weight(1f), placeholder = tr("Ta réponse"), label = tr("Ta réponse"), imeAction = androidx.compose.ui.text.input.ImeAction.Send, onIme = {
                if (guess.isNotBlank()) play(jsonOf("guess" to guess.trim()))
                guess = ""
            })
            PrimaryButton(tr("Deviner"), {
                if (guess.isNotBlank()) play(jsonOf("guess" to guess.trim()))
                guess = ""
            }, height = 48.dp)
        }
    }
}
