// The contract between the family display and a budget / grocery / meal-plan
// backend. To connect a different app, implement this interface and register
// it in ./index.ts. Nothing else in the codebase knows which provider is used.

import type { BudgetSummary, GroceryItem, IntegrationInfo, Meal, MealSlot } from '../../../shared/types.js';

export interface NewGroceryItem {
  name: string;
  quantity?: string;
  category?: string;
  addedBy?: string;
}

export interface MealInput {
  date: string;
  slot: MealSlot;
  title: string;
  ingredients: string[];
  notes?: string;
}

export interface BudgetProvider {
  info(): Promise<IntegrationInfo>;

  /** Meals with from <= date < to (YYYY-MM-DD). */
  getMeals(from: string, to: string): Promise<Meal[]>;
  saveMeal(input: MealInput & { id?: string }): Promise<Meal>;
  deleteMeal(id: string): Promise<void>;

  getGroceries(): Promise<GroceryItem[]>;
  addGroceries(items: NewGroceryItem[]): Promise<GroceryItem[]>;
  updateGrocery(id: string, patch: Partial<Omit<GroceryItem, 'id'>>): Promise<GroceryItem>;
  deleteGrocery(id: string): Promise<void>;
  /** Remove every checked item (after a shopping trip). */
  clearCheckedGroceries(): Promise<void>;

  getBudgetSummary(): Promise<BudgetSummary>;
}
