import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
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
const now = () => new Date(2026, 9, 5, 12); // Mon Oct 5 2026

beforeEach(async () => {
  store = new Store(null);
  const ical = (await import('node-ical')).default;
  const feeds = new FeedService(60_000, async () => ical.sync.parseICS(ICS));
  app = createApp({ store, budget: new SampleBudgetProvider(store), feeds, now });
});

async function unlock(pin = '1234') {
  const res = await request(app).post('/api/parent/unlock').send({ pin });
  return res.body.token as string;
}

const kid = () => store.data.members.find((m) => m.role === 'kid')!;

describe('parent PIN', () => {
  it('rejects a wrong PIN and guards parent-only routes', async () => {
    expect((await request(app).post('/api/parent/unlock').send({ pin: '0000' })).status).toBe(403);
    expect((await request(app).get('/api/feeds/status')).status).toBe(401);
    const token = await unlock();
    expect((await request(app).get('/api/feeds/status').set('x-parent-token', token)).status).toBe(200);
  });
  it('can change the PIN', async () => {
    const token = await unlock();
    expect((await request(app).put('/api/settings').set('x-parent-token', token).send({ newPin: '12' })).status).toBe(400);
    await request(app).put('/api/settings').set('x-parent-token', token).send({ newPin: '4321' }).expect(200);
    expect((await request(app).post('/api/parent/unlock').send({ pin: '1234' })).status).toBe(403);
    expect(await unlock('4321')).toBeTruthy();
  });
});

describe('chores and rewards', () => {
  it('earns stars, needs approval where set, and spends them on screen time', async () => {
    const k = kid();
    const state = (await request(app).get('/api/state')).body;
    const mine = state.todayChores.filter((t: { memberId: string }) => t.memberId === k.id);
    expect(mine.length).toBeGreaterThan(0);
    const startStars = state.balances.find((b: { memberId: string }) => b.memberId === k.id).starsAvailable;

    for (const t of mine) {
      await request(app).post(`/api/chores/${t.chore.id}/complete`).send({ memberId: k.id }).expect(200);
    }
    let after = (await request(app).get('/api/state')).body;
    const bal = after.balances.find((b: { memberId: string }) => b.memberId === k.id);
    const instant = mine.filter((t: { chore: { needsApproval: boolean } }) => !t.chore.needsApproval)
      .reduce((s: number, t: { chore: { stars: number } }) => s + t.chore.stars, 0);
    expect(bal.starsAvailable).toBe(startStars + instant);

    const token = await unlock();
    for (const c of after.pendingCompletions) {
      await request(app).post(`/api/completions/${c.id}/approve`).set('x-parent-token', token).expect(200);
    }
    const screen = store.data.rewards.find((r) => r.kind === 'screen_time')!;
    const req = await request(app).post(`/api/rewards/${screen.id}/redeem`).send({ memberId: k.id }).expect(200);
    expect(req.body.status).toBe('requested');
    await request(app).post(`/api/redemptions/${req.body.id}/approve`).set('x-parent-token', token).expect(200);
    after = (await request(app).get('/api/state')).body;
    expect(after.balances.find((b: { memberId: string }) => b.memberId === k.id).screenMinutesBanked).toBe(screen.screenMinutes);

    await request(app).post('/api/screen-time/use').set('x-parent-token', token).send({ memberId: k.id, minutes: 10 }).expect(200);
    const tooMuch = await request(app).post('/api/screen-time/use').set('x-parent-token', token).send({ memberId: k.id, minutes: 999 });
    expect(tooMuch.status).toBe(400);
  });

  it("won't redeem without enough stars or complete someone else's chore", async () => {
    const k = kid();
    const big = store.data.rewards.reduce((a, b) => (a.cost > b.cost ? a : b));
    store.data.completions = [];
    expect((await request(app).post(`/api/rewards/${big.id}/redeem`).send({ memberId: k.id })).status).toBe(400);
    const notMine = store.data.chores.find((c) => !c.assigneeIds.includes(k.id))!;
    expect((await request(app).post(`/api/chores/${notMine.id}/complete`).send({ memberId: k.id })).status).toBe(400);
  });
});

describe('calendar', () => {
  it('merges family events with subscribed feeds', async () => {
    const k = kid();
    const token = await unlock();
    await request(app).put(`/api/members/${k.id}`).set('x-parent-token', token)
      .send({ ...k, calendarFeeds: ['https://example.com/school.ics'] }).expect(200);
    await request(app).post('/api/events').send({
      title: 'Dentist', allDay: false, start: new Date(2026, 9, 7, 15).toISOString(), end: new Date(2026, 9, 7, 16).toISOString(), memberIds: [k.id],
    }).expect(200);
    await request(app).post('/api/feeds/refresh').set('x-parent-token', token).expect(200);
    const res = await request(app).get('/api/events?from=2026-10-05&to=2026-10-12').expect(200);
    const titles = res.body.map((e: { title: string }) => e.title);
    expect(titles).toContain('Dentist');
    expect(titles).toContain('No school - teacher workday');
    expect(titles.filter((t: string) => t === 'Client call')).toHaveLength(3);
    const feedEv = res.body.find((e: { title: string }) => e.title.startsWith('No school'));
    expect(feedEv).toMatchObject({ allDay: true, start: '2026-10-09', readOnly: true, memberIds: [k.id] });
  });

  it('validates events', async () => {
    const res = await request(app).post('/api/events').send({ title: '', start: 'x', end: 'y' });
    expect(res.status).toBe(400);
  });
});

describe('allowance and savings goals', () => {
  it('shows allowance and goals to everyone, and no budget numbers', async () => {
    const res = await request(app).get('/api/allowance').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['allowances', 'currency', 'goals']);
    expect(res.body.allowances.length).toBeGreaterThan(0);
    expect(res.body.goals.length).toBeGreaterThan(0);
    expect((await request(app).get('/api/budget')).status).toBe(404);
  });
});

describe('meals and groceries', () => {
  it('adds the week’s ingredients to the grocery list without duplicates', async () => {
    const before = (await request(app).get('/api/groceries')).body.length;
    // The seed builds this week's meal plan from the real clock.
    const from = store.data.sample.meals.map((m) => m.date).sort()[0];
    const meals = (await request(app).get(`/api/meals?from=${from}&to=2099-01-01`)).body;
    expect(meals.length).toBeGreaterThan(0);
    const r1 = await request(app).post('/api/meals/add-ingredients').send({ from }).expect(200);
    expect(r1.body.added).toBeGreaterThan(0);
    const r2 = await request(app).post('/api/meals/add-ingredients').send({ from }).expect(200);
    expect(r2.body.added).toBe(0);
    const list = (await request(app).get('/api/groceries')).body;
    expect(list.length).toBe(before + r1.body.added);
    await request(app).patch(`/api/groceries/${list[0].id}`).send({ checked: true }).expect(200);
    await request(app).post('/api/groceries/clear-checked').expect(200);
    expect((await request(app).get('/api/groceries')).body.length).toBe(list.length - 1);
  });
});
