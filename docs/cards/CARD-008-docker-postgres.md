# CARD-008: Docker, PostgreSQL 18, Drizzle and migrations

| Field | Value |
|---|---|
| Card | CARD-008 |
| Title | Docker, PostgreSQL 18, Drizzle and migrations |
| Size | M |
| Depends on | CARD-001, CARD-002 (merged to `main`) |
| Spec sections | docs/SPEC.md §4.1, §4.2, §6 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-008-docker-postgres` |
| PR title | `CARD-008: Docker, PostgreSQL 18, Drizzle and migrations` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app with one route, `GET /health`. It has no database yet. In production it will run as two Docker containers on James's Unraid server: `api` (this server) and `db` (PostgreSQL 18).

This card:

1. Adds **Drizzle ORM** with the `pg` driver, and the first table, `families`.
2. Makes the server **apply database migrations every time it starts**.
3. Adds a **Dockerfile** for the server and a **Docker Compose** file for `api` + `db`.
4. Adds database tests and runs them in CI against a real PostgreSQL 18, plus a CI job that starts the whole Compose stack and checks `/health`.

All other tables and row-level security come in CARD-010. Do not add them here.

## 2. Goal

`docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait` starts PostgreSQL 18 and the API. The API applies migrations (creating the `families` table) and answers `GET /health`. CI runs the database tests against PostgreSQL 18 and the Compose smoke test, and both jobs pass.

## 3. Out of scope

Do **not** do any of these in this card:

- No tables other than `families`. No row-level security, no roles, no seed data (CARD-010).
- No new API routes. `GET /health` stays exactly as it is (do not add a database check to it).
- No `.env` loading library (no `dotenv`). Settings come from environment variables only.
- No pg-boss, no Redis, no web app container, no Cloudflare Tunnel, no backups (later cards).
- Do not change `packages/`, `android/`, `windows/`, `web/`, `server/src/app.ts` or `server/test/health.test.ts`.
- Do not edit the generated files in `server/drizzle/meta/` by hand.
- Never commit `deploy/.env` or any real password.

## 4. Tech and versions

| Item | Version |
|---|---|
| `drizzle-orm` | `^0.45.4` (dependency of `server`) |
| `pg` | `^8.23.1` (dependency of `server`) |
| `drizzle-kit` | `^0.31.11` (dev dependency of `server`) |
| `@types/pg` | `^8.23.1` (dev dependency of `server`) |
| PostgreSQL | 18, Docker image `postgres:18` |
| Node in Docker | image `node:24-alpine` |
| Everything else | unchanged from `main` (Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2) |

PostgreSQL 18 has a built-in `uuidv7()` function. The `families.id` default uses it, so no extension is needed.

### Tools James must install first

**Docker Desktop** for Windows (https://www.docker.com/products/docker-desktop/), started and running. Check in PowerShell:

```powershell
docker version
docker compose version
```

Both must print a version without errors (the `Server:` section must be present in `docker version`). If not, stop and ask James to install or start Docker Desktop.

## 5. Files

Create or change exactly these files. Paths are relative to the repo root.

| File | Action |
|---|---|
| `server/package.json` | change (5.1) |
| `pnpm-lock.yaml` | updated by `pnpm install` (never by hand) |
| `server/drizzle.config.ts` | create (5.2) |
| `server/src/db/schema.ts` | create (5.3) |
| `server/src/db/client.ts` | create (5.4) |
| `server/src/db/migrate.ts` | create (5.5) |
| `server/src/config.ts` | create (5.6) |
| `server/src/index.ts` | replace (5.7) |
| `server/drizzle/0000_init.sql` | **generated** by drizzle-kit (5.8) |
| `server/drizzle/meta/_journal.json` | **generated** by drizzle-kit |
| `server/drizzle/meta/0000_snapshot.json` | **generated** by drizzle-kit |
| `server/test/config.test.ts` | create (5.9) |
| `server/test/db.test.ts` | create (5.10) |
| `server/Dockerfile` | create (5.11) |
| `.dockerignore` | create (5.12) |
| `deploy/docker-compose.yml` | create (5.13) |
| `deploy/.env.example` | create (5.14) |
| `deploy/README.md` | replace (5.15) |
| `README.md` | change (5.16) |
| `.github/workflows/typescript.yml` | replace (5.17) |

### 5.1 `server/package.json`

The whole file after the change. New: the four packages and the `db:generate` script. Edit the file to match, then run `pnpm install` from the repo root to update `pnpm-lock.yaml`.

```json
{
  "name": "@screentime/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.0",
    "@screentime/schemas": "workspace:*",
    "drizzle-orm": "^0.45.4",
    "hono": "^4.9.0",
    "pg": "^8.23.1"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/pg": "^8.23.1",
    "drizzle-kit": "^0.31.11",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

### 5.2 `server/drizzle.config.ts`

Tells drizzle-kit where the schema is and where to write migrations.

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
```

### 5.3 `server/src/db/schema.ts`

The `families` table from docs/SPEC.md §6.1. TypeScript names are camelCase; database columns are snake_case.

```ts
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** docs/SPEC.md §6.1. More tables are added by CARD-010. */
export const families = pgTable('families', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  emergencyNumber: text('emergency_number').notNull().default('000'),
  parentCodeSecret: text('parent_code_secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});
```

### 5.4 `server/src/db/client.ts`

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>['db'];

/** Opens a connection pool to PostgreSQL. Call `pool.end()` to close it. */
export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
```

### 5.5 `server/src/db/migrate.ts`

The path `../../drizzle` works both from `src/db/` (dev, tests) and from `dist/db/` (built), because both are two folders below `server/`.

```ts
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.js';

/** server/drizzle, found from both src/db (tsx, tests) and dist/db (built). */
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies every migration in server/drizzle that has not run yet. Safe to call on every start. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
```

### 5.6 `server/src/config.ts`

```ts
export interface Config {
  port: number;
  databaseUrl: string;
}

/** Reads settings from environment variables. Throws if a required one is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl,
  };
}
```

### 5.7 `server/src/index.ts`

Replace the whole file. The server now refuses to start without `DATABASE_URL`, and applies migrations before it listens.

```ts
import { serve } from '@hono/node-server';
import { app } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';

const config = loadConfig();
const { db } = createDb(config.databaseUrl);

await runMigrations(db);
console.log('database migrations applied');

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`screentime-server listening on http://localhost:${info.port}`);
});
```

### 5.8 `server/drizzle/` (generated)

Do **not** write these files by hand. After 5.3 is in place, run from the repo root:

```powershell
pnpm --filter @screentime/server db:generate --name init
```

It prints `Your SQL migration file ➜ drizzle/0000_init.sql` and creates `server/drizzle/0000_init.sql`, `server/drizzle/meta/_journal.json` and `server/drizzle/meta/0000_snapshot.json`. Commit all three. The SQL file must contain exactly this (drizzle-kit indents with tabs; that is fine):

```sql
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"emergency_number" text DEFAULT '000' NOT NULL,
	"parent_code_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
```

If the SQL is different, your `schema.ts` does not match 5.3. Fix `schema.ts`, delete the `server/drizzle` folder, and generate again.

### 5.9 `server/test/config.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('reads DATABASE_URL and defaults PORT to 8080', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x' })).toEqual({ port: 8080, databaseUrl: 'postgres://x' });
  });

  it('reads PORT', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x', PORT: '9000' }).port).toBe(9000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL is not set');
  });
});
```

### 5.10 `server/test/db.test.ts`

This test **wipes** the database in `TEST_DATABASE_URL`, so it uses a separate variable from `DATABASE_URL` and only runs when that variable is set. CI always sets it.

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { families } from '../src/db/schema.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
// CI sets TEST_DATABASE_URL; locally see deploy/README.md.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('database', () => {
  const { db, pool } = createDb(url ?? '');

  beforeAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies migrations to an empty database', async () => {
    await runMigrations(db);
    const result = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(result.rows.map((r) => r.table_name)).toContain('families');
  });

  it('is safe to run migrations again', async () => {
    await expect(runMigrations(db)).resolves.toBeUndefined();
  });

  it('creates a family with server defaults', async () => {
    const [row] = await db
      .insert(families)
      .values({ name: 'Test family', timezone: 'Australia/Sydney', parentCodeSecret: 'JBSWY3DPEHPK3PXP' })
      .returning();
    expect(row).toBeDefined();
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row?.emergencyNumber).toBe('000');
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.disabledAt).toBeNull();
  });
});
```

### 5.11 `server/Dockerfile`

Built from the **repo root** (the build needs the workspace files). `pnpm deploy` copies the server with only its production dependencies, the built `dist/` and the `drizzle/` migrations into `/out`.

```dockerfile
# Build from the repo root: docker build -f server/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/engine/package.json packages/engine/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY server/ server/
RUN pnpm --filter "@screentime/server..." build
RUN pnpm --filter @screentime/server deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

### 5.12 `.dockerignore`

At the repo root. Keeps the Docker build context small and keeps secrets out of the image.

```text
**/node_modules
**/dist
**/coverage
.git
.github
android
windows
docs
web
test-vectors
deploy
**/*.log
**/.env
**/.env.*
```

### 5.13 `deploy/docker-compose.yml`

PostgreSQL 18 images keep their data in `/var/lib/postgresql/18/docker`, so the volume is mounted on `/var/lib/postgresql` (not `/var/lib/postgresql/data` as for older versions).

```yaml
# Screen Time: API server + PostgreSQL 18.
# Run from the repo root:  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
name: screentime

services:
  db:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_DB: screentime
      POSTGRES_USER: screentime
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in deploy/.env}
    volumes:
      # PostgreSQL 18 images keep data under /var/lib/postgresql/18/docker, so mount the parent.
      - db-data:/var/lib/postgresql
    ports:
      # Only reachable from this machine (for local development and backups).
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U screentime -d screentime"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build:
      context: ..
      dockerfile: server/Dockerfile
    restart: unless-stopped
    environment:
      PORT: "8080"
      DATABASE_URL: postgres://screentime:${POSTGRES_PASSWORD}@db:5432/screentime
    ports:
      - "8080:8080"
    depends_on:
      db:
        condition: service_healthy

volumes:
  db-data:
```

### 5.14 `deploy/.env.example`

`deploy/.env` itself is already git-ignored by the root `.gitignore` (`.env.*` / `.env`). Never commit it.

```text
# Copy to deploy/.env (git-ignored) and change the value.
POSTGRES_PASSWORD=change-me
```

### 5.15 `deploy/README.md`

Replace the whole file.

````markdown
# deploy

Docker Compose for the Screen Time server (`api`) and PostgreSQL 18 (`db`). On Unraid this sits behind a Cloudflare Tunnel; the full deployment guide comes in CARD-053.

All commands run from the **repo root** in PowerShell.

## First time

```powershell
Copy-Item deploy\.env.example deploy\.env
notepad deploy\.env        # set POSTGRES_PASSWORD to a long random value
```

`deploy/.env` is git-ignored. Never commit it.

## Run the whole stack

```powershell
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
Invoke-RestMethod http://localhost:8080/health
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down
```

The API applies database migrations every time it starts (log line `database migrations applied`). `down` keeps the data; `down -v` deletes it.

## Develop against the database

Start only the database, then run the server from source:

```powershell
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
$env:DATABASE_URL = "postgres://screentime:<POSTGRES_PASSWORD>@localhost:5432/screentime"
pnpm dev:server
```

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
````

### 5.16 `README.md`

In the "Quick start (TypeScript parts)" section, replace this block:

````markdown
```powershell
pnpm install
pnpm test
pnpm dev:server
```

Then open http://localhost:8080/health.
````

with:

````markdown
```powershell
pnpm install
pnpm test
```

The server needs PostgreSQL. Start it with Docker and run the server as described in [deploy/README.md](deploy/README.md), then open http://localhost:8080/health.
````

Change nothing else in `README.md`.

### 5.17 `.github/workflows/typescript.yml`

Replace the whole file. Changes from `main`: two more paths (`.dockerignore`, `deploy/**`) in both lists; a PostgreSQL 18 service and `TEST_DATABASE_URL` for the test job; a new `docker` job that starts the Compose stack and checks `/health`. The password `screentime` / `ci-only-password` exists only inside the CI runner.

```yaml
name: TypeScript

on:
  pull_request:
    paths:
      - "packages/**"
      - "server/**"
      - "web/**"
      - "test-vectors/**"
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
          docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait

      - name: Check health
        run: |
          curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-all-errors http://localhost:8080/health
          docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | grep "database migrations applied"

      - name: Show logs on failure
        if: failure()
        run: docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs
```

## 6. Detailed spec

### 6.1 Startup

`server/src/index.ts` does, in order:

1. `loadConfig()` reads `DATABASE_URL` (required) and `PORT` (default `8080`). Missing `DATABASE_URL` throws `DATABASE_URL is not set` and the process exits with an error.
2. `createDb(url)` opens a `pg` connection pool wrapped in Drizzle.
3. `runMigrations(db)` applies every migration in `server/drizzle/` that has not run yet, then logs `database migrations applied`. Drizzle records applied migrations in the `drizzle.__drizzle_migrations` table, so running it again does nothing.
4. The Hono app starts listening and logs `screentime-server listening on http://localhost:8080`.

### 6.2 The `families` table (docs/SPEC.md §6.1)

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` | primary key, default `uuidv7()` |
| `name` | `text` | required |
| `timezone` | `text` | required (IANA name, for example `Australia/Sydney`) |
| `emergency_number` | `text` | required, default `'000'` |
| `parent_code_secret` | `text` | required (base32, used later for parent-mode codes) |
| `created_at` | `timestamptz` | required, default `now()` |
| `disabled_at` | `timestamptz` | nullable |

### 6.3 Docker

- `docker build -f server/Dockerfile .` (from the repo root) builds the API image. The image runs `node dist/index.js` as the unprivileged `node` user on port 8080.
- `deploy/docker-compose.yml` has two services. `db` (PostgreSQL 18, data in the `db-data` volume, port 5432 bound to `127.0.0.1` only) and `api` (built from the Dockerfile, port 8080, starts only after `db` is healthy).
- The database password comes from `POSTGRES_PASSWORD` in `deploy/.env`. Compose refuses to start if it is not set.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker (section 4). If it fails, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-008-docker-postgres
   ```
3. Edit `server/package.json` to match 5.1 exactly, then run `pnpm install`. Commit `server/package.json` and `pnpm-lock.yaml`: `CARD-008: add Drizzle and pg`.
4. Create 5.2 to 5.7. Run `pnpm build` and `pnpm typecheck` (both must pass). Commit: `CARD-008: add database client, schema and startup migrations`.
5. Generate the migration (5.8) and check the SQL. Commit the three files in `server/drizzle/`: `CARD-008: add initial migration`.
6. Create the tests 5.9 and 5.10. Commit: `CARD-008: add config and database tests`.
7. Create 5.11 to 5.16. Commit: `CARD-008: add Dockerfile and Compose stack`.
8. Replace the workflow (5.17). Commit: `CARD-008: run database tests and Compose smoke test in CI`.
9. Run the acceptance checks in section 8.
10. Push and open the PR (section 10).

## 8. Acceptance criteria

Use a throwaway password for local checks, for example `local-dev-only`. Never put a real password in the PR.

- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`, the server tests show `test/config.test.ts (3 tests)`, `test/health.test.ts (2 tests)` and `test/db.test.ts (3 tests | 3 skipped)`.
- [ ] `server/drizzle/0000_init.sql` matches the SQL in 5.8.
- [ ] The Compose stack starts and answers:
  ```powershell
  Copy-Item deploy\.env.example deploy\.env
  (Get-Content deploy\.env) -replace 'change-me','local-dev-only' | Set-Content deploy\.env
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
  Invoke-RestMethod http://localhost:8080/health
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api
  ```
  `/health` prints `status : ok` and `service : screentime-server`. The api logs contain `database migrations applied` and `screentime-server listening on http://localhost:8080`.
- [ ] The database tests pass against the Compose database (the stack from the previous check is still running):
  ```powershell
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
  $env:TEST_DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime_test"
  pnpm --filter @screentime/server test
  Remove-Item Env:TEST_DATABASE_URL
  ```
  Output: `Tests  8 passed (8)`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env` (it is ignored).
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 20 files (in any order):
  ```
  .dockerignore
  .github/workflows/typescript.yml
  README.md
  deploy/.env.example
  deploy/README.md
  deploy/docker-compose.yml
  pnpm-lock.yaml
  server/Dockerfile
  server/drizzle.config.ts
  server/drizzle/0000_init.sql
  server/drizzle/meta/0000_snapshot.json
  server/drizzle/meta/_journal.json
  server/package.json
  server/src/config.ts
  server/src/db/client.ts
  server/src/db/migrate.ts
  server/src/db/schema.ts
  server/src/index.ts
  server/test/config.test.ts
  server/test/db.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `server/test/config.test.ts` | `loadConfig` reads `DATABASE_URL`, defaults `PORT` to 8080, reads `PORT`, and throws `DATABASE_URL is not set` when it is missing. |
| `server/test/db.test.ts` | On an emptied database: migrations create the `families` table; running them again succeeds; inserting a family returns a UUID version 7 id, `emergencyNumber` `000`, a `createdAt` date and a null `disabledAt`. Runs only when `TEST_DATABASE_URL` is set (always in CI). |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 8). Message format: `CARD-008: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-008-docker-postgres`
5. Open a PR into `main` titled `CARD-008: Docker, PostgreSQL 18, Drizzle and migrations`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-008-docker-postgres --title "CARD-008: Docker, PostgreSQL 18, Drizzle and migrations" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-008-docker-postgres.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] build, typecheck, test — output: `...`
   - [x] 0000_init.sql matches the card
   - [x] Compose stack — output: `status : ok`, `database migrations applied`
   - [x] database tests — output: `Tests  8 passed (8)`
   - [x] deploy/.env not tracked
   - [x] only expected files changed — output: 20 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **`docker` commands fail with "cannot connect to the Docker daemon" or a pipe error**: Docker Desktop is not running. Ask James to start it.
- **Port 5432 or 8080 is already in use**: something else on the PC uses it. Stop and tell James which port; do not change the ports in the Compose file.
- **`function uuidv7() does not exist`**: the database is not PostgreSQL 18. Use the Compose `db` service (`postgres:18`), not another PostgreSQL install.
- **`password authentication failed`** in the database test: the password in `TEST_DATABASE_URL` must match `POSTGRES_PASSWORD` in `deploy/.env`. If you changed `deploy/.env` after the first start, run `down -v` and start again (the password is only set when the volume is first created).
- **`pnpm install` changes many unrelated lines in `pnpm-lock.yaml`**: that is fine if `pnpm install --frozen-lockfile` passes afterwards. Do not edit the lockfile by hand.
- **The Docker build fails at `pnpm deploy`**: copy the error into the PR. Do not change the Dockerfile's approach yourself.
