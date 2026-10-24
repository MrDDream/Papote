import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';
import { fold } from '../src/games.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let papote;
let agent;
let fetched;
let dataDir;

// Stands in for GIPHY and the Whisper container.
async function fakeFetch(url, opts = {}) {
  const u = String(url);
  fetched.push(u);
  const ok = (body, type = 'application/json') => new Response(typeof body === 'string' || body instanceof Buffer ? body : JSON.stringify(body), { status: 200, headers: { 'Content-Type': type } });
  if (u.includes('/asr?')) return ok({ text: ' Rendez-vous samedi au ciné ' });
  if (u.startsWith('https://api.giphy.com/v1/gifs/search') || u.startsWith('https://api.giphy.com/v1/gifs/trending')) {
    return ok({
      data: [
        {
          id: 'abc123XYZ',
          title: 'Bravo GIF by Someone',
          images: { fixed_width: { webp: 'https://media2.giphy.com/media/abc123XYZ/200w.webp', width: '200', height: '150' }, downsized: { url: 'https://media2.giphy.com/media/abc123XYZ/giphy-downsized.gif' } },
        },
        { id: 'evil1', title: 'x', images: { fixed_width: { url: 'http://192.168.1.1/x.gif' }, downsized: { url: 'http://192.168.1.1/x.gif' } } },
      ],
    });
  }
  if (u.startsWith('https://media2.giphy.com/')) return new Response(GIF, { status: 200 });
  throw new Error(`unexpected fetch ${u} ${opts.method ?? ''}`);
}

beforeEach(() => {
  fetched = [];
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papote-m-'));
  papote = createServer({
    dataDir,
    logger: { error() {}, debug() {} },
    giphyApiKey: 'test-key',
    whisperUrl: 'http://whisper:9000',
    fetchImpl: fakeFetch,
  });
  agent = request(papote.app);
});
afterEach(() => papote.close());

async function people() {
  const code = papote.bootstrapCode();
  const lou = (await agent.post('/api/join').send({ code, name: 'Lou' })).body;
  const ines = (await agent.post('/api/join').send({ code, name: 'Inès' })).body;
  const hugo = (await agent.post('/api/join').send({ code, name: 'Hugo' })).body;
  const g = (await agent.post('/api/groups').set(auth(lou.token)).send({ name: 'Les copines' })).body;
  const inv = (await agent.post(`/api/groups/${g.id}/invites`).set(auth(lou.token)).send({})).body;
  await agent.post('/api/join').set(auth(ines.token)).send({ code: inv.code });
  return { lou, ines, hugo, g, inv };
}

const say = async (token, gid, text) => (await agent.post(`/api/groups/${gid}/messages`).set(auth(token)).send({ text })).body;
const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
};

describe('group rules and members', () => {
  it('approves newcomers when the group asks for it', async () => {
    const { lou, hugo, g, inv } = await people();
    expect((await agent.patch(`/api/groups/${g.id}/settings`).set(auth(hugo.token)).send({ approval: true })).status).toBe(404);
    const s = await agent.patch(`/api/groups/${g.id}/settings`).set(auth(lou.token)).send({ approval: true });
    expect(s.body.settings.approval).toBe(true);
    const join = await agent.post('/api/join').set(auth(hugo.token)).send({ code: inv.code });
    expect(join.body).toMatchObject({ pending: true, groupId: null });
    expect((await agent.get(`/api/groups/${g.id}`).set(auth(hugo.token))).status).toBe(404);
    expect((await agent.get('/api/me/pending').set(auth(hugo.token))).body.map((x) => x.id)).toEqual([g.id]);
    const list = (await agent.get(`/api/groups/${g.id}/members`).set(auth(lou.token))).body;
    expect(list.find((m) => m.name === 'Hugo').status).toBe('pending');
    expect((await agent.post(`/api/groups/${g.id}/members/${hugo.user.id}/approve`).set(auth(lou.token))).status).toBe(204);
    expect((await agent.get(`/api/groups/${g.id}`).set(auth(hugo.token))).status).toBe(200);
  });

  it('mutes a member, who can still read but not write', async () => {
    const { lou, ines, g } = await people();
    const r = await agent.put(`/api/groups/${g.id}/members/${ines.user.id}/mute`).set(auth(lou.token)).send({ duration: '1h' });
    expect(r.body.mutedUntil).toBeGreaterThan(Date.now());
    expect((await agent.post(`/api/groups/${g.id}/messages`).set(auth(ines.token)).send({ text: 'coucou' })).body.error).toBe('muted');
    expect((await agent.get(`/api/groups/${g.id}/messages`).set(auth(ines.token))).status).toBe(200);
    await agent.delete(`/api/groups/${g.id}/members/${ines.user.id}/mute`).set(auth(lou.token));
    expect((await agent.post(`/api/groups/${g.id}/messages`).set(auth(ines.token)).send({ text: 'coucou' })).status).toBe(201);
  });

  it('keeps invitations to admins when asked, and checks the quick reactions', async () => {
    const { lou, ines, g } = await people();
    await agent.patch(`/api/groups/${g.id}/settings`).set(auth(lou.token)).send({ anyoneInvites: false, pattern: 'grid', reactions: ['heart', '🎉'] });
    expect((await agent.post(`/api/groups/${g.id}/invites`).set(auth(ines.token)).send({})).status).toBe(403);
    expect((await agent.patch(`/api/groups/${g.id}/settings`).set(auth(ines.token)).send({ reactions: ['nope'] })).body.error).toBe('bad_reactions');
    const d = (await agent.get(`/api/groups/${g.id}`).set(auth(ines.token))).body;
    expect(d.settings).toMatchObject({ pattern: 'grid', reactions: ['heart', '🎉'], anyoneInvites: false });
  });

  it('lists today’s birthdays and the mood', async () => {
    const { lou, ines, g } = await people();
    const d = new Date();
    const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await agent.patch('/api/me').set(auth(ines.token)).send({ birthday: `--${md}`, mood: 'cine' });
    const detail = (await agent.get(`/api/groups/${g.id}`).set(auth(lou.token))).body;
    expect(detail.birthdaysToday).toEqual([ines.user.id]);
    expect((await agent.get(`/api/groups/${g.id}/members`).set(auth(lou.token))).body.find((m) => m.id === ines.user.id).mood).toBe('cine');
    await agent.patch(`/api/groups/${g.id}/settings`).set(auth(lou.token)).send({ birthdays: false });
    expect((await agent.get(`/api/groups/${g.id}`).set(auth(lou.token))).body.birthdaysToday).toEqual([]);
  });
});

describe('messages', () => {
  it('pins, searches and jumps around a message', async () => {
    const { lou, ines, g } = await people();
    const first = await say(ines.token, g.id, 'Qui est chaud pour un ciné samedi ?');
    for (let i = 0; i < 10; i++) await say(lou.token, g.id, `bla ${i}`);
    await say(lou.token, g.id, '100% d’accord');
    expect((await agent.put(`/api/messages/${first.id}/pin`).set(auth(lou.token))).body.pinnedBy).toBe(lou.user.id);
    expect((await agent.get(`/api/groups/${g.id}/pins`).set(auth(ines.token))).body.map((m) => m.id)).toEqual([first.id]);
    const found = (await agent.get(`/api/groups/${g.id}/search`).query({ q: 'CINÉ' }).set(auth(lou.token))).body;
    expect(found.map((m) => m.id)).toEqual([first.id]);
    expect((await agent.get(`/api/groups/${g.id}/search`).query({ q: '%' }).set(auth(lou.token))).body).toHaveLength(1);
    expect((await agent.get(`/api/groups/${g.id}/search`).query({ author: ines.user.id }).set(auth(lou.token))).body).toHaveLength(1);
    const around = (await agent.get(`/api/groups/${g.id}/messages`).query({ around: first.id, limit: 6 }).set(auth(lou.token))).body;
    expect(around.map((m) => m.id)).toContain(first.id);
    expect(around).toHaveLength(6);
    await agent.delete(`/api/messages/${first.id}/pin`).set(auth(ines.token));
    expect((await agent.get(`/api/groups/${g.id}/pins`).set(auth(ines.token))).body).toEqual([]);
  });

  it('runs polls', async () => {
    const { lou, ines, hugo, g } = await people();
    const poll = (await agent.post(`/api/groups/${g.id}/polls`).set(auth(ines.token)).send({ question: 'Ciné samedi ou dimanche ?', options: ['Samedi soir', 'Dimanche aprèm'] })).body;
    expect(poll.type).toBe('poll');
    await agent.put(`/api/messages/${poll.id}/vote`).set(auth(lou.token)).send({ option: 0 });
    const v = (await agent.put(`/api/messages/${poll.id}/vote`).set(auth(lou.token)).send({ option: 1 })).body;
    expect(v.votes).toEqual({ 1: [lou.user.id] });
    expect((await agent.put(`/api/messages/${poll.id}/vote`).set(auth(lou.token)).send({ options: [0, 1] })).body.error).toBe('bad_vote');
    expect((await agent.put(`/api/messages/${poll.id}/vote`).set(auth(hugo.token)).send({ option: 0 })).status).toBe(404);
    expect((await agent.post(`/api/messages/${poll.id}/close`).set(auth(ines.token))).body.meta.closed).toBe(true);
    expect((await agent.put(`/api/messages/${poll.id}/vote`).set(auth(lou.token)).send({ option: 0 })).body.error).toBe('poll_closed');
  });

  it('shares a position, live for a while', async () => {
    const { lou, ines, g } = await people();
    const m = (await agent.post(`/api/groups/${g.id}/location`).set(auth(ines.token)).send({ lat: 48.8566123456, lon: 2.3522, accuracy: 30, minutes: 60, label: 'Je suis là !' })).body;
    expect(m.meta).toMatchObject({ lat: 48.85661, lon: 2.3522, accuracy: 30 });
    expect(m.meta.until).toBeGreaterThan(Date.now());
    expect((await agent.patch(`/api/messages/${m.id}/location`).set(auth(lou.token)).send({ lat: 1, lon: 1 })).status).toBe(404);
    expect((await agent.patch(`/api/messages/${m.id}/location`).set(auth(ines.token)).send({ lat: 48.86, lon: 2.35 })).body.meta.lat).toBe(48.86);
    await agent.delete(`/api/messages/${m.id}/location`).set(auth(ines.token));
    expect((await agent.patch(`/api/messages/${m.id}/location`).set(auth(ines.token)).send({ lat: 48.87, lon: 2.35 })).body.error).toBe('location_ended');
    expect((await agent.post(`/api/groups/${g.id}/location`).set(auth(ines.token)).send({ lat: 123, lon: 0 })).body.error).toBe('bad_location');
  });

  it('keeps a drawing’s strokes, makes ephemeral photos vanish, and fills the gallery', async () => {
    const { lou, ines, g } = await people();
    const ops = JSON.stringify([{ c: '#FF7A93', w: 8, t: 'pen', p: [10, 10, 500, 500] }, { c: 'red', w: 999, p: [1, 2] }]);
    const d = (await agent.post(`/api/groups/${g.id}/media`).set(auth(lou.token)).field('type', 'drawing').field('ops', ops).attach('file', PNG, 'd.png')).body;
    expect(d.meta.strokes).toBe(2);
    const strokes = (await agent.get(`/api/media/${d.meta.opsId}`).set(auth(ines.token))).body;
    expect(strokes.strokes[1]).toMatchObject({ c: '#2E2442', w: 200 });
    const eph = (await agent.post(`/api/groups/${g.id}/media`).set(auth(lou.token)).field('type', 'photo').field('ephemeral', '1').attach('file', PNG, 'p.png')).body;
    expect(eph.expiresAt).toBeGreaterThan(Date.now());
    let gallery = (await agent.get(`/api/groups/${g.id}/gallery`).set(auth(ines.token))).body;
    expect(gallery.items.map((m) => m.id)).toEqual([d.id]);
    expect(gallery.counts).toEqual({ drawing: 1 });
    papote.store.q('UPDATE messages SET expires_at = ? WHERE id = ?').run(Date.now() - 1, eph.id);
    papote.features.cleanup();
    expect(papote.store.getMessage(eph.id)).toMatchObject({ deleted: true, media: null });
    gallery = (await agent.get(`/api/groups/${g.id}/gallery`).query({ kind: 'photo' }).set(auth(ines.token))).body;
    expect(gallery.items).toEqual([]);
  });

  it('writes voice messages out with Whisper', async () => {
    const { lou, ines, g } = await people();
    const v = (await agent.post(`/api/groups/${g.id}/media`).set(auth(lou.token)).field('type', 'voice').field('filter', 'souris').attach('file', Buffer.from('fake audio'), { filename: 'v.m4a', contentType: 'audio/mp4' })).body;
    expect(v.meta).toMatchObject({ filter: 'souris', transcribing: true });
    const done = await until(() => {
      const m = papote.store.getMessage(v.id);
      return m.meta.transcript ? m : null;
    });
    expect(done.meta.transcript).toBe('Rendez-vous samedi au ciné');
    expect(done.meta.transcribing).toBeUndefined();
    expect((await agent.get(`/api/groups/${g.id}/search`).query({ q: 'samedi', kind: 'voice' }).set(auth(ines.token))).body).toHaveLength(1);
  });
});

describe('stories, stickers, GIFs', () => {
  it('shows stories for 24 h and who saw them', async () => {
    const { lou, ines, hugo, g } = await people();
    const s = (await agent.post(`/api/groups/${g.id}/stories`).set(auth(ines.token)).field('caption', 'Enfin la mer !').attach('file', PNG, 's.png')).body;
    expect(s.caption).toBe('Enfin la mer !');
    let list = (await agent.get(`/api/groups/${g.id}/stories`).set(auth(lou.token))).body;
    expect(list[0]).toMatchObject({ unseen: true, user: { id: ines.user.id } });
    await agent.post(`/api/stories/${s.id}/view`).set(auth(lou.token));
    list = (await agent.get(`/api/groups/${g.id}/stories`).set(auth(lou.token))).body;
    expect(list[0].unseen).toBe(false);
    const mine = (await agent.get(`/api/groups/${g.id}/stories`).set(auth(ines.token))).body;
    expect(mine[0].stories[0].viewers).toEqual([{ id: lou.user.id, name: 'Lou' }]);
    expect((await agent.get(s.url).set(auth(hugo.token))).status).toBe(404);
    papote.store.q('UPDATE stories SET expires_at = ?').run(Date.now() - 1);
    papote.features.cleanup();
    expect((await agent.get(`/api/groups/${g.id}/stories`).set(auth(lou.token))).body).toEqual([]);
  });

  it('turns a drawing into a group sticker and sends it', async () => {
    const { lou, ines, g } = await people();
    const d = (await agent.post(`/api/groups/${g.id}/media`).set(auth(lou.token)).field('type', 'drawing').attach('file', PNG, 'd.png')).body;
    const st = (await agent.post(`/api/groups/${g.id}/stickers`).set(auth(ines.token)).send({ messageId: d.id })).body;
    expect(st.url).toMatch(/^\/api\/media\//);
    await agent.delete(`/api/messages/${d.id}`).set(auth(lou.token));
    expect((await agent.get(st.url).set(auth(lou.token))).status).toBe(200);
    const sent = (await agent.post(`/api/groups/${g.id}/sticker`).set(auth(lou.token)).send({ stickerId: st.id })).body;
    expect(sent).toMatchObject({ type: 'sticker', meta: { stickerId: st.id } });
    expect((await agent.post(`/api/groups/${g.id}/sticker`).set(auth(lou.token)).send({ builtin: 'star' })).body.meta.builtin).toBe('star');
    await agent.put('/api/me/favorites').set(auth(lou.token)).send({ kind: 'sticker', ref: String(st.id) });
    await agent.put('/api/me/favorites').set(auth(lou.token)).send({ kind: 'builtin', ref: 'rainbow' });
    expect((await agent.put('/api/me/favorites').set(auth(lou.token)).send({ kind: 'gif', ref: '../x' })).status).toBe(400);
    const favs = (await agent.get('/api/me/favorites').set(auth(lou.token))).body;
    expect(favs.map((f) => f.kind).sort()).toEqual(['builtin', 'sticker']);
  });

  it('proxies GIPHY: members never reach it, unsafe links are dropped', async () => {
    const { lou, ines, g } = await people();
    const list = (await agent.get('/api/gifs/search').query({ q: 'bravo' }).set(auth(lou.token))).body;
    expect(list).toEqual([{ id: 'abc123XYZ', title: 'Bravo', width: 200, height: 150, preview: '/api/gifs/abc123XYZ/preview' }]);
    expect(fetched[0]).toContain('api_key=test-key');
    const prev = await agent.get('/api/gifs/abc123XYZ/preview').set(auth(lou.token));
    expect(prev.headers['content-type']).toBe('image/gif');
    const m = (await agent.post(`/api/groups/${g.id}/gif`).set(auth(ines.token)).send({ id: 'abc123XYZ' })).body;
    expect(m).toMatchObject({ type: 'gif', meta: { gifId: 'abc123XYZ', title: 'Bravo' } });
    expect((await agent.get(m.media.url).set(auth(lou.token))).headers['content-type']).toBe('image/gif');
    expect((await agent.get('/api/server')).body.features).toEqual({ gifs: true, transcription: true, maxUploadMb: 20 });
  });
});

describe('games', () => {
  it('plays tic-tac-toe rounds between two people', async () => {
    const { lou, ines, hugo, g } = await people();
    const game = (await agent.post(`/api/groups/${g.id}/games`).set(auth(lou.token)).send({ kind: 'tictactoe', opponentId: ines.user.id })).body;
    const move = (t, cell) => agent.post(`/api/games/${game.id}/move`).set(auth(t)).send({ cell });
    expect((await move(ines.token, 0)).body.error).toBe('not_your_turn');
    expect((await move(hugo.token, 0)).status).toBe(404);
    for (const [t, c] of [[lou, 0], [ines, 3], [lou, 1], [ines, 4]]) expect((await move(t.token, c)).status).toBe(200);
    const won = (await move(lou.token, 2)).body;
    expect(won.state.result).toEqual({ winner: 0, line: [0, 1, 2] });
    expect(won.state.scores).toEqual([1, 0]);
    const next = (await agent.post(`/api/games/${game.id}/move`).set(auth(ines.token)).send({ action: 'next' })).body;
    expect(next.state).toMatchObject({ round: 2, turn: 1, result: null });
    const msgs = (await agent.get(`/api/groups/${g.id}/messages`).set(auth(ines.token))).body;
    expect(msgs.at(-1)).toMatchObject({ type: 'game', meta: { gameId: game.id, kind: 'tictactoe' } });
  });

  it('hides the other Chifoumi pick until both played', async () => {
    const { lou, ines, g } = await people();
    const game = (await agent.post(`/api/groups/${g.id}/games`).set(auth(lou.token)).send({ kind: 'rps' })).body;
    expect(game.state.players).toEqual([lou.user.id, null]);
    await agent.post(`/api/games/${game.id}/move`).set(auth(lou.token)).send({ pick: 'pierre' });
    const seen = (await agent.get(`/api/games/${game.id}`).set(auth(ines.token))).body;
    expect(seen.state.picks).toEqual([null, null]);
    expect(seen.state.played).toEqual([true, false]);
    const done = (await agent.post(`/api/games/${game.id}/move`).set(auth(ines.token)).send({ pick: 'feuille' })).body;
    expect(done.state.last).toMatchObject({ picks: ['pierre', 'feuille'], winner: 1 });
  });

  it('asks “Qui a dit ça ?” about old messages', async () => {
    const { lou, ines, g } = await people();
    expect((await agent.post(`/api/groups/${g.id}/games`).set(auth(lou.token)).send({ kind: 'quiz' })).body.error).toBe('not_enough_messages');
    for (const t of ['J’ai adopté une plante, elle s’appelle Gérard.', 'Le pop-corn salé, c’est une erreur de la nature.']) await say(ines.token, g.id, t);
    for (const t of ['Je mets une alarme pour me rappeler de mettre une alarme.', 'On refait une soirée ciné à la maison ?']) await say(lou.token, g.id, t);
    const game = (await agent.post(`/api/groups/${g.id}/games`).set(auth(lou.token)).send({ kind: 'quiz' })).body;
    expect(game.state.total).toBe(4);
    expect(game.state.questions).toHaveLength(1);
    expect(game.state.questions[0].answer).toBeUndefined();
    const right = game.state.questions[0].choices.find((c) => c.id !== -1);
    const after = (await agent.post(`/api/games/${game.id}/move`).set(auth(ines.token)).send({ answer: right.id })).body;
    expect(after.state.questions[0].answer).toBeDefined();
    expect(after.state.answered).toBe(1);
  });

  it('runs Pictionary: only the drawer sees the word, guesses score', async () => {
    const { lou, ines, g } = await people();
    const game = (await agent.post(`/api/groups/${g.id}/games`).set(auth(lou.token)).send({ kind: 'pictionary' })).body;
    await agent.post(`/api/games/${game.id}/move`).set(auth(ines.token)).send({ action: 'join' });
    const started = (await agent.post(`/api/games/${game.id}/move`).set(auth(lou.token)).send({ action: 'start' })).body;
    expect(started.state).toMatchObject({ status: 'drawing', drawer: lou.user.id, round: 1 });
    const word = started.state.word;
    const guesser = (await agent.get(`/api/games/${game.id}`).set(auth(ines.token))).body;
    expect(guesser.state.word).toBeNull();
    expect(guesser.state.hint.length).toBe([...word].length);
    const wrong = (await agent.post(`/api/games/${game.id}/move`).set(auth(ines.token)).send({ guess: 'zzzzzz' })).body;
    expect(wrong.state.guesses.at(-1).result).toBe('no');
    const right = (await agent.post(`/api/games/${game.id}/move`).set(auth(ines.token)).send({ guess: word.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '') })).body;
    expect(right.state.status).toBe('between');
    expect(right.state.scores).toEqual({ [lou.user.id]: 2, [ines.user.id]: 5 });
  });

  it('guesses words with ligatures and shows the halfway hint and the server’s countdown', async () => {
    expect(fold('Cœur')).toBe('coeur');
    expect(fold('œuf')).toBe(fold('oeuf'));
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { lou, ines, g } = await people();
      const game = (await agent.post(`/api/groups/${g.id}/games`).set(auth(lou.token)).send({ kind: 'pictionary' })).body;
      await agent.post(`/api/games/${game.id}/move`).set(auth(ines.token)).send({ action: 'join' });
      const started = (await agent.post(`/api/games/${game.id}/move`).set(auth(lou.token)).send({ action: 'start' })).body.state;
      expect(started.remainingMs).toBe(80_000);
      const shown = (st) => st.hint.filter(Boolean).length;
      const before = (await agent.get(`/api/games/${game.id}`).set(auth(ines.token))).body.state;
      vi.setSystemTime(Date.now() + 41_000);
      const after = (await agent.get(`/api/games/${game.id}`).set(auth(ines.token))).body.state;
      expect(after.remainingMs).toBe(39_000);
      if ([...started.word].filter((c) => /\p{L}/u.test(c)).length > 4) expect(shown(after)).toBe(shown(before) + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('recap, export, live drawing, QR', () => {
  it('sums up the month and shares it', async () => {
    const { lou, ines, g } = await people();
    await say(ines.token, g.id, 'coucou');
    await agent.post(`/api/groups/${g.id}/media`).set(auth(lou.token)).field('type', 'drawing').attach('file', PNG, 'd.png');
    const r = (await agent.get(`/api/groups/${g.id}/recap`).set(auth(lou.token))).body;
    expect(r.stats).toMatchObject({ drawings: 1 });
    expect(r.badges.find((b) => b.kind === 'picasso').user.id).toBe(lou.user.id);
    const shared = (await agent.post(`/api/groups/${g.id}/recap/share`).set(auth(ines.token)).send({})).body;
    expect(shared).toMatchObject({ type: 'recap', meta: { month: r.month } });
  });

  it('exports the group as a .zip', async () => {
    const { lou, hugo, g } = await people();
    await say(lou.token, g.id, 'Salut les copines');
    await agent.post(`/api/groups/${g.id}/media`).set(auth(lou.token)).field('type', 'photo').attach('file', PNG, 'p.png');
    expect((await agent.get(`/api/groups/${g.id}/export`).set(auth(hugo.token))).status).toBe(404);
    const res = await agent.get(`/api/groups/${g.id}/export`).set(auth(lou.token)).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.headers['content-type']).toBe('application/zip');
    const zip = res.body;
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    const names = [];
    let off = zip.readUInt32LE(zip.length - 6);
    for (let i = 0; i < zip.readUInt16LE(zip.length - 12); i++) {
      const n = zip.readUInt16LE(off + 28);
      const local = zip.readUInt32LE(off + 42);
      const name = zip.subarray(off + 46, off + 46 + n).toString();
      names.push(name);
      if (name === 'messages.txt') {
        const ln = zip.readUInt16LE(local + 26);
        const size = zip.readUInt32LE(local + 18);
        const text = zlib.inflateRawSync(zip.subarray(local + 30 + ln, local + 30 + ln + size)).toString();
        expect(text).toContain('Lou : Salut les copines');
      }
      off += 46 + n;
    }
    expect(names.some((n) => /^media\/.*\.png$/.test(n))).toBe(true);
    expect(names).toContain('messages.json');
  });

  it('relays shared-drawing strokes and keeps them for latecomers', async () => {
    const { lou, ines, hugo, g } = await people();
    const s = (await agent.post(`/api/groups/${g.id}/live-draw`).set(auth(lou.token)).send({})).body;
    await new Promise((r) => papote.server.listen(0, '127.0.0.1', r));
    const port = papote.server.address().port;
    const open = (t) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: auth(t) });
        ws.events = [];
        ws.on('message', (m) => ws.events.push(JSON.parse(m.toString())));
        ws.on('open', () => resolve(ws));
      });
    const a = await open(lou.token);
    const b = await open(ines.token);
    const c = await open(hugo.token);
    a.send(JSON.stringify({ type: 'live', groupId: g.id, channel: 'draw', data: { sid: s.id, k: '1', c: '#FF7A93', w: 6, p: [1, 2, 3, 4] } }));
    a.send(JSON.stringify({ type: 'live', groupId: g.id, channel: 'draw', data: { sid: 'wrong', k: '2', p: [1, 2] } }));
    await until(() => b.events.some((e) => e.type === 'live'));
    expect(b.events.filter((e) => e.type === 'live')).toHaveLength(1);
    expect(c.events.some((e) => e.type === 'live')).toBe(false);
    const late = (await agent.get(`/api/groups/${g.id}/live-draw`).set(auth(ines.token))).body;
    expect(late.strokes).toEqual([{ u: lou.user.id, c: '#FF7A93', w: 6, t: 'pen', p: [1, 2, 3, 4] }]);
    await agent.post(`/api/groups/${g.id}/media`).set(auth(ines.token)).field('type', 'drawing').field('live', '1').attach('file', PNG, 'd.png');
    expect((await agent.get(`/api/groups/${g.id}/live-draw`).set(auth(ines.token))).body).toBeNull();
    for (const ws of [a, b, c]) ws.close();
  });

  it('draws QR codes for invitations', async () => {
    const { lou } = await people();
    const r = await agent.get('/api/qr').query({ data: 'https://papote.example/web/#/join?code=K7P2Q9' }).set(auth(lou.token));
    expect(r.headers['content-type']).toContain('image/svg+xml');
    expect(r.text ?? r.body.toString()).toContain('<svg');
    expect((await agent.get('/api/qr').query({ data: 'x' })).status).toBe(401);
  });
});
