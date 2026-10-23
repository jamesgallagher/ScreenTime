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
