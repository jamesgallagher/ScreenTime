import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { startSweeps } from './jobs/sweep.js';
import { createMailer } from './mailer.js';
import { createPusher } from './push.js';
import { backfillSites } from './sites/backfill.js';
import { startClassifier } from './sites/classify.js';

const config = loadConfig();
const { db } = createDb(config.databaseUrl);

await runMigrations(db);
console.log('database migrations applied');
if (!config.smtp) {
  console.log('SMTP is not configured: sign-in codes are written to this log instead of emailed');
}

if (!config.firebaseServiceAccountJson) {
  console.log('Firebase is not configured: no push notifications are sent');
}

const deps = {
  db,
  config,
  mailer: createMailer(config.smtp),
  pusher: createPusher(config.firebaseServiceAccountJson),
};
const app = createApp(deps);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`screentime-server listening on http://localhost:${info.port}`);
});
// Lets GET /v1/device/ws upgrade to a WebSocket (docs/SPEC.md §8.3).
app.injectWebSocket(server);
// SOS auto stop and offline devices, once a minute (docs/SPEC.md §8.4, §15). The jobs share the app's device hub.
startSweeps({ ...deps, hub: app.hub });
// Fill site_lookups.site and recount site_daily.minutes once, after the deploy (docs/SPEC.md §12.10). In the
// background, so the API serves while it runs; a failure is logged and nothing else is affected.
void backfillSites(db)
  .then(({ filled, recounted }) => {
    if (filled > 0) console.log(`sites: backfill filled ${filled} rows, recounted ${recounted} days`);
  })
  .catch((err) => console.error('sites: backfill failed', err));
// Sorts new sites with the family's local LLM: a minute after start, then hourly (docs/SPEC.md §12.10).
startClassifier(deps);
