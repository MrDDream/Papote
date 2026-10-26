import { HttpError, groupDto, groupSettings, inviteDto, makeCode, makePersonalCode, now, userDto } from './util.js';

const ROLE_RANK = { owner: 0, admin: 1, member: 2 };
export const TRASH_DAYS = 30;
// Groups in the trash are invisible everywhere until restored.
const LIVE_GROUP = 'group_id NOT IN (SELECT id FROM groups WHERE deleted_at IS NOT NULL)';
import { tx } from './db.js';

export function createStore(db) {
  const q = (sql) => db.prepare(sql);

  function getUser(id) {
    return q('SELECT * FROM users WHERE id = ?').get(id);
  }

  /** Active membership only: someone waiting for approval is not in the group yet. */
  function membership(groupId, userId) {
    return q(`SELECT * FROM members WHERE group_id = ? AND user_id = ? AND status = 'active' AND ${LIVE_GROUP}`).get(groupId, userId);
  }

  function requireMember(groupId, userId) {
    const m = membership(groupId, userId);
    if (!m) throw new HttpError(404, 'group_not_found');
    return m;
  }

  /** Muted members can read but not post. */
  function requireCanPost(groupId, userId) {
    const m = requireMember(groupId, userId);
    if (m.muted_until && m.muted_until > now()) throw new HttpError(403, 'muted', 'Tu es en sourdine dans ce groupe pour l’instant');
    return m;
  }

  function requireAdmin(groupId, userId) {
    const m = requireMember(groupId, userId);
    if (m.role === 'member') throw new HttpError(403, 'not_group_admin');
    return m;
  }

  function memberIds(groupId) {
    return q(`SELECT user_id FROM members WHERE group_id = ? AND status = 'active' AND ${LIVE_GROUP}`)
      .all(groupId)
      .map((r) => r.user_id);
  }

  function reactionsFor(messageIds) {
    if (messageIds.length === 0) return new Map();
    const rows = q(
      `SELECT message_id, kind, user_id FROM reactions
       WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY created_at`,
    ).all(JSON.stringify(messageIds));
    const out = new Map();
    for (const r of rows) {
      const byKind = out.get(r.message_id) ?? {};
      (byKind[r.kind] ??= []).push(r.user_id);
      out.set(r.message_id, byKind);
    }
    return out;
  }

  function pollVotes(messageIds) {
    if (messageIds.length === 0) return new Map();
    const out = new Map();
    for (const r of q('SELECT message_id, user_id, option FROM poll_votes WHERE message_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(messageIds))) {
      const byOption = out.get(r.message_id) ?? {};
      (byOption[r.option] ??= []).push(r.user_id);
      out.set(r.message_id, byOption);
    }
    return out;
  }

  /** What a reply shows of the message it answers: who, what kind, and the start of the text. */
  function replyPreviews(ids) {
    if (ids.length === 0) return new Map();
    const rows = q(
      `SELECT id, user_id, type, text, meta, deleted FROM messages WHERE id IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(ids));
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          authorId: r.user_id ?? null,
          type: r.type,
          // A document has no text: its name stands in.
          text: r.deleted ? '' : (r.type === 'file' ? (JSON.parse(r.meta ?? '{}').name ?? '') : r.text).slice(0, 160),
          deleted: !!r.deleted,
        },
      ]),
    );
  }

  function messageDtos(rows) {
    const reactions = reactionsFor(rows.map((r) => r.id));
    const votes = pollVotes(rows.filter((r) => r.type === 'poll').map((r) => r.id));
    const replies = replyPreviews([...new Set(rows.map((r) => r.reply_to).filter(Boolean))]);
    return rows.map((m) => ({
      id: m.id,
      groupId: m.group_id,
      authorId: m.user_id ?? null,
      type: m.type,
      text: m.deleted ? '' : m.text,
      media:
        m.media_id && !m.deleted
          ? { id: m.media_id, url: `/api/media/${m.media_id}`, mime: m.mime ?? null }
          : null,
      meta: m.meta && !m.deleted ? JSON.parse(m.meta) : null,
      replyTo: m.reply_to ?? null,
      reply: m.reply_to ? (replies.get(m.reply_to) ?? null) : null,
      deleted: !!m.deleted,
      reactions: reactions.get(m.id) ?? {},
      // Poll answers: option index -> user ids.
      votes: m.type === 'poll' && !m.deleted ? (votes.get(m.id) ?? {}) : undefined,
      pinnedAt: m.pinned_at ?? null,
      pinnedBy: m.pinned_by ?? null,
      expiresAt: m.expires_at ?? null,
      createdAt: m.created_at,
    }));
  }

  const MESSAGE_SELECT = `SELECT messages.*, media.mime AS mime FROM messages
    LEFT JOIN media ON media.id = messages.media_id`;

  function getMessage(id) {
    const row = q(`${MESSAGE_SELECT} WHERE messages.id = ?`).get(id);
    return row ? messageDtos([row])[0] : null;
  }

  function listMessages(groupId, { before, after = null, around = null, limit }) {
    // Jumping to a search result or a pinned message: some messages on each side of it.
    if (around) {
      const half = Math.ceil(limit / 2);
      const older = q(`${MESSAGE_SELECT} WHERE messages.group_id = ? AND messages.id <= ? ORDER BY messages.id DESC LIMIT ?`).all(groupId, around, half);
      const newer = q(`${MESSAGE_SELECT} WHERE messages.group_id = ? AND messages.id > ? ORDER BY messages.id LIMIT ?`).all(groupId, around, half);
      return messageDtos([...older.reverse(), ...newer]);
    }
    if (after) {
      return messageDtos(q(`${MESSAGE_SELECT} WHERE messages.group_id = ? AND messages.id > ? ORDER BY messages.id LIMIT ?`).all(groupId, after, limit));
    }
    const rows = before
      ? q(`${MESSAGE_SELECT} WHERE messages.group_id = ? AND messages.id < ? ORDER BY messages.id DESC LIMIT ?`).all(
          groupId,
          before,
          limit,
        )
      : q(`${MESSAGE_SELECT} WHERE messages.group_id = ? ORDER BY messages.id DESC LIMIT ?`).all(groupId, limit);
    return messageDtos(rows.reverse());
  }

  /** Messages matching a WHERE clause (search, gallery, pins), newest first unless told otherwise. */
  function findMessages(where, params, { order = 'messages.id DESC', limit = 50 } = {}) {
    return messageDtos(q(`${MESSAGE_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ?`).all(...params, limit));
  }

  function addMessage({ groupId, userId, type, text = '', mediaId = null, meta = null, replyTo = null, expiresAt = null }) {
    const ts = now();
    const { lastInsertRowid } = q(
      `INSERT INTO messages (group_id, user_id, type, text, media_id, meta, reply_to, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(groupId, userId, type, text, mediaId, meta ? JSON.stringify(meta) : null, replyTo, ts, expiresAt);
    const id = Number(lastInsertRowid);
    if (userId) q('UPDATE members SET last_read_id = ? WHERE group_id = ? AND user_id = ?').run(id, groupId, userId);
    return getMessage(id);
  }

  function groupSummaries(userId) {
    const rows = q(
      `SELECT g.*, m.role, m.last_read_id,
         (SELECT COUNT(*) FROM members WHERE group_id = g.id AND status = 'active') AS member_count,
         (SELECT MAX(id) FROM messages WHERE group_id = g.id) AS last_id,
         (SELECT COUNT(*) FROM messages WHERE group_id = g.id AND id > m.last_read_id
            AND type != 'system' AND user_id != m.user_id) AS unread
       FROM groups g JOIN members m ON m.group_id = g.id
       WHERE m.user_id = ? AND m.status = 'active' AND g.deleted_at IS NULL`,
    ).all(userId);
    const lastIds = rows.map((r) => r.last_id).filter(Boolean);
    const lastMessages = new Map(
      lastIds.length
        ? messageDtos(
            q(`${MESSAGE_SELECT} WHERE messages.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(lastIds)),
          ).map((m) => [m.id, m])
        : [],
    );
    const nameOf = (id) => (id ? (q('SELECT name FROM users WHERE id = ?').get(id)?.name ?? null) : null);
    return rows
      .map((r) => {
        const last = r.last_id ? (lastMessages.get(r.last_id) ?? null) : null;
        return {
          ...withPeer(groupDto(r), userId),
          role: r.role,
          memberCount: r.member_count,
          unread: r.unread,
          lastMessage: last,
          // Names for the one-line preview: the author, or whoever a system message is about.
          lastAuthorName: last ? nameOf(last.authorId ?? last.meta?.userId) : null,
        };
      })
      .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt) - (a.lastMessage?.createdAt ?? a.createdAt));
  }

  function groupDetail(groupId, userId) {
    const g = q('SELECT * FROM groups WHERE id = ?').get(groupId);
    const m = membership(groupId, userId);
    const dto = groupDto(g);
    // Members whose birthday is today (the group can switch the confetti off).
    const md = `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    const birthdaysToday = dto.settings.birthdays
      ? q(
          `SELECT users.id FROM members JOIN users ON users.id = members.user_id
           WHERE members.group_id = ? AND members.status = 'active' AND substr(users.birthday, -5) = ?`,
        )
          .all(groupId, md)
          .map((r) => r.id)
      : [];
    return {
      ...withPeer(dto, userId),
      role: m.role,
      mutedUntil: m.muted_until && m.muted_until > now() ? m.muted_until : null,
      memberCount: memberIds(groupId).length,
      birthdaysToday,
      // How far each member has read (user id -> last read message id): the ticks under my messages.
      reads: Object.fromEntries(
        q(`SELECT user_id, last_read_id FROM members WHERE group_id = ? AND status = 'active'`)
          .all(groupId)
          .map((r) => [r.user_id, r.last_read_id]),
      ),
    };
  }

  /** A direct conversation is shown as the other person: their name, their picture. */
  function withPeer(dto, userId) {
    if (!dto.direct) return dto;
    const other = q("SELECT users.* FROM members JOIN users ON users.id = members.user_id WHERE group_id = ? AND user_id != ? AND status = 'active'").get(dto.id, userId);
    return { ...dto, name: other?.name ?? 'Discussion', peer: other ? userDto(other) : null };
  }

  /** People who share at least one group with userId: the ones they can start a conversation with. */
  function contacts(userId) {
    return q(
      `SELECT DISTINCT users.* FROM members a JOIN members b ON a.group_id = b.group_id
       JOIN users ON users.id = b.user_id
       WHERE a.user_id = ? AND b.user_id != ? AND users.disabled = 0 AND a.status = 'active' AND b.status = 'active'
         AND a.group_id NOT IN (SELECT id FROM groups WHERE deleted_at IS NOT NULL)
       ORDER BY users.name COLLATE NOCASE`,
    ).all(userId, userId);
  }

  /** The existing two-person conversation between a and b, or a new one. */
  function directGroup(a, b) {
    const existing = q(
      `SELECT g.id FROM groups g
       JOIN members ma ON ma.group_id = g.id AND ma.user_id = ?
       JOIN members mb ON mb.group_id = g.id AND mb.user_id = ?
       WHERE g.direct = 1 AND (SELECT COUNT(*) FROM members WHERE group_id = g.id) = 2`,
    ).get(a, b);
    if (existing) return { id: existing.id, created: false };
    return tx(db, () => {
      const ts = now();
      const { lastInsertRowid } = q("INSERT INTO groups (name, color, icon, created_by, created_at, direct) VALUES ('', 'lilas', 'heart', ?, ?, 1)").run(a, ts);
      const id = Number(lastInsertRowid);
      for (const uid of [a, b]) q("INSERT INTO members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(id, uid, ts);
      return { id, created: true };
    });
  }

  /** Deletes a group for good (purge, or "Supprimer définitivement"): returns its media files to remove. */
  function deleteGroup(groupId) {
    const files = q('SELECT file FROM media WHERE group_id = ?').all(groupId).map((f) => f.file);
    const members = memberIds(groupId);
    q('DELETE FROM groups WHERE id = ?').run(groupId);
    return { files, members };
  }

  /** "Supprimer le groupe": it disappears for everyone, but stays restorable from the admin for 30 days. */
  function trashGroup(groupId, by) {
    const members = memberIds(groupId);
    q('UPDATE groups SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').run(now(), by, groupId);
    return { members };
  }

  function restoreGroup(groupId) {
    const ok = q('UPDATE groups SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(groupId).changes > 0;
    return ok ? memberIds(groupId) : null;
  }

  /** Groups in the trash for more than 30 days: deleted for good. Returns the media files to remove. */
  function purgeTrash() {
    const files = [];
    for (const g of q('SELECT id FROM groups WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(now() - TRASH_DAYS * 86_400_000)) {
      files.push(...deleteGroup(g.id).files);
    }
    return files;
  }

  function createGroup({ name, color, icon, ownerId }) {
    return tx(db, () => {
      const ts = now();
      const { lastInsertRowid } = q('INSERT INTO groups (name, color, icon, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
        name,
        color,
        icon,
        ownerId ?? null,
        ts,
      );
      const id = Number(lastInsertRowid);
      if (ownerId) q("INSERT INTO members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(id, ownerId, ts);
      return id;
    });
  }

  function createInvite({ groupId = null, createdBy = null, expiresIn = null, maxUses = null, byAdmin = false }) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = makeCode();
      if (q('SELECT 1 FROM invites WHERE code = ?').get(code)) continue;
      const ts = now();
      q('INSERT INTO invites (code, group_id, created_by, created_at, expires_at, max_uses, by_admin) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        code,
        groupId,
        createdBy,
        ts,
        expiresIn ? ts + expiresIn : null,
        maxUses,
        byAdmin ? 1 : 0,
      );
      return inviteDto(q('SELECT * FROM invites WHERE code = ?').get(code));
    }
    throw new HttpError(500, 'code_generation_failed');
  }

  function usableInvite(code) {
    const inv = q('SELECT * FROM invites WHERE code = ?').get(code);
    if (!inv || inv.revoked) throw new HttpError(404, 'invalid_code', 'Code inconnu ou révoqué');
    if (inv.group_id && q('SELECT deleted_at FROM groups WHERE id = ?').get(inv.group_id)?.deleted_at) {
      throw new HttpError(404, 'invalid_code', 'Code inconnu ou révoqué');
    }
    if (inv.expires_at && inv.expires_at < now()) throw new HttpError(410, 'code_expired', 'Ce code a expiré');
    if (inv.max_uses && inv.uses >= inv.max_uses) throw new HttpError(410, 'code_used', 'Ce code a déjà servi');
    return inv;
  }

  // Adds the user to the invite's group (if any). Returns the group id joined, or null.
  function redeemInvite(inv, userId) {
    const existing = inv.group_id && q('SELECT status FROM members WHERE group_id = ? AND user_id = ?').get(inv.group_id, userId);
    if (existing) return { groupId: inv.group_id, alreadyMember: true, pending: existing.status === 'pending' };
    q('UPDATE invites SET uses = uses + 1 WHERE code = ?').run(inv.code);
    if (!inv.group_id) return { groupId: null, alreadyMember: false };
    // A group created from the admin web starts empty: its first member becomes its owner.
    const empty = !q("SELECT 1 FROM members WHERE group_id = ? AND status = 'active'").get(inv.group_id);
    // "Valider les nouveaux membres": the newcomer waits for an admin.
    const pending = !empty && groupSettings(q('SELECT settings FROM groups WHERE id = ?').get(inv.group_id)?.settings).approval;
    q('INSERT INTO members (group_id, user_id, role, joined_at, status) VALUES (?, ?, ?, ?, ?)').run(
      inv.group_id,
      userId,
      empty ? 'owner' : 'member',
      now(),
      pending ? 'pending' : 'active',
    );
    return { groupId: inv.group_id, alreadyMember: false, pending };
  }

  function approveMember(groupId, userId) {
    return q("UPDATE members SET status = 'active', joined_at = ? WHERE group_id = ? AND user_id = ? AND status = 'pending'").run(now(), groupId, userId).changes > 0;
  }

  function removeMember(groupId, userId) {
    return tx(db, () => {
      q('DELETE FROM members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
      const remaining = q("SELECT user_id, role FROM members WHERE group_id = ? AND status = 'active' ORDER BY joined_at").all(groupId);
      if (remaining.length === 0) {
        q('DELETE FROM groups WHERE id = ?').run(groupId);
        return { groupDeleted: true };
      }
      // A group always keeps an owner: hand it to the oldest admin, else the oldest member.
      if (!remaining.some((r) => r.role === 'owner')) {
        const heir = remaining.find((r) => r.role === 'admin') ?? remaining[0];
        q("UPDATE members SET role = 'owner' WHERE group_id = ? AND user_id = ?").run(groupId, heir.user_id);
        return { groupDeleted: false, newOwnerId: heir.user_id };
      }
      return { groupDeleted: false };
    });
  }

  /** The user's permanent code, created on first use; `fresh` replaces it (the old one stops working). */
  function personalCode(userId, { fresh = false } = {}) {
    const current = q('SELECT personal_code FROM users WHERE id = ?').get(userId)?.personal_code;
    if (current && !fresh) return current;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = makePersonalCode();
      if (q('SELECT 1 FROM users WHERE personal_code = ?').get(code)) continue;
      q('UPDATE users SET personal_code = ? WHERE id = ?').run(code, userId);
      return code;
    }
    throw new HttpError(500, 'code_generation_failed');
  }

  function userByPersonalCode(code) {
    const u = q('SELECT * FROM users WHERE personal_code = ?').get(code);
    return u && !u.disabled ? u : null;
  }

  /**
   * Folds sourceId into targetId: groups, messages, reactions, media and devices move over, then
   * the source account is deleted. The target keeps its name and profile (and takes the source's
   * photo only if it had none). Returns the groups touched and a photo to delete, if any.
   */
  function mergeUsers(sourceId, targetId) {
    return tx(db, () => {
      const groups = [];
      for (const m of q('SELECT * FROM members WHERE user_id = ?').all(sourceId)) {
        const t = q('SELECT * FROM members WHERE group_id = ? AND user_id = ?').get(m.group_id, targetId);
        if (t) {
          const role = ROLE_RANK[m.role] < ROLE_RANK[t.role] ? m.role : t.role;
          const status = m.status === 'active' || t.status === 'active' ? 'active' : 'pending';
          q('UPDATE members SET role = ?, status = ?, last_read_id = MAX(last_read_id, ?), joined_at = MIN(joined_at, ?) WHERE group_id = ? AND user_id = ?').run(
            role,
            status,
            m.last_read_id,
            m.joined_at,
            m.group_id,
            targetId,
          );
          q('DELETE FROM members WHERE group_id = ? AND user_id = ?').run(m.group_id, sourceId);
        } else {
          q('UPDATE members SET user_id = ? WHERE group_id = ? AND user_id = ?').run(targetId, m.group_id, sourceId);
        }
        groups.push(m.group_id);
      }
      q('UPDATE messages SET user_id = ? WHERE user_id = ?').run(targetId, sourceId);
      q(`UPDATE messages SET meta = json_set(meta, '$.userId', ?) WHERE type = 'system' AND json_extract(meta, '$.userId') = ?`).run(
        targetId,
        sourceId,
      );
      q('INSERT OR IGNORE INTO reactions (message_id, user_id, kind, created_at) SELECT message_id, ?, kind, created_at FROM reactions WHERE user_id = ?').run(
        targetId,
        sourceId,
      );
      q('DELETE FROM reactions WHERE user_id = ?').run(sourceId);
      q('INSERT OR IGNORE INTO poll_votes (message_id, user_id, option) SELECT message_id, ?, option FROM poll_votes WHERE user_id = ?').run(targetId, sourceId);
      q('DELETE FROM poll_votes WHERE user_id = ?').run(sourceId);
      q('INSERT OR IGNORE INTO favorites (user_id, kind, ref, data, created_at) SELECT ?, kind, ref, data, created_at FROM favorites WHERE user_id = ?').run(targetId, sourceId);
      q('DELETE FROM favorites WHERE user_id = ?').run(sourceId);
      q('INSERT OR IGNORE INTO story_views (story_id, user_id) SELECT story_id, ? FROM story_views WHERE user_id = ?').run(targetId, sourceId);
      q('DELETE FROM story_views WHERE user_id = ?').run(sourceId);
      q('UPDATE stories SET user_id = ? WHERE user_id = ?').run(targetId, sourceId);
      q('UPDATE stickers SET created_by = ? WHERE created_by = ?').run(targetId, sourceId);
      q('UPDATE games SET created_by = ? WHERE created_by = ?').run(targetId, sourceId);
      q('UPDATE messages SET pinned_by = ? WHERE pinned_by = ?').run(targetId, sourceId);
      q('UPDATE media SET owner_id = ? WHERE owner_id = ?').run(targetId, sourceId);
      q('UPDATE invites SET created_by = ? WHERE created_by = ?').run(targetId, sourceId);
      q('UPDATE groups SET created_by = ? WHERE created_by = ?').run(targetId, sourceId);
      q('UPDATE tokens SET user_id = ? WHERE user_id = ?').run(targetId, sourceId);
      q('UPDATE push_subscriptions SET user_id = ? WHERE user_id = ?').run(targetId, sourceId);

      const source = getUser(sourceId);
      const target = getUser(targetId);
      let deletePhoto = source.photo_media_id;
      if (!target.photo_media_id && source.photo_media_id) {
        q('UPDATE users SET photo_media_id = ? WHERE id = ?').run(source.photo_media_id, targetId);
        deletePhoto = null;
      }
      q('UPDATE users SET last_seen_at = MAX(COALESCE(last_seen_at, 0), ?) WHERE id = ?').run(source.last_seen_at ?? 0, targetId);
      q('UPDATE users SET photo_media_id = NULL WHERE id = ?').run(sourceId);
      q('DELETE FROM users WHERE id = ?').run(sourceId);
      return { groups, deletePhoto };
    });
  }

  // --- the server access code (Admin → tableau de bord): one standing code to create an account ----

  /** Who can create an account: 'open' (anyone, from the apps) or 'code' (an invitation or the server code). */
  function registration() {
    return q("SELECT value FROM admin_settings WHERE key = 'registration'").get()?.value === 'code' ? 'code' : 'open';
  }

  function setRegistration(mode) {
    q("INSERT INTO admin_settings (key, value) VALUES ('registration', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(mode === 'code' ? 'code' : 'open');
  }

  function serverCode({ create = false } = {}) {
    const code = q("SELECT value FROM admin_settings WHERE key = 'server_code'").get()?.value;
    const inv = code && q('SELECT * FROM invites WHERE code = ? AND revoked = 0').get(code);
    if (inv) return inv;
    return create ? regenerateServerCode() : null;
  }

  function regenerateServerCode() {
    return tx(db, () => {
      const old = q("SELECT value FROM admin_settings WHERE key = 'server_code'").get()?.value;
      if (old) q('UPDATE invites SET revoked = 1 WHERE code = ?').run(old);
      const { code } = createInvite({ byAdmin: true });
      q("INSERT INTO admin_settings (key, value) VALUES ('server_code', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(code);
      return q('SELECT * FROM invites WHERE code = ?').get(code);
    });
  }

  function disableServerCode() {
    const old = q("SELECT value FROM admin_settings WHERE key = 'server_code'").get()?.value;
    if (old) q('UPDATE invites SET revoked = 1 WHERE code = ?').run(old);
    q("DELETE FROM admin_settings WHERE key = 'server_code'").run();
  }

  return {
    db,
    q,
    serverCode,
    registration,
    setRegistration,
    regenerateServerCode,
    disableServerCode,
    personalCode,
    userByPersonalCode,
    contacts,
    directGroup,
    deleteGroup,
    trashGroup,
    restoreGroup,
    purgeTrash,
    mergeUsers,
    getUser,
    membership,
    requireMember,
    requireCanPost,
    requireAdmin,
    memberIds,
    getMessage,
    listMessages,
    findMessages,
    addMessage,
    groupSummaries,
    groupDetail,
    createGroup,
    createInvite,
    usableInvite,
    redeemInvite,
    approveMember,
    removeMember,
  };
}
