import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { createHub } from './realtime.js';
import { createApi } from './api.js';
import { createAdmin } from './admin/index.js';
import { createWeb } from './web.js';
import { createBackups, restoreBackup } from './backup.js';
import { createPush } from './push.js';
import { createGifs } from './gifs.js';
import { createWhisper } from './whisper.js';
import { createUpdates } from './updates.js';
import { HttpError, now } from './util.js';

export const VERSION = '0.4.0';

export function createServer({
  dataDir,
  adminPassword = null,
  adminAllowedIps = null,
  adminRequire2fa = false,
  backupDir = null,
  backupEveryHours = 24,
  backupKeep = 14,
  vapidSubject = null,
  vapidKeys = null,
  pushSend,
  giphyApiKey = null,
  whisperUrl = null,
  whisperLanguage = 'fr',
  updateCheck = false,
  maxUploadMb = 20,
  updateRepo = 'MrDDream/Papote',
  fetchImpl,
  /** Called once a backup has been restored from the admin: the process must start again (Docker does). */
  restart = () => {},
  serverName = 'Papote',
  secureCookies = false,
  trustProxy = false,
  logger = console,
}) {
  const db = openDb(dataDir);
  fs.rmSync(path.join(dataDir, 'tmp'), { recursive: true, force: true });
  const store = createStore(db);

  // Back from a restore started in the admin: note it in the (restored) journal.
  const marker = path.join(dataDir, 'restored.json');
  if (fs.existsSync(marker)) {
    try {
      const r = JSON.parse(fs.readFileSync(marker, 'utf8'));
      store.q("INSERT INTO admin_events (at, kind, detail) VALUES (?, 'backup_restored', ?)").run(
        now(),
        `${r.name} · ${r.restored} média(s) remis${r.missing ? `, ${r.missing} introuvable(s)` : ''} · état d’avant gardé dans ${r.safety}`,
      );
    } catch {
      /* unreadable marker: nothing to report */
    }
    fs.rmSync(marker, { force: true });
  }

  const backups = createBackups({
    db,
    dataDir,
    backupDir,
    everyHours: backupEveryHours,
    keep: backupKeep,
    logger,
    onEvent: (kind, detail) => store.q('INSERT INTO admin_events (at, kind, detail) VALUES (?, ?, ?)').run(now(), kind, detail),
  });

  let api;
  const hub = createHub({ store, authenticate: (t) => api.authenticate(t), logger });
  const push = createPush({ store, hub, dataDir, subject: vapidSubject, keys: vapidKeys, logger, ...(pushSend ? { send: pushSend } : {}) });
  const gifs = createGifs({ apiKey: giphyApiKey, dataDir, logger, ...(fetchImpl ? { fetchImpl } : {}) });
  const whisper = createWhisper({ url: whisperUrl, language: whisperLanguage, logger, ...(fetchImpl ? { fetchImpl } : {}) });
  const updates = createUpdates({ version: VERSION, repo: updateRepo, enabled: updateCheck, logger, ...(fetchImpl ? { fetchImpl } : {}) });
  api = createApi({ store, hub, push, dataDir, serverName, version: VERSION, gifs, whisper, updates, maxUploadMb });

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true, version: VERSION }));
  app.use('/api', api.router);
  app.use(
    '/admin',
    createAdmin({
      store,
      hub,
      dataDir,
      adminPassword,
      allowedIps: adminAllowedIps,
      requireTotp: adminRequire2fa,
      serverName,
      backups,
      gifs,
      whisper,
      updates,
      restore: restoreFrom,
      logger,
      version: VERSION,
      secure: secureCookies,
    }),
  );
  app.use('/web', createWeb());
  app.get('/', (_req, res) => res.redirect('/web/'));

  app.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      err = err.code === 'LIMIT_FILE_SIZE' ? new HttpError(413, 'file_too_large', `Fichier trop lourd (${maxUploadMb} Mo maximum)`) : new HttpError(400, err.code.toLowerCase());
    } else if (err?.type === 'entity.parse.failed') {
      err = new HttpError(400, 'bad_json');
    } else if (err?.type === 'entity.too.large') {
      err = new HttpError(413, 'payload_too_large');
    }
    if (!(err instanceof HttpError)) {
      logger.error(err);
      err = new HttpError(500, 'internal_error', 'Erreur interne');
    }
    res.status(err.status).json({ error: err.code, message: err.message });
  });

  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    if (!hub.handleUpgrade(req, socket, head)) socket.destroy();
  });

  // On a fresh install nobody can get in without a code: print the server access code so the first person can.
  function bootstrapCode() {
    const users = store.q('SELECT COUNT(*) n FROM users').get().n;
    if (users > 0) return null;
    return store.serverCode({ create: true }).code;
  }

  /** Stops everything, puts the snapshot back as the live database, then asks for a restart. */
  function restoreFrom(name, safety) {
    close();
    const r = restoreBackup({ dataDir, backupDir: backups.dir, name });
    fs.writeFileSync(marker, JSON.stringify({ name, safety, restored: r.restored, missing: r.missing }));
    logger.log?.(`Sauvegarde ${name} restaurée : redémarrage`);
    restart();
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    backups.stop();
    updates.stop();
    api.features.close();
    hub.close();
    server.close();
    db.close();
  }

  return { app, server, store, hub, backups, push, updates, features: api.features, bootstrapCode, close };
}
