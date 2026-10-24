// Papote service worker: keeps the app shell available offline and loads it instantly.
// API calls, media and the WebSocket always go to the network (they need the session).
const VERSION = 'papote-web-v7';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/api.js',
  'js/ui.js',
  'js/emoji.js',
  'js/screens.js',
  'js/chat.js',
  'js/draw.js',
  'js/push.js',
  'js/extras.js',
  'js/screens2.js',
  'js/qr.js',
  'js/i18n.js',
  'i18n/en.json',
  'icons/badge-96.png',
  'fonts/Baloo2.ttf',
  'fonts/Nunito.ttf',
  'icons/icon.svg',
  'icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// "Partager" → Papote from another app (Web Share Target): keep what was shared, then let the
// app ask which conversation it goes to.
async function receiveShare(request) {
  try {
    const form = await request.formData();
    await caches.delete('papote-share');
    const cache = await caches.open('papote-share');
    const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '' };
    await cache.put('meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    const file = form.getAll('file').find((f) => f && typeof f !== 'string' && f.size > 0);
    if (file) await cache.put('file', new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Name': encodeURIComponent(file.name || 'photo') } }));
  } catch {
    /* the share screen says there's nothing to share */
  }
  return Response.redirect('/web/#/share', 303);
}

// Stale-while-revalidate for the shell: instant start, fresh files on the next launch.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === location.origin && url.pathname === '/web/share') {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/web/')) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});

// --- Web Push ----------------------------------------------------------------------------------
// The server only pushes to browsers with no Papote page open, so every push becomes a notification
// (Safari and Chrome require one for each push anyway).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Papote', {
      body: data.body || 'Nouveau message',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || '/web/' },
    }),
  );
});

// Opening a notification: bring Papote to the front on that conversation (or open it).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/web/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(`${self.location.origin}/web/`));
      if (open) {
        await open.focus();
        open.postMessage({ type: 'open', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
