import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { DeviceAuth } from '../server/devices.js';
import { FeedService } from '../server/feeds.js';
import { SampleBudgetProvider } from '../server/integrations/budget/sample.js';
import { Store } from '../server/store.js';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:school-1
DTSTART;VALUE=DATE:20261009
DTEND;VALUE=DATE:20261010
SUMMARY:No school - teacher workday
END:VEVENT
BEGIN:VEVENT
UID:work-1
DTSTART:20261005T140000Z
DTEND:20261005T150000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Client call
END:VEVENT
END:VCALENDAR`;

let store: Store;
let app: ReturnType<typeof createApp>;
let devices: DeviceAuth;
/** A paired device: every existing test runs as one. */
let agent: ReturnType<typeof request.agent>;
const now = () => new Date(2026, 9, 5, 12); // Mon Oct 5 2026

beforeEach(async () => {
  store = new Store(null);
  const ical = (await import('node-ical')).default;
  const feeds = new FeedService(60_000, async () => ical.sync.parseICS(ICS));
  devices = new DeviceAuth(store, null, false);
  app = createApp({ store, budget: new SampleBudgetProvider(store), feeds, now, devices });
  agent = request.agent(app);
  await agent.post('/api/pair').send({ code: devices.createCode('Test tablet').code }).expect(200);
});

async function unlock(pin = '1234') {
  const res = await agent.post('/api/parent/unlock').send({ pin });
  return res.body.token as string;
}

const kid = () => store.data.members.find((m) => m.role === 'kid')!;

describe('parent PIN', () => {
  it('rejects a wrong PIN and guards parent-only routes', async () => {
    expect((await agent.post('/api/parent/unlock').send({ pin: '0000' })).status).toBe(403);
    expect((await agent.get('/api/budget')).status).toBe(401);
    const token = await unlock();
    const res = await agent.get('/api/budget').set('x-parent-token', token);
    expect(res.status).toBe(200);
    expect(res.body.categories.length).toBeGreaterThan(0);
  });
  it('can change the PIN', async () => {
    const token = await unlock();
    expect((await agent.put('/api/settings').set('x-parent-token', token).send({ newPin: '12' })).status).toBe(400);
    await agent.put('/api/settings').set('x-parent-token', token).send({ newPin: '4321' }).expect(200);
    expect((await agent.post('/api/parent/unlock').send({ pin: '1234' })).status).toBe(403);
    expect(await unlock('4321')).toBeTruthy();
  });
});

describe('chores and rewards', () => {
  it('earns stars, needs approval where set, and spends them on screen time', async () => {
    const k = kid();
    const state = (await agent.get('/api/state')).body;
    const mine = state.todayChores.filter((t: { memberId: string }) => t.memberId === k.id);
    expect(mine.length).toBeGreaterThan(0);
    const startStars = state.balances.find((b: { memberId: string }) => b.memberId === k.id).starsAvailable;

    for (const t of mine) {
      await agent.post(`/api/chores/${t.chore.id}/complete`).send({ memberId: k.id }).expect(200);
    }
    let after = (await agent.get('/api/state')).body;
    const bal = after.balances.find((b: { memberId: string }) => b.memberId === k.id);
    const instant = mine.filter((t: { chore: { needsApproval: boolean } }) => !t.chore.needsApproval)
      .reduce((s: number, t: { chore: { stars: number } }) => s + t.chore.stars, 0);
    expect(bal.starsAvailable).toBe(startStars + instant);

    const token = await unlock();
    for (const c of after.pendingCompletions) {
      await agent.post(`/api/completions/${c.id}/approve`).set('x-parent-token', token).expect(200);
    }
    const screen = store.data.rewards.find((r) => r.kind === 'screen_time')!;
    const req = await agent.post(`/api/rewards/${screen.id}/redeem`).send({ memberId: k.id }).expect(200);
    expect(req.body.status).toBe('requested');
    await agent.post(`/api/redemptions/${req.body.id}/approve`).set('x-parent-token', token).expect(200);
    after = (await agent.get('/api/state')).body;
    expect(after.balances.find((b: { memberId: string }) => b.memberId === k.id).screenMinutesBanked).toBe(screen.screenMinutes);

    await agent.post('/api/screen-time/use').set('x-parent-token', token).send({ memberId: k.id, minutes: 10 }).expect(200);
    const tooMuch = await agent.post('/api/screen-time/use').set('x-parent-token', token).send({ memberId: k.id, minutes: 999 });
    expect(tooMuch.status).toBe(400);
  });

  it("won't redeem without enough stars or complete someone else's chore", async () => {
    const k = kid();
    const big = store.data.rewards.reduce((a, b) => (a.cost > b.cost ? a : b));
    store.data.completions = [];
    expect((await agent.post(`/api/rewards/${big.id}/redeem`).send({ memberId: k.id })).status).toBe(400);
    const notMine = store.data.chores.find((c) => !c.assigneeIds.includes(k.id))!;
    expect((await agent.post(`/api/chores/${notMine.id}/complete`).send({ memberId: k.id })).status).toBe(400);
  });
});

describe('calendar', () => {
  it('merges family events with subscribed feeds', async () => {
    const k = kid();
    const token = await unlock();
    await agent.put(`/api/members/${k.id}`).set('x-parent-token', token)
      .send({ ...k, calendarFeeds: ['https://example.com/school.ics'] }).expect(200);
    await agent.post('/api/events').send({
      title: 'Dentist', allDay: false, start: new Date(2026, 9, 7, 15).toISOString(), end: new Date(2026, 9, 7, 16).toISOString(), memberIds: [k.id],
    }).expect(200);
    await agent.post('/api/feeds/refresh').set('x-parent-token', token).expect(200);
    const res = await agent.get('/api/events?from=2026-10-05&to=2026-10-12').expect(200);
    const titles = res.body.map((e: { title: string }) => e.title);
    expect(titles).toContain('Dentist');
    expect(titles).toContain('No school - teacher workday');
    expect(titles.filter((t: string) => t === 'Client call')).toHaveLength(3);
    const feedEv = res.body.find((e: { title: string }) => e.title.startsWith('No school'));
    expect(feedEv).toMatchObject({ allDay: true, start: '2026-10-09', readOnly: true, memberIds: [k.id] });
  });

  it('validates events', async () => {
    const res = await agent.post('/api/events').send({ title: '', start: 'x', end: 'y' });
    expect(res.status).toBe(400);
  });
});

describe('meals and groceries', () => {
  it('adds the week’s ingredients to the grocery list without duplicates', async () => {
    const before = (await agent.get('/api/groceries')).body.length;
    // The seed builds this week's meal plan from the real clock.
    const from = store.data.sample.meals.map((m) => m.date).sort()[0];
    const meals = (await agent.get(`/api/meals?from=${from}&to=2099-01-01`)).body;
    expect(meals.length).toBeGreaterThan(0);
    const r1 = await agent.post('/api/meals/add-ingredients').send({ from }).expect(200);
    expect(r1.body.added).toBeGreaterThan(0);
    const r2 = await agent.post('/api/meals/add-ingredients').send({ from }).expect(200);
    expect(r2.body.added).toBe(0);
    const list = (await agent.get('/api/groceries')).body;
    expect(list.length).toBe(before + r1.body.added);
    await agent.patch(`/api/groceries/${list[0].id}`).send({ checked: true }).expect(200);
    await agent.post('/api/groceries/clear-checked').expect(200);
    expect((await agent.get('/api/groceries')).body.length).toBe(list.length - 1);
  });
});
