import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = path.join(ROOT, 'web');
const FONTS_DIR = path.join(ROOT, 'public', 'fonts');

const CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// The web app (and PWA) for people without the Android app. Plain files, no build step.
export function createWeb() {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    next();
  });
  router.use('/fonts', express.static(FONTS_DIR, { maxAge: '30d', index: false }));
  router.use(
    express.static(WEB_DIR, {
      index: 'index.html',
      setHeaders(res, file) {
        // The shell and the service worker must be revalidated so updates reach installed PWAs.
        if (/\.(html|js|css|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
        if (file.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/web/');
      },
    }),
  );
  return router;
}
