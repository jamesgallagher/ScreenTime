# CARD-027: Server serves the web build; production image

| Field | Value |
|---|---|
| Card | CARD-027 |
| Title | Server serves the web build; production image |
| Size | S |
| Depends on | CARD-026 (merged to `main`) |
| Spec sections | docs/SPEC.md §4.2 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-027-web-in-server` |
| PR title | `CARD-027: Server serves the web build; production image` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

The server is in `server/` (package `@screentime/server`): Hono on Node 24, with the routes built in `server/src/app.ts` and the settings read from environment variables in `server/src/config.ts`. Its Docker image is built by `server/Dockerfile` and run by `deploy/docker-compose.yml`. The parent web app is in `web/` (React, built by Vite into `web/dist`). CARD-022 to CARD-026 built every page of it, but until now it only ran on the Vite dev server (http://localhost:5173), which forwards `/v1` to the API.

SPEC §4.2 says production is two containers: `postgres` and `api`, and **`api` also serves the built web app**, on one hostname (`https://screentime.gallagherhome.au`): the app at `/`, the API at `/v1/*`, health at `/health`. This card does that:

- The Docker image now builds `web/` too and puts `web/dist` in `/app/public`. The image sets `WEB_DIR=/app/public`.
- A new setting **`WEB_DIR`**: the folder with the built web app. When it is set, the server serves that folder after all API routes. When it is unset (tests, `pnpm dev:server`), the server is the API only, as before.
- Each GET that no API route takes:
  - a file that exists is sent with its content type. Files under `/assets/` have a hash in their name (Vite does that), so they are cached for a year. Every other file, and `index.html`, says `Cache-Control: no-cache`, so a new release shows at once;
  - any other path **without** a file extension, like `/kids/3f2a`, gets `index.html`, so a reload or a shared link opens the right page (the web app's router reads the path);
  - `/v1`, `/v1/...` and `/health` never get the app, and neither does a missing file with an extension (`/assets/old.js`): those get the usual JSON 404.
- The web responses carry security headers: a Content-Security-Policy that allows only this server's own scripts, styles, fonts, images and API calls and forbids framing, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.
- The CI smoke test (the whole Docker stack) now also checks the web app.

## 2. Goal

`docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait` starts a stack where http://localhost:8080 is the parent web app and http://localhost:8080/v1/... is the API, with the server tests covering the new file serving.

## 3. Out of scope

Do **not** do any of these in this card:

- No change to `web/`, `packages/` or `contract/`. The API and `contract/openapi.json` stay the same: the web files are not API routes.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay as they are on `main`. The file serving uses `node:fs` and `node:path`, not a static-file package.
- No change to `deploy/docker-compose.yml`. No Cloudflare Tunnel, no HTTPS, no backups: those are the deploy card (CARD-053).
- No compression, no ETags.
- Do not change any file that is not listed in section 5.
- Never commit `deploy/.env`, `web/dist/`, a real JWT secret, an SMTP key, a Firebase key, an FCM token, a device token or a parent-code secret.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, hono ^4.13.13, @hono/node-server ^1.19.0. Nothing new to install. The Docker image is still `node:24-alpine`.

`pnpm build` still prints the Vite warning `(!) Some chunks are larger than 500 kB after minification`, as in CARD-026. That is expected.

Docker Desktop must be running (check: `docker version` prints a `Server:` section). The image build downloads pnpm and every package, so the first `--build` takes a few minutes.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Comments use `§` (U+00A7); copy it exactly.

| File | Action |
|---|---|
| `server/src/web.ts` | create (5.1) |
| `server/src/config.ts` | replace (5.2) |
| `server/src/app.ts` | replace (5.3) |
| `server/test/helpers.ts` | replace (5.4) |
| `server/test/config.test.ts` | replace (5.5) |
| `server/test/web.test.ts` | create (5.6) |
| `server/test/fixtures/web/index.html` | create (5.7) |
| `server/test/fixtures/web/favicon.svg` | create (5.7) |
| `server/test/fixtures/web/assets/app-1a2b3c.js` | create (5.7) |
| `server/Dockerfile` | replace (5.8) |
| `.dockerignore` | replace (5.9) |
| `.github/workflows/typescript.yml` | replace (5.10) |
| `deploy/README.md` | replace (5.11) |

That is 13 files.

### 5.1 `server/src/web.ts`

Serves the folder in `WEB_DIR`, as described in section 1. It is one `app.get('*')` handler, registered after every API route, so an API route always wins. `next()` hands the request on, and with nothing left it reaches the JSON 404 of `server/src/router.ts`. `resolve` and `sep` keep the file inside the folder on Windows and Linux alike.

```typescript
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { OpenAPIHono } from '@hono/zod-openapi';

/** Content types for the files that `vite build` writes. Anything else is sent as bytes. */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Only this server's own files, styles may be inline (Radix sets style attributes), and no page may frame the app.
 * The web app talks to the API on the same origin (docs/SPEC.md §4.2).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

/**
 * Serves the built parent web app from `dir` (docs/SPEC.md §4.2). Register it after every API route.
 * - A file that exists is sent. Files under `/assets/` have a content hash in their name, so browsers keep them for a year;
 *   everything else is checked again on each visit.
 * - Any other path without a file extension, like `/kids/123`, gets `index.html`: the app's router shows the page.
 * - `/v1/...`, `/health` and a missing file with an extension fall through to the JSON 404.
 */
export function registerWeb(app: OpenAPIHono, dir: string) {
  const root = resolve(dir);

  app.get('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/v1' || path.startsWith('/v1/') || path === '/health') {
      return next();
    }
    // Hono has already decoded the path. A path that leaves the folder is never read.
    const file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) {
      return next();
    }
    const ext = extname(file);
    const sent = ext ? await read(file) : null;
    if (sent) {
      const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      return c.body(sent, 200, { ...HEADERS, 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
    }
    if (ext) {
      return next();
    }
    const index = await read(resolve(root, 'index.html'));
    if (!index) {
      return next();
    }
    return c.body(index, 200, { ...HEADERS, 'Content-Type': TYPES['.html']!, 'Cache-Control': 'no-cache' });
  });
}

/** The file's bytes, or null when it does not exist or is a folder. */
async function read(file: string) {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}
```

### 5.2 `server/src/config.ts`

The only changes: the `webDir` field with its comment, and `webDir: env.WEB_DIR?.trim() || null,` in `loadConfig`.

```typescript
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

export interface Config {
  port: number;
  databaseUrl: string;
  /** Signs access tokens (HS256) and keys the sign-in code hashes. At least 32 characters. */
  jwtSecret: string;
  /** Lower case. Signing in with this email gives the `superadmin` role (docs/SPEC.md §6.2). */
  superAdminEmail: string | null;
  /** Null when SMTP_USER, SMTP_PASS or SMTP_FROM is unset: sign-in codes are then logged, not emailed. */
  smtp: SmtpConfig | null;
  /** The Firebase service account key (JSON). Null when FIREBASE_SERVICE_ACCOUNT_JSON is unset: no pushes are sent. */
  firebaseServiceAccountJson: string | null;
  /** The folder with the built web app (`web/dist`). Null when WEB_DIR is unset: the server is the API only. */
  webDir: string | null;
}

/** Reads settings from environment variables. Throws if a required one is missing. Empty values count as unset. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set');
  }
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  const firebase = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || null;
  if (firebase && !isServiceAccount(firebase)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not a Firebase service account key');
  }
  const { SMTP_USER: user, SMTP_PASS: pass, SMTP_FROM: from } = env;
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl,
    jwtSecret,
    superAdminEmail: env.SUPER_ADMIN_EMAIL ? env.SUPER_ADMIN_EMAIL.trim().toLowerCase() : null,
    smtp:
      user && pass && from
        ? {
            host: env.SMTP_HOST || 'smtp-relay.brevo.com',
            port: Number(env.SMTP_PORT || 587),
            user,
            pass,
            from,
            fromName: env.SMTP_FROM_NAME || 'ScreenTime App',
          }
        : null,
    firebaseServiceAccountJson: firebase,
    webDir: env.WEB_DIR?.trim() || null,
  };
}

/** True for the JSON key file that Firebase downloads (Project settings, Service accounts). */
function isServiceAccount(json: string) {
  try {
    const key = JSON.parse(json) as Record<string, unknown>;
    return ['project_id', 'client_email', 'private_key'].every((field) => typeof key[field] === 'string');
  } catch {
    return false;
  }
}
```

### 5.3 `server/src/app.ts`

The only changes: the `registerWeb` import, and the four lines with their comment after `registerLiveRoutes(...)`. The `?.` is needed: `openApiDocument()` and some tests build the app with no `config` at all.

```typescript
import { createRoute } from '@hono/zod-openapi';
import { createNodeWebSocket } from '@hono/node-ws';
import { logger } from 'hono/logger';
import { ErrorResponse, HealthResponse } from '@screentime/schemas';
import { registerAdminRoutes } from './admin/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { registerDeviceRoutes } from './devices/routes.js';
import { registerFamilyRoutes } from './family/routes.js';
import { registerGrantRoutes } from './grants/routes.js';
import { registerKidRoutes } from './kids/routes.js';
import { LiveHub } from './live/hub.js';
import { registerLiveRoutes } from './live/routes.js';
import type { Mailer } from './mailer.js';
import { registerMessageRoutes } from './messages/routes.js';
import { registerNotifyRoutes } from './notify/routes.js';
import { registerParentModeRoutes } from './parentmode/routes.js';
import type { Pusher } from './push.js';
import { registerRequestRoutes } from './requests/routes.js';
import { createRouter } from './router.js';
import { registerSosRoutes } from './sos/routes.js';
import { registerSyncRoutes } from './sync/routes.js';
import { registerTamperRoutes } from './tamper/routes.js';
import { registerWeb } from './web.js';

/** What the routes need at request time. Tests pass their own. */
export interface AppDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  /** Sends FCM pushes. Left out, nothing is sent (tests that do not check pushes). */
  pusher?: Pusher;
  /** The connected kid devices. Left out, the app makes its own. */
  hub?: LiveHub;
}

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['public'],
  summary: 'Check that the server is up',
  responses: {
    200: {
      description: 'The server is up.',
      content: { 'application/json': { schema: HealthResponse } },
    },
    500: {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

/**
 * Builds the whole API. Each call has its own rate-limit counters and its own hub of connected devices.
 * `injectWebSocket` must be called with the HTTP server so that `/v1/device/ws` can upgrade.
 */
export function createApp(appDeps: AppDeps) {
  const app = createRouter();
  const deps = { ...appDeps, hub: appDeps.hub ?? new LiveHub() };
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  if (process.env.NODE_ENV !== 'test') {
    app.use(logger());
  }

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'deviceAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'The opaque device token from POST /v1/enrol.',
  });

  app.openapi(healthRoute, (c) => {
    const body = HealthResponse.parse({
      status: 'ok',
      service: 'screentime-server',
      time: new Date().toISOString(),
    });
    return c.json(body, 200);
  });

  registerAuthRoutes(app, deps);
  registerFamilyRoutes(app, deps);
  registerKidRoutes(app, deps);
  registerDeviceRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerGrantRoutes(app, deps);
  registerRequestRoutes(app, deps);
  registerMessageRoutes(app, deps);
  registerParentModeRoutes(app, deps);
  registerTamperRoutes(app, deps);
  registerSosRoutes(app, deps);
  registerNotifyRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerLiveRoutes(app, deps, upgradeWebSocket);
  // Last, so that every API path wins. `config` is missing only when building the OpenAPI document or in some tests.
  if (deps.config?.webDir) {
    registerWeb(app, deps.config.webDir);
  }

  return Object.assign(app, { injectWebSocket, hub: deps.hub });
}

/** The OpenAPI 3.1 document for every route (written to contract/openapi.json). */
export function openApiDocument(): ReturnType<ReturnType<typeof createApp>['getOpenAPI31Document']> {
  // Building the document never runs a handler, so the routes need no real database, settings, mailer or pusher.
  const app = createApp({} as AppDeps);
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Screen Time API', version: '0.1.0' },
  });
}
```

### 5.4 `server/test/helpers.ts`

The only change: `webDir: null` at the end of the object in `testConfig`.

```typescript
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Role } from '@screentime/schemas';
import { type AppDeps, createApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/tokens.js';
import type { Config } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_SECRET = 'test-secret-that-is-at-least-32-chars';

export function testConfig(databaseUrl: string, superAdminEmail: string | null = null): Config {
  return { port: 0, databaseUrl, jwtSecret: TEST_SECRET, superAdminEmail, smtp: null, firebaseServiceAccountJson: null, webDir: null };
}

/** Empties the test database and applies every migration. Only for TEST_DATABASE_URL. */
export async function resetDatabase(db: Db, pool: pg.Pool) {
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await runMigrations(db);
}

/** An access token as sign-in would issue it. The routes under test do not look up the session. */
export function tokenFor(who: { parentId: string | null; familyId: string | null }, roles: Role[] = ['parent']) {
  return signAccessToken(TEST_SECRET, { sessionId: randomUUID(), ...who, roles });
}

/** Small JSON client for one app. */
export function client(deps: AppDeps) {
  const app = createApp(deps);
  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return {
    get: (path: string, token: string | null) => call('GET', path, token),
    post: (path: string, token: string | null, body?: unknown) => call('POST', path, token, body),
    patch: (path: string, token: string | null, body: unknown) => call('PATCH', path, token, body),
    put: (path: string, token: string | null, body: unknown) => call('PUT', path, token, body),
    del: (path: string, token: string | null) => call('DELETE', path, token),
  };
}
```

### 5.5 `server/test/config.test.ts`

The only changes: `webDir: null,` in the first test, and the new test `reads WEB_DIR` after it.

```typescript
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const SECRET = 'x'.repeat(32);
const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: SECRET };

describe('loadConfig', () => {
  it('reads the required settings and defaults the rest', () => {
    expect(loadConfig(base)).toEqual({
      port: 8080,
      databaseUrl: 'postgres://x',
      jwtSecret: SECRET,
      superAdminEmail: null,
      smtp: null,
      firebaseServiceAccountJson: null,
      webDir: null,
    });
  });

  it('reads WEB_DIR', () => {
    expect(loadConfig({ ...base, WEB_DIR: ' /app/public ' }).webDir).toBe('/app/public');
    expect(loadConfig({ ...base, WEB_DIR: '' }).webDir).toBeNull();
  });

  it('reads PORT', () => {
    expect(loadConfig({ ...base, PORT: '9000' }).port).toBe(9000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ JWT_SECRET: SECRET })).toThrow('DATABASE_URL is not set');
  });

  it('throws when JWT_SECRET is missing or too short', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow('JWT_SECRET is not set');
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow('JWT_SECRET must be at least 32 characters');
  });

  it('lower-cases SUPER_ADMIN_EMAIL', () => {
    expect(loadConfig({ ...base, SUPER_ADMIN_EMAIL: ' James@Example.com ' }).superAdminEmail).toBe('james@example.com');
  });

  it('treats empty values as unset (Docker Compose passes unset variables as empty)', () => {
    const config = loadConfig({ ...base, SUPER_ADMIN_EMAIL: '', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'a@b.c', SMTP_HOST: '', SMTP_PORT: '', SMTP_FROM_NAME: '' });
    expect(config.superAdminEmail).toBeNull();
    expect(config.smtp).toMatchObject({ host: 'smtp-relay.brevo.com', port: 587, fromName: 'ScreenTime App' });
    expect(loadConfig({ ...base, SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '' }).smtp).toBeNull();
  });

  it('turns SMTP on only when user, password and sender are all set', () => {
    expect(loadConfig({ ...base, SMTP_USER: 'u', SMTP_PASS: 'p' }).smtp).toBeNull();
    expect(loadConfig({ ...base, SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'no-reply@example.com' }).smtp).toEqual({
      host: 'smtp-relay.brevo.com',
      port: 587,
      user: 'u',
      pass: 'p',
      from: 'no-reply@example.com',
      fromName: 'ScreenTime App',
    });
  });

  it('reads FIREBASE_SERVICE_ACCOUNT_JSON and rejects anything that is not a service account key', () => {
    const key = JSON.stringify({ type: 'service_account', project_id: 'p', client_email: 'a@p.iam.gserviceaccount.com', private_key: 'k' });
    expect(loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: key }).firebaseServiceAccountJson).toBe(key);
    expect(loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: '' }).firebaseServiceAccountJson).toBeNull();
    expect(() => loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"p"}' })).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not a Firebase service account key',
    );
    expect(() => loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: 'not json' })).toThrow('not a Firebase service account key');
  });
});
```

### 5.6 `server/test/web.test.ts`

These tests use the small folder of 5.7 instead of a real `web/dist`, so they need no build and no database: they run in every `pnpm test`.

```typescript
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type AppDeps, createApp } from '../src/app.js';
import { testConfig } from './helpers.js';

// A tiny stand-in for web/dist. These routes touch no database.
const webDir = fileURLToPath(new URL('./fixtures/web', import.meta.url));
const app = createApp({ config: { ...testConfig('postgres://unused'), webDir } } as AppDeps);

describe('web app', () => {
  it('serves index.html at / with the security headers', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toContain('<div id="root"></div>');
  });

  it('serves index.html for a page of the app, so a reload or a shared link works', async () => {
    for (const path of ['/kids', '/kids/3f2a', '/settings', '/admin']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain('<div id="root"></div>');
    }
  });

  it('serves a hashed asset with a long cache and a file in the root with none', async () => {
    const asset = await app.request('/assets/app-1a2b3c.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await asset.text()).toContain("console.log('app');");

    const icon = await app.request('/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers a missing file with the JSON 404, not the app', async () => {
    const res = await app.request('/assets/missing.js');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('never serves the app for an API path', async () => {
    for (const path of ['/v1', '/v1/nope', '/v1/kids/3f2a/nope']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type'), path).toContain('application/json');
    }
    const health = await app.request('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });
  });

  it('never reads a file outside the folder', async () => {
    // Each one tries to reach this test file, two folders up from the fixture.
    for (const path of ['/../../web.test.ts', '/%2e%2e/%2e%2e/web.test.ts', '/assets/..%2f..%2f..%2fweb.test.ts']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('serves nothing when WEB_DIR is not set', async () => {
    const apiOnly = createApp({ config: testConfig('postgres://unused') } as AppDeps);
    const res = await apiOnly.request('/');
    expect(res.status).toBe(404);
  });
});
```

### 5.7 The test folder `server/test/fixtures/web/`

Three small files: a stand-in `index.html`, an icon in the root and one "hashed" asset. Each ends with one newline.

`server/test/fixtures/web/index.html`:

```html
<!doctype html>
<html lang="en-AU">
  <head>
    <title>ScreenTime</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

`server/test/fixtures/web/favicon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>
```

`server/test/fixtures/web/assets/app-1a2b3c.js`:

```javascript
console.log('app');
```

### 5.8 `server/Dockerfile`

The changes: `COPY web/package.json web/` before the install, `COPY web/ web/` after `COPY server/ server/`, the build line also builds `@screentime/web...`, and the final image sets `WEB_DIR` and copies `web/dist` to `./public`.

```dockerfile
# Build from the repo root: docker build -f server/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/engine/package.json packages/engine/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY server/ server/
COPY web/ web/
RUN pnpm --filter "@screentime/server..." --filter "@screentime/web..." build
RUN pnpm --filter @screentime/server deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
# The server also serves the parent web app from here (docs/SPEC.md §4.2).
ENV WEB_DIR=/app/public
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/web/dist ./public
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

### 5.9 `.dockerignore`

The only change: the line `web` is gone, so the image build can see `web/`. `**/node_modules` and `**/dist` still keep your local `web/node_modules` and `web/dist` out of it.

```text
**/node_modules
**/dist
**/coverage
.git
.github
android
windows
docs
test-vectors
deploy
**/*.log
**/.env
**/.env.*
```

### 5.10 `.github/workflows/typescript.yml`

The only change: the new step `Check the web app` in the `docker compose smoke test` job, after `Check health`. It checks `/` and `/kids`, finds the main script in the page, checks its year-long cache, and checks that `/v1/nope` is still a 404.

```yaml
name: TypeScript

on:
  pull_request:
    paths:
      - "packages/**"
      - "server/**"
      - "web/**"
      - "test-vectors/**"
      - "contract/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "tsconfig.base.json"
      - ".nvmrc"
      - ".dockerignore"
      - "deploy/**"
      - ".github/workflows/typescript.yml"
  push:
    branches: [main]
    paths:
      - "packages/**"
      - "server/**"
      - "web/**"
      - "test-vectors/**"
      - "contract/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "tsconfig.base.json"
      - ".nvmrc"
      - ".dockerignore"
      - "deploy/**"
      - ".github/workflows/typescript.yml"

concurrency:
  group: typescript-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    name: typecheck and test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_DB: screentime_test
          POSTGRES_USER: screentime
          POSTGRES_PASSWORD: screentime
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U screentime -d screentime_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://screentime:screentime@localhost:5432/screentime_test
    steps:
      - name: Check out
        uses: actions/checkout@v5

      - name: Set up pnpm
        uses: pnpm/action-setup@v4

      - name: Set up Node
        uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm build && pnpm typecheck

      - name: Test
        run: pnpm test

  docker:
    name: docker compose smoke test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Check out
        uses: actions/checkout@v5

      - name: Start the stack
        run: |
          echo "POSTGRES_PASSWORD=ci-only-password" > deploy/.env
          echo "JWT_SECRET=ci-only-secret-that-is-at-least-32-characters" >> deploy/.env
          docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait

      - name: Check health
        run: |
          curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-all-errors http://localhost:8080/health
          docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | grep "database migrations applied"

      - name: Check the web app
        run: |
          curl --fail --silent --show-error http://localhost:8080/ | grep '<div id="root"></div>'
          curl --fail --silent --show-error http://localhost:8080/kids | grep '<div id="root"></div>'
          asset=$(curl --fail --silent --show-error http://localhost:8080/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js')
          curl --fail --silent --show-error --head "http://localhost:8080$asset" | grep -i 'cache-control: public, max-age=31536000, immutable'
          test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://localhost:8080/v1/nope)" = 404

      - name: Show logs on failure
        if: failure()
        run: docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs
```

### 5.11 `deploy/README.md`

The only change: the new paragraph after "The API applies database migrations every time it starts".

````markdown
# deploy

Docker Compose for the Screen Time server (`api`) and PostgreSQL 18 (`db`). On Unraid this sits behind a Cloudflare Tunnel; the full deployment guide comes in CARD-053.

All commands run from the **repo root** in PowerShell.

## First time

```powershell
Copy-Item deploy\.env.example deploy\.env
notepad deploy\.env        # set POSTGRES_PASSWORD and JWT_SECRET (see the comments in the file)
```

`deploy/.env` is git-ignored. Never commit it. The real SMTP password (the Brevo SMTP key) goes only in `deploy/.env` on the server, never in the repo.

## Run the whole stack

```powershell
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
Invoke-RestMethod http://localhost:8080/health
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down
```

The API applies database migrations every time it starts (log line `database migrations applied`). `down` keeps the data; `down -v` deletes it.

The same container serves the parent web app: open http://localhost:8080 and sign in. The image builds `web/` and the server serves it from `WEB_DIR` (`/app/public` in the image). API paths (`/v1/...`, `/health`) always win; any other path without a file extension, like `/kids`, gets the app's `index.html`. For web development use `pnpm dev:web` (http://localhost:5173) instead, which reloads on every change.

## Develop against the database

Start only the database, then run the server from source:

```powershell
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
$env:DATABASE_URL = "postgres://screentime:<POSTGRES_PASSWORD>@localhost:5432/screentime"
$env:JWT_SECRET = "<JWT_SECRET from deploy/.env>"
pnpm dev:server
```

## Sign in during development

Without SMTP settings the server does not send email: it writes each sign-in code to its log, as `SMTP not configured: sign-in code for <email> is <code>`. With the whole stack running, read it with `docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api`. Codes go only to emails of existing parents (create one with the seed script below) or to `SUPER_ADMIN_EMAIL`.

## Database tests

`server/test/db.test.ts` runs only when `TEST_DATABASE_URL` is set, and it **wipes** that database. Use a separate test database, never the real one:

```powershell
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
$env:TEST_DATABASE_URL = "postgres://screentime:<POSTGRES_PASSWORD>@localhost:5432/screentime_test"
pnpm test
```

CI always sets `TEST_DATABASE_URL`, so the database tests always run there.

## Changing the schema

Edit `server/src/db/schema.ts`, then generate a migration and commit it with the change:

```powershell
pnpm --filter @screentime/server db:generate --name <short_name>
```

Row-level security is hand-written SQL, not generated. To add a family-owned table, also create a custom migration and give it the same policy as the others in `server/drizzle/0002_rls.sql`:

```powershell
pnpm --filter @screentime/server exec drizzle-kit generate --custom --name rls_<table>
```

## Dev data

Fill an empty development database with one family (parent with your email, kids Alex and Sam, a weekly schedule each, and the five message presets). It refuses to run twice for the same email.

```powershell
$env:DATABASE_URL = "postgres://screentime:<POSTGRES_PASSWORD>@localhost:5432/screentime"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts you@example.com
```

Never run it against the production database.
````

## 6. Detailed spec

### 6.1 Which answer a GET gets

With `WEB_DIR` set, in this order:

| Request | Answer |
|---|---|
| Any API route, for example `GET /v1/kids` or `GET /health` | the API, exactly as before |
| `/v1`, `/v1/...` that is not a route, `/health` | JSON 404 `not_found` |
| A file that exists in `WEB_DIR`, for example `/assets/index-BDZ1f4yI.js` or `/favicon.svg` | the file, with its content type; `public, max-age=31536000, immutable` under `/assets/`, `no-cache` elsewhere |
| A path with a file extension that does not exist, for example `/assets/old.js` | JSON 404 `not_found` |
| Any other path, for example `/`, `/kids`, `/kids/3f2a`, `/sign-in` | `index.html`, `no-cache` |
| A path that would leave `WEB_DIR` | JSON 404, and nothing outside the folder is read |

POST, PUT, PATCH and DELETE never get the web app. HEAD gets the same headers as GET, with no body (Hono does that).

### 6.2 Security headers on every web response

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |

`'unsafe-inline'` for styles is needed because the dialogs and menus set `style` attributes. Scripts stay strict: the Vite build has no inline script.

### 6.3 Development is unchanged

`pnpm dev:server` does not set `WEB_DIR`, so it is the API only, and `pnpm dev:web` (http://localhost:5173) is still the way to work on the web app.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise. Use PowerShell, not `cmd.exe`: in CARD-026 a `cmd.exe` `set VAR=value && command` put a space at the end of the value.

1. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-027-web-in-server
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-027-web-in-server.md` and `web/src/pages/admin.tsx` (CARD-026) must exist. If one is missing, run `git pull origin main` again, and if it is still missing, stop and ask James.
2. Create 5.1, replace 5.2 and 5.3. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-027: serve the web app from the server`.
3. Replace 5.4 and 5.5, create 5.6 and 5.7. Run `pnpm --filter @screentime/server test`. Commit: `CARD-027: add web serving tests`.
4. Replace 5.8 to 5.11. Commit: `CARD-027: build the web app into the image`.
5. Run the acceptance checks in section 8.
6. Push and open the PR (section 10).
7. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
8. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and `git status --short pnpm-lock.yaml` is empty. `pnpm build` ends the web part with `✓ built in` (the 500 kB chunk warning is expected). Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  36 passed (36)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `web`: `Tests  49 passed (49)` (unchanged).
  - `server`: `test/web.test.ts (7 tests)`, `test/config.test.ts (9 tests)`, `Tests  49 passed | 171 skipped (220)`.
- [ ] `pnpm contract` leaves `git status --short contract` empty.
- [ ] The database tests pass against PostgreSQL 18. Use a local `deploy/.env` with throwaway values (this replaces any `deploy/.env` you have; it is git-ignored):
  ```powershell
  Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
  $env:TEST_DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime_test"
  pnpm --filter @screentime/server test
  Remove-Item Env:TEST_DATABASE_URL
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  ```
  Output: `Tests  220 passed (220)`.
- [ ] The whole stack serves the web app. With the same `deploy/.env`:
  ```powershell
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
  (curl.exe -s http://localhost:8080/ | Out-String) -match '<div id="root"></div>'
  (curl.exe -s http://localhost:8080/kids/3f2a | Out-String) -match '<div id="root"></div>'
  (curl.exe -s -I http://localhost:8080/ | Out-String) -match "frame-ancestors 'none'"
  (curl.exe -s http://localhost:8080/health | Out-String) -match '"status":"ok"'
  curl.exe -s -o NUL -w "%{http_code}" http://localhost:8080/v1/nope
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  ```
  The four `-match` lines print `True` and the last `curl.exe` prints `404`. Claude checks every page in a browser on the image after the PR is open; you do not need to sign in.
- [ ] `git status` does **not** list `deploy/.env` or anything in `web/dist/`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test** (which now has the step **Check the web app**). Wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 13 files (in any order):
  ```
  .dockerignore
  .github/workflows/typescript.yml
  deploy/README.md
  server/Dockerfile
  server/src/app.ts
  server/src/config.ts
  server/src/web.ts
  server/test/config.test.ts
  server/test/fixtures/web/assets/app-1a2b3c.js
  server/test/fixtures/web/favicon.svg
  server/test/fixtures/web/index.html
  server/test/helpers.ts
  server/test/web.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `server/test/web.test.ts` | `/` gets `index.html` with `no-cache` and the security headers. `/kids`, `/kids/3f2a`, `/settings` and `/admin` get `index.html`. A hashed asset gets its content type and the year-long cache; `/favicon.svg` gets `no-cache`. A missing `/assets/missing.js` is a JSON 404. `/v1`, `/v1/nope` and `/v1/kids/3f2a/nope` are JSON 404s and `/health` still answers. Three paths that try to reach a file outside the folder are 404s. Without `WEB_DIR`, `/` is a 404. |
| `server/test/config.test.ts` | `webDir` is `null` by default; `WEB_DIR` is trimmed, and an empty one counts as unset. |

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 to 4). Message format: `CARD-027: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-027-web-in-server`
5. Open a PR into `main` titled `CARD-027: Server serves the web build; production image`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-027-web-in-server --title "CARD-027: Server serves the web build; production image" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-027-web-in-server.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract unchanged
   - [x] database tests — output: `Tests  220 passed (220)`
   - [x] whole stack serves the web app — output: `True`, `True`, `True`, `True`, `404`
   - [x] deploy/.env and web/dist not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 13 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Only tick a box if you ran the command and saw that output. If you could not run something, leave the box empty and say why.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **`docker compose ... --build` fails in `pnpm install`** inside the image: the build needs the internet (npm). Check that Docker Desktop is running and online, and run the same command once more. If it still fails, paste the first error lines under "Blockers / questions".
- **The image builds but http://localhost:8080/ is a JSON 404**: the image has no `WEB_DIR` or no `/app/public`. Copy 5.8 again exactly, and check that 5.9 no longer has the line `web`.
- **`test/web.test.ts` fails with 404 for `/`**: the fixture folder is not at `server/test/fixtures/web/` or `index.html` has a different name. Check the three paths in 5.7.
- **TypeScript says `Property 'webDir' is missing`** somewhere in `server/test`: you skipped 5.4.
- **`curl` in PowerShell**: write `curl.exe`, not `curl`, and keep the `| Out-String`.
- **Temporary files** (the PR body, any helper script) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **The live.test.ts `afterAll` hook timed out** in the database tests: this happened once in CARD-024 on your PC and not on the re-run. If it happens, run the database tests once more and report both outputs under "Commands run". Do not change the test.
- **Every difference from the card is a deviation**, in any file, including tests, comments, test data and how you ran a check. List each one under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-027. Please review and merge if it is good.

CARD: CARD-027 Server serves the web build; production image
PR: <full PR URL>
Branch: bob/card-027-web-in-server
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
