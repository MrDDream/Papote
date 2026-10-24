import { api, live } from './api.js';
import { back, go, session } from './app.js';
import { h, clear, icon, iconButton, primaryButton, button, errorBox, avatar, timeOf, dayLabel } from './ui.js';
import { tr } from './i18n.js';

// Same tools and storage as the Android drawing screen: ops in 0..1 coordinates, exported at 1024×1024.
// The strokes also travel to the server (0..1000 space) so a drawing can be replayed as a timelapse.
const TOOLS = [
  ['brush', tr('Pinceau'), 'pencil'],
  ['marker', tr('Feutre'), 'marker'],
  ['eraser', tr('Gomme'), 'eraser'],
  ['bucket', tr('Pot de peinture'), 'bucket'],
  ['stamp', tr('Tampons'), 'star'],
];
const INKS = [
  ['#2E2442', tr('Encre')], ['#FF7A93', tr('Rose bonbon')], ['#FF9F43', tr('Mandarine')], ['#FFD66B', tr('Citron')],
  ['#4CC38A', tr('Menthe')], ['#4A9BEF', tr('Ciel')], ['#8B6CF0', tr('Lilas')], ['#FFFFFF', tr('Blanc')],
];
const SIZES = [0.008, 0.016, 0.03, 0.05];
const PAPER = '#FFFDF6';
const EXPORT = 1024;

/** Draws ops on ctx; `base` (an Image) replaces the paper when drawing over a picture. */
export function render(ctx, w, hgt, ops, layer, base = null) {
  const fills = ops.filter((o) => o.type === 'fill');
  if (fills.length || !base) {
    ctx.fillStyle = fills.at(-1)?.color ?? PAPER;
    ctx.fillRect(0, 0, w, hgt);
  } else {
    // Cover the square with the picture.
    const s = Math.max(w / base.naturalWidth, hgt / base.naturalHeight);
    const bw = base.naturalWidth * s;
    const bh = base.naturalHeight * s;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(base, (w - bw) / 2, (hgt - bh) / 2, bw, bh);
  }
  // Strokes on their own layer so the eraser clears ink without punching through the paper colour.
  layer.width = w;
  layer.height = hgt;
  const l = layer.getContext('2d');
  l.lineCap = 'round';
  l.lineJoin = 'round';
  for (const op of ops) {
    if (op.type === 'stroke' && op.points.length) {
      l.save();
      l.strokeStyle = op.color;
      l.fillStyle = op.color;
      l.lineWidth = op.width * w * (op.tool === 'marker' ? 1.6 : op.tool === 'eraser' ? 2 : 1);
      if (op.tool === 'marker') l.globalAlpha = 0.55;
      if (op.tool === 'eraser') l.globalCompositeOperation = 'destination-out';
      const p = op.points;
      l.beginPath();
      if (p.length === 1) {
        l.arc(p[0][0] * w, p[0][1] * hgt, l.lineWidth / 2, 0, Math.PI * 2);
        l.fill();
      } else {
        l.moveTo(p[0][0] * w, p[0][1] * hgt);
        for (let i = 1; i < p.length; i++) {
          const [ax, ay] = p[i - 1];
          const [bx, by] = p[i];
          l.quadraticCurveTo(ax * w, ay * hgt, ((ax + bx) / 2) * w, ((ay + by) / 2) * hgt);
        }
        l.lineTo(p.at(-1)[0] * w, p.at(-1)[1] * hgt);
        l.stroke();
      }
      l.restore();
    } else if (op.type === 'stamp') {
      const r = op.size * w;
      l.save();
      l.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const x = op.at[0] * w + rad * Math.cos(a);
        const y = op.at[1] * hgt + rad * Math.sin(a);
        if (i === 0) l.moveTo(x, y);
        else l.lineTo(x, y);
      }
      l.closePath();
      l.fillStyle = op.color;
      l.fill();
      l.lineWidth = r * 0.12;
      l.strokeStyle = '#2E2442';
      l.stroke();
      l.restore();
    }
  }
  ctx.drawImage(layer, 0, 0);
}

// --- wire format: {t, c, w, p: [x, y, …]} in a 1000×1000 space ---

const k1000 = (v) => Math.round(v * 1000);

export function opToWire(op) {
  if (op.type === 'fill') return { t: 'fill', c: op.color, w: 1, p: [0, 0] };
  if (op.type === 'stamp') return { t: 'stamp', c: op.color, w: k1000(op.size), p: [k1000(op.at[0]), k1000(op.at[1])] };
  return { t: op.tool === 'brush' ? 'pen' : op.tool, c: op.color, w: Math.max(1, k1000(op.width)), p: op.points.flatMap(([x, y]) => [k1000(x), k1000(y)]) };
}

const pairs = (p) => {
  const out = [];
  for (let i = 0; i + 1 < p.length; i += 2) out.push([p[i] / 1000, p[i + 1] / 1000]);
  return out;
};

export function opFromWire(s) {
  if (s.t === 'fill') return { type: 'fill', color: s.c };
  if (s.t === 'stamp') return { type: 'stamp', color: s.c, size: s.w / 1000, at: pairs(s.p)[0] ?? [0.5, 0.5] };
  return { type: 'stroke', tool: s.t === 'pen' ? 'brush' : s.t, color: s.c, width: s.w / 1000, points: pairs(s.p) };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tr('Image illisible')));
    img.src = src;
  });
}

const MEDIA_URL = /^\/api\/media\/[a-f0-9]{32}$/;

/**
 * A square drawing canvas with the mockup's tools. `onOp(op, phase)` hears local strokes as they are
 * drawn ('start' / 'move' / 'end'), so shared drawings can stream them.
 */
export function createBoard({ editable = true, onOp = () => {}, base = null } = {}) {
  const ops = []; // finished ops, in order (local and remote)
  const undone = [];
  const remote = new Map(); // key -> op being drawn by someone else, also kept in ops
  let current = null;
  let tool = 'brush';
  let ink = INKS[0][0];
  let size = 1;
  let baseImg = base;
  let frame = 0;
  const canvas = h('canvas', { 'aria-label': tr('Zone de dessin'), role: 'img' });
  const wrap = h('div', { class: 'canvas-wrap' }, canvas);
  const layer = document.createElement('canvas');
  const listeners = new Set();

  function redraw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const dpr = devicePixelRatio || 1;
      const w = Math.round(wrap.clientWidth * dpr);
      if (!w) return;
      if (canvas.width !== w) {
        canvas.width = w;
        canvas.height = w;
      }
      render(canvas.getContext('2d'), w, w, current ? [...ops, current] : ops, layer, baseImg);
      listeners.forEach((fn) => fn());
    });
  }

  const norm = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  function commit(op) {
    ops.push(op);
    undone.length = 0;
    redraw();
  }

  if (editable) {
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (tool === 'stamp') {
        const op = { type: 'stamp', at: norm(e), color: ink, size: SIZES[size] * 2.4 + 0.02 };
        commit(op);
        return onOp(op, 'end');
      }
      if (tool === 'bucket') {
        const op = { type: 'fill', color: ink };
        commit(op);
        return onOp(op, 'end');
      }
      canvas.setPointerCapture(e.pointerId);
      current = { type: 'stroke', points: [norm(e)], color: ink, width: SIZES[size], tool };
      onOp(current, 'start');
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) current.points.push(norm(ev));
      onOp(current, 'move');
      redraw();
    });
    const end = () => {
      if (!current) return;
      const op = current;
      current = null;
      commit(op);
      onOp(op, 'end');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function toolbar({ tools = true } = {}) {
    const bar = h('div', { class: 'card draw-tools' });
    const paint = () =>
      clear(
        bar,
        tools &&
          h(
            'div',
            { class: 'tools', role: 'group', 'aria-label': tr('Outils') },
            TOOLS.map(([key, label, ic]) => h('button', { type: 'button', class: 'tool', 'aria-pressed': String(key === tool), 'aria-label': label, title: label, onclick: () => ((tool = key), paint()) }, icon(ic, 24))),
          ),
        h(
          'div',
          { class: 'inks', role: 'group', 'aria-label': tr('Couleurs') },
          INKS.map(([c, label]) => h('button', { type: 'button', class: 'ink', style: { backgroundColor: c }, 'aria-pressed': String(c === ink), 'aria-label': label, title: label, onclick: () => ((ink = c), paint()) })),
        ),
        h(
          'div',
          { class: 'row', role: 'group', 'aria-label': tr('Épaisseur') },
          h('span', { class: 'label grow' }, tr('Épaisseur')),
          SIZES.map((_, i) =>
            h('button', { type: 'button', class: 'size-btn', 'aria-pressed': String(i === size), 'aria-label': `Taille ${i + 1}`, onclick: () => ((size = i), paint()) }, h('span', { style: { width: `${6 + i * 5}px`, height: `${6 + i * 5}px` } })),
          ),
        ),
      );
    paint();
    return bar;
  }

  async function exportPng() {
    const out = document.createElement('canvas');
    out.width = out.height = EXPORT;
    render(out.getContext('2d'), EXPORT, EXPORT, ops, document.createElement('canvas'), baseImg);
    return new Promise((r) => out.toBlob(r, 'image/png'));
  }

  const ro = new ResizeObserver(redraw);
  ro.observe(wrap);

  return {
    el: wrap,
    canvas,
    ops,
    toolbar,
    exportPng,
    redraw,
    onChange: (fn) => listeners.add(fn),
    setBase(img) {
      baseImg = img;
      redraw();
    },
    undo() {
      if (ops.length) undone.push(ops.pop());
      redraw();
      return undone.at(-1);
    },
    redo() {
      if (undone.length) ops.push(undone.pop());
      redraw();
    },
    get canUndo() {
      return ops.length > 0;
    },
    get canRedo() {
      return undone.length > 0;
    },
    /** Someone else's stroke piece (shared drawing, Pictionary). */
    applyRemote(key, data) {
      if (data.clear) {
        ops.length = 0;
        remote.clear();
        return redraw();
      }
      if (data.undo) {
        const op = remote.get(key);
        remote.delete(key);
        const i = ops.indexOf(op);
        if (i >= 0) ops.splice(i, 1);
        return redraw();
      }
      let op = remote.get(key);
      if (!op) {
        op = opFromWire({ ...data, p: data.p ?? [] });
        remote.set(key, op);
        ops.push(op);
      } else if (op.type === 'stroke') {
        op.points.push(...pairs(data.p ?? []));
      }
      redraw();
    },
    reset(list = []) {
      ops.length = 0;
      remote.clear();
      undone.length = 0;
      list.forEach((s, i) => {
        const op = opFromWire(s);
        ops.push(op);
        remote.set(`${s.u ?? 0}:init${i}`, op);
      });
      redraw();
    },
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}

/**
 * Streams the local strokes of a board over the WebSocket, in small batches.
 * `envelope` adds the session or game id to each piece.
 */
export function streamer(groupId, channel, envelope) {
  let n = 0;
  const keys = new Map(); // op -> { k, sent }
  let timer = null;
  const pending = new Set();
  const flush = () => {
    timer = null;
    for (const op of pending) {
      const st = keys.get(op);
      const wire = opToWire(op);
      const p = wire.p.slice(st.sent * 2);
      if (!p.length && st.sent) continue;
      live.send(groupId, channel, { ...envelope(), k: st.k, c: wire.c, w: wire.w, t: wire.t, p });
      st.sent = op.type === 'stroke' ? op.points.length : 1;
    }
    pending.clear();
  };
  return {
    onOp(op, phase) {
      if (!keys.has(op)) keys.set(op, { k: `${Date.now().toString(36)}${(n++).toString(36)}`, sent: 0 });
      pending.add(op);
      if (phase === 'end') flush();
      else timer ??= setTimeout(flush, 50);
    },
    undo(op) {
      const st = op && keys.get(op);
      if (st) live.send(groupId, channel, { ...envelope(), k: st.k, undo: true });
    },
    stop: () => clearTimeout(timer),
  };
}

// --- "Un petit dessin" ------------------------------------------------------------------------

export function drawScreen(groupId, query = new URLSearchParams()) {
  const err = errorBox();
  const subtitle = h('span', { class: 'small muted' });
  const baseId = Number(query.get('base')) || null;
  const baseUrl = MEDIA_URL.test(query.get('img') ?? '') ? query.get('img') : null;
  let lastTyping = 0;
  const board = createBoard({
    onOp: () => {
      if (Date.now() - lastTyping > 3000) {
        lastTyping = Date.now();
        live.typing(groupId, 'draw');
      }
    },
  });
  if (baseUrl) loadImage(baseUrl).then((img) => board.setBase(img)).catch(() => err.show(tr('Impossible de charger l’image de fond')));
  const undoBtn = iconButton('undo', tr('Annuler le dernier trait'), () => board.undo());
  const redoBtn = iconButton('redo', tr('Rétablir'), () => board.redo());
  const send = primaryButton(tr('Envoyer le dessin'), null, { iconName: 'send' });
  board.onChange(() => {
    undoBtn.disabled = !board.canUndo;
    redoBtn.disabled = !board.canRedo;
    send.disabled = !board.canUndo;
  });

  send.addEventListener('click', async () => {
    send.disabled = true;
    err.show(null);
    try {
      const blob = await board.exportPng();
      await api.sendMedia(groupId, 'drawing', blob, 'dessin.png', {
        width: EXPORT,
        height: EXPORT,
        ops: JSON.stringify(board.ops.map(opToWire)),
        ...(baseId ? { base: baseId } : {}),
      });
      back(`/chat/${groupId}`);
    } catch (e) {
      err.show(e.message);
      send.disabled = false;
    }
  });

  api.group(groupId).then((g) => (subtitle.textContent = `pour ${g.name}`)).catch(() => {});

  const el = h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'scroll', style: { gap: '14px' } },
      h(
        'div',
        { class: 'row' },
        iconButton('close', tr('Fermer le dessin'), () => back(`/chat/${groupId}`)),
        h('div', { class: 'col grow', style: { gap: 0 } }, h('h1', { class: 'title' }, baseUrl ? tr('Dessiner dessus') : tr('Un petit dessin')), subtitle),
        undoBtn,
        redoBtn,
      ),
      board.el,
      board.toolbar(),
      err,
      h('div', { class: 'grow' }),
      send,
    ),
  );
  return { el, destroy: () => board.destroy() };
}

// --- "Toile commune": everyone draws on the same canvas, live --------------------------------

export function liveDrawScreen(groupId) {
  let session_ = null;
  let members = new Map();
  const err = errorBox();
  const artistsRow = h('div', { class: 'row artists', 'aria-label': tr('Artistes') });
  const subtitle = h('span', { class: 'small muted' }, tr('En direct'));
  const mine = [];
  const stream = streamer(groupId, 'draw', () => ({ sid: session_?.id }));
  const board = createBoard({
    onOp: (op, phase) => {
      if (phase === 'start' || (phase === 'end' && !mine.includes(op))) mine.push(op);
      if (session_) stream.onOp(op, phase);
    },
  });
  const undoBtn = iconButton('undo', tr('Annuler mon dernier trait'), () => {
    const op = mine.pop();
    if (!op) return;
    const i = board.ops.indexOf(op);
    if (i >= 0) board.ops.splice(i, 1);
    stream.undo(op);
    board.redraw();
  });
  const send = primaryButton(tr('Envoyer'), null, { iconName: 'send' });

  function paintArtists() {
    const ids = session_?.artists ?? [];
    subtitle.textContent = tr`En direct · ${ids.length} artiste${ids.length > 1 ? 's' : ''}`;
    clear(artistsRow, ids.map((id) => avatar(members.get(id) ?? { name: '?', color: 'lilas' }, 32, { initial: true })));
  }

  async function load() {
    try {
      const [ms, s] = await Promise.all([api.members(groupId), api.liveDraw(groupId)]);
      members = new Map(ms.map((m) => [m.id, m]));
      session_ = s ?? (await api.startLiveDraw(groupId));
      if (session_.base?.url) board.setBase(await loadImage(session_.base.url));
      board.reset(session_.strokes ?? []);
      paintArtists();
    } catch (e) {
      err.show(e.message);
    }
  }

  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      const blob = await board.exportPng();
      await api.sendMedia(groupId, 'drawing', blob, 'toile.png', {
        width: EXPORT,
        height: EXPORT,
        ops: JSON.stringify(board.ops.map(opToWire)),
        live: '1',
        artists: JSON.stringify(session_?.artists ?? [session.me.id]),
        ...(session_?.base ? { base: session_.base.messageId } : {}),
      });
      back(`/chat/${groupId}`);
    } catch (e) {
      err.show(e.message);
      send.disabled = false;
    }
  });

  const offs = [
    live.on('live', (e) => {
      if (e.groupId !== groupId || e.channel !== 'draw' || e.data?.sid !== session_?.id) return;
      board.applyRemote(`${e.userId}:${e.data.k}`, e.data);
      if (!session_.artists.includes(e.userId)) {
        session_.artists.push(e.userId);
        paintArtists();
      }
    }),
    live.on('livedraw', (e) => {
      if (e.groupId !== groupId) return;
      if (!e.session) {
        err.show(tr('La toile a été envoyée dans le groupe'));
        send.disabled = true;
        setTimeout(() => back(`/chat/${groupId}`), 1200);
      }
    }),
    live.on('reconnected', load),
  ];

  load();
  const el = h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'scroll', style: { gap: '14px' } },
      h(
        'div',
        { class: 'row' },
        iconButton('back', tr('Retour au groupe'), () => back(`/chat/${groupId}`)),
        h('div', { class: 'col grow', style: { gap: 0 } }, h('h1', { class: 'title' }, tr('Toile commune')), subtitle),
        undoBtn,
      ),
      artistsRow,
      board.el,
      board.toolbar(),
      err,
      h(
        'div',
        { class: 'row' },
        button(tr('Arrêter sans envoyer'), async () => {
          await api.endLiveDraw(groupId).catch(() => {});
          back(`/chat/${groupId}`);
        }, { small: true }),
        h('div', { class: 'grow' }),
        send,
      ),
    ),
  );
  return {
    el,
    destroy() {
      offs.forEach((off) => off());
      stream.stop();
      board.destroy();
    },
  };
}

// --- a drawing, its timelapse, and what can be done with it -------------------------------------

export function drawingScreen(messageId, query) {
  const groupId = Number(query.get('g'));
  const err = errorBox();
  const canvas = h('canvas', { class: 'timelapse', role: 'img', 'aria-label': tr('Dessin') });
  const layer = document.createElement('canvas');
  const bar = h('div', { class: 'progress-fill' });
  const head = h('div', { class: 'row' });
  const actions = h('div', { class: 'col', style: { gap: '10px' } });
  let message = null;
  let ops = null;
  let base = null;
  let speed = 1;
  let anim = 0;

  function paintAt(fraction) {
    const size = canvas.width;
    if (!ops) return;
    // Replay point by point: the same order the artist drew in.
    const total = ops.reduce((n, o) => n + (o.type === 'stroke' ? o.points.length : 1), 0);
    let budget = Math.round(total * fraction);
    const partial = [];
    for (const o of ops) {
      if (budget <= 0) break;
      if (o.type === 'stroke') {
        partial.push({ ...o, points: o.points.slice(0, budget) });
        budget -= o.points.length;
      } else {
        partial.push(o);
        budget--;
      }
    }
    render(canvas.getContext('2d'), size, size, partial, layer, base);
    bar.style.width = `${Math.round(fraction * 100)}%`;
  }

  function play() {
    cancelAnimationFrame(anim);
    const start = performance.now();
    const length = 6000 / speed;
    const step = (t) => {
      const f = Math.min(1, (t - start) / length);
      paintAt(f);
      if (f < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  async function load() {
    try {
      const [around, members] = await Promise.all([api.messagesAround(groupId, messageId), api.members(groupId)]);
      message = around.find((m) => m.id === messageId);
      if (!message || message.deleted) throw new Error(tr('Ce dessin a été supprimé'));
      const author = members.find((m) => m.id === message.authorId);
      clear(
        head,
        iconButton('back', tr('Retour'), () => back(`/chat/${groupId}`)),
        avatar(author ?? { name: '?', color: 'lilas' }, 40, { initial: true }),
        h(
          'div',
          { class: 'col grow', style: { gap: 0 } },
          h('h1', { class: 'title', style: { fontSize: '20px' } }, message.meta?.live ? tr('Toile commune') : tr('Dessin')),
          h('span', { class: 'small muted' }, `${author?.name ?? tr('Ancien membre')} · ${dayLabel(message.createdAt).toLowerCase()} ${timeOf(message.createdAt)}${message.meta?.strokes ? tr` · ${message.meta.strokes} traits` : ''}`),
        ),
      );
      canvas.width = canvas.height = 720;
      if (message.meta?.base) {
        const b = await api.messagesAround(groupId, message.meta.base).catch(() => []);
        const src = b.find((m) => m.id === message.meta.base)?.media?.url;
        if (src) base = await loadImage(src).catch(() => null);
      }
      if (message.meta?.opsId) {
        const res = await fetch(`/api/media/${message.meta.opsId}`, { credentials: 'same-origin' });
        if (res.ok) ops = ((await res.json()).strokes ?? []).map(opFromWire);
      }
      if (ops) play();
      else {
        const img = await loadImage(message.media.url);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        bar.style.width = '100%';
      }
      renderActions();
    } catch (e) {
      err.show(e.message);
    }
  }

  function renderActions() {
    const speeds = h(
      'div',
      { class: 'segmented', role: 'group', 'aria-label': tr('Vitesse du timelapse') },
      [1, 4].map((v) => h('button', { type: 'button', 'aria-pressed': String(speed === v), onclick: () => ((speed = v), renderActions(), play()) }, `×${v}`)),
    );
    let stickerDone = false;
    const stickerBtn = button(tr('En faire un sticker'), async () => {
      if (stickerDone) return;
      try {
        await api.makeSticker(groupId, messageId);
        stickerDone = true;
        clear(stickerBtn, icon('check', 20), tr('Sticker créé !'));
      } catch (e) {
        err.show(e.message);
      }
    }, { iconName: 'sticker' });
    clear(
      actions,
      ops && h('div', { class: 'row' }, h('div', { class: 'progress grow', 'aria-hidden': 'true' }, bar), iconButton('play', tr('Rejouer le timelapse'), play), speeds),
      h(
        'div',
        { class: 'row wrap' },
        stickerBtn,
        button(tr('Dessiner dessus'), () => go(`/draw/${groupId}?base=${messageId}&img=${encodeURIComponent(message.media.url)}`), { iconName: 'pencil' }),
        h('a', { class: 'btn', href: message.media.url, download: `dessin-${messageId}.png` }, icon('download', 20), tr('Télécharger')),
      ),
    );
  }

  load();
  const el = h(
    'div',
    { class: 'screen' },
    h('div', { class: 'scroll', style: { gap: '14px' } }, head, h('div', { class: 'canvas-wrap' }, canvas), actions, err),
  );
  return { el, destroy: () => cancelAnimationFrame(anim) };
}
