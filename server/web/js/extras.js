import { api } from './api.js';
import { session, go } from './app.js';
import {
  h,
  clear,
  icon,
  iconButton,
  avatar,
  bubu,
  BUBU_LINES,
  confetti,
  STICKERS,
  stickerSvg,
  sheet,
  button,
  primaryButton,
  toggle,
  errorBox,
  timeOf,
  resizeImage,
} from './ui.js';

// Pieces of the chat screen that came with the full mockup: Bubu, stories, pinned messages, banners,
// and the bubbles for polls, positions, GIFs, stickers, games and the monthly recap.

// --- Bubu's mood, from what happens in the group --------------------------------------------------

export function bubuState({ group, messages, liveDraw }) {
  if (group?.birthdaysToday?.length) return 'party';
  if (liveDraw) return 'excited';
  const now = Date.now();
  const recent = messages.filter((m) => m.type !== 'system' && now - m.createdAt < 15 * 60_000);
  const bigVoice = recent.some((m) => m.type === 'voice' && (m.meta?.durationMs ?? 0) > 60_000);
  if (recent.length >= 50 || bigVoice) return 'surprised';
  const last = messages.filter((m) => m.type !== 'system').at(-1);
  if (!last || now - last.createdAt > 60 * 60_000) return 'sleepy';
  return 'happy';
}

export function bubuButton(state, members, group) {
  let line = BUBU_LINES[state];
  if (state === 'party') {
    const names = (group?.birthdaysToday ?? []).map((id) => members.get(id)?.name).filter(Boolean);
    if (names.length) line = `Joyeux anniv ${names.join(' et ')} !`;
  }
  const tip = h('span', { class: 'bubu-tip', role: 'status' });
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'bubu-btn',
      'aria-label': `Bubu, la mascotte : ${line}`,
      onclick: (e) => {
        e.stopPropagation();
        tip.textContent = line;
        tip.classList.add('show');
        if (state === 'party') confetti();
        setTimeout(() => tip.classList.remove('show'), 2500);
      },
    },
    bubu(state, 40),
    tip,
  );
  return btn;
}

// --- stories ----------------------------------------------------------------------------------------

export function storiesBar(groupId, entries, members) {
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const status = h('span', { class: 'small muted' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    pendingPhoto.file = file;
    go(`/photo/${groupId}?story=1`);
  });
  const mine = entries.find((e) => e.user.id === session.me.id);
  const me = members.get(session.me.id) ?? session.me;
  const ring = (on) => `story-ring${on ? ' new' : ''}`;
  const items = [
    h(
      'button',
      {
        type: 'button',
        class: 'story',
        'aria-label': mine ? 'Voir ma story' : 'Ajouter une story (24 h)',
        onclick: () => (mine ? storyViewer(groupId, entries, entries.indexOf(mine)) : input.click()),
      },
      h('span', { class: ring(false) }, avatar(me, 50, { initial: true }), h('span', { class: 'story-add' }, icon('plus', 14, 3))),
      h('span', { class: 'story-name' }, 'Toi'),
    ),
    ...entries
      .filter((e) => e.user.id !== session.me.id)
      .map((e, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'story',
            'aria-label': `${e.user.name} : ${e.unseen ? 'nouvelle story' : 'story déjà vue'}`,
            onclick: () => storyViewer(groupId, entries, entries.indexOf(e)),
          },
          h('span', { class: ring(e.unseen) }, avatar(members.get(e.user.id) ?? e.user, 50, { initial: true })),
          h('span', { class: 'story-name' }, e.user.name),
        ),
      ),
  ];
  if (mine) items.splice(1, 0, h('button', { type: 'button', class: 'story', 'aria-label': 'Ajouter une autre story', onclick: () => input.click() }, h('span', { class: 'story-ring add' }, icon('plus', 22)), h('span', { class: 'story-name' }, 'Ajouter')));
  return h('div', { class: 'stories', role: 'list', 'aria-label': 'Stories du groupe (24 h)' }, items, input, status);
}

function storyViewer(groupId, entries, start) {
  let ei = start;
  let si = 0;
  let timer = null;
  const box = h('div', { class: 'story-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Story' });
  const close = () => {
    clearTimeout(timer);
    box.remove();
    document.removeEventListener('keydown', onKey);
    window.dispatchEvent(new CustomEvent('papote:stories', { detail: groupId }));
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  };
  function next() {
    const e = entries[ei];
    if (si < e.stories.length - 1) si++;
    else if (ei < entries.length - 1) [ei, si] = [ei + 1, 0];
    else return close();
    paint();
  }
  function prev() {
    if (si > 0) si--;
    else if (ei > 0) [ei, si] = [ei - 1, entries[ei - 1].stories.length - 1];
    paint();
  }
  function paint() {
    clearTimeout(timer);
    const e = entries[ei];
    const s = e.stories[si];
    const mineStory = e.user.id === session.me.id;
    if (!mineStory && !s.seen) api.viewStory(s.id).catch(() => {});
    s.seen = true;
    clear(
      box,
      h('div', { class: 'story-bars' }, e.stories.map((_, i) => h('span', { class: i < si ? 'done' : i === si ? 'now' : '' }))),
      h(
        'div',
        { class: 'story-top' },
        avatar(e.user, 36, { initial: true }),
        h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, mineStory ? 'Toi' : e.user.name), h('span', { class: 'small' }, `${timeOf(s.createdAt)} · encore ${Math.max(1, Math.round((s.expiresAt - Date.now()) / 3_600_000))} h`)),
        mineStory &&
          iconButton('trash', 'Supprimer cette story', async () => {
            await api.deleteStory(s.id).catch(() => {});
            e.stories.splice(si, 1);
            if (!e.stories.length) return close();
            si = Math.min(si, e.stories.length - 1);
            paint();
          }),
        iconButton('close', 'Fermer', close),
      ),
      h('img', { src: s.url, alt: s.caption || `Story de ${e.user.name}` }),
      s.caption && h('p', { class: 'story-caption' }, s.caption),
      mineStory && h('p', { class: 'story-views' }, icon('eye', 16), s.viewers?.length ? `Vue par ${s.viewers.map((v) => v.name).join(', ')}` : 'Pas encore vue'),
      h('button', { type: 'button', class: 'story-prev', 'aria-label': 'Story précédente', onclick: prev }),
      h('button', { type: 'button', class: 'story-next', 'aria-label': 'Story suivante', onclick: next }),
    );
    timer = setTimeout(next, 6000);
  }
  document.addEventListener('keydown', onKey);
  document.body.append(box);
  paint();
}

// A picked picture travels to the photo editor through here (files can't go in the URL).
export const pendingPhoto = { file: null };

// --- banners above the messages ----------------------------------------------------------------------

export function pinBanner(groupId, pins, members) {
  if (!pins.length) return null;
  const p = pins[0];
  const who = members.get(p.authorId)?.name ?? '';
  const text = p.type === 'text' || p.type === 'poll' ? p.text : { photo: 'Photo', drawing: 'Dessin', voice: 'Vocal', location: 'Position', gif: 'GIF' }[p.type] ?? 'Message';
  return h(
    'button',
    { type: 'button', class: 'pin-banner', onclick: () => go(`/search/${groupId}`), 'aria-label': `Message épinglé${who ? ` de ${who}` : ''} : ${text}. Voir les épinglés` },
    icon('pin', 16),
    h('b', {}, 'Épinglé :'),
    h('span', { class: 'ellipsis' }, text),
    pins.length > 1 && h('span', { class: 'count' }, `+${pins.length - 1}`),
  );
}

export function birthdayBanner(group, members) {
  const names = (group?.birthdaysToday ?? []).map((id) => (id === session.me.id ? 'toi' : members.get(id)?.name)).filter(Boolean);
  if (!names.length) return null;
  return h(
    'button',
    { type: 'button', class: 'bday-banner', onclick: () => confetti() },
    h('span', { class: 'bday-confetti', 'aria-hidden': 'true' }),
    icon('cake', 28),
    h('span', { class: 'col', style: { gap: 0 } }, h('b', {}, `Joyeux anniversaire ${names.join(' et ')} !`), h('span', { class: 'small' }, 'Tape pour lancer les confettis')),
  );
}

export function liveDrawBanner(groupId, s, members) {
  if (!s) return null;
  const who = members.get(s.startedBy)?.name ?? 'Quelqu’un';
  return h(
    'button',
    { type: 'button', class: 'live-banner', onclick: () => go(`/live/${groupId}`) },
    icon('palette', 20),
    h('span', { class: 'grow' }, `${who} a lancé une toile commune`),
    h('b', {}, 'Rejoindre'),
  );
}

export function pendingBanner(groupId, pending) {
  if (!pending.length) return null;
  return h(
    'button',
    { type: 'button', class: 'live-banner pending', onclick: () => go(`/members/${groupId}`) },
    icon('personPlus', 20),
    h('span', { class: 'grow' }, pending.length === 1 ? `${pending[0].name} veut rejoindre le groupe` : `${pending.length} personnes veulent rejoindre le groupe`),
    h('b', {}, 'Voir'),
  );
}

// --- bubbles ------------------------------------------------------------------------------------------

/** "d’Inès", "de Lou". */
export const of = (name) => (/^[aeiouyhéèêàâîïôû]/i.test(name) ? `d’${name}` : `de ${name}`);

export function pollBubble(m, members, onError) {
  const options = m.meta?.options ?? [];
  const votes = m.votes ?? {};
  const voters = new Set(Object.values(votes).flat());
  const total = voters.size;
  const mine = Object.entries(votes).filter(([, ids]) => ids.includes(session.me.id)).map(([o]) => Number(o));
  const author = members.get(m.authorId)?.name ?? 'quelqu’un';
  const closed = !!m.meta?.closed;
  const canClose = !closed && (m.authorId === session.me.id || ['owner', 'admin'].includes(members.get(session.me.id)?.role));
  async function vote(i) {
    let next = mine.includes(i) ? mine.filter((x) => x !== i) : m.meta.multiple ? [...mine, i] : [i];
    try {
      await api.vote(m.id, next);
    } catch (e) {
      onError(e.message);
    }
  }
  return h(
    'div',
    { class: 'bubble poll' },
    h('div', { class: 'poll-head' }, icon('poll', 18), h('span', {}, `Sondage ${m.authorId === session.me.id ? 'de toi' : of(author)} · ${total} vote${total > 1 ? 's' : ''}${closed ? ' · terminé' : ''}`)),
    h('b', { class: 'poll-q' }, m.text),
    options.map((label, i) => {
      const n = (votes[i] ?? []).length;
      const pct = total ? Math.round((n * 100) / total) : 0;
      const on = mine.includes(i);
      return h(
        'button',
        {
          type: 'button',
          class: `poll-opt${on ? ' on' : ''}`,
          'aria-pressed': String(on),
          disabled: closed,
          title: (votes[i] ?? []).map((id) => members.get(id)?.name ?? '?').join(', '),
          onclick: () => vote(i),
        },
        h('span', { class: 'poll-bar', style: { width: `${pct}%`, background: i % 2 ? '#FFE0E8' : '#E6DDFB' } }),
        h('span', { class: 'poll-label' }, `${label}${on ? ' (ton vote)' : ''}`),
        h('span', { class: 'poll-pct' }, `${pct} %`),
      );
    }),
    m.meta?.multiple && h('span', { class: 'small muted' }, 'Plusieurs réponses possibles'),
    canClose && h('button', { type: 'button', class: 'link-btn small', onclick: () => api.closePoll(m.id).catch((e) => onError(e.message)) }, 'Terminer le sondage'),
  );
}

/** A maps app link: nothing is sent anywhere until the person taps it. */
export function mapsLink(lat, lon) {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return `geo:${lat},${lon}?q=${lat},${lon}`;
  if (/iPhone|iPad|Macintosh/.test(ua)) return `https://maps.apple.com/?q=${lat},${lon}&ll=${lat},${lon}`;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

function ago(ts) {
  const mins = Math.round((Date.now() - ts) / 60_000);
  return mins < 1 ? 'à l’instant' : mins < 60 ? `il y a ${mins} min` : `il y a ${Math.round(mins / 60)} h`;
}

export function locationBubble(m) {
  const { lat, lon, accuracy, until, updatedAt } = m.meta ?? {};
  const liveNow = until && until > Date.now();
  const mine = m.authorId === session.me.id;
  return h(
    'div',
    { class: 'bubble location' },
    h('div', { class: 'loc-card', 'aria-hidden': 'true' }, h('span', { class: 'loc-pin' }, icon('location', 30))),
    h(
      'div',
      { class: 'col', style: { gap: '2px' } },
      h('b', {}, m.text || 'Ma position'),
      h(
        'span',
        { class: 'small muted' },
        liveNow ? `En direct jusqu’à ${timeOf(until)} · mise à jour ${ago(updatedAt ?? m.createdAt)}` : until ? 'Partage terminé' : `Envoyée à ${timeOf(m.createdAt)}`,
      ),
      h('span', { class: 'small muted' }, `${lat?.toFixed(4)}, ${lon?.toFixed(4)}${accuracy ? ` · à ${accuracy < 1000 ? `${accuracy} m` : `${(accuracy / 1000).toFixed(1)} km`} près` : ''}`),
    ),
    h('a', { class: 'btn small', href: mapsLink(lat, lon), target: '_blank', rel: 'noopener noreferrer' }, icon('location', 18), 'Ouvrir dans mon appli de cartes'),
    mine && liveNow && h('button', { type: 'button', class: 'link-btn small', onclick: () => stopSharing(m.id) }, 'Arrêter le partage'),
  );
}

export function gifBubble(m, onOpen) {
  const w = m.meta?.width ?? 200;
  const hh = m.meta?.height ?? 150;
  const img = h('img', { src: m.media?.url, alt: m.meta?.title ? `GIF « ${m.meta.title} »` : 'GIF', loading: 'lazy', style: { aspectRatio: `${w} / ${hh}` } });
  img.addEventListener('click', onOpen);
  return h('div', { class: 'bubble media gif' }, img, h('span', { class: 'meta' }, icon('gif', 14), `GIF · ${timeOf(m.createdAt)}`));
}

export function stickerBubble(m) {
  if (m.meta?.builtin) return h('div', { class: 'bubble sticker' }, stickerSvg(m.meta.builtin, 110));
  return h('div', { class: 'bubble sticker' }, h('img', { src: m.media?.url, alt: 'Sticker', loading: 'lazy' }));
}

const GAME_INFO = {
  tictactoe: ['Morpion', 'grid', '#EDE6FF'],
  connect4: ['Puissance 4', 'grid', '#FFE0E8'],
  rps: ['Chifoumi', 'thumb', '#FFE3C7'],
  hangman: ['Pendu', 'text2', '#DDF4E9'],
  quiz: ['Qui a dit ça ?', 'chatPlus', '#D6E8FF'],
  pictionary: ['Pictionary', 'pencil', '#FFF0B8'],
};
export const gameInfo = (kind) => GAME_INFO[kind] ?? ['Jeu', 'game', '#EDE6FF'];

export function gameBubble(m, members) {
  const [name, ic, bg] = gameInfo(m.meta?.kind);
  const who = m.authorId === session.me.id ? 'Tu as' : `${members.get(m.authorId)?.name ?? 'Quelqu’un'} a`;
  const vs = m.meta?.opponentId ? (m.meta.opponentId === session.me.id ? ' contre toi' : ` contre ${members.get(m.meta.opponentId)?.name ?? '?'}`) : '';
  return h(
    'button',
    { type: 'button', class: 'bubble game-card', style: { background: bg }, onclick: () => go(`/game/${m.meta.gameId}`) },
    h('span', { class: 'game-icon' }, icon(ic, 24)),
    h('span', { class: 'col', style: { gap: 0, textAlign: 'left' } }, h('b', {}, name), h('span', { class: 'small' }, `${who} lancé une partie${vs}`)),
    h('span', { class: 'btn small primary' }, 'Jouer'),
  );
}

export function recapBubble(m) {
  const r = m.meta ?? {};
  return h(
    'button',
    { type: 'button', class: 'bubble recap-card', onclick: () => go(`/recap/${m.groupId}?month=${r.month}`) },
    h('span', { class: 'recap-month' }, r.label ?? ''),
    h('b', {}, 'Le récap du mois'),
    h(
      'span',
      { class: 'recap-mini' },
      [['messages', r.stats?.messages], ['dessins', r.stats?.drawings], ['vocaux', r.stats?.voices]].map(([l, n]) => h('span', {}, h('b', {}, String(n ?? 0)), ` ${l}`)),
    ),
  );
}

// --- voice: speed, filters and the transcript --------------------------------------------------------

export const VOICE_FILTERS = [
  ['', 'Normale', 'mic'],
  ['souris', 'Souris', 'smile'],
  ['robot', 'Robot', 'game'],
  ['echo', 'Écho', 'music'],
  ['geant', 'Géant', 'house'],
];

/** Plays voice messages through Web Audio so the sender's filter (Souris, Robot…) is applied. */
export function createVoiceEngine(audio) {
  let ctx = null;
  let src = null;
  let nodes = [];
  function graph(filter) {
    try {
      ctx ??= new AudioContext();
      src ??= ctx.createMediaElementSource(audio);
    } catch {
      return;
    }
    src.disconnect();
    nodes.forEach((n) => {
      try {
        n.disconnect();
        n.stop?.();
      } catch {
        /* already stopped */
      }
    });
    nodes = [];
    if (filter === 'robot') {
      const ring = ctx.createGain();
      ring.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = 55;
      osc.connect(ring.gain);
      osc.start();
      src.connect(ring).connect(ctx.destination);
      nodes = [ring, osc];
    } else if (filter === 'echo') {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.22;
      const fb = ctx.createGain();
      fb.gain.value = 0.42;
      src.connect(ctx.destination);
      src.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(ctx.destination);
      nodes = [delay, fb];
    } else {
      src.connect(ctx.destination);
    }
    ctx.resume?.();
  }
  return {
    prepare(filter, speed) {
      const pitch = filter === 'souris' ? 1.45 : filter === 'geant' ? 0.72 : 1;
      audio.preservesPitch = pitch === 1;
      audio.playbackRate = pitch * speed;
      if (filter === 'robot' || filter === 'echo' || src) graph(filter);
    },
  };
}

// --- live position ---------------------------------------------------------------------------------------

const sharing = new Map(); // messageId -> { watch, until, last }

function stopSharing(messageId) {
  const s = sharing.get(messageId);
  if (s) navigator.geolocation.clearWatch(s.watch);
  sharing.delete(messageId);
  api.stopLocation(messageId).catch(() => {});
}

function keepSharing(message) {
  const until = message.meta?.until;
  if (!until || !navigator.geolocation) return;
  const watch = navigator.geolocation.watchPosition(
    (p) => {
      const s = sharing.get(message.id);
      if (!s) return;
      if (Date.now() > until) return stopSharing(message.id);
      if (Date.now() - s.last < 20_000) return;
      s.last = Date.now();
      api.moveLocation(message.id, { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }).catch(() => stopSharing(message.id));
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 15_000 },
  );
  sharing.set(message.id, { watch, until, last: Date.now() });
}

export function locationSheet(groupId, onError) {
  if (!navigator.geolocation) return onError('Ton navigateur ne donne pas la position');
  sheet((close) => {
    let minutes = 0;
    const label = h('input', { class: 'field', value: 'Je suis là !', maxlength: 80, 'aria-label': 'Petit mot' });
    const err = errorBox();
    const choices = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Durée du partage' });
    const paint = () =>
      clear(
        choices,
        [[0, 'Une fois'], [15, '15 min'], [60, '1 h'], [480, '8 h']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === minutes), onclick: () => ((minutes = v), paint()) }, l)),
      );
    paint();
    const send = primaryButton('Envoyer ma position', async () => {
      send.disabled = true;
      err.show(null);
      navigator.geolocation.getCurrentPosition(
        async (p) => {
          try {
            const m = await api.sendLocation(groupId, { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), minutes, label: label.value.trim() });
            if (minutes) keepSharing(m);
            close();
          } catch (e) {
            err.show(e.message);
            send.disabled = false;
          }
        },
        () => {
          err.show('Position refusée ou introuvable : autorise-la dans les réglages du navigateur');
          send.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 15_000 },
      );
    }, { iconName: 'location' });
    return [
      h('h2', { class: 'title', style: { fontSize: '20px' } }, 'Partager ma position'),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Seules les coordonnées sont envoyées, sur ton serveur. Pas de carte : chacun ouvre sa propre appli de cartes s’il le souhaite.'),
      label,
      h('span', { class: 'label' }, 'Partager'),
      choices,
      h('span', { class: 'small muted' }, 'En direct, la position se met à jour tant que Papote reste ouvert sur cet appareil.'),
      err,
      send,
    ];
  });
}

// --- polls -------------------------------------------------------------------------------------------

export function pollSheet(groupId) {
  sheet((close) => {
    const question = h('input', { class: 'field', placeholder: 'Ciné samedi ou dimanche ?', maxlength: 200, 'aria-label': 'Question' });
    const list = h('div', { class: 'col', style: { gap: '8px' } });
    const options = ['', ''];
    let multiple = false;
    const err = errorBox();
    const paint = () =>
      clear(
        list,
        options.map((v, i) =>
          h(
            'div',
            { class: 'row' },
            h('input', { class: 'field grow', value: v, placeholder: `Réponse ${i + 1}`, maxlength: 80, 'aria-label': `Réponse ${i + 1}`, oninput: (e) => (options[i] = e.target.value) }),
            options.length > 2 && iconButton('close', `Retirer la réponse ${i + 1}`, () => (options.splice(i, 1), paint())),
          ),
        ),
        options.length < 6 && button('Ajouter une réponse', () => (options.push(''), paint(), list.querySelectorAll('input')[options.length - 1]?.focus()), { iconName: 'plus', small: true }),
      );
    paint();
    const send = primaryButton('Envoyer le sondage', async () => {
      const opts = options.map((o) => o.trim()).filter(Boolean);
      if (!question.value.trim() || opts.length < 2) return err.show('Une question et au moins deux réponses');
      send.disabled = true;
      try {
        await api.sendPoll(groupId, question.value.trim(), opts, multiple);
        close();
      } catch (e) {
        err.show(e.message);
        send.disabled = false;
      }
    }, { iconName: 'send' });
    return [
      h('h2', { class: 'title', style: { fontSize: '20px' } }, 'Nouveau sondage'),
      question,
      list,
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Plusieurs réponses possibles'), toggle(false, (v) => (multiple = v), 'Plusieurs réponses possibles')),
      err,
      send,
    ];
  });
}

// --- GIF and stickers ---------------------------------------------------------------------------------------

export function gifSheet(groupId, { features, onError }) {
  sheet((close) => {
    let tab = features.gifs ? 'gif' : 'stickers';
    let favs = [];
    let groupStickers = [];
    let query = '';
    let searchTimer = null;
    const grid = h('div', { class: 'gif-grid' });
    const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'GIF et stickers' });
    const search = h('input', { class: 'field', type: 'search', placeholder: 'Rechercher', 'aria-label': 'Rechercher un GIF' });
    const err = errorBox();
    const isFav = (kind, ref) => favs.some((f) => f.kind === kind && f.ref === String(ref));

    async function toggleFav(kind, ref, data) {
      try {
        if (isFav(kind, ref)) await api.removeFavorite(kind, ref);
        else await api.addFavorite(kind, ref, data);
        favs = await api.favorites();
        paint();
      } catch (e) {
        err.show(e.message);
      }
    }

    const send = async (fn) => {
      close();
      try {
        await fn();
      } catch (e) {
        onError(e.message);
      }
    };

    const star = (kind, ref, data) =>
      h(
        'button',
        { type: 'button', class: `fav${isFav(kind, ref) ? ' on' : ''}`, 'aria-pressed': String(isFav(kind, ref)), 'aria-label': isFav(kind, ref) ? 'Retirer des favoris' : 'Ajouter aux favoris', onclick: (e) => (e.stopPropagation(), toggleFav(kind, ref, data)) },
        icon('star', 16),
      );

    const gifTile = (g) =>
      h(
        'div',
        { class: 'gif-tile' },
        h('button', { type: 'button', class: 'gif-pick', 'aria-label': `Envoyer le GIF ${g.title || ''}`, onclick: () => send(() => api.sendGif(groupId, g.id)) }, h('img', { src: g.preview, alt: g.title || 'GIF', loading: 'lazy' })),
        star('gif', g.id, { title: g.title, width: g.width, height: g.height }),
      );
    const builtinTile = (st) =>
      h(
        'div',
        { class: 'gif-tile sticker' },
        h('button', { type: 'button', class: 'gif-pick', 'aria-label': `Envoyer le sticker ${st.label}`, onclick: () => send(() => api.sendSticker(groupId, { builtin: st.key })) }, stickerSvg(st.key, 72)),
        star('builtin', st.key),
      );
    const groupTile = (s) =>
      h(
        'div',
        { class: 'gif-tile sticker' },
        h('button', { type: 'button', class: 'gif-pick', 'aria-label': 'Envoyer ce sticker', onclick: () => send(() => api.sendSticker(groupId, { stickerId: s.id })) }, h('img', { src: s.url, alt: 'Sticker du groupe', loading: 'lazy' })),
        star('sticker', s.id),
      );

    async function paint() {
      clear(
        tabs,
        [['favs', 'Favoris'], ['gif', 'GIF'], ['stickers', 'Stickers'], ['group', 'Du groupe']].map(([k, l]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), 'aria-pressed': String(k === tab), onclick: () => ((tab = k), paint()) }, l),
        ),
      );
      search.hidden = tab !== 'gif';
      if (tab === 'favs') {
        clear(
          grid,
          favs.length
            ? favs.map((f) => (f.kind === 'gif' ? gifTile({ id: f.ref, ...f.data }) : f.kind === 'builtin' ? builtinTile(STICKERS.find((s) => s.key === f.ref) ?? STICKERS[0]) : groupTile(f.data)))
            : h('p', { class: 'muted empty-note' }, 'Touche l’étoile d’un GIF ou d’un sticker pour le retrouver ici.'),
        );
      } else if (tab === 'stickers') {
        clear(grid, STICKERS.map(builtinTile));
      } else if (tab === 'group') {
        const upload = h('input', { type: 'file', accept: 'image/png,image/webp,image/gif,image/jpeg', hidden: true });
        upload.addEventListener('change', async () => {
          const f = upload.files?.[0];
          if (!f) return;
          try {
            const img = await resizeImage(f, 512);
            await api.uploadSticker(groupId, img.blob);
            groupStickers = await api.stickers(groupId);
            paint();
          } catch (e) {
            err.show(e.message);
          }
        });
        clear(
          grid,
          groupStickers.map(groupTile),
          h(
            'div',
            { class: 'col', style: { gridColumn: '1 / -1', gap: '8px' } },
            h('p', { class: 'small muted', style: { margin: 0 } }, 'Pour créer un sticker depuis un dessin : ouvre le dessin dans la discussion, puis « En faire un sticker ».'),
            button('Importer une image', () => upload.click(), { iconName: 'image', small: true }),
            upload,
          ),
        );
      } else if (!features.gifs) {
        clear(grid, h('p', { class: 'muted empty-note' }, 'Les GIF ne sont pas activés sur ce serveur (clé GIPHY à ajouter par l’admin).'));
      } else {
        clear(grid, h('p', { class: 'muted empty-note' }, 'Chargement…'));
        try {
          const list = query ? await api.gifsSearch(query) : await api.gifsTrending();
          if (tab === 'gif') clear(grid, list.length ? list.map(gifTile) : h('p', { class: 'muted empty-note' }, 'Aucun GIF trouvé'));
        } catch (e) {
          clear(grid, h('p', { class: 'muted empty-note' }, e.message));
        }
      }
    }

    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = search.value.trim();
        paint();
      }, 350);
    });
    Promise.all([api.favorites(), api.stickers(groupId)])
      .then(([f, s]) => {
        favs = f;
        groupStickers = s;
        paint();
      })
      .catch(() => paint());
    paint();
    return [
      tabs,
      search,
      grid,
      err,
      features.gifs && h('p', { class: 'small muted', style: { margin: 0, textAlign: 'center' } }, 'Powered by GIPHY · via ton serveur'),
    ];
  });
}

// --- the "+" tray of the composer --------------------------------------------------------------------------

export function extrasTray(items) {
  return h(
    'div',
    { class: 'extras-tray', role: 'menu' },
    items.map(([ic, label, bg, fn]) => h('button', { type: 'button', role: 'menuitem', onclick: fn }, h('span', { class: 'extra-icon', style: { background: bg } }, icon(ic, 22)), label)),
  );
}
