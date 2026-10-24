// French is the language the app is written in: each French text is its own key. English comes from
// i18n/en.json (shared with the Android app). Changing the language reloads the page.

const KEY = 'papote.lang';

/** [code, name, flag] */
export const LANGS = [
  ['fr', 'Français', '🇫🇷'],
  ['en', 'English', '🇬🇧'],
];

function stored() {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}

export const lang = stored();
/** For dates and numbers. */
export const locale = lang === 'en' ? 'en-GB' : 'fr-FR';
document.documentElement.lang = lang;

let dict = {};
if (lang === 'en') {
  try {
    dict = await (await fetch(new URL('../i18n/en.json', import.meta.url))).json();
  } catch {
    /* offline and not cached yet: French it is */
  }
}

export function setLang(code) {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* private mode: stays for this page only */
  }
  location.reload();
}

/** {} placeholders in order, or {0} {1}… when the translation reorders them. */
function fill(text, values) {
  let i = 0;
  return text.replace(/\{(\d*)\}/g, (_, n) => String(values[n === '' ? i++ : Number(n)] ?? ''));
}

/** tr('Texte') or tr`Texte ${x}`: the text in the current language. */
export function tr(strings, ...values) {
  if (Array.isArray(strings) && 'raw' in strings) {
    const key = strings.join('{}');
    return fill(dict[key] ?? key, values);
  }
  const s = String(strings ?? '');
  return dict[s] ?? s;
}
