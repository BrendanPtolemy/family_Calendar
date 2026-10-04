import type { Store } from '../../store.js';
import { FamilySaasProvider } from './family-saas.js';
import { SampleBudgetProvider } from './sample.js';
import type { BudgetProvider } from './types.js';

export type { BudgetProvider } from './types.js';

export function createBudgetProvider(store: Store, env: NodeJS.ProcessEnv = process.env): BudgetProvider {
  const kind = env.BUDGET_PROVIDER ?? 'sample';
  if (kind === 'family_saas') {
    const missing = ['FAMILY_SAAS_URL', 'FAMILY_SAAS_USERNAME', 'FAMILY_SAAS_PASSWORD'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`BUDGET_PROVIDER=family_saas needs ${missing.join(', ')}`);
    return new FamilySaasProvider({
      baseUrl: env.FAMILY_SAAS_URL!,
      tenant: env.FAMILY_SAAS_TENANT || undefined,
      username: env.FAMILY_SAAS_USERNAME!,
      password: env.FAMILY_SAAS_PASSWORD!,
      currency: env.FAMILY_SAAS_CURRENCY || undefined,
    });
  }
  if (kind !== 'sample') throw new Error(`Unknown BUDGET_PROVIDER "${kind}" (use sample or family_saas)`);
  return new SampleBudgetProvider(store);
}
