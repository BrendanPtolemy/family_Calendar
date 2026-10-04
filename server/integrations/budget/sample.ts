// Demo provider: meals and groceries live in the local data file, budget
// numbers are made up. Lets the display work before the real budget app is
// connected.

import type { Store } from '../../store.js';
import { newId } from '../../store.js';
import type { BudgetSummary, GroceryItem, Meal } from '../../../shared/types.js';
import type { BudgetProvider, MealInput, NewGroceryItem } from './types.js';

export class SampleBudgetProvider implements BudgetProvider {
  constructor(private store: Store) {}

  async info() {
    return { provider: 'sample', connected: true, readOnly: false, message: 'Showing sample data. Connect your budget app to see real numbers.' };
  }

  async getMeals(from: string, to: string): Promise<Meal[]> {
    return this.store.data.sample.meals.filter((m) => m.date >= from && m.date < to);
  }

  async saveMeal(input: MealInput & { id?: string }): Promise<Meal> {
    return this.store.update((d) => {
      const existing = input.id ? d.sample.meals.find((m) => m.id === input.id) : undefined;
      if (existing) {
        Object.assign(existing, input);
        return existing;
      }
      const meal: Meal = { ...input, id: newId() };
      d.sample.meals.push(meal);
      return meal;
    });
  }

  async deleteMeal(id: string) {
    this.store.update((d) => {
      d.sample.meals = d.sample.meals.filter((m) => m.id !== id);
    });
  }

  async getGroceries(): Promise<GroceryItem[]> {
    return this.store.data.sample.groceries;
  }

  async addGroceries(items: NewGroceryItem[]): Promise<GroceryItem[]> {
    return this.store.update((d) => {
      const added: GroceryItem[] = [];
      for (const item of items) {
        const dupe = d.sample.groceries.find((g) => !g.checked && g.name.toLowerCase() === item.name.toLowerCase());
        if (dupe) continue;
        const g: GroceryItem = { id: newId(), checked: false, ...item };
        d.sample.groceries.push(g);
        added.push(g);
      }
      return added;
    });
  }

  async updateGrocery(id: string, patch: Partial<Omit<GroceryItem, 'id'>>): Promise<GroceryItem> {
    return this.store.update((d) => {
      const g = d.sample.groceries.find((x) => x.id === id);
      if (!g) throw Object.assign(new Error('Grocery item not found'), { status: 404 });
      Object.assign(g, patch);
      return g;
    });
  }

  async deleteGrocery(id: string) {
    this.store.update((d) => {
      d.sample.groceries = d.sample.groceries.filter((g) => g.id !== id);
    });
  }

  async clearCheckedGroceries() {
    this.store.update((d) => {
      d.sample.groceries = d.sample.groceries.filter((g) => !g.checked);
    });
  }

  async getBudgetSummary(): Promise<BudgetSummary> {
    const now = new Date();
    return {
      period: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      currency: 'USD',
      categories: [
        { name: 'Groceries', budgeted: 900, spent: 612 },
        { name: 'Dining out', budgeted: 250, spent: 198 },
        { name: 'Kids activities', budgeted: 300, spent: 240 },
        { name: 'Household', budgeted: 200, spent: 87 },
        { name: 'Fun money', budgeted: 150, spent: 160 },
      ],
      goals: [
        { name: 'Summer vacation', target: 4000, saved: 2650 },
        { name: 'New bikes', target: 600, saved: 410 },
      ],
    };
  }
}
