import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  COLORS,
  EXPIRIES,
  GROUP_ICONS,
  HttpError,
  MAX_REACTION_KINDS,
  MOODS,
  REACTIONS,
  SESSION_COOKIE,
  cleanText,
  groupDto,
  inviteDto,
  normalizeCode,
  normalizePersonalCode,
  now,
  isReaction,
  makePersonalCode,
  parseCookies,
  pick,
  randomToken,
  sha256,
  userDto,
  VOICE_FILTERS,
  cleanOps,
} from './util.js';
import { tx } from './db.js';
import { renderSVG } from 'uqr';
import { newSecret, otpauthUrl, verifyTotp } from './admin/totp.js';
import { rateLimit } from './ratelimit.js';
import { createFeatures } from './features.js';

const MEDIA_RULES = {
  photo: { max: 15 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
  drawing: { max: 5 * 1024 * 1024, mimes: ['image/png', 'image/webp'] },
  avatar: { max: 5 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
  group: { max: 5 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
  gif: { max: 15 * 1024 * 1024, mimes: ['image/gif', 'image/webp'] },
  sticker: { max: 2 * 1024 * 1024, mimes: ['image/png', 'image/webp', 'image/gif', 'image/jpeg'] },
  story: { max: 15 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
  voice: {
    max: 10 * 1024 * 1024,
    mimes: ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/opus'],
  },
};

const MAGIC = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))],
  ['image/gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

function sniffImage(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  return MAGIC.find(([, test]) => test(head))?.[0] ?? null;
}

const intParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'bad_id');
  return n;
};

export function createApi({ store, hub, push, dataDir, serverName, version, gifs = null, whisper = null }) {
  const router = express.Router();
  const { q } = store;
  const mediaDir = path.join(dataDir, 'media');
  const upload = multer({
    dest: path.join(dataDir, 'tmp'),
    // fieldSize: a drawing's strokes (for its timelapse) come as a text field next to the picture.
    limits: { fileSize: Math.max(...Object.values(MEDIA_RULES).map((r) => r.max)), files: 1, fields: 12, fieldSize: 2 * 1024 * 1024 },
  });

  router.use(express.json({ limit: '64kb' }));

  // --- auth -----------------------------------------------------------------

  function authenticate(token) {
    if (!token || typeof token !== 'string') return null;
    const hash = sha256(token);
    const row = q(
      'SELECT users.*, tokens.last_used_at AS token_used FROM tokens JOIN users ON users.id = tokens.user_id WHERE tokens.hash = ?',
    ).get(hash);
    if (!row || row.disabled) return null;
    if (now() - row.token_used > 60_000) {
      q('UPDATE tokens SET last_used_at = ? WHERE hash = ?').run(now(), hash);
      q('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), row.id);
    }
    return row;
  }

  function bearer(req) {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : null;
  }

  // The web app authenticates with an HttpOnly cookie (so <img src> works for media), the Android app with a bearer token.
  function sessionToken(req) {
    return bearer(req) ?? parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;
  }

  const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

  function requireUser(req, _res, next) {
    const viaCookie = !bearer(req);
    const user = authenticate(sessionToken(req));
    if (!user) return next(new HttpError(401, 'unauthorized'));
    // Cookie is SameSite=Strict already; also refuse cross-site writes outright.
    if (viaCookie && !SAFE_METHODS.includes(req.method)) {
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin') return next(new HttpError(403, 'cross_site'));
    }
    req.user = user;
    next();
  }

  function setSessionCookie(req, res, token, maxAge = 365 * 24 * 3600) {
    res.append(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`,
    );
  }

  const isWebClient = (req) => req.headers['x-papote-client'] === 'web';

  // "Android · Pixel 8", "Firefox sur Linux"… sent by the client so people recognise their devices.
  // Header values must be ASCII, so clients send the label URL-encoded.
  const deviceLabel = (req) => {
    try {
      return cleanText(decodeURIComponent(req.headers['x-papote-device'] ?? ''), 60);
    } catch {
      return null;
    }
  };

  function issueToken(userId, label) {
    const token = randomToken();
    const ts = now();
    q('INSERT INTO tokens (hash, user_id, created_at, last_used_at, label) VALUES (?, ?, ?, ?, ?)').run(sha256(token), userId, ts, ts, label ?? null);
    return token;
  }

  const meDto = (u) => ({ ...userDto(u, { online: true }), totp: !!u.totp_secret });

  const memberDto = (row) => ({
    ...userDto(row, { online: hub.isOnline(row.id) }),
    role: row.role,
    status: row.status ?? 'active',
    mutedUntil: row.muted_until && row.muted_until > now() ? row.muted_until : null,
    joinedAt: row.joined_at,
  });

  function postSystem(groupId, event, extra = {}) {
    const message = store.addMessage({ groupId, userId: null, type: 'system', meta: { event, ...extra } });
    hub.sendToGroup(groupId, { type: 'message.new', message });
  }

  // New messages carry the group and author names so devices can show a notification without asking.
  function broadcastNew(groupId, message, author) {
    const g = q('SELECT name, direct FROM groups WHERE id = ?').get(groupId);
    const groupName = g.direct ? author.name : g.name;
    hub.sendToGroup(groupId, { type: 'message.new', message, groupName, authorName: author.name, direct: !!g.direct });
    // Browsers that aren't on Papote right now get a Web Push notification (not awaited: never slows the sender).
    push.notifyMessage({ groupId, message, authorId: author.id, authorName: author.name, groupName, direct: !!g.direct }).catch(() => {});
  }

  function rejectDirect(groupId, what = 'direct_group') {
    if (q('SELECT direct FROM groups WHERE id = ?').get(groupId)?.direct) {
      throw new HttpError(403, what, 'Pas possible dans une discussion à deux');
    }
  }

  // --- public ---------------------------------------------------------------

  router.get('/server', (_req, res) => {
    res.json({
      name: serverName,
      version,
      reactions: REACTIONS,
      colors: COLORS,
      icons: GROUP_ICONS,
      moods: MOODS,
      // Optional services: the apps hide what isn't set up.
      features: { gifs: !!gifs?.enabled, transcription: !!whisper?.enabled },
    });
  });

  router.post('/join', rateLimit({ windowMs: 10 * 60_000, max: 20 }), (req, res) => {
    const code = normalizeCode(req.body?.code);
    if (!code) throw new HttpError(400, 'invalid_code', 'Le code fait 6 caractères');
    const existing = authenticate(sessionToken(req));
    const name = cleanText(req.body?.name, 40);
    if (!existing && !name) throw new HttpError(400, 'name_required', 'Choisis un petit nom');

    const result = tx(store.db, () => {
      const inv = store.usableInvite(code);
      let user = existing;
      let token = null;
      if (!user) {
        const { lastInsertRowid } = q('INSERT INTO users (name, color, created_at) VALUES (?, ?, ?)').run(
          name,
          pick(req.body?.color, COLORS, 'rose'),
          now(),
        );
        user = store.getUser(Number(lastInsertRowid));
        token = issueToken(user.id, deviceLabel(req));
      }
      return { user, token, ...store.redeemInvite(inv, user.id) };
    });

    if (result.groupId && result.pending) {
      // Waiting for approval: only the group's admins hear about it.
      const admins = q("SELECT user_id FROM members WHERE group_id = ? AND status = 'active' AND role != 'member'").all(result.groupId);
      for (const a of admins) hub.sendToUser(a.user_id, { type: 'member.pending', groupId: result.groupId, userId: result.user.id, name: result.user.name });
    } else if (result.groupId && !result.alreadyMember) {
      const member = q(
        'SELECT users.*, members.role, members.joined_at FROM members JOIN users ON users.id = members.user_id WHERE group_id = ? AND user_id = ?',
      ).get(result.groupId, result.user.id);
      hub.sendToGroup(result.groupId, { type: 'member.joined', groupId: result.groupId, member: memberDto(member) });
      postSystem(result.groupId, 'joined', { userId: result.user.id });
    }
    if (result.token && isWebClient(req)) setSessionCookie(req, res, result.token);
    res.status(result.token ? 201 : 200).json({
      token: isWebClient(req) ? null : result.token,
      user: meDto(result.user),
      groupId: result.pending ? null : result.groupId,
      pending: !!result.pending,
    });
  });

  // Another device for the same account: the person types their own permanent code (Paramètres).
  const personalCodeLimit = rateLimit({ windowMs: 10 * 60_000, max: 20 });

  function userFromPersonalCode(input) {
    const code = normalizePersonalCode(input);
    if (!code) throw new HttpError(400, 'invalid_personal_code', 'Le code personnel fait 8 caractères');
    const user = store.userByPersonalCode(code);
    if (!user) throw new HttpError(404, 'invalid_personal_code', 'Code personnel inconnu');
    return user;
  }

  /** Accounts with 2FA also need the 6-digit code (or a recovery code) to be opened with the personal code. */
  function checkUserTotp(user, input) {
    if (!user.totp_secret) return;
    const value = String(input ?? '').trim().toUpperCase();
    if (!value) throw new HttpError(401, 'totp_required', 'Entre le code de ton application d’authentification');
    if (/^[\d\s]+$/.test(value)) {
      const step = verifyTotp(user.totp_secret, value, { afterStep: user.totp_last_step });
      if (step === null) throw new HttpError(401, 'totp_invalid', 'Code incorrect ou déjà utilisé');
      q('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
      return;
    }
    const raw = value.replace(/[^A-Z0-9]/g, '');
    const hash = sha256(`${raw.slice(0, 4)}-${raw.slice(4)}`);
    const codes = JSON.parse(user.recovery_codes ?? '[]');
    if (raw.length !== 8 || !codes.includes(hash)) throw new HttpError(401, 'totp_invalid', 'Code incorrect ou déjà utilisé');
    q('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.filter((c) => c !== hash)), user.id);
  }

  router.post('/link', personalCodeLimit, (req, res) => {
    const user = userFromPersonalCode(req.body?.code);
    checkUserTotp(user, req.body?.totp);
    const token = issueToken(user.id, deviceLabel(req));
    if (isWebClient(req)) setSessionCookie(req, res, token);
    res.status(201).json({ token: isWebClient(req) ? null : token, user: meDto(user) });
  });

  // --- everything below needs a session ---------------------------------------

  router.use(requireUser);

  router.get('/me', (req, res) => res.json(meDto(req.user)));

  router.patch('/me', (req, res) => {
    const b = req.body ?? {};
    const u = req.user;
    const name = b.name !== undefined ? cleanText(b.name, 40) : u.name;
    if (!name) throw new HttpError(400, 'name_required');
    const bio = b.bio !== undefined ? (cleanText(b.bio, 140) ?? '') : u.bio;
    let birthday = u.birthday;
    if (b.birthday !== undefined) {
      if (b.birthday === null || b.birthday === '') birthday = null;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(b.birthday) || /^--\d{2}-\d{2}$/.test(b.birthday)) birthday = b.birthday;
      else throw new HttpError(400, 'bad_birthday');
    }
    const color = b.color !== undefined ? pick(b.color, COLORS, u.color) : u.color;
    const mood = b.mood !== undefined ? (MOODS.includes(b.mood) ? b.mood : null) : (u.mood ?? null);
    q('UPDATE users SET name = ?, bio = ?, birthday = ?, color = ?, mood = ? WHERE id = ?').run(name, bio, birthday, color, mood, u.id);
    const updated = store.getUser(u.id);
    const event = { type: 'user.updated', user: userDto(updated, { online: true }) };
    for (const uid of hub.contactsOf(u.id)) hub.sendToUser(uid, event);
    res.json(meDto(updated));
  });

  router.get('/me/code', (req, res) => res.json({ code: store.personalCode(req.user.id) }));

  // New code: the old one stops working (devices already signed in stay signed in).
  router.post('/me/code', (req, res) => res.status(201).json({ code: store.personalCode(req.user.id, { fresh: true }) }));

  // --- 2FA on the account: asked when the personal code opens the account on a new device ---------

  router.post('/me/2fa/start', (req, res) => {
    if (req.user.totp_secret) throw new HttpError(409, 'totp_already_enabled');
    const secret = newSecret();
    q('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, req.user.id);
    const url = otpauthUrl(secret, { issuer: serverName, account: req.user.name });
    res.json({ secret, url, qrSvg: renderSVG(url, { border: 4, whiteColor: '#FFFFFF', blackColor: '#2E2442' }) });
  });

  router.post('/me/2fa/confirm', (req, res) => {
    const pending = req.user.totp_pending;
    const step = pending ? verifyTotp(pending, req.body?.code) : null;
    if (step === null) throw new HttpError(400, 'totp_invalid', 'Code incorrect : vérifie l’heure du téléphone et réessaie');
    const codes = Array.from({ length: 10 }, () => {
      const raw = makePersonalCode().replace('-', '');
      return `${raw.slice(0, 4)}-${raw.slice(4)}`;
    });
    q('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_last_step = ?, recovery_codes = ? WHERE id = ?').run(
      pending,
      step,
      JSON.stringify(codes.map((c) => sha256(c))),
      req.user.id,
    );
    res.json({ recoveryCodes: codes });
  });

  router.post('/me/2fa/disable', (req, res) => {
    checkUserTotp(req.user, req.body?.code);
    q('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = -1, recovery_codes = NULL WHERE id = ?').run(req.user.id);
    res.status(204).end();
  });

  // --- Web Push (web app and PWA) ----------------------------------------------------------------

  router.get('/push/key', (_req, res) => res.json({ publicKey: push.publicKey }));

  router.post('/push/subscribe', (req, res) => {
    const ok = push.subscribe(req.user.id, sha256(sessionToken(req)), req.body, req.headers.origin);
    if (!ok) throw new HttpError(400, 'bad_subscription', 'Abonnement aux notifications refusé');
    res.status(204).end();
  });

  router.delete('/push/subscribe', (req, res) => {
    push.unsubscribe(req.user.id, String(req.body?.endpoint ?? ''));
    res.status(204).end();
  });

  // --- people and two-person conversations ---------------------------------------------------

  router.get('/contacts', (req, res) => {
    res.json(store.contacts(req.user.id).map((u) => userDto(u, { online: hub.isOnline(u.id) })));
  });

  router.post('/direct', (req, res) => {
    const other = Number(req.body?.userId);
    if (!store.contacts(req.user.id).some((u) => u.id === other)) {
      throw new HttpError(404, 'contact_not_found', 'Tu ne peux écrire qu’aux personnes de tes groupes');
    }
    const { id, created } = store.directGroup(req.user.id, other);
    if (created) for (const uid of [req.user.id, other]) hub.sendToUser(uid, { type: 'group.updated', group: { id } });
    res.status(created ? 201 : 200).json(store.groupDetail(id, req.user.id));
  });

  // "Fusionner avec mon autre compte": this account is folded into the one whose personal code is given.
  router.post('/me/merge', personalCodeLimit, (req, res) => {
    const target = userFromPersonalCode(req.body?.code);
    if (target.id === req.user.id) throw new HttpError(400, 'same_account', 'C’est déjà ce compte-ci');
    checkUserTotp(target, req.body?.totp);
    const { groups, deletePhoto } = store.mergeUsers(req.user.id, target.id);
    if (deletePhoto) deleteMedia(deletePhoto);
    // Devices of the old account reconnect as the merged one; group screens reload authors and members.
    hub.disconnectUser(req.user.id, 4002, 'account_merged');
    for (const g of groups) hub.sendToGroup(g, { type: 'group.refresh', groupId: g });
    res.json({ user: meDto(store.getUser(target.id)) });
  });

  router.get('/me/devices', (req, res) => {
    const current = sha256(sessionToken(req));
    const rows = q('SELECT rowid AS id, hash, label, created_at, last_used_at FROM tokens WHERE user_id = ? ORDER BY last_used_at DESC').all(req.user.id);
    res.json(
      rows.map((r) => ({
        id: r.id,
        label: r.label ?? 'Appareil',
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
        current: r.hash === current,
        online: hub.isTokenOnline(r.hash),
      })),
    );
  });

  router.delete('/me/devices/:did', (req, res) => {
    const did = intParam(req.params.did);
    const row = q('SELECT hash FROM tokens WHERE rowid = ? AND user_id = ?').get(did, req.user.id);
    if (!row) throw new HttpError(404, 'device_not_found');
    q('DELETE FROM tokens WHERE rowid = ?').run(did);
    hub.disconnectToken(row.hash);
    res.status(204).end();
  });

  router.post('/logout', (req, res) => {
    q('DELETE FROM tokens WHERE hash = ?').run(sha256(sessionToken(req)));
    setSessionCookie(req, res, '', 0);
    res.status(204).end();
  });

  // --- media ------------------------------------------------------------------

  function storeUpload(file, kind, { ownerId, groupId }) {
    const rules = MEDIA_RULES[kind];
    try {
      if (!file) throw new HttpError(400, 'file_required');
      if (file.size > rules.max) throw new HttpError(413, 'file_too_large');
      let mime = file.mimetype;
      if (kind !== 'voice') {
        // Images are checked by their first bytes, never by what the client claims.
        mime = sniffImage(file.path);
        if (!mime) throw new HttpError(415, 'unsupported_media');
      }
      if (!rules.mimes.includes(mime)) throw new HttpError(415, 'unsupported_media');
      const id = crypto.randomBytes(16).toString('hex');
      fs.renameSync(file.path, path.join(mediaDir, id));
      q('INSERT INTO media (id, owner_id, group_id, kind, mime, size, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id,
        ownerId,
        groupId,
        kind,
        mime,
        file.size,
        id,
        now(),
      );
      return { id, mime };
    } catch (err) {
      if (file) fs.rmSync(file.path, { force: true });
      throw err;
    }
  }

  router.put('/me/photo', upload.single('file'), (req, res) => {
    const media = storeUpload(req.file, 'avatar', { ownerId: req.user.id, groupId: null });
    const old = req.user.photo_media_id;
    q('UPDATE users SET photo_media_id = ? WHERE id = ?').run(media.id, req.user.id);
    if (old) deleteMedia(old);
    const updated = store.getUser(req.user.id);
    const event = { type: 'user.updated', user: userDto(updated, { online: true }) };
    for (const uid of hub.contactsOf(req.user.id)) hub.sendToUser(uid, event);
    res.json(meDto(updated));
  });

  router.delete('/me/photo', (req, res) => {
    const old = req.user.photo_media_id;
    q('UPDATE users SET photo_media_id = NULL WHERE id = ?').run(req.user.id);
    if (old) deleteMedia(old);
    res.json(meDto(store.getUser(req.user.id)));
  });

  function deleteMedia(id) {
    const m = q('SELECT file FROM media WHERE id = ?').get(id);
    if (!m) return;
    q('DELETE FROM media WHERE id = ?').run(id);
    fs.rmSync(path.join(mediaDir, m.file), { force: true });
  }

  router.get('/media/:id', (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.id)) throw new HttpError(404, 'not_found');
    const m = q('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!m) throw new HttpError(404, 'not_found');
    if (m.group_id) store.requireMember(m.group_id, req.user.id);
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.sendFile(path.join(mediaDir, m.file), { dotfiles: 'deny', headers: { 'Content-Type': m.mime } });
  });

  // --- groups -----------------------------------------------------------------

  router.get('/groups', (req, res) => res.json(store.groupSummaries(req.user.id)));

  router.post('/groups', (req, res) => {
    const name = cleanText(req.body?.name, 40);
    if (!name) throw new HttpError(400, 'name_required', 'Donne un nom au groupe');
    const id = store.createGroup({
      name,
      color: pick(req.body?.color, COLORS, 'rose'),
      icon: pick(req.body?.icon, GROUP_ICONS, 'heart'),
      ownerId: req.user.id,
    });
    postSystem(id, 'created', { userId: req.user.id });
    res.status(201).json(store.groupDetail(id, req.user.id));
  });

  router.get('/groups/:id', (req, res) => {
    const id = intParam(req.params.id);
    store.requireMember(id, req.user.id);
    res.json(store.groupDetail(id, req.user.id));
  });

  /** Colour, icon, picture: everyone may change them, unless the group keeps that to its admins. */
  function requireThemeRight(groupId, userId) {
    const m = store.requireMember(groupId, userId);
    const settings = groupDto(q('SELECT * FROM groups WHERE id = ?').get(groupId)).settings;
    if (m.role === 'member' && settings.adminsTheme) throw new HttpError(403, 'not_group_admin', 'Seuls les admins changent le thème');
    return m;
  }

  router.patch('/groups/:id', (req, res) => {
    const id = intParam(req.params.id);
    const m = requireThemeRight(id, req.user.id);
    rejectDirect(id);
    const g = q('SELECT * FROM groups WHERE id = ?').get(id);
    const b = req.body ?? {};
    if (b.name !== undefined && m.role === 'member') throw new HttpError(403, 'not_group_admin');
    const name = b.name !== undefined ? cleanText(b.name, 40) : g.name;
    if (!name) throw new HttpError(400, 'name_required');
    q('UPDATE groups SET name = ?, color = ?, icon = ? WHERE id = ?').run(
      name,
      b.color !== undefined ? pick(b.color, COLORS, g.color) : g.color,
      b.icon !== undefined ? pick(b.icon, GROUP_ICONS, g.icon) : g.icon,
      id,
    );
    const group = groupDto(q('SELECT * FROM groups WHERE id = ?').get(id));
    hub.sendToGroup(id, { type: 'group.updated', group });
    res.json(store.groupDetail(id, req.user.id));
  });

  router.delete('/groups/:id', (req, res) => {
    const id = intParam(req.params.id);
    const m = store.requireMember(id, req.user.id);
    if (m.role !== 'owner') throw new HttpError(403, 'not_group_owner');
    // To the trash: the server admin can bring it back for 30 days.
    const { members } = store.trashGroup(id, req.user.name);
    for (const uid of members) hub.sendToUser(uid, { type: 'group.removed', groupId: id });
    res.status(204).end();
  });

  // Group picture instead of the icon (admins only).
  router.put('/groups/:id/photo', upload.single('file'), (req, res) => {
    const id = Number(req.params.id);
    try {
      intParam(id);
      requireThemeRight(id, req.user.id);
      rejectDirect(id);
    } catch (err) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      throw err;
    }
    const media = storeUpload(req.file, 'group', { ownerId: req.user.id, groupId: id });
    const old = q('SELECT photo_media_id FROM groups WHERE id = ?').get(id).photo_media_id;
    q('UPDATE groups SET photo_media_id = ? WHERE id = ?').run(media.id, id);
    if (old) deleteMedia(old);
    hub.sendToGroup(id, { type: 'group.updated', group: groupDto(q('SELECT * FROM groups WHERE id = ?').get(id)) });
    res.json(store.groupDetail(id, req.user.id));
  });

  router.delete('/groups/:id/photo', (req, res) => {
    const id = intParam(req.params.id);
    requireThemeRight(id, req.user.id);
    const old = q('SELECT photo_media_id FROM groups WHERE id = ?').get(id).photo_media_id;
    q('UPDATE groups SET photo_media_id = NULL WHERE id = ?').run(id);
    if (old) deleteMedia(old);
    hub.sendToGroup(id, { type: 'group.updated', group: groupDto(q('SELECT * FROM groups WHERE id = ?').get(id)) });
    res.json(store.groupDetail(id, req.user.id));
  });

  function afterRemoval(groupId, userId, outcome, event) {
    hub.sendToUser(userId, { type: 'group.removed', groupId });
    if (outcome.groupDeleted) return;
    hub.sendToGroup(groupId, { type: 'member.left', groupId, userId });
    if (outcome.newOwnerId) hub.sendToGroup(groupId, { type: 'member.updated', groupId, userId: outcome.newOwnerId, role: 'owner' });
    postSystem(groupId, event, { userId });
  }

  router.post('/groups/:id/leave', (req, res) => {
    const id = intParam(req.params.id);
    store.requireMember(id, req.user.id);
    afterRemoval(id, req.user.id, store.removeMember(id, req.user.id), 'left');
    res.status(204).end();
  });

  router.get('/groups/:id/members', (req, res) => {
    const id = intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const me = store.requireMember(id, req.user.id);
    // People waiting for approval are only shown to admins.
    const rows = q(
      `SELECT users.*, members.role, members.joined_at, members.status, members.muted_until FROM members JOIN users ON users.id = members.user_id
       WHERE group_id = ? AND (status = 'active' OR ?) ORDER BY status, CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, users.name`,
    ).all(id, me.role !== 'member' ? 1 : 0);
    res.json(rows.map(memberDto));
  });

  router.patch('/groups/:id/members/:uid', (req, res) => {
    const id = intParam(req.params.id);
    rejectDirect(id);
    const uid = intParam(req.params.uid);
    const me = store.requireMember(id, req.user.id);
    if (me.role !== 'owner') throw new HttpError(403, 'not_group_owner');
    const target = store.membership(id, uid);
    if (!target || uid === req.user.id) throw new HttpError(404, 'member_not_found');
    const role = req.body?.role;
    if (!['owner', 'admin', 'member'].includes(role)) throw new HttpError(400, 'bad_role');
    tx(store.db, () => {
      if (role === 'owner') q("UPDATE members SET role = 'admin' WHERE group_id = ? AND user_id = ?").run(id, req.user.id);
      q('UPDATE members SET role = ? WHERE group_id = ? AND user_id = ?').run(role, id, uid);
    });
    if (role === 'owner') hub.sendToGroup(id, { type: 'member.updated', groupId: id, userId: req.user.id, role: 'admin' });
    hub.sendToGroup(id, { type: 'member.updated', groupId: id, userId: uid, role });
    res.status(204).end();
  });

  router.delete('/groups/:id/members/:uid', (req, res) => {
    const id = intParam(req.params.id);
    rejectDirect(id);
    const uid = intParam(req.params.uid);
    const me = store.requireAdmin(id, req.user.id);
    const target = store.membership(id, uid);
    if (!target || uid === req.user.id) throw new HttpError(404, 'member_not_found');
    if (target.role === 'owner' || (target.role === 'admin' && me.role !== 'owner')) {
      throw new HttpError(403, 'cannot_remove');
    }
    afterRemoval(id, uid, store.removeMember(id, uid), 'removed');
    res.status(204).end();
  });

  // --- invites ----------------------------------------------------------------

  router.get('/groups/:id/invites', (req, res) => {
    const id = intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const rows = q(
      `SELECT * FROM invites WHERE group_id = ? AND revoked = 0
         AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses)
       ORDER BY created_at DESC`,
    ).all(id, now());
    res.json(rows.map(inviteDto));
  });

  router.post('/groups/:id/invites', (req, res) => {
    const id = intParam(req.params.id);
    const m = store.requireMember(id, req.user.id);
    rejectDirect(id);
    const settings = groupDto(q('SELECT * FROM groups WHERE id = ?').get(id)).settings;
    if (!settings.anyoneInvites && m.role === 'member') throw new HttpError(403, 'not_group_admin', 'Seuls les admins invitent dans ce groupe');
    const expiresKey = req.body?.expiresIn ?? '24h';
    if (!(expiresKey in EXPIRIES)) throw new HttpError(400, 'bad_expiry');
    const invite = store.createInvite({
      groupId: id,
      createdBy: req.user.id,
      expiresIn: EXPIRIES[expiresKey],
      maxUses: req.body?.singleUse ? 1 : null,
    });
    res.status(201).json(invite);
  });

  router.delete('/invites/:code', (req, res) => {
    const code = normalizeCode(req.params.code);
    const inv = code && q('SELECT * FROM invites WHERE code = ?').get(code);
    if (!inv?.group_id) throw new HttpError(404, 'invite_not_found');
    const m = store.requireMember(inv.group_id, req.user.id);
    if (inv.created_by !== req.user.id && m.role === 'member') throw new HttpError(403, 'not_group_admin');
    q('UPDATE invites SET revoked = 1 WHERE code = ?').run(code);
    res.status(204).end();
  });

  // --- messages ---------------------------------------------------------------

  router.get('/groups/:id/messages', (req, res) => {
    const id = intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const before = req.query.before ? intParam(req.query.before) : null;
    const after = req.query.after ? intParam(req.query.after) : null;
    const around = req.query.around ? intParam(req.query.around) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    res.json(store.listMessages(id, { before, after, around, limit }));
  });

  function checkReply(groupId, replyTo) {
    if (replyTo == null) return null;
    const r = q('SELECT group_id FROM messages WHERE id = ?').get(Number(replyTo));
    return r?.group_id === groupId ? Number(replyTo) : null;
  }

  router.post('/groups/:id/messages', (req, res) => {
    const id = intParam(req.params.id);
    store.requireCanPost(id, req.user.id);
    const text = cleanText(req.body?.text, 4000);
    if (!text) throw new HttpError(400, 'text_required');
    const message = store.addMessage({
      groupId: id,
      userId: req.user.id,
      type: 'text',
      text,
      replyTo: checkReply(id, req.body?.replyTo),
    });
    broadcastNew(id, message, req.user);
    res.status(201).json(message);
  });

  router.post('/groups/:id/media', upload.single('file'), (req, res) => {
    const id = Number(req.params.id);
    const kind = req.body?.type;
    try {
      intParam(id);
      store.requireCanPost(id, req.user.id);
      if (!['photo', 'voice', 'drawing'].includes(kind)) throw new HttpError(400, 'bad_type');
    } catch (err) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      throw err;
    }
    const media = storeUpload(req.file, kind, { ownerId: req.user.id, groupId: id });
    const meta = {};
    for (const key of ['durationMs', 'width', 'height']) {
      const n = Number(req.body?.[key]);
      if (Number.isInteger(n) && n > 0 && n < 10_000_000) meta[key] = n;
    }
    if (kind === 'voice' && Array.isArray(safeJson(req.body?.waveform))) {
      meta.waveform = safeJson(req.body.waveform)
        .slice(0, 64)
        .map((v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0))));
    }
    // Voice filter chosen when recording ("Souris", "Robot"…): applied when the message is played.
    if (kind === 'voice' && VOICE_FILTERS.includes(req.body?.filter)) meta.filter = req.body.filter;
    if (kind === 'drawing') {
      // The strokes, kept apart, replay the drawing as a timelapse.
      const ops = cleanOps(safeJson(req.body?.ops));
      if (ops) {
        meta.opsId = storeBuffer(Buffer.from(JSON.stringify(ops)), 'ops', 'application/json', { ownerId: req.user.id, groupId: id });
        meta.strokes = ops.strokes.length;
      }
      const base = Number(req.body?.base);
      if (Number.isInteger(base) && q('SELECT 1 FROM messages WHERE id = ? AND group_id = ?').get(base, id)) meta.base = base;
      if (req.body?.live === '1') meta.live = true;
      const artists = safeJson(req.body?.artists);
      if (Array.isArray(artists)) meta.artists = [...new Set(artists.map(Number).filter((n) => Number.isInteger(n) && store.membership(id, n)))].slice(0, 20);
    }
    if (kind === 'voice' && whisper?.enabled) meta.transcribing = true;
    const ephemeral = req.body?.ephemeral === '1' && kind !== 'voice';
    const message = store.addMessage({
      expiresAt: ephemeral ? now() + 24 * 3600_000 : null,
      groupId: id,
      userId: req.user.id,
      type: kind,
      text: cleanText(req.body?.caption, 1000) ?? '',
      mediaId: media.id,
      meta,
      replyTo: checkReply(id, req.body?.replyTo),
    });
    broadcastNew(id, message, req.user);
    if (kind === 'voice') features.transcribe(message);
    if (meta.live) features.endLive(id);
    res.status(201).json(message);
  });

  function safeJson(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function loadMessage(req) {
    const mid = intParam(req.params.mid);
    const m = q('SELECT * FROM messages WHERE id = ?').get(mid);
    if (!m) throw new HttpError(404, 'message_not_found');
    const membership = store.requireMember(m.group_id, req.user.id);
    return { m, membership };
  }

  router.delete('/messages/:mid', (req, res) => {
    const { m, membership } = loadMessage(req);
    if (m.user_id !== req.user.id && membership.role === 'member') throw new HttpError(403, 'not_your_message');
    eraseMessage(m);
    res.status(204).end();
  });

  router.put('/messages/:mid/reactions/:kind', (req, res) => {
    const { m } = loadMessage(req);
    const kind = req.params.kind;
    if (!isReaction(kind)) throw new HttpError(400, 'bad_reaction');
    if (m.deleted) throw new HttpError(409, 'message_deleted');
    const kinds = q('SELECT DISTINCT kind FROM reactions WHERE message_id = ?').all(m.id).map((r) => r.kind);
    if (!kinds.includes(kind) && kinds.length >= MAX_REACTION_KINDS) throw new HttpError(409, 'too_many_reactions');
    q('INSERT OR IGNORE INTO reactions (message_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(
      m.id,
      req.user.id,
      kind,
      now(),
    );
    const message = store.getMessage(m.id);
    hub.sendToGroup(m.group_id, { type: 'message.updated', message });
    res.json(message);
  });

  router.delete('/messages/:mid/reactions/:kind', (req, res) => {
    const { m } = loadMessage(req);
    q('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND kind = ?').run(m.id, req.user.id, req.params.kind);
    const message = store.getMessage(m.id);
    hub.sendToGroup(m.group_id, { type: 'message.updated', message });
    res.json(message);
  });

  router.post('/groups/:id/read', (req, res) => {
    const id = intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const mid = Number(req.body?.messageId);
    if (Number.isInteger(mid) && mid > 0) {
      q('UPDATE members SET last_read_id = MAX(last_read_id, ?) WHERE group_id = ? AND user_id = ?').run(mid, id, req.user.id);
      // The user's other devices clear their unread badge right away.
      hub.sendToUser(req.user.id, { type: 'group.read', groupId: id, messageId: mid });
    }
    res.status(204).end();
  });

  /** Deletes a message's content for good (by its author, an admin, or once an ephemeral photo is past). */
  function eraseMessage(m) {
    const meta = m.meta ? safeJson(m.meta) : null;
    q("UPDATE messages SET deleted = 1, text = '', meta = NULL, media_id = NULL, pinned_at = NULL, pinned_by = NULL WHERE id = ?").run(m.id);
    q('DELETE FROM reactions WHERE message_id = ?').run(m.id);
    q('DELETE FROM poll_votes WHERE message_id = ?').run(m.id);
    if (m.media_id) deleteMedia(m.media_id);
    if (meta?.opsId) deleteMedia(meta.opsId);
    hub.sendToGroup(m.group_id, { type: 'message.updated', message: store.getMessage(m.id) });
  }

  /** Media made by the server itself (a GIF fetched from GIPHY, a drawing's strokes, a sticker copy). */
  function storeBuffer(buffer, kind, mime, { ownerId, groupId }) {
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(mediaDir, id), buffer);
    q('INSERT INTO media (id, owner_id, group_id, kind, mime, size, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      ownerId,
      groupId,
      kind,
      mime,
      buffer.length,
      id,
      now(),
    );
    return id;
  }

  const features = createFeatures({
    router,
    store,
    hub,
    upload,
    mediaDir,
    gifs,
    whisper,
    helpers: { intParam, storeUpload, storeBuffer, deleteMedia, eraseMessage, broadcastNew, postSystem, memberDto, loadMessage, safeJson, checkReply, requireThemeRight, rejectDirect },
  });

  router.use((_req, _res, next) => next(new HttpError(404, 'not_found')));

  return { router, authenticate, sessionToken, eraseMessage, deleteMedia, features };
}
