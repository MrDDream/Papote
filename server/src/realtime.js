import { WebSocketServer } from 'ws';
import { REACTIONS, SESSION_COOKIE, now, parseCookies, sha256 } from './util.js';

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const forwarded = req.headers['x-forwarded-host']?.split(',')[0].trim();
    return new URL(origin).host === (forwarded || req.headers.host);
  } catch {
    return false;
  }
}

const TYPING_KINDS = ['text', 'draw', 'voice'];

// Keeps one set of sockets per user and fans events out to group members.
export function createHub({ store, authenticate, logger = console }) {
  const sockets = new Map(); // userId -> Set<WebSocket>
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  let closing = false;

  const isOnline = (userId) => (sockets.get(userId)?.size ?? 0) > 0;

  function sendToUser(userId, event) {
    const set = sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(event);
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  function sendToGroup(groupId, event, { except } = {}) {
    for (const uid of store.memberIds(groupId)) if (uid !== except) sendToUser(uid, event);
  }

  // Everyone who shares at least one group with userId (including userId).
  function contactsOf(userId) {
    return store
      .q(
        `SELECT DISTINCT b.user_id FROM members a JOIN members b ON a.group_id = b.group_id AND a.status = 'active' AND b.status = 'active'
         WHERE a.user_id = ? AND a.group_id NOT IN (SELECT id FROM groups WHERE deleted_at IS NOT NULL)`,
      )
      .all(userId)
      .map((r) => r.user_id);
  }

  function announcePresence(userId, online) {
    const event = { type: 'presence', userId, online };
    for (const uid of contactsOf(userId)) if (uid !== userId) sendToUser(uid, event);
  }

  function onClientMessage(userId, raw, ws) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // Live strokes (shared drawing, Pictionary): checked by the features layer, then relayed to the group.
    if (msg?.type === 'live' && Number.isInteger(msg.groupId) && typeof msg.channel === 'string') {
      const second = Math.floor(Date.now() / 1000);
      if (ws.liveSecond !== second) [ws.liveSecond, ws.liveCount] = [second, 0];
      if (++ws.liveCount > 80) return;
      if (!store.membership(msg.groupId, userId) || !hub.onLive?.(userId, msg)) return;
      sendToGroup(msg.groupId, { type: 'live', groupId: msg.groupId, channel: msg.channel, userId, data: msg.data }, { except: userId });
      return;
    }
    if (msg?.type === 'typing' && Number.isInteger(msg.groupId) && store.membership(msg.groupId, userId)) {
      sendToGroup(
        msg.groupId,
        { type: 'typing', groupId: msg.groupId, userId, kind: TYPING_KINDS.includes(msg.kind) ? msg.kind : 'text' },
        { except: userId },
      );
    }
  }

  function handleUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return false;
    const header = req.headers.authorization;
    const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    let token = header?.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    // Browsers send the session cookie with any page's WebSocket: only trust it from our own origin.
    if (!token && cookie && sameOrigin(req)) token = cookie;
    const tokenHash = token ? sha256(token) : null;
    const user = authenticate(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const wasOnline = isOnline(user.id);
      let set = sockets.get(user.id);
      if (!set) sockets.set(user.id, (set = new Set()));
      set.add(ws);
      ws.tokenHash = tokenHash;
      ws.isAlive = true;
      ws.on('pong', () => (ws.isAlive = true));
      ws.on('message', (data) => onClientMessage(user.id, data.toString(), ws));
      ws.on('close', () => {
        set.delete(ws);
        if (set.size === 0 && !closing) {
          sockets.delete(user.id);
          store.q('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), user.id);
          announcePresence(user.id, false);
        }
      });
      ws.send(JSON.stringify({ type: 'hello', userId: user.id, reactions: REACTIONS }));
      if (!wasOnline) announcePresence(user.id, true);
    });
    return true;
  }

  const heartbeat = setInterval(() => {
    for (const set of sockets.values()) {
      for (const ws of set) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();

  function disconnectUser(userId, code = 4001, reason = 'session_revoked') {
    for (const ws of sockets.get(userId) ?? []) ws.close(code, reason);
  }

  // One device signed out from another: close only that device's sockets.
  function disconnectToken(hash) {
    for (const set of sockets.values()) for (const ws of set) if (ws.tokenHash === hash) ws.close(4001, 'session_revoked');
  }

  function isTokenOnline(hash) {
    for (const set of sockets.values()) for (const ws of set) if (ws.tokenHash === hash) return true;
    return false;
  }

  function close() {
    closing = true;
    clearInterval(heartbeat);
    for (const set of sockets.values()) for (const ws of set) ws.terminate();
    wss.close();
  }

  function connectedCount() {
    return sockets.size;
  }

  logger.debug?.('realtime hub ready');
  const hub = {
    onLive: null,
    handleUpgrade,
    sendToUser,
    sendToGroup,
    isOnline,
    disconnectUser,
    disconnectToken,
    isTokenOnline,
    contactsOf,
    connectedCount,
    close,
  };
  return hub;
}
