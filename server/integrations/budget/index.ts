import type { Store } from '../../store.js';
import { HttpBudgetProvider } from './http.js';
import { SampleBudgetProvider } from './sample.js';
import type { BudgetProvider } from './types.js';

export type { BudgetProvider } from './types.js';

export function createBudgetProvider(store: Store, env: NodeJS.ProcessEnv = process.env): BudgetProvider {
  const kind = env.BUDGET_PROVIDER ?? 'sample';
  if (kind === 'http') {
    for (const k of ['BUDGET_API_URL', 'BUDGET_API_KEY', 'BUDGET_TENANT'] as const) {
      if (!env[k]) throw new Error(`BUDGET_PROVIDER=http needs ${k}`);
    }
    return new HttpBudgetProvider(env.BUDGET_API_URL!, env.BUDGET_API_KEY!, env.BUDGET_TENANT!);
  }
  if (kind !== 'sample') throw new Error(`Unknown BUDGET_PROVIDER "${kind}"`);
  return new SampleBudgetProvider(store);
}
