// Reads the environment once, and refuses to start on a value that would silently do the wrong thing.

export class ConfigError extends Error {}

function wholeNumber(env, name, { fallback, min }) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new ConfigError(`${name}=${raw} : un nombre entier ≥ ${min} est attendu`);
  return n;
}

/**
 * Which proxies may set X-Forwarded-For. Only addresses, never a hop count or "true": those trust whoever
 * connects, so anyone reaching the port directly could pretend to be any IP (and walk past
 * ADMIN_ALLOWED_IPS and every rate limit).
 */
function trustProxy(raw) {
  if (raw === undefined || raw === '' || raw === '0' || raw === 'false') return false;
  if (/^\d+$/.test(raw.trim()) || raw.trim() === 'true') {
    throw new ConfigError(
      `TRUST_PROXY=${raw} : indique les adresses du reverse proxy (par exemple « loopback, uniquelocal » ou « 172.18.0.0/16 »), pas un nombre ni true.`,
    );
  }
  return raw;
}

export function parseConfig(env) {
  return {
    port: wholeNumber(env, 'PORT', { fallback: 3000, min: 1 }),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.DATA_DIR ?? './data',
    adminPassword: env.ADMIN_PASSWORD || null,
    adminAllowedIps: env.ADMIN_ALLOWED_IPS || null,
    adminRequire2fa: env.ADMIN_REQUIRE_2FA === 'true',
    backupDir: env.BACKUP_DIR || null,
    backupEveryHours: wholeNumber(env, 'BACKUP_EVERY_HOURS', { fallback: 24, min: 0 }),
    backupKeep: wholeNumber(env, 'BACKUP_KEEP', { fallback: 14, min: 1 }),
    serverName: env.SERVER_NAME ?? 'Papote',
    secureCookies: env.SECURE_COOKIES === 'true',
    trustProxy: trustProxy(env.TRUST_PROXY),
    // Web Push: optional. Without them, keys are made once in data/vapid.json and the contact is the site's address.
    vapidSubject: env.VAPID_SUBJECT || null,
    // GIFs: a GIPHY key (developers.giphy.com). Transcription: the Whisper container's address.
    giphyApiKey: env.GIPHY_API_KEY || null,
    // Whisper: an explicit address, or the "whisper" compose profile (its container is then next to us).
    whisperUrl: env.WHISPER_URL || (/(^|,)\s*whisper\s*(,|$)/.test(env.PAPOTE_PROFILES ?? '') ? 'http://whisper:9000' : null),
    whisperLanguage: env.WHISPER_LANGUAGE || 'fr',
    vapidKeys: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : null,
  };
}
