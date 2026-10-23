import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderSVG } from 'uqr';
import { HttpError, PATTERNS, cleanText, groupDto, groupSettings, isReaction, now, userDto } from './util.js';
import { GAMES, GAME_KINDS, GAME_NAMES } from './games.js';
import { createZip } from './zip.js';
import { foldText, tx } from './db.js';
import { rateLimit } from './ratelimit.js';

// Everything from the mockup that came after the first version: pinned messages, search, gallery, polls,
// location, stories, group settings and rules, stickers and GIFs, shared drawing, mini-games, monthly recap,
// export. Mounted on the API router (after authentication).

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MUTES = { '1h': 3600_000, '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, forever: 100 * 365 * 24 * 3600_000 };
const GALLERY_TYPES = { drawing: ['drawing'], photo: ['photo'], gif: ['gif'], voice: ['voice'] };
const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'application/json': 'json',
};
const BUILTIN = /^[a-z][a-z0-9-]{0,19}$/;
const GIF_ID = /^[A-Za-z0-9]{4,40}$/;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function createFeatures({ router, store, hub, upload, mediaDir, gifs, whisper, helpers: h }) {
  const { q } = store;
  const groupRow = (id) => q('SELECT * FROM groups WHERE id = ?').get(id);
  const settingsOf = (id) => groupSettings(groupRow(id)?.settings);
  const broadcastGroup = (id) => hub.sendToGroup(id, { type: 'group.updated', group: groupDto(groupRow(id)) });
  const json = (s) => {
    try {
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  };

  function updateMeta(messageId, change) {
    const row = q('SELECT meta, group_id FROM messages WHERE id = ?').get(messageId);
    const meta = { ...json(row.meta), ...change };
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete meta[k];
    q('UPDATE messages SET meta = ? WHERE id = ?').run(JSON.stringify(meta), messageId);
    const message = store.getMessage(messageId);
    hub.sendToGroup(row.group_id, { type: 'message.updated', message });
    return message;
  }

  /** Multipart routes: the file is already on disk when checks run, so drop it if they fail. */
  function checked(req, fn) {
    try {
      return fn();
    } catch (err) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      throw err;
    }
  }

  // --- QR codes (invitations, personal code) -----------------------------------------------------------

  router.get('/qr', (req, res) => {
    const data = String(req.query.data ?? '');
    if (!data || data.length > 512) throw new HttpError(400, 'bad_qr');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(renderSVG(data, { border: 2, whiteColor: '#FFFFFF', blackColor: '#2E2442' }));
  });

  // --- new members waiting for approval, muted members ----------------------------------------------------

  router.get('/me/pending', (req, res) => {
    const rows = q(
      `SELECT groups.* FROM members JOIN groups ON groups.id = members.group_id
       WHERE members.user_id = ? AND members.status = 'pending' AND groups.deleted_at IS NULL ORDER BY members.joined_at DESC`,
    ).all(req.user.id);
    res.json(rows.map((g) => ({ id: g.id, name: g.name, color: g.color, icon: g.icon })));
  });

  function pendingTarget(req) {
    const id = h.intParam(req.params.id);
    const uid = h.intParam(req.params.uid);
    store.requireAdmin(id, req.user.id);
    if (!q("SELECT 1 FROM members WHERE group_id = ? AND user_id = ? AND status = 'pending'").get(id, uid)) {
      throw new HttpError(404, 'member_not_found');
    }
    return { id, uid };
  }

  router.post('/groups/:id/members/:uid/approve', (req, res) => {
    const { id, uid } = pendingTarget(req);
    store.approveMember(id, uid);
    const member = q(
      'SELECT users.*, members.role, members.joined_at, members.status FROM members JOIN users ON users.id = members.user_id WHERE group_id = ? AND user_id = ?',
    ).get(id, uid);
    hub.sendToGroup(id, { type: 'member.joined', groupId: id, member: h.memberDto(member) });
    hub.sendToUser(uid, { type: 'group.approved', groupId: id, group: groupDto(groupRow(id)) });
    h.postSystem(id, 'joined', { userId: uid });
    res.status(204).end();
  });

  router.post('/groups/:id/members/:uid/refuse', (req, res) => {
    const { id, uid } = pendingTarget(req);
    q("DELETE FROM members WHERE group_id = ? AND user_id = ? AND status = 'pending'").run(id, uid);
    hub.sendToUser(uid, { type: 'group.removed', groupId: id });
    hub.sendToGroup(id, { type: 'member.left', groupId: id, userId: uid });
    res.status(204).end();
  });

  function muteTarget(req) {
    const id = h.intParam(req.params.id);
    h.rejectDirect(id);
    const uid = h.intParam(req.params.uid);
    const me = store.requireAdmin(id, req.user.id);
    const target = store.membership(id, uid);
    if (!target || uid === req.user.id) throw new HttpError(404, 'member_not_found');
    if (target.role === 'owner' || (target.role === 'admin' && me.role !== 'owner')) throw new HttpError(403, 'cannot_mute');
    return { id, uid, target };
  }

  router.put('/groups/:id/members/:uid/mute', (req, res) => {
    const { id, uid, target } = muteTarget(req);
    const duration = MUTES[req.body?.duration];
    if (!duration) throw new HttpError(400, 'bad_duration');
    const until = now() + duration;
    q('UPDATE members SET muted_until = ? WHERE group_id = ? AND user_id = ?').run(until, id, uid);
    hub.sendToGroup(id, { type: 'member.updated', groupId: id, userId: uid, role: target.role, mutedUntil: until });
    res.json({ mutedUntil: until });
  });

  router.delete('/groups/:id/members/:uid/mute', (req, res) => {
    const { id, uid, target } = muteTarget(req);
    q('UPDATE members SET muted_until = NULL WHERE group_id = ? AND user_id = ?').run(id, uid);
    hub.sendToGroup(id, { type: 'member.updated', groupId: id, userId: uid, role: target.role, mutedUntil: null });
    res.status(204).end();
  });

  // --- group settings: pattern, quick reactions, birthdays, rules -------------------------------------------

  router.patch('/groups/:id/settings', (req, res) => {
    const id = h.intParam(req.params.id);
    const b = req.body ?? {};
    const m = store.requireMember(id, req.user.id);
    const next = { ...settingsOf(id) };
    if (['pattern', 'reactions', 'birthdays'].some((k) => k in b)) h.requireThemeRight(id, req.user.id);
    const rules = ['approval', 'adminsTheme', 'anyoneInvites'];
    if (rules.some((k) => k in b)) {
      if (m.role === 'member') throw new HttpError(403, 'not_group_admin', 'Seuls les admins changent les règles');
      h.rejectDirect(id);
    }
    if ('pattern' in b) {
      if (!PATTERNS.includes(b.pattern)) throw new HttpError(400, 'bad_pattern');
      next.pattern = b.pattern;
    }
    if ('reactions' in b) {
      const list = Array.isArray(b.reactions) ? [...new Set(b.reactions)] : [];
      if (list.length === 0 || list.length > 8 || !list.every(isReaction)) throw new HttpError(400, 'bad_reactions');
      next.reactions = list;
    }
    for (const k of ['birthdays', ...rules]) if (k in b) next[k] = !!b[k];
    q('UPDATE groups SET settings = ? WHERE id = ?').run(JSON.stringify(next), id);
    broadcastGroup(id);
    res.json(store.groupDetail(id, req.user.id));
  });

  // --- pinned messages ----------------------------------------------------------------------------------

  router.get('/groups/:id/pins', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    res.json(
      store.findMessages('messages.group_id = ? AND messages.pinned_at IS NOT NULL AND messages.deleted = 0', [id], {
        order: 'messages.pinned_at DESC',
        limit: 30,
      }),
    );
  });

  router.put('/messages/:mid/pin', (req, res) => {
    const { m } = h.loadMessage(req);
    if (m.deleted || m.type === 'system') throw new HttpError(409, 'cannot_pin');
    const count = q('SELECT COUNT(*) AS n FROM messages WHERE group_id = ? AND pinned_at IS NOT NULL').get(m.group_id).n;
    if (!m.pinned_at && count >= 30) throw new HttpError(409, 'too_many_pins', 'Déjà 30 messages épinglés');
    q('UPDATE messages SET pinned_at = ?, pinned_by = ? WHERE id = ?').run(now(), req.user.id, m.id);
    const message = store.getMessage(m.id);
    hub.sendToGroup(m.group_id, { type: 'message.updated', message });
    res.json(message);
  });

  router.delete('/messages/:mid/pin', (req, res) => {
    const { m } = h.loadMessage(req);
    q('UPDATE messages SET pinned_at = NULL, pinned_by = NULL WHERE id = ?').run(m.id);
    const message = store.getMessage(m.id);
    hub.sendToGroup(m.group_id, { type: 'message.updated', message });
    res.json(message);
  });

  // --- search (text, voice transcripts, poll questions) -----------------------------------------------------

  router.get('/groups/:id/search', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const text = cleanText(req.query.q, 100);
    const author = req.query.author ? h.intParam(req.query.author) : null;
    if (!text && !author) return res.json([]);
    const where = ['messages.group_id = ?', 'messages.deleted = 0', "messages.type != 'system'"];
    const params = [id];
    if (text) {
      const like = `%${foldText(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        "(papote_fold(messages.text) LIKE ? ESCAPE '\\' OR papote_fold(json_extract(messages.meta, '$.transcript')) LIKE ? ESCAPE '\\')",
      );
      params.push(like, like);
    }
    if (req.query.kind === 'text') where.push("messages.type IN ('text', 'poll')");
    if (req.query.kind === 'voice') where.push("messages.type = 'voice'");
    if (author) {
      where.push('messages.user_id = ?');
      params.push(author);
    }
    if (req.query.before) {
      where.push('messages.id < ?');
      params.push(h.intParam(req.query.before));
    }
    res.json(store.findMessages(where.join(' AND '), params, { limit: 50 }));
  });

  // --- gallery ---------------------------------------------------------------------------------------------

  router.get('/groups/:id/gallery', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const types = GALLERY_TYPES[req.query.kind] ?? Object.values(GALLERY_TYPES).flat();
    // Ephemeral photos never make it to the gallery.
    const base = ['messages.group_id = ?', 'messages.deleted = 0', 'messages.media_id IS NOT NULL', 'messages.expires_at IS NULL'];
    const where = [...base, 'messages.type IN (SELECT value FROM json_each(?))'];
    const params = [id, JSON.stringify(types)];
    if (req.query.author) {
      where.push('messages.user_id = ?');
      params.push(h.intParam(req.query.author));
    }
    const before = req.query.before ? h.intParam(req.query.before) : null;
    if (before) {
      where.push('messages.id < ?');
      params.push(before);
    }
    const items = store.findMessages(where.join(' AND '), params, { limit: 60 });
    if (before) return res.json({ items });
    const counts = Object.fromEntries(
      q(`SELECT type, COUNT(*) AS n FROM messages WHERE ${base.join(' AND ')} GROUP BY type`)
        .all(id)
        .map((r) => [r.type, r.n]),
    );
    // "Il y a un an jour pour jour…": something from this day last year.
    const yearAgo = now() - 365 * 24 * 3600_000;
    const memory =
      store.findMessages(
        `${base.join(' AND ')} AND messages.type IN ('drawing', 'photo') AND messages.created_at BETWEEN ? AND ?`,
        [id, yearAgo - 12 * 3600_000, yearAgo + 12 * 3600_000],
        { order: 'RANDOM()', limit: 1 },
      )[0] ?? null;
    res.json({ items, counts, total: Object.entries(counts).filter(([t]) => types.includes(t)).reduce((n, [, c]) => n + c, 0), memory });
  });

  // --- polls -------------------------------------------------------------------------------------------------

  router.post('/groups/:id/polls', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireCanPost(id, req.user.id);
    const question = cleanText(req.body?.question, 200);
    if (!question) throw new HttpError(400, 'question_required', 'Pose une question');
    const options = [...new Set((Array.isArray(req.body?.options) ? req.body.options : []).map((o) => cleanText(o, 80)).filter(Boolean))];
    if (options.length < 2 || options.length > 6) throw new HttpError(400, 'bad_options', 'Entre 2 et 6 réponses');
    const message = store.addMessage({ groupId: id, userId: req.user.id, type: 'poll', text: question, meta: { options, multiple: !!req.body?.multiple } });
    h.broadcastNew(id, message, req.user);
    res.status(201).json(message);
  });

  router.put('/messages/:mid/vote', (req, res) => {
    const { m } = h.loadMessage(req);
    if (m.type !== 'poll' || m.deleted) throw new HttpError(409, 'not_a_poll');
    const meta = json(m.meta);
    if (meta.closed) throw new HttpError(409, 'poll_closed', 'Le sondage est terminé');
    const raw = Array.isArray(req.body?.options) ? req.body.options : [req.body?.option];
    const picks = [...new Set(raw.filter((o) => Number.isInteger(o) && o >= 0 && o < meta.options.length))];
    if (raw.length !== picks.length || (!meta.multiple && picks.length > 1)) throw new HttpError(400, 'bad_vote');
    tx(store.db, () => {
      q('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?').run(m.id, req.user.id);
      for (const o of picks) q('INSERT INTO poll_votes (message_id, user_id, option) VALUES (?, ?, ?)').run(m.id, req.user.id, o);
    });
    const message = store.getMessage(m.id);
    hub.sendToGroup(m.group_id, { type: 'message.updated', message });
    res.json(message);
  });

  router.post('/messages/:mid/close', (req, res) => {
    const { m, membership } = h.loadMessage(req);
    if (m.type !== 'poll' || m.deleted) throw new HttpError(409, 'not_a_poll');
    if (m.user_id !== req.user.id && membership.role === 'member') throw new HttpError(403, 'not_your_message');
    res.json(updateMeta(m.id, { closed: true }));
  });

  // --- location (no map: coordinates only, opened in the person's own maps app) ------------------------------

  function coord(value, max) {
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > max) throw new HttpError(400, 'bad_location');
    return Math.round(n * 1e5) / 1e5;
  }
  const accuracy = (v) => Math.max(0, Math.min(100_000, Math.round(Number(v) || 0)));

  router.post('/groups/:id/location', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireCanPost(id, req.user.id);
    const b = req.body ?? {};
    const minutes = [15, 60, 480].includes(Number(b.minutes)) ? Number(b.minutes) : 0;
    const message = store.addMessage({
      groupId: id,
      userId: req.user.id,
      type: 'location',
      text: cleanText(b.label, 80) ?? '',
      meta: { lat: coord(b.lat, 90), lon: coord(b.lon, 180), accuracy: accuracy(b.accuracy), until: minutes ? now() + minutes * 60_000 : null, updatedAt: now() },
    });
    h.broadcastNew(id, message, req.user);
    res.status(201).json(message);
  });

  function ownLocation(req) {
    const { m } = h.loadMessage(req);
    if (m.type !== 'location' || m.deleted || m.user_id !== req.user.id) throw new HttpError(404, 'message_not_found');
    return { m, meta: json(m.meta) };
  }

  // Live sharing ("Partagée 1 h"): the author's device sends where it is now, until the time is up.
  router.patch('/messages/:mid/location', (req, res) => {
    const { m, meta } = ownLocation(req);
    if (!meta.until || meta.until < now()) throw new HttpError(409, 'location_ended');
    res.json(updateMeta(m.id, { lat: coord(req.body?.lat, 90), lon: coord(req.body?.lon, 180), accuracy: accuracy(req.body?.accuracy), updatedAt: now() }));
  });

  router.delete('/messages/:mid/location', (req, res) => {
    const { m, meta } = ownLocation(req);
    res.json(meta.until && meta.until > now() ? updateMeta(m.id, { until: now() }) : store.getMessage(m.id));
  });

  // --- stories (24 h) ----------------------------------------------------------------------------------------

  const storyDto = (s, userId) => ({
    id: s.id,
    url: `/api/media/${s.media_id}`,
    caption: s.caption,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    seen: !!s.seen,
    ...(s.user_id === userId
      ? {
          viewers: q('SELECT users.id, users.name FROM story_views JOIN users ON users.id = story_views.user_id WHERE story_id = ? AND users.id != ?')
            .all(s.id, userId)
            .map((u) => ({ id: u.id, name: u.name })),
        }
      : {}),
  });

  router.get('/groups/:id/stories', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const rows = q(
      `SELECT stories.*, EXISTS (SELECT 1 FROM story_views WHERE story_id = stories.id AND user_id = ?) AS seen
       FROM stories WHERE group_id = ? AND expires_at > ? ORDER BY created_at`,
    ).all(req.user.id, id, now());
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(storyDto(r, req.user.id));
    }
    const out = [...byUser].map(([uid, stories]) => ({
      user: userDto(store.getUser(uid), { online: hub.isOnline(uid) }),
      stories,
      unseen: uid !== req.user.id && stories.some((s) => !s.seen),
      latest: stories.at(-1).createdAt,
    }));
    out.sort((a, b) => (b.user.id === req.user.id) - (a.user.id === req.user.id) || b.unseen - a.unseen || b.latest - a.latest);
    res.json(out);
  });

  router.post('/groups/:id/stories', upload.single('file'), (req, res) => {
    const id = Number(req.params.id);
    checked(req, () => {
      h.intParam(id);
      store.requireCanPost(id, req.user.id);
      if (q('SELECT COUNT(*) AS n FROM stories WHERE group_id = ? AND user_id = ? AND expires_at > ?').get(id, req.user.id, now()).n >= 20) {
        throw new HttpError(409, 'too_many_stories', 'Déjà 20 stories en cours');
      }
    });
    const media = h.storeUpload(req.file, 'story', { ownerId: req.user.id, groupId: id });
    const ts = now();
    const { lastInsertRowid } = q('INSERT INTO stories (group_id, user_id, media_id, caption, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      req.user.id,
      media.id,
      cleanText(req.body?.caption, 140) ?? '',
      ts,
      ts + 24 * 3600_000,
    );
    hub.sendToGroup(id, { type: 'story.new', groupId: id, userId: req.user.id });
    res.status(201).json(storyDto(q('SELECT * FROM stories WHERE id = ?').get(Number(lastInsertRowid)), req.user.id));
  });

  function loadStory(req) {
    const s = q('SELECT * FROM stories WHERE id = ?').get(h.intParam(req.params.sid));
    if (!s || s.expires_at <= now()) throw new HttpError(404, 'story_not_found');
    return { s, membership: store.requireMember(s.group_id, req.user.id) };
  }

  router.post('/stories/:sid/view', (req, res) => {
    const { s } = loadStory(req);
    q('INSERT OR IGNORE INTO story_views (story_id, user_id) VALUES (?, ?)').run(s.id, req.user.id);
    res.status(204).end();
  });

  router.delete('/stories/:sid', (req, res) => {
    const { s, membership } = loadStory(req);
    if (s.user_id !== req.user.id && membership.role === 'member') throw new HttpError(403, 'not_your_story');
    removeStory(s);
    res.status(204).end();
  });

  function removeStory(s) {
    q('DELETE FROM stories WHERE id = ?').run(s.id);
    h.deleteMedia(s.media_id);
    hub.sendToGroup(s.group_id, { type: 'story.removed', groupId: s.group_id, storyId: s.id, userId: s.user_id });
  }

  // --- stickers (made from a drawing or a picture) and favourites ------------------------------------------

  const stickerDto = (s) => ({ id: s.id, groupId: s.group_id, url: `/api/media/${s.media_id}`, createdBy: s.created_by, createdAt: s.created_at });

  router.get('/groups/:id/stickers', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    res.json(q('SELECT * FROM stickers WHERE group_id = ? ORDER BY created_at DESC').all(id).map(stickerDto));
  });

  /** A copy of a message's picture, so deleting either one never breaks the other. */
  function copyMedia(mediaId, kind, { ownerId, groupId }) {
    const media = q('SELECT * FROM media WHERE id = ?').get(mediaId);
    if (!media) throw new HttpError(404, 'media_not_found');
    return h.storeBuffer(fs.readFileSync(path.join(mediaDir, media.file)), kind, media.mime, { ownerId, groupId });
  }

  router.post('/groups/:id/stickers', upload.single('file'), (req, res) => {
    const id = Number(req.params.id);
    checked(req, () => {
      h.intParam(id);
      store.requireMember(id, req.user.id);
      if (q('SELECT COUNT(*) AS n FROM stickers WHERE group_id = ?').get(id).n >= 200) throw new HttpError(409, 'too_many_stickers', 'Déjà 200 stickers dans ce groupe');
    });
    let mediaId;
    if (req.file) {
      mediaId = h.storeUpload(req.file, 'sticker', { ownerId: req.user.id, groupId: id }).id;
    } else {
      const src = q("SELECT * FROM messages WHERE id = ? AND group_id = ? AND deleted = 0 AND type IN ('drawing', 'photo', 'gif') AND media_id IS NOT NULL").get(
        Number(req.body?.messageId),
        id,
      );
      if (!src) throw new HttpError(404, 'message_not_found');
      mediaId = copyMedia(src.media_id, 'sticker', { ownerId: req.user.id, groupId: id });
    }
    const { lastInsertRowid } = q('INSERT INTO stickers (group_id, media_id, created_by, created_at) VALUES (?, ?, ?, ?)').run(id, mediaId, req.user.id, now());
    const sticker = stickerDto(q('SELECT * FROM stickers WHERE id = ?').get(Number(lastInsertRowid)));
    hub.sendToGroup(id, { type: 'sticker.new', groupId: id, sticker });
    res.status(201).json(sticker);
  });

  router.delete('/stickers/:sid', (req, res) => {
    const s = q('SELECT * FROM stickers WHERE id = ?').get(h.intParam(req.params.sid));
    if (!s) throw new HttpError(404, 'sticker_not_found');
    const m = store.requireMember(s.group_id, req.user.id);
    if (s.created_by !== req.user.id && m.role === 'member') throw new HttpError(403, 'not_your_sticker');
    q('DELETE FROM stickers WHERE id = ?').run(s.id);
    h.deleteMedia(s.media_id);
    hub.sendToGroup(s.group_id, { type: 'sticker.removed', groupId: s.group_id, stickerId: s.id });
    res.status(204).end();
  });

  // Sending a sticker: one of the group's (or another group of the sender's) or one built into the apps.
  router.post('/groups/:id/sticker', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireCanPost(id, req.user.id);
    const b = req.body ?? {};
    let mediaId = null;
    const meta = {};
    if (typeof b.builtin === 'string' && BUILTIN.test(b.builtin)) {
      meta.builtin = b.builtin;
    } else {
      const s = q('SELECT * FROM stickers WHERE id = ?').get(Number(b.stickerId));
      if (!s || !store.membership(s.group_id, req.user.id)) throw new HttpError(404, 'sticker_not_found');
      mediaId = copyMedia(s.media_id, 'sticker', { ownerId: req.user.id, groupId: id });
      meta.stickerId = s.id;
    }
    const message = store.addMessage({ groupId: id, userId: req.user.id, type: 'sticker', mediaId, meta, replyTo: h.checkReply(id, b.replyTo) });
    h.broadcastNew(id, message, req.user);
    res.status(201).json(message);
  });

  router.get('/me/favorites', (req, res) => {
    const out = [];
    for (const f of q('SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)) {
      if (f.kind === 'sticker') {
        const s = q('SELECT * FROM stickers WHERE id = ?').get(Number(f.ref));
        if (!s || !store.membership(s.group_id, req.user.id)) continue;
        out.push({ kind: f.kind, ref: f.ref, data: stickerDto(s) });
      } else {
        out.push({ kind: f.kind, ref: f.ref, data: json(f.data) });
      }
    }
    res.json(out);
  });

  router.put('/me/favorites', (req, res) => {
    const { kind, ref, data } = req.body ?? {};
    const r = String(ref ?? '');
    let stored = null;
    if (kind === 'gif') {
      if (!GIF_ID.test(r)) throw new HttpError(400, 'bad_favorite');
      stored = { title: cleanText(data?.title, 80) ?? '', width: Number(data?.width) || 200, height: Number(data?.height) || 200, preview: `/api/gifs/${r}/preview` };
    } else if (kind === 'sticker') {
      const s = q('SELECT * FROM stickers WHERE id = ?').get(Number(r));
      if (!s || !store.membership(s.group_id, req.user.id)) throw new HttpError(404, 'sticker_not_found');
    } else if (kind !== 'builtin' || !BUILTIN.test(r)) {
      throw new HttpError(400, 'bad_favorite');
    }
    if (q('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?').get(req.user.id).n >= 300) throw new HttpError(409, 'too_many_favorites');
    q('INSERT INTO favorites (user_id, kind, ref, data, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET data = excluded.data').run(
      req.user.id,
      kind,
      r,
      stored ? JSON.stringify(stored) : null,
      now(),
    );
    res.status(204).end();
  });

  router.delete('/me/favorites/:kind/:ref', (req, res) => {
    q('DELETE FROM favorites WHERE user_id = ? AND kind = ? AND ref = ?').run(req.user.id, req.params.kind, req.params.ref);
    res.status(204).end();
  });

  // --- GIFs, through the server (GIPHY never sees members) -------------------------------------------------

  const gifLimit = rateLimit({ windowMs: 60_000, max: 90 });
  const needGifs = () => {
    if (!gifs?.enabled) throw new HttpError(503, 'gifs_disabled', 'Les GIF ne sont pas activés sur ce serveur');
    return gifs;
  };

  router.get('/gifs/trending', gifLimit, async (req, res) => res.json(await needGifs().trending(Number(req.query.offset) || 0)));

  router.get('/gifs/search', gifLimit, async (req, res) => {
    const text = cleanText(req.query.q, 50);
    if (!text) return res.json([]);
    res.json(await needGifs().search(text, Number(req.query.offset) || 0));
  });

  router.get('/gifs/:gid/preview', async (req, res) => {
    const { buf, mime } = await needGifs().preview(req.params.gid);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(buf);
  });

  router.post('/groups/:id/gif', async (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireCanPost(id, req.user.id);
    const gid = String(req.body?.id ?? '');
    if (!GIF_ID.test(gid)) throw new HttpError(400, 'bad_gif');
    const gif = await needGifs().full(gid);
    const mediaId = h.storeBuffer(gif.buf, 'gif', gif.mime, { ownerId: req.user.id, groupId: id });
    const message = store.addMessage({
      groupId: id,
      userId: req.user.id,
      type: 'gif',
      mediaId,
      meta: { gifId: gid, title: gif.title, width: gif.width, height: gif.height },
      replyTo: h.checkReply(id, req.body?.replyTo),
    });
    h.broadcastNew(id, message, req.user);
    res.status(201).json(message);
  });

  // --- voice transcription (Whisper container) ---------------------------------------------------------------

  function transcribe(message) {
    if (!whisper?.enabled || !message.media) return;
    const media = q('SELECT file, mime FROM media WHERE id = ?').get(message.media.id);
    if (!media) return;
    whisper.queue(path.join(mediaDir, media.file), media.mime, (text) => {
      const row = q('SELECT deleted FROM messages WHERE id = ?').get(message.id);
      if (!row || row.deleted) return;
      updateMeta(message.id, { transcribing: undefined, transcript: text ?? undefined });
    });
  }

  // --- shared drawing ("Toile commune"): strokes travel over the WebSocket ------------------------------------

  const live = new Map(); // groupId -> session

  const liveDto = (s, strokes = false) =>
    s && {
      id: s.id,
      groupId: s.groupId,
      startedBy: s.startedBy,
      startedAt: s.startedAt,
      base: s.base,
      artists: [...s.artists],
      ...(strokes ? { strokes: [...s.strokes.values()] } : {}),
    };

  router.get('/groups/:id/live-draw', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    res.json(liveDto(live.get(id), true) ?? null);
  });

  router.post('/groups/:id/live-draw', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireCanPost(id, req.user.id);
    let s = live.get(id);
    if (!s) {
      // "Dessiner par-dessus": a drawing or a photo of the group as the background.
      const src = req.body?.base
        ? q("SELECT id, media_id FROM messages WHERE id = ? AND group_id = ? AND deleted = 0 AND type IN ('drawing', 'photo') AND media_id IS NOT NULL").get(
            Number(req.body.base),
            id,
          )
        : null;
      s = {
        id: crypto.randomBytes(6).toString('hex'),
        groupId: id,
        startedBy: req.user.id,
        startedAt: now(),
        lastAt: now(),
        base: src ? { messageId: src.id, url: `/api/media/${src.media_id}` } : null,
        artists: new Set([req.user.id]),
        strokes: new Map(),
        points: 0,
      };
      live.set(id, s);
      hub.sendToGroup(id, { type: 'livedraw', groupId: id, session: liveDto(s) });
      h.postSystem(id, 'livedraw', { userId: req.user.id });
    }
    res.status(201).json(liveDto(s, true));
  });

  router.delete('/groups/:id/live-draw', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    endLive(id);
    res.status(204).end();
  });

  function endLive(groupId) {
    if (!live.delete(groupId)) return;
    hub.sendToGroup(groupId, { type: 'livedraw', groupId, session: null });
  }

  /** One piece of a stroke: {k: stroke key, c, w, t, p: [x, y…]} — or {k, undo: true}, or {clear: true}. */
  function addSegment(store_, userId, data) {
    if (!data || typeof data !== 'object') return false;
    if (data.clear) {
      store_.strokes.clear();
      store_.points = 0;
      return true;
    }
    const key = `${userId}:${String(data.k ?? '').slice(0, 24)}`;
    if (data.undo) return store_.strokes.delete(key);
    if (!Array.isArray(data.p) || data.p.length > 2000 || data.p.length % 2) return false;
    if (store_.points + data.p.length > 400_000 || store_.strokes.size > 5000) return false;
    let stroke = store_.strokes.get(key);
    if (!stroke) {
      stroke = {
        u: userId,
        c: typeof data.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.c) ? data.c : '#2E2442',
        w: Math.max(1, Math.min(200, Math.round(Number(data.w) || 8))),
        t: ['pen', 'marker', 'eraser', 'fill', 'stamp'].includes(data.t) ? data.t : 'pen',
        ...(typeof data.s === 'string' && data.s.length <= 16 ? { s: data.s } : {}),
        p: [],
      };
      store_.strokes.set(key, stroke);
    }
    for (const v of data.p) stroke.p.push(Math.max(0, Math.min(1000, Math.round(Number(v) || 0))));
    store_.points += data.p.length;
    return true;
  }

  // Called by the WebSocket hub for {type: 'live'} messages; true = relay it to the rest of the group.
  hub.onLive = (userId, msg) => {
    const data = msg.data;
    if (msg.channel === 'draw') {
      const s = live.get(msg.groupId);
      if (!s || s.id !== data?.sid) return false;
      if (data.clear && userId !== s.startedBy) return false;
      if (!addSegment(s, userId, data)) return false;
      s.artists.add(userId);
      s.lastAt = now();
      return true;
    }
    if (msg.channel === 'game') {
      const rt = gameRuntime.get(Number(data?.gameId));
      if (!rt || rt.groupId !== msg.groupId || rt.drawer !== userId) return false;
      return addSegment(rt, userId, data);
    }
    return false;
  };

  // --- mini-games -----------------------------------------------------------------------------------------

  const gameRuntime = new Map(); // gameId -> live strokes and timer (Pictionary)

  function gameDto(row, state, userId) {
    return {
      id: row.id,
      groupId: row.group_id,
      kind: row.kind,
      name: GAME_NAMES[row.kind],
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      state: GAMES[row.kind].view(state, userId),
    };
  }

  function syncRuntime(row, state) {
    if (row.kind !== 'pictionary') return;
    if (row.status !== 'playing') return gameRuntime.delete(row.id);
    let rt = gameRuntime.get(row.id);
    if (!rt || rt.version !== state.strokesVersion) {
      rt = { version: state.strokesVersion, strokes: new Map(), points: 0 };
      gameRuntime.set(row.id, rt);
    }
    rt.groupId = row.group_id;
    rt.drawer = state.status === 'drawing' ? state.drawer : null;
    rt.timerAt = state.status === 'drawing' ? state.deadline : state.status === 'between' ? state.betweenUntil : null;
  }

  function saveGame(row, state) {
    const engine = GAMES[row.kind];
    const status = row.status === 'playing' && engine.isDone?.(state) ? 'done' : row.status;
    const ts = now();
    q('UPDATE games SET state = ?, status = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), status, ts, row.id);
    return { ...row, state: JSON.stringify(state), status, updated_at: ts };
  }

  function broadcastGame(row, state) {
    syncRuntime(row, state);
    for (const uid of store.memberIds(row.group_id)) hub.sendToUser(uid, { type: 'game.updated', groupId: row.group_id, game: gameDto(row, state, uid) });
  }

  /** Loads a game and lets time-based games (Pictionary rounds) catch up. */
  function freshGame(row) {
    const state = JSON.parse(row.state);
    if (row.status === 'playing' && GAMES[row.kind].tick?.(state)) {
      row = saveGame(row, state);
      broadcastGame(row, state);
    } else {
      syncRuntime(row, state);
    }
    return { row, state };
  }

  function loadGame(req) {
    const row = q('SELECT * FROM games WHERE id = ?').get(h.intParam(req.params.gid));
    if (!row) throw new HttpError(404, 'game_not_found');
    const membership = store.requireMember(row.group_id, req.user.id);
    return { ...freshGame(row), membership };
  }

  const gameTimer = setInterval(() => {
    for (const [gid, rt] of gameRuntime) {
      if (!rt.timerAt || now() < rt.timerAt) continue;
      const row = q('SELECT * FROM games WHERE id = ?').get(gid);
      if (!row || row.status !== 'playing') gameRuntime.delete(gid);
      else freshGame(row);
    }
  }, 1000);
  gameTimer.unref();

  router.get('/groups/:id/games', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const rows = q("SELECT * FROM games WHERE group_id = ? AND (status = 'playing' OR updated_at > ?) ORDER BY updated_at DESC LIMIT 30").all(
      id,
      now() - 7 * 24 * 3600_000,
    );
    res.json(rows.map((r) => {
      const { row, state } = freshGame(r);
      return gameDto(row, state, req.user.id);
    }));
  });

  router.post('/groups/:id/games', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireCanPost(id, req.user.id);
    const kind = req.body?.kind;
    if (!GAME_KINDS.includes(kind)) throw new HttpError(400, 'bad_game');
    const engine = GAMES[kind];
    let opponentId = req.body?.opponentId != null ? Number(req.body.opponentId) : null;
    if (engine.duo) {
      // In a two-person conversation the other player is obvious.
      if (opponentId === null && groupRow(id).direct) opponentId = store.memberIds(id).find((u) => u !== req.user.id) ?? null;
      if (opponentId !== null && (opponentId === req.user.id || !store.membership(id, opponentId))) throw new HttpError(400, 'bad_opponent');
    }
    const state = engine.create({ store, groupId: id, userId: req.user.id, opponentId });
    const ts = now();
    const { lastInsertRowid } = q('INSERT INTO games (group_id, kind, state, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      kind,
      JSON.stringify(state),
      'playing',
      req.user.id,
      ts,
      ts,
    );
    const row = q('SELECT * FROM games WHERE id = ?').get(Number(lastInsertRowid));
    const message = store.addMessage({ groupId: id, userId: req.user.id, type: 'game', meta: { gameId: row.id, kind, opponentId: engine.duo ? opponentId : undefined } });
    h.broadcastNew(id, message, req.user);
    broadcastGame(row, state);
    res.status(201).json(gameDto(row, state, req.user.id));
  });

  router.get('/games/:gid', (req, res) => {
    const { row, state } = loadGame(req);
    const rt = gameRuntime.get(row.id);
    res.json({ ...gameDto(row, state, req.user.id), ...(rt ? { strokes: [...rt.strokes.values()] } : {}) });
  });

  router.post('/games/:gid/move', (req, res) => {
    let { row, state } = loadGame(req);
    store.requireCanPost(row.group_id, req.user.id);
    if (row.status !== 'playing') throw new HttpError(409, 'game_over', 'La partie est terminée');
    GAMES[row.kind].move(state, req.user.id, req.body ?? {});
    row = saveGame(row, state);
    broadcastGame(row, state);
    res.json(gameDto(row, state, req.user.id));
  });

  router.delete('/games/:gid', (req, res) => {
    const { row, state, membership } = loadGame(req);
    const players = state.players ?? [];
    if (row.created_by !== req.user.id && !players.includes(req.user.id) && membership.role === 'member') throw new HttpError(403, 'not_a_player');
    q("UPDATE games SET status = 'done', updated_at = ? WHERE id = ?").run(now(), row.id);
    broadcastGame({ ...row, status: 'done' }, state);
    res.status(204).end();
  });

  // --- monthly recap ------------------------------------------------------------------------------------------

  function recap(groupId, spec) {
    let y;
    let mo;
    if (/^\d{4}-\d{2}$/.test(spec ?? '')) [y, mo] = spec.split('-').map(Number);
    else [y, mo] = [new Date().getFullYear(), new Date().getMonth() + 1];
    if (mo < 1 || mo > 12) throw new HttpError(400, 'bad_month');
    const from = new Date(y, mo - 1, 1).getTime();
    const to = new Date(y, mo, 1).getTime();
    const rows = q(
      `SELECT messages.user_id, messages.type, messages.meta, messages.created_at, users.name, users.color FROM messages
       LEFT JOIN users ON users.id = messages.user_id
       WHERE messages.group_id = ? AND messages.created_at >= ? AND messages.created_at < ? AND messages.type != 'system' AND messages.deleted = 0`,
    ).all(groupId, from, to);
    const person = (r) => (r ? { id: r.user_id, name: r.name, color: r.color } : null);
    const count = (type) => rows.filter((r) => r.type === type).length;
    const top = (list) => {
      const tally = new Map();
      for (const r of list) tally.set(r.user_id, { r, n: (tally.get(r.user_id)?.n ?? 0) + 1 });
      return [...tally.values()].sort((a, b) => b.n - a.n)[0] ?? null;
    };
    const badges = [];
    const picasso = top(rows.filter((r) => r.type === 'drawing' && r.user_id));
    if (picasso) badges.push({ kind: 'picasso', user: person(picasso.r), value: picasso.n });
    const voices = rows.filter((r) => r.type === 'voice' && r.user_id).map((r) => ({ r, ms: json(r.meta).durationMs ?? 0 }));
    const longest = voices.sort((a, b) => b.ms - a.ms)[0];
    if (longest?.ms) badges.push({ kind: 'voice', user: person(longest.r), value: longest.ms });
    const gifsSent = new Map();
    for (const r of rows.filter((x) => x.type === 'gif')) {
      const m = json(r.meta);
      const key = m.gifId ?? '';
      gifsSent.set(key, { title: m.title || 'GIF', gifId: m.gifId ?? null, n: (gifsSent.get(key)?.n ?? 0) + 1 });
    }
    const gif = [...gifsSent.values()].sort((a, b) => b.n - a.n)[0];
    if (gif) badges.push({ kind: 'gif', user: null, value: gif.n, title: gif.title });
    const minutes = (ts) => new Date(ts).getHours() * 60 + new Date(ts).getMinutes();
    const early = rows.filter((r) => r.user_id).sort((a, b) => minutes(a.created_at) - minutes(b.created_at))[0];
    if (early) badges.push({ kind: 'early', user: person(early), value: minutes(early.created_at) });
    const chatty = top(rows.filter((r) => r.user_id));
    if (chatty) badges.push({ kind: 'chatty', user: person(chatty.r), value: chatty.n });
    return {
      month: `${y}-${pad(mo)}`,
      label: `${MONTHS[mo - 1][0].toUpperCase()}${MONTHS[mo - 1].slice(1)} ${y}`,
      stats: { messages: rows.length, drawings: count('drawing'), voices: count('voice'), photos: count('photo'), gifs: count('gif') },
      badges,
    };
  }

  router.get('/groups/:id/recap', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    res.json(recap(id, req.query.month));
  });

  router.post('/groups/:id/recap/share', (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireCanPost(id, req.user.id);
    const r = recap(id, req.body?.month);
    const message = store.addMessage({ groupId: id, userId: req.user.id, type: 'recap', text: `Le récap ${/^[aeiou]/i.test(r.label) ? 'd’' : 'de '}${r.label.toLowerCase()}`, meta: r });
    h.broadcastNew(id, message, req.user);
    res.status(201).json(message);
  });

  // --- export (.zip): the group's messages, as text and JSON, with its pictures and voice messages ------------

  const exportLimit = rateLimit({ windowMs: 10 * 60_000, max: 5 });

  router.get('/groups/:id/export', exportLimit, async (req, res) => {
    const id = h.intParam(req.params.id);
    store.requireMember(id, req.user.id);
    const g = groupRow(id);
    const name = g.direct ? store.groupDetail(id, req.user.id).name : g.name;
    const rows = q(
      `SELECT messages.*, users.name AS author, media.mime, media.file FROM messages
       LEFT JOIN users ON users.id = messages.user_id LEFT JOIN media ON media.id = messages.media_id
       WHERE messages.group_id = ? AND messages.deleted = 0 ORDER BY messages.id`,
    ).all(id);
    const slug = name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'groupe';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="papote-${slug}-${stamp(now()).slice(0, 10)}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    const zip = createZip(res);
    const lines = [`${name} — exporté de Papote le ${stamp(now())}`, ''];
    const list = [];
    try {
      for (const m of rows) {
        const meta = json(m.meta);
        let file = null;
        if (m.file && fs.existsSync(path.join(mediaDir, m.file))) {
          file = `media/${stamp(m.created_at).replace(/[: ]/g, '-')}_${m.id}.${EXT[m.mime] ?? 'bin'}`;
          await zip.add(file, fs.readFileSync(path.join(mediaDir, m.file)), { compress: false, date: new Date(m.created_at) });
        }
        const what = {
          text: m.text,
          photo: `[Photo${file ? ` : ${file}` : ''}]${m.text ? ` ${m.text}` : ''}`,
          drawing: `[Dessin${file ? ` : ${file}` : ''}]`,
          voice: `[Vocal${file ? ` : ${file}` : ''}]${meta.transcript ? ` « ${meta.transcript} »` : ''}`,
          gif: `[GIF${meta.title ? ` « ${meta.title} »` : ''}${file ? ` : ${file}` : ''}]`,
          sticker: `[Sticker${file ? ` : ${file}` : ''}]`,
          poll: `[Sondage] ${m.text} — ${(meta.options ?? []).join(' / ')}`,
          location: `[Position] ${meta.lat}, ${meta.lon}`,
          game: `[Jeu : ${GAME_NAMES[meta.kind] ?? meta.kind}]`,
          recap: `[${m.text}]`,
          system: `(${meta.event ?? 'info'})`,
        }[m.type] ?? `[${m.type}]`;
        lines.push(`${stamp(m.created_at)} — ${m.author ?? 'Papote'} : ${what}`);
        list.push({ id: m.id, at: new Date(m.created_at).toISOString(), author: m.author ?? null, type: m.type, text: m.text, file, meta: m.type === 'system' ? undefined : meta });
      }
      await zip.add('messages.txt', Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
      await zip.add('messages.json', Buffer.from(JSON.stringify({ group: name, exportedAt: new Date().toISOString(), messages: list }, null, 1), 'utf8'));
      await zip.end();
    } catch (err) {
      res.destroy(err);
    }
  });

  // --- housekeeping: ephemeral photos, stories, idle shared drawings, GIF cache ----------------------------------

  function cleanup() {
    for (const m of q('SELECT * FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ? AND deleted = 0').all(now())) h.eraseMessage(m);
    for (const s of q('SELECT * FROM stories WHERE expires_at <= ?').all(now())) removeStory(s);
    for (const [gid, s] of live) if (now() - s.lastAt > 30 * 60_000) endLive(gid);
    q("UPDATE games SET status = 'done' WHERE status = 'playing' AND updated_at < ?").run(now() - 7 * 24 * 3600_000);
    gifs?.pruneCache();
    for (const f of store.purgeTrash()) fs.rmSync(path.join(mediaDir, f), { force: true });
  }
  const cleaner = setInterval(cleanup, 5 * 60_000);
  cleaner.unref();
  setImmediate(() => {
    try {
      cleanup();
    } catch {
      /* database closed already (tests) */
    }
  });

  function close() {
    clearInterval(cleaner);
    clearInterval(gameTimer);
  }

  return { endLive, transcribe, cleanup, close, liveSession: (groupId) => liveDto(live.get(groupId)) };
}
