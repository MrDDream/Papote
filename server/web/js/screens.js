import { api, live, ApiError } from './api.js';
import { session, go, back, loggedIn, install, getTheme, setTheme, getStyle, setStyle, getLook, setLook } from './app.js';
import { pushState, enablePush, disablePush } from './push.js';
import {
  h,
  clear,
  icon,
  iconButton,
  primaryButton,
  button,
  topBar,
  swatches,
  segmented,
  toggle,
  errorBox,
  confirmDialog,
  mascot,
  avatar,
  groupBadge,
  groupAvatar,
  infoButton,
  tint,
  surfaceOf,
  shortWhen,
  preview,
  lastSeen,
  roleLabel,
  resizeImage,
  GROUP_ICONS,
  sheet,
} from './ui.js';
import { qrScanner, canScan } from './qr.js';
import { pendingPhoto, pendingShare } from './extras.js';
import { tr, LANGS, lang, setLang } from './i18n.js';

const CODE_CHARS = /[A-HJ-NP-Z2-9]/;
const cleanCode = (s, length = 6) => [...(s ?? '').toUpperCase()].filter((c) => CODE_CHARS.test(c)).join('').slice(0, length);

/** Every screen returns { el, destroy? }. */
function screen(...children) {
  return h('div', { class: 'screen' }, ...children);
}

// --- join -----------------------------------------------------------------------

/** Signed in: join a group with its code. Not signed in: sign in or create an account (or, for an
 * account from before passwords, its personal code). */
export function joinScreen(query) {
  if (!session.me && query.get('link') !== '1') return authScreen(query);
  return codeJoinScreen(query);
}

// --- sign in, create an account ------------------------------------------------------------

function authScreen(query) {
  const invite = cleanCode(query.get('code'), 6);
  let mode = query.get('mode') === 'login' || (!invite && query.get('mode') !== 'register') ? 'login' : 'register';
  let registration = 'open';
  let color = 'rose';
  const err = errorBox();
  const field = (props) => h('input', { class: 'field', spellcheck: 'false', ...props });
  const nameInput = field({ id: 'name', placeholder: 'Lou', maxlength: 40, autocomplete: 'nickname' });
  const userInput = field({ id: 'username', placeholder: 'lou', maxlength: 25, autocomplete: 'username', autocapitalize: 'none' });
  const passInput = field({ id: 'password', type: 'password', minlength: 8, maxlength: 200 });
  const totpInput = field({ id: 'totp', autocomplete: 'one-time-code', placeholder: tr('123456 ou code de secours') });
  const codeInput = field({ id: 'code', placeholder: 'K7P-2Q9', maxlength: 7, autocapitalize: 'characters', value: invite });
  const totpWrap = h('div', { class: 'col', hidden: true }, h('label', { class: 'label', for: 'totp' }, tr('Code de ton application d’authentification')), totpInput);
  const submit = primaryButton(tr('Me connecter'), null, { iconName: 'forward', type: 'submit' });
  const card = h('div', { class: 'card', style: { position: 'relative' } });
  const switcher = h('button', { type: 'button', class: 'link-btn' });

  function render() {
    passInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    clear(
      card,
      mode === 'register' && h('div', { class: 'col' }, h('label', { class: 'label', for: 'name' }, tr('Ton petit nom')), nameInput, h('span', { class: 'small muted' }, tr('Le nom que tes groupes verront.'))),
      h('div', { class: 'col' }, h('label', { class: 'label', for: 'username' }, tr('Identifiant')), userInput, mode === 'register' && h('span', { class: 'small muted' }, tr('Pour te connecter, et pour qu’on t’ajoute dans un groupe. Lettres, chiffres, point ou tiret.'))),
      h('div', { class: 'col' }, h('label', { class: 'label', for: 'password' }, tr('Mot de passe')), passInput, mode === 'register' && h('span', { class: 'small muted' }, tr('8 caractères au moins.'))),
      mode === 'login' && totpWrap,
      mode === 'register' && h('div', { class: 'col', style: { gap: '8px' } }, h('span', { class: 'label' }, tr('Ta frimousse')), swatches(color, (c) => (color = c), { face: true })),
      mode === 'register' &&
        h(
          'div',
          { class: 'col' },
          h('label', { class: 'label', for: 'code' }, registration === 'code' ? tr('Code d’invitation') : tr('Code d’invitation (facultatif)')),
          codeInput,
          h('span', { class: 'small muted' }, registration === 'code' ? tr('Ce serveur demande un code : celui d’un groupe ou le code d’accès donné par l’admin.') : tr('Si on t’a donné le code d’un groupe, tu le rejoins tout de suite.')),
        ),
      err,
    );
    clear(submit, mode === 'login' ? tr('Me connecter') : tr('Créer mon compte'), icon('forward', 22, 2.4));
    clear(switcher, mode === 'login' ? tr('Je suis nouveau·elle ici : créer un compte') : tr('J’ai déjà un compte'));
  }
  switcher.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    err.show(null);
    render();
    (mode === 'register' ? nameInput : userInput).focus();
  });
  api.server().then((s) => ((registration = s.registration ?? 'open'), render())).catch(() => {});

  const form = h(
    'form',
    {
      class: 'scroll',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        err.show(null);
        try {
          if (mode === 'login') {
            const res = await api.login(userInput.value.trim(), passInput.value, totpInput.value.trim() || undefined);
            loggedIn(res.user);
            // Opened from an invitation while signed out: join its group too.
            if (invite.length === 6) {
              const joined = await api.join(invite, null, null).catch(() => null);
              if (joined?.pending) sessionStorage.setItem('papote.pendingNote', '1');
              return go(joined?.groupId ? `/chat/${joined.groupId}` : '/groups', { replace: true });
            }
            return go('/groups', { replace: true });
          }
          const code = cleanCode(codeInput.value, 6);
          const res = await api.register({ name: nameInput.value.trim(), username: userInput.value.trim(), password: passInput.value, color, code: code || undefined });
          loggedIn(res.user);
          if (res.pending) sessionStorage.setItem('papote.pendingNote', '1');
          go(res.groupId ? `/chat/${res.groupId}` : '/groups', { replace: true });
        } catch (e2) {
          if (e2.code === 'totp_required' || e2.code === 'totp_invalid') {
            totpWrap.hidden = false;
            totpInput.focus();
          }
          err.show(e2.message);
        }
        submit.disabled = false;
      },
    },
    h('div', { class: 'blob', style: { width: '220px', height: '220px', top: '-60px', right: '-70px', background: '#FFE3C7' } }),
    h('div', { class: 'blob', style: { width: '110px', height: '110px', top: '120px', left: '-50px', background: '#CDEFE0' } }),
    h('div', { class: 'hero' }, mascot(), h('h1', {}, 'Papote'), h('p', {}, tr('Tes petits groupes à toi, sur ton propre serveur.'))),
    card,
    h('div', { class: 'grow' }),
    submit,
    switcher,
    h('button', { type: 'button', class: 'link-btn small', onclick: () => go('/join?link=1', { replace: true }) }, tr('Compte d’avant, sans mot de passe ? Entre ton code personnel')),
  );
  render();
  (mode === 'register' ? nameInput : userInput).setAttribute('autofocus', '');
  return { el: screen(form) };
}

function codeJoinScreen(query) {
  const already = !!session.me;
  // "J'ai déjà un compte": a one-time code from another of my devices instead of an invitation.
  const linking = !already && query.get('link') === '1';
  const codeLength = linking ? 8 : 6;
  let code = cleanCode(query.get('code'), codeLength);
  let name = '';
  let color = 'rose';
  const err = errorBox();

  const input = h('input', {
    type: 'text',
    inputmode: 'text',
    autocapitalize: 'characters',
    autocomplete: 'one-time-code',
    spellcheck: 'false',
    'aria-label': tr`${linking ? tr('Code personnel') : tr('Code d’invitation')}, ${codeLength} caractères`,
    value: code,
  });
  // The cells are redrawn on each keystroke; the hidden input is never moved, or it would lose focus.
  const cellsEl = h('span', { style: { display: 'contents' } });
  const boxes = h('div', { class: 'code-boxes' }, cellsEl, input);
  const renderBoxes = () => {
    const cells = [];
    for (let i = 0; i < codeLength; i++) {
      if (i === codeLength / 2) cells.push(h('span', { class: 'code-dash', 'aria-hidden': 'true' }));
      cells.push(h('span', { class: `code-box${i === Math.min(code.length, codeLength - 1) ? ' active' : ''}${codeLength > 6 ? ' narrow' : ''}`, 'aria-hidden': 'true' }, code[i] ?? ''));
    }
    clear(cellsEl, cells);
  };
  input.addEventListener('input', () => {
    code = cleanCode(input.value, codeLength);
    input.value = code;
    renderBoxes();
    refresh();
  });
  input.addEventListener('focus', () => boxes.classList.add('focused'));
  input.addEventListener('blur', () => boxes.classList.remove('focused'));
  renderBoxes();

  const nameInput = h('input', { class: 'field', id: 'name', placeholder: 'Lou', maxlength: 40, autocomplete: 'nickname' });
  const totpWrap = h('div', { class: 'col', hidden: true });
  const totpInput = h('input', { class: 'field', id: 'totp', autocomplete: 'one-time-code', placeholder: tr('123456 ou code de secours') });
  totpWrap.append(h('label', { class: 'label', for: 'totp' }, tr('Code de ton application d’authentification')), totpInput);
  nameInput.addEventListener('input', () => {
    name = nameInput.value;
    refresh();
  });

  const submit = primaryButton(tr('Rejoindre'), null, { iconName: 'forward', type: 'submit' });
  const refresh = () => (submit.disabled = code.length !== codeLength || (!already && !linking && !name.trim()));
  refresh();

  const form = h(
    'form',
    {
      class: 'scroll',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        err.show(null);
        try {
          if (linking) {
            loggedIn((await api.link(code, totpInput.value.trim() || undefined)).user);
            go('/groups', { replace: true });
            return;
          }
          const res = await api.join(code, name.trim() || null, color);
          if (!already) loggedIn(res.user);
          if (res.pending) sessionStorage.setItem('papote.pendingNote', '1');
          go(res.groupId ? `/chat/${res.groupId}` : '/groups', { replace: true });
        } catch (e2) {
          if (e2.code === 'totp_required' || e2.code === 'totp_invalid') {
            totpWrap.hidden = false;
            totpInput.focus();
          }
          err.show(e2.message);
          refresh();
        }
      },
    },
    h('div', { class: 'blob', style: { width: '220px', height: '220px', top: '-60px', right: '-70px', background: '#FFE3C7' } }),
    h('div', { class: 'blob', style: { width: '110px', height: '110px', top: '120px', left: '-50px', background: '#CDEFE0' } }),
    already && iconButton('back', tr('Retour'), () => back()),
    h(
      'div',
      { class: 'hero' },
      mascot(),
      h('h1', {}, 'Papote'),
      h(
        'p',
        {},
        already
          ? tr('Entre le code qu’on t’a donné pour rejoindre un groupe.')
          : linking
            ? tr('Retrouve ton compte avec ton code personnel : il est dans Paramètres → « Mon code personnel » sur ton autre appareil.')
            : tr('Tes petits groupes à toi, sur ton propre serveur.'),
      ),
    ),
    h(
      'div',
      { class: 'card', style: { position: 'relative' } },
      h('div', { class: 'col' }, h('span', { class: 'label', 'aria-hidden': 'true' }, linking ? tr('Mon code personnel') : tr('Code d’invitation')), boxes),
      linking && totpWrap,
      !already && !linking && h('div', { class: 'col' }, h('label', { class: 'label', for: 'name' }, tr('Ton petit nom')), nameInput),
      !already && !linking && h('div', { class: 'col', style: { gap: '8px' } }, h('span', { class: 'label' }, tr('Ta frimousse')), swatches(color, (c) => (color = c), { face: true })),
      err,
    ),
    h('div', { class: 'grow' }),
    submit,
    canScan() &&
      button(tr('Scanner un QR code'), () =>
        qrScanner((text) => {
          // An invitation (…/web/#/join?code=K7P2Q9) or a personal code (…&link=1).
          try {
            const q = new URLSearchParams(new URL(text).hash.split('?')[1] ?? '');
            if (q.get('code')) return go(`/join?${q.get('link') === '1' ? 'link=1&' : ''}code=${encodeURIComponent(q.get('code'))}`, { replace: true });
          } catch {
            /* not a link: maybe the bare code */
          }
          const raw = cleanCode(text, 8);
          if (raw.length === 6 || raw.length === 8) go(`/join?${raw.length === 8 ? 'link=1&' : ''}code=${raw}`, { replace: true });
          else err.show(tr('Ce QR code n’est pas une invitation Papote'));
        }),
      { iconName: 'scan' }),
    !already &&
      h(
        'button',
        { type: 'button', class: 'link-btn', onclick: () => go(linking ? '/join' : '/join?link=1', { replace: true }) },
        linking ? tr('Je suis nouveau·elle ici') : tr('J’ai déjà un compte sur un autre appareil'),
      ),
  );
  if (linking) submit.firstChild.textContent = tr('Me connecter');
  if (!code) input.setAttribute('autofocus', '');
  return { el: screen(form) };
}

// --- groups -----------------------------------------------------------------------

export function groupsScreen() {
  let activeId = null;
  const list = h('div', { class: 'col', style: { gap: '12px' } });
  const status = h('span', { class: 'small muted row ellipsis', style: { gap: '6px' } });
  const err = errorBox();
  const searchWrap = h('div', { class: 'search' });
  const FILTERS = [['all', tr('Tous')], ['groups', tr('Groupes')], ['direct', tr('Discussions')], ['unread', tr('Non lus')]];
  let filter = 'all';
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': tr('Filtrer') });
  const search = h('input', { class: 'field', type: 'search', placeholder: tr('Chercher…'), 'aria-label': tr('Chercher un groupe ou une discussion') });
  searchWrap.append(icon('search', 20), search);
  let groups = [];
  let waiting = []; // groups that still have to approve me
  let invitations = []; // someone who isn't a contact yet invited me to a group
  const waitingEl = h('div', { class: 'col', style: { gap: '8px' } });

  const renderStatus = () =>
    clear(status, h('span', { class: `dot${live.connected ? ' on' : ''}` }), live.connected ? tr`Connecté·e à ${location.host}` : tr`Connexion à ${location.host}…`);

  const answer = (groupId, accept) => async () => {
    try {
      const res = accept ? await api.acceptInvitation(groupId) : (await api.declineInvitation(groupId), null);
      if (res?.groupId) return go(`/chat/${res.groupId}`);
      load();
    } catch (e) {
      err.show(e.message);
    }
  };

  function renderList() {
    clear(
      waitingEl,
      // An account from before passwords: a nudge to choose a username and a password.
      !session.me.hasPassword &&
        h(
          'button',
          { type: 'button', class: 'waiting-card', style: { textAlign: 'left', width: '100%', border: 'none' }, onclick: () => go('/profile') },
          icon('shield', 24),
          h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, tr('Choisis ton identifiant et ton mot de passe')), h('span', { class: 'small muted' }, tr('Pour te connecter sur tes autres appareils sans code.'))),
          icon('forward', 18),
        ),
      invitations.map((inv) =>
        h(
          'div',
          { class: 'waiting-card' },
          groupBadge(inv.group, 40),
          h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, inv.group.name), h('span', { class: 'small muted' }, inv.by ? tr`${inv.by} t’invite dans ce groupe` : tr('Invitation dans ce groupe'))),
          button(tr('Refuser'), answer(inv.group.id, false), { small: true }),
          button(tr('Rejoindre'), answer(inv.group.id, true), { small: true, iconName: 'check' }),
        ),
      ),
      waiting.map((g) =>
        h('div', { class: 'waiting-card' }, groupBadge(g, 40), h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, g.name), h('span', { class: 'small muted' }, tr('En attente : un·e admin du groupe doit valider ton arrivée')))),
      ),
    );
    const q = search.value.trim().toLowerCase();
    const keep = { all: () => true, groups: (g) => !g.direct, direct: (g) => g.direct, unread: (g) => g.unread > 0 }[filter];
    const visible = groups.filter((g) => (!q || g.name.toLowerCase().includes(q)) && keep(g));
    const unreadCount = groups.filter((g) => g.unread > 0).length;
    clear(
      chips,
      FILTERS.map(([key, label]) =>
        h(
          'button',
          { type: 'button', role: 'radio', class: 'chip-filter', 'aria-checked': String(key === filter), onclick: () => ((filter = key), renderList()) },
          key === 'unread' && unreadCount ? `${label} · ${unreadCount}` : label,
        ),
      ),
    );

    if (groups.length && !visible.length) {
      clear(list, h('p', { class: 'muted', style: { textAlign: 'center', margin: '24px 0' } }, tr('Rien ici avec ce filtre.')));
      return;
    }
    if (!groups.length) {
      clear(
        list,
        h('div', { class: 'empty' }, mascot(96), h('h2', { class: 'title', style: { fontSize: '20px' } }, tr('Pas encore de groupe')), h('p', { class: 'muted', style: { margin: 0 } }, tr('Crée le tien et partage son code, ou entre celui qu’on t’a donné.'))),
      );
      return;
    }
    clear(
      list,
      visible.map((g) => {
        const t = tint(g.color);
        const last = g.lastMessage;
        const author = last?.authorId && last.authorId === session.me?.id ? tr('Toi') : g.lastAuthorName;
        const line = last
          ? g.direct && author !== tr('Toi') && last.type === 'text'
            ? last.text
            : preview(last, author)
          : g.direct
            ? tr('Dis bonjour !')
            : `${g.memberCount} membre${g.memberCount > 1 ? 's' : ''}`;
        const kind = { drawing: 'pencil', voice: 'mic', photo: 'photo', video: 'video', file: 'file', gif: 'gif', sticker: 'sticker', poll: 'poll', location: 'location', game: 'game', recap: 'sparkles' }[last?.type] ?? 'text';
        const active = g.id === activeId;
        return h(
          'button',
          {
            type: 'button',
            class: `group-card${active ? ' active' : ''}`,
            style: { background: surfaceOf(t) },
            'aria-current': active ? 'page' : null,
            onclick: () => go(`/chat/${g.id}`),
          },
          groupAvatar(g, 52, { zoom: true }),
          h(
            'div',
            { class: 'col grow', style: { gap: '2px', minWidth: 0 } },
            h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'name grow ellipsis' }, g.name), h('span', { class: 'small muted', style: { fontWeight: 700 } }, shortWhen(last?.createdAt ?? g.createdAt))),
            h(
              'div',
              { class: 'row', style: { gap: '6px' } },
              h('span', { class: 'muted', style: { display: 'flex' } }, icon(kind, 16)),
              h('span', { class: 'muted grow ellipsis' }, line),
              g.unread > 0 && !active && h('span', { class: 'unread', 'aria-label': tr`${g.unread} non lus` }, g.unread > 99 ? '99+' : String(g.unread)),
            ),
          ),
        );
      }),
    );
  }

  let timer;
  async function load() {
    try {
      [groups, waiting, invitations] = await Promise.all([api.groups(), api.pendingGroups().catch(() => []), api.invitations().catch(() => [])]);
      err.show(null);
    } catch (e) {
      err.show(e.message);
    }
    renderList();
  }
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  };
  search.addEventListener('input', renderList);

  const head = h('div', { class: 'groups-head' });
  const renderHead = () =>
    clear(
      head,
      h('div', { style: { padding: '3px', background: 'var(--card)', borderRadius: '50%' } }, avatar(session.me, 42)),
      h('div', { class: 'col grow', style: { gap: 0, minWidth: 0 } }, h('h1', { class: 'ellipsis' }, session.me.name), status),
      iconButton('chatPlus', tr('Nouvelle discussion avec quelqu’un'), () => go('/contacts')),
      iconButton('settings', tr('Paramètres'), () => go('/profile')),
    );
  const onMe = () => {
    renderHead();
    soon();
  };
  window.addEventListener('papote:me', onMe);
  renderHead();

  const banner = h('div', {}, installBanner(), pushBanner());
  const offs = [
    ...['message.new', 'message.updated', 'group.updated', 'group.removed', 'group.approved', 'member.joined', 'member.left', 'group.read', 'group.refresh', 'invitation.new', 'reconnected'].map((t) => live.on(t, soon)),
    live.on('connection', renderStatus),
    live.on('user.updated', (e) => {
      if (e.user.id === session.me.id) session.setMe({ ...session.me, ...e.user });
    }),
  ];
  renderStatus();
  load();

  return {
    el: screen(
      h('div', { class: 'scroll' }, head, searchWrap, chips, err, waitingEl, list),
      banner,
      h('div', { class: 'bottom-actions' }, primaryButton(tr('Nouveau groupe'), () => go('/new')), button(tr('Rejoindre'), () => go('/join'), { iconName: 'keypad' })),
    ),
    destroy: () => {
      clearTimeout(timer);
      offs.forEach((off) => off());
      window.removeEventListener('papote:me', onMe);
    },
    // Sidebar mode: highlight the open group, and refresh its badge once the chat has marked it read.
    setActive(id) {
      if (id === activeId) return;
      activeId = id;
      renderList();
      soon();
    },
  };
}

/** Once, on the groups list: offer notifications when they're available but off. */
function pushBanner() {
  const wrap = h('div');
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('papote.pushPromptOff') === '1';
  } catch {
    /* ignore */
  }
  const hide = () => {
    try {
      localStorage.setItem('papote.pushPromptOff', '1');
    } catch {
      /* ignore */
    }
    clear(wrap);
  };
  if (!dismissed) {
    pushState().then((state) => {
      if (state !== 'off') return;
      const close = iconButton('close', tr('Masquer'), hide, { size: 18 });
      close.style.width = close.style.height = '36px';
      clear(
        wrap,
        h(
          'div',
          { class: 'install' },
          h('span', { style: { display: 'flex', color: 'var(--primary)' } }, icon('bell', 24)),
          h('span', { class: 'grow' }, tr('Être prévenu·e des nouveaux messages ?')),
          button(tr('Activer'), async () => {
            await enablePush().catch(() => false);
            hide();
          }, { small: true }),
          close,
        ),
      );
    });
  }
  return wrap;
}

/** On a phone, offer to install the PWA (Android/Chrome prompt, or the iOS share-sheet hint). */
function installBanner() {
  const wrap = h('div');
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('papote.installDismissed') === '1';
  } catch {
    /* ignore */
  }
  const render = () => {
    if (dismissed || install.standalone || !install.mobile || (!install.available && !install.ios)) return clear(wrap);
    const close = iconButton('close', tr('Masquer'), () => {
      dismissed = true;
      try {
        localStorage.setItem('papote.installDismissed', '1');
      } catch {
        /* ignore */
      }
      render();
    }, { size: 18 });
    close.style.width = close.style.height = '36px';
    clear(
      wrap,
      h(
        'div',
        { class: 'install' },
        mascot(36),
        install.available
          ? [h('span', { class: 'grow' }, tr('Installe Papote sur ton écran d’accueil.')), button(tr('Installer'), async () => (await install.prompt(), render()), { small: true })]
          : h('span', { class: 'grow' }, tr('Pour l’installer : touche Partager, puis « Sur l’écran d’accueil ».')),
        close,
      ),
    );
  };
  window.addEventListener('papote:installable', render);
  render();
  return wrap;
}

// --- new two-person conversation ---------------------------------------------------

export function contactsScreen() {
  const body = h('div', { class: 'scroll' });
  const list = h('div', { class: 'col', style: { gap: '8px' } });
  const err = errorBox();
  const search = h('input', { class: 'field', type: 'search', placeholder: tr('Chercher quelqu’un…'), 'aria-label': tr('Chercher quelqu’un') });
  let contacts = null;
  const render = () => {
    if (!contacts) return clear(list, h('p', { class: 'muted' }, tr('Chargement…')));
    if (!contacts.length) return clear(list, h('p', { class: 'muted' }, tr('Personne pour l’instant : invite quelqu’un dans un groupe, puis tu pourras lui écrire ici.')));
    const q = search.value.trim().toLowerCase();
    clear(
      list,
      contacts
        .filter((u) => !q || u.name.toLowerCase().includes(q))
        .map((u) =>
          h(
            'button',
            {
              type: 'button',
              class: 'contact',
              onclick: async () => {
                try {
                  const g = await api.direct(u.id);
                  go(`/chat/${g.id}`, { replace: true });
                } catch (e) {
                  err.show(e.message);
                }
              },
            },
            avatar(u, 44, { online: u.online, zoom: true }),
            h('div', { class: 'col grow', style: { gap: 0, minWidth: 0 } }, h('span', { class: 'title', style: { fontSize: '18px' } }, u.name), u.bio && h('span', { class: 'small muted ellipsis' }, u.bio)),
          ),
        ),
    );
  };
  search.addEventListener('input', render);
  const wrap = h('div', { class: 'search' }, icon('search', 20), search);
  clear(body, topBar(tr('Nouvelle discussion'), () => back(), { subtitle: tr('Avec une personne de tes groupes') }), wrap, err, list);
  api
    .contacts()
    .then((c) => ((contacts = c), render()))
    .catch((e) => err.show(e.message));
  render();
  search.setAttribute('autofocus', '');
  return { el: screen(body) };
}

// --- share to Papote (from another app's "Partager") ------------------------------------

/** What another app shared: the service worker keeps it until a conversation is chosen. */
async function takeShared() {
  try {
    const cache = await caches.open('papote-share');
    const meta = await (await cache.match('meta'))?.json();
    const res = await cache.match('file');
    const file = res ? new File([await res.blob()], decodeURIComponent(res.headers.get('X-Name') || 'photo'), { type: res.headers.get('Content-Type') || '' }) : null;
    await caches.delete('papote-share');
    // Apps often repeat the title or the link inside the text: keep each piece once.
    const parts = [meta?.title, meta?.text, meta?.url].map((v) => v?.trim()).filter(Boolean);
    const text = parts.filter((p, i) => !parts.some((o, j) => j !== i && o.includes(p) && (o.length > p.length || j < i))).join('\n');
    return { text, file: file?.type.startsWith('image/') ? file : null };
  } catch {
    return { text: '', file: null };
  }
}

export function shareScreen() {
  const body = h('div', { class: 'scroll' });
  const what = h('div');
  const list = h('div', { class: 'col', style: { gap: '8px' } });
  const err = errorBox();
  const search = h('input', { class: 'field', type: 'search', placeholder: tr('Chercher un groupe ou quelqu’un…'), 'aria-label': tr('Chercher un groupe ou quelqu’un') });
  let groups = null;
  let shared = null;
  let thumb = null;

  const send = (g) => {
    if (shared.file) {
      // Through "Décorer la photo", like a photo picked in the conversation.
      pendingPhoto.file = shared.file;
      go(`/chat/${g.id}`, { replace: true });
      go(`/photo/${g.id}`);
    } else {
      pendingShare.text = shared.text;
      go(`/chat/${g.id}`, { replace: true });
    }
  };

  const render = () => {
    if (!shared || !groups) return clear(list, h('p', { class: 'muted' }, tr('Chargement…')));
    if (!shared.text && !shared.file) return clear(list, h('p', { class: 'muted' }, tr('Rien à partager : choisis « Partager » puis « Papote » depuis une autre appli.')));
    const q = search.value.trim().toLowerCase();
    clear(
      list,
      groups
        .filter((g) => !q || g.name.toLowerCase().includes(q))
        .map((g) =>
          h(
            'button',
            { type: 'button', class: 'contact', style: { background: surfaceOf(tint(g.color)) }, onclick: () => send(g) },
            groupAvatar(g, 44),
            h('div', { class: 'col grow', style: { gap: 0, minWidth: 0 } }, h('span', { class: 'title ellipsis', style: { fontSize: '18px' } }, g.name), h('span', { class: 'small muted' }, g.direct ? tr('Discussion à deux') : `${g.memberCount} membre${g.memberCount > 1 ? 's' : ''}`)),
            icon('send', 20),
          ),
        ),
    );
  };

  search.addEventListener('input', render);
  clear(body, topBar(tr('Partager dans Papote'), () => back(), { subtitle: tr('Choisis un groupe ou une personne') }), what, h('div', { class: 'search' }, icon('search', 20), search), err, list);
  takeShared().then((s) => {
    shared = s;
    if (s.file) thumb = URL.createObjectURL(s.file);
    clear(
      what,
      (s.text || s.file) &&
        h(
          'div',
          { class: 'notice', style: { marginBottom: '12px' } },
          thumb ? h('img', { src: thumb, alt: tr('Image partagée'), style: { width: '56px', height: '56px', objectFit: 'cover', borderRadius: '12px' } }) : icon('share', 22),
          h('span', { class: 'clamp' }, s.text || tr('Une image')),
        ),
    );
    render();
  });
  api
    .groups()
    .then((g) => ((groups = g), render()))
    .catch((e) => err.show(e.message));
  render();
  return { el: screen(body), destroy: () => thumb && URL.revokeObjectURL(thumb) };
}

// --- new group / invite -----------------------------------------------------------

const EXPIRIES = [['1h', '1 h'], ['24h', '24 h'], ['7d', '7 jours'], ['never', tr('Jamais')]];

function expiryText(inv) {
  const uses = inv.maxUses ? `${inv.uses}/${inv.maxUses} utilisation` : inv.uses ? `${inv.uses} utilisation${inv.uses > 1 ? 's' : ''}` : tr('illimité');
  if (!inv.expiresAt) return tr`sans date limite · ${uses}`;
  const mins = Math.round((inv.expiresAt - Date.now()) / 60_000);
  const exp = mins < 60 ? tr`expire dans ${mins} min` : mins < 48 * 60 ? tr`expire dans ${Math.round(mins / 60)} h` : tr`expire dans ${Math.round(mins / 1440)} jours`;
  return `${exp} · ${uses}`;
}

export function shareText(groupName, code) {
  const raw = code.replace('-', '');
  return tr`Rejoins « ${groupName} » sur Papote !\nServeur : ${location.origin}\nCode : ${code}\n\nSur ordinateur ou iPhone : ${location.origin}/web/#/join?code=${raw}\nSur Android : papote://join?server=${encodeURIComponent(location.origin)}&code=${raw}`;
}

/** Icon grid plus "own picture", used when creating a group and in its settings. */
function groupLookPicker({ iconKey, onIcon, hasImage, onImage, onClearImage }) {
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (f) onImage(f);
  });
  return h(
    'div',
    { class: 'col', style: { gap: '10px' } },
    h('span', { class: 'label' }, hasImage ? 'Image' : tr('Icône ou image')),
    h(
      'div',
      { class: 'row', style: { flexWrap: 'wrap' } },
      button(hasImage ? tr('Changer l’image') : tr('Choisir une image'), () => file.click(), { iconName: 'image', small: true }),
      hasImage && button(tr('Revenir à l’icône'), onClearImage, { small: true }),
      file,
    ),
    !hasImage &&
      h(
        'div',
        { class: 'icon-grid', role: 'radiogroup', 'aria-label': tr('Icône du groupe') },
        GROUP_ICONS.map((k) =>
          h('button', { type: 'button', class: 'icon-choice', 'aria-pressed': String(k === iconKey), 'aria-label': tr`Icône ${k}`, title: k, onclick: () => onIcon(k) }, icon(k, 22)),
        ),
      ),
  );
}

export function inviteScreen(groupId) {
  const creating = groupId == null;
  let image = null; // { blob, url } picked for a new group
  let group = null;
  let name = '';
  let color = 'rose';
  let iconKey = 'heart';
  let expiry = '24h';
  let single = false;
  let invite = null;
  let active = [];
  let busy = false;
  const err = errorBox();
  const body = h('div', { class: 'scroll' });

  async function generate() {
    busy = true;
    render();
    err.show(null);
    try {
      if (!group) {
        group = await api.createGroup(name.trim(), color, iconKey);
        // The picture goes up right after the group exists (it needs the group's id).
        if (image) group = await api.setGroupPhoto(group.id, image.blob);
      }
      invite = await api.createInvite(group.id, expiry, single);
      active = [invite, ...active];
    } catch (e) {
      err.show(e.message);
    }
    busy = false;
    render();
  }

  async function share(inv) {
    const text = shareText(group?.name ?? name, inv.code);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Papote', text });
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    }
    await navigator.clipboard?.writeText(text);
    err.show(null);
  }

  const nameInput = h('input', { class: 'field', id: 'gname', placeholder: tr('Soirée jeux'), maxlength: 40, style: { background: 'var(--card)' } });
  nameInput.addEventListener('input', () => {
    name = nameInput.value;
    footer();
  });
  const footerEl = h('div', { style: { display: 'contents' } });
  function footer() {
    clear(
      footerEl,
      !group
        ? primaryButton(busy ? tr('Création…') : tr('Créer le groupe'), generate, { disabled: !name.trim() || busy })
        : creating
          ? primaryButton(tr('Aller au groupe'), () => go(`/chat/${group.id}`, { replace: true }), { iconName: 'forward' })
          : !invite
            ? primaryButton(busy ? tr('Un instant…') : tr('Générer un code'), generate, { disabled: busy })
            : primaryButton(tr('C’est bon'), () => back(`/chat/${group.id}`)),
    );
  }

  function render() {
    const t = tint(color);
    const others = active.filter((a) => a.code !== invite?.code);
    clear(
      body,
      topBar(creating ? tr('Nouveau groupe') : tr('Inviter'), () => back(), { subtitle: !creating ? group?.name : null }),
      creating &&
        h(
          'div',
          { class: 'row', style: { background: surfaceOf(t), borderRadius: '24px', padding: '14px', gap: '14px' } },
          groupBadge({ color, icon: iconKey, photo: group?.photo ?? image?.url }, 56),
          h('div', { class: 'col grow' }, h('label', { class: 'label', for: 'gname' }, tr('Nom du groupe')), group ? h('span', { class: 'title', style: { fontSize: '18px' } }, group.name) : nameInput),
        ),
      creating && !group && h('div', { class: 'col', style: { gap: '8px' } }, h('span', { class: 'label' }, tr('Couleur')), swatches(color, (c) => ((color = c), render()))),
      creating &&
        !group &&
        groupLookPicker({
          iconKey,
          onIcon: (k) => ((iconKey = k), render()),
          hasImage: !!image,
          onImage: async (f) => {
            try {
              const { blob } = await resizeImage(f, 1000);
              if (image) URL.revokeObjectURL(image.url);
              image = { blob, url: URL.createObjectURL(blob) };
            } catch {
              err.show(tr('Cette image n’a pas pu être lue'));
            }
            render();
          },
          onClearImage: () => {
            if (image) URL.revokeObjectURL(image.url);
            image = null;
            render();
          },
        }),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Code d’invitation')), h('span', { class: 'small muted', style: { fontWeight: 800 } }, tr('Généré par ton serveur'))),
        invite && [
          h('div', { class: 'code-display' }, h('div', { class: 'code' }, invite.code), h('div', { class: 'small muted' }, expiryText(invite))),
          qrBlock(inviteLink(invite.code), tr('Fais scanner ce QR code avec l’appareil photo : il ouvre l’invitation directement.')),
          h(
            'div',
            { class: 'row' },
            copyButton(invite.code),
            button(tr('Partager'), () => share(invite), { iconName: 'share', wide: true }),
          ),
        ],
        h('div', { class: 'col', style: { gap: '8px' } }, h('span', { class: 'label' }, tr('Le code expire')), segmented(EXPIRIES, expiry, (v) => (expiry = v), tr('Durée de validité du code'))),
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'col grow', style: { gap: 0 } }, h('span', { class: 'label' }, tr('Usage unique')), h('span', { class: 'small muted' }, tr('Le code ne marche qu’une fois'))),
          toggle(single, (v) => (single = v), tr('Usage unique')),
        ),
        group && button(invite ? tr('Générer un autre code') : tr('Générer un code'), generate, { iconName: 'plus', disabled: busy }),
      ),
      !creating &&
        others.length > 0 &&
        h(
          'div',
          { class: 'card' },
          h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Codes encore valables')),
          others.map((a) =>
            h(
              'div',
              { class: 'row' },
              h('div', { class: 'col grow', style: { gap: 0 } }, h('span', { class: 'title', style: { fontSize: '18px', letterSpacing: '1px' } }, a.code), h('span', { class: 'small muted' }, expiryText(a))),
              iconButton('qr', tr`QR code de ${a.code}`, () => sheet(() => [h('h2', { class: 'title', style: { fontSize: '20px', textAlign: 'center' } }, a.code), h('img', { class: 'qr big', src: api.qrUrl(inviteLink(a.code)), alt: tr`QR code de l’invitation ${a.code}` })])),
              button(tr('Révoquer'), async () => {
                try {
                  await api.revokeInvite(a.code);
                  active = active.filter((x) => x !== a);
                  render();
                } catch (e) {
                  err.show(e.message);
                }
              }, { danger: true, small: true }),
            ),
          ),
        ),
      err,
      h('div', { class: 'grow' }),
      footerEl,
    );
    footer();
  }

  if (!creating) {
    Promise.all([api.group(groupId), api.invites(groupId)])
      .then(([g, inv]) => {
        group = g;
        active = inv;
        render();
      })
      .catch((e) => err.show(e.message));
  }
  render();
  if (creating) nameInput.setAttribute('autofocus', '');
  return { el: screen(body) };
}

const inviteLink = (code, link = false) => `${location.origin}/web/#/join?${link ? 'link=1&' : ''}code=${code.replace('-', '')}`;

/** The QR code is drawn by the server (no outside service). Tap it to make it bigger. */
function qrBlock(data, hint) {
  const img = h('img', { class: 'qr', src: api.qrUrl(data), alt: tr('QR code'), width: 168, height: 168 });
  return h(
    'button',
    { type: 'button', class: 'qr-wrap', 'aria-label': tr('Afficher le QR code en grand'), onclick: () => sheet(() => [h('img', { class: 'qr big', src: api.qrUrl(data), alt: tr('QR code') }), h('p', { class: 'small muted', style: { textAlign: 'center', margin: 0 } }, hint)]) },
    img,
    h('span', { class: 'small muted' }, hint),
  );
}

function copyButton(text) {
  const b = button(tr('Copier'), async () => {
    try {
      await navigator.clipboard.writeText(text);
      clear(b, icon('check', 20), tr('Copié !'));
    } catch {
      clear(b, tr('Copie impossible'));
    }
  }, { iconName: 'copy', wide: true });
  return b;
}

// --- members & group settings ---------------------------------------------------------

/** "Ajouter quelqu'un": a contact in one tap, or anyone by their username (they get an invitation). */
function addPeopleSheet(groupId, members, onDone) {
  sheet((close) => {
    const list = h('div', { class: 'col', style: { gap: '6px' } }, h('p', { class: 'small muted', style: { margin: 0 } }, tr('Chargement…')));
    const note = h('p', { class: 'small', style: { margin: 0, fontWeight: 800, color: 'var(--ok)' }, role: 'status' });
    const err = errorBox();
    const input = h('input', { class: 'field grow', placeholder: tr('Identifiant, par exemple lou'), autocapitalize: 'none', spellcheck: 'false', 'aria-label': tr('Identifiant de la personne') });
    const inGroup = new Set(members.map((m) => m.id));
    const add = async (who, label) => {
      err.show(null);
      note.textContent = '';
      try {
        const res = await api.addToGroup(groupId, who);
        note.textContent = res.invited
          ? tr`Invitation envoyée à ${label} : elle la verra dans ses groupes.`
          : res.pending
            ? tr`${label} attend la validation d’un·e admin.`
            : tr`${label} a été ajouté·e au groupe.`;
        if (who.userId) inGroup.add(who.userId);
        paint();
        onDone();
      } catch (e) {
        err.show(e.message);
      }
    };
    let contacts = [];
    const paint = () => {
      const left = contacts.filter((u) => !inGroup.has(u.id));
      clear(
        list,
        left.length === 0
          ? h('p', { class: 'small muted', style: { margin: 0 } }, tr('Tous tes contacts sont déjà dans ce groupe.'))
          : left.map((u) =>
              h(
                'button',
                { type: 'button', class: 'contact', onclick: () => add({ userId: u.id }, u.name) },
                avatar(u, 40, { initial: true }),
                h('div', { class: 'col grow', style: { gap: 0, minWidth: 0 } }, h('b', {}, u.name), u.username && h('span', { class: 'small muted' }, `@${u.username}`)),
                icon('plus', 20),
              ),
            ),
      );
    };
    api.contacts().then((c) => ((contacts = c), paint())).catch((e) => err.show(e.message));
    const byName = () => input.value.trim() && add({ username: input.value.trim() }, input.value.trim().replace(/^@/, ''));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && byName());
    return [
      h('h2', { class: 'title', style: { fontSize: '20px' } }, tr('Ajouter quelqu’un')),
      h('span', { class: 'label' }, tr('Tes contacts')),
      list,
      h('span', { class: 'label' }, tr('Quelqu’un d’autre')),
      h('div', { class: 'row' }, input, button(tr('Ajouter'), byName, { small: true, iconName: 'plus' })),
      h('p', { class: 'small muted', style: { margin: 0 } }, tr('Avec son identifiant exact (dans ses Paramètres) : elle reçoit une invitation à accepter.')),
      note,
      err,
      button(tr('Fermer'), close, { small: true }),
    ];
  });
}

export function membersScreen(groupId) {
  let group = null;
  let members = [];
  let open = null;
  const err = errorBox();
  const body = h('div', { class: 'scroll' });

  async function load() {
    try {
      [group, members] = await Promise.all([api.group(groupId), api.members(groupId)]);
      render();
    } catch (e) {
      if (e.code === 'group_not_found') go('/groups', { replace: true });
      else err.show(e.message);
    }
  }

  const act = (fn) => async () => {
    err.show(null);
    try {
      await fn();
      await load();
    } catch (e) {
      err.show(e.message);
    }
  };

  function render() {
    const me = members.find((m) => m.id === session.me.id);
    const isOwner = me?.role === 'owner';
    const isAdmin = isOwner || me?.role === 'admin';
    const direct = !!group.direct;
    let gName = group.name;
    let gColor = group.color;
    let gIcon = group.icon;
    const saveWrap = h('div');
    const renderSave = () =>
      clear(
        saveWrap,
        (gName.trim() !== group.name || gColor !== group.color || gIcon !== group.icon) &&
          gName.trim() &&
          button(tr('Enregistrer'), act(() => api.updateGroup(groupId, { name: gName.trim(), color: gColor, icon: gIcon })), { iconName: 'check' }),
      );
    const nameField = h('input', { class: 'field', value: group.name, maxlength: 40, 'aria-label': tr('Nom du groupe') });
    nameField.addEventListener('input', () => ((gName = nameField.value), renderSave()));

    const waiting = members.filter((m) => m.status === 'pending');
    const active = members.filter((m) => m.status !== 'pending');
    const rules = group.settings ?? {};
    const muteMenu = (m) =>
      sheet((close) => [
        h('h2', { class: 'title', style: { fontSize: '20px' } }, tr`Rendre ${m.name} muet·te`),
        h('p', { class: 'small muted', style: { margin: 0 } }, tr`${m.name} pourra lire le groupe, mais pas y écrire.`),
        [['1h', 'Pendant 1 heure'], ['24h', 'Pendant 24 heures'], ['7d', 'Pendant 7 jours'], ['forever', tr('Jusqu’à nouvel ordre')]].map(([d, l]) =>
          button(l, () => (close(), act(() => api.mute(groupId, m.id, d))()), { iconName: 'mute' }),
        ),
      ]);

    clear(
      body,
      topBar(direct ? tr('Discussion') : tr('Membres'), () => back(`/settings/${groupId}`), {
        subtitle: group.name + (isOwner && !direct ? tr(' · tu l’as créé') : ''),
      }),
      !direct &&
        (rules.anyoneInvites !== false || isAdmin) &&
        h(
          'div',
          { class: 'row wrap' },
          primaryButton(tr('Ajouter quelqu’un'), () => addPeopleSheet(groupId, members, load), { iconName: 'personPlus' }),
          button(tr('Inviter avec un code'), () => go(`/invite/${groupId}`), { iconName: 'share' }),
        ),
      isAdmin &&
        waiting.length > 0 &&
        h(
          'div',
          { class: 'card pending-card' },
          h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Veulent rejoindre')),
          waiting.map((m) =>
            h(
              'div',
              { class: 'row' },
              avatar(m, 40, { initial: true }),
              h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, m.name), h('span', { class: 'small muted' }, tr('attend que tu valides'))),
              button(tr('Refuser'), act(() => api.refuse(groupId, m.id)), { small: true }),
              button(tr('Accepter'), act(() => api.approve(groupId, m.id)), { small: true, iconName: 'check' }),
            ),
          ),
        ),
      h('h2', { class: 'title', style: { fontSize: '18px' } }, direct ? tr('Avec') : tr('Membres')),
      h(
        'div',
        { class: 'card', style: { padding: '8px', gap: '0' }, role: 'list' },
        active.map((m) => {
          const self = m.id === me?.id;
          const canManage = me && !self && m.role !== 'owner' && (isOwner || (isAdmin && m.role === 'member'));
          const expanded = open === m.id;
          return h(
            'div',
            { role: 'listitem' },
            h(
              // A plain row when there's nothing to manage, so the photo still opens big when tapped.
              canManage || (isOwner && !self) ? 'button' : 'div',
              canManage || (isOwner && !self)
                ? { type: 'button', class: 'member', 'aria-expanded': String(expanded), onclick: () => ((open = expanded ? null : m.id), render()) }
                : { class: 'member' },
              avatar(m, 44, { online: m.online, zoom: true }),
              h(
                'div',
                { class: 'col grow', style: { gap: 0, minWidth: 0 } },
                h('span', { class: 'title ellipsis', style: { fontSize: '18px' } }, m.name + (self ? ' (toi)' : '')),
                h('span', { class: 'small muted ellipsis' }, [m.mutedUntil ? tr('en sourdine') : null, lastSeen(m), m.bio].filter(Boolean).join(' · ')),
              ),
              h('span', { class: `role${m.role !== 'member' ? ' admin' : ''}` }, m.role === 'owner' && icon('crown', 14), roleLabel(m.role)),
            ),
            expanded &&
              h(
                'div',
                { class: 'member-actions' },
                isOwner && button(m.role === 'admin' ? tr('Retirer admin') : tr('Nommer admin'), act(() => api.setRole(groupId, m.id, m.role === 'admin' ? 'member' : 'admin')), { small: true }),
                isOwner &&
                  button(tr('Lui confier le groupe'), async () => {
                    if (await confirmDialog(tr`Confier le groupe à ${m.name} ?`, tr`Tu deviendras admin, et ${m.name} aura le dernier mot sur le groupe.`)) act(() => api.setRole(groupId, m.id, 'owner'))();
                  }, { small: true }),
                canManage &&
                  !direct &&
                  (m.mutedUntil
                    ? button(tr('Rendre la parole'), act(() => api.unmute(groupId, m.id)), { small: true })
                    : button(tr('Rendre muet·te'), () => muteMenu(m), { small: true, iconName: 'mute' })),
                canManage &&
                  button(tr('Retirer du groupe'), async () => {
                    if (await confirmDialog(`Retirer ${m.name} ?`, tr`${m.name} ne verra plus les messages du groupe.`)) act(() => api.removeMember(groupId, m.id))();
                  }, { small: true, danger: true }),
              ),
          );
        }),
      ),
      isAdmin &&
        !direct &&
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'row' }, h('h2', { class: 'title grow', style: { fontSize: '18px' } }, tr('Règles du groupe')), h('span', { class: 'small muted' }, '(admins seulement)')),
          [
            ['anyoneInvites', tr('Tout le monde peut inviter'), rules.anyoneInvites !== false],
            ['adminsTheme', tr('Seuls les admins changent le thème'), !!rules.adminsTheme],
            ['approval', tr('Valider les nouveaux membres'), !!rules.approval],
          ].map(([k, label, on]) => h('div', { class: 'row' }, h('span', { class: 'grow' }, label), toggle(on, (v) => act(() => api.groupSettings(groupId, { [k]: v }))(), label))),
        ),
      isAdmin &&
        !direct &&
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'row' }, groupBadge(group, 48), h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Le groupe'))),
          h('div', { class: 'col' }, h('span', { class: 'label' }, tr('Nom')), nameField),
          h('div', { class: 'col', style: { gap: '8px' } }, h('span', { class: 'label' }, tr('Couleur')), swatches(gColor, (c) => ((gColor = c), renderSave()))),
          groupLookPicker({
            iconKey: gIcon,
            onIcon: (k) => {
              gIcon = k;
              renderSave();
              for (const b of body.querySelectorAll('.icon-grid .icon-choice')) b.setAttribute('aria-pressed', String(b.title === k));
            },
            hasImage: !!group.photo,
            onImage: async (f) => {
              try {
                const { blob } = await resizeImage(f, 1000);
                group = await api.setGroupPhoto(groupId, blob);
                render();
              } catch (e) {
                err.show(e instanceof ApiError ? e.message : tr('Cette image n’a pas pu être lue'));
              }
            },
            onClearImage: act(() => api.deleteGroupPhoto(groupId)),
          }),
          saveWrap,
        ),
      err,
      button(direct ? tr('Quitter la discussion') : tr('Quitter le groupe'), async () => {
        const msg = direct
          ? tr('Tu pourras en recommencer une depuis « Nouvelle discussion ».')
          : (isOwner ? tr('Le groupe sera confié à un autre membre. ') : '') + tr('Il te faudra un nouveau code pour revenir.');
        if (!(await confirmDialog(direct ? tr('Quitter la discussion ?') : tr('Quitter le groupe ?'), msg))) return;
        try {
          await api.leaveGroup(groupId);
          go('/groups', { replace: true });
        } catch (e) {
          err.show(e.message);
        }
      }, { iconName: 'exit', danger: true }),
      isOwner &&
        !direct &&
        button(tr('Supprimer le groupe pour tout le monde'), async () => {
          if (!(await confirmDialog(tr('Supprimer le groupe ?'), tr('Le groupe disparaîtra pour tout le monde. L’admin du serveur pourra encore le restaurer pendant 30 jours, puis il sera effacé avec ses messages et ses médias.'), tr('Supprimer')))) return;
          try {
            await api.deleteGroup(groupId);
            go('/groups', { replace: true });
          } catch (e) {
            err.show(e.message);
          }
        }, { iconName: 'trash', danger: true }),
    );
  }

  const offs = [
    ...['member.joined', 'member.left', 'member.updated', 'member.pending', 'group.updated', 'group.refresh'].map((t) => live.on(t, (e) => (e.groupId ?? e.group?.id) === groupId && load())),
    live.on('presence', (e) => {
      const m = members.find((x) => x.id === e.userId);
      if (m && group) {
        m.online = e.online;
        render();
      }
    }),
    live.on('group.removed', (e) => e.groupId === groupId && go('/groups', { replace: true })),
  ];
  body.append(topBar(tr('Réglages'), () => back(`/chat/${groupId}`)), err);
  load();
  return { el: screen(body), destroy: () => offs.forEach((off) => off()) };
}

// --- profile ------------------------------------------------------------------------

const MONTHS = [tr('janvier'), tr('février'), tr('mars'), tr('avril'), tr('mai'), tr('juin'), tr('juillet'), tr('août'), tr('septembre'), tr('octobre'), tr('novembre'), tr('décembre')];

const birthdayToField = (b) => {
  const m = /-(\d{2})-(\d{2})$/.exec(b ?? '');
  return m ? `${m[2]}/${m[1]}` : '';
};

function fieldToBirthday(s) {
  const t = s.trim();
  if (!t) return { ok: true, value: null };
  const m = /^(\d{1,2})\s*[/.\- ]\s*(\d{1,2})$/.exec(t);
  if (!m) return { ok: false };
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false };
  return { ok: true, value: `--${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day, month };
}

export function profileScreen() {
  let me = session.me;
  let color = me.color;
  const err = errorBox();
  const body = h('div', { class: 'scroll' });
  const name = h('input', { class: 'field', id: 'pn', maxlength: 40, value: me.name });
  const bio = h('input', { class: 'field', id: 'bio', maxlength: 140, value: me.bio ?? '', placeholder: tr('Fan de pop-corn et de dessins ratés') });
  const bday = h('input', { class: 'field', id: 'bd', maxlength: 5, inputmode: 'numeric', value: birthdayToField(me.birthday), placeholder: 'JJ/MM' });
  const bdayHint = h('span', { class: 'small muted' });
  const photoWrap = h('div', { class: 'row', style: { gap: '16px' } });
  const save = primaryButton(tr('Enregistrer'), null);

  const dirty = () =>
    name.value.trim() !== me.name || bio.value.trim() !== (me.bio ?? '') || bday.value !== birthdayToField(me.birthday) || color !== me.color;
  const refresh = () => {
    save.disabled = !dirty() || !name.value.trim();
    save.hidden = !dirty() && save.textContent !== tr('Enregistré !');
    const b = fieldToBirthday(bday.value);
    bdayHint.textContent = b.ok && b.value ? `Le ${b.day} ${MONTHS[b.month - 1]}` : '';
  };
  // Digits only, "/" added after the day: 1 4 0 3 → "14/03".
  bday.addEventListener('input', () => {
    const d = bday.value.replace(/\D/g, '').slice(0, 4);
    bday.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  });
  for (const el of [name, bio, bday]) el.addEventListener('input', refresh);

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const { blob } = await resizeImage(file, 800);
      update(await api.setPhoto(blob));
    } catch (e) {
      err.show(e instanceof ApiError ? e.message : tr('Cette image n’a pas pu être lue'));
    }
  });

  function update(u) {
    me = u;
    session.setMe(u);
    renderPhoto();
    refresh();
  }

  function renderPhoto() {
    clear(
      photoWrap,
      h('div', { class: 'profile-photo' }, avatar({ ...me, color }, 88), iconButton('photo', tr('Changer la photo de profil'), () => fileInput.click(), { cls: 'primary', size: 18 })),
      h(
        'div',
        { class: 'col grow', style: { gap: '8px' } },
        h('span', { class: 'label' }, tr('Image de profil')),
        me.photo
          ? button(tr('Revenir à la frimousse'), async () => {
              try {
                update(await api.deletePhoto());
              } catch (e) {
                err.show(e.message);
              }
            }, { small: true })
          : h('span', { class: 'small muted' }, tr('Ta frimousse prend ta couleur. Touche l’appareil photo pour mettre une photo.')),
      ),
      fileInput,
    );
  }

  save.addEventListener('click', async () => {
    const b = fieldToBirthday(bday.value);
    if (!b.ok) return err.show(tr('Anniversaire : écris le jour puis le mois, par exemple 14/03'));
    save.disabled = true;
    err.show(null);
    try {
      update(await api.updateMe({ name: name.value.trim(), bio: bio.value.trim(), birthday: b.value, color }));
      save.textContent = tr('Enregistré !');
    } catch (e) {
      err.show(e.message);
      refresh();
    }
  });

  renderPhoto();
  refresh();
  clear(
    body,
    topBar(tr('Paramètres'), () => back()),
    h(
      'div',
      { class: 'settings-grid' },
      h('div', { class: 'card' }, photoWrap),
      settingsCard(
        tr('Mon profil'),
        h('div', { class: 'col' }, h('label', { class: 'label', for: 'pn' }, tr('Mon petit nom')), name),
        h('div', { class: 'col' }, h('label', { class: 'label', for: 'bio' }, tr('Ma petite phrase')), bio),
        h('div', { class: 'col' }, h('label', { class: 'label', for: 'bd' }, tr('Anniversaire')), bday, bdayHint),
        h('div', { class: 'col', style: { gap: '8px' } }, h('span', { class: 'label' }, tr('Ma couleur')), swatches(color, (c) => ((color = c), renderPhoto(), refresh()))),
        err,
        save,
      ),
      accountCard(),
      // Accounts from before passwords keep their personal code until they choose a password.
      !session.me.hasPassword && personalCodeCard(),
      devicesCard(),
      securityCard(),
      settingsCard(
        tr('Apparence'),
        stylePicker(),
        h('span', { class: 'label' }, tr('Mode')),
        segmented([['light', tr('Clair')], ['dark', tr('Sombre')], ['auto', 'Auto']], getTheme(), setTheme, tr('Mode clair ou sombre')),
        h('span', { class: 'label' }, tr('Langue')),
        segmented(LANGS.map(([code, name, flag]) => [code, `${flag} ${name}`]), lang, (code) => code !== lang && setLang(code), tr('Langue')),
      ),
      notificationsCard(),
      settingsCard(
        tr('Serveur'),
        h('div', { class: 'row' }, h('span', { class: 'dot on' }), h('div', { class: 'col grow', style: { gap: 0 } }, h('span', { class: 'label' }, location.host), h('span', { class: 'small muted' }, tr('Papote auto-hébergé')))),
        button(tr('Se déconnecter'), async () => {
          await disablePush().catch(() => {});
          await api.logout().catch(() => {});
          window.dispatchEvent(new CustomEvent('papote:logout'));
        }, { iconName: 'logout', danger: true }),
      ),
    ),
  );
  return { el: screen(body) };
}

const PUSH_TEXT = {
  on: tr('Activées sur ce navigateur'),
  off: tr('Désactivées sur ce navigateur'),
  denied: tr('Bloquées : autorise-les pour ce site dans les réglages du navigateur (icône à gauche de l’adresse).'),
  'ios-install': tr('Sur iPhone, ajoute d’abord Papote à l’écran d’accueil (Partager → « Sur l’écran d’accueil »), puis ouvre-le depuis l’icône et active-les ici.'),
  insecure: tr('Il faut ouvrir Papote en https (par son nom de domaine) pour recevoir des notifications.'),
  unsupported: tr('Ce navigateur ne sait pas recevoir de notifications.'),
};

/** Web Push: a notification for new messages when Papote isn't open in this browser. */
function notificationsCard() {
  const card = h('section', { class: 'card' });
  const err = errorBox();
  async function render() {
    const state = await pushState();
    clear(
      card,
      h(
        'div',
        { class: 'row between' },
        h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Notifications')),
        infoButton(
          tr('Notifications'),
          tr('Quand Papote n’est pas ouvert dans ce navigateur, un nouveau message s’affiche en notification, comme une app. Le contenu est chiffré pour ton navigateur : le service de notification (Google, Mozilla, Apple ou Microsoft) le transporte sans pouvoir le lire.\n\nÀ activer sur chaque navigateur ou téléphone.'),
        ),
      ),
      h(
        'div',
        { class: 'row' },
        h('span', { style: { display: 'flex', color: state === 'on' ? 'var(--ok)' : 'var(--muted)' } }, icon('bell', 22)),
        h('span', { class: 'small muted grow' }, PUSH_TEXT[state]),
      ),
      state === 'off' &&
        button(tr('Activer les notifications'), async () => {
          try {
            if (!(await enablePush())) err.show(tr('Les notifications n’ont pas été autorisées.'));
          } catch (e) {
            err.show(e.message || tr('Activation impossible'));
          }
          render();
        }, { iconName: 'bell' }),
      state === 'on' && button(tr('Désactiver sur ce navigateur'), async () => (await disablePush(), render()), { small: true }),
      err,
    );
  }
  render();
  return card;
}

function settingsCard(title, ...children) {
  const head = Array.isArray(title) ? title : [h('h2', { class: 'title', style: { fontSize: '18px' } }, title)];
  return h('section', { class: 'card' }, h('div', { class: 'row between' }, ...head), ...children);
}

// Colours: with Pastel they set the whole palette, with another theme its accent.
const STYLES = [
  ['papote', 'Papote', '#6A47D6', '#EDE6FF'],
  ['menthe', tr('Menthe'), '#23845A', '#DDF4E9'],
  ['ocean', tr('Océan'), '#2E6FD6', '#E2EEFF'],
  ['corail', tr('Corail'), '#C23660', '#FFE0E8'],
  ['soleil', tr('Soleil'), '#A65A05', '#FFEBD6'],
  ['encre', tr('Encre'), '#3A3D52', '#E8E9EF'],
];

// Themes: whole looks, fonts and shapes included (same as the Android app). [key, name, font, ground, accent]
const LOOKS = [
  ['pastel', tr('Pastel'), "'Baloo 2'", '#F7F3FF', '#6A47D6'],
  ['nuit', tr('Nuit étoilée'), "'Space Grotesk'", '#0F1530', '#7C5CFF'],
  ['carnet', tr('Carnet'), "'Patrick Hand'", '#FBF6EA', '#2B2B2B'],
  ['neopop', tr('Néo-pop'), "'Space Grotesk'", '#FFF4D6', '#FF5A5F'],
  ['sobre', tr('Sobre'), 'system-ui', '#F4F5F7', '#2563EB'],
  ['arcade', tr('Arcade'), "'Press Start 2P'", '#101010', '#39D353'],
  ['foret', tr('Forêt'), "'Fraunces'", '#F3EFE6', '#2F5D3A'],
];

/** Thème, then Couleurs ("D’origine" keeps a theme's own colours). */
function stylePicker() {
  const wrap = h('div', { class: 'col', style: { gap: '10px' } });
  const render = () => {
    const look = getLook();
    const current = getStyle() === 'default' && look === 'pastel' ? 'papote' : getStyle();
    const colours = look === 'pastel' ? STYLES : [['default', tr('D’origine'), LOOKS.find((l) => l[0] === look)[4], 'transparent'], ...STYLES];
    clear(
      wrap,
      h('span', { class: 'label' }, tr('Thème')),
      h(
        'div',
        { class: 'style-picker', role: 'radiogroup', 'aria-label': tr('Thème') },
        LOOKS.map(([key, label, font, ground, accent]) =>
          h(
            'button',
            { type: 'button', role: 'radio', 'aria-checked': String(look === key), onclick: () => (setLook(key), render()) },
            h('span', { class: 'sw', style: { background: accent, outline: `4px solid ${ground}` } }),
            h('span', { style: { fontFamily: font, fontSize: key === 'arcade' ? '10px' : '' } }, label),
          ),
        ),
      ),
      h('span', { class: 'label' }, tr('Couleurs')),
      h(
        'div',
        { class: 'style-picker', role: 'radiogroup', 'aria-label': tr('Couleurs') },
        colours.map(([key, label, primary, soft]) =>
          h(
            'button',
            { type: 'button', role: 'radio', 'aria-checked': String(current === key), onclick: () => (setStyle(key), render()) },
            h('span', { class: 'sw', style: { background: primary } }),
            soft !== 'transparent' && h('span', { class: 'sw small', style: { background: soft } }),
            label,
          ),
        ),
      ),
    );
  };
  render();
  return wrap;
}

/** Account 2FA: asked when the personal code opens the account on a new device. */
function securityCard() {
  const card = h('section', { class: 'card' });
  const err = errorBox();
  const render = () => {
    const on = !!session.me.totp;
    clear(
      card,
      h(
        'div',
        { class: 'row between' },
        h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Sécurité')),
        infoButton(
          tr('Double authentification'),
          tr('Quand ton code personnel sert à ouvrir ton compte sur un nouvel appareil, Papote demande aussi le code à 6 chiffres de ton application d’authentification (Aegis, 2FAS, Google Authenticator…). Quelqu’un qui verrait ton code personnel ne pourrait donc pas s’en servir seul.'),
        ),
      ),
      h(
        'div',
        { class: 'row' },
        h('span', { style: { display: 'flex', color: on ? 'var(--ok)' : 'var(--muted)' } }, icon('shield', 22)),
        h('div', { class: 'col grow', style: { gap: 0 } }, h('span', { class: 'label' }, tr('Double authentification')), h('span', { class: 'small muted' }, on ? tr('Activée') : tr('Désactivée'))),
      ),
      on
        ? button(tr('Désactiver'), () => disableTotpDialog(render), { danger: true, small: true })
        : button(tr('Activer la double authentification'), () => totpSetupDialog(render), { iconName: 'shield' }),
      err,
    );
  };
  render();
  return card;
}

function modal(title, build) {
  const backdrop = h('div', { class: 'backdrop dialog-wrap' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  document.addEventListener('keydown', onKey);
  const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', { class: 'title', style: { fontSize: '20px' } }, title));
  backdrop.append(dialog);
  document.body.append(backdrop);
  build(dialog, close);
  dialog.querySelector('input, button')?.focus();
  return close;
}

function totpSetupDialog(onDone) {
  modal(tr('Double authentification'), async (dialog, close) => {
    const err = errorBox();
    const code = h('input', { class: 'field', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '123456', 'aria-label': tr('Code à 6 chiffres') });
    const confirm = button(tr('Activer'), null, { small: true });
    dialog.append(h('p', { class: 'muted', style: { margin: 0 } }, tr('Chargement…')));
    let setup;
    try {
      setup = await api.startTotp();
    } catch (e) {
      clear(dialog, err);
      err.show(e.message);
      return;
    }
    // The QR comes from our own server, built from the otpauth link only: safe to show as SVG.
    const qr = new DOMParser().parseFromString(setup.qrSvg, 'image/svg+xml').documentElement;
    qr.setAttribute('role', 'img');
    qr.setAttribute('aria-label', tr('QR code à scanner avec ton application d’authentification'));
    confirm.addEventListener('click', async () => {
      try {
        const { recoveryCodes } = await api.confirmTotp(code.value.trim());
        session.setMe({ ...session.me, totp: true });
        clear(
          dialog,
          h('h2', { class: 'title', style: { fontSize: '20px' } }, tr('Codes de secours')),
          h('p', { class: 'muted', style: { margin: 0 } }, tr('Note-les maintenant : ils ne seront plus affichés. Chacun remplace une fois le code de l’application.')),
          h('pre', { class: 'recovery' }, recoveryCodes.join('\n')),
          h(
            'div',
            { class: 'actions' },
            button(tr('Copier'), () => navigator.clipboard?.writeText(recoveryCodes.join('\n')), { small: true, iconName: 'copy' }),
            button(tr('C’est noté'), () => (close(), onDone()), { small: true }),
          ),
        );
      } catch (e) {
        err.show(e.message);
      }
    });
    clear(
      dialog,
      h('h2', { class: 'title', style: { fontSize: '20px' } }, tr('Double authentification')),
      h('p', { class: 'muted', style: { margin: 0 } }, tr('1. Scanne ce QR code avec ton application d’authentification :')),
      h('div', { class: 'qr' }, qr),
      h('p', { class: 'small muted', style: { margin: 0 } }, tr('ou saisis la clé : '), h('code', {}, setup.secret.match(/.{1,4}/g).join(' '))),
      h('p', { class: 'muted', style: { margin: 0 } }, tr('2. Entre le code à 6 chiffres qu’elle affiche :')),
      code,
      err,
      h('div', { class: 'actions' }, button(tr('Annuler'), close, { small: true }), confirm),
    );
    code.focus();
  });
}

function disableTotpDialog(onDone) {
  modal(tr('Désactiver la double authentification'), (dialog, close) => {
    const err = errorBox();
    const code = h('input', { class: 'field', autocomplete: 'one-time-code', placeholder: tr('Code ou code de secours'), 'aria-label': tr('Code de l’application ou code de secours') });
    dialog.append(
      code,
      err,
      h(
        'div',
        { class: 'actions' },
        button(tr('Annuler'), close, { small: true }),
        button(tr('Désactiver'), async () => {
          try {
            await api.disableTotp(code.value.trim());
            session.setMe({ ...session.me, totp: false });
            close();
            onDone();
          } catch (e) {
            err.show(e.message);
          }
        }, { small: true, danger: true }),
      ),
    );
  });
}

// --- my account: username and password ----------------------------------------------------

function accountCard() {
  const card = h('section', { class: 'card' });
  const render = () => {
    const me = session.me;
    const err = errorBox();
    const field = (props) => h('input', { class: 'field', spellcheck: 'false', ...props });
    const user = field({ value: me.username ?? '', placeholder: 'lou', maxlength: 25, autocomplete: 'username', autocapitalize: 'none', 'aria-label': tr('Identifiant') });
    const current = me.hasPassword && field({ type: 'password', autocomplete: 'current-password', 'aria-label': tr('Mot de passe actuel'), placeholder: tr('Mot de passe actuel') });
    const next = field({ type: 'password', autocomplete: 'new-password', 'aria-label': me.hasPassword ? tr('Nouveau mot de passe') : tr('Mot de passe'), placeholder: me.hasPassword ? tr('Nouveau mot de passe (facultatif)') : tr('Mot de passe, 8 caractères au moins') });
    const save = button(tr('Enregistrer'), async () => {
      err.show(null);
      try {
        session.setMe(await api.setAccount({ username: user.value.trim(), password: next.value || undefined, currentPassword: current ? current.value : undefined }));
        render();
        card.querySelector('.ok-note')?.removeAttribute('hidden');
      } catch (e) {
        err.show(e.message);
      }
    }, { iconName: 'check', small: true });
    clear(
      card,
      h('div', { class: 'row between' }, h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Mon compte')), me.username && h('span', { class: 'small muted' }, `@${me.username}`)),
      !me.hasPassword && h('p', { class: 'notice', style: { margin: 0 } }, icon('info', 20), tr('Choisis ton identifiant et ton mot de passe : tu t’en serviras pour te connecter sur tes autres appareils, sans code.')),
      h('div', { class: 'col' }, h('span', { class: 'label' }, tr('Identifiant')), user, h('span', { class: 'small muted' }, tr('Tes proches peuvent t’ajouter à un groupe avec cet identifiant.'))),
      h('div', { class: 'col' }, h('span', { class: 'label' }, me.hasPassword ? tr('Changer de mot de passe') : tr('Mot de passe')), current, next, me.hasPassword && h('span', { class: 'small muted' }, tr('Un nouveau mot de passe déconnecte tes autres appareils.'))),
      err,
      h('div', { class: 'row' }, save, h('span', { class: 'small ok-note', hidden: true, style: { color: 'var(--ok)', fontWeight: 800 } }, tr('Enregistré !'))),
    );
  };
  render();
  return card;
}

// --- personal code & my devices -------------------------------------------------------

function personalCodeCard() {
  const codeEl = h('div', { class: 'code' }, '…');
  const err = errorBox();
  const copy = button(tr('Copier'), async () => {
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      clear(copy, icon('check', 20), tr('Copié !'));
    } catch {
      clear(copy, tr('Copie impossible'));
    }
  }, { iconName: 'copy', small: true, wide: true });
  const regen = button(tr('Régénérer'), async () => {
    if (!(await confirmDialog(tr('Régénérer ton code ?'), tr('L’ancien code ne marchera plus. Les appareils déjà connectés le restent : déconnecte-les dans « Mes appareils » si besoin.'), tr('Régénérer')))) return;
    try {
      codeEl.textContent = (await api.regeneratePersonalCode()).code;
      showQr(codeEl.textContent);
      clear(copy, icon('copy', 20), tr('Copier'));
    } catch (e) {
      err.show(e.message);
    }
  }, { small: true, wide: true });
  const qrSlot = h('div');
  const showQr = (code) => clear(qrSlot, qrBlock(inviteLink(code, true), tr('Scanne-le depuis ton autre appareil (« J’ai déjà un compte ») pour ouvrir ton compte.')));
  api
    .personalCode()
    .then(({ code }) => ((codeEl.textContent = code), showQr(code)))
    .catch((e) => err.show(e.message));
  return settingsCard(
    [
      h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Mon code personnel')),
      infoButton(
        tr('Ton code personnel'),
        tr('Sur un autre appareil (téléphone, tablette, ordinateur), choisis « J’ai déjà un compte » puis entre l’adresse du serveur et ce code : c’est ton compte qui s’ouvre, avec tes groupes. Il sert aussi à fusionner un compte créé en double.\n\nGarde-le pour toi : il sert de mot de passe. Si quelqu’un l’a vu, régénère-le.'),
      ),
    ],
    h('div', { class: 'code-display' }, codeEl, h('div', { class: 'small muted' }, location.origin)),
    h('div', { class: 'row' }, copy, regen),
    qrSlot,
    err,
  );
}

function devicesCard() {
  const card = h('section', { class: 'card' });
  const err = errorBox();
  let devices = [];

  async function load() {
    try {
      devices = await api.devices();
      err.show(null);
    } catch (e) {
      err.show(e.message);
    }
    render();
  }

  function render() {
    clear(
      card,
      h('h2', { class: 'title', style: { fontSize: '18px' } }, tr('Mes appareils')),
      devices.map((d) =>
        h(
          'div',
          { class: 'row' },
          h('span', { class: `dot${d.current || d.online ? ' on' : ''}`, style: { width: '10px', height: '10px' } }),
          h(
            'div',
            { class: 'col grow', style: { gap: 0, minWidth: 0 } },
            h('span', { class: 'label ellipsis' }, d.label),
            h('span', { class: 'small muted' }, d.current ? tr('Cet appareil') : d.online ? tr('Connecté en ce moment') : tr`Utilisé ${shortWhen(d.lastUsedAt).toLowerCase()}`),
          ),
          !d.current &&
            button(tr('Déconnecter'), async () => {
              if (!(await confirmDialog(tr`Déconnecter « ${d.label} » ?`, tr('Il faudra ton identifiant et ton mot de passe pour revenir sur cet appareil.'), tr('Déconnecter')))) return;
              try {
                await api.revokeDevice(d.id);
              } catch (e) {
                err.show(e.message);
              }
              load();
            }, { small: true, danger: true }),
        ),
      ),
      h(
        'div',
        { class: 'row' },
        button(tr('Fusionner avec mon autre compte'), () => mergeDialog(load), { iconName: 'personPlus', wide: true }),
        infoButton(
          tr('Fusionner deux comptes'),
          tr('Tu te retrouves avec deux comptes ? Depuis le compte en trop, entre l’identifiant et le mot de passe du bon compte : groupes, messages et appareils y seront regroupés.'),
        ),
      ),
      err,
    );
  }

  load();
  return card;
}

/** "Fusionner avec mon autre compte": this account is folded into the one whose personal code is typed. */
function mergeDialog(onDone) {
  const backdrop = h('div', { class: 'backdrop dialog-wrap' });
  const err = errorBox();
  const input = h('input', { class: 'field', placeholder: tr('Identifiant de l’autre compte'), maxlength: 25, autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off', 'aria-label': tr('Identifiant de l’autre compte') });
  const password = h('input', { class: 'field', type: 'password', placeholder: tr('Son mot de passe'), autocomplete: 'off', 'aria-label': tr('Mot de passe de l’autre compte') });
  const totp = h('input', { class: 'field', placeholder: tr('Code de l’application d’authentification'), autocomplete: 'one-time-code', hidden: true, 'aria-label': tr('Code de double authentification') });
  const confirmMerge = button(tr('Fusionner'), null, { small: true, danger: true, disabled: true });
  const ready = () => input.value.trim().length >= 3 && password.value.length > 0;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  input.addEventListener('input', () => (confirmMerge.disabled = !ready()));
  password.addEventListener('input', () => (confirmMerge.disabled = !ready()));
  confirmMerge.addEventListener('click', async () => {
    confirmMerge.disabled = true;
    err.show(null);
    try {
      const { user } = await api.mergeWith(input.value.trim(), password.value, totp.value.trim() || undefined);
      session.setMe(user);
      close();
      onDone();
      go('/groups', { replace: true });
    } catch (e) {
      if (e.code === 'totp_required') totp.hidden = false;
      err.show(e.message);
      confirmMerge.disabled = false;
    }
  });
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  document.addEventListener('keydown', onKey);
  backdrop.append(
    h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Fusionner avec mon autre compte') },
      h('h2', { class: 'title', style: { fontSize: '20px' } }, tr('Fusionner avec mon autre compte')),
      h(
        'p',
        { class: 'muted', style: { margin: 0 } },
        tr('Entre l’identifiant et le mot de passe de ton autre compte. Ce compte-ci y sera fondu : groupes, messages, réactions et appareils. Tu garderas le nom et la photo de l’autre compte.'),
      ),
      input,
      password,
      totp,
      h('p', { class: 'small', style: { margin: 0, fontWeight: 800, color: 'var(--danger)' } }, tr('C’est définitif.')),
      err,
      h('div', { class: 'actions' }, button(tr('Annuler'), close, { small: true }), confirmMerge),
    ),
  );
  document.body.append(backdrop);
  input.focus();
}
