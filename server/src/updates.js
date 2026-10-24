// Is there a newer Papote? Asks GitHub for the latest release now and then (only the server does:
// the apps ask their own server). UPDATE_CHECK=false turns it off.

const EVERY = 12 * 3600_000;

/** "v1.2.3" or "1.2.3" → [1, 2, 3]; anything else → null. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim());
  return m ? m.slice(1).map(Number) : null;
}

/** true when a is a strictly later version than b. */
export function isNewer(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export function createUpdates({ version, repo = 'MrDDream/Papote', enabled = false, logger = console, fetchImpl = globalThis.fetch }) {
  let latest = null; // { version, tag, url, publishedAt, notes, apk }
  let checkedAt = null;
  let error = null;
  let running = null;
  let timer = null;

  async function check() {
    if (!enabled) return status();
    // Several pages asking at once share one request.
    running ??= (async () => {
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Papote/${version}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 404) {
          latest = null;
          error = null;
        } else if (!res.ok) {
          throw new Error(`GitHub a répondu ${res.status}`);
        } else {
          const r = await res.json();
          // Only links to GitHub itself end up in the admin and the apps.
          const gh = (u) => (typeof u === 'string' && u.startsWith('https://github.com/') ? u : null);
          const apk = (r.assets ?? []).find((a) => /\.apk$/i.test(a.name ?? '') && /release/i.test(a.name)) ?? (r.assets ?? []).find((a) => /\.apk$/i.test(a.name ?? ''));
          latest = {
            version: parseVersion(r.tag_name)?.join('.') ?? r.tag_name,
            tag: r.tag_name,
            name: r.name || r.tag_name,
            url: gh(r.html_url) ?? `https://github.com/${repo}/releases`,
            publishedAt: r.published_at ? Date.parse(r.published_at) : null,
            notes: String(r.body ?? '').slice(0, 4000),
            apk: apk && gh(apk.browser_download_url) ? { name: apk.name, url: apk.browser_download_url, size: apk.size ?? null } : null,
          };
          error = null;
        }
      } catch (e) {
        error = e.message || String(e);
        logger.debug?.(`Vérification des mises à jour : ${error}`);
      } finally {
        checkedAt = Date.now();
        running = null;
      }
      return status();
    })();
    return running;
  }

  /** What the admin and the apps show; never waits for GitHub. */
  function status() {
    return {
      enabled,
      current: version,
      latest,
      available: !!latest && isNewer(latest.version, version),
      checkedAt,
      error,
      releasesUrl: `https://github.com/${repo}/releases`,
    };
  }

  /** The cached answer, refreshed in the background once it's old. */
  function cached() {
    if (enabled && !running && (!checkedAt || Date.now() - checkedAt > EVERY)) check();
    return status();
  }

  function start() {
    if (!enabled || timer) return;
    check();
    timer = setInterval(check, EVERY);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { check, status, cached, start, stop, isNewer };
}
