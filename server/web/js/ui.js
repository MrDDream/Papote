import { tr, locale } from './i18n.js';
// Tiny DOM helpers, icons and shared widgets. All user content goes through text nodes, never innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// --- icons (the mockups' 24×24 round strokes) -------------------------------

const PATHS = {
  back: 'M15 5l-7 7 7 7',
  forward: 'M5 12h14M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  checks: 'M2 12.5l4.5 4.5 9-10M11.5 16l1 1 9-10',
  reply: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v4',
  video: 'M3 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM16 10l6-3v10l-6-3',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  send: 'M4 12l16-8-6 16-3-7z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  pencil: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  photo: 'M4 7h3l2-2h6l2 2h3v12H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  text: 'M4 6h16M4 12h10M4 18h7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  personPlus: 'M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M18 8v6M15 11h6',
  settings:
    'M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  chatPlus: 'M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM12 8.5v7M8.5 12h7',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4',
  game: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 1.8L9 15h6l1.6 1.8A3 3 0 0 0 22 15l-.7-6.4A4 4 0 0 0 17.3 5z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  coffee: 'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v3M10 2v3M14 2v3',
  plane: 'M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  paw: 'M11 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM17 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM21 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM12 11c-3 0-6 4.5-6 7.5A2.5 2.5 0 0 0 8.5 21c1.4 0 2.2-.8 3.5-.8s2.1.8 3.5.8a2.5 2.5 0 0 0 2.5-2.5c0-3-3-7.5-6-7.5z',
  briefcase: 'M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M3 13h18',
  ball: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9M12 3c-2.5 2.5-3.8 5.5-3.8 9s1.3 6.5 3.8 9M3.5 9h17M3.5 15h17',
  palette: 'M12 3a9 9 0 0 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8zM7.5 11.5h.01M10.5 7.5h.01M15 7.5h.01M17.5 11h.01',
  car: 'M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M3 17v-5l2-5h14l2 5v5M3 12h18',
  school: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6',
  camera: 'M4 7h3l2-2h6l2 2h3v12H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5',
  keypad: 'M6 7h12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3zM8 12h.01M12 12h.01M16 12h.01',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  crown: 'M4 18h16M4 18L3 7l5 4 4-6 4 6 5-4-1 11',
  exit: 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 16l4-4-4-4M18 12H9',
  pin: 'M9 4h6l-1 6 4 4H6l4-4zM12 14v7',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  poll: 'M5 20V10M12 20V4M19 20v-7',
  location: 'M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  gif: 'M4 6h16v12H4zM9 10H7v4h2v-1.5M12 10v4M15 14v-4h2M15 12h1.5',
  sticker: 'M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.3 6.8 19.1l1-5.8L3.5 9.2l5.9-.8z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2M16 16h2v2',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  cake: 'M4 21h16M5 21v-8h14v8M5 16c2 1.5 4 1.5 7 0s5-1.5 7 0M12 13V9M12 6a1.5 1.5 0 0 1 0-3c0 1 1.5 1.5 0 3z',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  speed: 'M12 20a8 8 0 1 1 8-8M12 12l4-4M20 12h-2',
  text2: 'M5 6h14M12 6v13M9 19h6',
  crop: 'M6 2v16h16M2 6h16v16',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  timer: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  mute: 'M11 5L6 9H3v6h3l5 4zM16 9l5 5M21 9l-5 5',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  smile: 'M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0M8.5 14q3.5 3.5 7 0M9 9.5h.01M15 9.5h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  marker: 'M9 15l-5 5M14 4l6 6-9 9-6-6zM12 6l6 6',
  eraser: 'M8 20h12M5 15l8-8 6 6-5 5H9z',
  bucket: 'M5 11l7-7 7 7-7 7zM19 15c1 1.5 2 2.6 2 3.5a2 2 0 0 1-4 0c0-.9 1-2 2-3.5z',
  star: 'M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.3 6.8 19.1l1-5.8L3.5 9.2l5.9-.8z',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  house: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  leaf: 'M5 19c0-8 6-14 15-14 0 9-6 15-14 15M5 19l7-7',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 9h.01M15 15h.01M15 9h.01M9 15h.01',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  laugh: 'M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0M8 13q4 5 8 0zM9 9h.01M15 9h.01',
  popcorn: 'M7 10h10l-2 10H9zM8 10a2.5 2.5 0 0 1 4-3 2.5 2.5 0 0 1 4 3',
  thumb: 'M7 11v9H4v-9zM7 11l4-7c2 0 3 1 2.5 3L13 10h5a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 17 20H7',
};
const FILLED = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z',
  pause: 'M7.5 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM13.5 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
};

export function icon(name, size = 22, width = 2.2) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  if (FILLED[name]) {
    path.setAttribute('d', FILLED[name]);
    path.setAttribute('fill', 'currentColor');
  } else {
    path.setAttribute('d', PATHS[name] ?? PATHS.heart);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', width);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(path);
  return svg;
}

// Same keys as the server's GROUP_ICONS.
export const GROUP_ICONS = [
  'heart', 'house', 'leaf', 'dice', 'star', 'music', 'game', 'book', 'sun', 'moon',
  'coffee', 'plane', 'gift', 'paw', 'briefcase', 'ball', 'palette', 'car', 'school', 'camera',
];

export const REACTIONS = [
  { key: 'heart', label: tr('Cœur'), icon: 'heart', bg: '#FFE0E8', fg: '#B0305A' },
  { key: 'star', label: tr('Étoile'), icon: 'star', bg: '#FFF0B8', fg: '#7A5F00' },
  { key: 'laugh', label: tr('Rire'), icon: 'laugh', bg: '#FFE3C7', fg: '#9A4F0C' },
  { key: 'popcorn', label: 'Pop-corn', icon: 'popcorn', bg: '#FFF8E6', fg: '#8A5A00' },
  { key: 'thumb', label: tr('Pouce'), icon: 'thumb', bg: '#D6E8FF', fg: '#2E5FA8' },
];
export const reactionOf = (key) => REACTIONS.find((r) => r.key === key);

// --- tints --------------------------------------------------------------------

export const TINTS = [
  { key: 'rose', label: tr('Rose'), bg: '#FFE0E8', tint: '#FFC2D1', text: '#B0305A' },
  { key: 'peche', label: tr('Pêche'), bg: '#FFEBD6', tint: '#FFD3A8', text: '#9A4F0C' },
  { key: 'menthe', label: tr('Menthe'), bg: '#DDF4E9', tint: '#B5E6CF', text: '#2C7A57' },
  { key: 'ciel', label: tr('Ciel'), bg: '#E2EEFF', tint: '#C2DAFF', text: '#2E5FA8' },
  { key: 'citron', label: tr('Citron'), bg: '#FFF6D6', tint: '#FFE89A', text: '#7A5F00' },
  { key: 'lilas', label: tr('Lilas'), bg: '#EDE6FF', tint: '#D7C9FF', text: '#5B3CC4' },
];
export const tint = (key) => TINTS.find((t) => t.key === key) ?? TINTS[0];

export function isDark() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Big pastel surface (group card, chat header), toned down in dark mode. */
export function surfaceOf(t) {
  return isDark() ? `color-mix(in srgb, ${t.tint} 22%, var(--card))` : t.bg;
}
export const nameColor = (t) => (isDark() ? t.tint : t.text);

// --- shared widgets -------------------------------------------------------------

// --- Bubu, the mascot: one face per mood of the group (mockup "Mascotte réactive") ---

const BUBU_FACES = {
  sleepy: [
    ['path', { d: 'M36 42q6 4 12 0M64 42q6 4 12 0', stroke: '#2E2442', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
    ['path', { d: 'M52 56q4 2 8 0', stroke: '#2E2442', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
    ['text', { x: 88, y: 14, 'font-family': 'Baloo 2, sans-serif', 'font-weight': 800, 'font-size': 14, fill: '#6A47D6' }, 'z'],
    ['text', { x: 98, y: 6, 'font-family': 'Baloo 2, sans-serif', 'font-weight': 800, 'font-size': 10, fill: '#6A47D6' }, 'z'],
  ],
  happy: [
    ['circle', { cx: 42, cy: 40, r: 5.5, fill: '#2E2442' }],
    ['circle', { cx: 70, cy: 40, r: 5.5, fill: '#2E2442' }],
    ['circle', { cx: 44, cy: 38, r: 1.8, fill: '#fff' }],
    ['circle', { cx: 72, cy: 38, r: 1.8, fill: '#fff' }],
    ['path', { d: 'M49 52 q7 7 14 0', stroke: '#2E2442', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
  ],
  excited: [
    ['path', { d: 'M36 36l12 6-12 6M76 36l-12 6 12 6', stroke: '#2E2442', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
    ['path', { d: 'M46 52h20q0 12-10 12t-10-12z', fill: '#2E2442' }],
    ['path', { d: 'M4 10l6 4M108 14l-6 3M2 30h6', stroke: '#FF9F43', 'stroke-width': 3, 'stroke-linecap': 'round' }],
  ],
  party: [
    ['path', { d: 'M36 42q6-6 12 0M64 42q6-6 12 0', stroke: '#2E2442', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
    ['path', { d: 'M48 52q8 10 16 0', stroke: '#2E2442', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
    ['path', { d: 'M44 10l12-20 12 20z', fill: '#FFD66B', stroke: '#2E2442', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }],
    ['circle', { cx: 56, cy: -10, r: 3, fill: '#FF7A93' }],
  ],
  surprised: [
    ['circle', { cx: 42, cy: 40, r: 5.5, fill: '#2E2442' }],
    ['circle', { cx: 70, cy: 40, r: 5.5, fill: '#2E2442' }],
    ['circle', { cx: 44, cy: 38, r: 1.8, fill: '#fff' }],
    ['circle', { cx: 72, cy: 38, r: 1.8, fill: '#fff' }],
    ['circle', { cx: 56, cy: 56, r: 5, fill: 'none', stroke: '#2E2442', 'stroke-width': 3 }],
    ['path', { d: 'M92 4c0 4 4 4 4 8', stroke: '#4A9BEF', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
  ],
};

export const BUBU_LINES = {
  sleepy: tr('Chut… je fais la sieste'),
  happy: tr('Coucou tout le monde !'),
  excited: tr('Ouh, on dessine ensemble !'),
  party: tr('Joyeux anniv !'),
  surprised: tr('Waouh, ça bavarde !'),
};

function svgParts(svg, parts) {
  for (const [tag, attrs, text] of parts) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    svg.append(el);
  }
  return svg;
}

export function bubu(state = 'happy', width = 44) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', Math.round((width * 122) / 112));
  svg.setAttribute('viewBox', '0 -18 112 122');
  svg.setAttribute('class', `bubu bubu-${state}`);
  svg.setAttribute('aria-hidden', 'true');
  return svgParts(svg, [
    ['path', { d: 'M20 8 H92 a16 16 0 0 1 16 16 V64 a16 16 0 0 1 -16 16 H50 L30 98 L33 80 H20 a16 16 0 0 1 -16 -16 V24 a16 16 0 0 1 16 -16 Z', fill: '#FFC2D1', stroke: '#2E2442', 'stroke-width': 3, 'stroke-linejoin': 'round' }],
    ['ellipse', { cx: 30, cy: 54, rx: 6, ry: 4, fill: '#FF8FAB' }],
    ['ellipse', { cx: 82, cy: 54, rx: 6, ry: 4, fill: '#FF8FAB' }],
    ...(BUBU_FACES[state] ?? BUBU_FACES.happy),
  ]);
}

/** Confetti over the whole page (birthdays, a won game). */
export function confetti(count = 90) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#FF7A93', '#8B6CF0', '#4CC38A', '#4A9BEF', '#FF9F43', '#FFD66B'];
  const layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    layer.append(
      h('span', {
        style: {
          left: `${Math.random() * 100}%`,
          background: colors[i % colors.length],
          animationDelay: `${Math.random() * 0.6}s`,
          animationDuration: `${1.8 + Math.random() * 1.6}s`,
          transform: `rotate(${Math.random() * 360}deg)`,
          borderRadius: i % 3 === 0 ? '50%' : '2px',
        },
      }),
    );
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 4000);
}

// --- built-in stickers (mockup "GIF et stickers"), same keys on Android ---

export const STICKERS = [
  { key: 'check', label: tr('Validé'), d: 'M8 20l8 8 16-16', fill: 'none', color: '#4CC38A' },
  { key: 'star', label: tr('Étoile'), d: 'M20 6l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z', fill: '#FFD66B' },
  { key: 'heart', label: tr('Cœur'), d: 'M20 33s-12-7-12-16a6 6 0 0 1 12-3 6 6 0 0 1 12 3c0 9-12 16-12 16z', fill: '#FF7A93' },
  { key: 'smile', label: tr('Sourire'), d: 'M10 26q10 10 20 0M14 15h.01M26 15h.01', fill: 'none', color: '#2E2442', circle: '#FFE58A' },
  { key: 'wave', label: tr('Vague'), d: 'M6 24c6-10 10 10 16 0s10 10 14 0', fill: 'none', color: '#4A9BEF' },
  { key: 'plus', label: tr('Plus'), d: 'M20 6v28M6 20h28', fill: 'none', color: '#8B6CF0' },
  { key: 'tent', label: tr('Tente'), d: 'M10 30l10-22 10 22M14 22h12', fill: 'none', color: '#2C7A57' },
  { key: 'bag', label: tr('Valise'), d: 'M8 12h24v18H8zM14 12V8h12v4', fill: '#FFD3A8' },
  { key: 'rainbow', label: 'Arc-en-ciel', d: 'M12 28a8 8 0 1 1 16 0', fill: 'none', color: '#FF7A93', rainbow: true },
];

export function stickerSvg(key, size = 96) {
  const st = STICKERS.find((x) => x.key === key) ?? STICKERS[1];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Sticker ${st.label}`);
  const parts = [];
  if (st.circle) parts.push(['circle', { cx: 20, cy: 20, r: 15, fill: st.circle, stroke: '#2E2442', 'stroke-width': 2.5 }]);
  if (st.rainbow) {
    [['#FF7A93', 14], ['#FFD66B', 11], ['#4CC38A', 8]].forEach(([c, r]) =>
      parts.push(['path', { d: `M${20 - r} 30a${r} ${r} 0 1 1 ${2 * r} 0`, fill: 'none', stroke: c, 'stroke-width': 3.2, 'stroke-linecap': 'round' }]),
    );
  } else {
    parts.push(['path', { d: st.d, fill: st.fill, stroke: st.color ?? '#2E2442', 'stroke-width': st.fill === 'none' ? 3.4 : 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]);
  }
  return svgParts(svg, parts);
}

// --- moods (Réglages du groupe → "Mon humeur", shown on the avatar) ---

export const MOODS = [
  { key: 'dispo', label: tr('Dispo'), d: 'M8 14q4 4 8 0M9 9h.01M15 9h.01' },
  { key: 'fatigue', label: tr('Fatigué·e'), d: 'M4 14a8 8 0 1 0 8-8 6 6 0 0 1-8 8z' },
  { key: 'jeu', label: tr('En jeu'), d: 'M6 9h12a4 4 0 0 1 0 8l-3-2H9l-3 2a4 4 0 0 1 0-8zM8 12v2M7 13h2M16 12h.01' },
  { key: 'cine', label: tr('Au ciné'), d: 'M4 6h16v12H4zM4 10h16M8 6l2 4M14 6l2 4' },
  { key: 'dnd', label: tr('Ne pas déranger'), d: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM7 12h10' },
];
export const moodOf = (key) => MOODS.find((m) => m.key === key);

export function moodIcon(key, size = 14) {
  const m = moodOf(key);
  if (!m) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  return svgParts(svg, [['path', { d: m.d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]]);
}

export function mascot(width = 112) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', Math.round((width * 104) / 112));
  svg.setAttribute('viewBox', '0 0 112 104');
  svg.setAttribute('aria-hidden', 'true');
  const parts = [
    ['path', { d: 'M20 8 H92 a16 16 0 0 1 16 16 V64 a16 16 0 0 1 -16 16 H50 L30 98 L33 80 H20 a16 16 0 0 1 -16 -16 V24 a16 16 0 0 1 16 -16 Z', fill: '#FFC2D1', stroke: '#2E2442', 'stroke-width': 3, 'stroke-linejoin': 'round' }],
    ['circle', { cx: 42, cy: 40, r: 5.5, fill: '#2E2442' }],
    ['circle', { cx: 70, cy: 40, r: 5.5, fill: '#2E2442' }],
    ['circle', { cx: 44, cy: 38, r: 1.8, fill: '#fff' }],
    ['circle', { cx: 72, cy: 38, r: 1.8, fill: '#fff' }],
    ['path', { d: 'M49 52 q7 7 14 0', stroke: '#2E2442', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
    ['ellipse', { cx: 30, cy: 54, rx: 6, ry: 4, fill: '#FF8FAB' }],
    ['ellipse', { cx: 82, cy: 54, rx: 6, ry: 4, fill: '#FF8FAB' }],
  ];
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

function faceSvg(size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size * 0.62);
  svg.setAttribute('height', size * 0.62);
  svg.setAttribute('viewBox', '0 0 30 30');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of [
    ['circle', { cx: 10.5, cy: 13, r: 2.4, fill: '#2E2442' }],
    ['circle', { cx: 19.5, cy: 13, r: 2.4, fill: '#2E2442' }],
    ['path', { d: 'M11 19 q4 4 8 0', stroke: '#2E2442', 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round' }],
  ]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** Profile photo, else a face (or the initial) on the user's pastel. */
export function avatar(user, size = 40, { initial = false, online = false, zoom = false } = {}) {
  const t = tint(user?.color);
  const el = h('div', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, background: t.tint, fontSize: `${Math.round(size * 0.44)}px` }, 'aria-hidden': 'true' });
  if (user?.photo) el.append(h('img', { src: user.photo, alt: '', loading: 'lazy' }));
  else if (initial) el.append((user?.name ?? '?').slice(0, 1).toUpperCase());
  else el.append(faceSvg(size));
  if (online) el.append(h('span', { class: 'online' }));
  if (user?.mood && size >= 32) el.append(h('span', { class: 'mood', title: moodOf(user.mood)?.label }, moodIcon(user.mood, Math.max(10, Math.round(size * 0.3)))));
  if (zoom && user?.photo) zoomable(el, user.photo, tr`Photo de ${user.name ?? 'profil'}`);
  return el;
}

export function groupBadge(g, size = 52, { zoom = false } = {}) {
  const el = h(
    'div',
    { class: 'badge', style: { width: `${size}px`, height: `${size}px`, background: tint(g?.color).tint }, 'aria-hidden': 'true' },
    g?.photo ? h('img', { src: g.photo, alt: '' }) : icon(g?.icon ?? 'heart', Math.round(size * 0.5)),
  );
  if (zoom && g?.photo) zoomable(el, g.photo, tr`Photo de ${g.name ?? 'groupe'}`);
  return el;
}

/** A group's badge, or for a two-person conversation the other person's avatar. */
export function groupAvatar(g, size = 52, { zoom = false } = {}) {
  return g?.direct && g.peer ? avatar(g.peer, size, { online: g.peer.online, zoom }) : groupBadge(g, size, { zoom });
}

/** A profile or group picture that opens big when tapped (even inside a row that does something else). */
function zoomable(el, src, label) {
  el.removeAttribute('aria-hidden');
  el.classList.add('zoomable');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `${label}, agrandir`);
  const open = (e) => {
    e.stopPropagation();
    e.preventDefault();
    lightbox(src, label);
  };
  el.addEventListener('click', open);
  el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && open(e));
}

/** Small round "i" that opens an explanation instead of a paragraph on screen. */
export function infoButton(title, text) {
  return h('button', {
    type: 'button',
    class: 'icon-btn info',
    'aria-label': tr`Plus d’infos : ${title}`,
    title,
    onclick: () =>
      sheet((close) => [
        h('h2', { class: 'title', style: { fontSize: '20px' } }, title),
        h('p', { class: 'muted', style: { margin: 0, whiteSpace: 'pre-line' } }, text),
        button(tr('Compris'), close),
      ]),
  }, icon('info', 20));
}

export function iconButton(name, label, onclick, { cls = '', disabled = false, size } = {}) {
  return h('button', { type: 'button', class: `icon-btn ${cls}`, 'aria-label': label, title: label, onclick, disabled }, icon(name, size ?? 22));
}

export function primaryButton(text, onclick, { iconName, disabled = false, type = 'button' } = {}) {
  return h('button', { type, class: 'btn-primary', onclick, disabled }, text, iconName && icon(iconName, 22, 2.4));
}

export function button(text, onclick, { iconName, danger = false, small = false, wide = false, disabled = false } = {}) {
  return h('button', { type: 'button', class: `btn${danger ? ' danger' : ''}${small ? ' small' : ''}${wide ? ' wide' : ''}`, onclick, disabled }, iconName && icon(iconName, 20), text);
}

export function topBar(title, onBack, { subtitle, actions = [] } = {}) {
  return h(
    'div',
    { class: 'row' },
    onBack && iconButton('back', tr('Retour'), onBack),
    h('div', { class: 'col grow', style: { gap: '0', minWidth: '0' } }, h('h1', { class: 'title ellipsis' }, title), subtitle && h('span', { class: 'small muted ellipsis' }, subtitle)),
    actions,
  );
}

export function swatches(selected, onPick, { face = false } = {}) {
  const wrap = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': face ? tr('Ta frimousse') : tr('Couleur') });
  const render = (sel) =>
    clear(
      wrap,
      TINTS.map((t) =>
        h(
          'button',
          {
            type: 'button',
            class: 'swatch',
            style: { background: t.tint },
            'aria-pressed': String(t.key === sel),
            'aria-label': (face ? 'Frimousse ' : 'Couleur ') + t.label,
            onclick: () => {
              render(t.key);
              onPick(t.key);
            },
          },
          face ? faceSvg(48) : t.key === sel ? icon('check', 20, 2.6) : null,
        ),
      ),
    );
  render(selected);
  return wrap;
}

export function segmented(options, selected, onPick, label) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const render = (sel) =>
    clear(
      wrap,
      options.map(([value, text]) =>
        h('button', { type: 'button', 'aria-pressed': String(value === sel), onclick: () => (render(value), onPick(value)) }, text),
      ),
    );
  render(selected);
  return wrap;
}

export function toggle(checked, onChange, label) {
  const el = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(checked), 'aria-label': label });
  el.addEventListener('click', () => {
    const v = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return el;
}

export function errorBox() {
  const el = h('div', { class: 'error', role: 'alert', hidden: true });
  el.show = (msg) => {
    el.textContent = msg ?? '';
    el.hidden = !msg;
  };
  return el;
}

/** Bottom sheet; returns a close() function. */
export function sheet(build) {
  const backdrop = h('div', { class: 'backdrop' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  document.addEventListener('keydown', onKey);
  append(panel, [build(close)]);
  backdrop.append(panel);
  document.body.append(backdrop);
  panel.querySelector('button')?.focus();
  return close;
}

export function confirmDialog(title, body, confirmText = tr('Confirmer')) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'backdrop dialog-wrap' });
    const done = (v) => {
      backdrop.remove();
      resolve(v);
    };
    backdrop.addEventListener('click', (e) => e.target === backdrop && done(false));
    backdrop.append(
      h(
        'div',
        { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' },
        h('h2', { class: 'title', style: { fontSize: '20px' } }, title),
        h('p', { class: 'muted', style: { margin: '0' } }, body),
        h('div', { class: 'actions' }, button(tr('Annuler'), () => done(false), { small: true }), button(confirmText, () => done(true), { small: true, danger: true })),
      ),
    );
    document.body.append(backdrop);
    backdrop.querySelector('.btn')?.focus();
  });
}

export function lightbox(src, alt) {
  const close = () => box.remove();
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', onclick: close }, h('img', { src, alt }), iconButton('close', tr('Fermer'), close));
  document.body.append(box);
  box.querySelector('button').focus();
}

// --- formatting -------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const startOfDay = (ts) => new Date(new Date(ts).toDateString()).getTime();
const daysAgo = (ts) => Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000);

export const timeOf = (ts) => timeFmt.format(ts);
export const sameDay = (a, b) => startOfDay(a) === startOfDay(b);

export function shortWhen(ts) {
  const d = daysAgo(ts);
  if (d <= 0) return timeOf(ts);
  if (d === 1) return tr('Hier');
  if (d < 7) {
    const w = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(ts);
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(ts);
}

export function dayLabel(ts) {
  const d = daysAgo(ts);
  if (d === 0) return tr('Aujourd’hui');
  if (d === 1) return tr('Hier');
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
  const s = new Intl.DateTimeFormat(locale, sameYear ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(ts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 1536 → "1,5 Ko", 3_400_000 → "3,2 Mo". */
export function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = [tr('o'), tr('Ko'), tr('Mo'), tr('Go')];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) (v /= 1024), i++;
  return `${v.toLocaleString(locale, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

export function duration(ms) {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function lastSeen(m) {
  if (m.online) return tr('En ligne');
  if (!m.lastSeenAt) return tr('Pas encore venu·e');
  const mins = Math.floor((Date.now() - m.lastSeenAt) / 60_000);
  if (mins < 1) return tr('Vu·e à l’instant');
  if (mins < 60) return tr`Vu·e il y a ${mins} min`;
  if (mins < 24 * 60) return tr`Vu·e il y a ${Math.floor(mins / 60)} h`;
  return `Vu·e ${shortWhen(m.lastSeenAt).toLowerCase()}`;
}

export function systemText(m, name) {
  const who = name ?? tr('Quelqu’un');
  switch (m.meta?.event) {
    case 'created': return tr`${who} a créé le groupe`;
    case 'joined': return tr`${who} a rejoint le groupe`;
    case 'left': return tr`${who} est parti·e`;
    case 'removed': return tr`${who} a été retiré·e du groupe`;
    case 'livedraw': return tr`${who} a lancé une toile commune`;
    default: return tr('Le groupe a changé');
  }
}

export function preview(m, author) {
  const who = author ?? tr('Quelqu’un');
  const sent = author === tr('Toi') ? tr('Tu as envoyé') : tr`${who} a envoyé`;
  if (m.deleted) return tr('Message supprimé');
  switch (m.type) {
    case 'text': return author ? `${author} : ${m.text}` : m.text;
    case 'photo': return tr`${sent} une photo`;
    case 'drawing': return tr`${sent} un dessin`;
    case 'video': return tr`${sent} une vidéo`;
    case 'file': return `${sent} « ${m.meta?.name ?? tr('un fichier')} »`;
    case 'voice': return tr`${who} · vocal ${duration(m.meta?.durationMs)}`;
    case 'gif': return `${sent} un GIF`;
    case 'sticker': return tr`${sent} un sticker`;
    case 'poll': return tr`${who} : sondage « ${m.text} »`;
    case 'location': return tr`${who} a partagé sa position`;
    case 'game': return tr`${who} a lancé une partie`;
    case 'recap': return tr`${who} a partagé le récap du mois`;
    case 'system': return systemText(m, author);
    default: return m.text;
  }
}

/** One line about the message a reply answers ("Photo", "Vocal 0:12", the start of the text…). */
export function replySnippet(r) {
  if (!r || r.deleted) return tr('Message supprimé');
  if (r.type === 'file') return tr`Fichier · ${r.text || r.meta?.name || 'document'}`;
  const label = { photo: tr('Photo'), video: tr('Vidéo'), drawing: tr('Dessin'), voice: tr('Vocal'), gif: 'GIF', sticker: 'Sticker', location: tr('Position'), game: tr('Partie de jeu'), recap: tr('Récap du mois') }[r.type];
  if (r.type === 'poll') return tr`Sondage « ${r.text} »`;
  if (label) return r.text ? `${label} · ${r.text}` : label;
  return r.text;
}

export const roleLabel = (r) => ({ owner: tr('Créateur·rice'), admin: 'Admin' })[r] ?? tr('Membre');

/** Re-encodes a picked image as JPEG, at most `max` px on its long side (EXIF rotation applied by the browser). */
export async function resizeImage(file, max = 1600) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const hgt = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, hgt);
  bitmap.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error(tr('Image illisible'));
  return { blob, width: w, height: hgt };
}
