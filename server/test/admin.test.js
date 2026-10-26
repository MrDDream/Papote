import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/app.js';
import { base32Decode, base32Encode, currentStep, hotp, verifyTotp } from '../src/admin/totp.js';

const PASSWORD = 'correct-horse-battery';
const quiet = { error: () => {}, debug: () => {} };
const servers = [];

function start(opts = {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papote-admin-'))) {
  const papote = createServer({ dataDir: dir, adminPassword: PASSWORD, logger: quiet, ...opts });
  servers.push({ papote, dir });
  return { papote, dir, agent: request(papote.app) };
}

afterEach(() => {
  for (const { papote } of servers.splice(0)) papote.close();
});

const cookieOf = (res, name) =>
  res.headers['set-cookie']
    ?.map((c) => c.split(';')[0])
    .find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);

const codeFor = (secret, offset = 0) => hotp(base32Decode(secret), currentStep() + offset);

async function login(agent, password = PASSWORD) {
  const res = await agent.post('/admin/login').type('form').send({ password });
  return { res, session: cookieOf(res, 'papote_admin'), challenge: cookieOf(res, 'papote_admin_2fa') };
}

async function enable2fa(papote, agent, session) {
  await agent.post('/admin/security/2fa/start').set('Cookie', session);
  const secret = papote.store.q("SELECT value FROM admin_settings WHERE key = 'totp_pending'").get().value;
  const page = await agent.get('/admin/security/2fa').set('Cookie', session);
  expect(page.text).toContain('<svg');
  const res = await agent.post('/admin/security/2fa/confirm').set('Cookie', session).type('form').send({ code: codeFor(secret) });
  expect(res.status).toBe(200);
  const recovery = [...res.text.matchAll(/<code>([A-Z2-9]{4}-[A-Z2-9]{4})<\/code>/g)].map((m) => m[1]);
  expect(recovery).toHaveLength(10);
  return { secret, recovery };
}

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const key = Buffer.from('12345678901234567890');
    expect(hotp(key, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(key, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(key, Math.floor(20000000000 / 30), 8)).toBe('65353130');
    expect(base32Decode(base32Encode(key)).equals(key)).toBe(true);
  });

  it('accepts one step of clock drift and refuses replays', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const step = currentStep();
    expect(verifyTotp(secret, codeFor(secret, -1))).toBe(step - 1);
    expect(verifyTotp(secret, codeFor(secret, 2))).toBeNull();
    expect(verifyTotp(secret, codeFor(secret), { afterStep: step })).toBeNull();
    expect(verifyTotp(secret, 'abcdef')).toBeNull();
  });
});

describe('admin access', () => {
  it('stays disabled with a short password', async () => {
    const { agent } = start({ adminPassword: 'short' });
    expect((await agent.get('/admin/login')).text).toContain('au moins 12 caractères');
    expect((await agent.post('/admin/login').type('form').send({ password: 'short' })).status).toBe(503);
  });

  it('sends strict headers and no inline script', async () => {
    const { agent } = start();
    const res = await agent.get('/admin/login');
    expect(res.headers['content-security-policy']).toContain("script-src 'self';");
    expect(res.headers['content-security-policy']).not.toMatch(/script-src[^;]*unsafe/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('really signs out, and a password change closes every session', async () => {
    const { agent, dir } = start();
    const { session } = await login(agent);
    expect((await agent.get('/admin').set('Cookie', session)).status).toBe(200);
    await agent.post('/admin/logout').set('Cookie', session);
    expect((await agent.get('/admin').set('Cookie', session)).headers.location).toBe('/admin/login');

    const second = (await login(agent)).session;
    servers.pop().papote.close();
    const { agent: after } = start({ adminPassword: 'another-long-secret-phrase' }, dir);
    expect((await after.get('/admin').set('Cookie', second)).headers.location).toBe('/admin/login');
  });

  it('asks for the app code after the password once 2FA is on', async () => {
    const { papote, agent } = start();
    const { session } = await login(agent);
    const other = (await login(agent)).session;
    const { secret, recovery } = await enable2fa(papote, agent, session);
    // Sessions opened with the password alone are closed.
    expect((await agent.get('/admin').set('Cookie', other)).headers.location).toBe('/admin/login');

    const step1 = await login(agent);
    expect(step1.res.headers.location).toBe('/admin/login/2fa');
    expect(step1.session).toBeUndefined();
    expect((await agent.get('/admin').set('Cookie', step1.challenge)).headers.location).toBe('/admin/login');

    const wrong = await agent.post('/admin/login/2fa').set('Cookie', step1.challenge).type('form').send({ code: '000000' });
    expect(wrong.status).toBe(401);
    // The code used to confirm the setup can't be replayed: wait for the next one.
    const lastStep = Number(papote.store.q("SELECT value FROM admin_settings WHERE key = 'totp_last_step'").get().value);
    const used = hotp(base32Decode(secret), lastStep);
    expect((await agent.post('/admin/login/2fa').set('Cookie', step1.challenge).type('form').send({ code: used })).status).toBe(401);
    const next = hotp(base32Decode(secret), lastStep + 1);
    const ok = await agent.post('/admin/login/2fa').set('Cookie', step1.challenge).type('form').send({ code: next });
    expect(ok.status).toBe(303);
    const session2 = cookieOf(ok, 'papote_admin');
    expect((await agent.get('/admin').set('Cookie', session2)).status).toBe(200);

    // A recovery code works exactly once.
    const step2 = await login(agent);
    const viaRecovery = await agent.post('/admin/login/2fa').set('Cookie', step2.challenge).type('form').send({ code: recovery[0].toLowerCase() });
    expect(viaRecovery.status).toBe(303);
    const step3 = await login(agent);
    expect((await agent.post('/admin/login/2fa').set('Cookie', step3.challenge).type('form').send({ code: recovery[0] })).status).toBe(401);

    const journal = (await agent.get('/admin/journal').set('Cookie', session2)).text;
    expect(journal).toContain('2FA activée');
    expect(journal).toContain('Code 2FA refusé');
  });

  it('gives up on a 2FA challenge after five wrong codes', async () => {
    const { papote, agent } = start();
    const { session } = await login(agent);
    const { secret } = await enable2fa(papote, agent, session);
    const { challenge } = await login(agent);
    for (let i = 0; i < 5; i++) await agent.post('/admin/login/2fa').set('Cookie', challenge).type('form').send({ code: '000000' });
    const late = await agent.post('/admin/login/2fa').set('Cookie', challenge).type('form').send({ code: codeFor(secret, 1) });
    expect(late.status).toBe(401);
    expect(cookieOf(late, 'papote_admin')).toBeUndefined();
  });

  it('ignores X-Forwarded-For unless it comes from a trusted proxy address', async () => {
    // The test client connects from 127.0.0.1, which is not the trusted proxy here: a spoofed header
    // must neither open the admin nor dodge the rate limits.
    const { agent } = start({ trustProxy: '10.0.0.0/8', adminAllowedIps: '10.0.0.0/8' });
    expect((await agent.get('/admin/login').set('X-Forwarded-For', '10.1.2.3')).status).toBe(404);
    let last;
    for (let i = 0; i < 21; i++) {
      last = (await agent.post('/api/join').set('X-Forwarded-For', `198.51.100.${i}`).send({ code: 'AAAAAA', name: 'x' })).status;
    }
    expect(last).toBe(429);
  });

  it('stays disabled with an example password', async () => {
    const { agent } = start({ adminPassword: 'change-moi-par-une-phrase-longue' });
    expect((await agent.get('/admin/login')).text).toContain('ressemble à un exemple');
    expect((await agent.post('/admin/login').type('form').send({ password: 'change-moi-par-une-phrase-longue' })).status).toBe(503);
  });

  it('hides the admin outside ADMIN_ALLOWED_IPS', async () => {
    const closed = start({ adminAllowedIps: '10.0.0.0/8, fd00::/8' });
    expect((await closed.agent.get('/admin/login')).status).toBe(404);
    expect((await closed.agent.get('/api/server')).status).toBe(200);
    const open = start({ adminAllowedIps: '127.0.0.1, ::1' });
    expect((await open.agent.get('/admin/login')).status).toBe(200);
    expect(() => start({ adminAllowedIps: '192.168.1.0/99' })).toThrow(/masque invalide/);
  });

  it('keeps everything but the security page closed until 2FA is set up when required', async () => {
    const { agent } = start({ adminRequire2fa: true });
    const { res, session } = await login(agent);
    expect(res.headers.location).toBe('/admin/security');
    expect((await agent.get('/admin/members').set('Cookie', session)).headers.location).toBe('/admin/security');
    expect((await agent.get('/admin/security').set('Cookie', session)).status).toBe(200);
  });

  it('blocks every login for a while after many failures from many addresses', async () => {
    const { agent } = start({ trustProxy: true });
    for (let i = 0; i < 30; i++) {
      await agent.post('/admin/login').set('X-Forwarded-For', `203.0.113.${i}`).type('form').send({ password: 'nope' });
    }
    const res = await agent.post('/admin/login').set('X-Forwarded-For', '198.51.100.7').type('form').send({ password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('gives a member a temporary password after a lost phone', async () => {
    const { papote, agent } = start();
    const lou = (await agent.post('/api/join').send({ code: papote.bootstrapCode(), name: 'Lou B.' })).body;
    const { session } = await login(agent);
    expect((await agent.get(`/admin/members/${lou.user.id}/code`).set('Cookie', session)).text).toContain('Nouveau mot de passe pour Lou B.');
    const page = await agent.post(`/admin/members/${lou.user.id}/code`).set('Cookie', session).type('form').send({ confirm: '1' });
    const password = page.text.match(/class="code-big">([a-z0-9-]{14})</)[1];
    // The account had no username: one is made from the display name.
    expect(page.text).toContain('<code class="secret">lou.b</code>');
    // The lost phone is signed out; the temporary password opens the account.
    expect((await agent.get('/api/me').set('Authorization', `Bearer ${lou.token}`)).status).toBe(401);
    const signed = await agent.post('/api/login').send({ username: 'Lou.B', password });
    expect(signed.status).toBe(201);
    expect(signed.body.user).toMatchObject({ id: lou.user.id, username: 'lou.b', hasPassword: true });
  });

  it('shows a sign-up link and its QR code for the server access code', async () => {
    const { papote, agent } = start();
    const code = papote.bootstrapCode();
    const { session } = await login(agent);
    const page = (await agent.get('/admin').set('Cookie', session)).text;
    expect(page).toContain(`/web/#/join?code=${code.replace('-', '')}`);
    expect(page).toMatch(/<details><summary>QR code à scanner<\/summary><div class="qr"><svg/);
  });

  it('opens sign-up to anyone, or only with a code', async () => {
    const { agent } = start();
    const { session } = await login(agent);
    expect((await agent.get('/api/server')).body.registration).toBe('open');
    await agent.post('/admin/registration').set('Cookie', session).type('form').send({ mode: 'code' });
    expect((await agent.get('/api/server')).body.registration).toBe('code');
    const refused = await agent.post('/api/register').send({ name: 'Sam', username: 'sam', password: 'un-long-secret' });
    expect(refused.body.error).toBe('code_required');
  });

  it('puts a deleted group in the trash, restorable for 30 days, then purges it', async () => {
    const { papote, agent } = start();
    const { session } = await login(agent);
    const code = papote.bootstrapCode();
    const lou = (await agent.post('/api/join').send({ code, name: 'Lou' })).body;
    const g = (await agent.post('/api/groups').set('Authorization', `Bearer ${lou.token}`).send({ name: 'Les copines' })).body;
    await agent.post(`/api/groups/${g.id}/messages`).set('Authorization', `Bearer ${lou.token}`).send({ text: 'coucou' });
    expect((await agent.get(`/admin/groups/${g.id}/delete`).set('Cookie', session)).text).toContain('Mettre à la corbeille');
    await agent.post(`/admin/groups/${g.id}/delete`).set('Cookie', session).type('form').send({});
    expect(papote.store.q('SELECT deleted_at FROM groups WHERE id = ?').get(g.id).deleted_at).toBeNull();
    await agent.post(`/admin/groups/${g.id}/delete`).set('Cookie', session).type('form').send({ confirm: '1' });
    expect((await agent.get('/api/groups').set('Authorization', `Bearer ${lou.token}`)).body).toEqual([]);
    expect((await agent.get(`/api/groups/${g.id}/messages`).set('Authorization', `Bearer ${lou.token}`)).status).toBe(404);
    const page = (await agent.get('/admin/groups').set('Cookie', session)).text;
    expect(page).toContain('Corbeille');
    expect(page).toContain('Les copines');
    await agent.post(`/admin/groups/${g.id}/restore`).set('Cookie', session).type('form').send({});
    const back = (await agent.get(`/api/groups/${g.id}/messages`).set('Authorization', `Bearer ${lou.token}`)).body;
    expect(back.map((m) => m.text)).toContain('coucou');

    // The owner deletes it from the app: same trash; 31 days later it is gone for good.
    expect((await agent.delete(`/api/groups/${g.id}`).set('Authorization', `Bearer ${lou.token}`)).status).toBe(204);
    expect(papote.store.q('SELECT deleted_by FROM groups WHERE id = ?').get(g.id).deleted_by).toBe('Lou');
    papote.store.q('UPDATE groups SET deleted_at = ?').run(Date.now() - 31 * 86_400_000);
    papote.features.cleanup();
    expect(papote.store.q('SELECT COUNT(*) n FROM groups').get().n).toBe(0);
  });

  it('restores a backup after a confirmation, keeping the current state aside', async () => {
    let restarted = 0;
    const { papote, agent, dir } = start({ restart: () => restarted++ });
    const { session } = await login(agent);
    papote.store.createGroup({ name: 'Avant', color: 'rose', icon: 'heart' });
    const first = papote.backups.run('test');
    papote.store.createGroup({ name: 'Après', color: 'rose', icon: 'heart' });
    const dash = (await agent.get('/admin').set('Cookie', session)).text;
    expect(dash).toContain('Sauvegarde &amp; Restauration');
    expect(dash).toContain('href="#restore-0"');
    expect((await agent.post('/admin/backups/restore').set('Cookie', session).type('form').send({ name: first.name })).headers.location).toBe('/admin#bk');
    const res = await agent.post('/admin/backups/restore').set('Cookie', session).type('form').send({ name: first.name, confirm: '1' });
    expect(res.text).toContain('Restauration en cours');
    await new Promise((r) => setTimeout(r, 400));
    expect(restarted).toBe(1);
    expect(papote.backups.list().some((b) => b.name !== first.name)).toBe(true);
    // The server comes back on the restored base, and the journal says so.
    const again = createServer({ dataDir: dir, adminPassword: PASSWORD, logger: quiet });
    servers.push({ papote: again });
    expect(again.store.q('SELECT name FROM groups').all().map((g) => g.name)).toEqual(['Avant']);
    expect(again.store.q("SELECT COUNT(*) n FROM admin_events WHERE kind = 'backup_restored'").get().n).toBe(1);
  });

  it('has a journal tab with filters, and quick filters on lists', async () => {
    const { papote, agent } = start();
    const { session } = await login(agent);
    await agent.post('/admin/login').type('form').send({ password: 'nope-nope-nope' });
    const all = (await agent.get('/admin/journal').set('Cookie', session)).text;
    expect(all).toContain('Échec de connexion');
    expect(all).toContain('Connexion');
    const alerts = (await agent.get('/admin/journal?alerts=1').set('Cookie', session)).text;
    expect(alerts).toContain('Échec de connexion');
    expect(alerts).not.toContain('<td>Connexion</td>');
    expect((await agent.get('/admin/journal?cat=backups').set('Cookie', session)).text).toContain('Aucun événement');
    expect((await agent.get('/admin/security').set('Cookie', session)).text).not.toContain('<h2 id="log">');

    const code = papote.bootstrapCode();
    for (const name of ['Lou', 'Inès']) await agent.post('/api/join').send({ code, name });
    const members = (await agent.get('/admin/members?q=ines').set('Cookie', session)).text;
    expect(members).toContain('Inès');
    expect(members).not.toContain('<b>Lou</b>');
    expect((await agent.get('/admin/codes?type=group').set('Cookie', session)).text).toContain('Aucun code actif');
    expect((await agent.get('/admin').set('Cookie', session)).headers['content-security-policy']).toContain("script-src 'self'");
  });
});
