// Demo provider: meals and groceries live in the local data file, budget
// numbers are made up. Lets the display work before the real budget app is
// connected.

import type { Store } from '../../store.js';
import { newId } from '../../store.js';
import type { AllowanceAndGoals, GroceryItem, Meal } from '../../../shared/types.js';
import type { BudgetProvider, MealInput, NewGroceryItem } from './types.js';

export class SampleBudgetProvider implements BudgetProvider {
  constructor(private store: Store) {}

  async info() {
    return { provider: 'sample', connected: true, readOnly: false, mealIngredientsEditable: true, message: 'Showing sample data. Connect your budget app to see real numbers.' };
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

  async getAllowanceAndGoals(): Promise<AllowanceAndGoals> {
    const next = (day: number) => {
      const d = new Date();
      if (d.getDate() >= day) d.setMonth(d.getMonth() + 1);
      d.setDate(day);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    return {
      currency: 'USD',
      allowances: [
        { name: "Ava's allowance", who: 'Ava', amount: 10, frequency: 'biweekly', nextDue: next(15) },
        { name: "Leo's allowance", who: 'Leo', amount: 7.5, frequency: 'biweekly', nextDue: next(15) },
      ],
      goals: [
        { name: 'Summer vacation', target: 4000, saved: 2650 },
        { name: 'New bikes', target: 600, saved: 410 },
        { name: 'LEGO set', who: 'Leo', target: 80, saved: 35 },
      ],
    };
  }
}
