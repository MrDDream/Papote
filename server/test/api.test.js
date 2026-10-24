import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const quiet = { error: () => {}, debug: () => {} };

let dir;
let papote;
let agent;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papote-'));
  papote = createServer({ dataDir: dir, adminPassword: 'correct-horse-battery', logger: quiet });
  agent = request(papote.app);
});

afterEach(() => {
  papote.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function join(code, name = 'Lou') {
  const res = await agent.post('/api/join').send({ code, name, color: 'menthe' });
  expect(res.status).toBe(201);
  return res.body;
}

// First user via the bootstrap code, plus a group they own.
async function setup() {
  const lou = await join(papote.bootstrapCode(), 'Lou');
  const g = await agent.post('/api/groups').set(auth(lou.token)).send({ name: 'Les copines', color: 'rose', icon: 'heart' });
  expect(g.status).toBe(201);
  return { lou, group: g.body };
}

async function inviteAndJoin(token, groupId, name, opts = {}) {
  const inv = await agent.post(`/api/groups/${groupId}/invites`).set(auth(token)).send(opts);
  expect(inv.status).toBe(201);
  return { invite: inv.body, member: await join(inv.body.code.toLowerCase().replace('-', ''), name) };
}

describe('join', () => {
  it('rejects unknown codes and missing names', async () => {
    expect((await agent.post('/api/join').send({ code: 'AAA-AAA', name: 'x' })).status).toBe(404);
    expect((await agent.post('/api/join').send({ code: 'AB', name: 'x' })).status).toBe(400);
    expect((await agent.post('/api/join').send({ code: papote.bootstrapCode() })).body.error).toBe('name_required');
  });

  it('creates an account from the bootstrap code and stops offering one afterwards', async () => {
    const code = papote.bootstrapCode();
    expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const lou = await join(code);
    expect(lou.token).toBeTruthy();
    expect(lou.user).toMatchObject({ name: 'Lou', color: 'menthe' });
    expect(lou.groupId).toBeNull();
    expect(papote.bootstrapCode()).toBeNull();
    expect((await agent.get('/api/me').set(auth(lou.token))).body.name).toBe('Lou');
  });

  it('honours single-use and lets a logged-in user join another group with the same token', async () => {
    const { lou, group } = await setup();
    const { invite, member } = await inviteAndJoin(lou.token, group.id, 'Inès', { singleUse: true, expiresIn: '1h' });
    expect(member.groupId).toBe(group.id);
    expect((await agent.post('/api/join').send({ code: invite.code, name: 'Jade' })).body.error).toBe('code_used');

    const g2 = await agent.post('/api/groups').set(auth(lou.token)).send({ name: 'Famille' });
    const inv2 = await agent.post(`/api/groups/${g2.body.id}/invites`).set(auth(lou.token)).send({});
    const again = await agent.post('/api/join').set(auth(member.token)).send({ code: inv2.body.code });
    expect(again.status).toBe(200);
    expect(again.body.token).toBeNull();
    const groups = await agent.get('/api/groups').set(auth(member.token));
    expect(groups.body.map((g) => g.name).sort()).toEqual(['Famille', 'Les copines']);
  });
});

describe('groups and messages', () => {
  it('lists groups with unread counts and the last message', async () => {
    const { lou, group } = await setup();
    const { member: ines } = await inviteAndJoin(lou.token, group.id, 'Inès');
    await agent.post(`/api/groups/${group.id}/messages`).set(auth(ines.token)).send({ text: 'Ciné samedi ?' });
    const list = (await agent.get('/api/groups').set(auth(lou.token))).body;
    expect(list[0]).toMatchObject({ name: 'Les copines', role: 'owner', memberCount: 2, unread: 1 });
    expect(list[0].lastMessage.text).toBe('Ciné samedi ?');
    expect(list[0].lastAuthorName).toBe('Inès');

    const msgs = (await agent.get(`/api/groups/${group.id}/messages`).set(auth(lou.token))).body;
    expect(msgs.map((m) => m.type)).toEqual(['system', 'system', 'text']);
    await agent.post(`/api/groups/${group.id}/read`).set(auth(lou.token)).send({ messageId: msgs.at(-1).id });
    expect((await agent.get('/api/groups').set(auth(lou.token))).body[0].unread).toBe(0);
  });

  it('keeps outsiders out of a group and its media', async () => {
    const { lou, group } = await setup();
    const stranger = await join(papote.store.createInvite({}).code, 'Hugo');
    expect((await agent.get(`/api/groups/${group.id}/messages`).set(auth(stranger.token))).status).toBe(404);
    const up = await agent
      .post(`/api/groups/${group.id}/media`)
      .set(auth(lou.token))
      .field('type', 'drawing')
      .attach('file', PNG, { filename: 'd.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect((await agent.get(up.body.media.url).set(auth(stranger.token))).status).toBe(404);
    const ok = await agent.get(up.body.media.url).set(auth(lou.token));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
  });

  it('rejects files that are not what they claim', async () => {
    const { lou, group } = await setup();
    const res = await agent
      .post(`/api/groups/${group.id}/media`)
      .set(auth(lou.token))
      .field('type', 'photo')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
    expect(fs.readdirSync(path.join(dir, 'media'))).toEqual([]);
  });

  it('stores voice metadata and toggles reactions', async () => {
    const { lou, group } = await setup();
    const voice = await agent
      .post(`/api/groups/${group.id}/media`)
      .set(auth(lou.token))
      .field('type', 'voice')
      .field('durationMs', '14000')
      .field('waveform', JSON.stringify([10, 50, 120, -3]))
      .attach('file', Buffer.from('fake-aac'), { filename: 'v.m4a', contentType: 'audio/mp4' });
    expect(voice.status).toBe(201);
    expect(voice.body.meta).toEqual({ durationMs: 14000, waveform: [10, 50, 100, 0] });

    const r = await agent.put(`/api/messages/${voice.body.id}/reactions/heart`).set(auth(lou.token));
    expect(r.body.reactions).toEqual({ heart: [lou.user.id] });
    expect((await agent.put(`/api/messages/${voice.body.id}/reactions/poop`).set(auth(lou.token))).status).toBe(400);
    const d = await agent.delete(`/api/messages/${voice.body.id}/reactions/heart`).set(auth(lou.token));
    expect(d.body.reactions).toEqual({});
  });

  it('lets authors delete their messages but not other people’s', async () => {
    const { lou, group } = await setup();
    const { member: ines } = await inviteAndJoin(lou.token, group.id, 'Inès');
    const m = await agent.post(`/api/groups/${group.id}/messages`).set(auth(lou.token)).send({ text: 'oups' });
    expect((await agent.delete(`/api/messages/${m.body.id}`).set(auth(ines.token))).status).toBe(403);
    expect((await agent.delete(`/api/messages/${m.body.id}`).set(auth(lou.token))).status).toBe(204);
    const msgs = (await agent.get(`/api/groups/${group.id}/messages`).set(auth(lou.token))).body;
    expect(msgs.find((x) => x.id === m.body.id)).toMatchObject({ deleted: true, text: '' });
  });
});

describe('members', () => {
  it('passes ownership on when the owner leaves and deletes empty groups', async () => {
    const { lou, group } = await setup();
    const { member: ines } = await inviteAndJoin(lou.token, group.id, 'Inès');
    expect((await agent.post(`/api/groups/${group.id}/leave`).set(auth(lou.token))).status).toBe(204);
    const members = (await agent.get(`/api/groups/${group.id}/members`).set(auth(ines.token))).body;
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ name: 'Inès', role: 'owner' });
    await agent.post(`/api/groups/${group.id}/leave`).set(auth(ines.token));
    expect(papote.store.q('SELECT COUNT(*) n FROM groups').get().n).toBe(0);
  });

  it('only lets the owner change roles and admins remove members', async () => {
    const { lou, group } = await setup();
    const { member: ines } = await inviteAndJoin(lou.token, group.id, 'Inès');
    const { member: jade } = await inviteAndJoin(lou.token, group.id, 'Jade');
    expect((await agent.patch(`/api/groups/${group.id}/members/${jade.user.id}`).set(auth(ines.token)).send({ role: 'admin' })).status).toBe(403);
    expect((await agent.delete(`/api/groups/${group.id}/members/${jade.user.id}`).set(auth(ines.token))).status).toBe(403);
    expect((await agent.patch(`/api/groups/${group.id}/members/${ines.user.id}`).set(auth(lou.token)).send({ role: 'admin' })).status).toBe(204);
    expect((await agent.delete(`/api/groups/${group.id}/members/${lou.user.id}`).set(auth(ines.token))).status).toBe(403);
    expect((await agent.delete(`/api/groups/${group.id}/members/${jade.user.id}`).set(auth(ines.token))).status).toBe(204);
    expect((await agent.get('/api/groups').set(auth(jade.token))).body).toEqual([]);
  });
});

describe('realtime', () => {
  it('pushes new messages and typing to other members', async () => {
    const { lou, group } = await setup();
    const { member: ines } = await inviteAndJoin(lou.token, group.id, 'Inès');
    await new Promise((r) => papote.server.listen(0, '127.0.0.1', r));
    const { port } = papote.server.address();

    const events = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: auth(ines.token) });
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));

    const louWs = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${lou.token}`);
    await new Promise((r) => louWs.on('open', r));
    louWs.send(JSON.stringify({ type: 'typing', groupId: group.id, kind: 'draw' }));
    await request(papote.server).post(`/api/groups/${group.id}/messages`).set(auth(lou.token)).send({ text: 'coucou' });
    await new Promise((r) => setTimeout(r, 100));

    expect(events.map((e) => e.type)).toEqual(['hello', 'presence', 'typing', 'message.new']);
    expect(events[2]).toMatchObject({ groupId: group.id, userId: lou.user.id, kind: 'draw' });
    expect(events[3].message.text).toBe('coucou');

    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws?token=nope`);
    await new Promise((r) => bad.on('error', r));
    ws.close();
    louWs.close();
  });
});

describe('emoji', () => {
  it('stores emoji text and accepts any single emoji as a reaction', async () => {
    const { lou, group } = await setup();
    const m = await agent.post(`/api/groups/${group.id}/messages`).set(auth(lou.token)).send({ text: 'On y va 🎉🍿' });
    expect(m.body.text).toBe('On y va 🎉🍿');
    const react = (k) => agent.put(`/api/messages/${m.body.id}/reactions/${encodeURIComponent(k)}`).set(auth(lou.token));
    for (const ok of ['🎉', '👍🏽', '👩‍👩‍👧', '🇫🇷', '❤️', 'popcorn']) expect((await react(ok)).status, ok).toBe(200);
    for (const bad of ['a', '🎉🎉', 'poop', '<b>', '🎉 ']) expect((await react(bad)).status, bad).toBe(400);
    const r = await react('🎉');
    expect(Object.keys(r.body.reactions)).toEqual(['🎉', '👍🏽', '👩‍👩‍👧', '🇫🇷', '❤️', 'popcorn']);
  });
});

describe('web session', () => {
  it('logs the browser in with an HttpOnly cookie, never exposing the token', async () => {
    const res = await agent.post('/api/join').set('X-Papote-Client', 'web').send({ code: papote.bootstrapCode(), name: 'Jade' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeNull();
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/papote_session=.+; Path=\/; HttpOnly; SameSite=Strict/);
    const session = cookie.split(';')[0];
    expect((await agent.get('/api/me').set('Cookie', session)).body.name).toBe('Jade');
    const g = await agent.post('/api/groups').set('Cookie', session).send({ name: 'Web' });
    expect(g.status).toBe(201);
    expect(
      (await agent.post('/api/groups').set('Cookie', session).set('Sec-Fetch-Site', 'cross-site').send({ name: 'x' })).status,
    ).toBe(403);
    await agent.post('/api/logout').set('Cookie', session);
    expect((await agent.get('/api/me').set('Cookie', session)).status).toBe(401);
  });

  it('only accepts the cookie on a WebSocket from the same origin', async () => {
    const res = await agent.post('/api/join').set('X-Papote-Client', 'web').send({ code: papote.bootstrapCode(), name: 'Jade' });
    const session = res.headers['set-cookie'][0].split(';')[0];
    await new Promise((r) => papote.server.listen(0, '127.0.0.1', r));
    const { port } = papote.server.address();
    const open = (origin) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: session }, origin });
        ws.on('open', () => {
          ws.close();
          resolve('open');
        });
        ws.on('error', () => resolve('refused'));
      });
    expect(await open(`http://127.0.0.1:${port}`)).toBe('open');
    expect(await open('https://evil.example')).toBe('refused');
  });

  it('serves the web app with a strict CSP', async () => {
    const res = await agent.get('/web/');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect((await agent.get('/')).headers.location).toBe('/web/');
  });
});

describe('personal code', () => {
  it('signs another device into the same account, until the code is regenerated', async () => {
    const { lou, group } = await setup();
    const { code } = (await agent.get('/api/me/code').set(auth(lou.token))).body;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await agent.get('/api/me/code').set(auth(lou.token))).body.code).toBe(code);

    const web = await agent
      .post('/api/link')
      .set('X-Papote-Client', 'web')
      .set('X-Papote-Device', encodeURIComponent('Firefox sur Linux · élan'))
      .send({ code: code.toLowerCase().replace('-', ' ') });
    expect(web.status).toBe(201);
    expect(web.body).toMatchObject({ token: null, user: { id: lou.user.id } });
    const cookie = web.headers['set-cookie'][0].split(';')[0];
    expect((await agent.get('/api/groups').set('Cookie', cookie)).body.map((g) => g.id)).toEqual([group.id]);

    // Reusable, unlike an invitation.
    expect((await agent.post('/api/link').send({ code })).status).toBe(201);

    const devices = (await agent.get('/api/me/devices').set('Cookie', cookie)).body;
    expect(devices).toHaveLength(3);
    expect(devices.find((d) => d.current)).toMatchObject({ label: 'Firefox sur Linux · élan' });
    const other = devices.find((d) => !d.current && d.label === 'Appareil');
    expect((await agent.delete(`/api/me/devices/${other.id}`).set('Cookie', cookie)).status).toBe(204);

    const fresh = (await agent.post('/api/me/code').set(auth(lou.token))).body.code;
    expect(fresh).not.toBe(code);
    expect((await agent.post('/api/link').send({ code })).body.error).toBe('invalid_personal_code');
    expect((await agent.post('/api/link').send({ code: fresh })).status).toBe(201);
    // Devices already signed in stay signed in.
    expect((await agent.get('/api/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('only lets people see and revoke their own devices', async () => {
    const { lou } = await setup();
    const hugo = await join(papote.store.createInvite({}).code, 'Hugo');
    const louDevice = (await agent.get('/api/me/devices').set(auth(lou.token))).body[0];
    expect((await agent.get('/api/me/devices').set(auth(hugo.token))).body.map((d) => d.id)).not.toContain(louDevice.id);
    expect((await agent.delete(`/api/me/devices/${louDevice.id}`).set(auth(hugo.token))).status).toBe(404);
  });

  it('merges a duplicate account into the one whose code is given', async () => {
    const { lou, group } = await setup();
    // Lou joined again from a second device with an invitation: a duplicate "Lou 2".
    const { member: dup } = await inviteAndJoin(lou.token, group.id, 'Lou 2');
    const g2 = (await agent.post('/api/groups').set(auth(dup.token)).send({ name: 'Coloc' })).body;
    const m1 = (await agent.post(`/api/groups/${group.id}/messages`).set(auth(dup.token)).send({ text: 'depuis le doublon' })).body;
    await agent.put(`/api/messages/${m1.id}/reactions/heart`).set(auth(dup.token));
    await agent.put(`/api/messages/${m1.id}/reactions/heart`).set(auth(lou.token));
    await agent.put(`/api/messages/${m1.id}/reactions/star`).set(auth(dup.token));

    const { code } = (await agent.get('/api/me/code').set(auth(lou.token))).body;
    expect((await agent.post('/api/me/merge').set(auth(lou.token)).send({ code })).body.error).toBe('same_account');
    const merged = await agent.post('/api/me/merge').set(auth(dup.token)).send({ code });
    expect(merged.status).toBe(200);
    expect(merged.body.user).toMatchObject({ id: lou.user.id, name: 'Lou' });

    // The duplicate's token now belongs to Lou.
    expect((await agent.get('/api/me').set(auth(dup.token))).body.id).toBe(lou.user.id);
    const groups = (await agent.get('/api/groups').set(auth(lou.token))).body;
    expect(groups.map((g) => g.name).sort()).toEqual(['Coloc', 'Les copines']);
    expect(groups.find((g) => g.id === g2.id).role).toBe('owner');
    expect(groups.find((g) => g.id === group.id)).toMatchObject({ role: 'owner', memberCount: 1 });

    const msgs = (await agent.get(`/api/groups/${group.id}/messages`).set(auth(lou.token))).body;
    const moved = msgs.find((m) => m.id === m1.id);
    expect(moved.authorId).toBe(lou.user.id);
    expect(moved.reactions).toEqual({ heart: [lou.user.id], star: [lou.user.id] });
    expect(msgs.filter((m) => m.type === 'system').every((m) => m.meta.userId === lou.user.id)).toBe(true);
    expect(papote.store.q('SELECT COUNT(*) n FROM users').get().n).toBe(1);
  });

  it('syncs reads across devices and reconnects a merged account’s devices', async () => {
    const { lou, group } = await setup();
    const { code } = (await agent.get('/api/me/code').set(auth(lou.token))).body;
    const second = (await agent.post('/api/link').send({ code })).body.token;
    const { member: dup } = await inviteAndJoin(lou.token, group.id, 'Lou 2');
    await new Promise((r) => papote.server.listen(0, '127.0.0.1', r));
    const { port } = papote.server.address();
    const open = (token) =>
      new Promise((resolve) => {
        const events = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: auth(token) });
        ws.on('message', (d) => events.push(JSON.parse(d.toString())));
        ws.on('close', (c) => events.push({ type: 'closed', code: c }));
        ws.on('open', () => resolve({ ws, events }));
      });
    const a = await open(second);
    const b = await open(dup.token);

    await request(papote.server).post(`/api/groups/${group.id}/read`).set(auth(lou.token)).send({ messageId: 1 });
    await request(papote.server).post('/api/me/merge').set(auth(dup.token)).send({ code });
    await new Promise((r) => setTimeout(r, 150));

    expect(a.events.find((e) => e.type === 'group.read')).toMatchObject({ groupId: group.id, messageId: 1 });
    expect(a.events.find((e) => e.type === 'group.refresh')).toMatchObject({ groupId: group.id });
    expect(b.events.at(-1)).toEqual({ type: 'closed', code: 4002 });
    a.ws.close();
  });

  it('sets illustrated backgrounds and a background picture for a group', async () => {
    const { lou, group } = await setup();
    expect((await agent.patch(`/api/groups/${group.id}/settings`).set(auth(lou.token)).send({ pattern: 'hearts' })).status).toBe(200);
    expect((await agent.patch(`/api/groups/${group.id}/settings`).set(auth(lou.token)).send({ pattern: 'lasers' })).status).toBe(400);
    const set = await agent.put(`/api/groups/${group.id}/wallpaper`).set(auth(lou.token)).attach('file', PNG, { filename: 'fond.png', contentType: 'image/png' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ settings: { pattern: 'hearts' }, wallpaper: expect.stringMatching(/^\/api\/media\/[a-f0-9]{32}$/) });
    expect((await agent.get(set.body.wallpaper).set(auth(lou.token))).status).toBe(200);
    const off = await agent.delete(`/api/groups/${group.id}/wallpaper`).set(auth(lou.token));
    expect(off.body.wallpaper).toBeNull();
    expect((await agent.get(set.body.wallpaper).set(auth(lou.token))).status).toBe(404);
  });

  it('sends videos and documents, up to MAX_UPLOAD_MB', async () => {
    papote.close();
    papote = createServer({ dataDir: dir, adminPassword: 'correct-horse-battery', logger: quiet, maxUploadMb: 1 });
    agent = request(papote.app);
    const { lou, group } = await setup();
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
    const video = await agent.post(`/api/groups/${group.id}/media`).set(auth(lou.token)).field('type', 'video').field('durationMs', '4200').attach('file', mp4, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(video.status).toBe(201);
    expect(video.body).toMatchObject({ type: 'video', media: { mime: 'video/mp4' }, meta: { durationMs: 4200 } });
    // A "video" that isn't one is refused.
    const fake = await agent.post(`/api/groups/${group.id}/media`).set(auth(lou.token)).field('type', 'video').attach('file', PNG, { filename: 'x.mp4', contentType: 'video/mp4' });
    expect(fake.status).toBe(415);

    const doc = await agent.post(`/api/groups/${group.id}/media`).set(auth(lou.token)).field('type', 'file').attach('file', Buffer.from('<script>alert(1)</script>'), { filename: '../Facture été.html', contentType: 'text/html' });
    expect(doc.status).toBe(201);
    expect(doc.body.meta).toEqual({ name: 'Facture été.html', size: 25 });
    const got = await agent.get(doc.body.media.url).set(auth(lou.token));
    expect(got.headers['content-disposition']).toMatch(/^attachment; filename="Facture _t_.html"; filename\*=UTF-8''Facture%20%C3%A9t%C3%A9.html$/);
    expect(got.headers['content-security-policy']).toContain('sandbox');

    const big = await agent.post(`/api/groups/${group.id}/media`).set(auth(lou.token)).field('type', 'file').attach('file', Buffer.alloc(1024 * 1024 + 1), { filename: 'big.bin' });
    expect(big.status).toBe(413);
    expect(big.body.error).toBe('file_too_large');
    expect((await agent.get('/api/server')).body.features.maxUploadMb).toBe(1);
  });

  it('shows what a reply answers and how far each member has read', async () => {
    const { lou, group } = await setup();
    const { member: sam } = await inviteAndJoin(lou.token, group.id, 'Sam');
    const first = (await agent.post(`/api/groups/${group.id}/messages`).set(auth(lou.token)).send({ text: 'On se voit samedi ?' })).body;
    const reply = (await agent.post(`/api/groups/${group.id}/messages`).set(auth(sam.token)).send({ text: 'Oui !', replyTo: first.id })).body;
    expect(reply.reply).toEqual({ id: first.id, authorId: lou.user.id, type: 'text', text: 'On se voit samedi ?', deleted: false });

    await new Promise((r) => papote.server.listen(0, '127.0.0.1', r));
    const { port } = papote.server.address();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: auth(lou.token) });
    const events = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));

    await request(papote.server).post(`/api/groups/${group.id}/read`).set(auth(lou.token)).send({ messageId: reply.id });
    const detail = (await agent.get(`/api/groups/${group.id}`).set(auth(sam.token))).body;
    expect(detail.reads).toEqual({ [lou.user.id]: reply.id, [sam.user.id]: reply.id });
    await new Promise((r) => setTimeout(r, 100));
    // Lou's own read isn't echoed as a "member.read" to Lou.
    expect(events.filter((e) => e.type === 'member.read')).toEqual([]);
    ws.close();
  });
});

describe('admin', () => {
  it('requires the password and generates codes', async () => {
    expect((await agent.get('/admin')).headers.location).toBe('/admin/login');
    expect((await agent.post('/admin/login').type('form').send({ password: 'nope' })).status).toBe(401);
    const login = await agent.post('/admin/login').type('form').send({ password: 'correct-horse-battery' });
    expect(login.status).toBe(303);
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    const dash = await agent.get('/admin').set('Cookie', cookie);
    expect(dash.status).toBe(200);
    expect(dash.text).toContain('Tableau de bord');

    const created = await agent.post('/admin/groups').set('Cookie', cookie).type('form').send({ name: '<b>Soirée</b>', color: 'ciel', icon: 'dice' });
    const code = decodeURIComponent(created.headers['set-cookie'].join(';')).match(/[A-Z2-9]{3}-[A-Z2-9]{3}/)[0];
    const first = await join(code, 'Hugo');
    const groups = (await agent.get('/api/groups').set(auth(first.token))).body;
    expect(groups[0]).toMatchObject({ name: '<b>Soirée</b>', role: 'owner' });

    const page = await agent.get('/admin/groups').set('Cookie', cookie);
    expect(page.text).toContain('&lt;b&gt;Soirée&lt;/b&gt;');
    expect((await agent.post('/admin/backup').set('Cookie', cookie)).status).toBe(303);
    expect(fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.endsWith('.db'))).toHaveLength(1);
  });
});
