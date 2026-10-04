# Family Skylight

A Skylight-style family wall calendar for a tablet on the kitchen wall (it also works on phones).

- **Today**: one column per person with today's events and chores, plus tonight's dinner, the grocery count and tomorrow at a glance.
- **Calendar**: week and month views, color-coded by person, tap a day to add an event, filter by person. Linked Google / iCloud / Outlook / school calendars (iCal links) show up read-only.
- **Chores**: tap to check off, stars per chore, daily / some-days / one-off schedules, progress rings and streaks. Chores can require a parent to check them before stars count.
- **Rewards**: kids spend stars on non-money rewards (screen time, pick dinner, stay up late, one-on-one time…). Screen-time rewards go into a per-kid minute bank that a parent draws down. Kids' requests wait for a parent; denied requests return the stars. Parents can give bonus stars.
- **Meals**: weekly breakfast / lunch / dinner / snack plan, and one tap to add the week's ingredients to the grocery list.
- **Groceries**: shared list grouped by aisle, check off in the store, clear checked.
- **Allowance & savings**: each kid's allowance (how much, how often, next payday) and the family's savings goals. Budget categories and spending are never shown or read.

Parent-only actions (managing chores and rewards, approvals, settings) are behind a PIN. The default PIN is `1234`; the app nags until it's changed. Parent mode locks itself after a few idle minutes, and the display drifts back to Today.

## Run it

Needs Node 20+.

```sh
npm install
npm run dev          # API on :8787, web on http://localhost:5173 (also on your LAN)
```

For the wall display:

```sh
npm run build
npm start            # serves the app and API on http://<this-computer>:8787
```

Open that address on the tablet and "Add to Home Screen" so it runs full-screen. A small always-on box (a Raspberry Pi, an old laptop, a NAS) works well as the server. Data lives in `data/family.json`; back that file up.

This is meant for your home network. Don't expose it to the internet without putting real authentication in front of it.

Configuration is in `.env` (see `.env.example`).

## Connecting the family budget app (family_saas)

Meals, groceries, allowance and savings goals come through one interface, `BudgetProvider` in `server/integrations/budget/types.ts`. With `BUDGET_PROVIDER=sample` (the default) the display uses demo data.

To use family_saas, set these in `.env`:

```sh
BUDGET_PROVIDER=family_saas
FAMILY_SAAS_URL=https://<family>.saas.almagestlabs.com   # or http://localhost:3000
FAMILY_SAAS_TENANT=<family>        # needed for localhost; harmless otherwise
FAMILY_SAAS_USERNAME=wall          # create a dedicated user in family_saas for the display
FAMILY_SAAS_PASSWORD=...
FAMILY_SAAS_CURRENCY=USD
```

What comes across (`server/integrations/budget/family-saas.ts`):

| Display | family_saas |
| --- | --- |
| Meal plan | Meal plans and their slots. Picking a saved recipe name links the recipe, so its ingredients come along. Other meals are saved as custom meals. A week with no plan gets a new Sunday-start plan. |
| Grocery list | Items on every active list, grouped by list. New items go on the newest active list. "Clear checked" removes checked items but never completes a list, so no grocery spend is recorded from the wall. |
| Allowance | Active recurring items in an "Allowance" category: amount, frequency, next payday. |
| Savings goals | Savings goals. |

Budget categories, transactions, income and reports are never requested.

## Development

```sh
npm test             # domain + API tests (vitest, supertest)
npm run typecheck
```

- `server/` Express API, JSON-file store, chore/reward/recurrence logic (`domain.ts`), calendar feeds (`feeds.ts`)
- `server/integrations/budget/` the budget connector
- `shared/types.ts` types used by both sides
- `src/` React web app
