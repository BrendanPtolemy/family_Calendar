// Connector for the family budget app (BrendanPtolemy/family-saas), over the
// service API it exposes for this display: backend/routes/calendar.js there.
//
// Configure with:
//   BUDGET_PROVIDER=http
//   BUDGET_API_URL=http://127.0.0.1:3010     (the budget app; same box is fine)
//   BUDGET_TENANT=home                       (the family's slug in the budget app)
//   BUDGET_API_KEY=...                       (from `node scripts/calendar-token.js --slug=home` there)
//
// That API already speaks this display's shapes (Meal, GroceryItem,
// BudgetSummary), so the mapping below is a guard, not a translation.

import type { BudgetSummary, GroceryItem, IntegrationInfo, Meal } from '../../../shared/types.js';
import type { BudgetProvider, MealInput, NewGroceryItem } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const TIMEOUT_MS = 8000;

export class HttpBudgetProvider implements BudgetProvider {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private tenant: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Json> {
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(`/api/calendar${path}`, this.baseUrl), {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'X-Tenant': this.tenant,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw Object.assign(new Error(`Can't reach the budget app (${(e as Error).message})`), { status: 502 });
    }
    if (!res.ok) {
      // 400/404 are about the request (bad date, item already gone) and their
      // message is worth showing; anything else is the connection's problem.
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 || res.status === 404) throw Object.assign(new Error(data.error ?? `Budget app said ${res.status}`), { status: res.status });
      throw Object.assign(new Error(`Budget app returned ${res.status} for ${method} ${path}`), { status: 502 });
    }
    return res.status === 204 ? null : res.json();
  }

  async info(): Promise<IntegrationInfo> {
    // /health needs the token, so "connected" means the key and family are right.
    try {
      const r = await this.call('GET', '/health');
      return { provider: 'http', connected: true, readOnly: false, message: `Connected to the ${r.family} budget.` };
    } catch (e) {
      return { provider: 'http', connected: false, readOnly: false, message: (e as Error).message };
    }
  }

  // ---- Meals ----
  async getMeals(from: string, to: string): Promise<Meal[]> {
    return (await this.call('GET', `/meals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`) as Json[]).map(toMeal);
  }
  async saveMeal(input: MealInput & { id?: string }): Promise<Meal> {
    const { id, ...body } = input;
    return toMeal(id ? await this.call('PUT', `/meals/${encodeURIComponent(id)}`, body) : await this.call('POST', '/meals', body));
  }
  async deleteMeal(id: string) {
    await this.call('DELETE', `/meals/${encodeURIComponent(id)}`);
  }

  // ---- Groceries ----
  async getGroceries(): Promise<GroceryItem[]> {
    return (await this.call('GET', '/groceries') as Json[]).map(toGrocery);
  }
  async addGroceries(items: NewGroceryItem[]): Promise<GroceryItem[]> {
    if (items.length === 0) return [];
    return (await this.call('POST', '/groceries', { items }) as Json[]).map(toGrocery);
  }
  async updateGrocery(id: string, patch: Partial<Omit<GroceryItem, 'id'>>): Promise<GroceryItem> {
    return toGrocery(await this.call('PATCH', `/groceries/${encodeURIComponent(id)}`, patch));
  }
  async deleteGrocery(id: string) {
    await this.call('DELETE', `/groceries/${encodeURIComponent(id)}`);
  }
  async clearCheckedGroceries() {
    await this.call('POST', '/groceries/clear-checked');
  }

  // ---- Budget ----
  async getBudgetSummary(): Promise<BudgetSummary> {
    return toBudget(await this.call('GET', '/budget'));
  }
}

export function toMeal(r: Json): Meal {
  return {
    id: String(r.id),
    date: String(r.date).slice(0, 10),
    slot: r.slot,
    title: r.title ?? '',
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(String) : [],
    notes: r.notes ?? undefined,
  };
}

export function toGrocery(r: Json): GroceryItem {
  return {
    id: String(r.id),
    name: r.name ?? '',
    quantity: r.quantity ?? undefined,
    category: r.category ?? undefined,
    checked: Boolean(r.checked),
  };
}

export function toBudget(r: Json): BudgetSummary {
  return {
    period: r.period ?? '',
    currency: r.currency ?? 'USD',
    categories: (r.categories ?? []).map((c: Json) => ({ name: c.name, budgeted: Number(c.budgeted ?? 0), spent: Number(c.spent ?? 0) })),
    goals: (r.goals ?? []).map((g: Json) => ({ name: g.name, target: Number(g.target), saved: Number(g.saved ?? 0) })),
  };
}
