import { HttpError } from './util.js';

// Fixed-window limiter, in memory: enough for a single small self-hosted instance.
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, windowMs);
  sweep.unref();
  return (req, _res, next) => {
    const t = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.reset < t) hits.set(key, (entry = { count: 0, reset: t + windowMs }));
    if (++entry.count > max) return next(new HttpError(429, 'too_many_attempts', 'Trop d’essais, réessaie plus tard'));
    next();
  };
}
