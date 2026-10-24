import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, VERSION } from '../src/app.js';
import { isNewer, parseVersion } from '../src/updates.js';

const quiet = { error: () => {}, debug: () => {} };
const servers = [];

afterEach(() => {
  for (const { papote, dir } of servers.splice(0)) {
    papote.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Stands in for api.github.com.
function github(release) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (!release) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(release), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

function start(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papote-updates-'));
  const papote = createServer({ dataDir: dir, adminPassword: 'correct-horse-battery', logger: quiet, ...opts });
  servers.push({ papote, dir });
  return { papote, agent: request(papote.app) };
}

const RELEASE = {
  tag_name: 'v99.1.0',
  name: 'Papote 99.1',
  html_url: 'https://github.com/MrDDream/Papote/releases/tag/v99.1.0',
  published_at: '2026-10-20T10:00:00Z',
  body: 'Répondre en glissant <b>et</b> les coches de lecture',
  assets: [
    { name: 'Papote-v99.1.0-debug.apk', browser_download_url: 'https://github.com/MrDDream/Papote/releases/download/v99.1.0/Papote-v99.1.0-debug.apk' },
    { name: 'Papote-v99.1.0-release.apk', browser_download_url: 'https://github.com/MrDDream/Papote/releases/download/v99.1.0/Papote-v99.1.0-release.apk', size: 14_000_000 },
  ],
};

describe('update check', () => {
  it('compares versions', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('nightly')).toBeNull();
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.1.9', '0.2.0')).toBe(false);
    expect(isNewer('weird', '0.2.0')).toBe(false);
  });

  it('never contacts GitHub when turned off', async () => {
    const gh = github(RELEASE);
    const { papote } = start({ fetchImpl: gh.fetchImpl });
    papote.updates.start();
    expect((await papote.updates.check()).available).toBe(false);
    expect(gh.calls).toEqual([]);
  });

  it('tells the apps and the admin about a newer release', async () => {
    const gh = github(RELEASE);
    const { papote, agent } = start({ fetchImpl: gh.fetchImpl, updateCheck: true });
    const status = await papote.updates.check();
    expect(gh.calls).toEqual(['https://api.github.com/repos/MrDDream/Papote/releases/latest']);
    expect(status).toMatchObject({ available: true, current: VERSION, latest: { version: '99.1.0', apk: { name: 'Papote-v99.1.0-release.apk' } } });

    const user = (await agent.post('/api/join').send({ code: papote.bootstrapCode(), name: 'Lou' })).body;
    const api = await agent.get('/api/updates').set('Authorization', `Bearer ${user.token}`);
    expect(api.body).toMatchObject({ enabled: true, server: VERSION, latest: { version: '99.1.0', apk: { url: RELEASE.assets[1].browser_download_url } } });
    expect(api.body.latest.notes).toBeUndefined();
    expect((await agent.get('/api/updates')).status).toBe(401);

    const login = await agent.post('/admin/login').type('form').send({ password: 'correct-horse-battery' });
    const cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).find((c) => c.startsWith('papote_admin='));
    const page = await agent.get('/admin').set('Cookie', cookie);
    expect(page.text).toContain('v99.1.0 disponible');
    // Release notes are shown as text, never as HTML.
    expect(page.text).toContain('&lt;b&gt;et&lt;/b&gt;');
    const check = await agent.post('/admin/updates/check').set('Cookie', cookie);
    expect(check.status).toBe(303);
  });

  it('is up to date when GitHub has no release', async () => {
    const { papote } = start({ fetchImpl: github(null).fetchImpl, updateCheck: true });
    expect(await papote.updates.check()).toMatchObject({ available: false, latest: null, error: null });
  });
});
