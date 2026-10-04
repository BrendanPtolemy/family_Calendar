// Connector for the family budget app over its REST API.
//
// The endpoint paths and field names below are placeholders until we know how
// the budget app exposes its data. Each request goes through one small
// function, and each response is mapped by one `to*` function, so wiring up
// the real API should only mean editing this file.
//
// Configure with BUDGET_PROVIDER=http, BUDGET_API_URL and BUDGET_API_KEY.

import type { BudgetSummary, GroceryItem, Meal } from '../../../shared/types.js';
import type { BudgetProvider, MealInput, NewGroceryItem } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export class HttpBudgetProvider implements BudgetProvider {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Json> {
    const res = await this.fetchImpl(new URL(path, this.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw Object.assign(new Error(`Budget app returned ${res.status} for ${method} ${path}`), { status: 502 });
    }
    return res.status === 204 ? null : res.json();
  }

  async info() {
    try {
      await this.call('GET', '/api/health');
      return { provider: 'http', connected: true, readOnly: false };
    } catch (e) {
      return { provider: 'http', connected: false, readOnly: false, message: (e as Error).message };
    }
  }

  // ---- Meals ----
  async getMeals(from: string, to: string): Promise<Meal[]> {
    const rows = await this.call('GET', `/api/meal-plan?from=${from}&to=${to}`);
    return (rows as Json[]).map(toMeal);
  }
  async saveMeal(input: MealInput & { id?: string }): Promise<Meal> {
    const row = input.id
      ? await this.call('PUT', `/api/meal-plan/${encodeURIComponent(input.id)}`, input)
      : await this.call('POST', '/api/meal-plan', input);
    return toMeal(row);
  }
  async deleteMeal(id: string) {
    await this.call('DELETE', `/api/meal-plan/${encodeURIComponent(id)}`);
  }

  // ---- Groceries ----
  async getGroceries(): Promise<GroceryItem[]> {
    const rows = await this.call('GET', '/api/grocery-list');
    return (rows as Json[]).map(toGrocery);
  }
  async addGroceries(items: NewGroceryItem[]): Promise<GroceryItem[]> {
    const rows = await this.call('POST', '/api/grocery-list', { items });
    return (rows as Json[]).map(toGrocery);
  }
  async updateGrocery(id: string, patch: Partial<Omit<GroceryItem, 'id'>>): Promise<GroceryItem> {
    return toGrocery(await this.call('PATCH', `/api/grocery-list/${encodeURIComponent(id)}`, patch));
  }
  async deleteGrocery(id: string) {
    await this.call('DELETE', `/api/grocery-list/${encodeURIComponent(id)}`);
  }
  async clearCheckedGroceries() {
    await this.call('POST', '/api/grocery-list/clear-checked');
  }

  // ---- Budget ----
  async getBudgetSummary(): Promise<BudgetSummary> {
    return toBudget(await this.call('GET', '/api/budget/summary'));
  }
}

// ---- Response mapping: adjust these to the budget app's real field names ----

export function toMeal(r: Json): Meal {
  return {
    id: String(r.id),
    date: String(r.date).slice(0, 10),
    slot: r.slot ?? r.mealType ?? 'dinner',
    title: r.title ?? r.name ?? '',
    ingredients: r.ingredients ?? [],
    notes: r.notes ?? undefined,
  };
}

export function toGrocery(r: Json): GroceryItem {
  return {
    id: String(r.id),
    name: r.name ?? r.title ?? '',
    quantity: r.quantity ?? undefined,
    category: r.category ?? r.aisle ?? undefined,
    checked: Boolean(r.checked ?? r.purchased ?? false),
    addedBy: r.addedBy ?? undefined,
  };
}

export function toBudget(r: Json): BudgetSummary {
  return {
    period: r.period ?? '',
    currency: r.currency ?? 'USD',
    categories: (r.categories ?? []).map((c: Json) => ({
      name: c.name,
      budgeted: Number(c.budgeted ?? c.limit ?? 0),
      spent: Number(c.spent ?? c.actual ?? 0),
    })),
    goals: (r.goals ?? []).map((g: Json) => ({ name: g.name, target: Number(g.target), saved: Number(g.saved ?? g.current ?? 0) })),
  };
}
