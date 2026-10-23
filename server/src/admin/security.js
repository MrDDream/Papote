import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { now, parseCookies, sha256 } from '../util.js';
import { newSecret, verifyTotp } from './totp.js';

export const SESSION_COOKIE = 'papote_admin';
export const CHALLENGE_COOKIE = 'papote_admin_2fa';
export const MIN_PASSWORD_LENGTH = 12;

// Example values from the docs, and the usual suspects: an admin left with one of these is open to anyone.
const PLACEHOLDERS = ['change-moi', 'changeme', 'change-me', 'motdepasse', 'mot-de-passe', 'password', 'azerty', 'qwerty', '123456', 'papote', 'admin'];

/** Why this ADMIN_PASSWORD can't be used (in French, for the logs), or null when it's fine. */
export function adminPasswordProblem(password) {
  if (!password) return 'ADMIN_PASSWORD absent.';
  if (password.length < MIN_PASSWORD_LENGTH) return `ADMIN_PASSWORD fait moins de ${MIN_PASSWORD_LENGTH} caractères.`;
  const lower = password.toLowerCase();
  if (PLACEHOLDERS.some((p) => lower.includes(p)) || new Set(lower).size < 5) {
    return 'ADMIN_PASSWORD ressemble à un exemple ou à un mot de passe courant : choisis-en un vraiment à toi.';
  }
  return null;
}

const ABSOLUTE_MS = 12 * 60 * 60 * 1000; // a session never outlives 12 h
const IDLE_MS = 30 * 60 * 1000; // …nor 30 min without activity
const CHALLENGE_MS = 5 * 60 * 1000; // time to type the 2FA code after the password
const CHALLENGE_TRIES = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_FAILURES = 30; // all IPs together: slows down attacks spread over many addresses
const EVENTS_KEPT_MS = 90 * 24 * 60 * 60 * 1000;
const RECOVERY_CODES = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function sessionSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, 'session.secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

/** "192.168.0.0/16, 10.0.0.0/8, ::1" → BlockList. Any bad entry stops the server: failing open is not an option. */
export function parseAllowList(spec) {
  if (!spec || !spec.trim()) return null;
  const list = new net.BlockList();
  for (const raw of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [addr, prefix] = raw.split('/');
    const type = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
    if (!type) throw new Error(`ADMIN_ALLOWED_IPS : adresse invalide « ${raw} »`);
    if (prefix === undefined) list.addAddress(addr, type);
    else {
      const bits = Number(prefix);
      if (!Number.isInteger(bits) || bits < 0 || bits > (type === 'ipv4' ? 32 : 128)) throw new Error(`ADMIN_ALLOWED_IPS : masque invalide « ${raw} »`);
      list.addSubnet(addr, bits, type);
    }
  }
  return list;
}

function ipAllowed(list, ip) {
  if (!ip) return false;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (net.isIPv4(v4)) return list.check(v4, 'ipv4');
  return net.isIPv6(ip) && list.check(ip, 'ipv6');
}

export function createAdminSecurity({ store, dataDir, adminPassword, allowedIps, secure, requireTotp = false }) {
  const { q } = store;
  const secret = sessionSecret(dataDir);
  const allowList = parseAllowList(allowedIps);
  const configError = !adminPassword
    ? 'missing'
    : adminPassword.length < MIN_PASSWORD_LENGTH
      ? 'too_short'
      : adminPasswordProblem(adminPassword)
        ? 'weak'
        : null;
  // Sessions remember which password opened them: changing ADMIN_PASSWORD signs everyone out.
  const passwordFp = adminPassword ? crypto.createHmac('sha256', secret).update(`pw:${adminPassword}`).digest('hex') : '';
  const challenges = new Map(); // sha256(token) -> { expires, tries, ip }

  q('DELETE FROM admin_events WHERE at < ?').run(now() - EVENTS_KEPT_MS);
  q('DELETE FROM admin_sessions WHERE expires_at < ? OR password_fp != ?').run(now(), passwordFp);

  const cookieAttrs = (maxAge) => `Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  // --- settings & journal --------------------------------------------------------

  const getSetting = (key) => q('SELECT value FROM admin_settings WHERE key = ?').get(key)?.value ?? null;
  const setSetting = (key, value) =>
    q('INSERT INTO admin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  const deleteSetting = (key) => q('DELETE FROM admin_settings WHERE key = ?').run(key);

  function audit(kind, req, detail = null) {
    q('INSERT INTO admin_events (at, kind, ip, detail) VALUES (?, ?, ?, ?)').run(now(), kind, req?.ip ?? null, detail);
  }

  const events = (limit = 50) => q('SELECT * FROM admin_events ORDER BY id DESC LIMIT ?').all(limit);

  function lockedOut() {
    const n = q("SELECT COUNT(*) n FROM admin_events WHERE kind IN ('login_failed', 'totp_failed') AND at > ?").get(now() - LOCKOUT_WINDOW_MS).n;
    return n >= LOCKOUT_FAILURES;
  }

  // --- password ------------------------------------------------------------------

  function passwordMatches(input) {
    if (configError || typeof input !== 'string') return false;
    const a = crypto.createHash('sha256').update(input).digest();
    const b = crypto.createHash('sha256').update(adminPassword).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // --- sessions --------------------------------------------------------------------

  function createSession(req, res) {
    const token = crypto.randomBytes(32).toString('base64url');
    const ts = now();
    q('INSERT INTO admin_sessions (id, created_at, last_seen_at, expires_at, password_fp, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      sha256(token),
      ts,
      ts,
      ts + ABSOLUTE_MS,
      passwordFp,
      req.ip ?? null,
      String(req.headers['user-agent'] ?? '').slice(0, 200),
    );
    res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttrs(ABSOLUTE_MS / 1000)}`);
  }

  function currentSession(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const id = sha256(token);
    const row = q('SELECT * FROM admin_sessions WHERE id = ?').get(id);
    if (!row) return null;
    const ts = now();
    if (row.expires_at < ts || row.last_seen_at < ts - IDLE_MS || row.password_fp !== passwordFp) {
      q('DELETE FROM admin_sessions WHERE id = ?').run(id);
      return null;
    }
    if (ts - row.last_seen_at > 30_000) q('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?').run(ts, id);
    return row;
  }

  function destroySession(req, res) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) q('DELETE FROM admin_sessions WHERE id = ?').run(sha256(token));
    res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs(0)}`);
  }

  const sessions = () => q('SELECT * FROM admin_sessions ORDER BY last_seen_at DESC').all();
  const deleteSession = (id) => q('DELETE FROM admin_sessions WHERE id = ?').run(id);
  const deleteOtherSessions = (keepId) => q('DELETE FROM admin_sessions WHERE id != ?').run(keepId ?? '');

  // --- 2FA ------------------------------------------------------------------------

  const totpEnabled = () => !!getSetting('totp_secret');

  function startTotpSetup() {
    const s = newSecret();
    setSetting('totp_pending', s);
    return s;
  }

  function newRecoveryCodes() {
    const codes = Array.from({ length: RECOVERY_CODES }, () => {
      let c = '';
      for (let i = 0; i < 8; i++) c += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
      return `${c.slice(0, 4)}-${c.slice(4)}`;
    });
    setSetting('recovery_codes', JSON.stringify(codes.map((c) => sha256(c))));
    return codes;
  }

  const recoveryLeft = () => JSON.parse(getSetting('recovery_codes') ?? '[]').length;

  /** Confirms the pending secret with a first code; returns the recovery codes, or null. */
  function confirmTotpSetup(code) {
    const pending = getSetting('totp_pending');
    if (!pending) return null;
    const step = verifyTotp(pending, code);
    if (step === null) return null;
    setSetting('totp_secret', pending);
    setSetting('totp_last_step', String(step));
    deleteSetting('totp_pending');
    return newRecoveryCodes();
  }

  /** A 6-digit app code (never twice the same step) or a one-time recovery code. Returns 'totp', 'recovery' or null. */
  function checkSecondFactor(input) {
    const value = String(input ?? '').trim().toUpperCase();
    const s = getSetting('totp_secret');
    if (!s) return null;
    if (/^\d[\d\s]*$/.test(value)) {
      const step = verifyTotp(s, value, { afterStep: Number(getSetting('totp_last_step') ?? -1) });
      if (step === null) return null;
      setSetting('totp_last_step', String(step));
      return 'totp';
    }
    const raw = value.replace(/[^A-Z0-9]/g, '');
    if (raw.length !== 8) return null;
    const hash = sha256(`${raw.slice(0, 4)}-${raw.slice(4)}`);
    const codes = JSON.parse(getSetting('recovery_codes') ?? '[]');
    if (!codes.includes(hash)) return null;
    setSetting('recovery_codes', JSON.stringify(codes.filter((c) => c !== hash)));
    return 'recovery';
  }

  function disableTotp() {
    for (const k of ['totp_secret', 'totp_pending', 'totp_last_step', 'recovery_codes']) deleteSetting(k);
  }

  // --- the step between password and 2FA code -------------------------------------------

  function startChallenge(req, res) {
    const token = crypto.randomBytes(32).toString('base64url');
    challenges.set(sha256(token), { expires: now() + CHALLENGE_MS, tries: 0, ip: req.ip });
    for (const [k, v] of challenges) if (v.expires < now()) challenges.delete(k);
    res.append('Set-Cookie', `${CHALLENGE_COOKIE}=${token}; ${cookieAttrs(CHALLENGE_MS / 1000)}`);
  }

  /** The pending challenge for this browser, counting one more try; null when missing, expired or exhausted. */
  function takeChallengeTry(req) {
    const token = parseCookies(req.headers.cookie)[CHALLENGE_COOKIE];
    const key = token && sha256(token);
    const c = key && challenges.get(key);
    if (!c || c.expires < now() || c.ip !== req.ip || c.tries >= CHALLENGE_TRIES) {
      if (key) challenges.delete(key);
      return null;
    }
    c.tries++;
    return { done: () => challenges.delete(key) };
  }

  const hasChallenge = (req) => {
    const token = parseCookies(req.headers.cookie)[CHALLENGE_COOKIE];
    const c = token && challenges.get(sha256(token));
    return !!c && c.expires > now();
  };

  const clearChallengeCookie = (res) => res.append('Set-Cookie', `${CHALLENGE_COOKIE}=; ${cookieAttrs(0)}`);

  // --- IP filter ----------------------------------------------------------------------

  /** Outside ADMIN_ALLOWED_IPS the admin does not exist (404), so it can't be probed. */
  function ipGuard(req, res, next) {
    if (!allowList || ipAllowed(allowList, req.ip)) return next();
    res.status(404).type('text').send('Not found');
  }

  return {
    configError,
    requireTotp,
    restrictedByIp: !!allowList,
    ipGuard,
    audit,
    events,
    lockedOut,
    passwordMatches,
    createSession,
    currentSession,
    destroySession,
    sessions,
    deleteSession,
    deleteOtherSessions,
    totpEnabled,
    startTotpSetup,
    pendingTotp: () => getSetting('totp_pending'),
    confirmTotpSetup,
    checkSecondFactor,
    newRecoveryCodes,
    recoveryLeft,
    disableTotp,
    startChallenge,
    takeChallengeTry,
    hasChallenge,
    clearChallengeCookie,
  };
}
