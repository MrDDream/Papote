import { api, live, ApiError } from './api.js';
import { session, go, back } from './app.js';
import {
  h,
  clear,
  icon,
  iconButton,
  primaryButton,
  button,
  topBar,
  toggle,
  errorBox,
  confirmDialog,
  avatar,
  tint,
  surfaceOf,
  swatches,
  sheet,
  lightbox,
  dayLabel,
  duration,
  confetti,
  STICKERS,
  stickerSvg,
  MOODS,
  moodIcon,
  REACTIONS,
  reactionOf,
  resizeImage,
} from './ui.js';
import { emojiPicker } from './emoji.js';
import { gameInfo, pendingPhoto, of } from './extras.js';
import { createBoard, streamer } from './draw.js';

const screen = (...children) => h('div', { class: 'screen' }, ...children);
const pref = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const setPref = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
};
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const PATTERNS = [['none', 'Uni'], ['dots', 'Pois'], ['stripes', 'Rayures'], ['grid', 'Grille']];

function linkRow(ic, label, sub, onclick) {
  return h('button', { type: 'button', class: 'link-row', onclick }, h('span', { class: 'link-icon' }, icon(ic, 20)), h('span', { class: 'col grow', style: { gap: 0, textAlign: 'left' } }, h('b', {}, label), sub && h('span', { class: 'small muted' }, sub)), icon('forward', 18));
}

// --- Réglages du groupe -----------------------------------------------------------------------------

export function groupSettingsScreen(groupId) {
  let group = null;
  let members = [];
  const err = errorBox();
  const body = h('div', { class: 'scroll' });

  async function load() {
    try {
      [group, members] = await Promise.all([api.group(groupId), api.members(groupId)]);
      render();
    } catch (e) {
      if (e.code === 'group_not_found') go('/groups', { replace: true });
      else err.show(e.message);
    }
  }

  const act = (fn) => async () => {
    err.show(null);
    try {
      await fn();
      await load();
    } catch (e) {
      err.show(e.message);
    }
  };

  function render() {
    const me = members.find((m) => m.id === session.me.id);
    const admin = ['owner', 'admin'].includes(me?.role);
    const s = group.settings;
    const canTheme = admin || !s.adminsTheme;
    const direct = group.direct;
    const t = tint(group.color);
    const active = members.filter((m) => m.status !== 'pending');
    const preview = h(
      'div',
      { class: 'theme-preview', 'data-pattern': s.pattern, style: { backgroundColor: surfaceOf(t) }, 'aria-hidden': 'true' },
      h('span', { class: 'pv-bubble' }, 'Coucou !'),
      h('span', { class: 'pv-bubble mine' }, 'Salut'),
    );
    const reactionsRow = h(
      'div',
      { class: 'row wrap' },
      s.reactions.map((k) => {
        const r = reactionOf(k);
        return h(
          'button',
          {
            type: 'button',
            class: 'reaction-btn',
            style: r ? { background: r.bg, color: r.fg } : {},
            disabled: !canTheme || s.reactions.length <= 1,
            'aria-label': `${r?.label ?? k} : retirer`,
            title: 'Tape pour retirer',
            onclick: act(() => api.groupSettings(groupId, { reactions: s.reactions.filter((x) => x !== k) })),
          },
          r ? icon(r.icon, 24) : k,
        );
      }),
      canTheme &&
        s.reactions.length < 8 &&
        h(
          'button',
          {
            type: 'button',
            class: 'reaction-btn add',
            'aria-label': 'Ajouter une réaction',
            onclick: () =>
              sheet((close) => [
                h('h2', { class: 'title', style: { fontSize: '20px' } }, 'Ajouter une réaction'),
                h(
                  'div',
                  { class: 'reaction-row' },
                  REACTIONS.filter((r) => !s.reactions.includes(r.key)).map((r) =>
                    h('button', { type: 'button', class: 'reaction-btn', style: { background: r.bg, color: r.fg }, 'aria-label': r.label, onclick: () => (close(), act(() => api.groupSettings(groupId, { reactions: [...s.reactions, r.key] }))()) }, icon(r.icon, 24)),
                  ),
                ),
                emojiPicker((e) => (close(), act(() => api.groupSettings(groupId, { reactions: [...new Set([...s.reactions, e])] }))())),
              ]),
          },
          icon('plus', 22),
        ),
    );
    const talkieOn = pref(`papote.talkie.${groupId}`, '0') === '1';

    clear(
      body,
      topBar(direct ? 'Réglages de la discussion' : 'Réglages du groupe', () => back(`/chat/${groupId}`), { subtitle: group.name }),
      h(
        'div',
        { class: 'card', style: { padding: '6px', gap: '0' } },
        linkRow('personPlus', direct ? 'La discussion' : 'Membres', direct ? 'Avec qui tu papotes' : `${active.length} membre${active.length > 1 ? 's' : ''}${admin && members.some((m) => m.status === 'pending') ? ' · des demandes en attente' : ''}`, () => go(`/members/${groupId}`)),
        !direct && (s.anyoneInvites || admin) && linkRow('share', 'Inviter quelqu’un', 'Code et QR code', () => go(`/invite/${groupId}`)),
        linkRow('grid', 'Galerie', 'Dessins, photos, GIF, vocaux', () => go(`/gallery/${groupId}`)),
        linkRow('search', 'Épinglés et recherche', null, () => go(`/search/${groupId}`)),
        linkRow('game', 'Mini-jeux', null, () => go(`/games/${groupId}`)),
        linkRow('sparkles', 'Le récap du mois', null, () => go(`/recap/${groupId}`)),
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'row' }, h('h2', { class: 'title grow', style: { fontSize: '18px' } }, 'Thème'), !canTheme && h('span', { class: 'small muted' }, 'réservé aux admins')),
        h(
          'div',
          { class: 'row', style: { alignItems: 'flex-start', gap: '14px' } },
          preview,
          h(
            'div',
            { class: 'col grow', style: { gap: '10px' } },
            !direct && canTheme && swatches(group.color, (c) => act(() => api.updateGroup(groupId, { color: c }))()),
            h(
              'div',
              { class: 'segmented small', role: 'group', 'aria-label': 'Motif du fond' },
              PATTERNS.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(s.pattern === k), disabled: !canTheme, onclick: act(() => api.groupSettings(groupId, { pattern: k })) }, l)),
            ),
          ),
        ),
      ),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'title grow', style: { fontSize: '18px' } }, 'Réactions du groupe'), h('span', { class: 'small muted' }, 'Tape pour changer')), reactionsRow),
      h(
        'div',
        { class: 'card' },
        h('h2', { class: 'title', style: { fontSize: '18px' } }, 'Mon humeur'),
        h(
          'div',
          { class: 'row wrap' },
          MOODS.map((m) =>
            h(
              'button',
              {
                type: 'button',
                class: 'chip',
                'aria-pressed': String(session.me.mood === m.key),
                onclick: async () => {
                  try {
                    session.setMe(await api.updateMe({ mood: session.me.mood === m.key ? null : m.key }));
                    render();
                  } catch (e) {
                    err.show(e.message);
                  }
                },
              },
              moodIcon(m.key, 16),
              m.label,
            ),
          ),
        ),
        h('span', { class: 'small muted' }, 'Visible sur ton avatar, dans tous tes groupes.'),
      ),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, 'Fêter les anniversaires'), h('span', { class: 'small muted' }, session.me.birthday ? `Confettis le jour J · le tien : ${birthdayText(session.me.birthday)}` : 'Confettis le jour J · ajoute ta date dans Paramètres')),
          toggle(s.birthdays, (v) => act(() => api.groupSettings(groupId, { birthdays: v }))(), 'Fêter les anniversaires'),
        ),
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, 'Mode talkie'), h('span', { class: 'small muted' }, 'Les vocaux des autres se lancent tout seuls quand la discussion est ouverte')),
          toggle(talkieOn, (v) => setPref(`papote.talkie.${groupId}`, v ? '1' : '0'), 'Mode talkie'),
        ),
      ),
      err,
      h('a', { class: 'btn', href: api.exportUrl(groupId), download: '' }, icon('download', 20), 'Exporter (.zip)'),
      button(direct ? 'Quitter la discussion' : 'Quitter le groupe', async () => {
        if (!(await confirmDialog(direct ? 'Quitter la discussion ?' : 'Quitter le groupe ?', direct ? 'Tu pourras en recommencer une depuis « Nouvelle discussion ».' : 'Il te faudra un nouveau code pour revenir.'))) return;
        try {
          await api.leaveGroup(groupId);
          go('/groups', { replace: true });
        } catch (e) {
          err.show(e.message);
        }
      }, { iconName: 'exit', danger: true }),
    );
  }

  const offs = [
    ...['member.joined', 'member.left', 'member.updated', 'member.pending', 'group.updated'].map((t) => live.on(t, (e) => (e.groupId ?? e.group?.id) === groupId && load())),
    live.on('group.removed', (e) => e.groupId === groupId && go('/groups', { replace: true })),
  ];
  body.append(topBar('Réglages du groupe', () => back(`/chat/${groupId}`)), err);
  load();
  return { el: screen(body), destroy: () => offs.forEach((off) => off()) };
}

function birthdayText(b) {
  const m = b.match(/(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : '';
}

// --- Épinglés et recherche ----------------------------------------------------------------------------

export function searchScreen(groupId) {
  let members = new Map();
  let pins = [];
  let filter = 'all';
  let timer = null;
  const input = h('input', { class: 'field', type: 'search', placeholder: 'Rechercher', 'aria-label': 'Rechercher dans la discussion', autofocus: true });
  const pinsEl = h('div');
  const chips = h('div', { class: 'chips' });
  const title = h('h2', { class: 'title', style: { fontSize: '18px' } });
  const results = h('div', { class: 'col', style: { gap: '8px' } });
  const err = errorBox();
  const headTitle = h('span', {});

  const open = (m) => go(`/chat/${groupId}?at=${m.id}`);
  const snippet = (m) => (m.type === 'voice' ? m.meta?.transcript ?? '' : m.text);

  function highlight(text, q) {
    if (!q) return text;
    const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const i = fold(text).indexOf(fold(q));
    if (i < 0) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
    const start = Math.max(0, i - 40);
    return [start > 0 ? '…' : '', text.slice(start, i), h('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length, i + q.length + 80)];
  }

  function paintPins() {
    clear(
      pinsEl,
      pins.length > 0 && [
        h('h2', { class: 'title', style: { fontSize: '18px' } }, 'Épinglés'),
        h(
          'div',
          { class: 'pins-row' },
          pins.map((p, i) =>
            h(
              'button',
              { type: 'button', class: 'pin-card', style: { background: ['#FFF0B8', '#D6E8FF', '#FFE0E8', '#CDEFE0'][i % 4] }, onclick: () => open(p) },
              h('b', { class: 'small' }, members.get(p.authorId)?.name ?? ''),
              h('span', { class: 'clamp' }, p.text || { photo: 'Photo', drawing: 'Dessin', voice: 'Vocal', location: 'Position', gif: 'GIF', sticker: 'Sticker' }[p.type] || 'Message'),
            ),
          ),
        ),
      ],
    );
  }

  function paintChips() {
    const people = [...members.values()].filter((m) => m.status !== 'pending').slice(0, 8);
    clear(
      chips,
      [['all', 'Tout'], ['text', 'Texte'], ['voice', 'Vocaux'], ...people.map((m) => [`u${m.id}`, m.id === session.me.id ? 'Toi' : m.name])].map(([k, l]) =>
        h('button', { type: 'button', class: 'chip-filter', 'aria-pressed': String(filter === k), onclick: () => ((filter = k), paintChips(), run()) }, l),
      ),
    );
  }

  async function run() {
    const q = input.value.trim();
    const params = {};
    if (q) params.q = q;
    if (filter === 'text' || filter === 'voice') params.kind = filter;
    if (filter.startsWith('u')) params.author = filter.slice(1);
    if (!q && !params.author) {
      clear(title);
      clear(results);
      return;
    }
    try {
      const list = await api.search(groupId, params);
      title.textContent = `${list.length} résultat${list.length > 1 ? 's' : ''}${q ? ` pour « ${q} »` : ''}`;
      clear(
        results,
        list.map((m) => {
          const a = members.get(m.authorId);
          return h(
            'button',
            { type: 'button', class: 'result', onclick: () => open(m) },
            avatar(a ?? { name: '?', color: 'lilas' }, 36, { initial: true }),
            h(
              'span',
              { class: 'col grow', style: { gap: '2px', minWidth: 0, textAlign: 'left' } },
              h('span', { class: 'row', style: { gap: '6px' } }, h('b', {}, m.authorId === session.me.id ? 'Toi' : (a?.name ?? 'Ancien membre')), m.type === 'voice' && h('span', { class: 'chip-mini' }, 'vocal transcrit'), h('span', { class: 'small muted grow', style: { textAlign: 'right' } }, dayLabel(m.createdAt))),
              h('span', { class: 'snippet' }, highlight(snippet(m), q)),
            ),
          );
        }),
      );
    } catch (e) {
      err.show(e.message);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  });

  Promise.all([api.group(groupId), api.members(groupId), api.pins(groupId)])
    .then(([g, ms, p]) => {
      headTitle.textContent = g.name;
      members = new Map(ms.map((m) => [m.id, m]));
      pins = p;
      paintPins();
      paintChips();
    })
    .catch((e) => err.show(e.message));

  return {
    el: screen(
      h(
        'div',
        { class: 'scroll' },
        h('div', { class: 'row' }, iconButton('back', 'Retour', () => back(`/chat/${groupId}`)), h('div', { class: 'search grow' }, icon('search', 20), input)),
        h('span', { class: 'small muted' }, 'Dans ', headTitle, ' · textes, sondages et vocaux transcrits'),
        pinsEl,
        chips,
        title,
        results,
        err,
      ),
    ),
    destroy: () => clearTimeout(timer),
  };
}

// --- Galerie ---------------------------------------------------------------------------------------------

export function galleryScreen(groupId) {
  let members = new Map();
  let tab = 'all';
  let who = null;
  let items = [];
  let total = 0;
  let memory = null;
  let more = false;
  const err = errorBox();
  const sub = h('span', { class: 'small muted' });
  const tabsEl = h('div', { class: 'segmented', role: 'tablist' });
  const peopleEl = h('div', { class: 'row people', role: 'group', 'aria-label': 'Filtrer par personne' });
  const memoryEl = h('div');
  const gridEl = h('div', { class: 'col', style: { gap: '14px' } });
  const audio = new Audio();

  const params = (before) => ({ ...(tab !== 'all' ? { kind: tab } : {}), ...(who ? { author: who } : {}), ...(before ? { before } : {}) });

  async function load(append = false) {
    try {
      const res = await api.gallery(groupId, params(append ? items.at(-1)?.id : null));
      items = append ? [...items, ...res.items] : res.items;
      more = res.items.length === 60;
      if (!append) {
        total = res.total;
        memory = res.memory;
      }
      paint();
    } catch (e) {
      err.show(e.message);
    }
  }

  const NAMES = { drawing: 'Dessin', photo: 'Photo', gif: 'GIF', voice: 'Vocal' };
  const ICONS = { drawing: 'pencil', photo: 'photo', gif: 'gif', voice: 'mic' };
  const BG = { drawing: '#FFF8E6', photo: '#D6E8FF', gif: '#FFE0E8', voice: '#CDEFE0' };

  function tile(m) {
    const a = members.get(m.authorId);
    const label = `${NAMES[m.type]} ${of(a?.name ?? 'quelqu’un')}`;
    const openIt = () => {
      if (m.type === 'drawing') go(`/drawing/${m.id}?g=${groupId}`);
      else if (m.type === 'voice') {
        audio.src = m.media.url;
        audio.play().catch(() => {});
      } else lightbox(m.media.url, label);
    };
    return h(
      'button',
      { type: 'button', class: 'g-tile', style: { background: BG[m.type] }, 'aria-label': label, onclick: openIt },
      m.type === 'voice' ? h('span', { class: 'g-voice' }, icon('play', 26), duration(m.meta?.durationMs)) : h('img', { src: m.media.url, alt: '', loading: 'lazy' }),
      h('span', { class: 'g-who' }, (a?.name ?? '?').slice(0, 1).toUpperCase()),
      m.type === 'gif' && h('span', { class: 'g-tag' }, 'GIF'),
    );
  }

  function paint() {
    sub.textContent = `${total} souvenir${total > 1 ? 's' : ''}`;
    clear(
      tabsEl,
      [['all', 'Tout'], ['drawing', 'Dessins'], ['photo', 'Photos'], ['gif', 'GIF'], ['voice', 'Vocaux']].map(([k, l]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), 'aria-pressed': String(tab === k), onclick: () => ((tab = k), load()) }, l),
      ),
    );
    clear(
      peopleEl,
      [...members.values()]
        .filter((m) => m.status !== 'pending')
        .map((m) =>
          h(
            'button',
            { type: 'button', class: 'person-filter', 'aria-pressed': String(who === m.id), 'aria-label': `Voir seulement ${m.id === session.me.id ? 'toi' : m.name}`, style: { opacity: who && who !== m.id ? 0.45 : 1 }, onclick: () => ((who = who === m.id ? null : m.id), load()) },
            avatar(m, 44, { initial: true }),
          ),
        ),
    );
    clear(
      memoryEl,
      memory &&
        h(
          'button',
          { type: 'button', class: 'memory-card', onclick: () => (memory.type === 'drawing' ? go(`/drawing/${memory.id}?g=${groupId}`) : lightbox(memory.media.url, 'Souvenir')) },
          h('img', { src: memory.media.url, alt: '' }),
          h('span', { class: 'col', style: { gap: 0, textAlign: 'left' } }, h('b', {}, 'Il y a un an jour pour jour…'), h('span', { class: 'small' }, `${memory.type === 'drawing' ? 'Le dessin' : 'La photo'} ${of(members.get(memory.authorId)?.name ?? 'quelqu’un')}`)),
        ),
    );
    if (!items.length) return clear(gridEl, h('p', { class: 'muted empty-note' }, 'Rien par ici pour l’instant.'));
    const byMonth = new Map();
    for (const m of items) {
      const d = new Date(m.createdAt);
      const k = `${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(m);
    }
    clear(
      gridEl,
      [...byMonth].map(([month, list]) => h('section', { class: 'col', style: { gap: '8px' } }, h('h2', { class: 'title', style: { fontSize: '18px' } }, month, h('span', { class: 'small muted' }, ` · ${list.length}`)), h('div', { class: 'g-grid' }, list.map(tile)))),
      more && button('Voir plus', () => load(true), { small: true }),
    );
  }

  Promise.all([api.group(groupId), api.members(groupId)])
    .then(([g, ms]) => {
      members = new Map(ms.map((m) => [m.id, m]));
      sub.textContent = g.name;
      load();
    })
    .catch((e) => err.show(e.message));

  return {
    el: screen(
      h(
        'div',
        { class: 'scroll' },
        h('div', { class: 'row' }, iconButton('back', 'Retour', () => back(`/chat/${groupId}`)), h('div', { class: 'col grow', style: { gap: 0 } }, h('h1', { class: 'title' }, 'Galerie'), sub)),
        memoryEl,
        tabsEl,
        peopleEl,
        err,
        gridEl,
      ),
    ),
    destroy: () => audio.pause(),
  };
}

// --- Mini-jeux ---------------------------------------------------------------------------------------------

const CATALOGUE = [
  ['tictactoe', '2 joueurs · tour par tour', 'duo'],
  ['connect4', '2 joueurs', 'duo'],
  ['rps', '2 joueurs · express', 'duo'],
  ['pictionary', 'Groupe · dessin en direct', 'group'],
  ['quiz', 'Groupe · vieux messages', 'group'],
  ['hangman', 'Groupe · tout le monde devine', 'group'],
];

export function gamesScreen(groupId) {
  let filter = 'all';
  let games = [];
  let members = [];
  let group = null;
  const err = errorBox();
  const body = h('div', { class: 'col', style: { gap: '12px' } });
  const sub = h('span', { class: 'small muted' });

  async function load() {
    try {
      [group, members, games] = await Promise.all([api.group(groupId), api.members(groupId), api.games(groupId)]);
      sub.textContent = `${group.name} · ${CATALOGUE.length} jeux`;
      paint();
    } catch (e) {
      err.show(e.message);
    }
  }

  async function start(kind, opponentId) {
    try {
      const g = await api.newGame(groupId, kind, opponentId ?? undefined);
      go(`/game/${g.id}`);
    } catch (e) {
      err.show(e.message);
    }
  }

  function pickOpponent(kind) {
    const others = members.filter((m) => m.id !== session.me.id && m.status !== 'pending');
    if (group.direct) return start(kind);
    sheet((close) => [
      h('h2', { class: 'title', style: { fontSize: '20px' } }, `${gameInfo(kind)[0]} contre…`),
      button('La première personne qui joue', () => (close(), start(kind)), { iconName: 'personPlus' }),
      others.map((m) => h('button', { type: 'button', class: 'member', onclick: () => (close(), start(kind, m.id)) }, avatar(m, 40, { online: m.online }), h('span', { class: 'title grow', style: { fontSize: '18px' } }, m.name))),
    ]);
  }

  const nameOf = (id) => (id === session.me.id ? 'toi' : (members.find((m) => m.id === id)?.name ?? '?'));

  function summary(g) {
    const s = g.state;
    if (['tictactoe', 'connect4', 'rps'].includes(g.kind)) {
      const other = s.players.find((p) => p !== session.me.id);
      const vs = other ? `contre ${nameOf(other)}` : 'en attente d’adversaire';
      const myTurn = g.kind !== 'rps' && !s.result && s.players[s.turn] === session.me.id;
      return `${vs} · ${myTurn ? 'à toi de jouer' : `manche ${s.round}`}`;
    }
    if (g.kind === 'quiz') return s.done ? `fini · ${s.scores[session.me.id] ?? 0} pts` : `${s.answered}/${s.total} réponses`;
    if (g.kind === 'pictionary') return s.status === 'lobby' ? `${s.players.length} joueur(s) · pas commencé` : `manche ${s.round}/${s.rounds}`;
    if (g.kind === 'hangman') return `mot ${s.round} · ${s.wins} trouvé(s)`;
    return '';
  }

  function paint() {
    const playing = games.filter((g) => g.status === 'playing');
    clear(
      body,
      playing.length > 0 && [
        h('h2', { class: 'title', style: { fontSize: '18px' } }, 'Parties en cours'),
        playing.map((g) => {
          const [name, ic, bg] = gameInfo(g.kind);
          return h('button', { type: 'button', class: 'game-row', style: { background: bg }, onclick: () => go(`/game/${g.id}`) }, h('span', { class: 'game-icon' }, icon(ic, 22)), h('span', { class: 'col grow', style: { gap: 0, textAlign: 'left' } }, h('b', {}, name), h('span', { class: 'small' }, summary(g))), icon('forward', 18));
        }),
      ],
      h(
        'div',
        { class: 'chips' },
        [['all', 'Tous'], ['duo', 'À deux'], ['group', 'En groupe']].map(([k, l]) => h('button', { type: 'button', class: 'chip-filter', 'aria-pressed': String(filter === k), onclick: () => ((filter = k), paint()) }, l)),
      ),
      h(
        'div',
        { class: 'games-grid' },
        CATALOGUE.filter(([, , kind]) => filter === 'all' || kind === filter).map(([k, meta, kind]) => {
          const [name, ic, bg] = gameInfo(k);
          return h('button', { type: 'button', class: 'game-tile', style: { background: bg }, onclick: () => (kind === 'duo' ? pickOpponent(k) : start(k)) }, h('span', { class: 'game-icon' }, icon(ic, 26)), h('b', {}, name), h('span', { class: 'small' }, meta));
        }),
      ),
    );
  }

  const off = live.on('game.updated', (e) => e.groupId === groupId && load());
  load();
  return {
    el: screen(h('div', { class: 'scroll' }, h('div', { class: 'row' }, iconButton('back', 'Retour', () => back(`/chat/${groupId}`)), h('div', { class: 'col grow', style: { gap: 0 } }, h('h1', { class: 'title' }, 'Mini-jeux'), sub)), err, body)),
    destroy: off,
  };
}

// --- one game ------------------------------------------------------------------------------------------------

const GALLOWS = 'M20 110h60M35 110V12h40';
const HANG_PARTS = [
  'M75 12v14',
  'M75 34a8 8 0 1 1 0 .01',
  'M75 42v30',
  'M75 50l-14 12',
  'M75 50l14 12',
  'M75 72l-12 18',
  'M75 72l12 18',
];

export function gameScreen(gameId) {
  let game = null;
  let members = new Map();
  let board = null;
  let stream = null;
  let boardVersion = -1;
  let tick = null;
  let celebrated = null;
  const err = errorBox();
  const head = h('div', { class: 'row' });
  const body = h('div', { class: 'col', style: { gap: '14px' } });

  const nameOf = (id) => (id === session.me.id ? 'Toi' : (members.get(id)?.name ?? '?'));
  const play = async (move) => {
    err.show(null);
    try {
      game = await api.move(gameId, move);
      paint();
    } catch (e) {
      err.show(e.message);
    }
  };

  async function load() {
    try {
      const g = await api.game(gameId);
      if (!members.size) members = new Map((await api.members(g.groupId)).map((m) => [m.id, m]));
      game = g;
      paint(g.strokes);
    } catch (e) {
      err.show(e.message);
    }
  }

  function shareResult(text) {
    return button('Partager le résultat', async () => {
      try {
        await api.sendText(game.groupId, text);
        err.show(null);
        back(`/chat/${game.groupId}`);
      } catch (e) {
        err.show(e.message);
      }
    }, { iconName: 'share', small: true });
  }

  function scoreCards(s, marks) {
    return h(
      'div',
      { class: 'row' },
      [0, 1].map((i) =>
        h(
          'div',
          { class: `score-card${!s.result && s.turn === i && s.players[1] ? ' on' : ''}`, style: { background: i === 0 ? '#FFE0E8' : '#EDE6FF' } },
          marks[i],
          h('span', { class: 'col grow', style: { gap: 0 } }, h('b', {}, s.players[i] ? nameOf(s.players[i]) : 'En attente…'), h('span', { class: 'small' }, i === 0 ? 'Cœurs' : 'Étoiles')),
          h('b', { class: 'score' }, String(s.scores[i])),
        ),
      ),
    );
  }

  function duoStatus(s, winText) {
    const other = s.players.find((p) => p !== session.me.id);
    if (s.result) {
      if (s.result.winner === null) return 'Égalité, bien joué !';
      return s.players[s.result.winner] === session.me.id ? winText : `${nameOf(s.players[s.result.winner])} gagne cette manche`;
    }
    if (!s.players[1]) return s.players[0] === session.me.id ? 'On attend quelqu’un pour jouer…' : 'Place libre : joue pour la prendre !';
    return s.players[s.turn] === session.me.id ? 'À toi de jouer' : `À ${nameOf(other ?? s.players[s.turn])} de jouer`;
  }

  function celebrate(s) {
    const key = `${game.id}:${s.round}`;
    if (s.result && s.result.winner !== null && s.players[s.result.winner] === session.me.id && celebrated !== key) {
      celebrated = key;
      confetti(60);
    }
  }

  function paintBoardGame(s) {
    const ttt = game.kind === 'tictactoe';
    const mark = (v, size = 34) => (v === 0 ? h('span', { class: 'mark heart' }, icon('heart', size, 3)) : v === 1 ? h('span', { class: 'mark star' }, icon('star', size, 3)) : null);
    const cells = ttt
      ? h(
          'div',
          { class: 'ttt', role: 'grid', 'aria-label': 'Grille du morpion' },
          s.board.map((v, i) =>
            h('button', { type: 'button', class: `cell${s.result?.line?.includes(i) ? ' win' : ''}`, 'aria-label': `Case ${Math.floor(i / 3) + 1}-${(i % 3) + 1} : ${v === null ? 'vide' : v === 0 ? 'cœur' : 'étoile'}`, disabled: v !== null || !!s.result, onclick: () => play({ cell: i }) }, mark(v, 44)),
          ),
        )
      : h(
          'div',
          { class: 'c4' },
          h('div', { class: 'c4-cols' }, Array.from({ length: 7 }, (_, c) => h('button', { type: 'button', class: 'c4-drop', 'aria-label': `Jouer colonne ${c + 1}`, disabled: !!s.result || s.board[c] !== null, onclick: () => play({ col: c }) }, icon('back', 18)))),
          h('div', { class: 'c4-grid', role: 'grid', 'aria-label': 'Grille de Puissance 4' }, s.board.map((v, i) => h('span', { class: `c4-cell${v === 0 ? ' p0' : v === 1 ? ' p1' : ''}${s.result?.line?.includes(i) ? ' win' : ''}${s.last === i ? ' last' : ''}` }))),
        );
    celebrate(s);
    const won = s.result && s.result.winner !== null && s.players[s.result.winner] === session.me.id;
    const other = s.players.find((p) => p !== session.me.id);
    return [
      scoreCards(s, [mark(0, 22), mark(1, 22)]),
      h('p', { class: 'game-status', role: 'status' }, duoStatus(s, 'Tu gagnes ! Bravo !')),
      cells,
      s.result && h('div', { class: 'row wrap' }, primaryButton('Manche suivante', () => play({ action: 'next' }), { iconName: 'refresh' }), won && other && shareResult(`J’ai gagné une manche de ${gameInfo(game.kind)[0]} contre ${nameOf(other)} (${s.scores[s.players.indexOf(session.me.id)]}-${s.scores[s.players.indexOf(other)]}) !`)),
    ];
  }

  function paintRps(s) {
    const EMO = { pierre: '✊', feuille: '✋', ciseaux: '✌️' };
    const you = s.players.indexOf(session.me.id);
    const last = s.last;
    let lastText = null;
    if (last) {
      const [a, b] = last.picks;
      const res = last.winner === null ? 'égalité' : `${nameOf(s.players[last.winner])} gagne`;
      lastText = `Manche ${last.round} : ${nameOf(s.players[0])} ${EMO[a]} — ${EMO[b]} ${nameOf(s.players[1])} · ${res}`;
    }
    return [
      scoreCards({ ...s, result: true }, [h('span', { class: 'mark' }, '✊'), h('span', { class: 'mark' }, '✌️')]),
      lastText && h('p', { class: 'game-status' }, lastText),
      h('p', { class: 'small muted', style: { textAlign: 'center', margin: 0 } }, you >= 0 && s.picks[you] ? 'Tu as joué, on attend l’autre…' : `Manche ${s.round} : choisis !`),
      h(
        'div',
        { class: 'rps' },
        Object.entries(EMO).map(([k, e]) => h('button', { type: 'button', class: 'rps-btn', 'aria-pressed': String(you >= 0 && s.picks[you] === k), disabled: you >= 0 && !!s.picks[you], onclick: () => play({ pick: k }) }, h('span', { class: 'emoji' }, e), cap(k))),
      ),
    ];
  }

  function paintHangman(s) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('class', 'hangman');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${s.wrong} erreur(s) sur ${s.maxWrong}`);
    [GALLOWS, ...HANG_PARTS.slice(0, s.wrong)].forEach((d) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '4');
      p.setAttribute('stroke-linecap', 'round');
      svg.append(p);
    });
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    return [
      h('p', { class: 'game-status', role: 'status' }, s.result === 'won' ? 'Bravo, mot trouvé !' : s.result === 'lost' ? `Perdu… c’était ${s.word}` : `${s.maxWrong - s.wrong} erreur(s) restante(s)`),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, svg),
      h('div', { class: 'word', 'aria-label': `Mot : ${s.mask.map((c) => c ?? 'blanc').join(' ')}` }, s.mask.map((c) => h('span', { class: 'letter' }, c ?? ''))),
      !s.result &&
        h(
          'div',
          { class: 'keyboard' },
          letters.map((l) => {
            const used = s.guessed.includes(l);
            return h('button', { type: 'button', class: `key${used ? (s.mask.includes(l) ? ' ok' : ' no') : ''}`, disabled: used, title: used && s.by[l] ? `Proposée par ${nameOf(s.by[l])}` : '', onclick: () => play({ letter: l }) }, l);
          }),
        ),
      s.result && primaryButton('Mot suivant', () => play({ action: 'next' }), { iconName: 'refresh' }),
      h('span', { class: 'small muted', style: { textAlign: 'center' } }, `${s.wins} mot(s) trouvé(s) · ${s.losses} raté(s) · tout le groupe joue ensemble`),
    ];
  }

  function paintQuiz(s) {
    const cur = s.questions.at(-1);
    const answeredCur = cur && cur.answer !== undefined;
    const lastAnswered = s.questions.filter((q) => q.answer !== undefined).at(-1);
    const right = lastAnswered && lastAnswered.picked === lastAnswered.answer;
    const scores = Object.entries(s.scores).sort((a, b) => b[1] - a[1]);
    return [
      h('div', { class: 'quiz-dots', 'aria-label': `Question ${Math.min(s.answered + 1, s.total)} sur ${s.total}` }, Array.from({ length: s.total }, (_, i) => h('span', { class: i < s.answered ? 'on' : '' }))),
      !s.done &&
        cur &&
        !answeredCur && [
          h('blockquote', { class: 'quote' }, `« ${cur.quote} »`, h('span', { class: 'small muted' }, `Message du ${new Date(cur.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`)),
          h(
            'div',
            { class: 'quiz-choices' },
            cur.choices.map((c) => h('button', { type: 'button', class: 'quiz-choice', onclick: () => play({ answer: c.id }) }, avatar(c, 40, { initial: true }), c.id === session.me.id ? 'Moi' : c.name)),
          ),
        ],
      lastAnswered && h('p', { class: `game-status ${right ? 'ok' : 'no'}` }, right ? 'Bien vu, +10 points !' : `Raté, c’était ${lastAnswered.choices.find((c) => c.id === lastAnswered.answer)?.name ?? '?'} !`),
      s.done && h('p', { class: 'game-status' }, `Fini ! Tu as ${s.scores[session.me.id] ?? 0} points.`),
      scores.length > 0 && h('div', { class: 'card' }, h('h2', { class: 'title', style: { fontSize: '18px' } }, 'Scores'), scores.map(([uid, pts]) => h('div', { class: 'row' }, avatar(members.get(Number(uid)) ?? { name: '?', color: 'lilas' }, 32, { initial: true }), h('span', { class: 'grow' }, nameOf(Number(uid))), h('b', {}, `${pts} pts`)))),
    ];
  }

  function paintPictionary(s, strokes) {
    const drawer = s.drawer === session.me.id;
    const joined = s.players.includes(session.me.id);
    const scores = h(
      'div',
      { class: 'row wrap' },
      s.players.map((p) => h('span', { class: `pic-score${p === s.drawer ? ' drawer' : ''}` }, avatar(members.get(p) ?? { name: '?', color: 'lilas' }, 28, { initial: true }), nameOf(p), h('b', {}, String(s.scores[p] ?? 0)))),
    );
    if (s.status === 'lobby') {
      return [
        h('p', { class: 'game-status' }, 'Chacun son tour dessine, les autres devinent.'),
        scores,
        !joined && primaryButton('Rejoindre la partie', () => play({ action: 'join' }), { iconName: 'personPlus' }),
        joined && primaryButton(s.players.length < 2 ? 'On attend un 2e joueur…' : 'Lancer la partie', () => play({ action: 'start' }), { iconName: 'play', disabled: s.players.length < 2 }),
      ];
    }
    if (s.status === 'over') {
      const best = Object.entries(s.scores).sort((a, b) => b[1] - a[1])[0];
      if (best && Number(best[0]) === session.me.id && celebrated !== `${game.id}:over`) {
        celebrated = `${game.id}:over`;
        confetti();
      }
      return [h('p', { class: 'game-status' }, `Partie finie ! ${best ? `${nameOf(Number(best[0]))} gagne avec ${best[1]} points` : ''}`), scores];
    }
    // Drawing or between rounds: one board, kept across renders while the round lasts.
    if (!board || boardVersion !== s.strokesVersion) {
      stream?.stop();
      board?.destroy();
      boardVersion = s.strokesVersion;
      stream = streamer(game.groupId, 'game', () => ({ gameId }));
      board = createBoard({ editable: drawer && s.status === 'drawing', onOp: (op, phase) => stream.onOp(op, phase) });
      if (strokes) board.reset(strokes);
    }
    const secs = s.deadline ? Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000)) : 0;
    const guessInput = h('input', { class: 'field grow', placeholder: 'Ta réponse', maxlength: 40, 'aria-label': 'Ta réponse' });
    const guess = () => {
      const v = guessInput.value.trim();
      if (!v) return;
      guessInput.value = '';
      play({ guess: v });
    };
    guessInput.addEventListener('keydown', (e) => e.key === 'Enter' && guess());
    const word = s.word ?? null;
    return [
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'small muted grow' }, `Manche ${s.round} sur ${s.rounds} · ${drawer ? 'tu dessines' : `${nameOf(s.drawer)} dessine`}`),
        s.status === 'drawing' && h('span', { class: 'timer', 'aria-label': `${secs} secondes` }, String(secs)),
      ),
      scores,
      s.status === 'between'
        ? h('p', { class: 'game-status' }, `C’était « ${word} » ! ${s.found.length ? `Trouvé par ${s.found.map(nameOf).join(', ')}` : 'Personne n’a trouvé'}`)
        : drawer
          ? h('p', { class: 'game-status' }, 'À dessiner : ', h('b', {}, word))
          : h('div', { class: 'word', 'aria-label': 'Indice' }, (s.hint ?? []).map((c) => h('span', { class: `letter${c === ' ' || c === '-' || c === '’' ? ' gap' : ''}` }, c && c !== ' ' ? c : ''))),
      board.el,
      drawer && s.status === 'drawing' && board.toolbar({ tools: false }),
      drawer && s.status === 'drawing' && button('Passer ce mot', () => play({ action: 'skip' }), { small: true }),
      h(
        'div',
        { class: 'guesses' },
        s.guesses.slice(-8).map((g) =>
          h('div', { class: `guess ${g.result}` }, h('b', {}, nameOf(g.userId)), h('span', { class: 'grow' }, g.text ?? 'a trouvé !'), h('span', { class: 'tag' }, g.result === 'found' ? '+ points' : g.result === 'close' ? 'Presque !' : 'Non')),
        ),
      ),
      !drawer && s.status === 'drawing' && !s.found.includes(session.me.id) && h('div', { class: 'row' }, guessInput, primaryButton('Deviner', guess)),
      !drawer && s.found.includes(session.me.id) && s.status === 'drawing' && h('p', { class: 'game-status ok' }, 'Trouvé ! On attend les autres…'),
    ];
  }

  function paint(strokes) {
    if (!game) return;
    const [name, ic, bg] = gameInfo(game.kind);
    clear(
      head,
      iconButton('back', 'Retour', () => back(`/chat/${game.groupId}`)),
      h('span', { class: 'game-icon', style: { background: bg } }, icon(ic, 22)),
      h('div', { class: 'col grow', style: { gap: 0 } }, h('h1', { class: 'title' }, name), h('span', { class: 'small muted' }, game.status === 'done' ? 'Partie terminée' : game.kind === 'tictactoe' || game.kind === 'connect4' || game.kind === 'rps' ? `Manche ${game.state.round}` : '')),
      game.status === 'playing' &&
        iconButton('close', 'Arrêter la partie', async () => {
          if (!(await confirmDialog('Arrêter la partie ?', 'Elle sera terminée pour tout le monde.', 'Arrêter'))) return;
          await api.quitGame(gameId).catch((e) => err.show(e.message));
          back(`/chat/${game.groupId}`);
        }),
    );
    const s = game.state;
    const parts = {
      tictactoe: () => paintBoardGame(s),
      connect4: () => paintBoardGame(s),
      rps: () => paintRps(s),
      hangman: () => paintHangman(s),
      quiz: () => paintQuiz(s),
      pictionary: () => paintPictionary(s, strokes),
    }[game.kind]();
    const focused = document.activeElement?.getAttribute('aria-label') === 'Ta réponse';
    clear(body, parts, err);
    if (focused) body.querySelector('input[aria-label="Ta réponse"]')?.focus();
  }

  const offs = [
    live.on('game.updated', (e) => {
      if (e.game.id !== gameId) return;
      const newRound = game?.kind === 'pictionary' && e.game.state.strokesVersion !== game.state.strokesVersion;
      game = e.game;
      paint(newRound ? [] : undefined);
    }),
    live.on('live', (e) => {
      if (e.channel !== 'game' || Number(e.data?.gameId) !== gameId || !board) return;
      board.applyRemote(`${e.userId}:${e.data.k}`, e.data);
    }),
    live.on('reconnected', load),
  ];
  // Pictionary's countdown.
  tick = setInterval(() => {
    if (game?.kind === 'pictionary' && game.state.status === 'drawing') {
      const t = body.querySelector('.timer');
      if (t) t.textContent = String(Math.max(0, Math.ceil((game.state.deadline - Date.now()) / 1000)));
    }
  }, 500);
  load();
  return {
    el: screen(h('div', { class: 'scroll' }, head, body)),
    destroy() {
      offs.forEach((off) => off());
      clearInterval(tick);
      stream?.stop();
      board?.destroy();
    },
  };
}

// --- Le récap du mois -------------------------------------------------------------------------------------------

const BADGES = {
  picasso: ['Picasso du mois', 'pencil', '#FFF0B8', (b) => `${b.user.name} · ${b.value} dessin${b.value > 1 ? 's' : ''}`],
  voice: ['Pipelette vocale', 'mic', '#CDEFE0', (b) => `${b.user.name} · vocal le plus long ${duration(b.value)}`],
  gif: ['GIF chouchou', 'gif', '#FFE0E8', (b) => `« ${b.title} » envoyé ${b.value} fois`],
  early: ['Lève-tôt', 'sun', '#FFE3C7', (b) => `${b.user.name} · 1er message à ${Math.floor(b.value / 60)}h${String(b.value % 60).padStart(2, '0')}`],
  chatty: ['Pipelette du clavier', 'text', '#D6E8FF', (b) => `${b.user.name} · ${b.value} messages`],
};

export function recapScreen(groupId, query) {
  let month = query.get('month') || null;
  let data = null;
  const err = errorBox();
  const body = h('div', { class: 'col', style: { gap: '14px' } });

  const shift = (m, d) => {
    const [y, mo] = m.split('-').map(Number);
    const dt = new Date(y, mo - 1 + d, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  };
  const thisMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  async function load() {
    try {
      data = await api.recap(groupId, month);
      month = data.month;
      paint();
    } catch (e) {
      err.show(e.message);
    }
  }

  function paint() {
    const st = data.stats;
    clear(
      body,
      h(
        'div',
        { class: 'recap-hero' },
        h('div', { class: 'row' }, iconButton('back', 'Mois précédent', () => ((month = shift(month, -1)), load())), h('span', { class: 'recap-month grow' }, data.label), iconButton('forward', 'Mois suivant', () => ((month = shift(month, 1)), load()), { disabled: month >= thisMonth() })),
        h('b', { class: 'title' }, st.messages ? 'Quel mois de papotage !' : 'Un mois tout calme'),
      ),
      h(
        'div',
        { class: 'recap-stats' },
        [['messages', st.messages, '#FFE0E8'], ['dessins', st.drawings, '#FFF0B8'], ['vocaux', st.voices, '#CDEFE0']].map(([l, n, bg]) => h('div', { class: 'recap-stat', style: { background: bg } }, h('b', {}, (n ?? 0).toLocaleString('fr-FR')), h('span', {}, l))),
      ),
      data.badges.map((b) => {
        const [title, ic, bg, text] = BADGES[b.kind] ?? ['', 'star', '#EDE6FF', () => ''];
        return h(
          'div',
          { class: 'badge-row' },
          h('span', { class: 'medal', style: { background: bg } }, b.user ? avatar(b.user, 40, { initial: true }) : icon(ic, 24)),
          h('span', { class: 'col grow', style: { gap: 0 } }, h('b', {}, title), h('span', { class: 'small muted' }, text(b))),
          icon(ic, 20),
        );
      }),
      !data.badges.length && h('p', { class: 'muted empty-note' }, 'Pas encore de médailles ce mois-ci.'),
      st.messages > 0 &&
        primaryButton('Partager dans le groupe', async () => {
          try {
            await api.shareRecap(groupId, month);
            back(`/chat/${groupId}`);
          } catch (e) {
            err.show(e.message);
          }
        }, { iconName: 'share' }),
      err,
    );
  }

  load();
  return { el: screen(h('div', { class: 'scroll' }, topBar('Le récap', () => back(`/chat/${groupId}`)), body)) };
}

// --- Décorer la photo -------------------------------------------------------------------------------------------

const FILTERS = [
  ['normal', 'Normal', 'none'],
  ['pastel', 'Pastel', 'saturate(0.75) brightness(1.06)'],
  ['retro', 'Rétro', 'sepia(0.45)'],
  ['nb', 'N&B', 'grayscale(1)'],
];
const CROPS = [['orig', 'Original'], ['square', 'Carré'], ['portrait', '4:5'], ['wide', '16:9']];

export function photoEditScreen(groupId, query) {
  const story = query.get('story') === '1';
  const file = pendingPhoto.file;
  pendingPhoto.file = null;
  if (!file) {
    queueMicrotask(() => back(`/chat/${groupId}`));
    return { el: screen() };
  }
  let img = null;
  let filter = 'normal';
  let crop = 'orig';
  let ephemeral = false;
  let mode = null; // 'draw' while drawing on the photo
  let selected = null;
  let ink = '#FFFFFF';
  const items = []; // { kind: 'text'|'sticker', x, y, s, text, color, key }
  const strokes = []; // [{ color, points: [[x, y]] }] in 0..1
  const err = errorBox();
  const canvas = h('canvas', { class: 'photo-canvas', role: 'img', 'aria-label': 'Photo à décorer' });
  const caption = h('input', { class: 'field', placeholder: story ? 'Un petit mot sur ta story' : 'Ajouter une légende', maxlength: 140, 'aria-label': 'Légende' });
  const toolsEl = h('div', { class: 'photo-tools' });
  const filtersEl = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Filtre' });
  const send = primaryButton(story ? 'Publier la story' : 'Envoyer', null, { iconName: 'send' });
  const ephBtn = h('button', { type: 'button', class: 'eph-btn' });

  function cropRect() {
    const W = img.width;
    const H = img.height;
    const ratio = { square: 1, portrait: 4 / 5, wide: 16 / 9 }[crop];
    if (!ratio) return [0, 0, W, H];
    if (W / H > ratio) {
      const w = H * ratio;
      return [(W - w) / 2, 0, w, H];
    }
    const hh = W / ratio;
    return [0, (H - hh) / 2, W, hh];
  }

  function draw(target = canvas, max = 1200) {
    if (!img) return;
    const [sx, sy, sw, sh] = cropRect();
    const scale = Math.min(1, max / Math.max(sw, sh));
    target.width = Math.round(sw * scale);
    target.height = Math.round(sh * scale);
    const ctx = target.getContext('2d');
    const W = target.width;
    const H = target.height;
    ctx.filter = FILTERS.find((f) => f[0] === filter)[2];
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = W * 0.012;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      ctx.stroke();
    }
    for (const it of items) {
      const size = W * 0.08 * it.s;
      if (it.kind === 'text') {
        ctx.font = `800 ${size}px "Baloo 2", Nunito, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = size * 0.18;
        ctx.strokeStyle = it.color === '#FFFFFF' ? '#2E2442' : '#FFFFFF';
        ctx.strokeText(it.text, it.x * W, it.y * H);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, it.x * W, it.y * H);
      } else {
        const svg = stickerSvg(it.key, 200);
        const data = new XMLSerializer().serializeToString(svg);
        if (!it.img) {
          it.img = new Image();
          it.img.onload = () => draw();
          it.img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
        }
        if (it.img.complete) ctx.drawImage(it.img, it.x * W - size, it.y * H - size, size * 2, size * 2);
      }
      if (target === canvas && it === selected) {
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = '#6A47D6';
        ctx.lineWidth = 3;
        ctx.strokeRect(it.x * W - size * 1.2, it.y * H - size * 1.1, size * 2.4, size * 2.2);
        ctx.restore();
      }
    }
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e);
    canvas.setPointerCapture(e.pointerId);
    if (mode === 'draw') {
      strokes.push({ color: ink, points: [[x, y]] });
      dragging = 'stroke';
      return draw();
    }
    const W = canvas.width;
    const hit = [...items].reverse().find((it) => {
      const size = (0.08 * it.s * W) / canvas.height;
      return Math.abs(it.x - x) < 0.08 * it.s * 1.3 && Math.abs(it.y - y) < size * 1.2;
    });
    selected = hit ?? null;
    if (hit) dragging = { it: hit, dx: x - hit.x, dy: y - hit.y };
    paintTools();
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const [x, y] = pos(e);
    if (dragging === 'stroke') strokes.at(-1).points.push([x, y]);
    else Object.assign(dragging.it, { x: Math.min(1, Math.max(0, x - dragging.dx)), y: Math.min(1, Math.max(0, y - dragging.dy)) });
    draw();
  });
  const up = () => (dragging = null);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  function addText() {
    sheet((close) => {
      const input = h('input', { class: 'field', placeholder: 'Enfin la mer !', maxlength: 60, 'aria-label': 'Texte' });
      let color = '#FFFFFF';
      const colors = h('div', { class: 'inks' });
      const paintC = () => clear(colors, ['#FFFFFF', '#2E2442', '#FF7A93', '#FFD66B', '#4CC38A', '#4A9BEF'].map((c) => h('button', { type: 'button', class: 'ink', style: { backgroundColor: c }, 'aria-pressed': String(c === color), 'aria-label': c, onclick: () => ((color = c), paintC()) })));
      paintC();
      return [
        h('h2', { class: 'title', style: { fontSize: '20px' } }, 'Ajouter du texte'),
        input,
        colors,
        primaryButton('Ajouter', () => {
          if (!input.value.trim()) return;
          const it = { kind: 'text', text: input.value.trim(), color, x: 0.5, y: 0.5, s: 1 };
          items.push(it);
          selected = it;
          close();
          paintTools();
          draw();
        }),
      ];
    });
  }

  function addSticker() {
    sheet((close) => [
      h('h2', { class: 'title', style: { fontSize: '20px' } }, 'Ajouter un sticker'),
      h(
        'div',
        { class: 'gif-grid' },
        STICKERS.map((st) =>
          h('button', { type: 'button', class: 'gif-tile sticker', 'aria-label': st.label, onclick: () => {
            const it = { kind: 'sticker', key: st.key, x: 0.5, y: 0.5, s: 1.2 };
            items.push(it);
            selected = it;
            close();
            paintTools();
            draw();
          } }, stickerSvg(st.key, 64)),
        ),
      ),
    ]);
  }

  function paintTools() {
    clear(
      toolsEl,
      [
        ['text2', 'Aa', 'Ajouter du texte', addText],
        ['sticker', 'Sticker', 'Ajouter un sticker', addSticker],
        ['pencil', 'Dessin', 'Dessiner dessus', () => ((mode = mode === 'draw' ? null : 'draw'), (selected = null), paintTools(), draw())],
        ['crop', CROPS.find((c) => c[0] === crop)[1], 'Recadrer', () => ((crop = CROPS[(CROPS.findIndex((c) => c[0] === crop) + 1) % CROPS.length][0]), draw(), paintTools())],
      ].map(([ic, short, label, fn]) => h('button', { type: 'button', class: 'photo-tool', 'aria-label': label, 'aria-pressed': String(ic === 'pencil' && mode === 'draw'), onclick: fn }, icon(ic, 22), h('span', {}, short))),
      mode === 'draw' &&
        h(
          'div',
          { class: 'inks' },
          ['#FFFFFF', '#2E2442', '#FF7A93', '#FFD66B', '#4CC38A', '#4A9BEF'].map((c) => h('button', { type: 'button', class: 'ink', style: { backgroundColor: c }, 'aria-pressed': String(c === ink), 'aria-label': c, onclick: () => ((ink = c), paintTools()) })),
          iconButton('undo', 'Annuler le dernier trait', () => (strokes.pop(), draw())),
        ),
      selected &&
        h(
          'div',
          { class: 'row' },
          iconButton('close', 'Plus petit', () => ((selected.s = Math.max(0.4, selected.s - 0.2)), draw())),
          iconButton('plus', 'Plus grand', () => ((selected.s = Math.min(4, selected.s + 0.2)), draw())),
          iconButton('trash', 'Retirer', () => (items.splice(items.indexOf(selected), 1), (selected = null), paintTools(), draw())),
        ),
    );
    clear(filtersEl, FILTERS.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === filter), onclick: () => ((filter = k), paintTools(), draw()) }, l)));
    clear(ephBtn, icon('timer', 18), ephemeral ? 'Disparaît en 24 h' : 'Garder');
    ephBtn.classList.toggle('on', ephemeral);
    ephBtn.setAttribute('aria-pressed', String(ephemeral));
  }
  ephBtn.addEventListener('click', () => ((ephemeral = !ephemeral), paintTools()));

  send.addEventListener('click', async () => {
    send.disabled = true;
    selected = null;
    try {
      const out = document.createElement('canvas');
      draw(out, 1600);
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.88));
      if (story) await api.postStory(groupId, blob, caption.value.trim());
      else await api.sendMedia(groupId, 'photo', blob, 'photo.jpg', { width: out.width, height: out.height, ...(caption.value.trim() ? { caption: caption.value.trim() } : {}), ...(ephemeral ? { ephemeral: '1' } : {}) });
      back(`/chat/${groupId}`);
    } catch (e) {
      err.show(e instanceof ApiError ? e.message : `Envoi impossible : ${e.message}`);
      send.disabled = false;
    }
  });

  resizeImage(file, 2000)
    .then(({ blob }) => createImageBitmap(blob))
    .then((bmp) => {
      img = bmp;
      draw();
    })
    .catch(() => err.show('Cette image n’a pas pu être lue'));
  paintTools();

  return {
    el: screen(
      h(
        'div',
        { class: 'scroll', style: { gap: '12px' } },
        h('div', { class: 'row' }, iconButton('close', 'Annuler', () => back(`/chat/${groupId}`)), h('div', { class: 'col grow', style: { gap: 0 } }, h('h1', { class: 'title' }, story ? 'Ma story' : 'Décorer la photo'), h('span', { class: 'small muted' }, story ? 'Visible 24 h par le groupe' : 'Texte, stickers, dessin, filtres'))),
        h('div', { class: 'photo-stage' }, canvas),
        toolsEl,
        filtersEl,
        caption,
        err,
        h('div', { class: 'row' }, !story && ephBtn, h('div', { class: 'grow' }), send),
      ),
    ),
  };
}
