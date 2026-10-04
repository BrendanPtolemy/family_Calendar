// Runs the family_saas connector against a small stand-in of the family_saas
// API (same routes, payload shapes and cookie login as the real app).

import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FamilySaasProvider } from '../server/integrations/budget/family-saas.js';

interface Db {
  lists: { id: number; name: string; status: string; created_at: string }[];
  items: { id: number; list_id: number; name: string; quantity: string | null; checked: number; added_by: null }[];
  recipes: { id: number; name: string; ingredients: { name: string; quantity: string | null; unit: string | null }[] }[];
  plans: { id: number; name: string; start_date: string }[];
  slots: { meal_plan_id: number; day_offset: number; slot: string; recipe_id: number | null; custom_meal: string | null; notes: string | null }[];
}

let db: Db;
let seq = 100;
let logins = 0;
const budgetCalls: string[] = [];
let validToken = 'tok-1';
let server: Server;
let baseUrl: string;

function fakeSaas() {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    if (req.header('x-tenant') !== 'ptolemy') return res.status(404).json({ error: 'Unknown tenant' });
    next();
  });
  app.post('/api/auth/login', (req, res) => {
    if (req.body.username !== 'wall' || req.body.password !== 'secret123') return res.status(401).json({ error: 'Invalid username or password' });
    logins++;
    res.cookie('budget_session', validToken, { httpOnly: true });
    res.json({ user: { id: 1 } });
  });
  app.use('/api', (req, res, next) => {
    if (req.header('authorization') !== `Bearer ${validToken}`) return res.status(401).json({ error: 'Session expired' });
    next();
  });
  app.get('/api/auth/me', (_req, res) => res.json({ user: { id: 1 } }));
  app.get('/api/grocery/lists', (_req, res) => res.json([...db.lists].reverse()));
  app.get('/api/grocery/lists/:id', (req, res) => {
    const list = db.lists.find((l) => l.id === Number(req.params.id));
    if (!list) return res.status(404).json({ error: 'List not found' });
    res.json({ ...list, items: db.items.filter((i) => i.list_id === list.id) });
  });
  app.post('/api/grocery/lists', (req, res) => {
    const id = ++seq;
    db.lists.push({ id, name: req.body.name, status: 'active', created_at: '2026-10-04 20:00:00' });
    res.json({ id });
  });
  app.post('/api/grocery/lists/:id/items', (req, res) => {
    const id = ++seq;
    db.items.push({ id, list_id: Number(req.params.id), name: req.body.name, quantity: req.body.quantity, checked: 0, added_by: null });
    res.json({ id });
  });
  app.put('/api/grocery/lists/:id/items/:itemId', (req, res) => {
    const it = db.items.find((i) => i.id === Number(req.params.itemId) && i.list_id === Number(req.params.id));
    if (it && req.body.checked != null) it.checked = req.body.checked ? 1 : 0;
    if (it && req.body.name != null) it.name = req.body.name;
    res.json({ ok: true });
  });
  app.delete('/api/grocery/lists/:id/items/:itemId', (req, res) => {
    db.items = db.items.filter((i) => !(i.id === Number(req.params.itemId) && i.list_id === Number(req.params.id)));
    res.json({ ok: true });
  });
  app.get('/api/grocery/recipes', (_req, res) => res.json(db.recipes.map(({ id, name }) => ({ id, name }))));
  app.get('/api/grocery/recipes/:id', (req, res) => res.json(db.recipes.find((r) => r.id === Number(req.params.id))));
  app.get('/api/grocery/meal-plans', (_req, res) =>
    res.json(
      db.plans.map((p) => ({
        ...p,
        slots: db.slots
          .filter((s) => s.meal_plan_id === p.id)
          .map((s) => ({ ...s, recipe_name: db.recipes.find((r) => r.id === s.recipe_id)?.name ?? null })),
      })),
    ),
  );
  app.post('/api/grocery/meal-plans', (req, res) => {
    const id = ++seq;
    db.plans.push({ id, name: req.body.name, start_date: req.body.start_date });
    res.json({ id });
  });
  app.put('/api/grocery/meal-plans/:id/slots', (req, res) => {
    const s = { meal_plan_id: Number(req.params.id), day_offset: req.body.day_offset, slot: req.body.slot, recipe_id: req.body.recipe_id || null, custom_meal: req.body.custom_meal || null, notes: req.body.notes || null };
    db.slots = db.slots.filter((x) => !(x.meal_plan_id === s.meal_plan_id && x.day_offset === s.day_offset && x.slot === s.slot));
    db.slots.push(s);
    res.json({ ok: true });
  });
  app.delete('/api/grocery/meal-plans/:id/slots', (req, res) => {
    db.slots = db.slots.filter((x) => !(x.meal_plan_id === Number(req.params.id) && x.day_offset === req.body.day_offset && x.slot === req.body.slot));
    res.json({ ok: true });
  });
  app.get('/api/recurring', (_req, res) =>
    res.json([
      { name: "Emma's allowance", amount: 20, frequency: 'biweekly', next_due: '2026-10-15', is_active: 1, is_income: 0, category_name: 'Allowance', member_name: 'Emma' },
      { name: 'Old allowance', amount: 5, frequency: 'weekly', next_due: '2026-10-06', is_active: 0, is_income: 0, category_name: 'Allowance', member_name: null },
      { name: 'Mortgage', amount: 2100, frequency: 'monthly', next_due: '2026-11-01', is_active: 1, is_income: 0, category_name: 'Mortgage', member_name: null },
      { name: 'Paycheque', amount: 3000, frequency: 'biweekly', next_due: '2026-10-09', is_active: 1, is_income: 1, category_name: 'Salary', member_name: 'Brendan' },
    ]),
  );
  app.get('/api/budget/goals', (_req, res) => res.json([{ id: 1, name: 'Trip', icon: '🏝️', target: 4000, current: 1000, target_date: '2027-06-01', member_name: null }]));
  // Budget numbers must never be requested.
  app.use(['/api/reports', '/api/budget/summary', '/api/budget/transactions', '/api/budget/budget-lines'], (req, res) => {
    budgetCalls.push(req.originalUrl);
    res.status(500).json({ error: 'budget data requested' });
  });
  return app;
}

beforeAll(async () => {
  server = fakeSaas().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

beforeEach(() => {
  logins = 0;
  validToken = 'tok-1';
  db = {
    lists: [
      { id: 1, name: 'Costco', status: 'active', created_at: '2026-10-01 10:00:00' },
      { id: 2, name: 'Old trip', status: 'completed', created_at: '2026-09-01 10:00:00' },
      { id: 3, name: 'Weekly', status: 'active', created_at: '2026-10-03 10:00:00' },
    ],
    items: [
      { id: 10, list_id: 1, name: 'Paper towels', quantity: null, checked: 0, added_by: null },
      { id: 11, list_id: 2, name: 'Old thing', quantity: null, checked: 1, added_by: null },
      { id: 12, list_id: 3, name: 'Milk', quantity: '2', checked: 0, added_by: null },
      { id: 13, list_id: 3, name: 'Eggs', quantity: null, checked: 1, added_by: null },
    ],
    recipes: [{ id: 7, name: 'Chili', ingredients: [{ name: 'Beans', quantity: '2', unit: 'cans' }, { name: 'Ground beef', quantity: '1', unit: 'lb' }] }],
    plans: [{ id: 50, name: 'Week of Oct 4', start_date: '2026-10-04' }],
    slots: [
      { meal_plan_id: 50, day_offset: 0, slot: 'dinner', recipe_id: 7, custom_meal: null, notes: null },
      { meal_plan_id: 50, day_offset: 2, slot: 'lunch', recipe_id: null, custom_meal: 'Leftovers', notes: 'fridge' },
    ],
  };
});

const provider = () => new FamilySaasProvider({ baseUrl, tenant: 'ptolemy', username: 'wall', password: 'secret123', currency: 'CAD' });

describe('family_saas connector', () => {
  it('signs in once and reports connected', async () => {
    const p = provider();
    expect(await p.info()).toMatchObject({ provider: 'family_saas', connected: true, mealIngredientsEditable: false });
    await p.getGroceries();
    expect(logins).toBe(1);
  });

  it('reports a bad password as not connected', async () => {
    const p = new FamilySaasProvider({ baseUrl, tenant: 'ptolemy', username: 'wall', password: 'nope' });
    const info = await p.info();
    expect(info.connected).toBe(false);
    expect(info.message).toContain('Invalid username or password');
  });

  it('logs in again when the session expires', async () => {
    const p = provider();
    await p.getGroceries();
    validToken = 'tok-2';
    await p.getGroceries();
    expect(logins).toBe(2);
  });

  it('reads meal plans as dated meals with recipe ingredients', async () => {
    const meals = await provider().getMeals('2026-10-04', '2026-10-11');
    expect(meals).toEqual([
      { id: '50:0:dinner', date: '2026-10-04', slot: 'dinner', title: 'Chili', ingredients: ['Beans', 'Ground beef'], notes: undefined },
      { id: '50:2:lunch', date: '2026-10-06', slot: 'lunch', title: 'Leftovers', ingredients: [], notes: 'fridge' },
    ]);
    expect(await provider().getMeals('2026-10-05', '2026-10-06')).toEqual([]);
  });

  it('plans meals into the right week, linking saved recipes', async () => {
    const p = provider();
    const m = await p.saveMeal({ date: '2026-10-07', slot: 'dinner', title: 'chili', ingredients: [] });
    expect(m).toMatchObject({ id: '50:3:dinner', title: 'Chili', ingredients: ['Beans', 'Ground beef'] });
    expect(db.slots.find((s) => s.day_offset === 3)).toMatchObject({ recipe_id: 7, custom_meal: null });

    // A date outside every plan creates a new Sunday-start week plan.
    const next = await p.saveMeal({ date: '2026-10-14', slot: 'lunch', title: 'Soup', ingredients: [] });
    const plan = db.plans.find((x) => x.start_date === '2026-10-11');
    expect(plan).toBeTruthy();
    expect(next.id).toBe(`${plan!.id}:3:lunch`);
    expect(db.slots.find((s) => s.meal_plan_id === plan!.id)).toMatchObject({ custom_meal: 'Soup', recipe_id: null });

    // Moving a meal clears its old spot.
    await p.saveMeal({ id: '50:2:lunch', date: '2026-10-06', slot: 'dinner', title: 'Leftovers', ingredients: [] });
    expect(db.slots.some((s) => s.meal_plan_id === 50 && s.day_offset === 2 && s.slot === 'lunch')).toBe(false);
    expect(db.slots.some((s) => s.meal_plan_id === 50 && s.day_offset === 2 && s.slot === 'dinner')).toBe(true);

    await p.deleteMeal('50:0:dinner');
    expect(db.slots.some((s) => s.meal_plan_id === 50 && s.day_offset === 0)).toBe(false);
  });

  it('shows items from every active list, grouped by list', async () => {
    const items = await provider().getGroceries();
    expect(items.map((i) => [i.id, i.name, i.category, i.checked])).toEqual([
      ['3:12', 'Milk', 'Weekly', false],
      ['3:13', 'Eggs', 'Weekly', true],
      ['1:10', 'Paper towels', 'Costco', false],
    ]);
  });

  it('adds to the newest active list and skips items already on a list', async () => {
    const added = await provider().addGroceries([{ name: 'milk' }, { name: 'Bread', quantity: '1' }, { name: 'bread' }]);
    expect(added.map((a) => a.name)).toEqual(['Bread']);
    expect(db.items.find((i) => i.name === 'Bread')).toMatchObject({ list_id: 3, quantity: '1' });
  });

  it('creates a list when none is active', async () => {
    db.lists.forEach((l) => (l.status = 'completed'));
    const [item] = await provider().addGroceries([{ name: 'Apples' }]);
    expect(item.category).toBe('Family list');
    expect(db.lists.find((l) => l.name === 'Family list')?.status).toBe('active');
  });

  it('checks off, deletes and clears checked items without completing lists', async () => {
    const p = provider();
    expect(await p.updateGrocery('3:12', { checked: true })).toMatchObject({ id: '3:12', checked: true });
    await p.deleteGrocery('1:10');
    expect(db.items.some((i) => i.id === 10)).toBe(false);
    await p.clearCheckedGroceries();
    expect(db.items.filter((i) => i.list_id === 3)).toEqual([]);
    expect(db.items.some((i) => i.id === 11)).toBe(true); // completed list untouched
    expect(db.lists.find((l) => l.id === 3)?.status).toBe('active');
  });

  it('shares only allowance and savings goals', async () => {
    const s = await provider().getAllowanceAndGoals();
    expect(s).toEqual({
      currency: 'CAD',
      allowances: [{ name: "Emma's allowance", who: 'Emma', amount: 20, frequency: 'biweekly', nextDue: '2026-10-15' }],
      goals: [{ name: '🏝️ Trip', who: undefined, target: 4000, saved: 1000, targetDate: '2027-06-01' }],
    });
    expect(Object.keys(s)).not.toContain('categories');
  });

  it('never asks the budget app for budget numbers', async () => {
    const p = provider();
    await p.info();
    await p.getMeals('2026-10-01', '2026-10-31');
    await p.getGroceries();
    await p.getAllowanceAndGoals();
    expect(budgetCalls).toEqual([]);
  });

  it('lists recipe names for suggestions', async () => {
    expect(await provider().getRecipeNames()).toEqual(['Chili']);
  });
});
