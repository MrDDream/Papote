import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { now } from './util.js';

// Push services of the browsers we support. The server POSTs to the endpoint a browser hands over, so
// anything else is refused: otherwise a crafted "subscription" could make it call the local network.
const PUSH_HOSTS = ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

export function isPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.port !== '') return false;
    return PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const PREVIEWS = {
  photo: '📷 Photo',
  drawing: '🎨 Dessin',
  voice: '🎤 Message vocal',
  gif: 'GIF',
  sticker: 'Sticker',
  poll: '📊 Sondage',
  location: '📍 Position',
  game: '🎲 Partie lancée',
  recap: '✨ Récap du mois',
};

/**
 * Web Push for the web app and the PWA (Chrome, Edge, Firefox, Safari / iPhone 16.4+ once installed).
 * Notifications are encrypted for the browser (RFC 8291): its push service relays them without reading them.
 */
export function createPush({ store, hub, dataDir, subject, keys, logger = console, send = webpush.sendNotification }) {
  const { q } = store;
  const file = path.join(dataDir, 'vapid.json');

  // VAPID keys identify this server to the push services. From the environment, else made once and kept.
  let vapid = keys?.publicKey && keys?.privateKey ? { ...keys } : null;
  if (!vapid && fs.existsSync(file)) vapid = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!vapid) {
    vapid = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(vapid), { mode: 0o600 });
  }
  if (subject) vapid.subject = subject;

  /** Apple refuses pushes without a contact: the env value, else this site's own https address. */
  function rememberSubject(origin) {
    if (vapid.subject || !origin?.startsWith('https://')) return;
    vapid.subject = origin;
    if (!keys?.publicKey) fs.writeFileSync(file, JSON.stringify(vapid), { mode: 0o600 });
  }

  function subscribe(userId, tokenHash, sub, origin) {
    const endpoint = sub?.endpoint;
    const { p256dh, auth } = sub?.keys ?? {};
    if (typeof endpoint !== 'string' || endpoint.length > 1000 || !isPushEndpoint(endpoint)) return false;
    if (!B64URL.test(p256dh ?? '') || !B64URL.test(auth ?? '') || p256dh.length > 200 || auth.length > 50) return false;
    rememberSubject(origin);
    q(
      `INSERT INTO push_subscriptions (endpoint, user_id, token_hash, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, token_hash = excluded.token_hash, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run(endpoint, userId, tokenHash, p256dh, auth, now());
    return true;
  }

  function unsubscribe(userId, endpoint) {
    q('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
  }

  async function deliver(row, payload) {
    if (!vapid.subject) return; // no https origin seen yet: browsers can't have subscribed anyway
    try {
      await send(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        { vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 24 * 3600, urgency: 'high' },
      );
    } catch (err) {
      // Gone or no longer valid (uninstalled, permission withdrawn): forget it.
      if (err?.statusCode === 404 || err?.statusCode === 410) q('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
      else logger.error?.(`Web Push : envoi impossible (${err?.statusCode ?? err?.message})`);
    }
  }

  /** A new message: every member's browsers, except the author's and pages already open (they get it live). */
  function notifyMessage({ groupId, message, authorId, authorName, groupName, direct }) {
    const rows = q(
      `SELECT push_subscriptions.* FROM push_subscriptions JOIN members ON members.user_id = push_subscriptions.user_id
       WHERE members.group_id = ? AND members.status = 'active' AND push_subscriptions.user_id != ?`,
    ).all(groupId, authorId);
    const text =
      message.type === 'text' ? message.text : message.type === 'poll' ? `📊 ${message.text}` : (PREVIEWS[message.type] ?? 'Nouveau message');
    const payload = {
      title: groupName,
      body: (direct ? text : `${authorName} : ${text}`).slice(0, 180),
      groupId,
      tag: `group-${groupId}`,
      url: `/web/#/chat/${groupId}`,
    };
    return Promise.all(rows.filter((r) => !hub.isTokenOnline(r.token_hash)).map((r) => deliver(r, payload)));
  }

  return { publicKey: vapid.publicKey, subscribe, unsubscribe, notifyMessage };
}
