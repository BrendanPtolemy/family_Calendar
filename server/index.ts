import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';
import { DeviceAuth } from './devices.js';
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
const dataFile = resolve(process.env.DATA_FILE ?? './data/family.json');
const store = new Store(dataFile);
const budget = createBudgetProvider(store);
const feeds = new FeedService(Number(process.env.CALENDAR_REFRESH_MINUTES ?? 15) * 60_000);
const devices = new DeviceAuth(store, resolve(dirname(dataFile), 'pairing-codes.json'));
const trustProxy = (process.env.TRUST_PROXY ?? 'loopback').split(',').map((s) => s.trim()).filter(Boolean);
const app = createApp({ store, budget, feeds, devices, trustProxy });

const dist = resolve('dist');
if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

// Express 5 calls this callback with the error when listening fails (e.g. the
// port is taken), so check it rather than announce a server that isn't there.
app.listen(port, (err?: Error) => {
  if (err) {
    console.error(`Could not listen on port ${port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Family Skylight API on http://localhost:${port}`);
  if (store.data.devices.length === 0) console.log('No devices paired yet. Run `npm run pair` on this machine to get a code.');
  const feedUrls = store.data.members.flatMap((m) => m.calendarFeeds);
  void feeds.refresh(feedUrls);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.flush();
    process.exit(0);
  });
}
