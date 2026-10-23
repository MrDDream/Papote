// Web Push in the browser: ask once, subscribe with the server's key, keep the server in sync.
import { api } from './api.js';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const supported = () => isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * 'on' | 'off' | 'denied' | 'ios-install' (iPhone: only an installed PWA can receive them)
 * | 'insecure' (plain http) | 'unsupported'.
 */
export async function pushState() {
  if (!isSecureContext) return 'insecure';
  if (isIos() && !isStandalone()) return 'ios-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

function keyBytes(base64url) {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const sameKey = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === b[i]);

/** Subscribes this browser (asking permission if needed: call from a click). Returns true when on. */
export async function enablePush({ ask = true } = {}) {
  if (!supported()) return false;
  if (Notification.permission !== 'granted') {
    if (!ask || (await Notification.requestPermission()) !== 'granted') return false;
  }
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes((await api.pushKey()).publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Made for another server key (server reinstalled): start over.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.pushSubscribe(sub.toJSON());
  return true;
}

export async function disablePush() {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

/** After signing in: if notifications were already allowed here, tie them to this session again. */
export function syncPush() {
  if (supported() && Notification.permission === 'granted') enablePush({ ask: false }).catch(() => {});
}

/** Opening a conversation clears its notification. */
export async function clearNotifications(groupId) {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  for (const n of (await reg?.getNotifications({ tag: `group-${groupId}` })) ?? []) n.close();
}
