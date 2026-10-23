import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';
import { base32Decode, currentStep, hotp } from '../src/admin/totp.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PASSWORD = 'correct-horse-battery';
let papote;
let agent;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  papote = createServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'papote-f-')), adminPassword: PASSWORD, logger: { error() {} } });
  agent = request(papote.app);
});
afterEach(() => papote.close());

async function people() {
  const code = papote.bootstrapCode();
  const lou = (await agent.post('/api/join').send({ code, name: 'Lou' })).body;
  const ines = (await agent.post('/api/join').send({ code, name: 'Inès' })).body;
  const hugo = (await agent.post('/api/join').send({ code, name: 'Hugo' })).body;
  const g = (await agent.post('/api/groups').set(auth(lou.token)).send({ name: 'Les copines', icon: 'paw' })).body;
  const inv = (await agent.post(`/api/groups/${g.id}/invites`).set(auth(lou.token)).send({})).body;
  await agent.post('/api/join').set(auth(ines.token)).send({ code: inv.code });
  return { lou, ines, hugo, g };
}

describe('server access code', () => {
  it('is the bootstrap code, stays until regenerated, and the old one stops working', async () => {
    const first = papote.bootstrapCode();
    expect(papote.store.serverCode().code).toBe(first);
    await agent.post('/api/join').send({ code: first, name: 'Lou' });
    await agent.post('/api/join').send({ code: first, name: 'Inès' });
    const fresh = papote.store.regenerateServerCode().code;
    expect((await agent.post('/api/join').send({ code: first, name: 'Jade' })).body.error).toBe('invalid_code');
    expect((await agent.post('/api/join').send({ code: fresh, name: 'Jade' })).status).toBe(201);
    papote.store.disableServerCode();
    expect(papote.store.serverCode()).toBeNull();
  });

  it('shows on the admin dashboard with regenerate', async () => {
    const code = papote.bootstrapCode();
    const login = await agent.post('/admin/login').type('form').send({ password: PASSWORD });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    expect((await agent.get('/admin').set('Cookie', cookie)).text).toContain(code);
    await agent.post('/admin/server-code/regenerate').set('Cookie', cookie);
    const page = (await agent.get('/admin').set('Cookie', cookie)).text;
    expect(page).not.toContain(code);
    expect(page).toContain(papote.store.serverCode().code);
  });
});

describe('direct conversations', () => {
  it('only with people from your groups, one per pair, shown as the other person', async () => {
    const { lou, ines, hugo } = await people();
    const contacts = (await agent.get('/api/contacts').set(auth(lou.token))).body;
    expect(contacts.map((c) => c.name)).toEqual(['Inès']);
    expect((await agent.post('/api/direct').set(auth(lou.token)).send({ userId: hugo.user.id })).status).toBe(404);

    const d = await agent.post('/api/direct').set(auth(lou.token)).send({ userId: ines.user.id });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ direct: true, name: 'Inès', peer: { id: ines.user.id } });
    expect((await agent.post('/api/direct').set(auth(ines.token)).send({ userId: lou.user.id })).body.id).toBe(d.body.id);

    const fromInes = (await agent.get('/api/groups').set(auth(ines.token))).body.find((g) => g.direct);
    expect(fromInes.name).toBe('Lou');
    expect((await agent.post(`/api/groups/${d.body.id}/invites`).set(auth(lou.token)).send({})).status).toBe(403);
    expect((await agent.patch(`/api/groups/${d.body.id}`).set(auth(lou.token)).send({ name: 'x' })).status).toBe(403);
  });

  it('carries group and author names on new messages for notifications', async () => {
    const { lou, ines, g } = await people();
    await new Promise((r) => papote.server.listen(0, '127.0.0.1', r));
    const events = [];
    const ws = new WebSocket(`ws://127.0.0.1:${papote.server.address().port}/ws`, { headers: auth(ines.token) });
    ws.on('message', (m) => events.push(JSON.parse(m.toString())));
    await new Promise((r) => ws.on('open', r));
    await request(papote.server).post(`/api/groups/${g.id}/messages`).set(auth(lou.token)).send({ text: 'coucou' });
    await new Promise((r) => setTimeout(r, 100));
    expect(events.find((e) => e.type === 'message.new' && e.message.text === 'coucou')).toMatchObject({ groupName: 'Les copines', authorName: 'Lou', direct: false });
    ws.close();
  });
});

describe('group picture', () => {
  it('can be set by members unless admins keep the theme, and is served to members only', async () => {
    const { lou, ines, hugo, g } = await people();
    await agent.patch(`/api/groups/${g.id}/settings`).set(auth(lou.token)).send({ adminsTheme: true });
    expect((await agent.put(`/api/groups/${g.id}/photo`).set(auth(ines.token)).attach('file', PNG, 'g.png')).status).toBe(403);
    const set = await agent.put(`/api/groups/${g.id}/photo`).set(auth(lou.token)).attach('file', PNG, 'g.png');
    expect(set.body.photo).toMatch(/^\/api\/media\//);
    expect(set.body.icon).toBe('paw');
    expect((await agent.get(set.body.photo).set(auth(ines.token))).status).toBe(200);
    expect((await agent.get(set.body.photo).set(auth(hugo.token))).status).toBe(404);
    expect((await agent.delete(`/api/groups/${g.id}/photo`).set(auth(lou.token))).body.photo).toBeNull();
  });
});

describe('account 2FA', () => {
  it('asks for the app code when the personal code opens the account elsewhere', async () => {
    const { lou } = await people();
    const start = (await agent.post('/api/me/2fa/start').set(auth(lou.token))).body;
    expect(start.qrSvg).toContain('<svg');
    const key = base32Decode(start.secret);
    const conf = await agent.post('/api/me/2fa/confirm').set(auth(lou.token)).send({ code: hotp(key, currentStep()) });
    expect(conf.body.recoveryCodes).toHaveLength(10);
    expect((await agent.get('/api/me').set(auth(lou.token))).body.totp).toBe(true);

    const { code } = (await agent.get('/api/me/code').set(auth(lou.token))).body;
    expect((await agent.post('/api/link').send({ code })).body.error).toBe('totp_required');
    expect((await agent.post('/api/link').send({ code, totp: '000000' })).body.error).toBe('totp_invalid');
    expect((await agent.post('/api/link').send({ code, totp: hotp(key, currentStep() + 1) })).status).toBe(201);
    expect((await agent.post('/api/link').send({ code, totp: conf.body.recoveryCodes[0] })).status).toBe(201);
    expect((await agent.post('/api/link').send({ code, totp: conf.body.recoveryCodes[0] })).body.error).toBe('totp_invalid');

    expect((await agent.post('/api/me/2fa/disable').set(auth(lou.token)).send({ code: conf.body.recoveryCodes[1] })).status).toBe(204);
    expect((await agent.post('/api/link').send({ code })).status).toBe(201);
  });
});
