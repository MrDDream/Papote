import { api, live, ApiError } from './api.js';
import { clear, h, mascot } from './ui.js';
import { joinScreen, groupsScreen, inviteScreen, membersScreen, profileScreen, contactsScreen, shareScreen } from './screens.js';
import { chatScreen } from './chat.js';
import { drawScreen, liveDrawScreen, drawingScreen } from './draw.js';
import { groupSettingsScreen, searchScreen, galleryScreen, gamesScreen, gameScreen, recapScreen, photoEditScreen } from './screens2.js';
import { syncPush } from './push.js';
import { tr } from './i18n.js';

const root = document.getElementById('app');

/** App-wide state shared by the screens. */
export const session = {
  me: null,
  setMe(u) {
    this.me = u;
    // Screens that stay on screen (the sidebar) redraw names and avatars.
    if (u) window.dispatchEvent(new CustomEvent('papote:me'));
  },
};

// --- theme ----------------------------------------------------------------------

export function getTheme() {
  try {
    return localStorage.getItem('papote.theme') ?? 'auto';
  } catch {
    return 'auto';
  }
}

export function setTheme(mode) {
  try {
    localStorage.setItem('papote.theme', mode);
  } catch {
    /* ignore */
  }
  applyTheme();
}

export function getStyle() {
  try {
    return localStorage.getItem('papote.style') ?? 'papote';
  } catch {
    return 'papote';
  }
}

export function setStyle(style) {
  try {
    localStorage.setItem('papote.style', style);
  } catch {
    /* ignore */
  }
  applyTheme();
}

function applyTheme() {
  const mode = getTheme();
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  const style = getStyle();
  if (style === 'papote') delete document.documentElement.dataset.style;
  else document.documentElement.dataset.style = style;
}
applyTheme();

// --- install (PWA) -----------------------------------------------------------------

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  window.dispatchEvent(new CustomEvent('papote:installable'));
});

export const install = {
  get standalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  },
  get mobile() {
    return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  },
  get ios() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },
  get available() {
    return !!deferredInstall;
  },
  async prompt() {
    if (!deferredInstall) return false;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    deferredInstall = null;
    return outcome === 'accepted';
  },
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
}

// --- routing (hash based, so it works offline and inside the PWA scope) ---------------

let current = null;
let depth = 0; // in-app history entries, so "back" never leaves Papote

export function go(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) {
    history.pushState(null, '', hash);
    depth++;
  }
  render();
}

export function back(fallback = '/groups') {
  if (depth > 0) history.back();
  else go(fallback, { replace: true });
}

function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  const m = path.match(/^\/(\w+)(?:\/(\d+))?/);
  return { name: m?.[1] ?? 'groups', id: m?.[2] ? Number(m[2]) : null, query: new URLSearchParams(path.split('?')[1] ?? '') };
}

// On a computer: groups stay in a sidebar on the left, the current screen fills the rest.
const wide = matchMedia('(min-width: 900px)');
let sidebar = null; // { el, destroy, setActive } while the two-pane layout is shown
let pane = null;

function dropSidebar() {
  sidebar?.destroy?.();
  sidebar = null;
  pane = null;
  root.classList.remove('wide');
}

function render() {
  current?.destroy?.();
  current = null;
  const r = route();
  if (!session.me && r.name !== 'join') return go('/join', { replace: true });
  const twoPane = wide.matches && r.name !== 'join';
  const screens = {
    join: () => joinScreen(r.query),
    groups: () => (twoPane ? placeholderScreen() : groupsScreen()),
    chat: () => chatScreen(r.id, r.query),
    draw: () => drawScreen(r.id, r.query),
    live: () => liveDrawScreen(r.id),
    drawing: () => drawingScreen(r.id, r.query),
    settings: () => groupSettingsScreen(r.id),
    search: () => searchScreen(r.id),
    gallery: () => galleryScreen(r.id),
    games: () => gamesScreen(r.id),
    game: () => gameScreen(r.id),
    recap: () => recapScreen(r.id, r.query),
    photo: () => photoEditScreen(r.id, r.query),
    new: () => inviteScreen(null),
    invite: () => inviteScreen(r.id),
    members: () => membersScreen(r.id),
    profile: () => profileScreen(),
    contacts: () => contactsScreen(),
    share: () => shareScreen(),
  };
  current = (screens[r.name] ?? screens.groups)();
  if (twoPane) {
    if (!sidebar) {
      sidebar = groupsScreen();
      pane = h('main', { class: 'pane' });
      root.classList.add('wide');
      clear(root, h('aside', { class: 'side', 'aria-label': tr('Mes groupes') }, sidebar.el), pane);
    }
    sidebar.setActive(['chat', 'draw', 'invite', 'members', 'live', 'settings', 'search', 'gallery', 'games', 'recap', 'photo'].includes(r.name) ? r.id : null);
    clear(pane, current.el);
  } else {
    dropSidebar();
    clear(root, current.el);
  }
  current.el.querySelector('[autofocus]')?.focus();
}

function placeholderScreen() {
  return {
    el: h(
      'div',
      { class: 'screen placeholder' },
      mascot(120),
      h('h2', { class: 'title' }, tr('Choisis un groupe')),
      h('p', { class: 'muted' }, tr('Ou crée-en un nouveau pour commencer à papoter.')),
    ),
  };
}

wide.addEventListener('change', () => session.me && render());

window.addEventListener('popstate', () => {
  depth = Math.max(0, depth - 1);
  render();
});
window.addEventListener('papote:logout', () => {
  session.setMe(null);
  dropSidebar();
  live.stop();
  go('/join', { replace: true });
});

// Live connection only while the page is visible: saves battery on phones.
document.addEventListener('visibilitychange', () => {
  if (!session.me) return;
  if (document.visibilityState === 'visible') live.start();
  else live.stop();
});

export function loggedIn(user) {
  session.setMe(user);
  live.start();
  syncPush();
}

// A notification was opened while Papote was already open: go to that conversation.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type !== 'open' || !session.me) return;
  const hash = new URL(e.data.url, location.origin).hash.replace(/^#/, '');
  if (hash) go(hash);
});

// A merge done on another device moves this session to the surviving account.
live.on('reconnected', async () => {
  try {
    const me = await api.me();
    if (session.me && me.id !== session.me.id) {
      session.setMe(me);
      render();
    }
  } catch {
    /* a 401 logs out by itself */
  }
});

async function boot() {
  try {
    loggedIn(await api.me());
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) {
      clear(root, h('div', { class: 'boot' }, tr('Serveur injoignable')));
      setTimeout(boot, 5000);
      return;
    }
  }
  render();
}

boot();
