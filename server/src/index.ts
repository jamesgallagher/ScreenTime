import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { startSweeps } from './jobs/sweep.js';
import { createMailer } from './mailer.js';
import { createPusher } from './push.js';

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
