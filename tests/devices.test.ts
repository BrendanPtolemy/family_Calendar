import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { DeviceAuth, formatCode, newPairingCode, readCodeFile, sha256, writeCodeFile } from '../server/devices.js';
import { FeedService } from '../server/feeds.js';
import { SampleBudgetProvider } from '../server/integrations/budget/sample.js';
import { Store } from '../server/store.js';

let store: Store;
let devices: DeviceAuth;
let app: ReturnType<typeof createApp>;
let dir: string;
const now = () => new Date(2026, 9, 5, 12); // Mon Oct 5 2026

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cal-devices-'));
  store = new Store(null);
  devices = new DeviceAuth(store, join(dir, 'pairing-codes.json'));
  app = createApp({ store, budget: new SampleBudgetProvider(store), feeds: new FeedService(60_000, async () => ({})), now, devices });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function paired(name = 'Tablet') {
  const agent = request.agent(app);
  await agent.post('/api/pair').send({ code: devices.createCode(name).code, name }).expect(200);
  return agent;
}

async function parentToken(agent: ReturnType<typeof request.agent>, pin = '1234') {
  const res = await agent.post('/api/parent/unlock').send({ pin });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe('device pairing', () => {
  it('refuses every API route without a paired device', async () => {
    for (const [method, path] of [['get', '/api/state'], ['get', '/api/events?from=2026-10-01&to=2026-10-08'], ['get', '/api/groceries'], ['post', '/api/parent/unlock'], ['post', '/api/events'], ['get', '/api/devices']] as const) {
      const res = await request(app)[method](path).send({ pin: '1234' });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body.code).toBe('pair');
    }
    expect((await request(app).get('/api/session')).body).toEqual({ paired: false });
  });

  it('a code works once, and a forged or stale cookie does not', async () => {
    const { code } = devices.createCode('Phone');
    const a = request.agent(app);
    await a.post('/api/pair').send({ code: code.toLowerCase().replace('-', ' ') }).expect(200);
    expect((await a.get('/api/state')).status).toBe(200);
    expect((await request(app).post('/api/pair').send({ code })).status).toBe(403);
    expect((await request(app).get('/api/state').set('Cookie', 'fc_device=not-a-real-token')).status).toBe(401);
  });

  it('accepts codes from `npm run pair` (the file) exactly once', async () => {
    const code = newPairingCode();
    writeCodeFile(join(dir, 'pairing-codes.json'), [{ hash: sha256(code), name: 'Kitchen tablet', expiresAt: Date.now() + 60_000 }]);
    const a = request.agent(app);
    const res = await a.post('/api/pair').send({ code: formatCode(code) }).expect(200);
    expect(res.body.deviceName).toBe('Kitchen tablet');
    expect(readCodeFile(join(dir, 'pairing-codes.json'))).toHaveLength(0);
    expect((await request(app).post('/api/pair').send({ code })).status).toBe(403);
  });

  it('ignores expired file codes', async () => {
    const code = newPairingCode();
    writeCodeFile(join(dir, 'pairing-codes.json'), [{ hash: sha256(code), name: 'Old', expiresAt: Date.now() - 1 }]);
    expect((await request(app).post('/api/pair').send({ code })).status).toBe(403);
  });

  it('rate limits wrong codes', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await request(app).post('/api/pair').send({ code: 'AAAA-AAAA' })).status;
    expect(last).toBe(429);
  });

  it('only parents create codes, and not while the PIN is still 1234', async () => {
    const a = await paired();
    expect((await a.post('/api/devices/pair-code').send({})).status).toBe(401);
    const token = await parentToken(a);
    const blocked = await a.post('/api/devices/pair-code').set('x-parent-token', token).send({});
    expect(blocked.status).toBe(400);
    await a.put('/api/settings').set('x-parent-token', token).send({ newPin: '8642' }).expect(200);
    const ok = await a.post('/api/devices/pair-code').set('x-parent-token', token).send({ name: 'Mum phone' }).expect(200);
    expect(ok.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('a disconnected device loses access immediately', async () => {
    const tablet = await paired('Tablet');
    const phone = await paired('Phone');
    const token = await parentToken(tablet);
    const list = (await tablet.get('/api/devices').set('x-parent-token', token).expect(200)).body as { id: string; name: string; current: boolean }[];
    expect(list.find((d) => d.current)?.name).toBe('Tablet');
    const phoneId = list.find((d) => d.name === 'Phone')!.id;
    await tablet.delete(`/api/devices/${phoneId}`).set('x-parent-token', token).expect(200);
    expect((await phone.get('/api/state')).status).toBe(401);
    expect((await tablet.get('/api/state')).status).toBe(200);
  });
});

describe('parent mode on top of pairing', () => {
  it('a parent token only works on the device that entered the PIN', async () => {
    const tablet = await paired('Tablet');
    const phone = await paired('Phone');
    const token = await parentToken(tablet);
    expect((await tablet.get('/api/budget').set('x-parent-token', token)).status).toBe(200);
    expect((await phone.get('/api/budget').set('x-parent-token', token)).status).toBe(401);
  });

  it('wrong PINs lock that device out, for longer each time', async () => {
    const a = await paired();
    for (let i = 0; i < 5; i++) expect((await a.post('/api/parent/unlock').send({ pin: '0000' })).status).toBe(403);
    expect((await a.post('/api/parent/unlock').send({ pin: '1234' })).status).toBe(429);
    // Another device isn't affected.
    const b = await paired('Other');
    expect((await b.post('/api/parent/unlock').send({ pin: '1234' })).status).toBe(200);
  });

  it('hides secret calendar links unless in parent mode', async () => {
    const a = await paired();
    store.data.members[0].calendarFeeds = ['https://calendar.google.com/calendar/ical/secret-token/basic.ics'];
    const kidView = (await a.get('/api/state').expect(200)).body;
    expect(JSON.stringify(kidView)).not.toContain('secret-token');
    expect(kidView.members[0].calendarFeeds).toHaveLength(1);
    const token = await parentToken(a);
    const parentView = (await a.get('/api/state').set('x-parent-token', token).expect(200)).body;
    expect(parentView.members[0].calendarFeeds[0]).toContain('secret-token');
  });

  it('kids can catch up on yesterday but not backfill older days', async () => {
    const a = await paired();
    const kid = store.data.members.find((m) => m.role === 'kid')!;
    const daily = store.data.chores.find((c) => c.schedule.type === 'daily' && c.assigneeIds.includes(kid.id))!;
    await a.post(`/api/chores/${daily.id}/complete`).send({ memberId: kid.id, date: '2026-10-04' }).expect(200);
    expect((await a.post(`/api/chores/${daily.id}/complete`).send({ memberId: kid.id, date: '2026-09-01' })).status).toBe(401);
    const token = await parentToken(a);
    await a.post(`/api/chores/${daily.id}/complete`).set('x-parent-token', token).send({ memberId: kid.id, date: '2026-09-01' }).expect(200);
  });
});

describe('device cookie', () => {
  it('is Secure only when the request came over HTTPS through a trusted proxy', async () => {
    const plain = await request(app).post('/api/pair').send({ code: devices.createCode('A').code });
    expect(String(plain.headers['set-cookie'])).not.toMatch(/Secure/i);
    const tls = await request(app).post('/api/pair').set('X-Forwarded-Proto', 'https').send({ code: devices.createCode('B').code });
    expect(String(tls.headers['set-cookie'])).toMatch(/Secure/i);
    expect(String(tls.headers['set-cookie'])).toMatch(/HttpOnly/i);
  });
});

