import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { FeedService } from './feeds.js';
import { createBudgetProvider } from './integrations/budget/index.js';
import { Store } from './store.js';

// Minimal .env loader so there's nothing extra to install.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const port = Number(process.env.PORT ?? 8787);
const store = new Store(resolve(process.env.DATA_FILE ?? './data/family.json'));
const budget = createBudgetProvider(store);
const feeds = new FeedService(Number(process.env.CALENDAR_REFRESH_MINUTES ?? 15) * 60_000);
const app = createApp({ store, budget, feeds });

const dist = resolve('dist');
if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

app.listen(port, () => {
  console.log(`Family Skylight API on http://localhost:${port}`);
  const feedUrls = store.data.members.flatMap((m) => m.calendarFeeds);
  void feeds.refresh(feedUrls);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.flush();
    process.exit(0);
  });
}
