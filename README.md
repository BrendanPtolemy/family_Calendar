# Family Skylight

A Skylight-style family wall calendar for a tablet on the kitchen wall (it also works on phones).

- **Today**: one column per person with today's events and chores, plus tonight's dinner, the grocery count and tomorrow at a glance.
- **Calendar**: week and month views, color-coded by person, tap a day to add an event, filter by person. Linked Google / iCloud / Outlook / school calendars (iCal links) show up read-only.
- **Chores**: tap to check off, stars per chore, daily / some-days / one-off schedules, progress rings and streaks. Chores can require a parent to check them before stars count.
- **Rewards**: kids spend stars on non-money rewards (screen time, pick dinner, stay up late, one-on-one time…). Screen-time rewards go into a per-kid minute bank that a parent draws down. Kids' requests wait for a parent; denied requests return the stars. Parents can give bonus stars.
- **Meals**: weekly breakfast / lunch / dinner plan, and one tap to add the week's ingredients to the grocery list.
- **Groceries**: shared list grouped by aisle, check off in the store, clear checked.
- **Budget** (parents only): category spend and family savings goals from the budget app.

Parent-only actions (managing chores and rewards, approvals, budget, settings) are behind a PIN. The default PIN is `1234`; the app nags until it's changed. Parent mode locks itself after a few idle minutes, and the display drifts back to Today.

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

## Connecting the family budget app

Meals, groceries and budget numbers come through one interface, `BudgetProvider` in `server/integrations/budget/types.ts`. Until the real budget app is connected, `BUDGET_PROVIDER=sample` serves demo data so everything works.

To connect the budget app, set `BUDGET_PROVIDER=http`, `BUDGET_API_URL` and `BUDGET_API_KEY`. `server/integrations/budget/http.ts` holds the endpoint paths and field mappings; they are placeholders until we match them to the budget app's real API, and that file is the only one that should need to change.

## Development

```sh
npm test             # domain + API tests (vitest, supertest)
npm run typecheck
```

- `server/` Express API, JSON-file store, chore/reward/recurrence logic (`domain.ts`), calendar feeds (`feeds.ts`)
- `server/integrations/budget/` the budget connector
- `shared/types.ts` types used by both sides
- `src/` React web app
