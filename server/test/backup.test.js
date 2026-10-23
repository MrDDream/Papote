import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../src/app.js';
import { restoreBackup } from '../src/backup.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PASSWORD = 'correct-horse-battery';
const quiet = { error: () => {}, debug: () => {} };
let ctx;

function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papote-bk-'));
  const papote = createServer({ dataDir: dir, adminPassword: PASSWORD, logger: quiet, ...opts });
  ctx = { papote, dir, agent: request(papote.app) };
  return ctx;
}

afterEach(() => ctx?.papote.close());

async function withContent() {
  const { papote, agent } = ctx;
  const lou = (await agent.post('/api/join').send({ code: papote.bootstrapCode(), name: 'Lou' })).body;
  const auth = { Authorization: `Bearer ${lou.token}` };
  const group = (await agent.post('/api/groups').set(auth).send({ name: 'Les copines' })).body;
  const up = async () =>
    (await agent.post(`/api/groups/${group.id}/media`).set(auth).field('type', 'drawing').attach('file', PNG, { filename: 'd.png', contentType: 'image/png' })).body;
  return { lou, auth, group, up };
}

const snapshots = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.db'));

describe('backups', () => {
  it('writes a checked snapshot and copies each media file once', async () => {
    const { papote } = start();
    const { up } = await withContent();
    await up();
    const first = papote.backups.run();
    expect(first.mediaCopied).toBe(1);
    const snap = new DatabaseSync(path.join(papote.backups.dir, first.name), { readOnly: true });
    expect(snap.prepare('SELECT name FROM groups').get().name).toBe('Les copines');
    snap.close();

    await up();
    expect(papote.backups.run().mediaCopied).toBe(1);
    expect(fs.readdirSync(path.join(papote.backups.dir, 'media'))).toHaveLength(2);
  });

  it('keeps the newest snapshots and drops media nothing refers to any more', async () => {
    const { papote, agent } = start({ backupKeep: 2 });
    const { auth, up } = await withContent();
    const m = await up();
    papote.backups.run();
    await agent.delete(`/api/messages/${m.id}`).set(auth);
    papote.backups.run();
    expect(fs.readdirSync(path.join(papote.backups.dir, 'media'))).toHaveLength(1);
    papote.backups.run();
    expect(snapshots(papote.backups.dir)).toHaveLength(2);
    // The two kept snapshots were taken after the deletion: the drawing is gone from the backup too.
    expect(fs.readdirSync(path.join(papote.backups.dir, 'media'))).toHaveLength(0);
  });

  it('refuses a keep count that would delete every snapshot', () => {
    expect(() => start({ backupKeep: Number('quatorze') })).toThrow(/garder invalide/);
    ctx = start();
  });

  it('runs on its own when the last backup is older than the interval', () => {
    const { papote } = start({ backupEveryHours: 24 });
    expect(papote.backups.tick()).toMatchObject({ trigger: 'auto' });
    expect(papote.backups.tick()).toBeNull();
    const off = start({ backupEveryHours: 0 });
    expect(off.papote.backups.tick()).toBeNull();
  });

  it('can write to a separate folder and restores the base and its media', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'papote-bk-dest-'));
    const { papote, dir, agent } = start({ backupDir: elsewhere });
    const { group, auth, up } = await withContent();
    const m = await up();
    const { name } = papote.backups.run();
    expect(snapshots(elsewhere)).toEqual([name]);

    // Gone for good (deleting from the app only moves it to the trash).
    for (const f of papote.store.deleteGroup(group.id).files) fs.rmSync(path.join(dir, 'media', f), { force: true });
    papote.close();
    expect(fs.readdirSync(path.join(dir, 'media'))).toHaveLength(0);

    const r = restoreBackup({ dataDir: dir, backupDir: elsewhere, name });
    expect(r).toMatchObject({ restored: 1, missing: 0 });
    expect(fs.existsSync(r.previous)).toBe(true);
    ctx = { papote: createServer({ dataDir: dir, logger: quiet }) };
    const msgs = ctx.papote.store.listMessages(group.id, { limit: 10 });
    expect(msgs.find((x) => x.id === m.id).media.id).toBe(m.media.id);
    expect(() => restoreBackup({ dataDir: dir, backupDir: elsewhere, name: '../papote.db' })).toThrow(/invalide/);
  });

  it('records failures in the journal and shows them on the dashboard', async () => {
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'papote-bk-')), 'not-a-folder');
    fs.writeFileSync(blocker, 'x');
    const { papote, agent } = start({ backupDir: blocker });
    expect(() => papote.backups.run('auto')).toThrow();
    expect(papote.store.q("SELECT kind, detail FROM admin_events WHERE kind = 'backup_failed'").get().detail).toMatch(/^auto · /);
    const login = await agent.post('/admin/login').type('form').send({ password: PASSWORD });
    const page = await agent.get('/admin').set('Cookie', login.headers['set-cookie'][0].split(';')[0]);
    expect(page.text).toContain('Dernière sauvegarde en échec');
  });
});

describe('admin and group content', () => {
  it('only makes server-access codes and hides the codes members made for their groups', async () => {
    const { papote, agent } = start();
    const { group, auth } = await withContent();
    const memberCode = (await agent.post(`/api/groups/${group.id}/invites`).set(auth).send({})).body.code;

    const login = await agent.post('/admin/login').type('form').send({ password: PASSWORD });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const page = await agent.get('/admin/codes').set('Cookie', cookie);
    expect(page.text).not.toContain('name="groupId"');
    expect(page.text).not.toContain(memberCode);
    expect(page.text).toContain(memberCode.slice(0, 3));

    await agent.post('/admin/codes').set('Cookie', cookie).type('form').send({ groupId: String(group.id), expiresIn: '1h' });
    const made = papote.store.q('SELECT * FROM invites WHERE by_admin = 1').all();
    expect(made.every((i) => i.group_id === null)).toBe(true);
  });
});
