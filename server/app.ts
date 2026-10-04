import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import type {
  CalendarEvent,
  Chore,
  ChoreSchedule,
  Member,
  Reward,
  TodayChore,
} from '../shared/types.js';
import {
  addDays,
  computeBalance,
  computeStreak,
  expandEvents,
  fromDateKey,
  isChoreDue,
  sortOccurrences,
  toDateKey,
} from './domain.js';
import type { FeedService } from './feeds.js';
import type { BudgetProvider } from './integrations/budget/index.js';
import { hashPin, makePinSettings, newId, type Store } from './store.js';

const PARENT_SESSION_MS = 15 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function bad(message: string): never {
  throw new HttpError(400, message);
}

function str(v: unknown, field: string, { optional = false, max = 200 } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    bad(`${field} is required`);
  }
  if (typeof v !== 'string') bad(`${field} must be text`);
  const s = v.trim();
  if (!optional && !s) bad(`${field} is required`);
  if (s.length > max) bad(`${field} is too long`);
  return s;
}

function int(v: unknown, field: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(`${field} must be a whole number from ${min} to ${max}`);
  return n;
}

function dateKey(v: unknown, field: string): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) bad(`${field} must be YYYY-MM-DD`);
  return v;
}

function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  const item = list.find((x) => x.id === id);
  if (!item) throw new HttpError(404, `${what} not found`);
  return item;
}

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((body) => {
        if (!res.headersSent) res.json(body ?? { ok: true });
      })
      .catch(next);
  };

export interface AppDeps {
  store: Store;
  budget: BudgetProvider;
  feeds: FeedService;
  now?: () => Date;
}

export function createApp({ store, budget, feeds, now = () => new Date() }: AppDeps) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // ---- Parent unlock (PIN -> short-lived token) ----
  const sessions = new Map<string, number>();
  const failures = { count: 0, until: 0 };

  const isParent = (req: Request) => {
    const token = req.header('x-parent-token');
    if (!token) return false;
    const exp = sessions.get(token);
    if (!exp || exp < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  };
  const requireParent = (req: Request, _res: Response, next: NextFunction) => {
    if (!isParent(req)) return next(new HttpError(401, 'Parent PIN required'));
    next();
  };

  app.post(
    '/api/parent/unlock',
    h((req) => {
      if (Date.now() < failures.until) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
      const pin = str(req.body?.pin, 'PIN', { max: 12 });
      const s = store.data.settings;
      if (hashPin(pin, s.pinSalt) !== s.pinHash) {
        failures.count++;
        if (failures.count >= 5) {
          failures.until = Date.now() + 60_000;
          failures.count = 0;
        }
        throw new HttpError(403, 'Wrong PIN');
      }
      failures.count = 0;
      const token = randomBytes(24).toString('hex');
      const expiresAt = Date.now() + PARENT_SESSION_MS;
      sessions.set(token, expiresAt);
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    }),
  );
  app.post(
    '/api/parent/lock',
    h((req) => {
      const token = req.header('x-parent-token');
      if (token) sessions.delete(token);
    }),
  );

  // ---- Family state: everything the home screen needs in one call ----
  app.get(
    '/api/state',
    h((req) => {
      const d = store.data;
      const today = typeof req.query.date === 'string' && DATE_RE.test(req.query.date) ? req.query.date : toDateKey(now());
      const todayChores: TodayChore[] = [];
      for (const chore of d.chores) {
        if (!isChoreDue(chore, today)) continue;
        for (const memberId of chore.assigneeIds) {
          const completion = d.completions.find((c) => c.choreId === chore.id && c.memberId === memberId && c.date === today);
          todayChores.push({ chore, memberId, completion });
        }
      }
      return {
        today,
        settings: {
          familyName: d.settings.familyName,
          pinIsDefault: d.settings.pinIsDefault,
          weekStartsOn: d.settings.weekStartsOn,
        },
        parentUnlocked: isParent(req),
        members: d.members,
        chores: d.chores.filter((c) => !c.archived),
        rewards: d.rewards.filter((r) => !r.archived),
        todayChores,
        balances: d.members.map((m) => computeBalance(m.id, d.completions, d.redemptions, d.screenUses)),
        streaks: Object.fromEntries(d.members.map((m) => [m.id, computeStreak(m.id, d.chores, d.completions, today)])),
        pendingCompletions: d.completions.filter((c) => c.status === 'pending'),
        pendingRedemptions: d.redemptions.filter((r) => r.status === 'requested'),
        recentRedemptions: d.redemptions.filter((r) => r.status !== 'requested').slice(-20).reverse(),
      };
    }),
  );

  // ---- Calendar ----
  const allFeeds = () => store.data.members.flatMap((m) => m.calendarFeeds.map((url) => ({ url, memberId: m.id })));

  app.get(
    '/api/events',
    h(async (req) => {
      const from = dateKey(req.query.from, 'from');
      const to = dateKey(req.query.to, 'to');
      if (to <= from) bad('to must be after from');
      const fromD = fromDateKey(from);
      const toD = fromDateKey(to);
      if (toD.getTime() - fromD.getTime() > 62 * 86_400_000) bad('Range too large');
      const feedList = allFeeds();
      // Kick off a background refresh; serve whatever is cached right now.
      void feeds.refresh(feedList.map((f) => f.url));
      return sortOccurrences([...expandEvents(store.data.events, fromD, toD), ...feeds.occurrences(feedList, fromD, toD)]);
    }),
  );

  const parseEvent = (b: Record<string, unknown>): Omit<CalendarEvent, 'id'> => {
    const allDay = Boolean(b.allDay);
    const start = str(b.start, 'Start', { max: 40 });
    const end = str(b.end, 'End', { max: 40 });
    if (allDay) {
      dateKey(start, 'Start');
      dateKey(end, 'End');
      if (end <= start) bad('End must be after start');
    } else {
      const s = Date.parse(start);
      const e = Date.parse(end);
      if (Number.isNaN(s) || Number.isNaN(e)) bad('Start and end must be valid times');
      if (e < s) bad('End must be after start');
    }
    const recurrence = (b.recurrence ?? 'none') as CalendarEvent['recurrence'];
    if (!['none', 'daily', 'weekly', 'monthly'].includes(recurrence)) bad('Unknown repeat option');
    const memberIds = Array.isArray(b.memberIds) ? b.memberIds.filter((x): x is string => typeof x === 'string') : [];
    for (const m of memberIds) find(store.data.members, m, 'Family member');
    return {
      title: str(b.title, 'Title'),
      start,
      end,
      allDay,
      memberIds,
      location: str(b.location, 'Location', { optional: true }) || undefined,
      notes: str(b.notes, 'Notes', { optional: true, max: 2000 }) || undefined,
      recurrence,
      recurrenceUntil: b.recurrenceUntil ? dateKey(b.recurrenceUntil, 'Repeat until') : undefined,
    };
  };

  app.post('/api/events', h((req) => store.update((d) => {
    const ev: CalendarEvent = { id: newId(), ...parseEvent(req.body ?? {}) };
    d.events.push(ev);
    return ev;
  })));
  app.put('/api/events/:id', h((req) => store.update((d) => {
    const ev = find(d.events, req.params.id as string, 'Event');
    Object.assign(ev, parseEvent(req.body ?? {}), { id: ev.id });
    return ev;
  })));
  app.delete('/api/events/:id', h((req) => store.update((d) => {
    find(d.events, req.params.id as string, 'Event');
    d.events = d.events.filter((e) => e.id !== req.params.id);
  })));

  app.get('/api/feeds/status', requireParent, h(() => feeds.status(allFeeds())));
  app.post('/api/feeds/refresh', requireParent, h(async () => {
    const list = allFeeds();
    await feeds.refresh(list.map((f) => f.url), true);
    return feeds.status(list);
  }));

  // ---- Chores ----
  app.post(
    '/api/chores/:id/complete',
    h((req) => store.update((d) => {
      const chore = find(d.chores, req.params.id as string, 'Chore');
      const memberId = str(req.body?.memberId, 'memberId');
      const date = req.body?.date ? dateKey(req.body.date, 'date') : toDateKey(now());
      if (!chore.assigneeIds.includes(memberId)) bad('That chore is not assigned to this person');
      if (date > toDateKey(now())) bad("Can't complete a chore in the future");
      const existing = d.completions.find((c) => c.choreId === chore.id && c.memberId === memberId && c.date === date);
      if (existing) return existing;
      const completion = {
        id: newId(),
        choreId: chore.id,
        memberId,
        date,
        status: chore.needsApproval ? ('pending' as const) : ('approved' as const),
        stars: chore.stars,
        at: now().toISOString(),
      };
      d.completions.push(completion);
      return completion;
    })),
  );
  app.post(
    '/api/chores/:id/undo',
    h((req) => store.update((d) => {
      const memberId = str(req.body?.memberId, 'memberId');
      const date = req.body?.date ? dateKey(req.body.date, 'date') : toDateKey(now());
      const c = d.completions.find((x) => x.choreId === req.params.id && x.memberId === memberId && x.date === date);
      if (!c) return;
      // Kids can undo a tap by mistake; once a parent approved it, only a parent can.
      if (c.status === 'approved' && d.chores.find((x) => x.id === c.choreId)?.needsApproval && !isParent(req)) {
        throw new HttpError(401, 'Parent PIN required');
      }
      d.completions = d.completions.filter((x) => x.id !== c.id);
    })),
  );
  app.post('/api/completions/:id/approve', requireParent, h((req) => store.update((d) => {
    const c = find(d.completions, req.params.id as string, 'Completion');
    c.status = 'approved';
    return c;
  })));
  app.post('/api/completions/:id/reject', requireParent, h((req) => store.update((d) => {
    find(d.completions, req.params.id as string, 'Completion');
    d.completions = d.completions.filter((c) => c.id !== req.params.id);
  })));

  const parseChore = (b: Record<string, unknown>): Omit<Chore, 'id' | 'archived'> => {
    const s = (b.schedule ?? {}) as Record<string, unknown>;
    let schedule: ChoreSchedule;
    if (s.type === 'daily') schedule = { type: 'daily' };
    else if (s.type === 'weekly') {
      const days = Array.isArray(s.days) ? [...new Set(s.days.map((x) => int(x, 'Day', 0, 6)))].sort() : [];
      if (!days.length) bad('Pick at least one day');
      schedule = { type: 'weekly', days };
    } else if (s.type === 'once') schedule = { type: 'once', date: dateKey(s.date, 'Date') };
    else bad('Unknown schedule');
    const assigneeIds = Array.isArray(b.assigneeIds) ? b.assigneeIds.filter((x): x is string => typeof x === 'string') : [];
    if (!assigneeIds.length) bad('Assign the chore to someone');
    for (const m of assigneeIds) find(store.data.members, m, 'Family member');
    return {
      title: str(b.title, 'Title'),
      emoji: str(b.emoji, 'Emoji', { optional: true, max: 16 }) || '✅',
      assigneeIds,
      stars: int(b.stars ?? 1, 'Stars', 0, 100),
      schedule,
      needsApproval: Boolean(b.needsApproval),
    };
  };
  app.post('/api/chores', requireParent, h((req) => store.update((d) => {
    const chore: Chore = { id: newId(), archived: false, ...parseChore(req.body ?? {}) };
    d.chores.push(chore);
    return chore;
  })));
  app.put('/api/chores/:id', requireParent, h((req) => store.update((d) => {
    const chore = find(d.chores, req.params.id as string, 'Chore');
    Object.assign(chore, parseChore(req.body ?? {}));
    return chore;
  })));
  // Archive rather than delete so earned stars stay in history.
  app.delete('/api/chores/:id', requireParent, h((req) => store.update((d) => {
    find(d.chores, req.params.id as string, 'Chore').archived = true;
  })));

  // ---- Rewards ----
  app.post(
    '/api/rewards/:id/redeem',
    h((req) => store.update((d) => {
      const reward = find(d.rewards, req.params.id as string, 'Reward');
      if (reward.archived) bad('That reward is no longer available');
      const memberId = str(req.body?.memberId, 'memberId');
      find(d.members, memberId, 'Family member');
      const bal = computeBalance(memberId, d.completions, d.redemptions, d.screenUses);
      if (bal.starsAvailable < reward.cost) bad(`Needs ${reward.cost - bal.starsAvailable} more ⭐`);
      const redemption = {
        id: newId(),
        rewardId: reward.id,
        memberId,
        cost: reward.cost,
        screenMinutes: reward.kind === 'screen_time' ? reward.screenMinutes ?? 0 : 0,
        // A parent redeeming on a kid's behalf counts as approval.
        status: isParent(req) ? ('approved' as const) : ('requested' as const),
        at: now().toISOString(),
      };
      d.redemptions.push(redemption);
      return redemption;
    })),
  );
  app.post('/api/redemptions/:id/approve', requireParent, h((req) => store.update((d) => {
    const r = find(d.redemptions, req.params.id as string, 'Request');
    r.status = 'approved';
    return r;
  })));
  app.post('/api/redemptions/:id/deny', requireParent, h((req) => store.update((d) => {
    const r = find(d.redemptions, req.params.id as string, 'Request');
    r.status = 'denied';
    return r;
  })));
  app.post('/api/screen-time/use', requireParent, h((req) => store.update((d) => {
    const memberId = str(req.body?.memberId, 'memberId');
    find(d.members, memberId, 'Family member');
    const minutes = int(req.body?.minutes, 'Minutes', 1, 600);
    const bal = computeBalance(memberId, d.completions, d.redemptions, d.screenUses);
    if (minutes > bal.screenMinutesBanked) bad(`Only ${bal.screenMinutesBanked} minutes in the bank`);
    const use = { id: newId(), memberId, minutes, at: now().toISOString() };
    d.screenUses.push(use);
    return use;
  })));
  app.post('/api/stars/adjust', requireParent, h((req) => store.update((d) => {
    // Bonus stars ("great attitude today!") are recorded as an approved one-off completion.
    const memberId = str(req.body?.memberId, 'memberId');
    find(d.members, memberId, 'Family member');
    const stars = int(req.body?.stars, 'Stars', -100, 100);
    const reason = str(req.body?.reason, 'Reason', { optional: true }) || 'Bonus';
    const chore: Chore = { id: newId(), title: reason, emoji: stars >= 0 ? '🌟' : '➖', assigneeIds: [memberId], stars, schedule: { type: 'once', date: toDateKey(now()) }, needsApproval: false, archived: true };
    d.chores.push(chore);
    d.completions.push({ id: newId(), choreId: chore.id, memberId, date: toDateKey(now()), status: 'approved', stars, at: now().toISOString() });
  })));

  const parseReward = (b: Record<string, unknown>): Omit<Reward, 'id' | 'archived'> => {
    const kind = b.kind as Reward['kind'];
    if (!['screen_time', 'privilege', 'activity', 'treat'].includes(kind)) bad('Unknown reward type');
    return {
      title: str(b.title, 'Title'),
      emoji: str(b.emoji, 'Emoji', { optional: true, max: 16 }) || '🎁',
      cost: int(b.cost, 'Cost', 1, 1000),
      kind,
      screenMinutes: kind === 'screen_time' ? int(b.screenMinutes, 'Minutes', 1, 600) : undefined,
    };
  };
  app.post('/api/rewards', requireParent, h((req) => store.update((d) => {
    const reward: Reward = { id: newId(), archived: false, ...parseReward(req.body ?? {}) };
    d.rewards.push(reward);
    return reward;
  })));
  app.put('/api/rewards/:id', requireParent, h((req) => store.update((d) => {
    const reward = find(d.rewards, req.params.id as string, 'Reward');
    Object.assign(reward, parseReward(req.body ?? {}));
    return reward;
  })));
  app.delete('/api/rewards/:id', requireParent, h((req) => store.update((d) => {
    find(d.rewards, req.params.id as string, 'Reward').archived = true;
  })));

  // ---- Family members & settings ----
  const parseMember = (b: Record<string, unknown>): Omit<Member, 'id'> => {
    const color = str(b.color, 'Color', { max: 7 });
    if (!HEX_RE.test(color)) bad('Color must look like #3366ff');
    const role = b.role === 'parent' ? 'parent' : 'kid';
    const calendarFeeds = Array.isArray(b.calendarFeeds)
      ? b.calendarFeeds.map((u) => str(u, 'Calendar link', { max: 2000 })).filter(Boolean)
      : [];
    for (const u of calendarFeeds) {
      if (!/^(https?|webcal):\/\//i.test(u)) bad('Calendar links must start with https:// or webcal://');
    }
    return { name: str(b.name, 'Name', { max: 40 }), color, emoji: str(b.emoji, 'Emoji', { optional: true, max: 16 }) || '🙂', role, calendarFeeds };
  };
  app.post('/api/members', requireParent, h((req) => store.update((d) => {
    const m: Member = { id: newId(), ...parseMember(req.body ?? {}) };
    d.members.push(m);
    return m;
  })));
  app.put('/api/members/:id', requireParent, h((req) => store.update((d) => {
    const m = find(d.members, req.params.id as string, 'Family member');
    Object.assign(m, parseMember(req.body ?? {}));
    return m;
  })));
  app.delete('/api/members/:id', requireParent, h((req) => store.update((d) => {
    const id = req.params.id as string;
    find(d.members, id, 'Family member');
    if (d.members.filter((m) => m.role === 'parent' && m.id !== id).length === 0 && d.members.find((m) => m.id === id)?.role === 'parent') {
      bad('Keep at least one parent');
    }
    d.members = d.members.filter((m) => m.id !== id);
    for (const c of d.chores) c.assigneeIds = c.assigneeIds.filter((x) => x !== id);
    for (const e of d.events) e.memberIds = e.memberIds.filter((x) => x !== id);
  })));

  app.put('/api/settings', requireParent, h((req) => store.update((d) => {
    const b = req.body ?? {};
    if (b.familyName !== undefined) d.settings.familyName = str(b.familyName, 'Family name', { max: 60 });
    if (b.weekStartsOn !== undefined) d.settings.weekStartsOn = b.weekStartsOn === 1 ? 1 : 0;
    if (b.newPin !== undefined) {
      const pin = str(b.newPin, 'PIN', { max: 12 });
      if (!/^\d{4,8}$/.test(pin)) bad('PIN must be 4 to 8 digits');
      Object.assign(d.settings, makePinSettings(pin), { pinIsDefault: false });
    }
  })));

  // ---- Meals, groceries, budget (via the budget integration) ----
  app.get('/api/integration', h(() => budget.info()));

  app.get('/api/meals', h((req) => budget.getMeals(dateKey(req.query.from, 'from'), dateKey(req.query.to, 'to'))));
  const parseMeal = (b: Record<string, unknown>) => {
    const slot = b.slot as 'breakfast' | 'lunch' | 'dinner';
    if (!['breakfast', 'lunch', 'dinner'].includes(slot)) bad('Pick breakfast, lunch or dinner');
    const ingredients = Array.isArray(b.ingredients)
      ? b.ingredients.map((x) => str(x, 'Ingredient', { optional: true })).filter(Boolean)
      : [];
    return { date: dateKey(b.date, 'Date'), slot, title: str(b.title, 'Meal'), ingredients, notes: str(b.notes, 'Notes', { optional: true, max: 1000 }) || undefined };
  };
  app.post('/api/meals', h((req) => budget.saveMeal(parseMeal(req.body ?? {}))));
  app.put('/api/meals/:id', h((req) => budget.saveMeal({ ...parseMeal(req.body ?? {}), id: req.params.id as string })));
  app.delete('/api/meals/:id', h((req) => budget.deleteMeal(req.params.id as string)));
  app.post(
    '/api/meals/add-ingredients',
    h(async (req) => {
      const from = dateKey(req.body?.from, 'from');
      const to = dateKey(req.body?.to ?? addDays(from, 7), 'to');
      const meals = await budget.getMeals(from, to);
      const names = [...new Set(meals.flatMap((m) => m.ingredients.map((i) => i.trim())).filter(Boolean))];
      const added = await budget.addGroceries(names.map((name) => ({ name, category: 'From meal plan' })));
      return { added: added.length };
    }),
  );

  app.get('/api/groceries', h(() => budget.getGroceries()));
  app.post('/api/groceries', h((req) => budget.addGroceries([{
    name: str(req.body?.name, 'Item', { max: 80 }),
    quantity: str(req.body?.quantity, 'Quantity', { optional: true, max: 40 }) || undefined,
    category: str(req.body?.category, 'Category', { optional: true, max: 40 }) || undefined,
    addedBy: str(req.body?.addedBy, 'addedBy', { optional: true, max: 60 }) || undefined,
  }])));
  app.patch('/api/groceries/:id', h((req) => {
    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (b.checked !== undefined) patch.checked = Boolean(b.checked);
    if (b.name !== undefined) patch.name = str(b.name, 'Item', { max: 80 });
    if (b.quantity !== undefined) patch.quantity = str(b.quantity, 'Quantity', { optional: true, max: 40 }) || undefined;
    return budget.updateGrocery(req.params.id as string, patch);
  }));
  app.delete('/api/groceries/:id', h((req) => budget.deleteGrocery(req.params.id as string)));
  app.post('/api/groceries/clear-checked', h(() => budget.clearCheckedGroceries()));

  // Money stays behind the parent PIN.
  app.get('/api/budget', requireParent, h(() => budget.getBudgetSummary()));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) && !err.status ? 'Something went wrong' : err.message });
  });

  return app;
}
