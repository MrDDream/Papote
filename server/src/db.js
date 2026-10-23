import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  birthday TEXT,
  color TEXT NOT NULL DEFAULT 'rose',
  photo_media_id TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'rose',
  icon TEXT NOT NULL DEFAULT 'heart',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  file TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  meta TEXT,
  reply_to INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_group ON messages(group_id, id);

-- Admin web: server-side sessions (so logout and password changes really sign out), settings (2FA), journal.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  password_fp TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ip TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS admin_events_at ON admin_events(at);

-- Web Push (web app / PWA): one row per browser, tied to its session so a sign-out removes it.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL REFERENCES tokens(hash) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id);

-- Polls: one row per vote (several when the poll allows several answers).
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, option)
);

-- Stories: a photo or a drawing shown at the top of the group for 24 h.
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  caption TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stories_group ON stories(group_id, expires_at);

CREATE TABLE IF NOT EXISTS story_views (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, user_id)
);

-- Stickers of a group (made from a drawing or a photo) and each person's favourite GIFs/stickers.
CREATE TABLE IF NOT EXISTS stickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
);

-- Mini-games played in a group (state is the game's own JSON, checked by the server).
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'playing',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_group ON games(group_id, status);

CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, kind)
);
`;

export function openDb(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'papote.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  // Search ignores case and accents: "CINÉ" finds "ciné".
  db.function('papote_fold', { deterministic: true }, (s) => (s == null ? null : foldText(String(s))));
  return db;
}

// Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them to an existing base.
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(tokens)').all().map((c) => c.name);
  if (!cols.includes('label')) db.exec('ALTER TABLE tokens ADD COLUMN label TEXT');
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('personal_code')) db.exec('ALTER TABLE users ADD COLUMN personal_code TEXT');
  const groupCols = db.prepare('PRAGMA table_info(groups)').all().map((c) => c.name);
  if (!groupCols.includes('photo_media_id')) db.exec('ALTER TABLE groups ADD COLUMN photo_media_id TEXT');
  // 1 = a two-person conversation started from "Nouvelle discussion" (no name, no invitations).
  if (!groupCols.includes('direct')) db.exec('ALTER TABLE groups ADD COLUMN direct INTEGER NOT NULL DEFAULT 0');
  for (const col of ['totp_secret', 'totp_pending', 'recovery_codes']) {
    if (!userCols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
  }
  if (!userCols.includes('totp_last_step')) db.exec('ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT -1');
  if (!userCols.includes('mood')) db.exec('ALTER TABLE users ADD COLUMN mood TEXT');
  // JSON: chat pattern, the group's quick reactions, birthdays, rules (approval, admins-only theme).
  if (!groupCols.includes('settings')) db.exec("ALTER TABLE groups ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
  // Corbeille: a deleted group stays 30 days (the admin can restore it), then is purged for good.
  if (!groupCols.includes('deleted_at')) db.exec('ALTER TABLE groups ADD COLUMN deleted_at INTEGER');
  if (!groupCols.includes('deleted_by')) db.exec('ALTER TABLE groups ADD COLUMN deleted_by TEXT');
  const memberCols = db.prepare('PRAGMA table_info(members)').all().map((c) => c.name);
  // 'pending': asked to join a group that approves new members; not a member yet.
  if (!memberCols.includes('status')) db.exec("ALTER TABLE members ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  if (!memberCols.includes('muted_until')) db.exec('ALTER TABLE members ADD COLUMN muted_until INTEGER');
  const messageCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!messageCols.includes('pinned_at')) db.exec('ALTER TABLE messages ADD COLUMN pinned_at INTEGER');
  if (!messageCols.includes('pinned_by')) db.exec('ALTER TABLE messages ADD COLUMN pinned_by INTEGER');
  // Ephemeral photos ("Disparaît en 24 h"): removed by the cleaner once past.
  if (!messageCols.includes('expires_at')) db.exec('ALTER TABLE messages ADD COLUMN expires_at INTEGER');
  const inviteCols = db.prepare('PRAGMA table_info(invites)').all().map((c) => c.name);
  if (!inviteCols.includes('by_admin')) db.exec('ALTER TABLE invites ADD COLUMN by_admin INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_personal_code ON users(personal_code)');
  // Replaced by the permanent personal code.
  db.exec('DROP TABLE IF EXISTS device_links');
}

export const foldText = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Runs fn inside a transaction; node:sqlite has no helper for it.
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
