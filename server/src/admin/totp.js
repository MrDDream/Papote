import crypto from 'node:crypto';

// Time-based one-time passwords (RFC 6238) as used by Google Authenticator, Aegis, 2FAS…:
// HMAC-SHA1, 6 digits, 30-second steps.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 random bytes, the size authenticator apps expect for SHA-1. */
export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(key, counter, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const currentStep = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Checks a 6-digit code against the steps around now (±1, so clocks a little off still work).
 * Returns the matching step, or null. Callers reject steps already used to stop replays.
 */
export function verifyTotp(secret, code, { now = Date.now(), window = 1, afterStep = -1 } = {}) {
  const input = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(input)) return null;
  const key = base32Decode(secret);
  const step = currentStep(now);
  let match = null;
  // Check every candidate (no early exit) so timing doesn't reveal which one matched.
  for (let s = step - window; s <= step + window; s++) {
    const ok = crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(input));
    if (ok && s > afterStep && match === null) match = s;
  }
  return match;
}

export function otpauthUrl(secret, { issuer, account }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

/** "ABCD EFGH IJKL…" for people typing the secret by hand. */
export const groupSecret = (secret) => secret.match(/.{1,4}/g).join(' ');
