import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'papote-';
const SUFFIX = '.db';
const CHECK_EVERY_MS = 10 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000;

/**
 * Database snapshots plus an incremental copy of the media files.
 *
 *   <backupDir>/papote-2026-10-23T03-00-00.db   one consistent snapshot per run (the newest `keep` are kept)
 *   <backupDir>/media/<id>                       media files, copied once: they never change
 *
 * Restoring = putting one snapshot back as data/papote.db and the media it references back in data/media.
 */
export function createBackups({ db, dataDir, backupDir, everyHours = 24, keep = 14, logger = console, onEvent = () => {} }) {
  // keep = NaN would make slice() drop every snapshot, the new one included.
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`Nombre de sauvegardes à garder invalide : ${keep}`);
  if (!Number.isFinite(everyHours) || everyHours < 0) throw new Error(`Intervalle de sauvegarde invalide : ${everyHours}`);
  const dir = backupDir || path.join(dataDir, 'backups');
  const mediaDir = path.join(dataDir, 'media');
  const backupMedia = path.join(dir, 'media');
  let timer = null;
  let running = false;

  function list() {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return []; // missing or unusable folder: the dashboard says so instead of failing
    }
    return names
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, at: st.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
  }

  const last = () => list()[0] ?? null;

  function snapshotMedia(file) {
    const snap = new DatabaseSync(file, { readOnly: true });
    try {
      return snap.prepare('SELECT file FROM media').all().map((r) => r.file);
    } finally {
      snap.close();
    }
  }

  function prune() {
    const snapshots = list();
    for (const old of snapshots.slice(keep)) fs.rmSync(path.join(dir, old.name), { force: true });
    if (!fs.existsSync(backupMedia)) return;
    // Media still needed: by a kept snapshot, or live (it will be in the next one).
    const needed = new Set(fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []);
    for (const s of snapshots.slice(0, keep)) for (const f of snapshotMedia(path.join(dir, s.name))) needed.add(f);
    for (const f of fs.readdirSync(backupMedia)) if (!needed.has(f)) fs.rmSync(path.join(backupMedia, f), { force: true });
  }

  /** One snapshot + media copy + rotation. Synchronous: SQLite blocks for the copy anyway. */
  function run(trigger = 'manuel') {
    if (running) throw new Error('Une sauvegarde est déjà en cours');
    running = true;
    const started = Date.now();
    try {
      fs.mkdirSync(backupMedia, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
      const name = `${PREFIX}${stamp}${SUFFIX}`;
      const final = path.join(dir, name);
      const part = `${final}.part`;
      fs.rmSync(part, { force: true });
      db.prepare(`VACUUM INTO '${part.replace(/'/g, "''")}'`).run();
      // Never keep a snapshot that doesn't read back cleanly.
      const check = new DatabaseSync(part, { readOnly: true });
      const ok = check.prepare('PRAGMA quick_check').get();
      check.close();
      if (Object.values(ok)[0] !== 'ok') throw new Error(`instantané invalide (${Object.values(ok)[0]})`);
      fs.renameSync(part, final);

      let copied = 0;
      for (const f of fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []) {
        const target = path.join(backupMedia, f);
        if (fs.existsSync(target)) continue;
        fs.copyFileSync(path.join(mediaDir, f), `${target}.part`);
        fs.renameSync(`${target}.part`, target);
        copied++;
      }
      prune();
      const result = { name, size: fs.statSync(final).size, mediaCopied: copied, ms: Date.now() - started, trigger };
      onEvent('backup', `${trigger} · ${name} · ${copied} média(s) copié(s)`);
      return result;
    } catch (err) {
      onEvent('backup_failed', `${trigger} · ${err.message}`);
      throw err;
    } finally {
      running = false;
    }
  }

  /** Runs an automatic backup when the newest one is older than the interval (also right after a restart). */
  function tick() {
    if (!everyHours || running) return null;
    const newest = last();
    if (newest && Date.now() - newest.at < everyHours * 3600 * 1000) return null;
    try {
      return run('auto');
    } catch (err) {
      logger.error?.(`Sauvegarde automatique impossible : ${err.message}`);
      return null;
    }
  }

  function start() {
    if (!everyHours) return;
    timer = setTimeout(function loop() {
      tick();
      timer = setTimeout(loop, CHECK_EVERY_MS);
      timer.unref();
    }, FIRST_CHECK_MS);
    timer.unref();
  }

  const stop = () => clearTimeout(timer);

  return { dir, everyHours, keep, list, last, run, tick, start, stop, nextAt: () => (everyHours ? (last()?.at ?? Date.now()) + everyHours * 3600 * 1000 : null) };
}

/** Puts a snapshot back. The server must be stopped: the live database is replaced. */
export function restoreBackup({ dataDir, backupDir, name }) {
  const dir = backupDir || path.join(dataDir, 'backups');
  if (!/^papote-[\w-]+\.db$/.test(name)) throw new Error('Nom de sauvegarde invalide');
  const source = path.join(dir, name);
  if (!fs.existsSync(source)) throw new Error(`Sauvegarde introuvable : ${source}`);
  const live = path.join(dataDir, 'papote.db');
  const keepAside = `${live}.avant-restauration-${Date.now()}`;
  if (fs.existsSync(live)) fs.renameSync(live, keepAside);
  for (const ext of ['-wal', '-shm']) fs.rmSync(live + ext, { force: true });
  fs.copyFileSync(source, live);

  const snap = new DatabaseSync(live, { readOnly: true });
  const files = snap.prepare('SELECT file FROM media').all().map((r) => r.file);
  snap.close();
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  let restored = 0;
  let missing = 0;
  for (const f of files) {
    const target = path.join(dataDir, 'media', f);
    if (fs.existsSync(target)) continue;
    const from = path.join(dir, 'media', f);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, target);
      restored++;
    } else missing++;
  }
  return { previous: fs.existsSync(keepAside) ? keepAside : null, restored, missing };
}
