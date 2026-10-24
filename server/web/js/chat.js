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
  replySnippet,
  fileSize,
  chatBackground,
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
  pendingShare,
} from './extras.js';
import { tr } from './i18n.js';

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
  let reads = new Map(); // userId -> last message id they've read (the ticks under my messages)
  let replyingTo = null; // the message the next one answers
  let lastTyping = 0;
  let uploads = 0;
  const typing = new Map(); // userId -> { kind, until }

  // --- layout -------------------------------------------------------------------
  const head = h('div', { class: 'chat-head' });
  const extrasBar = h('div', { class: 'chat-extras' });
  const list = h('div', { class: 'messages', role: 'log', 'aria-label': 'Messages' });
  const jumpBtn = h('button', { type: 'button', class: 'jump-btn', hidden: true, onclick: () => backToLatest() }, icon('back', 16), tr('Revenir aux derniers messages'));
  const typingRow = h('div', { 'aria-live': 'polite' });
  const status = h('div', { class: 'status-line', role: 'status' });
  const replyBar = h('div');
  const composer = h('div');
  const pickerSlot = h('div');
  const el = h('div', { class: 'screen chat' }, head, extrasBar, list, jumpBtn, status, replyBar, composer, pickerSlot);
  const isAdmin = () => ['owner', 'admin'].includes(group?.role);
  const canPost = () => !(group?.mutedUntil > Date.now());
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
    Object.assign(list.style, chatBackground(group));
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
      iconButton('back', tr('Retour aux groupes'), () => back('/groups'), { cls: 'back-btn' }),
      h(
        'button',
        { type: 'button', class: 'who', onclick: () => go(`/members/${groupId}`), 'aria-label': tr`${group?.name ?? ''}, réglages` },
        groupAvatar(group, 44, { zoom: true }),
        h(
          'div',
          { class: 'col', style: { gap: 0, minWidth: 0 } },
          h('h1', { class: 'title ellipsis', style: { fontSize: '21px' } }, group?.name ?? '…'),
          h(
            'span',
            { class: 'small muted' },
            group?.direct
              ? (members.get(group.peer?.id) ? lastSeen(members.get(group.peer.id)) : tr('Discussion'))
              : tr`${members.size} membre${members.size > 1 ? 's' : ''} · ${online} en ligne`,
          ),
        ),
      ),
      bubuButton(lastBubu, members, group),
      h(
        'div',
        { class: 'head-actions' },
        iconButton('search', tr('Rechercher dans la discussion'), () => go(`/search/${groupId}`)),
        iconButton('grid', tr('Galerie du groupe'), () => go(`/gallery/${groupId}`)),
        iconButton('settings', group?.direct ? tr('Réglages de la discussion') : tr('Réglages du groupe et invitations'), () => go(`/settings/${groupId}`)),
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
    if (loadingOlder) nodes.push(h('div', { class: 'system' }, tr('Chargement…')));
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      if (!prev || !sameDay(prev.createdAt, m.createdAt)) nodes.push(h('div', { class: 'day' }, dayLabel(m.createdAt)));
      nodes.push(messageNode(m, prev, next));
    });
    if (!reachedEnd) nodes.push(h('div', { class: 'system' }, loadingNewer ? tr('Chargement…') : ''));
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
    if (m.deleted) bubble = h('div', { class: 'bubble deleted' }, tr('Message supprimé'));
    else if (m.type === 'text') bubble = h('div', { class: `bubble text${isEmojiOnly(m.text) ? ' big-emoji' : ''}` }, isEmojiOnly(m.text) ? m.text.trim() : m.text);
    else if (m.type === 'photo' || m.type === 'drawing') {
      const label = `${m.type === 'drawing' ? tr('Dessin') : tr('Photo')} de ${author?.name ?? tr('quelqu’un')}`;
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
          `${m.type === 'drawing' ? (m.meta?.live ? tr('Toile commune') : tr('Dessin')) : tr('Photo')} · ${timeOf(m.createdAt)}`,
          hours > 0 && h('span', { class: 'ephemeral' }, icon('timer', 13), tr`disparaît dans ${hours} h`),
        ),
      );
    } else if (m.type === 'video') {
      const ratio = Math.min(1.8, Math.max(0.56, (m.meta?.width ?? 16) / (m.meta?.height ?? 9)));
      bubble = h(
        'div',
        { class: 'bubble media' },
        h('video', { src: m.media?.url, controls: true, preload: 'metadata', playsinline: true, style: { aspectRatio: String(ratio) }, 'aria-label': tr`Vidéo de ${author?.name ?? tr('quelqu’un')}` }),
        m.text && h('span', { style: { padding: '0 4px' } }, m.text),
        h('span', { class: 'meta' }, icon('video', 14), tr`Vidéo${m.meta?.durationMs ? ` · ${duration(m.meta.durationMs)}` : ''} · ${timeOf(m.createdAt)}`),
      );
    } else if (m.type === 'file') {
      const name = m.meta?.name ?? 'fichier';
      bubble = h(
        'a',
        { class: 'bubble file', href: m.media?.url, download: name, 'aria-label': tr`Télécharger ${name}${m.meta?.size ? `, ${fileSize(m.meta.size)}` : ''}` },
        h('span', { class: 'file-ico' }, icon('file', 22)),
        h('span', { class: 'col', style: { gap: 0, minWidth: 0 } }, h('b', { class: 'file-name' }, name), h('small', { class: 'muted' }, [fileSize(m.meta?.size), timeOf(m.createdAt)].filter(Boolean).join(' · '))),
        h('span', { class: 'file-dl' }, icon('download', 18)),
      );
    } else if (m.type === 'voice') bubble = voiceNode(m, t);
    else if (m.type === 'poll') bubble = pollBubble(m, members, renderStatus);
    else if (m.type === 'location') bubble = locationBubble(m);
    else if (m.type === 'gif') bubble = gifBubble(m, () => lightbox(m.media.url, m.meta?.title ? tr`GIF « ${m.meta.title} »` : 'GIF'));
    else if (m.type === 'sticker') bubble = stickerBubble(m);
    else if (m.type === 'game') bubble = gameBubble(m, members);
    else if (m.type === 'recap') bubble = recapBubble(m);
    else bubble = h('div', { class: 'bubble' }, m.text);
    if (!m.deleted) bubble.title = timeOf(m.createdAt);
    attachLongPress(bubble, () => openActions(m));

    const reactions = Object.entries(m.reactions ?? {});
    // Ticks like the other messengers, shown where they change in a run of my messages (not on every one).
    const seen = mine && !m.deleted ? readState(m) : null;
    const nextMine = next && next.authorId === m.authorId && next.type !== 'system' && !next.deleted;
    const showTicks = seen && (!nextMine || readState(next).level !== seen.level);
    const row = h(
      'div',
      { class: `msg${mine ? ' mine' : ''}`, 'data-id': m.id, style: { marginTop: continued ? '0' : '6px' } },
      h('span', { class: 'swipe-reply', 'aria-hidden': 'true' }, icon('reply', 18)),
      !mine && (lastOfRun ? avatar(author ?? { name: '?', color: 'lilas' }, 32, { initial: true, zoom: true }) : h('span', { class: 'spacer' })),
      h(
        'div',
        { class: 'stack' },
        !mine && !continued && h('span', { class: 'author', style: { color: nameColor(t) } }, author?.name ?? tr('Ancien membre')),
        m.reply && !m.deleted && replyQuote(m.reply),
        bubble,
        showTicks && h('span', { class: `ticks ${seen.level}`, title: seen.label, 'aria-label': seen.label }, timeOf(m.createdAt), icon(seen.level === 'sent' ? 'check' : 'checks', 15, 2.4)),
        m.pinnedAt && h('span', { class: 'pinned-mark' }, icon('pin', 12), tr('Épinglé')),
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
                  'aria-label': `${r?.label ?? kind} : ${users.length}${on ? tr(', dont toi (retirer)') : ''}`,
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
    if (!m.deleted && canPost()) attachSwipe(row, () => startReply(m));
    return row;
  }

  /** Who among the others has read my message: nobody yet, some of them, or everyone. */
  function readState(m) {
    const others = [...members.values()].filter((u) => u.id !== session.me.id && u.status !== 'pending' && (u.joinedAt ?? 0) <= m.createdAt);
    const n = others.filter((u) => (reads.get(u.id) ?? 0) >= m.id).length;
    if (others.length === 0 || n === 0) return { level: 'sent', label: tr('Envoyé, pas encore lu') };
    if (n < others.length) return { level: 'some', label: group?.direct ? tr('Lu') : tr`Lu par ${n} sur ${others.length}` };
    return { level: 'all', label: group?.direct ? tr('Lu') : tr('Lu par tout le monde') };
  }

  function nameOf(id) {
    return id === session.me.id ? tr('Toi') : (members.get(id)?.name ?? tr('Ancien membre'));
  }

  /** The bit of the answered message shown above a reply; tapping it goes to that message. */
  function replyQuote(r) {
    const rt = tint(members.get(r.authorId)?.color ?? 'lilas');
    const text = replySnippet(r);
    return h(
      'button',
      { type: 'button', class: 'reply-quote', style: { borderLeftColor: rt.tint }, 'aria-label': tr`En réponse à ${nameOf(r.authorId)} : ${text}. Voir ce message`, onclick: () => showMessage(r.id) },
      h('span', { class: 'reply-who', style: { color: nameColor(rt) } }, nameOf(r.authorId)),
      h('span', { class: 'reply-text' }, text),
    );
  }

  function showMessage(id) {
    const target = list.querySelector(`[data-id="${id}"]`);
    if (!target) return go(`/chat/${groupId}?at=${id}`);
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }

  // Dragging a message to the right answers it, like in the other messengers.
  function attachSwipe(node, fn) {
    let start = null;
    let dx = 0;
    let dragging = false;
    let swallowClick = false;
    // A drag isn't a tap on the bubble (photo, drawing, poll…).
    node.addEventListener('click', (e) => swallowClick && (e.stopPropagation(), e.preventDefault(), (swallowClick = false)), true);
    const reset = () => {
      node.style.transition = 'transform 0.18s ease';
      node.style.transform = '';
      node.style.setProperty('--swipe', '0');
      start = null;
      dragging = false;
    };
    node.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start = [e.clientX, e.clientY];
      dx = 0;
    });
    node.addEventListener('pointermove', (e) => {
      if (!start) return;
      const x = e.clientX - start[0];
      const y = e.clientY - start[1];
      if (!dragging) {
        if (Math.abs(y) > 12) return (start = null); // scrolling
        if (x < 12 || x < Math.abs(y) * 1.5) return;
        dragging = true;
        node.setPointerCapture?.(e.pointerId);
        window.getSelection()?.removeAllRanges();
      }
      const was = dx >= 64;
      dx = Math.max(0, Math.min(90, x - 12));
      if (!was && dx >= 64) navigator.vibrate?.(10);
      node.style.transition = 'none';
      node.style.transform = `translateX(${dx}px)`;
      node.style.setProperty('--swipe', String(Math.min(1, dx / 64)));
    });
    const end = () => {
      if (dragging && dx >= 64) fn();
      if (dragging) {
        swallowClick = true;
        setTimeout(() => (swallowClick = false), 0);
      }
      reset();
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', reset);
  }

  function startReply(m) {
    replyingTo = m;
    renderReplyBar();
    if (!recorder) textarea.focus();
  }

  function cancelReply() {
    replyingTo = null;
    renderReplyBar();
  }

  function renderReplyBar() {
    if (!replyingTo) return clear(replyBar);
    const m = replyingTo;
    const rt = tint(members.get(m.authorId)?.color ?? 'lilas');
    clear(
      replyBar,
      h(
        'div',
        { class: 'reply-bar', style: { borderLeftColor: rt.tint } },
        icon('reply', 18),
        h('div', { class: 'col grow', style: { gap: 0, minWidth: 0 } }, h('span', { class: 'reply-who', style: { color: nameColor(rt) } }, tr`Répondre à ${nameOf(m.authorId)}`), h('span', { class: 'reply-text' }, replySnippet(m))),
        iconButton('close', tr('Annuler la réponse'), cancelReply),
      ),
    );
  }

  function voiceNode(m, t) {
    const bars = (m.meta?.waveform?.length ? m.meta.waveform : Array.from({ length: 24 }, (_, i) => 30 + ((i * 37) % 50))).slice(0, 28);
    const barEls = bars.map((v) => h('span', { style: { height: `${6 + (v * 26) / 100}px`, background: t.tint } }));
    const btn = h('button', { type: 'button', class: 'play', style: { background: t.tint }, 'aria-label': tr('Écouter le vocal'), onclick: () => player.toggle(m) }, icon('play', 18));
    voiceViews.set(m.id, { btn, bars: barEls, t });
    const speedBtn = h('button', { type: 'button', class: 'speed', 'aria-label': tr`Vitesse de lecture ×${String(speed).replace('.', ',')}, changer`, onclick: () => cycleSpeed() }, `×${String(speed).replace('.', ',')}`);
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
          m.meta?.transcribing && h('span', { class: 'small muted' }, tr('Transcription…')),
          m.meta?.transcript &&
            h(
              'button',
              { type: 'button', class: 'link-btn small', 'aria-expanded': String(open), onclick: () => (open ? transcriptsOpen.delete(m.id) : transcriptsOpen.add(m.id), renderMessages({ stick: false })) },
              open ? tr('Masquer le texte') : tr('Voir le texte'),
            ),
        ),
      open && m.meta?.transcript && h('p', { class: 'transcript' }, `« ${m.meta.transcript} »`, h('span', { class: 'small muted' }, tr('Transcrit sur ton serveur'))),
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
      v.btn.setAttribute('aria-label', playing ? tr('Mettre en pause le vocal') : tr('Écouter le vocal'));
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
    const verb = { draw: tr('dessine'), voice: tr('enregistre un vocal') }[kind] ?? tr('écrit');
    const stick = nearBottom();
    clear(typingRow, h('div', { class: 'typing' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')), `${who.join(', ')} ${verb}…`));
    if (stick) list.scrollTop = list.scrollHeight;
  }

  function renderStatus(error) {
    status.className = error ? 'error' : 'status-line';
    status.style.margin = error ? '0 12px' : '';
    status.textContent = error ?? (uploads > 0 ? tr('Envoi en cours…') : '');
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
      renderStatus(e instanceof ApiError ? e.message : tr`Envoi impossible : ${e.message}`);
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
        h('h2', { class: 'title', style: { fontSize: '20px' } }, tr('Réagir')),
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
          h('button', { type: 'button', class: 'reaction-btn small', 'aria-label': tr('Plus d’emoji'), onclick: () => clear(pickerSlotSheet, pickerSlotSheet.childElementCount ? null : emojiPicker(pick)) }, icon('plus', 20)),
        ),
        pickerSlotSheet,
        canPost() && h('button', { type: 'button', class: 'btn', onclick: () => (close(), startReply(m)) }, icon('reply', 20), tr('Répondre')),
        m.type === 'text' &&
          h('button', { type: 'button', class: 'btn', onclick: () => (navigator.clipboard?.writeText(m.text), close()) }, icon('copy', 20), tr('Copier le texte')),
        h(
          'button',
          { type: 'button', class: 'btn', onclick: () => (close(), api.pin(m.id, !m.pinnedAt).catch((e) => renderStatus(e.message))) },
          icon('pin', 20),
          m.pinnedAt ? tr('Désépingler') : tr('Épingler'),
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
                  renderStatus(tr('Sticker ajouté au groupe'));
                } catch (e) {
                  renderStatus(e.message);
                }
              },
            },
            icon('sticker', 20),
            tr('En faire un sticker'),
          ),
        m.type === 'photo' &&
          h('button', { type: 'button', class: 'btn', onclick: () => (close(), go(`/draw/${groupId}?base=${m.id}&img=${encodeURIComponent(m.media.url)}`)) }, icon('pencil', 20), tr('Dessiner dessus')),
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
            mine ? tr('Supprimer mon message') : tr('Supprimer ce message'),
          ),
      ];
    });
  }

  // --- composer ----------------------------------------------------------------------
  const textarea = h('textarea', { class: 'field', rows: 1, placeholder: tr('Écris un petit mot…'), 'aria-label': 'Message', enterkeyhint: coarse ? 'enter' : 'send' });
  const photoInput = h('input', { type: 'file', accept: 'image/*,video/*', hidden: true });
  const fileInput = h('input', { type: 'file', hidden: true });
  const storyInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
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
    clear(actionsSlot, hasText ? iconButton('send', tr('Envoyer'), sendText, { cls: 'lg primary' }) : iconButton('mic', tr('Enregistrer un vocal'), startRecording, { cls: 'lg primary' }));
  }

  // The "+" inside the field: photo, drawing, and (on a computer keyboard) emoji.
  const attachMenu = h('div', { class: 'attach-menu', role: 'menu', hidden: true });
  const attachBtn = h('button', { type: 'button', class: 'attach-btn', 'aria-label': tr('Joindre une photo, un dessin ou un emoji'), 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('plus', 18, 2.6));
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
  // A grid of round, coloured icons (like the other messengers), not a long list over the messages.
  const menuItem = (ic, label, color, fn) =>
    h('button', { type: 'button', role: 'menuitem', onclick: () => (closeAttach(), fn()) }, h('span', { class: 'attach-ico', style: { background: color } }, icon(ic, 22)), h('span', {}, label));
  attachMenu.append(
    ...[
    menuItem('photo', tr('Photo et vidéo'), '#FFC2D1', () => photoInput.click()),
    menuItem('file', tr('Fichier'), '#CFE3FF', () => fileInput.click()),
    menuItem('sparkles', 'Story', '#FFE38A', () => storyInput.click()),
    menuItem('pencil', tr('Dessin'), '#FFD3A8', () => go(`/draw/${groupId}`)),
    menuItem('palette', tr('Toile commune'), '#D9CCFF', () => go(`/live/${groupId}`)),
    menuItem('gif', 'GIF', '#BFEBD7', () => gifSheet(groupId, { features, onError: renderStatus })),
    menuItem('poll', tr('Sondage'), '#C9F0F5', () => pollSheet(groupId)),
    menuItem('location', tr('Position'), '#FFCFC2', () => locationSheet(groupId, renderStatus)),
    menuItem('game', tr('Jeu'), '#E3D5FF', () => go(`/games/${groupId}`)),
    !coarse && menuItem('smile', 'Emoji', '#FFF0B8', () => toggleEmoji()),
    ].filter(Boolean),
  );
  const onDocClick = () => closeAttach();
  document.addEventListener('click', onDocClick);
  attachMenu.addEventListener('keydown', (e) => e.key === 'Escape' && (closeAttach(), attachBtn.focus()));
  attachBtn.setAttribute('aria-label', tr('Plus d’options : photo, vidéo, fichier, story, dessin, GIF, sondage, position, jeu'));

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
    const replyTo = replyingTo?.id;
    cancelReply();
    upload(() => api.sendText(groupId, text, replyTo));
    if (!coarse) textarea.focus();
  }

  textarea.addEventListener('input', () => {
    autosize();
    renderActions();
    if (textarea.value.trim()) sendTyping();
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && replyingTo) return cancelReply();
    if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) {
      e.preventDefault();
      sendText();
    }
  });
  textarea.addEventListener('focus', () => coarse && emojiOpen && toggleEmoji(false));
  const tooBig = (file) => {
    const max = features.maxUploadMb ?? 20;
    if (file.size <= max * 1024 * 1024) return false;
    renderStatus(tr`Trop lourd : ${fileSize(file.size)}, ${max} Mo au maximum`);
    return true;
  };

  /** Width, height and length of a video, read by the browser before sending (shown before it loads). */
  const videoInfo = (file) =>
    new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = (info) => (URL.revokeObjectURL(url), resolve(info));
      v.preload = 'metadata';
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, durationMs: Math.round(v.duration * 1000) || 0 });
      v.onerror = () => done({});
      v.src = url;
    });

  async function sendVideo(file) {
    if (tooBig(file)) return;
    const info = await videoInfo(file);
    const fields = Object.fromEntries(Object.entries(info).filter(([, v]) => Number.isFinite(v) && v > 0));
    const replyTo = replyingTo?.id;
    cancelReply();
    upload(() => api.sendMedia(groupId, 'video', file, file.name || 'video.mp4', { ...fields, ...(replyTo ? { replyTo } : {}) }));
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || tooBig(file)) return;
    const replyTo = replyingTo?.id;
    cancelReply();
    upload(() => api.sendMedia(groupId, 'file', file, file.name || 'fichier', { name: file.name || 'fichier', ...(replyTo ? { replyTo } : {}) }));
  });

  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (!file) return;
    if (file.type.startsWith('video/')) return sendVideo(file);
    // "Décorer la photo": text, stickers, drawing, filters, ephemeral — then send.
    pendingPhoto.file = file;
    go(`/photo/${groupId}`);
  });
  storyInput.addEventListener('change', () => {
    const file = storyInput.files?.[0];
    storyInput.value = '';
    if (!file) return;
    pendingPhoto.file = file;
    go(`/photo/${groupId}?story=1`);
  });

  function renderComposer() {
    if (recorder) return;
    if (group?.mutedUntil && group.mutedUntil > Date.now()) {
      const until = group.mutedUntil - Date.now() > 30 * 86_400_000 ? tr('jusqu’à nouvel ordre') : tr`jusqu’à ${dayLabel(group.mutedUntil).toLowerCase()} ${timeOf(group.mutedUntil)}`;
      return clear(composer, h('div', { class: 'muted-note' }, icon('mute', 18), tr`Un·e admin t’a mis·e en sourdine ${until} : tu peux lire mais pas écrire.`));
    }
    renderActions();
    clear(
      composer,
      h('div', { class: 'composer' }, h('div', { class: 'field-wrap' }, textarea, attachBtn, attachMenu), actionsSlot, photoInput, storyInput, fileInput),
    );
  }

  // --- voice recording -------------------------------------------------------------
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return renderStatus(tr('Ton navigateur ne sait pas enregistrer de vocal'));
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return renderStatus(tr('Micro refusé : autorise-le dans les réglages du navigateur'));
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
    const filters = h('div', { class: 'voice-filters', role: 'group', 'aria-label': tr('Filtre de voix') });
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
        iconButton('trash', tr('Annuler le vocal'), () => stopRecording(true), { cls: 'round' }),
        h('span', { class: 'rec-dot', 'aria-hidden': 'true' }),
        time,
        levels,
        iconButton('send', tr('Envoyer le vocal'), () => stopRecording(false), { cls: 'lg primary round' }),
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
      const replyTo = replyingTo?.id;
      cancelReply();
      const n = 40;
      const waveform = samples.length <= n ? samples : Array.from({ length: n }, (_, i) => Math.max(...samples.slice(Math.floor((i * samples.length) / n), Math.max(Math.floor(((i + 1) * samples.length) / n), Math.floor((i * samples.length) / n) + 1))));
      upload(() => api.sendMedia(groupId, 'voice', blob, mime === 'audio/mp4' ? 'vocal.m4a' : 'vocal.webm', { durationMs, waveform: JSON.stringify(waveform), ...(filter ? { filter } : {}), ...(replyTo ? { replyTo } : {}) }));
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
      reads = new Map(Object.entries(g.reads ?? {}).map(([k, v]) => [Number(k), v]));
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
      // Writing in the group means having read everything before.
      if (e.message.authorId) reads.set(e.message.authorId, Math.max(reads.get(e.message.authorId) ?? 0, e.message.id));
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
    live.on('member.read', (e) => {
      if (e.groupId !== groupId || (reads.get(e.userId) ?? 0) >= e.messageId) return;
      reads.set(e.userId, e.messageId);
      renderMessages({ stick: false });
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
        const g = await api.group(groupId);
        group = g;
        reads = new Map(Object.entries(g.reads ?? {}).map(([k, v]) => [Number(k), v]));
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

  // Text shared to Papote from another app: ready to send (or to edit first).
  if (pendingShare.text) {
    textarea.value = pendingShare.text;
    pendingShare.text = null;
    queueMicrotask(autosize);
  }
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
