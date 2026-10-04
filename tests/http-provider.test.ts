import { describe, expect, it } from 'vitest';
import { createBudgetProvider } from '../server/integrations/budget/index.js';
import { HttpBudgetProvider } from '../server/integrations/budget/http.js';
import { Store } from '../server/store.js';

function fakeFetch(handler: (url: URL, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const impl = (async (input: URL, init: RequestInit) => {
    calls.push({ url: input, init });
    const r = handler(input, init);
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('HttpBudgetProvider', () => {
  it('sends the token and family on every call, to the calendar API', async () => {
    const f = fakeFetch(() => ({ body: [] }));
    const p = new HttpBudgetProvider('http://127.0.0.1:3010', 'tok', 'home', f.impl);
    await p.getMeals('2026-10-05', '2026-10-12');
    await p.getGroceries();
    expect(f.calls.map((c) => c.url.toString())).toEqual([
      'http://127.0.0.1:3010/api/calendar/meals?from=2026-10-05&to=2026-10-12',
      'http://127.0.0.1:3010/api/calendar/groceries',
    ]);
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['X-Tenant']).toBe('home');
  });

  it('reports "connected" only when the token is accepted', async () => {
    const good = new HttpBudgetProvider('http://x', 'tok', 'home', fakeFetch(() => ({ body: { ok: true, family: 'Ptolemy' } })).impl);
    expect(await good.info()).toMatchObject({ connected: true, message: 'Connected to the Ptolemy budget.' });
    const bad = new HttpBudgetProvider('http://x', 'nope', 'home', fakeFetch(() => ({ status: 401, body: { error: 'Calendar token missing or wrong' } })).impl);
    expect(await bad.info()).toMatchObject({ connected: false });
  });

  it('moves meals with PUT (id in the path, not the body) and passes 404s through', async () => {
    const f = fakeFetch((_url, init) => (init.method === 'DELETE' ? { status: 404, body: { error: 'Meal not found' } } : { body: { id: 7, date: '2026-10-06', slot: 'dinner', title: 'Tacos', ingredients: ['salsa'] } }));
    const p = new HttpBudgetProvider('http://x', 'tok', 'home', f.impl);
    const m = await p.saveMeal({ id: '7', date: '2026-10-06', slot: 'dinner', title: 'Tacos', ingredients: ['salsa'] });
    expect(m).toEqual({ id: '7', date: '2026-10-06', slot: 'dinner', title: 'Tacos', ingredients: ['salsa'], notes: undefined });
    expect(f.calls[0].init.method).toBe('PUT');
    expect(f.calls[0].url.pathname).toBe('/api/calendar/meals/7');
    expect(JSON.parse(String(f.calls[0].init.body))).not.toHaveProperty('id');
    await expect(p.deleteMeal('7')).rejects.toMatchObject({ status: 404, message: 'Meal not found' });
  });

  it('turns an unreachable budget app into a 502', async () => {
    const p = new HttpBudgetProvider('http://x', 'tok', 'home', (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    await expect(p.getGroceries()).rejects.toMatchObject({ status: 502 });
  });

  it('refuses to start half-configured', () => {
    const store = new Store(null);
    expect(() => createBudgetProvider(store, { BUDGET_PROVIDER: 'http', BUDGET_API_URL: 'http://x', BUDGET_API_KEY: 'k' })).toThrow(/BUDGET_TENANT/);
  });
});
