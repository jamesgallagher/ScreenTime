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
  return { port: 0, databaseUrl, jwtSecret: TEST_SECRET, superAdminEmail, smtp: null };
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
