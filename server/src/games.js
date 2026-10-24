import crypto from 'node:crypto';
import { HttpError, now } from './util.js';

// Mini-games played inside a group. Each game keeps its whole state as JSON; the server checks every move
// and only shows each player what they may see (the Pictionary word, the other's Chifoumi pick…).

const rand = (n) => crypto.randomInt(n);
const shuffle = (a) => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** "Éléphant " → "elephant", "Cœur" → "coeur": guesses are compared without case or accents. */
export const fold = (s) =>
  String(s ?? '')
    .toLowerCase()
    // Ligatures don't decompose: without this "cœur" and "œuf" could never be guessed.
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

const PICTIONARY_WORDS = [
  'soleil', 'maison', 'chat', 'chien', 'arbre', 'fleur', 'voiture', 'vélo', 'bateau', 'avion', 'fusée', 'étoile', 'lune',
  'nuage', 'pluie', 'parapluie', 'montagne', 'plage', 'château', 'dragon', 'licorne', 'robot', 'pizza', 'gâteau', 'glace',
  'banane', 'pomme', 'fraise', 'carotte', 'champignon', 'escargot', 'papillon', 'abeille', 'poisson', 'baleine', 'pieuvre',
  'tortue', 'lapin', 'girafe', 'éléphant', 'serpent', 'hibou', 'pingouin', 'cochon', 'vache', 'mouton', 'cheval', 'dinosaure',
  'fantôme', 'sorcière', 'pirate', 'couronne', 'lunettes', 'chapeau', 'chaussure', 'chaussette', 'parachute', 'guitare',
  'piano', 'tambour', 'trompette', 'micro', 'télévision', 'téléphone', 'ordinateur', 'lampe', 'bougie', 'clé', 'cadenas',
  'horloge', 'réveil', 'lit', 'canapé', 'baignoire', 'brosse à dents', 'ciseaux', 'crayon', 'livre', 'cartable', 'tente',
  'feu de camp', 'sapin', 'cadeau', 'ballon', 'cerf-volant', 'toboggan', 'balançoire', 'arc-en-ciel', 'volcan', 'île',
  'phare', 'pont', 'train', 'tracteur', 'hélicoptère', 'sous-marin', 'ancre', 'trésor', 'épée', 'bouclier', 'tasse',
  'théière', 'croissant', 'baguette', 'fromage', 'pop-corn', 'hamburger', 'frites', 'sandwich', 'œuf', 'nid', 'toile d’araignée',
  'squelette', 'citrouille', 'bonhomme de neige', 'igloo', 'ski', 'piscine', 'médaille', 'coupe', 'drapeau', 'boussole',
  'loupe', 'aimant', 'ampoule', 'pile', 'cœur', 'sirène', 'zèbre', 'kangourou', 'koala', 'panda', 'crocodile', 'grenouille',
];

const HANGMAN_WORDS = [
  'PAPOTER', 'COPINE', 'GALAXIE', 'BALADE', 'CHOCOLAT', 'POTAGER', 'MANEGE', 'GIRAFE', 'CANAPE', 'BOUSSOLE', 'CERISE',
  'LAMPION', 'CARAMEL', 'HAMSTER', 'PYJAMA', 'TOBOGGAN', 'VOLCAN', 'MOUFLE', 'PINGOUIN', 'CITROUILLE', 'PARAPLUIE',
  'GUITARE', 'TAMBOUR', 'DRAGON', 'LICORNE', 'BISCUIT', 'TARTINE', 'CRAYON', 'CARTABLE', 'VACANCES', 'SOLEIL', 'NUAGE',
  'ORAGE', 'CASCADE', 'MONTAGNE', 'RANDONNEE', 'CAMPING', 'BOUGIE', 'HORLOGE', 'REVEIL', 'CROISSANT', 'FROMAGE',
  'BAGUETTE', 'CONFITURE', 'ESCARGOT', 'PAPILLON', 'ABEILLE', 'COCCINELLE', 'HERISSON', 'ECUREUIL', 'RENARD', 'BLAIREAU',
  'POUSSIN', 'DAUPHIN', 'BALEINE', 'PIEUVRE', 'MEDUSE', 'TORTUE', 'KANGOUROU', 'CROCODILE', 'TELESCOPE', 'PLANETE',
  'COMETE', 'ASTRONAUTE', 'FUSEE', 'ROBOT', 'PIRATE', 'TRESOR', 'CHATEAU', 'PRINCESSE', 'SORCIERE', 'FANTOME',
  'SQUELETTE', 'MOMIE', 'VAMPIRE', 'CINEMA', 'POPCORN', 'MUSIQUE', 'CHANSON', 'KARAOKE', 'DANSE', 'GUIRLANDE', 'CADEAU',
  'ANNIVERSAIRE', 'GATEAU', 'BONBON', 'SUCETTE', 'GLACE', 'SORBET', 'LIMONADE', 'PIQUENIQUE', 'HAMAC', 'PISCINE',
];

// --- two-player games: seats, turns and rounds --------------------------------------------------------

function seat(state, userId) {
  let idx = state.players.indexOf(userId);
  // An open seat (the game was launched for "anyone"): the first other person who plays takes it.
  if (idx < 0 && state.players[1] === null && state.players[0] !== userId) {
    state.players[1] = userId;
    idx = 1;
  }
  if (idx < 0) throw new HttpError(403, 'not_a_player', 'Cette partie se joue à deux, et tu n’en fais pas partie');
  return idx;
}

function nextRound(state, userId, emptyBoard) {
  seat(state, userId);
  if (!state.result) throw new HttpError(409, 'round_not_over');
  state.round++;
  state.starter = 1 - state.starter;
  state.turn = state.starter;
  state.board = emptyBoard();
  state.result = null;
}

const duoState = (userId, opponentId, extra) => ({
  players: [userId, opponentId ?? null],
  turn: 0,
  starter: 0,
  round: 1,
  scores: [0, 0],
  result: null,
  ...extra,
});

function lineWinner(board, lines) {
  for (const line of lines) {
    const v = board[line[0]];
    if (v !== null && line.every((i) => board[i] === v)) return { winner: v, line };
  }
  return null;
}

const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

const C4_LINES = (() => {
  const lines = [];
  const at = (r, c) => r * 7 + c;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const cells = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
        if (cells.every(([rr, cc]) => rr >= 0 && rr < 6 && cc >= 0 && cc < 7)) lines.push(cells.map(([rr, cc]) => at(rr, cc)));
      }
    }
  }
  return lines;
})();

function boardGame({ size, lines, place }) {
  const empty = () => Array(size).fill(null);
  return {
    duo: true,
    create: ({ userId, opponentId }) => duoState(userId, opponentId, { board: empty() }),
    move(state, userId, body) {
      if (body.action === 'next') return nextRound(state, userId, empty);
      const idx = seat(state, userId);
      if (state.result) throw new HttpError(409, 'round_over');
      if (state.players[1] === null) throw new HttpError(409, 'waiting_opponent');
      if (idx !== state.turn) throw new HttpError(409, 'not_your_turn', 'Ce n’est pas ton tour');
      const cell = place(state.board, body);
      if (cell === null) throw new HttpError(400, 'bad_move');
      state.board[cell] = idx;
      state.last = cell;
      const won = lineWinner(state.board, lines);
      if (won) {
        state.result = { winner: won.winner, line: won.line };
        state.scores[won.winner]++;
      } else if (state.board.every((v) => v !== null)) {
        state.result = { winner: null, line: null };
      } else {
        state.turn = 1 - state.turn;
      }
    },
    view: (state, userId) => ({ ...state, you: state.players.indexOf(userId) }),
  };
}

const tictactoe = boardGame({
  size: 9,
  lines: TTT_LINES,
  place: (board, { cell }) => (Number.isInteger(cell) && cell >= 0 && cell < 9 && board[cell] === null ? cell : null),
});

const connect4 = boardGame({
  size: 42,
  lines: C4_LINES,
  place(board, { col }) {
    if (!Number.isInteger(col) || col < 0 || col > 6) return null;
    for (let r = 5; r >= 0; r--) if (board[r * 7 + col] === null) return r * 7 + col;
    return null;
  },
});

const RPS = ['pierre', 'feuille', 'ciseaux'];
const BEATS = { pierre: 'ciseaux', feuille: 'pierre', ciseaux: 'feuille' };

const rps = {
  duo: true,
  create: ({ userId, opponentId }) => duoState(userId, opponentId, { picks: [null, null], last: null }),
  move(state, userId, body) {
    const idx = seat(state, userId);
    if (!RPS.includes(body.pick)) throw new HttpError(400, 'bad_move');
    if (state.picks[idx]) throw new HttpError(409, 'already_played', 'Tu as déjà joué cette manche');
    state.picks[idx] = body.pick;
    if (state.picks[0] && state.picks[1]) {
      const [a, b] = state.picks;
      const winner = a === b ? null : BEATS[a] === b ? 0 : 1;
      if (winner !== null) state.scores[winner]++;
      state.last = { picks: [a, b], winner, round: state.round };
      state.round++;
      state.picks = [null, null];
    }
  },
  view(state, userId) {
    const you = state.players.indexOf(userId);
    return {
      ...state,
      you,
      // The other's pick stays hidden until both have played.
      picks: state.picks.map((p, i) => (i === you ? p : null)),
      played: state.picks.map((p) => !!p),
    };
  },
};

// --- Pendu: the whole group guesses the same word ------------------------------------------------------

function hangmanWord(used = []) {
  const left = HANGMAN_WORDS.filter((w) => !used.includes(w));
  return (left.length ? left : HANGMAN_WORDS)[rand(left.length || HANGMAN_WORDS.length)];
}

const hangman = {
  create: () => {
    const word = hangmanWord();
    return { word, used: [word], guessed: [], wrong: 0, maxWrong: 7, result: null, round: 1, wins: 0, losses: 0, by: {} };
  },
  move(state, userId, body) {
    if (body.action === 'next') {
      if (!state.result) throw new HttpError(409, 'round_not_over');
      state.word = hangmanWord(state.used);
      state.used = [...state.used, state.word].slice(-60);
      Object.assign(state, { guessed: [], wrong: 0, result: null, by: {} });
      state.round++;
      return;
    }
    if (state.result) throw new HttpError(409, 'round_over');
    const letter = fold(body.letter).toUpperCase();
    if (!/^[A-Z]$/.test(letter)) throw new HttpError(400, 'bad_move');
    if (state.guessed.includes(letter)) throw new HttpError(409, 'already_played', 'Cette lettre a déjà été proposée');
    state.guessed.push(letter);
    state.by[letter] = userId;
    if (!state.word.includes(letter)) state.wrong++;
    if ([...state.word].every((c) => state.guessed.includes(c))) {
      state.result = 'won';
      state.wins++;
    } else if (state.wrong >= state.maxWrong) {
      state.result = 'lost';
      state.losses++;
    }
  },
  view(state) {
    const { word, used, ...rest } = state;
    return {
      ...rest,
      length: word.length,
      mask: [...word].map((c) => (state.guessed.includes(c) || state.result ? c : null)),
      word: state.result ? word : null,
    };
  },
};

// --- Qui a dit ça ? : old messages of the group, guess who wrote them ---------------------------------

const quiz = {
  create({ store, groupId }) {
    const { q } = store;
    const rows = q(
      `SELECT messages.text, messages.created_at, users.id AS uid, users.name, users.color FROM messages
       JOIN users ON users.id = messages.user_id
       WHERE messages.group_id = ? AND messages.type = 'text' AND messages.deleted = 0
         AND length(messages.text) BETWEEN 15 AND 220
       ORDER BY RANDOM() LIMIT 200`,
    ).all(groupId);
    const people = new Map();
    for (const r of rows) people.set(r.uid, { id: r.uid, name: r.name, color: r.color });
    for (const u of q(
      `SELECT users.id, users.name, users.color FROM members JOIN users ON users.id = members.user_id
       WHERE members.group_id = ? AND members.status = 'active'`,
    ).all(groupId)) people.set(u.id, { id: u.id, name: u.name, color: u.color });
    if (people.size < 2) throw new HttpError(409, 'not_enough_people', 'Il faut être au moins deux dans le groupe');

    // Prefer older messages (more fun to remember), at most two per person.
    const picked = [];
    const perAuthor = new Map();
    for (const r of [...rows].sort((a, b) => a.created_at - b.created_at)) {
      if (picked.length >= 5) break;
      if ((perAuthor.get(r.uid) ?? 0) >= 2) continue;
      perAuthor.set(r.uid, (perAuthor.get(r.uid) ?? 0) + 1);
      picked.push(r);
    }
    if (picked.length < 3) throw new HttpError(409, 'not_enough_messages', 'Pas encore assez de messages dans le groupe pour ce jeu');
    const everyone = [...people.values()];
    const questions = shuffle(picked).map((r) => {
      const others = shuffle(everyone.filter((p) => p.id !== r.uid)).slice(0, 3);
      return { quote: r.text, date: r.created_at, answer: r.uid, choices: shuffle([people.get(r.uid), ...others]) };
    });
    return { questions, answers: {}, scores: {} };
  },
  move(state, userId, body) {
    const mine = (state.answers[userId] ??= []);
    const question = state.questions[mine.length];
    if (!question) throw new HttpError(409, 'quiz_done', 'Tu as déjà répondu à tout');
    if (!question.choices.some((c) => c.id === body.answer)) throw new HttpError(400, 'bad_move');
    mine.push(body.answer);
    state.scores[userId] = (state.scores[userId] ?? 0) + (body.answer === question.answer ? 10 : 0);
  },
  view(state, userId) {
    const mine = state.answers[userId] ?? [];
    return {
      total: state.questions.length,
      answered: mine.length,
      questions: state.questions.slice(0, mine.length + 1).map((qq, i) => ({
        quote: qq.quote,
        date: qq.date,
        choices: qq.choices,
        // The answer only once this person has answered.
        ...(i < mine.length ? { answer: qq.answer, picked: mine[i] } : {}),
      })),
      scores: state.scores,
      done: mine.length >= state.questions.length,
    };
  },
};

// --- Pictionary: one person draws live, the others guess ------------------------------------------------

const ROUND_MS = 80_000;
const BETWEEN_MS = 6_000;

function pictionaryWord(used) {
  const left = PICTIONARY_WORDS.filter((w) => !used.includes(w));
  return left[rand(left.length)] ?? PICTIONARY_WORDS[rand(PICTIONARY_WORDS.length)];
}

function startRound(state) {
  state.round++;
  if (state.round > state.rounds) {
    state.status = 'over';
    state.word = null;
    return;
  }
  state.drawer = state.players[(state.round - 1) % state.players.length];
  state.word = pictionaryWord(state.used);
  state.used.push(state.word);
  state.startedAt = now();
  state.deadline = now() + ROUND_MS;
  state.found = [];
  state.guesses = [];
  state.hinted = false;
  state.status = 'drawing';
  state.strokesVersion = (state.strokesVersion ?? 0) + 1;
}

function endRound(state) {
  state.history.push({ word: state.word, drawer: state.drawer, found: state.found });
  state.status = 'between';
  state.betweenUntil = now() + BETWEEN_MS;
}

function hint(word, elapsed) {
  const chars = [...word];
  const letters = chars.map((c, i) => ({ c, i })).filter(({ c }) => /\p{L}/u.test(c));
  const shown = new Set([letters[0]?.i, letters.at(-1)?.i]);
  // Halfway through, one more letter.
  if (elapsed > ROUND_MS / 2 && letters.length > 4) shown.add(letters[Math.floor(letters.length / 2)].i);
  return chars.map((c, i) => (/\p{L}/u.test(c) ? (shown.has(i) ? c.toUpperCase() : null) : c));
}

const pictionary = {
  create: ({ userId }) => ({
    players: [userId],
    host: userId,
    scores: { [userId]: 0 },
    rounds: 5,
    round: 0,
    status: 'lobby',
    used: [],
    history: [],
    found: [],
    guesses: [],
  }),
  tick(state) {
    if (state.status === 'drawing' && now() > state.deadline) {
      endRound(state);
      return true;
    }
    // Halfway: everyone gets the extra hint letter, even if nobody guessed in the meantime.
    if (state.status === 'drawing' && !state.hinted && now() - state.startedAt > ROUND_MS / 2) {
      state.hinted = true;
      return true;
    }
    if (state.status === 'between' && now() > state.betweenUntil) {
      startRound(state);
      return true;
    }
    return false;
  },
  move(state, userId, body) {
    const join = () => {
      if (state.players.includes(userId)) return;
      if (state.players.length >= 12) throw new HttpError(409, 'game_full');
      state.players.push(userId);
      state.scores[userId] ??= 0;
    };
    if (body.action === 'join') return join();
    if (body.action === 'start') {
      if (state.status !== 'lobby') throw new HttpError(409, 'already_started');
      join();
      if (state.players.length < 2) throw new HttpError(409, 'not_enough_players', 'Il faut au moins deux joueurs');
      state.rounds = Math.max(state.players.length, Math.min(10, Number(body.rounds) || 5));
      return startRound(state);
    }
    if (body.action === 'skip') {
      if (state.status !== 'drawing' || state.drawer !== userId) throw new HttpError(409, 'not_drawer');
      return endRound(state);
    }
    if (typeof body.guess === 'string') {
      if (state.status !== 'drawing') throw new HttpError(409, 'not_drawing');
      join();
      if (state.drawer === userId) throw new HttpError(409, 'drawer_cannot_guess');
      if (state.found.includes(userId)) throw new HttpError(409, 'already_found');
      const text = body.guess.trim().slice(0, 40);
      if (!text) throw new HttpError(400, 'bad_move');
      const g = fold(text);
      const w = fold(state.word);
      let result = 'no';
      if (g === w) {
        result = 'found';
        const points = state.found.length === 0 ? 5 : 3;
        state.found.push(userId);
        state.scores[userId] = (state.scores[userId] ?? 0) + points;
        state.scores[state.drawer] = (state.scores[state.drawer] ?? 0) + 2;
      } else if (g.length > 2 && (distance(g, w) <= 2 || w.includes(g) || g.includes(w))) {
        result = 'close';
      }
      state.guesses = [...state.guesses, { userId, text, result }].slice(-30);
      if (state.players.filter((p) => p !== state.drawer).every((p) => state.found.includes(p))) endRound(state);
      return;
    }
    throw new HttpError(400, 'bad_move');
  },
  view(state, userId) {
    const drawing = state.status === 'drawing';
    const isDrawer = state.drawer === userId;
    return {
      players: state.players,
      host: state.host,
      scores: state.scores,
      round: state.round,
      rounds: state.rounds,
      status: state.status,
      drawer: state.drawer ?? null,
      deadline: drawing ? state.deadline : null,
      // Time left as the server sees it: phones whose clock is off still show the right countdown.
      remainingMs: drawing ? Math.max(0, state.deadline - now()) : null,
      betweenUntil: state.status === 'between' ? state.betweenUntil : null,
      word: !drawing || isDrawer ? (state.word ?? null) : null,
      hint: drawing && state.word ? hint(state.word, now() - state.startedAt) : null,
      found: state.found,
      // Right answers stay hidden from those still looking.
      guesses: state.guesses.map((g) =>
        g.result === 'found' && g.userId !== userId && drawing && !state.found.includes(userId) && !isDrawer ? { ...g, text: null } : g,
      ),
      history: state.history,
      strokesVersion: state.strokesVersion ?? 0,
    };
  },
  isDone: (state) => state.status === 'over',
};

export const GAMES = { tictactoe, connect4, rps, hangman, quiz, pictionary };
export const GAME_KINDS = Object.keys(GAMES);
export const GAME_NAMES = {
  tictactoe: 'Morpion',
  connect4: 'Puissance 4',
  rps: 'Chifoumi',
  hangman: 'Pendu',
  quiz: 'Qui a dit ça ?',
  pictionary: 'Pictionary',
};
