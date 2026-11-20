---
name: db-migration
description: How to add a table or column to the Screen Time PostgreSQL database with Drizzle, including row-level security. Use when a card adds a table, column or index.
---

# Adding a table or column

1. Change `server/src/db/schema.ts` (Drizzle `pgTable`). Columns are snake_case in SQL, camelCase in TypeScript. Kinds are `text` with a CHECK, not enums.
2. Generate: `pnpm --filter @screentime/server db:generate`. It writes `server/drizzle/NNNN_<random_name>.sql`, a snapshot and a line in `server/drizzle/meta/_journal.json`.
3. Rename the SQL file to the name the card gives (`NNNN_<name>.sql`) and change its `"tag"` in `_journal.json` to match (the only file in `meta` the agent may edit).
4. **A new table needs row-level security.** Copy the end of `server/drizzle/0009_device_games.sql`: `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` and the `family_isolation` policy on `family_id` with `current_setting('app.family_id', true)`. Without it, other families can see the rows.
5. Foreign keys to `families`, `kids` and `devices` like `0009`.
6. The server applies migrations at start; the tests' `resetDatabase` applies them to the test database.
7. Test: a test that the table exists and that `pg_policies` has `family_isolation` for it; and the behaviour through the route, not by reading the table alone.
