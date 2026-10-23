const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Raw(s);

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

// Tagged template that escapes every interpolation unless wrapped in raw() or produced by html``.
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${units[u]}`;
}

export function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function relative(ts) {
  if (!ts) return 'jamais';
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

const MASCOT = raw(`<svg width="40" height="38" viewBox="0 0 112 104" aria-hidden="true"><path d="M20 8 H92 a16 16 0 0 1 16 16 V64 a16 16 0 0 1 -16 16 H50 L30 98 L33 80 H20 a16 16 0 0 1 -16 -16 V24 a16 16 0 0 1 16 -16 Z" fill="#FFC2D1" stroke="#2E2442" stroke-width="5" stroke-linejoin="round"/><circle cx="42" cy="40" r="7" fill="#2E2442"/><circle cx="70" cy="40" r="7" fill="#2E2442"/></svg>`);

// Stroke icons (24×24) for the menu and page actions.
const ICON_PATHS = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  key: 'M15 7a4 4 0 1 1-3.5 6H9v2H7v2H4v-3l5.5-5.5A4 4 0 0 1 15 7zM16 9.5h.01',
  people: 'M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .6 3 2.6 3 5',
  groups: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  refresh: 'M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4',
  disk: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  restore: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5',
};

export const icon = (name, size = 20) =>
  raw(
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`,
  );

const NAV = [
  ['/admin', 'Tableau de bord', 'dashboard'],
  ['/admin/journal', 'Journal', 'list'],
  ['/admin/codes', 'Codes', 'key'],
  ['/admin/members', 'Membres', 'people'],
  ['/admin/groups', 'Groupes', 'groups'],
  ['/admin/security', 'Sécurité', 'shield'],
];

/** Title row of every page: title, one line of context, and the page's main actions. */
export function pageHead(title, sub, actions = '') {
  return html`<header class="head"><div><h1>${title}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</div><div class="actions">${actions}</div></header>`;
}

/**
 * Quick filter of a list page: a GET form (works without script), live-filtered as you type by admin.js.
 * selects: [{ name, label, value, options: [[value, label]] }]
 */
export function filterBar(action, { q = '', placeholder = 'Filtrer…', selects = [], count = null } = {}) {
  return html`<form method="get" action="${action}" class="filters" role="search" data-live>
<label class="search">${icon('search', 18)}<span class="sr">Filtrer</span><input type="search" name="q" value="${q}" placeholder="${placeholder}" autocomplete="off"></label>
${selects.map(
  (s) => html`<label class="select"><span class="sr">${s.label}</span><select name="${s.name}" aria-label="${s.label}">${s.options.map(
    ([v, l]) => html`<option value="${v}" ${String(v) === String(s.value) ? raw('selected') : ''}>${l}</option>`,
  )}</select></label>`,
)}
<button type="submit" class="ghost">Filtrer</button>
${count != null ? html`<span class="count" aria-live="polite">${count}</span>` : ''}
</form>`;
}

/** A centred page without navigation (restarting after a restore). */
export function messagePage(title, body, refresh = null) {
  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${refresh ? html`<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${title} · Papote admin</title>
<link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body class="center">
<main class="login">
${MASCOT}
<h1>${title}</h1>
${body}
</main>
</body>
</html>`;
}

export function layout({ title, current, version, flash, body }) {
  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · Papote admin</title>
<link rel="stylesheet" href="/admin/assets/admin.css">
<script src="/admin/assets/admin.js" defer></script>
</head>
<body>
<div class="shell">
<nav aria-label="Administration" class="side">
<div class="brand">${MASCOT}<span><strong>Papote</strong><small>Admin · v${version}</small></span></div>
<div class="nav-links">
${NAV.map(([href, label, ic]) => html`<a href="${href}" ${current === href ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${label}</span></a>`)}
</div>
<form method="post" action="/admin/logout" class="logout"><button type="submit" class="link">${icon('logout')}<span>Se déconnecter</span></button></form>
</nav>
<main>
<div class="wrap">
${flash ? html`<p class="flash ${flash.kind}" role="status">${flash.text}</p>` : ''}
${body}
</div>
</main>
</div>
</body>
</html>`;
}

function bare(title, body) {
  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · Papote admin</title>
<link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body class="center">
<main class="login">
${MASCOT}
<h1>Papote · admin</h1>
${body}
</main>
</body>
</html>`;
}

export function loginPage({ error, configError, minLength }) {
  if (configError === 'missing') {
    return bare('Connexion', html`<p>L’admin web est désactivée : définis <code>ADMIN_PASSWORD</code> dans l’environnement du conteneur puis redémarre-le.</p>`);
  }
  if (configError === 'too_short') {
    return bare(
      'Connexion',
      html`<p>L’admin web est désactivée : <code>ADMIN_PASSWORD</code> doit faire au moins ${minLength} caractères. Choisis-en un plus long puis redémarre le conteneur.</p>`,
    );
  }
  if (configError === 'weak') {
    return bare(
      'Connexion',
      html`<p>L’admin web est désactivée : <code>ADMIN_PASSWORD</code> ressemble à un exemple ou à un mot de passe courant. Choisis-en un vraiment à toi puis redémarre le conteneur.</p>`,
    );
  }
  return bare(
    'Connexion',
    html`<form method="post" action="/admin/login">
<label for="pw">Mot de passe admin</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<button type="submit" class="primary">Continuer</button>
</form>`,
  );
}

export function twoFactorPage({ error, recovery = false }) {
  return bare(
    'Double authentification',
    html`<form method="post" action="/admin/login/2fa">
${
  recovery
    ? html`<label for="code">Code de secours</label>
<input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EF23" required autofocus>`
    : html`<label for="code">Code de ton application d’authentification</label>
<input id="code" name="code" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" placeholder="123 456" required autofocus>`
}
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<button type="submit" class="primary">Valider</button>
</form>
<p class="empty">${
      recovery
        ? html`<a href="/admin/login/2fa">Utiliser l’application à la place</a>`
        : html`Téléphone perdu ? <a href="/admin/login/2fa?recovery=1">Utiliser un code de secours</a>`
    }</p>`,
  );
}
