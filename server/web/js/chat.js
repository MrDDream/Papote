import { api, live, ApiError } from './api.js';
import { session, go, back } from './app.js';
import {
  h,
  clear,
  icon,
  iconButton,
  avatar,
  groupAvatar,
  lastSeen,
  tint,
  surfaceOf,
  nameColor,
  dayLabel,
  sameDay,
  timeOf,
  duration,
  systemText,
  sheet,
  lightbox,
  resizeImage,
  REACTIONS,
  reactionOf,
} from './ui.js';
import { emojiPicker, isEmojiOnly, QUICK_REACTIONS } from './emoji.js';
import { clearNotifications } from './push.js';
import {
  bubuState,
  bubuButton,
  storiesBar,
  pinBanner,
  birthdayBanner,
  liveDrawBanner,
  pendingBanner,
  pollBubble,
  locationBubble,
  gifBubble,
  stickerBubble,
  gameBubble,
  recapBubble,
  createVoiceEngine,
  VOICE_FILTERS,
  locationSheet,
  pollSheet,
  gifSheet,
  pendingPhoto,
} from './extras.js';

let serverFeatures = null; // { gifs, transcription }, asked once
const SPEEDS = [1, 1.5, 2];
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

const coarse = matchMedia('(pointer: coarse)').matches;

export function chatScreen(groupId, query = new URLSearchParams()) {
  let group = null;
  let members = new Map();
  let messages = [];
  let reachedStart = false;
  let reachedEnd = true; // false while looking at older messages (a search result, a pinned message)
  let loadingOlder = false;
  let loadingNewer = false;
  let highlight = Number(query.get('at')) || null;
  let pins = [];
  let stories = [];
  let liveSession = null;
  let pending = [];
  let features = serverFeatures ?? { gifs: false, transcription: false };
  let lastBubu = null;
  let speed = Number(pref('papote.voiceSpeed', '1')) || 1;
  const transcriptsOpen = new Set();
  let lastRead = 0;
  let lastTyping = 0;
  let uploads = 0;
  const typing = new Map(); // userId -> { kind, until }

  // --- layout -------------------------------------------------------------------
  const head = h('div', { class: 'chat-head' });
  const extrasBar = h('div', { class: 'chat-extras' });
  const list = h('div', { class: 'messages', role: 'log', 'aria-label': 'Messages' });
  const jumpBtn = h('button', { type: 'button', class: 'jump-btn', hidden: true, onclick: () => backToLatest() }, icon('back', 16), 'Revenir aux derniers messages');
  const typingRow = h('div', { 'aria-live': 'polite' });
  const status = h('div', { class: 'status-line', role: 'status' });
  const composer = h('div');
  const pickerSlot = h('div');
  const el = h('div', { class: 'screen chat' }, head, extrasBar, list, jumpBtn, status, composer, pickerSlot);
  const isAdmin = () => ['owner', 'admin'].includes(group?.role);
  const talkie = () => pref(`papote.talkie.${groupId}`, '0') === '1';

  function renderExtras() {
    clear(
      extrasBar,
      storiesBar(groupId, stories, members),
      pinBanner(groupId, pins, members),
      birthdayBanner(group, members),
      liveDrawBanner(groupId, liveSession, members),
      isAdmin() && pendingBanner(groupId, pending),
    );
    list.dataset.pattern = group?.settings?.pattern ?? 'none';
  }

  function refreshBubu() {
    const state = bubuState({ group, messages, liveDraw: !!liveSession });
    if (state !== lastBubu) renderHead();
  }

  function renderHead() {
    lastBubu = bubuState({ group, messages, liveDraw: !!liveSession });
    const t = tint(group?.color);
    head.style.background = surfaceOf(t);
    const online = [...members.values()].filter((m) => m.online).length;
    clear(
      head,
      iconButton('back', 'Retour aux groupes', () => back('/groups'), { cls: 'back-btn' }),
      h(
        'button',
        { type: 'button', class: 'who', onclick: () => go(`/members/${groupId}`), 'aria-label': `${group?.name ?? ''}, réglages` },
        groupAvatar(group, 44),
        h(
          'div',
          { class: 'col', style: { gap: 0, minWidth: 0 } },
          h('h1', { class: 'title ellipsis', style: { fontSize: '21px' } }, group?.name ?? '…'),
          h(
            'span',
            { class: 'small muted' },
            group?.direct
              ? (members.get(group.peer?.id) ? lastSeen(members.get(group.peer.id)) : 'Discussion')
              : `${members.size} membre${members.size > 1 ? 's' : ''} · ${online} en ligne`,
          ),
        ),
      ),
      bubuButton(lastBubu, members, group),
      h(
        'div',
        { class: 'head-actions' },
        iconButton('search', 'Rechercher dans la discussion', () => go(`/search/${groupId}`)),
        iconButton('grid', 'Galerie du groupe', () => go(`/gallery/${groupId}`)),
        iconButton('settings', group?.direct ? 'Réglages de la discussion' : 'Réglages du groupe et invitations', () => go(`/settings/${groupId}`)),
      ),
    );
  }

  // --- messages -----------------------------------------------------------------
  const voiceViews = new Map(); // messageId -> { button, bars }

  function nearBottom() {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  }

  function renderMessages({ stick = nearBottom(), keepOffsetFrom = null } = {}) {
    voiceViews.clear();
    const nodes = [];
    if (loadingOlder) nodes.push(h('div', { class: 'system' }, 'Chargement…'));
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      if (!prev || !sameDay(prev.createdAt, m.createdAt)) nodes.push(h('div', { class: 'day' }, dayLabel(m.createdAt)));
      nodes.push(messageNode(m, prev, next));
    });
    if (!reachedEnd) nodes.push(h('div', { class: 'system' }, loadingNewer ? 'Chargement…' : ''));
    nodes.push(typingRow);
    clear(list, nodes);
    jumpBtn.hidden = reachedEnd;
    if (keepOffsetFrom != null) list.scrollTop = list.scrollHeight - keepOffsetFrom;
    else if (highlight) {
      const target = list.querySelector(`[data-id="${highlight}"]`);
      target?.scrollIntoView({ block: 'center' });
      target?.classList.add('flash');
      highlight = null;
    } else if (stick) list.scrollTop = list.scrollHeight;
    refreshBubu();
  }

  function messageNode(m, prev, next) {
    if (m.type === 'system') return h('div', { class: 'system' }, systemText(m, members.get(m.meta?.userId)?.name));
    const author = members.get(m.authorId);
    const mine = m.authorId === session.me.id;
    const t = tint(author?.color ?? 'lilas');
    const continued = prev && prev.authorId === m.authorId && prev.type !== 'system' && sameDay(prev.createdAt, m.createdAt);
    const lastOfRun = !next || next.authorId !== m.authorId || next.type === 'system';

    let bubble;
    if (m.deleted) bubble = h('div', { class: 'bubble deleted' }, 'Message supprimé');
    else if (m.type === 'text') bubble = h('div', { class: `bubble text${isEmojiOnly(m.text) ? ' big-emoji' : ''}` }, isEmojiOnly(m.text) ? m.text.trim() : m.text);
    else if (m.type === 'photo' || m.type === 'drawing') {
      const label = `${m.type === 'drawing' ? 'Dessin' : 'Photo'} de ${author?.name ?? 'quelqu’un'}`;
      const ratio = Math.min(1.8, Math.max(0.6, (m.meta?.width ?? 4) / (m.meta?.height ?? 3)));
      const img = h('img', { src: m.media?.url, alt: label, loading: 'lazy', style: { aspectRatio: String(ratio), background: m.type === 'drawing' ? '#FFF8E6' : '' } });
      // A drawing opens its page (timelapse, "Dessiner dessus", sticker); a photo opens big.
      img.addEventListener('click', () => (m.type === 'drawing' ? go(`/drawing/${m.id}?g=${groupId}`) : lightbox(m.media.url, label)));
      const hours = m.expiresAt ? Math.max(1, Math.round((m.expiresAt - Date.now()) / 3_600_000)) : 0;
      bubble = h(
        'div',
        { class: 'bubble media' },
        img,
        m.text && h('span', { style: { padding: '0 4px' } }, m.text),
        h(
          'span',
          { class: 'meta' },
          icon(m.type === 'drawing' ? 'pencil' : 'photo', 14),
          `${m.type === 'drawing' ? (m.meta?.live ? 'Toile commune' : 'Dessin') : 'Photo'} · ${timeOf(m.createdAt)}`,
          hours > 0 && h('span', { class: 'ephemeral' }, icon('timer', 13), `disparaît dans ${hours} h`),
        ),
      );
    } else if (m.type === 'voice') bubble = voiceNode(m, t);
    else if (m.type === 'poll') bubble = pollBubble(m, members, renderStatus);
    else if (m.type === 'location') bubble = locationBubble(m);
    else if (m.type === 'gif') bubble = gifBubble(m, () => lightbox(m.media.url, m.meta?.title ? `GIF « ${m.meta.title} »` : 'GIF'));
    else if (m.type === 'sticker') bubble = stickerBubble(m);
    else if (m.type === 'game') bubble = gameBubble(m, members);
    else if (m.type === 'recap') bubble = recapBubble(m);
    else bubble = h('div', { class: 'bubble' }, m.text);
    if (!m.deleted) bubble.title = timeOf(m.createdAt);
    attachLongPress(bubble, () => openActions(m));

    const reactions = Object.entries(m.reactions ?? {});
    return h(
      'div',
      { class: `msg${mine ? ' mine' : ''}`, 'data-id': m.id, style: { marginTop: continued ? '0' : '6px' } },
      !mine && (lastOfRun ? avatar(author ?? { name: '?', color: 'lilas' }, 32, { initial: true }) : h('span', { class: 'spacer' })),
      h(
        'div',
        { class: 'stack' },
        !mine && !continued && h('span', { class: 'author', style: { color: nameColor(t) } }, author?.name ?? 'Ancien membre'),
        bubble,
        m.pinnedAt && h('span', { class: 'pinned-mark' }, icon('pin', 12), 'Épinglé'),
        reactions.length > 0 &&
          h(
            'div',
            { class: 'reactions' },
            reactions.map(([kind, users]) => {
              const r = reactionOf(kind);
              const on = users.includes(session.me.id);
              return h(
                'button',
                {
                  type: 'button',
                  class: `chip${r ? '' : ' emoji'}${on ? ' on' : ''}`,
                  style: r ? { background: r.bg, color: r.fg } : {},
                  'aria-label': `${r?.label ?? kind} : ${users.length}${on ? ', dont toi (retirer)' : ''}`,
                  title: users.map((u) => members.get(u)?.name ?? '?').join(', '),
                  onclick: () => react(m, kind),
                },
                r ? icon(r.icon, 13) : kind,
                String(users.length),
              );
            }),
          ),
      ),
    );
  }

  function voiceNode(m, t) {
    const bars = (m.meta?.waveform?.length ? m.meta.waveform : Array.from({ length: 24 }, (_, i) => 30 + ((i * 37) % 50))).slice(0, 28);
    const barEls = bars.map((v) => h('span', { style: { height: `${6 + (v * 26) / 100}px`, background: t.tint } }));
    const btn = h('button', { type: 'button', class: 'play', style: { background: t.tint }, 'aria-label': 'Écouter le vocal', onclick: () => player.toggle(m) }, icon('play', 18));
    voiceViews.set(m.id, { btn, bars: barEls, t });
    const speedBtn = h('button', { type: 'button', class: 'speed', 'aria-label': `Vitesse de lecture ×${String(speed).replace('.', ',')}, changer`, onclick: () => cycleSpeed() }, `×${String(speed).replace('.', ',')}`);
    const filter = VOICE_FILTERS.find(([k]) => k && k === m.meta?.filter);
    const open = transcriptsOpen.has(m.id);
    const node = h(
      'div',
      { class: 'bubble voice-wrap' },
      h('div', { class: 'voice' }, btn, h('div', { class: 'wave', 'aria-hidden': 'true' }, barEls), h('span', { class: 'small muted', style: { fontWeight: 800 } }, duration(m.meta?.durationMs)), speedBtn),
      (filter || m.meta?.transcript || m.meta?.transcribing) &&
        h(
          'div',
          { class: 'voice-extra' },
          filter && h('span', { class: 'chip-mini' }, icon(filter[2], 12), `Voix ${filter[1].toLowerCase()}`),
          m.meta?.transcribing && h('span', { class: 'small muted' }, 'Transcription…'),
          m.meta?.transcript &&
            h(
              'button',
              { type: 'button', class: 'link-btn small', 'aria-expanded': String(open), onclick: () => (open ? transcriptsOpen.delete(m.id) : transcriptsOpen.add(m.id), renderMessages({ stick: false })) },
              open ? 'Masquer le texte' : 'Voir le texte',
            ),
        ),
      open && m.meta?.transcript && h('p', { class: 'transcript' }, `« ${m.meta.transcript} »`, h('span', { class: 'small muted' }, 'Transcrit sur ton serveur')),
    );
    if (player.id === m.id) queueMicrotask(() => player.paint());
    return node;
  }

  function cycleSpeed() {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setPref('papote.voiceSpeed', String(speed));
    if (player.id) engine.prepare(player.filter, speed);
    renderMessages({ stick: false });
  }

  // One <audio> for the whole chat; the cookie authenticates the media request.
  const player = {
    audio: new Audio(),
    id: null,
    filter: '',
    toggle(m) {
      if (this.id === m.id) {
        if (this.audio.paused) this.audio.play();
        else this.audio.pause();
      } else {
        this.stop();
        this.id = m.id;
        this.filter = m.meta?.filter ?? '';
        this.audio.src = m.media.url;
        engine.prepare(this.filter, speed);
        this.audio.play().catch(() => this.stop());
      }
      this.paint();
    },
    stop() {
      const old = this.id;
      this.audio.pause();
      this.id = null;
      if (old) this.paint(old);
    },
    paint(id = this.id) {
      const v = voiceViews.get(id);
      if (!v) return;
      const playing = id === this.id && !this.audio.paused;
      clear(v.btn, icon(playing ? 'pause' : 'play', 18));
      v.btn.setAttribute('aria-label', playing ? 'Mettre en pause le vocal' : 'Écouter le vocal');
      const p = id === this.id && this.audio.duration ? this.audio.currentTime / this.audio.duration : 0;
      const played = Math.floor(p * v.bars.length);
      v.bars.forEach((b, i) => (b.style.background = i < played ? v.t.text : v.t.tint));
    },
  };
  player.audio.addEventListener('loadedmetadata', () => engine.prepare(player.filter, speed));
  const engine = createVoiceEngine(player.audio);
  player.audio.addEventListener('timeupdate', () => player.paint());
  player.audio.addEventListener('pause', () => player.paint());
  player.audio.addEventListener('ended', () => player.stop());

  function attachLongPress(node, fn) {
    let timer = null;
    let start = null;
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      fn();
    });
    node.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      start = [e.clientX, e.clientY];
      timer = setTimeout(() => {
        timer = null;
        navigator.vibrate?.(15);
        fn();
      }, 450);
    });
    const cancel = () => timer && (clearTimeout(timer), (timer = null));
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('pointermove', (e) => start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10 && cancel());
  }

  function renderTyping() {
    const now = Date.now();
    for (const [k, v] of typing) if (v.until < now) typing.delete(k);
    const who = [...typing.keys()].map((id) => members.get(id)?.name).filter(Boolean);
    if (!who.length) return clear(typingRow);
    const kind = [...typing.values()][0].kind;
    const verb = { draw: 'dessine', voice: 'enregistre un vocal' }[kind] ?? 'écrit';
    const stick = nearBottom();
    clear(typingRow, h('div', { class: 'typing' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')), `${who.join(', ')} ${verb}…`));
    if (stick) list.scrollTop = list.scrollHeight;
  }

  function renderStatus(error) {
    status.className = error ? 'error' : 'status-line';
    status.style.margin = error ? '0 12px' : '';
    status.textContent = error ?? (uploads > 0 ? 'Envoi en cours…' : '');
    status.onclick = error ? () => renderStatus(null) : null;
  }

  // --- actions --------------------------------------------------------------------
  function upsert(m) {
    const i = messages.findIndex((x) => x.id === m.id);
    if (i >= 0) messages[i] = m;
    else {
      messages.push(m);
      messages.sort((a, b) => a.id - b.id);
    }
  }

  function markRead() {
    const last = messages.at(-1)?.id;
    if (!last || last <= lastRead || document.visibilityState !== 'visible') return;
    lastRead = last;
    api.markRead(groupId, last).catch(() => {});
  }

  function sendTyping(kind = 'text') {
    if (Date.now() - lastTyping < 3000) return;
    lastTyping = Date.now();
    live.typing(groupId, kind);
  }

  async function upload(fn) {
    uploads++;
    renderStatus();
    try {
      upsert(await fn());
      renderMessages({ stick: true });
    } catch (e) {
      renderStatus(e instanceof ApiError ? e.message : `Envoi impossible : ${e.message}`);
      uploads--;
      return;
    }
    uploads--;
    renderStatus();
  }

  async function react(m, kind) {
    const on = !(m.reactions?.[kind] ?? []).includes(session.me.id);
    try {
      upsert(await api.react(m.id, kind, on));
      renderMessages({ stick: false });
    } catch (e) {
      renderStatus(e.message);
    }
  }

  function openActions(m) {
    if (m.deleted) return;
    const mine = m.authorId === session.me.id;
    const canDelete = mine || ['owner', 'admin'].includes(members.get(session.me.id)?.role);
    sheet((close) => {
      const pickerSlotSheet = h('div');
      const pick = (kind) => {
        close();
        react(m, kind);
      };
      const has = (k) => (m.reactions?.[k] ?? []).includes(session.me.id);
      return [
        h('h2', { class: 'title', style: { fontSize: '20px' } }, 'Réagir'),
        h(
          'div',
          { class: 'reaction-row' },
          // The group's own quick reactions (Réglages du groupe).
          (group?.settings?.reactions ?? REACTIONS.map((r) => r.key)).map((k) => {
            const r = reactionOf(k);
            return r
              ? h('button', { type: 'button', class: 'reaction-btn', style: { background: r.bg, color: r.fg }, 'aria-pressed': String(has(r.key)), 'aria-label': r.label, onclick: () => pick(r.key) }, icon(r.icon, 26))
              : h('button', { type: 'button', class: 'reaction-btn', 'aria-pressed': String(has(k)), 'aria-label': k, onclick: () => pick(k) }, k);
          }),
        ),
        h(
          'div',
          { class: 'reaction-row' },
          QUICK_REACTIONS.map((e) => h('button', { type: 'button', class: 'reaction-btn small', 'aria-pressed': String(has(e)), 'aria-label': e, onclick: () => pick(e) }, e)),
          h('button', { type: 'button', class: 'reaction-btn small', 'aria-label': 'Plus d’emoji', onclick: () => clear(pickerSlotSheet, pickerSlotSheet.childElementCount ? null : emojiPicker(pick)) }, icon('plus', 20)),
        ),
        pickerSlotSheet,
        m.type === 'text' &&
          h('button', { type: 'button', class: 'btn', onclick: () => (navigator.clipboard?.writeText(m.text), close()) }, icon('copy', 20), 'Copier le texte'),
        h(
          'button',
          { type: 'button', class: 'btn', onclick: () => (close(), api.pin(m.id, !m.pinnedAt).catch((e) => renderStatus(e.message))) },
          icon('pin', 20),
          m.pinnedAt ? 'Désépingler' : 'Épingler',
        ),
        ['drawing', 'photo', 'gif'].includes(m.type) &&
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: async () => {
                close();
                try {
                  await api.makeSticker(groupId, m.id);
                  renderStatus('Sticker ajouté au groupe');
                } catch (e) {
                  renderStatus(e.message);
                }
              },
            },
            icon('sticker', 20),
            'En faire un sticker',
          ),
        m.type === 'photo' &&
          h('button', { type: 'button', class: 'btn', onclick: () => (close(), go(`/draw/${groupId}?base=${m.id}&img=${encodeURIComponent(m.media.url)}`)) }, icon('pencil', 20), 'Dessiner dessus'),
        canDelete &&
          h(
            'button',
            {
              type: 'button',
              class: 'btn danger',
              onclick: async () => {
                close();
                try {
                  await api.deleteMessage(m.id);
                } catch (e) {
                  renderStatus(e.message);
                }
              },
            },
            icon('trash', 20),
            mine ? 'Supprimer mon message' : 'Supprimer ce message',
          ),
      ];
    });
  }

  // --- composer ----------------------------------------------------------------------
  const textarea = h('textarea', { class: 'field', rows: 1, placeholder: 'Écris un petit mot…', 'aria-label': 'Message', enterkeyhint: coarse ? 'enter' : 'send' });
  const photoInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const actionsSlot = h('div', { class: 'row', style: { gap: '8px' } });
  let emojiOpen = false;
  let recorder = null;

  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight + 4, 140)}px`;
    textarea.style.overflowY = textarea.scrollHeight + 4 > 140 ? 'auto' : 'hidden';
  }

  function renderActions() {
    const hasText = textarea.value.trim().length > 0;
    clear(actionsSlot, hasText ? iconButton('send', 'Envoyer', sendText, { cls: 'lg primary' }) : iconButton('mic', 'Enregistrer un vocal', startRecording, { cls: 'lg primary' }));
  }

  // The "+" inside the field: photo, drawing, and (on a computer keyboard) emoji.
  const attachMenu = h('div', { class: 'attach-menu', role: 'menu', hidden: true });
  const attachBtn = h('button', { type: 'button', class: 'attach-btn', 'aria-label': 'Joindre une photo, un dessin ou un emoji', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('plus', 18, 2.6));
  const closeAttach = () => {
    attachMenu.hidden = true;
    attachBtn.setAttribute('aria-expanded', 'false');
  };
  attachBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    attachMenu.hidden = !attachMenu.hidden;
    attachBtn.setAttribute('aria-expanded', String(!attachMenu.hidden));
    attachMenu.querySelector('button')?.focus();
  });
  const menuItem = (ic, label, fn) => h('button', { type: 'button', role: 'menuitem', onclick: () => (closeAttach(), fn()) }, icon(ic, 20), label);
  attachMenu.append(
    menuItem('photo', 'Photo', () => photoInput.click()),
    menuItem('pencil', 'Dessin', () => go(`/draw/${groupId}`)),
    menuItem('palette', 'Toile commune', () => go(`/live/${groupId}`)),
    menuItem('gif', 'GIF et stickers', () => gifSheet(groupId, { features, onError: renderStatus })),
    menuItem('poll', 'Sondage', () => pollSheet(groupId)),
    menuItem('location', 'Position', () => locationSheet(groupId, renderStatus)),
    menuItem('game', 'Jeu', () => go(`/games/${groupId}`)),
    menuItem('smile', 'Emoji', () => toggleEmoji()),
  );
  const onDocClick = () => closeAttach();
  document.addEventListener('click', onDocClick);
  attachMenu.addEventListener('keydown', (e) => e.key === 'Escape' && (closeAttach(), attachBtn.focus()));
  attachBtn.setAttribute('aria-label', 'Plus d’options : photo, dessin, GIF, sondage, position, jeu');

  function toggleEmoji(force) {
    emojiOpen = force ?? !emojiOpen;
    clear(
      pickerSlot,
      emojiOpen &&
        emojiPicker((e) => {
          const { selectionStart: s = textarea.value.length, selectionEnd: en = textarea.value.length } = textarea;
          textarea.value = textarea.value.slice(0, s) + e + textarea.value.slice(en);
          textarea.selectionStart = textarea.selectionEnd = s + e.length;
          autosize();
          renderActions();
          sendTyping();
        }),
    );
    if (emojiOpen && coarse) textarea.blur();
    if (nearBottom()) list.scrollTop = list.scrollHeight;
  }

  function sendText() {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    autosize();
    renderActions();
    upload(() => api.sendText(groupId, text));
    if (!coarse) textarea.focus();
  }

  textarea.addEventListener('input', () => {
    autosize();
    renderActions();
    if (textarea.value.trim()) sendTyping();
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) {
      e.preventDefault();
      sendText();
    }
  });
  textarea.addEventListener('focus', () => coarse && emojiOpen && toggleEmoji(false));
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (!file) return;
    // "Décorer la photo": text, stickers, drawing, filters, ephemeral — then send.
    pendingPhoto.file = file;
    go(`/photo/${groupId}`);
  });

  function renderComposer() {
    if (recorder) return;
    if (group?.mutedUntil && group.mutedUntil > Date.now()) {
      const until = group.mutedUntil - Date.now() > 30 * 86_400_000 ? 'jusqu’à nouvel ordre' : `jusqu’à ${dayLabel(group.mutedUntil).toLowerCase()} ${timeOf(group.mutedUntil)}`;
      return clear(composer, h('div', { class: 'muted-note' }, icon('mute', 18), `Un·e admin t’a mis·e en sourdine ${until} : tu peux lire mais pas écrire.`));
    }
    renderActions();
    clear(
      composer,
      h('div', { class: 'composer' }, h('div', { class: 'field-wrap' }, textarea, attachBtn, attachMenu), actionsSlot, photoInput),
    );
  }

  // --- voice recording -------------------------------------------------------------
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return renderStatus('Ton navigateur ne sait pas enregistrer de vocal');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return renderStatus('Micro refusé : autorise-le dans les réglages du navigateur');
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64_000 } : undefined);
    const chunks = [];
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const samples = [];
    const startedAt = Date.now();
    recorder = { mr, stream, ctx, cancelled: false, filter: '' };
    const filters = h('div', { class: 'voice-filters', role: 'group', 'aria-label': 'Filtre de voix' });
    const paintFilters = () =>
      clear(
        filters,
        VOICE_FILTERS.map(([k, label, ic]) =>
          h('button', { type: 'button', class: 'chip', 'aria-pressed': String(recorder?.filter === k), onclick: () => recorder && ((recorder.filter = k), paintFilters()) }, icon(ic, 14), label),
        ),
      );
    paintFilters();
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const time = h('span', { class: 'time' }, '0:00');
    const levels = h('div', { class: 'levels', 'aria-hidden': 'true' });
    clear(
      composer,
      filters,
      h(
        'div',
        { class: 'recording' },
        iconButton('trash', 'Annuler le vocal', () => stopRecording(true), { cls: 'round' }),
        h('span', { class: 'rec-dot', 'aria-hidden': 'true' }),
        time,
        levels,
        iconButton('send', 'Envoyer le vocal', () => stopRecording(false), { cls: 'lg primary round' }),
      ),
    );
    recorder.tick = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      const level = Math.max(4, Math.min(100, Math.round(Math.sqrt(peak / 128) * 100)));
      samples.push(level);
      time.textContent = duration(Date.now() - startedAt);
      clear(levels, samples.slice(-24).map((v) => h('span', { style: { height: `${4 + (v * 24) / 100}px` } })));
      if (Date.now() - startedAt > 5 * 60_000) stopRecording(false);
    }, 80);
    sendTyping('voice');

    mr.onstop = () => {
      const durationMs = Date.now() - startedAt;
      const cancelled = recorder.cancelled;
      const filter = recorder.filter;
      clearInterval(recorder.tick);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      recorder = null;
      renderComposer();
      if (cancelled || durationMs < 600) return;
      // The server wants a plain type: "audio/webm;codecs=opus" → "audio/webm".
      const mime = (mr.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks, { type: mime });
      const n = 40;
      const waveform = samples.length <= n ? samples : Array.from({ length: n }, (_, i) => Math.max(...samples.slice(Math.floor((i * samples.length) / n), Math.max(Math.floor(((i + 1) * samples.length) / n), Math.floor((i * samples.length) / n) + 1))));
      upload(() => api.sendMedia(groupId, 'voice', blob, mime === 'audio/mp4' ? 'vocal.m4a' : 'vocal.webm', { durationMs, waveform: JSON.stringify(waveform), ...(filter ? { filter } : {}) }));
    };
    mr.start(250);
  }

  function stopRecording(cancel) {
    if (!recorder) return;
    recorder.cancelled = cancel;
    recorder.mr.stop();
  }

  // --- loading and live updates ------------------------------------------------------
  async function loadExtras() {
    const [p, st, lv, srv] = await Promise.allSettled([api.pins(groupId), api.stories(groupId), api.liveDraw(groupId), serverFeatures ? Promise.resolve(null) : api.server()]);
    if (p.status === 'fulfilled') pins = p.value;
    if (st.status === 'fulfilled') stories = st.value;
    if (lv.status === 'fulfilled') liveSession = lv.value;
    if (srv.status === 'fulfilled' && srv.value) features = serverFeatures = srv.value.features ?? features;
    pending = [...members.values()].filter((m) => m.status === 'pending');
    renderExtras();
    refreshBubu();
  }

  async function load() {
    try {
      const at = Number(query.get('at')) || null;
      const [g, ms, msgs] = await Promise.all([api.group(groupId), api.members(groupId), at ? api.messagesAround(groupId, at) : api.messages(groupId)]);
      group = g;
      members = new Map(ms.map((m) => [m.id, m]));
      messages = msgs;
      reachedStart = !at && msgs.length < 50;
      reachedEnd = !at;
      renderHead();
      renderExtras();
      renderComposer();
      renderMessages({ stick: true });
      markRead();
      loadExtras();
    } catch (e) {
      if (e.code === 'group_not_found') go('/groups', { replace: true });
      else renderStatus(e.message);
    }
  }

  async function backToLatest() {
    try {
      messages = await api.messages(groupId);
      reachedStart = messages.length < 50;
      reachedEnd = true;
      renderMessages({ stick: true });
      markRead();
    } catch (e) {
      renderStatus(e.message);
    }
  }

  list.addEventListener('scroll', async () => {
    // Looking at older messages: load the following ones when reaching the bottom.
    if (!reachedEnd && !loadingNewer && messages.length && list.scrollHeight - list.scrollTop - list.clientHeight < 80) {
      loadingNewer = true;
      try {
        const newer = await api.messagesAfter(groupId, messages.at(-1).id);
        newer.forEach(upsert);
        reachedEnd = newer.length < 100;
      } catch (e) {
        renderStatus(e.message);
      }
      loadingNewer = false;
      renderMessages({ stick: false });
      return;
    }
    if (list.scrollTop > 80 || loadingOlder || reachedStart || !messages.length) return;
    loadingOlder = true;
    const fromBottom = list.scrollHeight - list.scrollTop;
    try {
      const older = await api.messages(groupId, messages[0].id);
      reachedStart = older.length < 50;
      messages = [...older, ...messages];
    } catch (e) {
      renderStatus(e.message);
    }
    loadingOlder = false;
    renderMessages({ keepOffsetFrom: fromBottom });
  });

  const offs = [
    live.on('message.new', (e) => {
      if (e.message.groupId !== groupId) return;
      typing.delete(e.message.authorId);
      if (!reachedEnd) return renderTyping();
      const stick = nearBottom() || e.message.authorId === session.me.id;
      upsert(e.message);
      renderMessages({ stick });
      markRead();
      // Talkie mode: other people's voice messages play by themselves.
      if (talkie() && e.message.type === 'voice' && e.message.authorId !== session.me.id && document.visibilityState === 'visible' && (!player.id || player.audio.paused)) player.toggle(e.message);
    }),
    live.on('message.updated', (e) => {
      if (e.message.groupId !== groupId) return;
      const before = messages.find((x) => x.id === e.message.id);
      if (!before && !reachedEnd) return;
      upsert(e.message);
      renderMessages({ stick: false });
      if ((before?.pinnedAt ?? null) !== (e.message.pinnedAt ?? null) || e.message.deleted) api.pins(groupId).then((p) => ((pins = p), renderExtras())).catch(() => {});
    }),
    live.on('livedraw', (e) => {
      if (e.groupId !== groupId) return;
      liveSession = e.session;
      renderExtras();
      refreshBubu();
    }),
    live.on('story.new', (e) => e.groupId === groupId && api.stories(groupId).then((s) => ((stories = s), renderExtras())).catch(() => {})),
    live.on('story.removed', (e) => e.groupId === groupId && api.stories(groupId).then((s) => ((stories = s), renderExtras())).catch(() => {})),
    live.on('member.pending', (e) => {
      if (e.groupId !== groupId) return;
      api.members(groupId).then((ms) => {
        members = new Map(ms.map((m) => [m.id, m]));
        pending = ms.filter((m) => m.status === 'pending');
        renderExtras();
      }).catch(() => {});
    }),
    live.on('typing', (e) => {
      if (e.groupId !== groupId) return;
      typing.set(e.userId, { kind: e.kind, until: Date.now() + 5000 });
      renderTyping();
    }),
    live.on('presence', (e) => {
      const m = members.get(e.userId);
      if (!m) return;
      m.online = e.online;
      if (!e.online) m.lastSeenAt = Date.now();
      renderHead();
    }),
    live.on('member.joined', (e) => {
      if (e.groupId !== groupId) return;
      members.set(e.member.id, e.member);
      pending = pending.filter((p) => p.id !== e.member.id);
      renderHead();
      renderExtras();
      renderMessages();
    }),
    live.on('member.left', (e) => {
      if (e.groupId !== groupId) return;
      members.delete(e.userId);
      pending = pending.filter((p) => p.id !== e.userId);
      renderHead();
      renderExtras();
    }),
    live.on('member.updated', (e) => {
      const m = e.groupId === groupId && members.get(e.userId);
      if (!m) return;
      if (e.role) m.role = e.role;
      if ('mutedUntil' in e) m.mutedUntil = e.mutedUntil;
      if (e.userId === session.me.id) api.group(groupId).then((g) => ((group = g), renderComposer())).catch(() => {});
    }),
    live.on('user.updated', (e) => {
      const m = members.get(e.user.id);
      if (!m) return;
      Object.assign(m, { name: e.user.name, color: e.user.color, photo: e.user.photo, bio: e.user.bio, mood: e.user.mood });
      renderHead();
      renderMessages();
    }),
    live.on('group.updated', (e) => e.group.id === groupId && api.group(groupId).then((g) => ((group = g), renderHead(), renderExtras()))),
    live.on('group.removed', (e) => e.groupId === groupId && go('/groups', { replace: true })),
    live.on('group.refresh', (e) => e.groupId === groupId && load()),
    live.on('reconnected', async () => {
      try {
        (await api.messages(groupId)).forEach(upsert);
        members = new Map((await api.members(groupId)).map((m) => [m.id, m]));
        renderHead();
        renderMessages();
        markRead();
      } catch {
        /* next reconnect will retry */
      }
    }),
  ];
  const typingTimer = setInterval(renderTyping, 1000);
  const onStories = (e) => e.detail === groupId && api.stories(groupId).then((s) => ((stories = s), renderExtras())).catch(() => {});
  window.addEventListener('papote:stories', onStories);
  clearNotifications(groupId);
  const onVisible = () => markRead();
  document.addEventListener('visibilitychange', onVisible);

  renderHead();
  renderComposer();
  load();
  if (!coarse) textarea.setAttribute('autofocus', '');

  return {
    el,
    destroy() {
      offs.forEach((off) => off());
      clearInterval(typingTimer);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('papote:stories', onStories);
      player.stop();
      if (recorder) stopRecording(true);
    },
  };
}
