import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';

// GIFs from GIPHY, always fetched by the server: members' phones and browsers never talk to GIPHY,
// so GIPHY sees neither their address nor what they look at. Off when GIPHY_API_KEY isn't set.

const API = 'https://api.giphy.com/v1/gifs';
const ID = /^[A-Za-z0-9]{4,40}$/;
const CACHE_MAX_BYTES = 150 * 1024 * 1024;

function giphyHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'giphy.com' || u.hostname.endsWith('.giphy.com')) ? u : null;
  } catch {
    return null;
  }
}

export function createGifs({ apiKey, dataDir, logger = console, fetchImpl = globalThis.fetch }) {
  const enabled = !!apiKey;
  const cacheDir = path.join(dataDir, 'cache', 'gifs');
  const known = new Map(); // id -> { title, preview, full, width, height } (most recent last)
  const lists = new Map(); // "search:chat:0" -> { at, items }

  function remember(g) {
    const fixed = g.images?.fixed_width ?? {};
    const small = g.images?.downsized ?? g.images?.fixed_height ?? {};
    const item = {
      id: g.id,
      title: String(g.title ?? '').replace(/\s+GIF.*$/i, '').slice(0, 80),
      preview: fixed.webp || fixed.url,
      full: small.url,
      width: Number(fixed.width) || 200,
      height: Number(fixed.height) || 200,
    };
    if (!ID.test(item.id) || !giphyHost(item.preview) || !giphyHost(item.full)) return null;
    known.delete(item.id);
    known.set(item.id, item);
    if (known.size > 3000) known.delete(known.keys().next().value);
    return { id: item.id, title: item.title, width: item.width, height: item.height, preview: `/api/gifs/${item.id}/preview` };
  }

  async function call(endpoint, params) {
    if (!enabled) throw new HttpError(503, 'gifs_disabled', 'Les GIF ne sont pas activés sur ce serveur');
    const url = new URL(`${API}/${endpoint}`);
    url.search = new URLSearchParams({ api_key: apiKey, rating: 'pg-13', lang: 'fr', ...params }).toString();
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      logger.error?.(`GIPHY : réponse ${res.status}`);
      throw new HttpError(502, 'gifs_unavailable', 'GIPHY ne répond pas pour l’instant');
    }
    return res.json();
  }

  async function list(kind, query, offset) {
    const key = `${kind}:${query}:${offset}`;
    const hit = lists.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.items;
    const params = { limit: '24', offset: String(offset) };
    if (kind === 'search') params.q = query;
    const body = await call(kind, params);
    const items = (body.data ?? []).map(remember).filter(Boolean);
    lists.set(key, { at: Date.now(), items });
    if (lists.size > 300) lists.delete(lists.keys().next().value);
    return items;
  }

  const search = (query, offset = 0) => list('search', query.slice(0, 50), Math.max(0, Math.min(offset, 4975)));
  const trending = (offset = 0) => list('trending', '', Math.max(0, Math.min(offset, 4975)));

  async function info(id) {
    if (!ID.test(id)) throw new HttpError(404, 'gif_not_found');
    if (known.has(id)) return known.get(id);
    const body = await call(id, {});
    if (!body.data || !remember(body.data)) throw new HttpError(404, 'gif_not_found');
    return known.get(id);
  }

  async function download(url, max) {
    const u = giphyHost(url);
    if (!u) throw new HttpError(502, 'gifs_unavailable');
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!res.ok) throw new HttpError(502, 'gifs_unavailable', 'GIPHY ne répond pas pour l’instant');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new HttpError(413, 'gif_too_large', 'Ce GIF est trop lourd');
    const head = buf.subarray(0, 12).toString('latin1');
    const mime = head.startsWith('GIF8') ? 'image/gif' : head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!mime) throw new HttpError(502, 'gifs_unavailable');
    return { buf, mime };
  }

  /** Small animated preview for the picker, cached on disk. */
  async function preview(id) {
    const item = await info(id);
    const file = path.join(cacheDir, id);
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      return { buf, mime: buf.subarray(0, 4).toString('latin1') === 'GIF8' ? 'image/gif' : 'image/webp' };
    }
    const out = await download(item.preview, 4 * 1024 * 1024);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, out.buf);
    return out;
  }

  /** The GIF itself, to be kept with the group's media once sent. */
  async function full(id) {
    const item = await info(id);
    const out = await download(item.full, 15 * 1024 * 1024);
    return { ...out, title: item.title, width: item.width, height: item.height };
  }

  function pruneCache() {
    let files;
    try {
      files = fs.readdirSync(cacheDir).map((f) => {
        const st = fs.statSync(path.join(cacheDir, f));
        return { f, size: st.size, at: st.mtimeMs };
      });
    } catch {
      return;
    }
    let total = files.reduce((n, x) => n + x.size, 0);
    for (const x of files.sort((a, b) => a.at - b.at)) {
      if (total <= CACHE_MAX_BYTES) break;
      fs.rmSync(path.join(cacheDir, x.f), { force: true });
      total -= x.size;
    }
  }

  return { enabled, search, trending, preview, full, pruneCache };
}
