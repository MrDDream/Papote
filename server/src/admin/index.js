import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSVG } from 'uqr';
import crypto from 'node:crypto';
import { EXPIRIES, GROUP_ICONS, COLORS, cleanText, now, parseCookies, pick, hashPassword } from '../util.js';
import { filterBar, formatBytes, formatDate, html, icon, layout, loginPage, messagePage, pageHead, raw, relative, twoFactorPage } from './html.js';
import { TRASH_DAYS } from '../store.js';
import { rateLimit } from '../ratelimit.js';
import { createAdminSecurity, MIN_PASSWORD_LENGTH } from './security.js';
import { groupSecret, otpauthUrl } from './totp.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

const KIND_LABELS = { photo: 'Photos', voice: 'Vocaux', drawing: 'Dessins', avatar: 'Photos de profil' };
const KIND_COLORS = { photo: '#4A9BEF', voice: '#4CC38A', drawing: '#FF9F43', avatar: '#FF7A93' };
const EXPIRY_LABELS = { '1h': '1 heure', '24h': '24 heures', '7d': '7 jours', never: 'Jamais' };

// No inline script on admin pages: an injected <script> could not run. Only our own file (quick filters).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export function createAdmin({ store, hub, dataDir, adminPassword, allowedIps, requireTotp = false, version, secure, serverName = 'Papote', backups, gifs = null, whisper = null, updates = null, restore = null, logger = console }) {
  const router = express.Router();
  const { q } = store;
  const sec = createAdminSecurity({ store, dataDir, adminPassword, allowedIps, secure, requireTotp });

  // Flash messages ride in a short-lived cookie so POST → redirect → GET keeps them.
  function flash(res, kind, text) {
    res.append(
      'Set-Cookie',
      `papote_flash=${encodeURIComponent(JSON.stringify({ kind, text }))}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=30${secure ? '; Secure' : ''}`,
    );
  }

  function takeFlash(req, res) {
    const v = parseCookies(req.headers.cookie).papote_flash;
    if (!v) return null;
    res.append('Set-Cookie', 'papote_flash=; Path=/admin; Max-Age=0');
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }

  router.use(sec.ipGuard);
  router.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    // SameSite=Strict already keeps cookies off cross-site requests; refuse cross-site form posts outright.
    if (req.method === 'POST') {
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return res.status(403).send('Requête refusée');
    }
    next();
  });
  router.use('/assets', express.static(PUBLIC_DIR, { maxAge: '7d', index: false }));
  router.use(express.urlencoded({ extended: false, limit: '16kb' }));

  const sendLogin = (res, status, error) =>
    res.status(status).type('html').send(String(loginPage({ error, configError: sec.configError, minLength: MIN_PASSWORD_LENGTH })));
  const LOCKED = 'Trop d’échecs récents : les connexions sont bloquées quelques minutes.';

  // --- step 1: password -------------------------------------------------------------

  router.get('/login', (req, res) => {
    if (sec.currentSession(req)) return res.redirect(303, '/admin');
    sendLogin(res, 200);
  });

  router.post('/login', rateLimit({ windowMs: 15 * 60_000, max: 10 }), (req, res) => {
    if (sec.configError) return sendLogin(res, 503);
    if (sec.lockedOut()) return sendLogin(res, 429, LOCKED);
    if (!sec.passwordMatches(req.body?.password)) {
      sec.audit('login_failed', req, 'mot de passe');
      return sendLogin(res, 401, 'Mot de passe incorrect');
    }
    if (sec.totpEnabled()) {
      sec.startChallenge(req, res);
      return res.redirect(303, '/admin/login/2fa');
    }
    sec.createSession(req, res);
    sec.audit('login', req, 'mot de passe seul');
    res.redirect(303, sec.requireTotp ? '/admin/security' : '/admin');
  });

  // --- step 2: code from the authenticator app (or a recovery code) -------------------------

  router.get('/login/2fa', (req, res) => {
    if (!sec.hasChallenge(req)) return res.redirect(303, '/admin/login');
    res.type('html').send(String(twoFactorPage({ recovery: req.query.recovery === '1' })));
  });

  router.post('/login/2fa', rateLimit({ windowMs: 15 * 60_000, max: 20 }), (req, res) => {
    const recovery = !/^[\d\s]+$/.test(String(req.body?.code ?? ''));
    if (sec.lockedOut()) return sendLogin(res, 429, LOCKED);
    const challenge = sec.takeChallengeTry(req);
    if (!challenge) {
      sec.clearChallengeCookie(res);
      return sendLogin(res, 401, 'Délai dépassé ou trop d’essais : recommence avec ton mot de passe.');
    }
    const factor = sec.checkSecondFactor(req.body?.code);
    if (!factor) {
      sec.audit('totp_failed', req);
      return res.status(401).type('html').send(String(twoFactorPage({ recovery, error: 'Code incorrect ou déjà utilisé' })));
    }
    challenge.done();
    sec.clearChallengeCookie(res);
    sec.createSession(req, res);
    sec.audit('login', req, factor === 'recovery' ? `code de secours (${sec.recoveryLeft()} restants)` : 'mot de passe + application');
    if (factor === 'recovery') flash(res, 'error', `Code de secours utilisé : il t’en reste ${sec.recoveryLeft()}. Pense à en régénérer.`);
    res.redirect(303, '/admin');
  });

  // --- everything below requires a session ------------------------------------------------

  router.use((req, res, next) => {
    const session = sec.currentSession(req);
    if (!session) return res.redirect(303, '/admin/login');
    req.adminSession = session;
    // ADMIN_REQUIRE_2FA: nothing but the security page until 2FA is set up.
    if (sec.requireTotp && !sec.totpEnabled() && !req.path.startsWith('/security') && req.path !== '/logout') {
      return res.redirect(303, '/admin/security');
    }
    next();
  });

  router.post('/logout', (req, res) => {
    sec.destroySession(req, res);
    sec.audit('logout', req);
    res.redirect(303, '/admin/login');
  });

  const page = (req, res, current, title, body) =>
    res.type('html').send(String(layout({ title, current, version, flash: takeFlash(req, res), body })));

  // --- data helpers -----------------------------------------------------------

  function activeInvites() {
    return q(
      `SELECT invites.*, invites.rowid AS rid, groups.name AS group_name, users.name AS by_name FROM invites
       LEFT JOIN groups ON groups.id = invites.group_id
       LEFT JOIN users ON users.id = invites.created_by
       WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses)
         AND (invites.group_id IS NULL OR groups.deleted_at IS NULL)
       ORDER BY invites.created_at DESC`,
    ).all(now());
  }

  function storage() {
    const byKind = q('SELECT kind, SUM(size) AS bytes, COUNT(*) AS n FROM media GROUP BY kind').all();
    let disk = null;
    try {
      const s = fs.statfsSync(dataDir);
      disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch {
      /* statfs unsupported */
    }
    const dbBytes = ['papote.db', 'papote.db-wal']
      .map((f) => path.join(dataDir, f))
      .filter((f) => fs.existsSync(f))
      .reduce((sum, f) => sum + fs.statSync(f).size, 0);
    return { byKind, disk, dbBytes };
  }

  // A code a member made for their group would open that group to whoever reads it: the admin only sees
  // server-access codes and the first-person codes of groups the admin created (still empty).
  const adminMayRead = (i) => !i.group_id || i.by_admin === 1;

  const inviteRows = (invites) =>
    invites.length === 0
      ? html`<p class="empty">Aucun code actif.</p>`
      : html`<div class="table"><table data-filterable>
<thead><tr><th scope="col">Code</th><th scope="col">Groupe</th><th scope="col">Créé par</th><th scope="col">Utilisations</th><th scope="col">Expire</th><th scope="col"><span class="sr">Action</span></th></tr></thead>
<tbody>
${invites.map(
  (i) => html`<tr data-search="${shownCode(i)} ${i.group_name ?? 'Accès au serveur'} ${i.by_name ?? 'Admin'}">
<td class="code">${adminMayRead(i) ? i.code : html`${i.code.slice(0, 3)}-<span title="Code créé par un membre pour son groupe : masqué">•••</span>`}</td>
<td><b>${i.group_name ?? 'Accès au serveur'}</b></td>
<td>${i.by_name ?? 'Admin'}</td>
<td>${i.uses} / ${i.max_uses ?? 'illimité'}</td>
<td>${i.expires_at ? relative(i.expires_at) : 'jamais'}</td>
<td class="actions"><form method="post" action="/admin/codes/${i.rid}/revoke"><button class="danger" type="submit">Révoquer</button></form></td>
</tr>`,
)}
</tbody></table></div>`;

  // Server-access codes only: a code for an existing group would let the admin read its history.
  function codeForm() {
    return html`<form method="post" action="/admin/codes" class="inline">
<label>Expire
<select name="expiresIn">
${Object.entries(EXPIRY_LABELS).map(([k, l]) => html`<option value="${k}" ${k === '24h' ? raw('selected') : ''}>${l}</option>`)}
</select></label>
<label class="check"><input type="checkbox" name="singleUse" value="1"> Usage unique</label>
<button type="submit" class="primary">Générer un code</button>
</form>`;
  }

  // The admin sees that backups exist, never what's inside: there is deliberately no download.
  // "Restaurer…" opens a confirmation box made with :target (admin pages run no inline script).
  /** New Papote version on GitHub: what's new, and how to install it (Docker image, Android APK). */
  function updatesCard() {
    const u = updates?.cached();
    if (!u) return '';
    const latest = u.latest;
    const pill = !u.enabled
      ? html`<span class="pill warn">Désactivée</span>`
      : u.available
        ? html`<span class="pill warn">v${latest.version} disponible</span>`
        : u.checkedAt && !u.error
          ? html`<span class="pill">À jour</span>`
          : html`<span class="pill warn">${u.checkedAt ? 'GitHub injoignable' : 'Vérification…'}</span>`;
    return html`<section class="card" aria-labelledby="maj">
<div class="card-head"><h2 id="maj">${icon('refresh')} Mises à jour</h2>${pill}</div>
${
  !u.enabled
    ? html`<p class="empty">Le serveur ne contacte pas GitHub (UPDATE_CHECK=false dans .env). Les nouvelles versions sont sur <a href="${u.releasesUrl}" rel="noopener noreferrer" target="_blank">GitHub</a>.</p>`
    : u.available
      ? html`<p><b>${latest.name}</b> est sortie${latest.publishedAt ? html` ${relative(latest.publishedAt)}` : ''}. Ce serveur est en v${u.current}.</p>
${latest.notes ? html`<details class="release-notes"><summary>Nouveautés</summary><pre>${latest.notes}</pre></details>` : ''}
<p class="empty">Serveur : dans le dossier de Papote, lance <code>docker compose pull &amp;&amp; docker compose up -d</code> (une sauvegarde avant ne fait pas de mal).${
          latest.apk ? html` Android : l’appli propose elle-même la nouvelle version, ou <a href="${latest.apk.url}" rel="noopener noreferrer">télécharge l’APK</a>.` : ''
        }</p>
<div class="actions"><a class="btn primary" href="${latest.url}" rel="noopener noreferrer" target="_blank">Voir la version sur GitHub</a></div>`
      : html`<p class="empty">${
          u.error ? `Dernier essai : ${u.error}.` : `v${u.current} est la dernière version${latest ? '' : ' (aucune publiée sur GitHub pour l’instant)'}.`
        }${u.checkedAt ? ` Vérifié ${relative(u.checkedAt)}.` : ''}</p>`
}
${u.enabled ? html`<form method="post" action="/admin/updates/check"><button type="submit" class="ghost">${icon('refresh')} Vérifier maintenant</button></form>` : ''}
</section>`;
  }

  function backupsCard() {
    const list = backups.list();
    const next = backups.nextAt();
    const latest = q("SELECT at, kind, detail FROM admin_events WHERE kind IN ('backup', 'backup_failed') ORDER BY id DESC LIMIT 1").get();
    const lastFailed = latest?.kind === 'backup_failed' ? latest : null;
    const totp = sec.totpEnabled();
    return html`<section class="card" aria-labelledby="bk">
<h2 id="bk">${icon('disk')} Sauvegarde &amp; Restauration</h2>
${lastFailed ? html`<p class="flash error">Dernière sauvegarde en échec (${formatDate(lastFailed.at)}) : ${lastFailed.detail}</p>` : ''}
<div class="svc"><span class="dot ${backups.everyHours ? '' : 'warn'}"></span><span><b>Automatiques</b><small>${
      backups.everyHours
        ? `Toutes les ${backups.everyHours} h · les ${backups.keep} dernières sont gardées · prochaine ${relative(next)}`
        : 'Désactivées (BACKUP_EVERY_HOURS=0)'
    }</small></span><span class="pill ${backups.everyHours ? '' : 'warn'}">${backups.everyHours ? 'Actives' : 'Arrêtées'}</span></div>
<p class="empty">Dossier : <code>${backups.dir}</code> · base + médias. ${
      backups.dir.startsWith(dataDir) ? 'Il est sur le même disque que les données : définis BACKUP_DIR vers un autre disque pour survivre à une panne.' : ''
    }</p>
${
  list.length
    ? html`<div class="table"><table class="compact">
<thead><tr><th scope="col">Sauvegarde</th><th scope="col">Taille</th><th scope="col"><span class="sr">Action</span></th></tr></thead>
<tbody>${list.map(
        (b, i) => html`<tr><td><b>${formatDate(b.at)}</b><br><small class="empty">${b.name}</small></td><td>${formatBytes(b.size)}</td>
<td class="actions">${restore ? html`<a class="btn ghost" href="#restore-${i}">${icon('restore', 16)} Restaurer…</a>` : ''}</td></tr>`,
      )}</tbody>
</table></div>
${
  restore
    ? list.map(
        (b, i) => html`<div class="modal" id="restore-${i}" role="dialog" aria-modal="true" aria-labelledby="restore-${i}-t">
<a class="modal-backdrop" href="#bk" aria-label="Annuler"></a>
<div class="modal-box">
<h2 id="restore-${i}-t">${icon('restore')} Restaurer la sauvegarde du ${formatDate(b.at)} ?</h2>
<p>Le serveur reviendra à l’état de ce moment-là : tout ce qui a été écrit, créé ou modifié depuis disparaîtra (messages, groupes, comptes, réglages, et aussi la 2FA et les sessions de l’admin).</p>
<p class="notice">Avant de restaurer, une sauvegarde de l’état actuel est faite automatiquement : tu pourras revenir en arrière. Le serveur redémarre ensuite (une dizaine de secondes) et tout le monde se reconnecte tout seul.</p>
<form method="post" action="/admin/backups/restore" class="inline">
<input type="hidden" name="name" value="${b.name}">
<input type="hidden" name="confirm" value="1">
${totp ? codeField : ''}
<button type="submit" class="danger">${icon('restore', 16)} Restaurer</button>
<a class="btn ghost" href="#bk">Annuler</a>
</form>
</div>
</div>`,
      )
    : ''
}`
    : html`<p class="empty">Aucune sauvegarde pour l’instant.</p>`
}
<form method="post" action="/admin/backup"><button type="submit" class="ghost">Lancer une sauvegarde maintenant</button></form>
</section>`;
  }

  // --- pages ------------------------------------------------------------------

  router.get('/', (req, res) => {
    const count = (sql, ...a) => q(sql).get(...a).n;
    const weekAgo = now() - 7 * 86_400_000;
    const server = store.serverCode();
    const otherInvites = activeInvites().filter((i) => i.code !== server?.code);
    const { byKind, disk, dbBytes } = storage();
    const mediaBytes = byKind.reduce((s, k) => s + k.bytes, 0);
    const total = disk?.total ?? Math.max(mediaBytes + dbBytes, 1);
    const used = mediaBytes + dbBytes;
    const lastBackup = backups.last();
    const stats = [
      ['Membres', count('SELECT COUNT(*) n FROM users WHERE disabled = 0'), `${hub.connectedCount()} connecté(s) maintenant`, 'var(--rose)'],
      ['Groupes', count('SELECT COUNT(*) n FROM groups WHERE direct = 0 AND deleted_at IS NULL'), `${count('SELECT COUNT(*) n FROM groups WHERE direct = 0 AND deleted_at IS NULL AND created_at > ?', weekAgo)} créé(s) cette semaine`, 'var(--menthe)'],
      ['Discussions à deux', count('SELECT COUNT(*) n FROM groups WHERE direct = 1 AND deleted_at IS NULL'), 'entre membres', 'var(--citron)'],
      ['Messages', count("SELECT COUNT(*) n FROM messages WHERE type != 'system'").toLocaleString('fr-FR'), 'depuis l’installation', 'var(--ciel)'],
    ];
    const health = [
      [sec.totpEnabled(), 'Double authentification', sec.totpEnabled() ? 'Activée sur l’admin' : 'Pas encore activée', '/admin/security'],
      [sec.restrictedByIp, 'Accès à l’admin', sec.restrictedByIp ? 'Limité par adresse IP' : 'Ouvert à toutes les adresses', '/admin/security'],
      [!!lastBackup && now() - lastBackup.at < 2 * 86_400_000, 'Sauvegardes', lastBackup ? `Dernière ${relative(lastBackup.at)}` : 'Aucune pour l’instant', '#bk'],
      [secure, 'Connexion', secure ? 'HTTPS' : 'HTTP (tests en local)', '/admin/security'],
      ...(updates?.status().available ? [[false, 'Mise à jour', `Papote v${updates.status().latest.version} est disponible`, '#maj']] : []),
      // Optional services: shown as "off" (not a problem), with how to turn them on in the README.
      [!!gifs?.enabled, 'GIF (GIPHY)', gifs?.enabled ? 'Activés, passent par le serveur' : 'Désactivés : clé GIPHY_API_KEY à mettre dans .env', '#services'],
      [!!whisper?.enabled, 'Transcription des vocaux', whisper?.enabled ? `Conteneur Whisper${whisper.pending ? ` · ${whisper.pending} en attente` : ''}` : 'Désactivée : COMPOSE_PROFILES=whisper dans .env pour l’activer', '#services'],
    ];
    page(
      req,
      res,
      '/admin',
      'Tableau de bord',
      html`${pageHead('Tableau de bord', html`<span class="dot"></span>${serverName} en ligne · v${version}`)}

<section class="card hero-code" aria-labelledby="sc">
<div class="card-head"><h2 id="sc">${icon('key')} Code d’accès au serveur</h2>${server ? html`<span class="pill">Actif</span>` : html`<span class="pill warn">Désactivé</span>`}</div>
${
  server
    ? html`<div class="row">
<div class="code-big" title="Clique pour le sélectionner, puis copie-le">${server.code}</div>
<div class="actions">
<form method="post" action="/admin/server-code/regenerate"><button type="submit" class="primary">${icon('refresh')} Régénérer</button></form>
<form method="post" action="/admin/server-code/disable"><button type="submit" class="ghost">Désactiver</button></form>
</div>
</div>
<div class="meta"><span>Créé ${relative(server.created_at)}</span><span>${server.uses} compte(s) créé(s) avec</span><span>Sans date limite</span></div>
<p class="empty">Avec ce code, n’importe qui peut créer un compte sur le serveur (dans l’app : « Rejoindre »). Il ne donne accès à aucun groupe. Régénère-le s’il a trop circulé : l’ancien cesse de marcher.</p>`
    : html`<p class="empty">Personne ne peut créer de compte sans un code ponctuel. Active un code permanent pour inviter facilement de nouvelles personnes sur le serveur.</p>
<form method="post" action="/admin/server-code/regenerate"><button type="submit" class="primary">${icon('key')} Créer le code d’accès</button></form>`
}
</section>

<section class="card" aria-labelledby="signup">
<div class="card-head"><h2 id="signup">${icon('people')} Inscriptions</h2>${
      store.registration() === 'open' ? html`<span class="pill">Ouvertes</span>` : html`<span class="pill warn">Sur invitation</span>`
    }</div>
<p class="empty">${
      store.registration() === 'open'
        ? 'N’importe qui peut créer un compte depuis l’app (pseudo, identifiant, mot de passe). Sans invitation, personne ne voit tes groupes : on y entre seulement si un membre l’ajoute.'
        : 'Pour créer un compte, il faut un code : celui d’un groupe ou le code d’accès au serveur ci-dessus.'
    }</p>
<form method="post" action="/admin/registration" class="inline">
<input type="hidden" name="mode" value="${store.registration() === 'open' ? 'code' : 'open'}">
<button type="submit" class="ghost">${store.registration() === 'open' ? 'Passer sur invitation' : 'Ouvrir les inscriptions'}</button>
</form>
</section>

<div class="stats">
${stats.map(([label, value, sub, bg]) => html`<div class="stat" style="background:${raw(bg)}"><b>${label}</b><span>${value}</span><small>${sub}</small></div>`)}
</div>

<div class="grid-main">
<div class="stack">
<section class="card" aria-labelledby="health">
<h2 id="health">${icon('shield')} Santé du serveur</h2>
<div class="health">
${health.map(
  ([ok, label, detail]) => html`<div class="tile ${ok ? '' : 'warn'}"><span class="dot ${ok ? '' : 'warn'}"></span><span><b>${label}</b><small>${detail}</small></span></div>`,
)}
</div>
</section>
<section class="card" aria-labelledby="stock">
<h2 id="stock">${icon('disk')} Stockage</h2>
<div class="bar" role="img" aria-label="${formatBytes(used)} utilisés sur ${formatBytes(total)}">
${byKind.map((k) => html`<span style="width:${raw(((k.bytes / total) * 100).toFixed(2))}%;background:${raw(KIND_COLORS[k.kind] ?? '#999')}"></span>`)}
<span style="width:${raw(((dbBytes / total) * 100).toFixed(2))}%;background:#8E7CC3"></span>
</div>
<div class="legend">
${byKind.map((k) => html`<span><i style="background:${raw(KIND_COLORS[k.kind] ?? '#999')}"></i>${KIND_LABELS[k.kind] ?? k.kind} · ${formatBytes(k.bytes)}</span>`)}
<span><i style="background:#8E7CC3"></i>Base de données · ${formatBytes(dbBytes)}</span>
</div>
<small class="empty">${formatBytes(used)} utilisés${disk ? html` · ${formatBytes(disk.free)} libres sur le disque` : ''}</small>
</section>
${updatesCard()}
${backupsCard()}
</div>

<div class="stack">
<section class="card" aria-labelledby="act">
<div class="card-head"><h2 id="act">${icon('activity')} Activité récente</h2><a href="/admin/journal">Tout le journal</a></div>
<ul class="events">
${sec.events(8).map(
  (e) => html`<li><time>${relative(e.at)}</time><span><b>${EVENT_LABELS[e.kind] ?? e.kind}</b>${e.detail ? html`<br><span class="detail">${e.detail}</span>` : ''}</span></li>`,
)}
</ul>
</section>
<section class="card" aria-labelledby="codes">
<div class="card-head"><h2 id="codes">${icon('key')} Codes ponctuels</h2><a href="/admin/codes">Gérer</a></div>
${otherInvites.length ? inviteRows(otherInvites.slice(0, 5)) : html`<p class="empty">Aucun code ponctuel actif.</p>`}
</section>
</div>
</div>`,
    );
  });

  router.post('/updates/check', async (req, res) => {
    const u = await updates?.check();
    if (!u) flash(res, 'error', 'Vérification indisponible');
    else if (u.error) flash(res, 'error', `GitHub injoignable : ${u.error}`);
    else flash(res, 'ok', u.available ? `Papote v${u.latest.version} est disponible` : 'Papote est à jour');
    res.redirect(303, '/admin#maj');
  });

  router.post('/registration', (req, res) => {
    store.setRegistration(req.body?.mode === 'code' ? 'code' : 'open');
    sec.audit('registration', req, store.registration());
    flash(res, 'ok', store.registration() === 'open' ? 'Inscriptions ouvertes à tous' : 'Inscriptions sur invitation seulement');
    res.redirect(303, '/admin');
  });

  router.post('/server-code/regenerate', (req, res) => {
    const inv = store.regenerateServerCode();
    sec.audit('server_code', req, `nouveau code ${inv.code}`);
    flash(res, 'ok', `Nouveau code d’accès : ${inv.code}. L’ancien ne marche plus.`);
    res.redirect(303, '/admin');
  });

  router.post('/server-code/disable', (req, res) => {
    store.disableServerCode();
    sec.audit('server_code', req, 'désactivé');
    flash(res, 'ok', 'Code d’accès désactivé : il faut maintenant un code ponctuel pour créer un compte.');
    res.redirect(303, '/admin');
  });

  const fold = (v) => String(v ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  /** Every word of the quick filter must appear somewhere in the row's visible fields. */
  const matches = (query, ...fields) => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const text = fold(fields.join(' '));
    return words.every((w) => text.includes(w));
  };
  const shownCode = (i) => (adminMayRead(i) ? i.code : `${i.code.slice(0, 3)}-•••`);

  router.get('/codes', (req, res) => {
    const query = String(req.query.q ?? '').slice(0, 60);
    const type = ['server', 'group'].includes(req.query.type) ? req.query.type : 'all';
    const all = activeInvites();
    const list = all.filter(
      (i) => (type === 'all' || (type === 'server') === !i.group_id) && matches(query, shownCode(i), i.group_name ?? 'Accès au serveur', i.by_name ?? 'Admin'),
    );
    page(
      req,
      res,
      '/admin/codes',
      'Codes d’invitation',
      html`${pageHead('Codes d’invitation', 'Codes ponctuels d’accès au serveur, en plus du code permanent du tableau de bord')}
<section class="card"><h2>Nouveau code</h2>
<p class="empty">Un code d’accès au serveur permet de créer son compte puis ses propres groupes. Pour faire entrer quelqu’un dans un groupe existant, ce sont ses membres qui l’invitent depuis l’app : l’admin n’a pas accès au contenu des groupes.</p>
${codeForm()}</section>
<section class="card"><h2>Codes actifs</h2>
${filterBar('/admin/codes', {
  q: query,
  placeholder: 'Code, groupe, créé par…',
  count: list.length === all.length ? `${all.length}` : `${list.length} sur ${all.length}`,
  selects: [{ name: 'type', label: 'Type de code', value: type, options: [['all', 'Tous les codes'], ['server', 'Accès au serveur'], ['group', 'Codes de groupe']] }],
})}
${inviteRows(list)}</section>`,
    );
  });

  router.post('/codes', (req, res) => {
    const key = req.body.expiresIn in EXPIRIES ? req.body.expiresIn : '24h';
    const inv = store.createInvite({ expiresIn: EXPIRIES[key], maxUses: req.body.singleUse ? 1 : null, byAdmin: true });
    sec.audit('code_created', req, `${inv.code} · accès au serveur`);
    flash(res, 'ok', `Nouveau code : ${inv.code}`);
    res.redirect(303, '/admin/codes');
  });

  // By row id, not by code: the code of a member's group invite must not appear anywhere in the admin.
  router.post('/codes/:rid/revoke', (req, res) => {
    const inv = q('SELECT rowid AS rid, * FROM invites WHERE rowid = ?').get(Number(req.params.rid));
    if (inv) {
      q('UPDATE invites SET revoked = 1 WHERE rowid = ?').run(inv.rid);
      const shown = adminMayRead(inv) ? inv.code : `${inv.code.slice(0, 3)}-•••`;
      sec.audit('code_revoked', req, shown);
      flash(res, 'ok', `Code ${shown} révoqué`);
    }
    res.redirect(303, req.get('referer')?.includes('/admin/codes') ? '/admin/codes' : '/admin');
  });

  router.get('/members', (req, res) => {
    const users = q(
      `SELECT users.*, (SELECT COUNT(*) FROM members JOIN groups ON groups.id = members.group_id WHERE user_id = users.id AND groups.direct = 0 AND groups.deleted_at IS NULL) AS group_count,
         (SELECT COUNT(*) FROM tokens WHERE user_id = users.id) AS sessions
       FROM users ORDER BY disabled, name COLLATE NOCASE`,
    ).all();
    const query = String(req.query.q ?? '').slice(0, 60);
    const status = ['online', 'blocked', 'idle'].includes(req.query.status) ? req.query.status : 'all';
    const month = now() - 30 * 86_400_000;
    const shown = users.filter(
      (u) =>
        matches(query, u.name) &&
        (status === 'all' ||
          (status === 'online' && hub.isOnline(u.id)) ||
          (status === 'blocked' && u.disabled) ||
          (status === 'idle' && !hub.isOnline(u.id) && (u.last_seen_at ?? 0) < month)),
    );
    page(
      req,
      res,
      '/admin/members',
      'Membres',
      html`${pageHead('Membres', `${users.length} compte(s) sur le serveur`)}
<section class="card">
${filterBar('/admin/members', {
  q: query,
  placeholder: 'Nom…',
  count: shown.length === users.length ? `${users.length}` : `${shown.length} sur ${users.length}`,
  selects: [{ name: 'status', label: 'Statut', value: status, options: [['all', 'Tout le monde'], ['online', 'En ligne'], ['blocked', 'Bloqués'], ['idle', 'Pas venus depuis 30 jours']] }],
})}
${
  shown.length === 0
    ? html`<p class="empty">${users.length ? 'Personne avec ce filtre.' : 'Personne pour l’instant. Génère un code « accès au serveur » pour inviter la première personne.'}</p>`
    : html`<div class="table"><table data-filterable>
<thead><tr><th scope="col">Nom</th><th scope="col">Groupes</th><th scope="col">Appareils</th><th scope="col">Vu</th><th scope="col">Inscrit</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
<tbody>
${shown.map(
  (u) => html`<tr class="${u.disabled ? 'off' : ''}" data-search="${u.name}">
<td><b>${u.name}</b>${u.username ? html` <small class="empty">@${u.username}</small>` : ''}${hub.isOnline(u.id) ? html` <span class="pill">en ligne</span>` : ''}${u.disabled ? html` <span class="pill off">bloqué</span>` : ''}</td>
<td>${u.group_count}</td>
<td>${u.sessions}</td>
<td>${hub.isOnline(u.id) ? 'maintenant' : relative(u.last_seen_at)}</td>
<td>${formatDate(u.created_at)}</td>
<td class="actions">
<a class="btn ghost" href="/admin/members/${u.id}/code" title="Mot de passe oublié, téléphone perdu">Nouveau mot de passe</a>
<form method="post" action="/admin/members/${u.id}/signout"><button class="soft" type="submit">Déconnecter</button></form>
<form method="post" action="/admin/members/${u.id}/${u.disabled ? 'enable' : 'disable'}"><button class="${u.disabled ? 'soft' : 'danger'}" type="submit">${u.disabled ? 'Débloquer' : 'Bloquer'}</button></form>
</td>
</tr>`,
)}
</tbody></table></div>`
}
</section>`,
    );
  });

  // Forgotten password, lost phone: a temporary password (and a username if the account had none),
  // the account's 2FA removed, every device signed out.
  router.get('/members/:id/code', (req, res) => {
    const u = store.getUser(Number(req.params.id));
    if (!u) return res.redirect(303, '/admin/members');
    page(
      req,
      res,
      '/admin/members',
      'Nouveau mot de passe',
      html`${pageHead(`Nouveau mot de passe pour ${u.name} ?`, 'Mot de passe oublié, téléphone perdu')}
<section class="card">
<p>Papote crée un mot de passe provisoire pour ${u.name}${u.username ? html` (identifiant <code>${u.username}</code>)` : ' et lui choisit un identifiant'}. L’ancien mot de passe cesse de marcher, tous ses appareils sont déconnectés (le téléphone perdu compris)${
        u.totp_secret ? ' et sa double authentification est retirée : elle pourra la réactiver ensuite' : ''
      }. Ses groupes et ses messages restent intacts.</p>
<p class="empty">Le mot de passe provisoire s’affiche une seule fois ici : donne-le à ${u.name} de vive voix ou par un moyen sûr. Elle pourra le changer dans Paramètres → Mon compte.</p>
<form method="post" action="/admin/members/${u.id}/code" class="inline">
<input type="hidden" name="confirm" value="1">
<button type="submit" class="danger">Créer un mot de passe provisoire</button>
<a class="btn ghost" href="/admin/members">Annuler</a>
</form>
</section>`,
    );
  });

  /** A username from the display name when the account has none yet ("Lou B." → "lou.b", "lou.b2"…). */
  function usernameFor(u) {
    const base = (u.name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'membre').slice(0, 20).padEnd(3, '0');
    for (let i = 0; i < 1000; i++) {
      const candidate = i ? `${base}${i + 1}` : base;
      if (!q('SELECT 1 FROM users WHERE username = ?').get(candidate)) return candidate;
    }
    return `membre${u.id}`;
  }

  router.post('/members/:id/code', (req, res) => {
    const u = store.getUser(Number(req.params.id));
    if (!u || req.body?.confirm !== '1') return res.redirect(303, '/admin/members');
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const raw = Array.from({ length: 12 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    const password = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
    const username = u.username ?? usernameFor(u);
    q('UPDATE users SET username = ?, password_hash = ?, totp_secret = NULL, totp_pending = NULL, recovery_codes = NULL WHERE id = ?').run(username, hashPassword(password), u.id);
    q('DELETE FROM tokens WHERE user_id = ?').run(u.id);
    hub.disconnectUser(u.id);
    sec.audit('member_code_reset', req, u.name);
    const origin = `${req.protocol}://${req.get('host')}`;
    page(
      req,
      res,
      '/admin/members',
      'Nouveau mot de passe',
      html`${pageHead(`Nouveau mot de passe pour ${u.name}`, 'Il ne sera plus affiché après cette page')}
<section class="card">
<p>Dans l’app (adresse du serveur <code>${origin}</code>), ${u.name} choisit « J’ai déjà un compte » et entre :</p>
<p>Identifiant : <code class="secret">${username}</code></p>
<div class="code-big">${password}</div>
<p class="empty">Tous ses appareils ont été déconnectés${u.totp_secret ? ' et sa double authentification retirée' : ''}. Ses groupes et ses messages l’attendent. Elle pourra changer ce mot de passe dans Paramètres → Mon compte.</p>
<a class="btn primary" href="/admin/members">Retour aux membres</a>
</section>`,
    );
  });

  router.post('/members/:id/:action', (req, res) => {
    const id = Number(req.params.id);
    const u = store.getUser(id);
    if (!u || !['signout', 'disable', 'enable'].includes(req.params.action)) return res.redirect(303, '/admin/members');
    sec.audit(`member_${req.params.action}`, req, u.name);
    if (req.params.action === 'signout' || req.params.action === 'disable') {
      q('DELETE FROM tokens WHERE user_id = ?').run(id);
      hub.disconnectUser(id);
    }
    if (req.params.action === 'disable') q('UPDATE users SET disabled = 1 WHERE id = ?').run(id);
    if (req.params.action === 'enable') q('UPDATE users SET disabled = 0 WHERE id = ?').run(id);
    const labels = { signout: 'déconnecté·e de tous ses appareils', disable: 'bloqué·e', enable: 'débloqué·e' };
    flash(res, 'ok', `${u.name} ${labels[req.params.action] ?? ''}`);
    res.redirect(303, '/admin/members');
  });

  router.get('/groups', (req, res) => {
    const stats = `(SELECT COUNT(*) FROM members WHERE group_id = groups.id AND status = 'active') AS member_count,
         (SELECT COUNT(*) FROM messages WHERE group_id = groups.id AND type != 'system') AS message_count,
         (SELECT COALESCE(SUM(size), 0) FROM media WHERE group_id = groups.id) AS bytes,
         (SELECT users.name FROM members JOIN users ON users.id = members.user_id WHERE group_id = groups.id AND role = 'owner') AS owner`;
    const live = q(`SELECT groups.*, ${stats} FROM groups WHERE direct = 0 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).all();
    const trash = q(`SELECT groups.*, ${stats} FROM groups WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all();
    const query = String(req.query.q ?? '').slice(0, 60);
    const view = req.query.view === 'trash' ? 'trash' : 'all';
    const groups = view === 'trash' ? [] : live.filter((g) => matches(query, g.name, g.owner ?? ''));
    const trashed = trash.filter((g) => matches(query, g.name, g.owner ?? '', g.deleted_by ?? ''));
    const daysLeft = (g) => Math.max(0, Math.ceil((g.deleted_at + TRASH_DAYS * 86_400_000 - now()) / 86_400_000));
    page(
      req,
      res,
      '/admin/groups',
      'Groupes',
      html`${pageHead('Groupes', `${live.length} groupe(s) · ${trash.length} dans la corbeille · les discussions à deux ne sont pas listées`)}
<section class="card"><h2>Créer un groupe</h2>
<p class="empty">Le groupe est créé vide ; un code d’invitation à usage unique est généré pour que sa première personne en devienne la créatrice.</p>
<form method="post" action="/admin/groups" class="inline">
<label>Nom <input name="name" maxlength="40" required></label>
<label>Couleur <select name="color">${COLORS.map((c) => html`<option>${c}</option>`)}</select></label>
<label>Icône <select name="icon">${GROUP_ICONS.map((c) => html`<option>${c}</option>`)}</select></label>
<button type="submit" class="primary">Créer</button>
</form></section>
<section class="card">
${filterBar('/admin/groups', {
  q: query,
  placeholder: 'Nom du groupe, créateur·rice…',
  count: `${groups.length + trashed.length}`,
  selects: [{ name: 'view', label: 'Groupes affichés', value: view, options: [['all', 'Groupes et corbeille'], ['trash', 'Corbeille seulement']] }],
})}
${
  view === 'trash'
    ? ''
    : groups.length === 0
      ? html`<p class="empty">${live.length ? 'Aucun groupe avec ce filtre.' : 'Aucun groupe.'}</p>`
      : html`<div class="table"><table data-filterable>
<thead><tr><th scope="col">Groupe</th><th scope="col">Créateur·rice</th><th scope="col">Membres</th><th scope="col">Messages</th><th scope="col">Médias</th><th scope="col">Créé</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
<tbody>
${groups.map(
  (g) => html`<tr data-search="${g.name} ${g.owner ?? ''}">
<td><b>${g.name}</b></td>
<td>${g.owner ?? '—'}</td>
<td>${g.member_count}</td>
<td>${g.message_count.toLocaleString('fr-FR')}</td>
<td>${formatBytes(g.bytes)}</td>
<td>${formatDate(g.created_at)}</td>
<td class="actions"><a class="btn danger" href="/admin/groups/${g.id}/delete">Supprimer…</a></td>
</tr>`,
)}
</tbody></table></div>`
}
</section>
<section class="card" aria-labelledby="trash">
<h2 id="trash">${icon('trash')} Corbeille</h2>
<p class="empty">Un groupe supprimé (par sa personne créatrice ou ici) disparaît pour tout le monde mais reste ${TRASH_DAYS} jours dans la corbeille : tu peux le restaurer tel quel, avec ses membres et ses messages. Ensuite il est effacé pour de bon.</p>
${
  trashed.length === 0
    ? html`<p class="empty">${trash.length ? 'Rien dans la corbeille avec ce filtre.' : 'La corbeille est vide.'}</p>`
    : html`<div class="table"><table data-filterable>
<thead><tr><th scope="col">Groupe</th><th scope="col">Membres</th><th scope="col">Supprimé</th><th scope="col">Par</th><th scope="col">Effacé dans</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
<tbody>
${trashed.map(
  (g) => html`<tr data-search="${g.direct ? 'Discussion à deux' : g.name} ${g.owner ?? ''} ${g.deleted_by ?? ''}">
<td><b>${g.direct ? 'Discussion à deux' : g.name}</b></td>
<td>${g.member_count}</td>
<td>${formatDate(g.deleted_at)}</td>
<td>${g.deleted_by ?? '—'}</td>
<td>${daysLeft(g)} jour(s)</td>
<td class="actions">
<form method="post" action="/admin/groups/${g.id}/restore"><button type="submit" class="soft">${icon('restore', 16)} Restaurer</button></form>
<a class="btn danger" href="/admin/groups/${g.id}/purge">Effacer…</a>
</td>
</tr>`,
)}
</tbody></table></div>`
}
</section>`,
    );
  });

  router.post('/groups', (req, res) => {
    const name = cleanText(req.body.name, 40);
    if (!name) {
      flash(res, 'error', 'Donne un nom au groupe');
      return res.redirect(303, '/admin/groups');
    }
    const id = store.createGroup({ name, color: pick(req.body.color, COLORS, 'rose'), icon: pick(req.body.icon, GROUP_ICONS, 'heart') });
    const inv = store.createInvite({ groupId: id, expiresIn: EXPIRIES['7d'], maxUses: 1, byAdmin: true });
    sec.audit('group_created', req, name);
    flash(res, 'ok', `Groupe « ${name} » créé. Code pour sa première personne : ${inv.code}`);
    res.redirect(303, '/admin/groups');
  });

  // Confirmation pages rather than a JavaScript confirm(): admin pages run no inline script.
  router.get('/groups/:id/delete', (req, res) => {
    const g = q('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
    if (!g) return res.redirect(303, '/admin/groups');
    const n = q("SELECT COUNT(*) n FROM messages WHERE group_id = ? AND type != 'system'").get(g.id).n;
    page(
      req,
      res,
      '/admin/groups',
      'Supprimer un groupe',
      html`${pageHead(`Supprimer « ${g.name} » ?`, `Il ira dans la corbeille pendant ${TRASH_DAYS} jours`)}
<section class="card">
<p>Le groupe et ses ${n.toLocaleString('fr-FR')} message(s) disparaîtront pour tous ses membres. Tu pourras le restaurer depuis la corbeille pendant ${TRASH_DAYS} jours ; ensuite il sera effacé du serveur avec ses médias.</p>
<form method="post" action="/admin/groups/${g.id}/delete" class="inline">
<input type="hidden" name="confirm" value="1">
<button type="submit" class="danger">Mettre à la corbeille</button>
<a class="btn ghost" href="/admin/groups">Annuler</a>
</form>
</section>`,
    );
  });

  router.post('/groups/:id/delete', (req, res) => {
    const id = Number(req.params.id);
    const g = req.body?.confirm === '1' && q('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL').get(id);
    if (g) {
      sec.audit('group_deleted', req, g.name);
      const { members } = store.trashGroup(id, 'Admin');
      for (const uid of members) hub.sendToUser(uid, { type: 'group.removed', groupId: id });
      flash(res, 'ok', `Groupe « ${g.name} » mis à la corbeille`);
    }
    res.redirect(303, '/admin/groups');
  });

  router.post('/groups/:id/restore', (req, res) => {
    const id = Number(req.params.id);
    const g = q('SELECT * FROM groups WHERE id = ?').get(id);
    const members = g && store.restoreGroup(id);
    if (members) {
      sec.audit('group_restored', req, g.direct ? 'discussion à deux' : g.name);
      // Members' apps reload their list: the group is back with its history.
      for (const uid of members) hub.sendToUser(uid, { type: 'group.updated', group: { id } });
      flash(res, 'ok', `Groupe « ${g.direct ? 'Discussion à deux' : g.name} » restauré pour ses ${members.length} membre(s)`);
    }
    res.redirect(303, '/admin/groups');
  });

  router.get('/groups/:id/purge', (req, res) => {
    const g = q('SELECT * FROM groups WHERE id = ? AND deleted_at IS NOT NULL').get(Number(req.params.id));
    if (!g) return res.redirect(303, '/admin/groups');
    page(
      req,
      res,
      '/admin/groups',
      'Effacer un groupe',
      html`${pageHead(`Effacer « ${g.direct ? 'Discussion à deux' : g.name} » pour de bon ?`, 'Cette action est définitive')}
<section class="card">
<p>Le groupe, tous ses messages et tous ses médias seront effacés du serveur tout de suite, sans attendre la fin des ${TRASH_DAYS} jours. Il ne restera que dans les sauvegardes déjà faites.</p>
<form method="post" action="/admin/groups/${g.id}/purge" class="inline">
<input type="hidden" name="confirm" value="1">
<button type="submit" class="danger">Effacer définitivement</button>
<a class="btn ghost" href="/admin/groups">Annuler</a>
</form>
</section>`,
    );
  });

  router.post('/groups/:id/purge', (req, res) => {
    const id = Number(req.params.id);
    const g = req.body?.confirm === '1' && q('SELECT * FROM groups WHERE id = ? AND deleted_at IS NOT NULL').get(id);
    if (g) {
      sec.audit('group_purged', req, g.direct ? 'discussion à deux' : g.name);
      const { files } = store.deleteGroup(id);
      for (const f of files) fs.rmSync(path.join(dataDir, 'media', f), { force: true });
      flash(res, 'ok', `Groupe effacé définitivement`);
    }
    res.redirect(303, '/admin/groups');
  });

  // Restoring a snapshot: the current state is backed up first, then the server puts the snapshot back
  // and restarts (Docker brings it up again).
  router.post('/backups/restore', (req, res) => {
    const snap = backups.list().find((b) => b.name === req.body?.name);
    if (!restore || !snap || req.body?.confirm !== '1') {
      flash(res, 'error', 'Sauvegarde introuvable');
      return res.redirect(303, '/admin#bk');
    }
    if (sec.totpEnabled() && !confirmSecondFactor(req, res, '/admin#bk')) return;
    let safety;
    try {
      safety = backups.run('avant restauration');
    } catch (err) {
      flash(res, 'error', `Restauration annulée : la sauvegarde de l’état actuel a échoué (${err.message})`);
      return res.redirect(303, '/admin#bk');
    }
    sec.audit('restore_started', req, `${snap.name} · état actuel gardé dans ${safety.name}`);
    res.on('finish', () =>
      setTimeout(() => {
        try {
          restore(snap.name, safety.name);
        } catch (err) {
          logger.error?.(`Restauration impossible : ${err.message}`);
        }
      }, 200),
    );
    res.type('html').send(
      String(
        messagePage(
          'Restauration en cours',
          html`<p>Le serveur remet la sauvegarde du ${formatDate(snap.at)} et redémarre. Cette page se recharge toute seule dans quelques secondes ; reconnecte-toi ensuite.</p>
<p class="empty">L’état d’avant est gardé dans <code>${safety.name}</code>.</p>
<p><a href="/admin/login">Aller à la connexion</a></p>`,
          '10;url=/admin/login',
        ),
      ),
    );
  });

  router.post('/backup', (req, res) => {
    try {
      const r = backups.run('manuel');
      flash(res, 'ok', `Sauvegarde ${r.name} écrite (${formatBytes(r.size)}, ${r.mediaCopied} nouveau(x) média(s) copié(s))`);
    } catch (err) {
      flash(res, 'error', `Sauvegarde impossible : ${err.message}`);
    }
    res.redirect(303, '/admin');
  });

  // --- Sécurité: 2FA, sessions, journal -----------------------------------------------------

  const EVENT_LABELS = {
    login: 'Connexion',
    login_failed: 'Échec de connexion',
    totp_failed: 'Code 2FA refusé',
    logout: 'Déconnexion',
    '2fa_enabled': '2FA activée',
    '2fa_disabled': '2FA désactivée',
    recovery_regenerated: 'Codes de secours régénérés',
    session_revoked: 'Session fermée',
    sessions_revoked: 'Autres sessions fermées',
    code_created: 'Code créé',
    code_revoked: 'Code révoqué',
    member_signout: 'Membre déconnecté',
    member_code_reset: 'Nouveau mot de passe pour un membre',
    registration: 'Inscriptions modifiées',
    member_disable: 'Membre bloqué',
    member_enable: 'Membre débloqué',
    group_created: 'Groupe créé',
    group_deleted: 'Groupe mis à la corbeille',
    group_restored: 'Groupe restauré',
    group_purged: 'Groupe effacé',
    restore_started: 'Restauration lancée',
    backup_restored: 'Sauvegarde restaurée',
    backup: 'Sauvegarde',
    backup_failed: 'Sauvegarde en échec',
    server_code: 'Code d’accès au serveur',
  };
  const DANGER_EVENTS = new Set(['login_failed', 'totp_failed', '2fa_disabled', 'backup_failed']);
  const EVENT_CATEGORIES = {
    access: ['Connexions', ['login', 'login_failed', 'totp_failed', 'logout', 'session_revoked', 'sessions_revoked']],
    security: ['Sécurité', ['2fa_enabled', '2fa_disabled', 'recovery_regenerated']],
    members: ['Membres', ['member_signout', 'member_disable', 'member_enable', 'member_code_reset']],
    groups: ['Groupes', ['group_created', 'group_deleted', 'group_restored', 'group_purged']],
    codes: ['Codes', ['code_created', 'code_revoked', 'server_code']],
    backups: ['Sauvegardes', ['backup', 'backup_failed', 'restore_started', 'backup_restored']],
  };
  const PERIODS = { '1d': ['24 heures', 86_400_000], '7d': ['7 jours', 7 * 86_400_000], '30d': ['30 jours', 30 * 86_400_000], all: ['Tout (90 jours)', null] };
  const JOURNAL_PAGE = 100;

  router.get('/journal', (req, res) => {
    const cat = req.query.cat in EVENT_CATEGORIES ? req.query.cat : 'all';
    const period = req.query.period in PERIODS ? req.query.period : 'all';
    const alerts = req.query.alerts === '1';
    const query = String(req.query.q ?? '').slice(0, 60);
    const before = Number(req.query.before) || null;
    const where = ['1 = 1'];
    const params = [];
    if (cat !== 'all') {
      where.push('kind IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(EVENT_CATEGORIES[cat][1]));
    }
    if (alerts) {
      where.push('kind IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify([...DANGER_EVENTS]));
    }
    if (PERIODS[period][1]) {
      where.push('at > ?');
      params.push(now() - PERIODS[period][1]);
    }
    if (before) {
      where.push('id < ?');
      params.push(before);
    }
    // The text filter also matches the event's French label.
    const rows = q(`SELECT * FROM admin_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 2000`).all(...params);
    const found = rows.filter((e) => matches(query, EVENT_LABELS[e.kind] ?? e.kind, e.ip ?? '', e.detail ?? ''));
    const list = found.slice(0, JOURNAL_PAGE);
    const keep = new URLSearchParams({ ...(cat !== 'all' ? { cat } : {}), ...(period !== 'all' ? { period } : {}), ...(alerts ? { alerts: '1' } : {}), ...(query ? { q: query } : {}) });
    page(
      req,
      res,
      '/admin/journal',
      'Journal',
      html`${pageHead('Journal', 'Connexions à l’admin et actions faites ici · gardé 90 jours')}
<section class="card">
${filterBar('/admin/journal', {
  q: query,
  placeholder: 'Événement, adresse IP, détail…',
  count: `${found.length >= 2000 ? '2000+' : found.length}`,
  selects: [
    { name: 'cat', label: 'Type d’événement', value: cat, options: [['all', 'Tous les événements'], ...Object.entries(EVENT_CATEGORIES).map(([k, [l]]) => [k, l])] },
    { name: 'period', label: 'Période', value: period, options: Object.entries(PERIODS).map(([k, [l]]) => [k, l]) },
    { name: 'alerts', label: 'Alertes', value: alerts ? '1' : '', options: [['', 'Tout'], ['1', 'Alertes seulement']] },
  ],
})}
${
  list.length === 0
    ? html`<p class="empty">Aucun événement avec ces filtres.</p>`
    : html`<div class="table"><table data-filterable>
<thead><tr><th scope="col">Quand</th><th scope="col">Événement</th><th scope="col">Adresse</th><th scope="col">Détail</th></tr></thead>
<tbody>
${list.map(
  (e) => html`<tr data-search="${EVENT_LABELS[e.kind] ?? e.kind} ${e.ip ?? ''} ${e.detail ?? ''}">
<td>${formatDate(e.at)}</td>
<td>${DANGER_EVENTS.has(e.kind) ? html`<span class="pill off">${EVENT_LABELS[e.kind] ?? e.kind}</span>` : EVENT_LABELS[e.kind] ?? e.kind}</td>
<td>${e.ip ?? '—'}</td>
<td>${e.detail ?? ''}</td>
</tr>`,
)}
</tbody></table></div>`
}
${found.length > JOURNAL_PAGE ? html`<a class="btn ghost" href="/admin/journal?${keep.toString() ? `${keep}&` : ''}before=${list.at(-1).id}">Plus anciens</a>` : ''}
</section>`,
    );
  });

  const shortAgent = (ua = '') => {
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} sur ${os}` : browser;
  };

  /** Re-checks a 6-digit (or recovery) code before a sensitive change. */
  function confirmSecondFactor(req, res, back) {
    if (sec.checkSecondFactor(req.body?.code)) return true;
    sec.audit('totp_failed', req, 'confirmation');
    flash(res, 'error', 'Code incorrect ou déjà utilisé');
    res.redirect(303, back);
    return false;
  }

  const codeField = html`<label>Code de l’application <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123 456" required></label>`;

  router.get('/security', (req, res) => {
    const enabled = sec.totpEnabled();
    const sessions = sec.sessions();
    page(
      req,
      res,
      '/admin/security',
      'Sécurité',
      html`${pageHead('Sécurité', 'Accès à l’admin, double authentification et sessions')}
${sec.requireTotp && !enabled ? html`<p class="flash error">ADMIN_REQUIRE_2FA est activé : configure la double authentification pour accéder au reste de l’admin.</p>` : ''}
<section class="card" aria-labelledby="access">
<h2 id="access">Accès à l’admin</h2>
<div class="svc"><span class="dot ${sec.restrictedByIp ? '' : 'warn'}"></span><span><b>Adresses autorisées</b><small>${
        sec.restrictedByIp ? 'Limité par ADMIN_ALLOWED_IPS : ailleurs, /admin répond 404.' : 'Ouvert à toutes les adresses. Définis ADMIN_ALLOWED_IPS pour le limiter (réseau local, VPN…).'
      }</small></span><span class="pill ${sec.restrictedByIp ? '' : 'warn'}">${sec.restrictedByIp ? 'Restreint' : 'Ouvert'}</span></div>
<div class="svc"><span class="dot ${enabled ? '' : 'warn'}"></span><span><b>Double authentification</b><small>${
        enabled ? `Code à 6 chiffres demandé à chaque connexion · ${sec.recoveryLeft()} code(s) de secours restant(s)` : 'Seul le mot de passe protège l’admin.'
      }</small></span><span class="pill ${enabled ? '' : 'warn'}">${enabled ? 'Activée' : 'Désactivée'}</span></div>
<div class="svc"><span class="dot ${secure ? '' : 'warn'}"></span><span><b>Cookies sécurisés</b><small>${
        secure ? 'Envoyés seulement en HTTPS.' : 'SECURE_COOKIES=false : à réserver aux tests en HTTP local.'
      }</small></span><span class="pill ${secure ? '' : 'warn'}">${secure ? 'HTTPS' : 'HTTP'}</span></div>
<small class="empty">Sessions : 30 min d’inactivité ou 12 h au plus · 10 essais de mot de passe par 15 min et par adresse · blocage général après 30 échecs en 15 min.</small>
</section>

<section class="card" aria-labelledby="tfa">
<h2 id="tfa">Double authentification (TOTP)</h2>
${
  enabled
    ? html`<p class="empty">Google Authenticator, Aegis, 2FAS, Bitwarden… À chaque connexion, après le mot de passe, l’admin demande le code à 6 chiffres affiché par l’application.</p>
<form method="post" action="/admin/security/2fa/recovery" class="inline">${codeField}<button type="submit" class="soft">Régénérer les codes de secours</button></form>
<form method="post" action="/admin/security/2fa/disable" class="inline">
<label>Mot de passe <input name="password" type="password" autocomplete="current-password" required></label>
${codeField}
<button type="submit" class="danger">Désactiver la 2FA</button>
</form>`
    : html`<p class="empty">Ajoute un code à usage unique, généré toutes les 30 secondes par une application sur ton téléphone, en plus du mot de passe.</p>
<form method="post" action="/admin/security/2fa/start"><button type="submit" class="primary">Activer la double authentification</button></form>`
}
</section>

<section class="card" aria-labelledby="sess">
<h2 id="sess">Sessions ouvertes</h2>
<div class="table"><table>
<thead><tr><th scope="col">Navigateur</th><th scope="col">Adresse</th><th scope="col">Ouverte</th><th scope="col">Activité</th><th scope="col"><span class="sr">Action</span></th></tr></thead>
<tbody>
${sessions.map(
  (s) => html`<tr>
<td><b>${shortAgent(s.user_agent)}</b>${s.id === req.adminSession.id ? html` <span class="pill">cette session</span>` : ''}</td>
<td>${s.ip ?? '—'}</td>
<td>${formatDate(s.created_at)}</td>
<td>${relative(s.last_seen_at)}</td>
<td class="actions">${
    s.id === req.adminSession.id
      ? ''
      : html`<form method="post" action="/admin/security/sessions/${s.id}/revoke"><button class="danger" type="submit">Fermer</button></form>`
  }</td>
</tr>`,
)}
</tbody></table></div>
${sessions.length > 1 ? html`<form method="post" action="/admin/security/sessions/revoke-others"><button type="submit" class="ghost">Fermer toutes les autres sessions</button></form>` : ''}
</section>

<p class="empty">Le journal des connexions et des actions de l’admin est dans l’onglet <a href="/admin/journal">Journal</a>.</p>`,
    );
  });

  router.post('/security/2fa/start', (req, res) => {
    if (sec.totpEnabled()) return res.redirect(303, '/admin/security');
    sec.startTotpSetup();
    res.redirect(303, '/admin/security/2fa');
  });

  router.get('/security/2fa', (req, res) => {
    const secret = sec.pendingTotp();
    if (!secret || sec.totpEnabled()) return res.redirect(303, '/admin/security');
    const url = otpauthUrl(secret, { issuer: serverName, account: `admin@${req.hostname}` });
    // uqr's SVG is built from our own otpauth URL only: safe to inline.
    const svg = renderSVG(url, { border: 4, whiteColor: '#FFFFFF', blackColor: '#2E2442' });
    page(
      req,
      res,
      '/admin/security',
      'Activer la 2FA',
      html`${pageHead('Activer la double authentification', 'Deux étapes, une minute')}
<section class="card">
<p><b>1.</b> Dans ton application (Google Authenticator, Aegis, 2FAS…), ajoute un compte en scannant ce QR code :</p>
<div class="qr">${raw(svg)}</div>
<p class="empty">Ou saisis la clé à la main : <code class="secret">${groupSecret(secret)}</code> (type « basé sur le temps », 6 chiffres, 30 s).</p>
<p><b>2.</b> Entre le code à 6 chiffres affiché par l’application pour confirmer :</p>
<form method="post" action="/admin/security/2fa/confirm" class="inline">${codeField}<button type="submit" class="primary">Confirmer</button></form>
</section>`,
    );
  });

  function showRecoveryCodes(req, res, codes, title) {
    page(
      req,
      res,
      '/admin/security',
      title,
      html`${pageHead(title, 'À noter maintenant')}
<section class="card">
<p><b>Note ces codes de secours maintenant</b> (gestionnaire de mots de passe, papier rangé…). Ils ne seront plus jamais affichés. Chacun permet une connexion si tu perds ton téléphone.</p>
<ul class="recovery">${codes.map((c) => html`<li><code>${c}</code></li>`)}</ul>
<a class="btn ghost" href="/admin/security">C’est noté</a>
</section>`,
    );
  }

  router.post('/security/2fa/confirm', (req, res) => {
    const codes = sec.confirmTotpSetup(req.body?.code);
    if (!codes) {
      flash(res, 'error', 'Code incorrect : vérifie l’heure du téléphone et réessaie.');
      return res.redirect(303, '/admin/security/2fa');
    }
    // Other sessions were opened with the password alone: close them.
    sec.deleteOtherSessions(req.adminSession.id);
    sec.audit('2fa_enabled', req);
    showRecoveryCodes(req, res, codes, 'Double authentification activée');
  });

  router.post('/security/2fa/recovery', (req, res) => {
    if (!confirmSecondFactor(req, res, '/admin/security')) return;
    const codes = sec.newRecoveryCodes();
    sec.audit('recovery_regenerated', req);
    showRecoveryCodes(req, res, codes, 'Nouveaux codes de secours');
  });

  router.post('/security/2fa/disable', (req, res) => {
    if (!sec.passwordMatches(req.body?.password)) {
      sec.audit('login_failed', req, 'désactivation 2FA');
      flash(res, 'error', 'Mot de passe incorrect');
      return res.redirect(303, '/admin/security');
    }
    if (!confirmSecondFactor(req, res, '/admin/security')) return;
    sec.disableTotp();
    sec.audit('2fa_disabled', req);
    flash(res, 'ok', 'Double authentification désactivée');
    res.redirect(303, '/admin/security');
  });

  router.post('/security/sessions/revoke-others', (req, res) => {
    sec.deleteOtherSessions(req.adminSession.id);
    sec.audit('sessions_revoked', req);
    flash(res, 'ok', 'Les autres sessions sont fermées');
    res.redirect(303, '/admin/security');
  });

  router.post('/security/sessions/:id/revoke', (req, res) => {
    if (/^[a-f0-9]{64}$/.test(req.params.id) && req.params.id !== req.adminSession.id) {
      sec.deleteSession(req.params.id);
      sec.audit('session_revoked', req);
    }
    res.redirect(303, '/admin/security');
  });

  return router;
}
