// Lists the French texts the apps translate: every tr('…'), tr`…` (web) and tr("…", …) (Android), plus the
// server's error messages shown in the apps. `node server/scripts/i18n-keys.mjs` prints the ones en.json lacks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const EN = path.join(repo, 'server', 'web', 'i18n', 'en.json');

function files(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []));
}

/** The literal starting at i (quote char at i): its value, interpolations as {} (JS ${…}, Kotlin $x / ${…}). */
function literal(src, i, kotlin) {
  const q = src[i];
  let out = '';
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    const c = src[j];
    if (c === '\\') {
      const d = src[j + 1];
      if (d === 'u') {
        out += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16));
        j += 6;
        continue;
      }
      out += { n: '\n', t: '\t' }[d] ?? d;
      j += 2;
      continue;
    }
    if (c === '$' && src[j + 1] === '{' && (kotlin || q === '`')) {
      let depth = 1;
      j += 2;
      while (j < src.length && depth) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        else if (src[j] === '"' || src[j] === "'" || src[j] === '`') {
          const end = skip(src, j);
          j = end;
          continue;
        }
        j++;
      }
      out += '{}';
      continue;
    }
    if (kotlin && c === '$' && /[A-Za-z_]/.test(src[j + 1] ?? '')) {
      j++;
      while (/[A-Za-z0-9_]/.test(src[j] ?? '')) j++;
      out += '{}';
      continue;
    }
    out += c;
    j++;
  }
  return out;
}

function skip(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
  return j + 1;
}

export function usedKeys() {
  const keys = new Set();
  for (const f of files(path.join(repo, 'server', 'web', 'js'), '.js').filter((f) => !f.endsWith('i18n.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\btr(\(\s*['"`]|`)/g)) {
      const at = m.index + m[0].length - 1;
      keys.add(literal(src, at, false));
    }
  }
  for (const f of files(path.join(repo, 'android', 'app', 'src', 'main', 'java'), '.kt')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\btr\(\s*"/g)) keys.add(literal(src, m.index + m[0].length - 1, true));
  }
  for (const f of files(path.join(repo, 'server', 'src'), '.js')) {
    if (f.includes(`${path.sep}admin${path.sep}`)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/new HttpError\(\d+, '[a-z_]+', '((?:[^'\\]|\\.)*)'\)/g)) keys.add(literal(`'${m[1]}'`, 0, false));
  }
  return keys;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const en = JSON.parse(fs.readFileSync(EN, 'utf8'));
  const missing = [...usedKeys()].filter((k) => !(k in en)).sort();
  const unused = Object.keys(en).filter((k) => !usedKeys().has(k));
  if (process.argv.includes('--json')) console.log(JSON.stringify(missing, null, 1));
  else {
    console.log(`${missing.length} sans traduction, ${unused.length} inutilisée(s)`);
    for (const k of missing) console.log(JSON.stringify(k));
  }
}
