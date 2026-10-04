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

Configuration is in `.env` (see `.env.example`).

## Devices and access

Nothing works until a device is paired, so the app is safe to reach from the internet (behind HTTPS).

- **First device:** on the server, run `npm run pair -- "Kitchen tablet"`. It prints a code like `ABCD-EFGH`. Open the calendar on the tablet and enter the code. Codes work once and expire after 15 minutes.
- **Every other device:** on a paired device, unlock parent mode, then go to Settings › Devices › Add a device. You have to change the parent PIN from 1234 first.
- **Lost phone:** Settings › Devices › Disconnect. It loses access straight away.
- **Parent mode** (the PIN) sits on top of pairing. An unlock only counts on the device where the PIN was typed. Wrong PINs lock that device out for longer each time.
- Each paired device holds an httpOnly cookie that lasts 400 days. The server stores only a hash of it.

## Connecting the family budget app

Meals, groceries and budget numbers come through one interface, `BudgetProvider` in `server/integrations/budget/types.ts`. Until the real budget app is connected, `BUDGET_PROVIDER=sample` serves demo data so everything works.

To connect the family budget app (`family-saas`):

1. In family-saas, run `node scripts/calendar-token.js --slug=<family>`. It prints a token once and keeps only its hash.
2. Here, set `BUDGET_PROVIDER=http`, `BUDGET_API_URL` (e.g. `http://127.0.0.1:3010`), `BUDGET_TENANT=<family>` and `BUDGET_API_KEY=<token>`.

The calendar calls the budget app's `/api/calendar/*` service API (`backend/routes/calendar.js` there):
- Meals map onto its two-week meal plans.
- Groceries go to its newest open list.
- The Budget tab shows this month's categories and savings goals.
- "Connected" in the app means the token was accepted, not just that the server answered.

Running the token script again replaces the token; `--revoke` removes it.

## Development

```sh
npm test             # domain + API tests (vitest, supertest)
npm run typecheck
```

- `server/` Express API, JSON-file store, chore/reward/recurrence logic (`domain.ts`), calendar feeds (`feeds.ts`)
- `server/integrations/budget/` the budget connector
- `shared/types.ts` types used by both sides
- `src/` React web app
