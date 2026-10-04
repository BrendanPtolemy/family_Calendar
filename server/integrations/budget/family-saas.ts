// Connector for the family budget app (family_saas).
//
// family_saas is multi-tenant: the tenant comes from the subdomain
// (ptolemy.saas.example.com) or, on localhost, the X-Tenant header. Every API
// route needs a logged-in user; we log in once with a dedicated account and
// send the session JWT as a Bearer token, logging in again if it expires.
//
// Mapping:
//   meals      <- grocery meal plans (a plan has a start_date; slots sit at day_offset 0..6)
//   groceries  <- items on every *active* grocery list (the list name becomes the aisle heading)
//   allowance  <- recurring items in an "Allowance" category (amount, how often, next payday)
//   goals      <- savings goals
// Budget categories, transactions and spending are never read: they stay in
// the budget app.

import type { AllowanceAndGoals, GroceryItem, IntegrationInfo, Meal, MealSlot } from '../../../shared/types.js';
import { addDays, fromDateKey } from '../../domain.js';
import type { BudgetProvider, MealInput, NewGroceryItem } from './types.js';

export interface FamilySaasConfig {
  baseUrl: string;
  /** Needed when baseUrl is localhost or the bare domain; ignored by family_saas on a tenant subdomain. */
  tenant?: string;
  username: string;
  password: string;
  currency?: string;
  /** Name of the list new items go to when no active list exists. */
  defaultListName?: string;
}

interface SaasList { id: number; name: string; status: string; created_at: string; items?: SaasItem[] }
interface SaasItem { id: number; list_id: number; name: string; quantity: string | null; checked: number; added_by: number | null }
interface SaasSlot { meal_plan_id: number; day_offset: number; slot: string; recipe_id: number | null; recipe_name: string | null; custom_meal: string | null; notes: string | null }
interface SaasPlan { id: number; name: string; start_date: string; slots: SaasSlot[] }
interface SaasRecurring { name: string; amount: number; frequency: string; next_due: string | null; is_active: number; is_income: number; category_name: string | null; member_name: string | null }
interface SaasGoal { name: string; icon: string | null; target: number; current: number | null; target_date: string | null; member_name: string | null }
interface SaasRecipe { id: number; name: string; ingredients?: { name: string; quantity: string | null; unit: string | null }[] }

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export class FamilySaasError extends Error {
  status = 502;
}

export class FamilySaasProvider implements BudgetProvider {
  private token: string | null = null;
  private recipeCache = new Map<number, { at: number; ingredients: string[] }>();

  constructor(
    private cfg: FamilySaasConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  // ---- HTTP plumbing ----

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.cfg.tenant) h['X-Tenant'] = this.cfg.tenant;
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async login(): Promise<void> {
    this.token = null;
    const res = await this.fetchImpl(new URL('/api/auth/login', this.cfg.baseUrl), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new FamilySaasError(`Couldn't sign in to the budget app: ${body.error ?? res.status}`);
    }
    // The JWT only comes back as the budget_session cookie.
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') ?? ''];
    const m = cookies.join(';').match(/budget_session=([^;]+)/);
    if (!m) throw new FamilySaasError('Budget app login did not return a session');
    this.token = decodeURIComponent(m[1]);
  }

  private async call<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    if (!this.token) await this.login();
    const res = await this.fetchImpl(new URL(path, this.cfg.baseUrl), {
      method,
      headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      this.token = null;
      return this.call<T>(method, path, body, true);
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new FamilySaasError(`Budget app: ${err.error ?? `${method} ${path} failed (${res.status})`}`);
    }
    return (await res.json()) as T;
  }

  async info(): Promise<IntegrationInfo> {
    const base = { provider: 'family_saas', readOnly: false, mealIngredientsEditable: false };
    try {
      await this.call('GET', '/api/auth/me');
      return { ...base, connected: true };
    } catch (e) {
      return { ...base, connected: false, message: (e as Error).message };
    }
  }

  // ---- Meals ----

  private async plans(): Promise<SaasPlan[]> {
    return this.call<SaasPlan[]>('GET', '/api/grocery/meal-plans');
  }

  private async recipeIngredients(id: number): Promise<string[]> {
    const hit = this.recipeCache.get(id);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ingredients;
    const r = await this.call<SaasRecipe>('GET', `/api/grocery/recipes/${id}`);
    const ingredients = (r.ingredients ?? []).map((i) => i.name);
    this.recipeCache.set(id, { at: Date.now(), ingredients });
    return ingredients;
  }

  async getMeals(from: string, to: string): Promise<Meal[]> {
    const plans = await this.plans();
    // Newer plans win if two plans cover the same day and slot.
    plans.sort((a, b) => a.id - b.id);
    const byKey = new Map<string, { plan: SaasPlan; slot: SaasSlot; date: string }>();
    for (const plan of plans) {
      for (const slot of plan.slots ?? []) {
        if (!SLOTS.includes(slot.slot as MealSlot)) continue;
        const date = addDays(plan.start_date.slice(0, 10), slot.day_offset);
        if (date < from || date >= to) continue;
        byKey.set(`${date}|${slot.slot}`, { plan, slot, date });
      }
    }
    const meals: Meal[] = [];
    for (const { plan, slot, date } of byKey.values()) {
      const title = slot.recipe_name ?? slot.custom_meal ?? '';
      if (!title) continue;
      meals.push({
        id: `${plan.id}:${slot.day_offset}:${slot.slot}`,
        date,
        slot: slot.slot as MealSlot,
        title,
        ingredients: slot.recipe_id ? await this.recipeIngredients(slot.recipe_id) : [],
        notes: slot.notes ?? undefined,
      });
    }
    return meals.sort((a, b) => (a.date + SLOTS.indexOf(a.slot)).localeCompare(b.date + SLOTS.indexOf(b.slot)));
  }

  async getRecipeNames(): Promise<string[]> {
    const recipes = await this.call<SaasRecipe[]>('GET', '/api/grocery/recipes');
    return recipes.map((r) => r.name);
  }

  /** The plan whose week contains `date`, creating a Sunday-start week plan if none does. */
  private async planFor(date: string): Promise<{ planId: number; offset: number }> {
    const plans = (await this.plans()).sort((a, b) => b.id - a.id);
    for (const p of plans) {
      const offset = Math.round((fromDateKey(date).getTime() - fromDateKey(p.start_date.slice(0, 10)).getTime()) / 86_400_000);
      if (offset >= 0 && offset <= 6) return { planId: p.id, offset };
    }
    const d = fromDateKey(date);
    const start = addDays(date, -d.getDay());
    const created = await this.call<{ id: number }>('POST', '/api/grocery/meal-plans', {
      name: `Week of ${fromDateKey(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      start_date: start,
    });
    return { planId: created.id, offset: d.getDay() };
  }

  async saveMeal(input: MealInput & { id?: string }): Promise<Meal> {
    // Moving a meal to another day or slot: clear the old spot first.
    if (input.id) {
      const [planId, offset, slot] = input.id.split(':');
      const plans = await this.plans();
      const plan = plans.find((p) => String(p.id) === planId);
      const oldDate = plan ? addDays(plan.start_date.slice(0, 10), Number(offset)) : null;
      if (oldDate && (oldDate !== input.date || slot !== input.slot)) await this.deleteMeal(input.id);
    }
    const { planId, offset } = await this.planFor(input.date);
    // A title matching a saved recipe links the recipe, so its ingredients come along.
    const recipes = await this.call<SaasRecipe[]>('GET', '/api/grocery/recipes');
    const recipe = recipes.find((r) => r.name.trim().toLowerCase() === input.title.trim().toLowerCase());
    await this.call('PUT', `/api/grocery/meal-plans/${planId}/slots`, {
      day_offset: offset,
      slot: input.slot,
      recipe_id: recipe?.id ?? null,
      custom_meal: recipe ? null : input.title,
      notes: input.notes ?? null,
    });
    return {
      id: `${planId}:${offset}:${input.slot}`,
      date: input.date,
      slot: input.slot,
      title: recipe?.name ?? input.title,
      ingredients: recipe ? await this.recipeIngredients(recipe.id) : [],
      notes: input.notes,
    };
  }

  async deleteMeal(id: string): Promise<void> {
    const [planId, offset, slot] = id.split(':');
    if (!planId || offset === undefined || !slot) throw new FamilySaasError('Unknown meal');
    await this.call('DELETE', `/api/grocery/meal-plans/${encodeURIComponent(planId)}/slots`, { day_offset: Number(offset), slot });
  }

  // ---- Groceries ----

  private async activeLists(): Promise<SaasList[]> {
    const lists = await this.call<SaasList[]>('GET', '/api/grocery/lists');
    const active = lists.filter((l) => l.status === 'active');
    return Promise.all(active.map((l) => this.call<SaasList>('GET', `/api/grocery/lists/${l.id}`)));
  }

  private static item(list: SaasList, i: SaasItem): GroceryItem {
    return {
      id: `${list.id}:${i.id}`,
      name: i.name,
      quantity: i.quantity ?? undefined,
      category: list.name,
      checked: !!i.checked,
    };
  }

  private static split(id: string): [string, string] {
    const [listId, itemId] = id.split(':');
    if (!listId || !itemId) throw new FamilySaasError('Unknown grocery item');
    return [encodeURIComponent(listId), encodeURIComponent(itemId)];
  }

  async getGroceries(): Promise<GroceryItem[]> {
    const lists = await this.activeLists();
    return lists.flatMap((l) => (l.items ?? []).map((i) => FamilySaasProvider.item(l, i)));
  }

  async addGroceries(items: NewGroceryItem[]): Promise<GroceryItem[]> {
    const lists = await this.activeLists();
    // New items go on the newest active list, or a fresh one.
    let target = lists.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0];
    if (!target) {
      const name = this.cfg.defaultListName ?? 'Family list';
      const { id } = await this.call<{ id: number }>('POST', '/api/grocery/lists', { name });
      target = { id, name, status: 'active', created_at: '', items: [] };
    }
    const open = new Set(lists.flatMap((l) => (l.items ?? []).filter((i) => !i.checked).map((i) => i.name.trim().toLowerCase())));
    const added: GroceryItem[] = [];
    for (const item of items) {
      const key = item.name.trim().toLowerCase();
      if (open.has(key)) continue;
      open.add(key);
      const { id } = await this.call<{ id: number }>('POST', `/api/grocery/lists/${target.id}/items`, { name: item.name, quantity: item.quantity ?? null });
      added.push(FamilySaasProvider.item(target, { id, list_id: target.id, name: item.name, quantity: item.quantity ?? null, checked: 0, added_by: null }));
    }
    return added;
  }

  async updateGrocery(id: string, patch: Partial<Omit<GroceryItem, 'id'>>): Promise<GroceryItem> {
    const [listId, itemId] = FamilySaasProvider.split(id);
    await this.call('PUT', `/api/grocery/lists/${listId}/items/${itemId}`, {
      name: patch.name,
      quantity: patch.quantity,
      checked: patch.checked,
    });
    const list = await this.call<SaasList>('GET', `/api/grocery/lists/${listId}`);
    const item = list.items?.find((i) => String(i.id) === decodeURIComponent(itemId));
    if (!item) throw Object.assign(new FamilySaasError('Grocery item not found'), { status: 404 });
    return FamilySaasProvider.item(list, item);
  }

  async deleteGrocery(id: string): Promise<void> {
    const [listId, itemId] = FamilySaasProvider.split(id);
    await this.call('DELETE', `/api/grocery/lists/${listId}/items/${itemId}`);
  }

  async clearCheckedGroceries(): Promise<void> {
    // Remove checked items only. Completing a list in family_saas records a
    // spend for the budget, which is a decision for the budget app, not the wall.
    for (const list of await this.activeLists()) {
      for (const item of list.items ?? []) {
        if (item.checked) await this.call('DELETE', `/api/grocery/lists/${list.id}/items/${item.id}`);
      }
    }
  }

  // ---- Allowance & savings goals ----

  async getAllowanceAndGoals(): Promise<AllowanceAndGoals> {
    const [recurring, goals] = await Promise.all([
      this.call<SaasRecurring[]>('GET', '/api/recurring'),
      this.call<SaasGoal[]>('GET', '/api/budget/goals'),
    ]);
    return {
      currency: this.cfg.currency ?? 'USD',
      allowances: recurring
        .filter((r) => r.is_active && !r.is_income && /allowance/i.test(r.category_name ?? ''))
        .map((r) => ({
          name: r.name,
          who: r.member_name ?? undefined,
          amount: Number(r.amount) || 0,
          frequency: r.frequency,
          nextDue: r.next_due?.slice(0, 10),
        })),
      goals: goals.map((g) => ({
        name: [g.icon, g.name].filter(Boolean).join(' '),
        who: g.member_name ?? undefined,
        target: Number(g.target) || 0,
        saved: Number(g.current) || 0,
        targetDate: g.target_date ?? undefined,
      })),
    };
  }
}
