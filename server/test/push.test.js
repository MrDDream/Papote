import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import webpush from 'web-push';
import ece from 'http_ece';
import { createServer } from '../src/app.js';
import { isPushEndpoint } from '../src/push.js';

const auth = (t) => ({ Authorization: `Bearer ${t}` });
let papote;
let agent;
let sent;
let fail; // status code the fake push service answers with, if any

beforeEach(() => {
  sent = [];
  fail = null;
  papote = createServer({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'papote-push-')),
    logger: { error() {} },
    vapidSubject: 'mailto:test@example.org',
    // Fake push service: build the exact request web-push would send, keep it, answer like FCM would.
    pushSend: async (sub, payload, options) => {
      if (fail) throw Object.assign(new Error('gone'), { statusCode: fail });
      sent.push({ sub, details: webpush.generateRequestDetails(sub, payload, options) });
    },
  });
  agent = request(papote.app);
});
afterEach(() => papote.close());

/** A browser's push subscription, with the keys to read what it receives. */
function browser(endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = crypto.randomBytes(16);
  return {
    ecdh,
    authSecret,
    subscription: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } },
    read: (body) => JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString()),
  };
}

async function setup() {
  const code = papote.bootstrapCode();
  const lou = (await agent.post('/api/join').send({ code, name: 'Lou' })).body;
  const ines = (await agent.post('/api/join').send({ code, name: 'Inès' })).body;
  const g = (await agent.post('/api/groups').set(auth(lou.token)).send({ name: 'Les copines' })).body;
  const inv = (await agent.post(`/api/groups/${g.id}/invites`).set(auth(lou.token)).send({})).body;
  await agent.post('/api/join').set(auth(ines.token)).send({ code: inv.code });
  return { lou, ines, g };
}

describe('web push', () => {
  it('only accepts the browsers’ push services', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://192.168.1.1/x', 'https://evil.example/x', 'https://googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x']) {
      expect(isPushEndpoint(bad), bad).toBe(false);
    }
  });

  it('sends an encrypted notification that only the browser can read', async () => {
    const { lou, ines, g } = await setup();
    expect((await agent.get('/api/push/key').set(auth(ines.token))).body.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const b = browser();
    expect((await agent.post('/api/push/subscribe').set(auth(ines.token)).send(b.subscription)).status).toBe(204);
    expect((await agent.post('/api/push/subscribe').set(auth(ines.token)).send(browser('https://192.168.1.1/x').subscription)).status).toBe(400);

    await agent.post(`/api/groups/${g.id}/messages`).set(auth(lou.token)).send({ text: 'Ciné samedi ? 🍿' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
    const { details } = sent[0];
    expect(details.endpoint).toBe(b.subscription.endpoint);
    expect(details.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(details.headers['Content-Encoding']).toBe('aes128gcm');
    expect(details.body.toString()).not.toContain('Ciné');
    expect(b.read(details.body)).toMatchObject({ title: 'Les copines', body: 'Lou : Ciné samedi ? 🍿', groupId: g.id, url: `/web/#/chat/${g.id}` });
  });

  it('skips the author and pages already open, and forgets dead subscriptions', async () => {
    const { lou, ines, g } = await setup();
    await agent.post('/api/push/subscribe').set(auth(lou.token)).send(browser().subscription);
    await agent.post('/api/push/subscribe').set(auth(ines.token)).send(browser().subscription);

    // Inès has Papote open: she gets it live, no notification.
    await new Promise((r) => papote.server.listen(0, '127.0.0.1', r));
    const ws = new WebSocket(`ws://127.0.0.1:${papote.server.address().port}/ws`, { headers: auth(ines.token) });
    await new Promise((r) => ws.on('open', r));
    await request(papote.server).post(`/api/groups/${g.id}/messages`).set(auth(lou.token)).send({ text: 'a' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(0);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));

    fail = 410;
    await request(papote.server).post(`/api/groups/${g.id}/messages`).set(auth(lou.token)).send({ text: 'b' });
    await new Promise((r) => setTimeout(r, 50));
    expect(papote.store.q('SELECT user_id FROM push_subscriptions').all().map((r) => r.user_id)).toEqual([lou.user.id]);
  });

  it('drops a browser’s subscription when its session is signed out', async () => {
    const { lou } = await setup();
    await agent.post('/api/push/subscribe').set(auth(lou.token)).send(browser().subscription);
    await agent.post('/api/logout').set(auth(lou.token));
    expect(papote.store.q('SELECT COUNT(*) n FROM push_subscriptions').get().n).toBe(0);
  });
});
