import { tr } from './i18n.js';
// REST client and live connection. The browser session is an HttpOnly cookie set by /api/join.

const FRIENDLY = {
  invalid_code: tr('Ce code n’existe pas ou a été révoqué'),
  code_expired: tr('Ce code a expiré'),
  code_used: tr('Ce code a déjà servi'),
  too_many_attempts: tr('Trop d’essais, réessaie dans quelques minutes'),
  unauthorized: tr('Ta session a expiré, reconnecte-toi'),
  group_not_found: tr('Ce groupe n’existe plus'),
  file_too_large: tr('Fichier trop lourd'),
  unsupported_media: tr('Format de fichier non pris en charge'),
  not_group_admin: tr('Réservé aux admins du groupe'),
  not_group_owner: tr('Réservé à la personne qui a créé le groupe'),
  too_many_reactions: tr('Ce message a déjà trop de réactions différentes'),
  invalid_personal_code: tr('Ce code personnel est inconnu (il a peut-être été régénéré)'),
  same_account: tr('C’est le code de ce compte-ci : entre celui de ton autre compte'),
  totp_required: tr('Entre le code de ton application d’authentification'),
  totp_invalid: tr('Code incorrect ou déjà utilisé'),
  direct_group: tr('Pas possible dans une discussion à deux'),
  contact_not_found: tr('Tu ne peux écrire qu’aux personnes de tes groupes'),
  muted: tr('Tu es en sourdine dans ce groupe pour l’instant'),
  gifs_disabled: tr('Les GIF ne sont pas activés sur ce serveur'),
  gifs_unavailable: tr('GIPHY ne répond pas pour l’instant'),
  not_your_turn: tr('Ce n’est pas ton tour'),
  not_a_player: tr('Cette partie se joue à deux, et tu n’en fais pas partie'),
  waiting_opponent: tr('On attend encore quelqu’un pour jouer'),
  game_over: tr('La partie est terminée'),
  poll_closed: tr('Le sondage est terminé'),
  location_ended: tr('Le partage de position est terminé'),
  not_enough_messages: tr('Pas encore assez de messages dans le groupe pour ce jeu'),
  not_enough_players: tr('Il faut au moins deux joueurs'),
  too_many_pins: tr('Déjà 30 messages épinglés'),
};

/** "Firefox sur Linux", "Safari sur iPhone (app)": shown in "Mes appareils" on the person's other devices. */
function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? ' (app)' : '';
  return `${browser}${os ? ` sur ${os}` : ''}${app}`;
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: { 'X-Papote-Client': 'web', 'X-Papote-Device': encodeURIComponent(deviceLabel()) } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'network', tr('Impossible de joindre le serveur'));
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.error ?? `http_${res.status}`;
    const message = FRIENDLY[code] ?? (res.status < 500 && data?.message) ?? tr`Oups, le serveur a eu un souci (${res.status})`;
    const err = new ApiError(res.status, code, message);
    if (res.status === 401 && path !== '/api/me') window.dispatchEvent(new CustomEvent('papote:logout'));
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  server: () => call('GET', '/api/server'),
  join: (code, name, color) => call('POST', '/api/join', { code, name, color }),
  link: (code, totp) => call('POST', '/api/link', { code, totp }),
  personalCode: () => call('GET', '/api/me/code'),
  regeneratePersonalCode: () => call('POST', '/api/me/code'),
  merge: (code, totp) => call('POST', '/api/me/merge', { code, totp }),
  startTotp: () => call('POST', '/api/me/2fa/start'),
  confirmTotp: (code) => call('POST', '/api/me/2fa/confirm', { code }),
  disableTotp: (code) => call('POST', '/api/me/2fa/disable', { code }),
  contacts: () => call('GET', '/api/contacts'),
  pushKey: () => call('GET', '/api/push/key'),
  pushSubscribe: (sub) => call('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint) => call('DELETE', '/api/push/subscribe', { endpoint }),
  direct: (userId) => call('POST', '/api/direct', { userId }),
  devices: () => call('GET', '/api/me/devices'),
  revokeDevice: (id) => call('DELETE', `/api/me/devices/${id}`),
  me: () => call('GET', '/api/me'),
  updateMe: (changes) => call('PATCH', '/api/me', changes),
  setPhoto: (blob) => {
    const f = new FormData();
    f.append('file', blob, 'avatar.jpg');
    return call('PUT', '/api/me/photo', f);
  },
  deletePhoto: () => call('DELETE', '/api/me/photo'),
  logout: () => call('POST', '/api/logout'),

  groups: () => call('GET', '/api/groups'),
  group: (id) => call('GET', `/api/groups/${id}`),
  createGroup: (name, color, icon) => call('POST', '/api/groups', { name, color, icon }),
  updateGroup: (id, changes) => call('PATCH', `/api/groups/${id}`, changes),
  deleteGroup: (id) => call('DELETE', `/api/groups/${id}`),
  leaveGroup: (id) => call('POST', `/api/groups/${id}/leave`),
  setGroupPhoto: (id, blob) => {
    const f = new FormData();
    f.append('file', blob, 'groupe.jpg');
    return call('PUT', `/api/groups/${id}/photo`, f);
  },
  deleteGroupPhoto: (id) => call('DELETE', `/api/groups/${id}/photo`),

  members: (id) => call('GET', `/api/groups/${id}/members`),
  setRole: (id, uid, role) => call('PATCH', `/api/groups/${id}/members/${uid}`, { role }),
  removeMember: (id, uid) => call('DELETE', `/api/groups/${id}/members/${uid}`),

  invites: (id) => call('GET', `/api/groups/${id}/invites`),
  createInvite: (id, expiresIn, singleUse) => call('POST', `/api/groups/${id}/invites`, { expiresIn, singleUse }),
  revokeInvite: (code) => call('DELETE', `/api/invites/${enc(code)}`),

  messages: (id, before) => call('GET', `/api/groups/${id}/messages?limit=50${before ? `&before=${before}` : ''}`),
  messagesAround: (id, mid) => call('GET', `/api/groups/${id}/messages?limit=60&around=${mid}`),
  messagesAfter: (id, mid) => call('GET', `/api/groups/${id}/messages?limit=100&after=${mid}`),
  sendText: (id, text, replyTo = null) => call('POST', `/api/groups/${id}/messages`, { text, ...(replyTo ? { replyTo } : {}) }),
  sendMedia: (id, type, blob, filename, fields = {}) => {
    const f = new FormData();
    f.append('type', type);
    for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
    f.append('file', blob, filename);
    return call('POST', `/api/groups/${id}/media`, f);
  },
  deleteMessage: (mid) => call('DELETE', `/api/messages/${mid}`),
  react: (mid, kind, on) => call(on ? 'PUT' : 'DELETE', `/api/messages/${mid}/reactions/${enc(kind)}`),
  markRead: (id, messageId) => call('POST', `/api/groups/${id}/read`, { messageId }),

  // Members waiting for approval, mute, group settings
  pendingGroups: () => call('GET', '/api/me/pending'),
  approve: (id, uid) => call('POST', `/api/groups/${id}/members/${uid}/approve`),
  refuse: (id, uid) => call('POST', `/api/groups/${id}/members/${uid}/refuse`),
  mute: (id, uid, duration) => call('PUT', `/api/groups/${id}/members/${uid}/mute`, { duration }),
  unmute: (id, uid) => call('DELETE', `/api/groups/${id}/members/${uid}/mute`),
  groupSettings: (id, changes) => call('PATCH', `/api/groups/${id}/settings`, changes),

  // Pins, search, gallery
  pins: (id) => call('GET', `/api/groups/${id}/pins`),
  pin: (mid, on) => call(on ? 'PUT' : 'DELETE', `/api/messages/${mid}/pin`),
  search: (id, params) => call('GET', `/api/groups/${id}/search?${new URLSearchParams(params)}`),
  gallery: (id, params = {}) => call('GET', `/api/groups/${id}/gallery?${new URLSearchParams(params)}`),

  // Polls, location
  sendPoll: (id, question, options, multiple) => call('POST', `/api/groups/${id}/polls`, { question, options, multiple }),
  vote: (mid, options) => call('PUT', `/api/messages/${mid}/vote`, { options }),
  closePoll: (mid) => call('POST', `/api/messages/${mid}/close`),
  sendLocation: (id, pos) => call('POST', `/api/groups/${id}/location`, pos),
  moveLocation: (mid, pos) => call('PATCH', `/api/messages/${mid}/location`, pos),
  stopLocation: (mid) => call('DELETE', `/api/messages/${mid}/location`),

  // Stories
  stories: (id) => call('GET', `/api/groups/${id}/stories`),
  postStory: (id, blob, caption) => {
    const f = new FormData();
    if (caption) f.append('caption', caption);
    f.append('file', blob, 'story.jpg');
    return call('POST', `/api/groups/${id}/stories`, f);
  },
  viewStory: (sid) => call('POST', `/api/stories/${sid}/view`),
  deleteStory: (sid) => call('DELETE', `/api/stories/${sid}`),

  // GIFs, stickers, favourites
  gifsTrending: (offset = 0) => call('GET', `/api/gifs/trending?offset=${offset}`),
  gifsSearch: (q, offset = 0) => call('GET', `/api/gifs/search?q=${enc(q)}&offset=${offset}`),
  sendGif: (id, gifId) => call('POST', `/api/groups/${id}/gif`, { id: gifId }),
  stickers: (id) => call('GET', `/api/groups/${id}/stickers`),
  makeSticker: (id, messageId) => call('POST', `/api/groups/${id}/stickers`, { messageId }),
  uploadSticker: (id, blob) => {
    const f = new FormData();
    f.append('file', blob, 'sticker.png');
    return call('POST', `/api/groups/${id}/stickers`, f);
  },
  deleteSticker: (sid) => call('DELETE', `/api/stickers/${sid}`),
  sendSticker: (id, sticker) => call('POST', `/api/groups/${id}/sticker`, sticker),
  favorites: () => call('GET', '/api/me/favorites'),
  addFavorite: (kind, ref, data) => call('PUT', '/api/me/favorites', { kind, ref: String(ref), data }),
  removeFavorite: (kind, ref) => call('DELETE', `/api/me/favorites/${enc(kind)}/${enc(ref)}`),

  // Shared drawing, games, recap
  liveDraw: (id) => call('GET', `/api/groups/${id}/live-draw`),
  startLiveDraw: (id, base) => call('POST', `/api/groups/${id}/live-draw`, { base }),
  endLiveDraw: (id) => call('DELETE', `/api/groups/${id}/live-draw`),
  games: (id) => call('GET', `/api/groups/${id}/games`),
  newGame: (id, kind, opponentId) => call('POST', `/api/groups/${id}/games`, { kind, opponentId }),
  game: (gid) => call('GET', `/api/games/${gid}`),
  move: (gid, body) => call('POST', `/api/games/${gid}/move`, body),
  quitGame: (gid) => call('DELETE', `/api/games/${gid}`),
  recap: (id, month) => call('GET', `/api/groups/${id}/recap${month ? `?month=${month}` : ''}`),
  shareRecap: (id, month) => call('POST', `/api/groups/${id}/recap/share`, { month }),
  /** A same-origin link the browser downloads with the session cookie. */
  exportUrl: (id) => `/api/groups/${id}/export`,
  qrUrl: (data) => `/api/qr?data=${enc(data)}`,
};

/** One WebSocket while the page is visible, reconnecting with backoff. Emits DOM events by server event type. */
class Realtime extends EventTarget {
  #ws = null;
  #wanted = false;
  #attempt = 0;
  #timer = null;
  connected = false;

  start() {
    this.#wanted = true;
    if (!this.#ws) this.#connect();
  }

  stop() {
    this.#wanted = false;
    clearTimeout(this.#timer);
    this.#ws?.close(1000);
    this.#ws = null;
    this.#setConnected(false);
  }

  on(type, fn) {
    const handler = (e) => fn(e.detail);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }

  typing(groupId, kind = 'text') {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify({ type: 'typing', groupId, kind }));
  }

  /** Live strokes (shared drawing, Pictionary), relayed by the server to the rest of the group. */
  send(groupId, channel, data) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify({ type: 'live', groupId, channel, data }));
  }

  #setConnected(v) {
    if (this.connected === v) return;
    this.connected = v;
    this.dispatchEvent(new CustomEvent('connection', { detail: v }));
  }

  #connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.#ws = ws;
    ws.onopen = () => {
      this.#attempt = 0;
      this.#setConnected(true);
      this.dispatchEvent(new CustomEvent('reconnected'));
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg?.type) this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    };
    ws.onclose = (e) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#setConnected(false);
      if (e.code === 4001) {
        window.dispatchEvent(new CustomEvent('papote:logout'));
        return;
      }
      if (!this.#wanted) return;
      const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.#attempt++, 5));
      this.#timer = setTimeout(() => this.#wanted && !this.#ws && this.#connect(), wait);
    };
  }
}

export const live = new Realtime();
