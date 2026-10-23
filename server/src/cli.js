// Maintenance commands, run inside the container:
//   docker exec papote node src/cli.js admin-reset-2fa
//   docker exec papote node src/cli.js admin-logout-all
//   docker exec papote node src/cli.js backup
//   docker exec papote node src/cli.js list-backups
//   docker compose stop papote && docker compose run --rm papote node src/cli.js restore papote-2026-10-23T03-00-00.db
import { openDb } from './db.js';
import { createBackups, restoreBackup } from './backup.js';

// `docker exec` runs as root: switch to the server's user so the files we write stay usable by it.
if (process.getuid?.() === 0) {
  try {
    process.setgid('node');
    process.setuid('node');
  } catch {
    /* no "node" user outside the container: keep going as is */
  }
}

const dataDir = process.env.DATA_DIR ?? './data';
const backupDir = process.env.BACKUP_DIR || null;
const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 14));

const COMMANDS = {
  'admin-reset-2fa': (db) => {
    db.prepare("DELETE FROM admin_settings WHERE key IN ('totp_secret', 'totp_pending', 'totp_last_step', 'recovery_codes')").run();
    db.prepare('DELETE FROM admin_sessions').run();
    db.prepare("INSERT INTO admin_events (at, kind, detail) VALUES (?, '2fa_disabled', 'réinitialisée en ligne de commande')").run(Date.now());
    return 'Double authentification de l’admin désactivée et sessions fermées. Reconnecte-toi avec le mot de passe puis réactive-la.';
  },
  'admin-logout-all': (db) => {
    const n = db.prepare('DELETE FROM admin_sessions').run().changes;
    return `${n} session(s) admin fermée(s).`;
  },
  backup: (db) => {
    const event = (kind, detail) => db.prepare('INSERT INTO admin_events (at, kind, detail) VALUES (?, ?, ?)').run(Date.now(), kind, detail);
    const r = createBackups({ db, dataDir, backupDir, keep, onEvent: event }).run('ligne de commande');
    return `Sauvegarde ${r.name} écrite (${r.size} octets, ${r.mediaCopied} média(s) copié(s)).`;
  },
  'list-backups': (db) => {
    const list = createBackups({ db, dataDir, backupDir, keep }).list();
    return list.length ? list.map((b) => `${b.name}  ${(b.size / 1024).toFixed(0)} Ko  ${new Date(b.at).toLocaleString('fr-FR')}`).join('\n') : 'Aucune sauvegarde.';
  },
  // Needs the server stopped: the live database is replaced (the previous one is kept aside).
  restore: null,
};

const cmd = process.argv[2];
if (!(cmd in COMMANDS)) {
  console.error(`Commandes : ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}
if (cmd === 'restore') {
  const name = process.argv[3];
  if (!name) {
    console.error('Usage : restore <papote-….db>   (voir list-backups ; arrête le serveur avant)');
    process.exit(1);
  }
  const r = restoreBackup({ dataDir, backupDir, name });
  console.log(`Base restaurée depuis ${name}. ${r.restored} média(s) remis, ${r.missing} introuvable(s).`);
  if (r.previous) console.log(`L’ancienne base est gardée de côté : ${r.previous}`);
} else {
  const db = openDb(dataDir);
  console.log(COMMANDS[cmd](db));
  db.close();
}
