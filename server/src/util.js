import crypto from 'node:crypto';

export const COLORS = ['rose', 'peche', 'menthe', 'ciel', 'citron', 'lilas'];
export const GROUP_ICONS = [
  'heart', 'house', 'leaf', 'dice', 'star', 'music', 'game', 'book', 'sun', 'moon',
  'coffee', 'plane', 'gift', 'paw', 'briefcase', 'ball', 'palette', 'car', 'school', 'camera',
];
export const REACTIONS = ['heart', 'star', 'laugh', 'popcorn', 'thumb'];
export const MAX_REACTION_KINDS = 20;
export const SESSION_COOKIE = 'papote_session';

const segmenter = new Intl.Segmenter('fr', { granularity: 'grapheme' });
const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

// A reaction is one of the mockup's icon keys, or exactly one emoji (flags, skin tones and ZWJ families included).
export function isReaction(kind) {
  if (typeof kind !== 'string' || kind.length === 0 || kind.length > 32) return false;
  if (REACTIONS.includes(kind)) return true;
  const graphemes = [...segmenter.segment(kind)];
  return graphemes.length === 1 && PICTO.test(kind) && !/[\s<>&"']/.test(kind);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* malformed cookie: ignore */
      }
    }
  }
  return out;
}

export const ROLES = ['owner', 'admin', 'member'];

// No 0/O, 1/I/L: codes are read aloud and typed on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const EXPIRIES = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  never: null,
};

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export const now = () => Date.now();

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function makeCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out.slice(0, 3) + '-' + out.slice(3);
}

// A person's own permanent code (Paramètres): longer than invitations since it never expires.
export function makePersonalCode() {
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out.slice(0, 4) + '-' + out.slice(4);
}

export function normalizePersonalCode(input) {
  const raw = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 8) return null;
  return raw.slice(0, 4) + '-' + raw.slice(4);
}

// Accepts "k7p2q9", "K7P-2Q9", "k7p 2q9"…
export function normalizeCode(input) {
  const raw = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 6) return null;
  return raw.slice(0, 3) + '-' + raw.slice(3);
}

export function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+$/u, '').replace(/^\s+/u, '');
  return t.length === 0 ? null : t.slice(0, max);
}

export function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function userDto(u, { online = false } = {}) {
  return {
    id: u.id,
    name: u.name,
    bio: u.bio,
    birthday: u.birthday ?? null,
    color: u.color,
    photo: u.photo_media_id ? `/api/media/${u.photo_media_id}` : null,
    online,
    lastSeenAt: u.last_seen_at ?? null,
    mood: u.mood ?? null,
  };
}

export const MOODS = ['dispo', 'fatigue', 'jeu', 'cine', 'dnd'];
// Chat backgrounds: simple ones drawn in CSS, illustrated ones as small repeated drawings.
export const PATTERNS = ['none', 'dots', 'stripes', 'grid', 'hearts', 'stars', 'waves', 'leaves', 'confetti', 'clouds', 'paws', 'notes'];

/** A group's settings with their defaults (stored as JSON, partial). */
export function groupSettings(raw) {
  let s = {};
  try {
    s = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
  } catch {
    s = {};
  }
  return {
    pattern: PATTERNS.includes(s.pattern) ? s.pattern : 'none',
    reactions: Array.isArray(s.reactions) && s.reactions.length ? s.reactions.slice(0, 8) : ['heart', 'star', 'laugh', 'popcorn', 'thumb'],
    birthdays: s.birthdays !== false,
    approval: !!s.approval,
    adminsTheme: !!s.adminsTheme,
    anyoneInvites: s.anyoneInvites !== false,
  };
}

export function groupDto(g) {
  return {
    id: g.id,
    name: g.name,
    color: g.color,
    icon: g.icon,
    photo: g.photo_media_id ? `/api/media/${g.photo_media_id}` : null,
    // A picture behind the messages, chosen in the group's settings.
    wallpaper: g.wallpaper_media_id ? `/api/media/${g.wallpaper_media_id}` : null,
    direct: !!g.direct,
    settings: groupSettings(g.settings),
    createdAt: g.created_at,
  };
}

export function inviteDto(i) {
  return {
    code: i.code,
    groupId: i.group_id ?? null,
    expiresAt: i.expires_at ?? null,
    maxUses: i.max_uses ?? null,
    uses: i.uses,
    revoked: !!i.revoked,
    createdAt: i.created_at,
  };
}

export const VOICE_FILTERS = ['souris', 'robot', 'echo', 'geant'];

/** A drawing's strokes: [{c: colour, w: width, t: tool, p: [x, y, x, y…]}] in a 1000×1000 space. */
export function cleanOps(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.strokes) ? raw.strokes : null;
  if (!list || list.length === 0 || list.length > 5000) return null;
  let points = 0;
  const strokes = [];
  for (const s of list) {
    if (!s || !Array.isArray(s.p) || s.p.length < 2 || s.p.length > 20000) return null;
    points += s.p.length;
    if (points > 400000) return null;
    strokes.push({
      c: typeof s.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.c) ? s.c : '#2E2442',
      w: Math.max(1, Math.min(200, Math.round(Number(s.w) || 8))),
      t: ['pen', 'marker', 'eraser', 'fill', 'stamp'].includes(s.t) ? s.t : 'pen',
      ...(typeof s.s === 'string' && s.s.length <= 16 ? { s: s.s } : {}),
      p: s.p.map((v) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0)))),
    });
  }
  return { v: 1, strokes };
}
