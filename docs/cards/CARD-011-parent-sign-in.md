# CARD-011: Parent sign-in

| Field | Value |
|---|---|
| Card | CARD-011 |
| Title | Parent sign-in |
| Size | M |
| Depends on | CARD-009 and CARD-010 (merged to `main`) |
| Spec sections | docs/SPEC.md §6.2, §9.1, §11.1, §11.4 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-011-parent-sign-in` |
| PR title | `CARD-011: Parent sign-in` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. Today it has one route, `GET /health`. Request and response shapes are Zod schemas in `packages/schemas` (package `@screentime/schemas`), and `pnpm contract` writes the generated OpenAPI document to `contract/openapi.json`, which is committed. `server/test/openapi.test.ts` fails if that file is out of date. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts` and `server/src/router.ts` turns it into the response.

The database (PostgreSQL 18, Drizzle ORM) has every table already (CARD-010), including `parents`, `families`, `otp_codes` and `parent_sessions`. Family data is protected by row-level security: a request for one family runs its queries through `withFamily(db, familyId, fn)` from `server/src/db/family.ts`. Sign-in itself is not family data yet (the caller is unknown), so the sign-in routes use `db` directly, which bypasses row-level security.

This card adds **parent sign-in by emailed code**:

1. `POST /v1/auth/otp/request` emails a 6-digit code.
2. `POST /v1/auth/otp/verify` checks the code and returns a short-lived **access token** (a JWT, 15 minutes) and a long-lived **refresh token** (random, 90 days of inactivity, a new one on every use).
3. `POST /v1/auth/refresh` swaps a refresh token for a new pair. `POST /v1/auth/logout` ends the session.
4. `GET /v1/me` returns the signed-in parent, their family and roles. It is the first route that needs the access token, and the first that uses `withFamily`.
5. The **super admin** (one email in the `SUPER_ADMIN_EMAIL` setting) can sign in even without being a parent, and gets the `superadmin` role. The super admin's own routes come in CARD-012.

To make this possible, the server code changes shape: `server/src/app.ts` no longer exports a ready-made `app`. It exports `createApp(deps)`, where `deps` holds the database, the settings and the mailer. Tests build their own app with a fake mailer.

## 2. Goal

A parent can sign in with an emailed code, refresh and sign out, and `GET /v1/me` answers with who they are. Codes are emailed through Brevo SMTP when the SMTP settings are present, and written to the server log when they are not. All of it is tested against PostgreSQL 18 in CI, and the OpenAPI contract describes the five new routes.

## 3. Out of scope

Do **not** do any of these in this card:

- No family, kid, parent-management or `/v1/admin/*` routes (CARD-012). No device enrolment or device tokens (CARD-013).
- No cookies. The web app's `HttpOnly` refresh cookie (SPEC §11.1 point 4) comes with the web app card. Here the refresh token is in the JSON body only.
- No web or Android UI.
- No Redis or database table for rate limits. The per-IP limits are in memory (5.9).
- No other JWT library (`jsonwebtoken`, `jose`). Use `hono/jwt`, which is part of `hono`.
- No other npm packages than `nodemailer`. It ships its own TypeScript types: do **not** add `@types/nodemailer`.
- Do not change `server/src/router.ts`, `server/src/errors.ts`, `server/src/db/client.ts`, `server/src/db/family.ts`, `server/src/db/migrate.ts`, `server/test/db.test.ts`, `server/scripts/`, `packages/engine`, `android/`, `windows/` or `web/`.
- Do not edit `server/drizzle/0000_init.sql`, `0001_tables.sql`, `0002_rls.sql` or their snapshots. Do not edit generated files in `server/drizzle/meta/` by hand.
- Never commit `deploy/.env`, a real JWT secret, a Brevo SMTP key or any other password.

## 4. Tech and versions

| Item | Version |
|---|---|
| `nodemailer` | `^10.2.1` (new dependency of `server`; includes its own types) |
| `hono` | `^4.13.13` (already there; `hono/jwt` signs and checks the JWTs) |
| Everything else | unchanged from `main` (Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, Zod ^4.6, drizzle-orm ^0.45.4, drizzle-kit ^0.31.11, PostgreSQL 18) |

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character.

| File | Action |
|---|---|
| `server/package.json` | `nodemailer` added by `pnpm add` (5.1) |
| `pnpm-lock.yaml` | updated by `pnpm add` (never by hand) |
| `packages/schemas/src/auth.ts` | create (5.2) |
| `packages/schemas/src/index.ts` | replace (5.3) |
| `packages/schemas/test/auth.test.ts` | create (5.4) |
| `server/src/db/schema.ts` | change one table (5.5) |
| `server/drizzle/0003_super_admin_sessions.sql` | **generated** (5.6) |
| `server/drizzle/meta/0003_snapshot.json` | **generated** (5.6) |
| `server/drizzle/meta/_journal.json` | **updated** by drizzle-kit (5.6) |
| `server/src/config.ts` | replace (5.7) |
| `server/src/mailer.ts` | create (5.8) |
| `server/src/auth/rate-limit.ts` | create (5.9) |
| `server/src/auth/tokens.ts` | create (5.10) |
| `server/src/auth/routes.ts` | create (5.11) |
| `server/src/app.ts` | replace (5.12) |
| `server/src/index.ts` | replace (5.13) |
| `server/vitest.config.ts` | create (5.14) |
| `server/test/config.test.ts` | replace (5.15) |
| `server/test/health.test.ts` | replace (5.16) |
| `server/test/errors.test.ts` | change two lines (5.17) |
| `server/test/openapi.test.ts` | replace (5.18) |
| `server/test/tokens.test.ts` | create (5.19) |
| `server/test/auth.test.ts` | create (5.20) |
| `contract/openapi.json` | **generated** by `pnpm contract` (5.21) |
| `deploy/docker-compose.yml` | replace (5.22) |
| `deploy/.env.example` | replace (5.23) |
| `deploy/README.md` | replace (5.24) |
| `.github/workflows/typescript.yml` | add one line (5.25) |

That is 28 files.

### 5.1 `server/package.json`

From the repo root:

```powershell
pnpm --filter @screentime/server add nodemailer@^10.2.1
```

This adds `"nodemailer": "^10.2.1",` to `dependencies` in `server/package.json` (between `hono` and `pg`) and updates `pnpm-lock.yaml`. Change nothing else in `server/package.json`.

### 5.2 `packages/schemas/src/auth.ts`

```ts
import { z } from 'zod';

/** What a signed-in parent may do. `superadmin` comes from the SUPER_ADMIN_EMAIL setting (docs/SPEC.md §6.2). */
export const Role = z.enum(['parent', 'superadmin']).meta({ id: 'Role' });

export type Role = z.infer<typeof Role>;

/** Body of POST /v1/auth/otp/request. */
export const OtpRequest = z
  .object({
    email: z.email().max(254),
  })
  .meta({ id: 'OtpRequest' });

export type OtpRequest = z.infer<typeof OtpRequest>;

/** Body of POST /v1/auth/otp/verify. */
export const OtpVerifyRequest = z
  .object({
    email: z.email().max(254),
    code: z.string().regex(/^[0-9]{6}$/),
    client: z.enum(['web', 'android']),
    clientLabel: z.string().min(1).max(100),
  })
  .meta({ id: 'OtpVerifyRequest' });

export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequest>;

/** Body of POST /v1/auth/refresh. */
export const RefreshRequest = z
  .object({
    refreshToken: z.string().min(1).max(200),
  })
  .meta({ id: 'RefreshRequest' });

export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** The signed-in parent, their family and roles (GET /v1/me). Both are null for a super admin who is not a parent. */
export const Me = z
  .object({
    parent: z
      .object({
        id: z.uuid(),
        email: z.email(),
        displayName: z.string(),
        phoneE164: z.string().nullable(),
      })
      .nullable(),
    family: z
      .object({
        id: z.uuid(),
        name: z.string(),
        timezone: z.string(),
        emergencyNumber: z.string(),
      })
      .nullable(),
    roles: z.array(Role),
  })
  .meta({ id: 'Me' });

export type Me = z.infer<typeof Me>;

/** Response of POST /v1/auth/otp/verify and POST /v1/auth/refresh. */
export const AuthResponse = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    /** Seconds until the access token expires. */
    expiresIn: z.number().int().positive(),
    me: Me,
  })
  .meta({ id: 'AuthResponse' });

export type AuthResponse = z.infer<typeof AuthResponse>;
```

### 5.3 `packages/schemas/src/index.ts`

```ts
export { AuthResponse, Me, OtpRequest, OtpVerifyRequest, RefreshRequest, Role } from './auth.js';
export { ErrorCode, ErrorResponse } from './errors.js';
export { HealthResponse } from './health.js';
```

### 5.4 `packages/schemas/test/auth.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { OtpRequest, OtpVerifyRequest } from '../src/index.js';

describe('auth schemas', () => {
  it('accepts a valid email and rejects anything else', () => {
    expect(OtpRequest.safeParse({ email: 'mum@example.com' }).success).toBe(true);
    expect(OtpRequest.safeParse({ email: 'not an email' }).success).toBe(false);
  });

  it('needs a 6-digit code and a known client', () => {
    const ok = { email: 'mum@example.com', code: '012345', client: 'android', clientLabel: 'Pixel 10' };
    expect(OtpVerifyRequest.safeParse(ok).success).toBe(true);
    expect(OtpVerifyRequest.safeParse({ ...ok, code: '12345' }).success).toBe(false);
    expect(OtpVerifyRequest.safeParse({ ...ok, code: '12345a' }).success).toBe(false);
    expect(OtpVerifyRequest.safeParse({ ...ok, client: 'ios' }).success).toBe(false);
    expect(OtpVerifyRequest.safeParse({ ...ok, clientLabel: '' }).success).toBe(false);
  });
});
```

### 5.5 `server/src/db/schema.ts`

Only the `parentSessions` table changes. A super admin who is not a parent has no parent or family, so `parent_id` and `family_id` become nullable, and a check makes sure they are either both set or both null. Replace the whole `export const parentSessions = pgTable(...)` block (from `export const parentSessions` down to its closing `);`) with exactly this. Change nothing else in the file.

```ts
export const parentSessions = pgTable(
  'parent_sessions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    // Both null for a super admin who is not a parent (docs/SPEC.md §6.2).
    parentId: uuid('parent_id').references(() => parents.id),
    familyId: uuid('family_id').references(() => families.id),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    client: text('client').notNull(),
    clientLabel: text('client_label').notNull(),
    fcmToken: text('fcm_token'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('parent_sessions_refresh_token_hash_key').on(t.refreshTokenHash),
    check('parent_sessions_client', sql`${t.client} in ('web', 'android')`),
    check('parent_sessions_parent_family', sql`(${t.parentId} is null) = (${t.familyId} is null)`),
  ],
);
```

### 5.6 `server/drizzle/0003_super_admin_sessions.sql` (generated)

Do **not** write this by hand. After 5.5, run from the repo root:

```powershell
pnpm --filter @screentime/server db:generate --name super_admin_sessions
```

It prints `Your SQL migration file ➜ drizzle/0003_super_admin_sessions.sql` (or with a backslash) and creates `server/drizzle/0003_super_admin_sessions.sql` and `server/drizzle/meta/0003_snapshot.json`, and adds a fourth entry to `server/drizzle/meta/_journal.json`. The SQL file must contain exactly this:

```sql
ALTER TABLE "parent_sessions" ALTER COLUMN "parent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parent_sessions" ALTER COLUMN "family_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parent_sessions" ADD CONSTRAINT "parent_sessions_parent_family" CHECK (("parent_sessions"."parent_id" is null) = ("parent_sessions"."family_id" is null));
```

Row-level security on `parent_sessions` stays as it is: a row with a null `family_id` never matches the policy, so it is invisible inside `withFamily`, which is what we want.

### 5.7 `server/src/config.ts`

Two new required checks (`JWT_SECRET` set and at least 32 characters) and three optional settings. Empty strings count as unset, because Docker Compose passes an unset `${VAR:-}` as an empty string.

```ts
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
  };
}
```

### 5.8 `server/src/mailer.ts`

```ts
import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config.js';

export interface Mailer {
  sendSignInCode(to: string, code: string): Promise<void>;
}

/** Sends email over SMTP (docs/SPEC.md §11.1), or logs the code when SMTP is not configured (dev and tests only). */
export function createMailer(smtp: SmtpConfig | null): Mailer {
  if (!smtp) {
    return {
      async sendSignInCode(to, code) {
        console.log(`SMTP not configured: sign-in code for ${to} is ${code}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 is implicit TLS; any other port (587) upgrades with STARTTLS.
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  return {
    async sendSignInCode(to, code) {
      await transport.sendMail({
        from: { name: smtp.fromName, address: smtp.from },
        to,
        subject: `Your ScreenTime sign-in code: ${code}`,
        text: `Your ScreenTime sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.\n`,
      });
    },
  };
}
```

### 5.9 `server/src/auth/rate-limit.ts`

```ts
/**
 * Counts hits per key in a fixed time window, in memory. Good enough for one server process
 * (docs/SPEC.md §11.4); limits reset when the server restarts.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records one hit for `key`. Returns false when the key is over the limit in this window. */
  hit(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  private prune(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}
```

### 5.10 `server/src/auth/tokens.ts`

```ts
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sign, verify } from 'hono/jwt';
import type { Role } from '@screentime/schemas';

/** Access tokens live 15 minutes (docs/SPEC.md §11.1). */
export const ACCESS_TOKEN_TTL_SEC = 15 * 60;

/** Who is calling, read from a valid access token. */
export interface ParentAuth {
  sessionId: string;
  /** Null for a super admin who is not a parent. */
  parentId: string | null;
  familyId: string | null;
  roles: Role[];
}

/** A random 6-digit sign-in code, with leading zeros. */
export function newSignInCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Sign-in codes have only a million values, so they are keyed with the server secret, not just hashed. */
export function hashSignInCode(secret: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** An opaque refresh token: 32 random bytes, base64url. Only its hash is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Signs an HS256 access token. Claims: `sid` session, `sub` parent, `fam` family, `roles`. */
export async function signAccessToken(secret: string, auth: ParentAuth, nowSec = Math.floor(Date.now() / 1000)) {
  return sign(
    {
      sid: auth.sessionId,
      ...(auth.parentId ? { sub: auth.parentId } : {}),
      ...(auth.familyId ? { fam: auth.familyId } : {}),
      roles: auth.roles,
      iat: nowSec,
      exp: nowSec + ACCESS_TOKEN_TTL_SEC,
    },
    secret,
    'HS256',
  );
}

/** Returns the caller, or null if the token is malformed, forged or expired. */
export async function verifyAccessToken(secret: string, token: string): Promise<ParentAuth | null> {
  try {
    const claims = await verify(token, secret, 'HS256');
    if (typeof claims.sid !== 'string' || !Array.isArray(claims.roles)) return null;
    return {
      sessionId: claims.sid,
      parentId: typeof claims.sub === 'string' ? claims.sub : null,
      familyId: typeof claims.fam === 'string' ? claims.fam : null,
      roles: claims.roles as Role[],
    };
  } catch {
    return null;
  }
}
```

### 5.11 `server/src/auth/routes.ts`

The five routes. Read section 6 for the behaviour this implements.

```ts
import { createRoute } from '@hono/zod-openapi';
import { getConnInfo } from '@hono/node-server/conninfo';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { AuthResponse, ErrorResponse, Me, OtpRequest, OtpVerifyRequest, RefreshRequest, type Role } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { withFamily } from '../db/family.js';
import { families, otpCodes, parentSessions, parents } from '../db/schema.js';
import { ApiError } from '../errors.js';
import type { createRouter } from '../router.js';
import { RateLimiter } from './rate-limit.js';
import {
  ACCESS_TOKEN_TTL_SEC,
  hashRefreshToken,
  hashSignInCode,
  newRefreshToken,
  newSignInCode,
  type ParentAuth,
  sameHash,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

type Router = ReturnType<typeof createRouter>;

/** docs/SPEC.md §11.1: codes expire after 10 minutes, 5 attempts per code, 5 codes per email per hour. */
const CODE_TTL = sql`now() + interval '10 minutes'`;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
/** Refresh tokens slide: a session unused for 90 days is dead. */
const SESSION_IDLE_LIMIT = sql`now() - interval '90 days'`;

const errors = (...statuses: (401 | 422 | 429)[]) =>
  Object.fromEntries(
    statuses.map((status) => [
      status,
      { description: ERROR_TEXT[status], content: { 'application/json': { schema: ErrorResponse } } },
    ]),
  );

const ERROR_TEXT = {
  401: 'Not signed in, or the code or token is wrong or expired.',
  422: 'The request body is not valid.',
  429: 'Too many attempts. Try again later.',
} as const;

const json = <T>(schema: T) => ({ content: { 'application/json': { schema } }, required: true });

const otpRequestRoute = createRoute({
  method: 'post',
  path: '/v1/auth/otp/request',
  tags: ['auth'],
  summary: 'Email a sign-in code',
  description: 'Always answers 204, whether or not the email belongs to a parent.',
  request: { body: json(OtpRequest) },
  responses: { 204: { description: 'Code sent if the email can sign in.' }, ...errors(422, 429) },
});

const otpVerifyRoute = createRoute({
  method: 'post',
  path: '/v1/auth/otp/verify',
  tags: ['auth'],
  summary: 'Sign in with an emailed code',
  request: { body: json(OtpVerifyRequest) },
  responses: {
    200: { description: 'Signed in.', content: { 'application/json': { schema: AuthResponse } } },
    ...errors(401, 422, 429),
  },
});

const refreshRoute = createRoute({
  method: 'post',
  path: '/v1/auth/refresh',
  tags: ['auth'],
  summary: 'Swap a refresh token for a new token pair',
  description: 'The refresh token rotates: the old one stops working.',
  request: { body: json(RefreshRequest) },
  responses: {
    200: { description: 'New tokens.', content: { 'application/json': { schema: AuthResponse } } },
    ...errors(401, 422),
  },
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/v1/auth/logout',
  tags: ['auth'],
  summary: 'Sign out this session',
  security: [{ bearerAuth: [] }],
  responses: { 204: { description: 'Signed out.' }, ...errors(401) },
});

const meRoute = createRoute({
  method: 'get',
  path: '/v1/me',
  tags: ['parent'],
  summary: 'The signed-in parent, family and roles',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'The caller.', content: { 'application/json': { schema: Me } } },
    ...errors(401),
  },
});

interface SignInUser {
  parentId: string | null;
  familyId: string | null;
  roles: Role[];
  me: Me;
}

/** Selects an enabled parent in an enabled family. */
async function findParent(q: Pick<Db, 'select'>, where: ReturnType<typeof eq>) {
  const [row] = await q
    .select({ parent: parents, family: families })
    .from(parents)
    .innerJoin(families, eq(families.id, parents.familyId))
    .where(and(where, isNull(parents.disabledAt), isNull(families.disabledAt)));
  return row ?? null;
}

type ParentRow = NonNullable<Awaited<ReturnType<typeof findParent>>>;

function parentUser({ parent, family }: ParentRow, isSuperAdmin: boolean): SignInUser {
  const roles: Role[] = isSuperAdmin ? ['parent', 'superadmin'] : ['parent'];
  return {
    parentId: parent.id,
    familyId: family.id,
    roles,
    me: {
      parent: { id: parent.id, email: parent.email, displayName: parent.displayName, phoneE164: parent.phoneE164 },
      family: { id: family.id, name: family.name, timezone: family.timezone, emergencyNumber: family.emergencyNumber },
      roles,
    },
  };
}

/** A super admin who is not a parent in any family. */
function superAdminOnly(): SignInUser {
  const roles: Role[] = ['superadmin'];
  return { parentId: null, familyId: null, roles, me: { parent: null, family: null, roles } };
}

/** The caller's IP: Cloudflare's header in production, the socket address otherwise. */
function clientIp(c: Context): string {
  const forwarded = c.req.header('cf-connecting-ip');
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Reads the Bearer access token. Throws 401 if it is missing, forged or expired. */
export async function requireParent(c: Context, jwtSecret: string): Promise<ParentAuth> {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const auth = token ? await verifyAccessToken(jwtSecret, token) : null;
  if (!auth) throw new ApiError('unauthorized', 'Sign in first.');
  return auth;
}

/** Sign-in, tokens and GET /v1/me (docs/SPEC.md §9.1, §9.2, §11.1). */
export function registerAuthRoutes(app: Router, deps: AppDeps) {
  const { db, config, mailer } = deps;
  const otpRequestsPerIp = new RateLimiter(20, 60 * 60 * 1000);
  const otpVerifiesPerIp = new RateLimiter(30, 15 * 60 * 1000);
  const isSuperAdmin = (email: string) => config.superAdminEmail !== null && email === config.superAdminEmail;
  const tooMany = () => new ApiError('rate_limited', 'Too many sign-in attempts. Try again later.');
  const wrongCode = () => new ApiError('unauthorized', 'That code is wrong or has expired. Ask for a new one.');
  const signInAgain = () => new ApiError('unauthorized', 'Sign in again.');

  /** Who may sign in with this email: an enabled parent, the super admin, or nobody. */
  async function userForEmail(email: string): Promise<SignInUser | null> {
    const row = await findParent(db, eq(parents.email, email));
    if (row) return parentUser(row, isSuperAdmin(email));
    return isSuperAdmin(email) ? superAdminOnly() : null;
  }

  async function issueTokens(sessionId: string, refreshToken: string, user: SignInUser) {
    const auth: ParentAuth = { sessionId, parentId: user.parentId, familyId: user.familyId, roles: user.roles };
    return {
      accessToken: await signAccessToken(config.jwtSecret, auth),
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      me: user.me,
    };
  }

  app.openapi(otpRequestRoute, async (c) => {
    if (!otpRequestsPerIp.hit(clientIp(c))) throw tooMany();
    const email = c.req.valid('json').email.toLowerCase();

    // A code row is stored for every email, known or not, so the limit does not reveal which emails exist.
    const [recent] = await db
      .select({ n: count() })
      .from(otpCodes)
      .where(and(eq(otpCodes.email, email), gt(otpCodes.createdAt, sql`now() - interval '1 hour'`)));
    if ((recent?.n ?? 0) >= MAX_CODES_PER_HOUR) throw tooMany();

    const code = newSignInCode();
    await db.insert(otpCodes).values({ email, codeHash: hashSignInCode(config.jwtSecret, email, code), expiresAt: CODE_TTL });

    if (await userForEmail(email)) {
      // Not awaited: a slow or failing mail server must not change the answer or its timing.
      mailer.sendSignInCode(email, code).catch((err: unknown) => console.error('sending sign-in code failed', err));
    }
    return c.body(null, 204);
  });

  app.openapi(otpVerifyRoute, async (c) => {
    if (!otpVerifiesPerIp.hit(clientIp(c))) throw tooMany();
    const body = c.req.valid('json');
    const email = body.email.toLowerCase();

    // Only the newest unexpired code for the email counts.
    const [otp] = await db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, sql`now()`)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw wrongCode();
    if (!sameHash(otp.codeHash, hashSignInCode(config.jwtSecret, email, body.code))) {
      await db
        .update(otpCodes)
        .set({ attempts: sql`${otpCodes.attempts} + 1` })
        .where(eq(otpCodes.id, otp.id));
      throw wrongCode();
    }
    await db
      .update(otpCodes)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt)));

    const user = await userForEmail(email);
    if (!user) throw wrongCode();

    const refreshToken = newRefreshToken();
    const [session] = await db
      .insert(parentSessions)
      .values({
        parentId: user.parentId,
        familyId: user.familyId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        client: body.client,
        clientLabel: body.clientLabel,
      })
      .returning({ id: parentSessions.id });
    if (!session) throw new Error('session insert returned nothing');
    return c.json(await issueTokens(session.id, refreshToken, user), 200);
  });

  app.openapi(refreshRoute, async (c) => {
    const oldHash = hashRefreshToken(c.req.valid('json').refreshToken);
    const [session] = await db
      .select()
      .from(parentSessions)
      .where(
        and(
          eq(parentSessions.refreshTokenHash, oldHash),
          isNull(parentSessions.revokedAt),
          gt(parentSessions.lastUsedAt, SESSION_IDLE_LIMIT),
        ),
      );
    if (!session) throw signInAgain();

    let user: SignInUser | null = null;
    if (session.parentId) {
      const row = await findParent(db, eq(parents.id, session.parentId));
      if (row) user = parentUser(row, isSuperAdmin(row.parent.email));
    } else if (config.superAdminEmail) {
      // A super-admin-only session stays valid while SUPER_ADMIN_EMAIL is set.
      user = superAdminOnly();
    }
    if (!user) throw signInAgain();

    const refreshToken = newRefreshToken();
    // Matching the old hash makes rotation atomic: if two requests race with one token, only one wins.
    const rotated = await db
      .update(parentSessions)
      .set({ refreshTokenHash: hashRefreshToken(refreshToken), lastUsedAt: sql`now()` })
      .where(and(eq(parentSessions.id, session.id), eq(parentSessions.refreshTokenHash, oldHash)))
      .returning({ id: parentSessions.id });
    if (rotated.length === 0) throw signInAgain();
    return c.json(await issueTokens(session.id, refreshToken, user), 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const auth = await requireParent(c, config.jwtSecret);
    await db
      .update(parentSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(parentSessions.id, auth.sessionId), isNull(parentSessions.revokedAt)));
    return c.body(null, 204);
  });

  app.openapi(meRoute, async (c) => {
    const auth = await requireParent(c, config.jwtSecret);
    if (!auth.parentId || !auth.familyId) {
      if (!auth.roles.includes('superadmin') || !config.superAdminEmail) throw signInAgain();
      return c.json(superAdminOnly().me, 200);
    }
    const { parentId, familyId } = auth;
    const row = await withFamily(db, familyId, (tx) => findParent(tx, eq(parents.id, parentId)));
    if (!row) throw signInAgain();
    return c.json(parentUser(row, isSuperAdmin(row.parent.email)).me, 200);
  });
}
```

### 5.12 `server/src/app.ts`

Replace the whole file. `app` is no longer exported; `createApp(deps)` builds a new app each time. `openApiDocument()` stays, so `server/scripts/export-openapi.ts` does not change.

```ts
import { createRoute } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { ErrorResponse, HealthResponse } from '@screentime/schemas';
import { registerAuthRoutes } from './auth/routes.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { Mailer } from './mailer.js';
import { createRouter } from './router.js';

/** What the routes need at request time. Tests pass their own. */
export interface AppDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
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

/** Builds the whole API. Each call has its own rate-limit counters. */
export function createApp(deps: AppDeps) {
  const app = createRouter();

  if (process.env.NODE_ENV !== 'test') {
    app.use(logger());
  }

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
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

  return app;
}

/** The OpenAPI 3.1 document for every route (written to contract/openapi.json). */
export function openApiDocument(): ReturnType<ReturnType<typeof createApp>['getOpenAPI31Document']> {
  // Building the document never runs a handler, so the routes need no real database, settings or mailer.
  const app = createApp({} as AppDeps);
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Screen Time API', version: '0.1.0' },
  });
}
```

### 5.13 `server/src/index.ts`

```ts
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createMailer } from './mailer.js';

const config = loadConfig();
const { db } = createDb(config.databaseUrl);

await runMigrations(db);
console.log('database migrations applied');
if (!config.smtp) {
  console.log('SMTP is not configured: sign-in codes are written to this log instead of emailed');
}

const app = createApp({ db, config, mailer: createMailer(config.smtp) });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`screentime-server listening on http://localhost:${info.port}`);
});
```

### 5.14 `server/vitest.config.ts`

`server/test/db.test.ts` and the new `server/test/auth.test.ts` both wipe the test database, so they must not run at the same time.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files that use TEST_DATABASE_URL each wipe the same database, so files run one at a time.
    fileParallelism: false,
  },
});
```

### 5.15 `server/test/config.test.ts`

```ts
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
    });
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
});
```

### 5.16 `server/test/health.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@screentime/schemas';
import { type AppDeps, createApp } from '../src/app.js';

// GET /health and unknown paths touch no dependency, so empty ones are enough.
const app = createApp({} as AppDeps);

describe('GET /health', () => {
  it('returns 200 with a valid health body', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(HealthResponse.safeParse(body).success).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('screentime-server');
  });

  it('returns 404 for an unknown path', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
  });
});
```

### 5.17 `server/test/errors.test.ts`

`app` is no longer exported. Change exactly two lines, nothing else:

- Line 4, `import { app } from '../src/app.js';`, becomes:
  ```ts
  import { type AppDeps, createApp } from '../src/app.js';
  ```
- In the first test, `    const res = await app.request('/nope');` becomes:
  ```ts
      const res = await createApp({} as AppDeps).request('/nope');
  ```

### 5.18 `server/test/openapi.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/app.js';

describe('OpenAPI contract', () => {
  const doc = openApiDocument();

  it('describes GET /health and the shared schemas', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths?.['/health']?.get).toBeDefined();
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['ErrorCode', 'ErrorResponse', 'HealthResponse']),
    );
  });

  it('describes sign-in and GET /v1/me, with bearer auth where needed', () => {
    expect(doc.paths?.['/v1/auth/otp/request']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/otp/verify']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/refresh']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/logout']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/me']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components?.securitySchemes?.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['AuthResponse', 'Me', 'OtpRequest', 'OtpVerifyRequest', 'RefreshRequest', 'Role']),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.19 `server/test/tokens.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/auth/rate-limit.js';
import {
  hashRefreshToken,
  hashSignInCode,
  newRefreshToken,
  newSignInCode,
  sameHash,
  signAccessToken,
  verifyAccessToken,
} from '../src/auth/tokens.js';

const SECRET = 'test-secret-that-is-at-least-32-chars';
const auth = { sessionId: 's1', parentId: 'p1', familyId: 'f1', roles: ['parent' as const] };

describe('sign-in codes', () => {
  it('are 6 digits', () => {
    for (let i = 0; i < 200; i++) expect(newSignInCode()).toMatch(/^[0-9]{6}$/);
  });

  it('hash per email and secret', () => {
    const hash = hashSignInCode(SECRET, 'mum@example.com', '123456');
    expect(sameHash(hash, hashSignInCode(SECRET, 'mum@example.com', '123456'))).toBe(true);
    expect(sameHash(hash, hashSignInCode(SECRET, 'dad@example.com', '123456'))).toBe(false);
    expect(sameHash(hash, hashSignInCode(`${SECRET}!`, 'mum@example.com', '123456'))).toBe(false);
  });
});

describe('refresh tokens', () => {
  it('are random 43-character base64url strings, stored as a sha256 hex hash', () => {
    const token = newRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newRefreshToken()).not.toBe(token);
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('access tokens', () => {
  it('round-trip the caller', async () => {
    const token = await signAccessToken(SECRET, auth);
    expect(await verifyAccessToken(SECRET, token)).toEqual(auth);
  });

  it('round-trip a super admin with no parent or family', async () => {
    const admin = { sessionId: 's2', parentId: null, familyId: null, roles: ['superadmin' as const] };
    expect(await verifyAccessToken(SECRET, await signAccessToken(SECRET, admin))).toEqual(admin);
  });

  it('reject another secret, an expired token and garbage', async () => {
    expect(await verifyAccessToken(`${SECRET}!`, await signAccessToken(SECRET, auth))).toBeNull();
    const longAgo = Math.floor(Date.now() / 1000) - 3600;
    expect(await verifyAccessToken(SECRET, await signAccessToken(SECRET, auth, longAgo))).toBeNull();
    expect(await verifyAccessToken(SECRET, 'not-a-jwt')).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('allows max hits per window, then resets', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.hit('a', 0)).toBe(true);
    expect(limiter.hit('a', 10)).toBe(true);
    expect(limiter.hit('a', 20)).toBe(false);
    expect(limiter.hit('b', 20)).toBe(true);
    expect(limiter.hit('a', 1000)).toBe(true);
  });
});
```

### 5.20 `server/test/auth.test.ts`

Runs only when `TEST_DATABASE_URL` is set (always in CI), like `db.test.ts`. It uses a fake mailer that records the codes instead of sending them.

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthResponse, Me } from '@screentime/schemas';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/tokens.js';
import type { Config } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { families, otpCodes, parents } from '../src/db/schema.js';
import type { Mailer } from '../src/mailer.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
// CI sets TEST_DATABASE_URL; locally see deploy/README.md.
const url = process.env.TEST_DATABASE_URL;

const SECRET = 'test-secret-that-is-at-least-32-chars';

describe.skipIf(!url)('parent sign-in', () => {
  const { db, pool } = createDb(url ?? '');
  const sent: { to: string; code: string }[] = [];
  const mailer: Mailer = {
    async sendSignInCode(to, code) {
      sent.push({ to, code });
    },
  };
  const config = (superAdminEmail: string | null): Config => ({
    port: 0,
    databaseUrl: url ?? '',
    jwtSecret: SECRET,
    superAdminEmail,
    smtp: null,
  });
  let app = createApp({ db, config: config('boss@example.com'), mailer });

  /** Every call comes from a new IP unless one is given, so the per-IP limits do not leak between tests. */
  const post = (path: string, body: unknown, ip: string = randomUUID()) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify(body),
    });
  const getMe = (token: string) => app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });

  /** Requests a code and returns the one the fake mailer received. */
  async function requestCode(email: string): Promise<string> {
    sent.length = 0;
    const res = await post('/v1/auth/otp/request', { email });
    expect(res.status).toBe(204);
    const mail = sent.at(-1);
    if (!mail) throw new Error(`no code was sent to ${email}`);
    return mail.code;
  }

  async function signIn(email: string) {
    const code = await requestCode(email);
    const res = await post('/v1/auth/otp/verify', { email, code, client: 'android', clientLabel: 'Test phone' });
    expect(res.status).toBe(200);
    return AuthResponse.parse(await res.json());
  }

  let familyId = '';

  beforeAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations(db);
    const [family] = await db
      .insert(families)
      .values({ name: 'Test family', timezone: 'Australia/Sydney', parentCodeSecret: 'JBSWY3DPEHPK3PXP' })
      .returning();
    familyId = family?.id ?? '';
    await db.insert(parents).values([
      { familyId, email: 'mum@example.com', displayName: 'Mum' },
      { familyId, email: 'gone@example.com', displayName: 'Gone', disabledAt: new Date() },
    ]);
  });

  // A fresh app (new per-IP counters) and no codes from earlier tests (the per-email limit is 5 an hour).
  beforeEach(async () => {
    app = createApp({ db, config: config('boss@example.com'), mailer });
    await db.delete(otpCodes);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('emails a 6-digit code to a parent, whatever the case of the email', async () => {
    sent.length = 0;
    const res = await post('/v1/auth/otp/request', { email: 'Mum@Example.com' });
    expect(res.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('mum@example.com');
    expect(sent[0]?.code).toMatch(/^[0-9]{6}$/);
  });

  it('answers 204 but sends nothing for an unknown or disabled email', async () => {
    sent.length = 0;
    expect((await post('/v1/auth/otp/request', { email: 'stranger@example.com' })).status).toBe(204);
    expect((await post('/v1/auth/otp/request', { email: 'gone@example.com' })).status).toBe(204);
    expect(sent).toEqual([]);
  });

  it('rejects an invalid email with 422', async () => {
    const res = await post('/v1/auth/otp/request', { email: 'not an email' });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('validation_failed');
  });

  it('signs in with the right code and returns tokens and me', async () => {
    const auth = await signIn('mum@example.com');
    expect(auth.expiresIn).toBe(900);
    expect(auth.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth.me.roles).toEqual(['parent']);
    expect(auth.me.parent?.email).toBe('mum@example.com');
    expect(auth.me.parent?.displayName).toBe('Mum');
    expect(auth.me.family).toEqual({
      id: familyId,
      name: 'Test family',
      timezone: 'Australia/Sydney',
      emergencyNumber: '000',
    });

    const res = await getMe(auth.accessToken);
    expect(res.status).toBe(200);
    expect(Me.parse(await res.json())).toEqual(auth.me);
  });

  it('refuses a wrong code, a used code and an expired code', async () => {
    const code = await requestCode('mum@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    const verify = (c: string) =>
      post('/v1/auth/otp/verify', { email: 'mum@example.com', code: c, client: 'web', clientLabel: 'Browser' });

    const bad = await verify(wrong);
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toEqual({
      code: 'unauthorized',
      message: 'That code is wrong or has expired. Ask for a new one.',
    });
    expect((await verify(code)).status).toBe(200);
    expect((await verify(code)).status).toBe(401);

    const late = await requestCode('mum@example.com');
    await db.execute(sql`update otp_codes set expires_at = now() - interval '1 second' where email = 'mum@example.com'`);
    expect((await verify(late)).status).toBe(401);
  });

  it('burns a code after 5 wrong attempts', async () => {
    const code = await requestCode('mum@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await post('/v1/auth/otp/verify', { email: 'mum@example.com', code: wrong, client: 'web', clientLabel: 'B' });
      expect(res.status).toBe(401);
    }
    const res = await post('/v1/auth/otp/verify', { email: 'mum@example.com', code, client: 'web', clientLabel: 'B' });
    expect(res.status).toBe(401);
  });

  it('allows 5 codes per email per hour, known or not', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post('/v1/auth/otp/request', { email: 'limit@example.com' })).status).toBe(204);
    }
    const res = await post('/v1/auth/otp/request', { email: 'limit@example.com' });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(otpCodes).where(sql`email = 'limit@example.com'`);
    expect(row?.n).toBe(5);
  });

  it('allows 20 code requests per IP per hour', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await post('/v1/auth/otp/request', { email: `ip${i}@example.com` }, '203.0.113.7')).status).toBe(204);
    }
    expect((await post('/v1/auth/otp/request', { email: 'ip20@example.com' }, '203.0.113.7')).status).toBe(429);
    expect((await post('/v1/auth/otp/request', { email: 'ip20@example.com' }, '203.0.113.8')).status).toBe(204);
  });

  it('rotates the refresh token: the new one works once, the old one never again', async () => {
    const first = await signIn('mum@example.com');
    const res = await post('/v1/auth/refresh', { refreshToken: first.refreshToken });
    expect(res.status).toBe(200);
    const second = AuthResponse.parse(await res.json());
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.me).toEqual(first.me);
    expect((await getMe(second.accessToken)).status).toBe(200);

    expect((await post('/v1/auth/refresh', { refreshToken: first.refreshToken })).status).toBe(401);
    expect((await post('/v1/auth/refresh', { refreshToken: second.refreshToken })).status).toBe(200);
  });

  it('refuses a refresh token after 90 days without use', async () => {
    const auth = await signIn('mum@example.com');
    await db.execute(sql`update parent_sessions set last_used_at = now() - interval '91 days'`);
    expect((await post('/v1/auth/refresh', { refreshToken: auth.refreshToken })).status).toBe(401);
  });

  it('logs out: the refresh token stops working', async () => {
    const auth = await signIn('mum@example.com');
    const res = await app.request('/v1/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(res.status).toBe(204);
    expect((await post('/v1/auth/refresh', { refreshToken: auth.refreshToken })).status).toBe(401);
  });

  it('refuses GET /v1/me without a valid access token', async () => {
    expect((await app.request('/v1/me')).status).toBe(401);
    expect((await getMe('garbage')).status).toBe(401);
    const forged = await signAccessToken('another-secret-that-is-32-characters', {
      sessionId: randomUUID(),
      parentId: randomUUID(),
      familyId,
      roles: ['parent'],
    });
    expect((await getMe(forged)).status).toBe(401);
  });

  it('signs in the super admin who is not a parent', async () => {
    const auth = await signIn('boss@example.com');
    expect(auth.me).toEqual({ parent: null, family: null, roles: ['superadmin'] });
    expect(Me.parse(await (await getMe(auth.accessToken)).json())).toEqual(auth.me);
    expect((await post('/v1/auth/refresh', { refreshToken: auth.refreshToken })).status).toBe(200);
  });

  it('gives a parent the superadmin role when SUPER_ADMIN_EMAIL is theirs', async () => {
    app = createApp({ db, config: config('mum@example.com'), mailer });
    const auth = await signIn('mum@example.com');
    expect(auth.me.roles).toEqual(['parent', 'superadmin']);
    expect(auth.me.parent?.email).toBe('mum@example.com');
  });

  it('stops a disabled parent at the next refresh and GET /v1/me', async () => {
    await db.insert(parents).values({ familyId, email: 'leaving@example.com', displayName: 'Leaving' });
    const auth = await signIn('leaving@example.com');
    await db.execute(sql`update parents set disabled_at = now() where email = 'leaving@example.com'`);
    expect((await getMe(auth.accessToken)).status).toBe(401);
    expect((await post('/v1/auth/refresh', { refreshToken: auth.refreshToken })).status).toBe(401);
  });
});
```

### 5.21 `contract/openapi.json` (generated)

Do **not** write this by hand. After everything above is in place, run from the repo root:

```powershell
pnpm contract
```

It prints `wrote ...\contract\openapi.json`. The file must be exactly this:

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Screen Time API",
    "version": "0.1.0"
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      }
    },
    "schemas": {
      "HealthResponse": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "ok"
            ]
          },
          "service": {
            "type": "string",
            "minLength": 1
          },
          "time": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "status",
          "service",
          "time"
        ]
      },
      "ErrorResponse": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": {
              "code": {
                "$ref": "#/components/schemas/ErrorCode"
              },
              "message": {
                "type": "string"
              },
              "details": {
                "type": "object",
                "additionalProperties": {}
              }
            },
            "required": [
              "code",
              "message"
            ]
          }
        },
        "required": [
          "error"
        ]
      },
      "ErrorCode": {
        "type": "string",
        "enum": [
          "unauthorized",
          "forbidden",
          "not_found",
          "conflict",
          "validation_failed",
          "rate_limited",
          "internal"
        ]
      },
      "OtpRequest": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 254,
            "format": "email"
          }
        },
        "required": [
          "email"
        ]
      },
      "AuthResponse": {
        "type": "object",
        "properties": {
          "accessToken": {
            "type": "string"
          },
          "refreshToken": {
            "type": "string"
          },
          "expiresIn": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "me": {
            "$ref": "#/components/schemas/Me"
          }
        },
        "required": [
          "accessToken",
          "refreshToken",
          "expiresIn",
          "me"
        ]
      },
      "Me": {
        "type": "object",
        "properties": {
          "parent": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "email": {
                "type": "string",
                "format": "email"
              },
              "displayName": {
                "type": "string"
              },
              "phoneE164": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "id",
              "email",
              "displayName",
              "phoneE164"
            ]
          },
          "family": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              },
              "timezone": {
                "type": "string"
              },
              "emergencyNumber": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "name",
              "timezone",
              "emergencyNumber"
            ]
          },
          "roles": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Role"
            }
          }
        },
        "required": [
          "parent",
          "family",
          "roles"
        ]
      },
      "Role": {
        "type": "string",
        "enum": [
          "parent",
          "superadmin"
        ]
      },
      "OtpVerifyRequest": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 254,
            "format": "email"
          },
          "code": {
            "type": "string",
            "pattern": "^[0-9]{6}$"
          },
          "client": {
            "type": "string",
            "enum": [
              "web",
              "android"
            ]
          },
          "clientLabel": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "email",
          "code",
          "client",
          "clientLabel"
        ]
      },
      "RefreshRequest": {
        "type": "object",
        "properties": {
          "refreshToken": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "required": [
          "refreshToken"
        ]
      }
    },
    "parameters": {}
  },
  "paths": {
    "/health": {
      "get": {
        "tags": [
          "public"
        ],
        "summary": "Check that the server is up",
        "responses": {
          "200": {
            "description": "The server is up.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/HealthResponse"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected server error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/otp/request": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Email a sign-in code",
        "description": "Always answers 204, whether or not the email belongs to a parent.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OtpRequest"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Code sent if the email can sign in."
          },
          "422": {
            "description": "The request body is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "429": {
            "description": "Too many attempts. Try again later.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/otp/verify": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Sign in with an emailed code",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OtpVerifyRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Signed in.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/AuthResponse"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request body is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "429": {
            "description": "Too many attempts. Try again later.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/refresh": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Swap a refresh token for a new token pair",
        "description": "The refresh token rotates: the old one stops working.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/RefreshRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "New tokens.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/AuthResponse"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request body is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/logout": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Sign out this session",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "204": {
            "description": "Signed out."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/me": {
      "get": {
        "tags": [
          "parent"
        ],
        "summary": "The signed-in parent, family and roles",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The caller.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Me"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    }
  },
  "webhooks": {}
}
```

### 5.22 `deploy/docker-compose.yml`

Replace the whole file. New: the `JWT_SECRET`, `SUPER_ADMIN_EMAIL` and `SMTP_*` settings for `api`. `JWT_SECRET` is required (Compose stops with an error if it is missing); the others may be empty.

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
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in deploy/.env}
      SUPER_ADMIN_EMAIL: ${SUPER_ADMIN_EMAIL:-}
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
      SMTP_FROM: ${SMTP_FROM:-}
      SMTP_FROM_NAME: ${SMTP_FROM_NAME:-}
    ports:
      - "8080:8080"
    depends_on:
      db:
        condition: service_healthy

volumes:
  db-data:
```

### 5.23 `deploy/.env.example`

Replace the whole file. The example `JWT_SECRET` is deliberately too short, so the server refuses to start until someone sets a real one.

```text
# Copy to deploy/.env (git-ignored) and change the values. Never commit deploy/.env.
POSTGRES_PASSWORD=change-me

# Signs sign-in tokens. At least 32 random characters (the server refuses to start otherwise). Make one with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=change-me

# Signing in with this email gives the super admin role (docs/SPEC.md §6.2). Leave empty for none.
SUPER_ADMIN_EMAIL=

# Brevo SMTP relay (docs/SPEC.md §11.1). Leave SMTP_USER, SMTP_PASS or SMTP_FROM empty to log
# sign-in codes to the api container log instead of emailing them (development only).
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@gallagherhome.au
SMTP_FROM_NAME=ScreenTime App
```

### 5.24 `deploy/README.md`

Replace the whole file. Changes: the "First time" step mentions `JWT_SECRET` and the SMTP key, "Develop against the database" sets `JWT_SECRET`, and there is a new "Sign in during development" section.

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

### 5.25 `.github/workflows/typescript.yml`

The Compose smoke test now needs a `JWT_SECRET`. In the `docker` job, step **Start the stack**, add one line directly after the `POSTGRES_PASSWORD` line. Change nothing else. The step must then read:

```yaml
      - name: Start the stack
        run: |
          echo "POSTGRES_PASSWORD=ci-only-password" > deploy/.env
          echo "JWT_SECRET=ci-only-secret-that-is-at-least-32-characters" >> deploy/.env
          docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
```

## 6. Detailed spec

### 6.1 Settings (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | as before |
| `PORT` | no, default 8080 | as before |
| `JWT_SECRET` | yes, ≥ 32 characters | signs access tokens and keys the sign-in code hashes. Missing: `JWT_SECRET is not set`. Too short: `JWT_SECRET must be at least 32 characters`. |
| `SUPER_ADMIN_EMAIL` | no | lower-cased; this email gets the `superadmin` role |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | no | all three set: email codes by SMTP. Any one empty: log codes instead. |
| `SMTP_HOST` | no, default `smtp-relay.brevo.com` | |
| `SMTP_PORT` | no, default 587 | 587 = STARTTLS (TLS required), 465 = implicit TLS |
| `SMTP_FROM_NAME` | no, default `ScreenTime App` | |

Email subject: `Your ScreenTime sign-in code: 123456`. Without SMTP the server logs `SMTP not configured: sign-in code for <email> is <code>`, and at start-up `SMTP is not configured: sign-in codes are written to this log instead of emailed`.

### 6.2 `POST /v1/auth/otp/request` `{ email }`

1. Per-IP limit: 20 per hour → 429 `rate_limited` "Too many sign-in attempts. Try again later." The IP is the `CF-Connecting-IP` header (set by Cloudflare in production), else the socket address.
2. Email is lower-cased.
3. Per-email limit: 5 codes in the last hour → 429. Codes are stored for **every** email, known or not, so this limit says nothing about which emails exist.
4. Store a new code (expires in 10 minutes), hashed as HMAC-SHA256 of `email:code` keyed with `JWT_SECRET`.
5. Send the code only if the email belongs to an enabled parent in an enabled family, or is `SUPER_ADMIN_EMAIL`. Sending is not awaited, so neither a slow mail server nor the email's existence changes the answer or how long it takes. A failed send is logged.
6. Always 204 (unless 422 or 429).

### 6.3 `POST /v1/auth/otp/verify` `{ email, code, client, clientLabel }`

- Per-IP limit: 30 per 15 minutes → 429.
- Only the **newest** unexpired, unused code for the email counts. None, or it already has 5 wrong attempts → 401 `unauthorized` "That code is wrong or has expired. Ask for a new one."
- Wrong code: attempts + 1, then the same 401. After 5 wrong attempts even the right code fails.
- Right code: every unused code for that email is marked used. Then the user is found (enabled parent in an enabled family, or the super admin). None → the same 401.
- A `parent_sessions` row is created with the refresh token's sha256 hash, `client` (`web` or `android`) and `clientLabel` (1 to 100 characters, for example "Pixel 10").
- 200 `{ accessToken, refreshToken, expiresIn: 900, me }`.

### 6.4 Tokens

- Access token: JWT HS256, 15 minutes. Claims: `sid` session id, `sub` parent id (absent for a super-admin-only user), `fam` family id (absent likewise), `roles`, `iat`, `exp`.
- Refresh token: 32 random bytes as base64url (43 characters). Only its sha256 hex hash is stored.
- Roles: `['parent']`; `['parent', 'superadmin']` when the parent's email is `SUPER_ADMIN_EMAIL`; `['superadmin']` for a super admin who is not a parent.

### 6.5 `POST /v1/auth/refresh` `{ refreshToken }`

- Find the session by the token's hash, not revoked, `last_used_at` within the last 90 days. None → 401 "Sign in again."
- A parent session: the parent and their family must still be enabled. A super-admin-only session: `SUPER_ADMIN_EMAIL` must still be set. Otherwise 401.
- Rotate: store the new token's hash and `last_used_at = now()`, only if the hash is still the old one (two requests racing with one token: only one wins, the other gets 401). The old token never works again.
- 200 with the same shape as verify.

### 6.6 `POST /v1/auth/logout` (Bearer access token)

Marks the session revoked. 204. The refresh token stops working at once; the access token simply runs out within 15 minutes. No or bad token → 401 "Sign in first."

### 6.7 `GET /v1/me` (Bearer access token)

- Parent: read the parent and family **inside `withFamily(db, familyId, ...)`**. Parent or family disabled since sign-in → 401 "Sign in again."
- Super-admin-only token: `{ parent: null, family: null, roles: ['superadmin'] }`, if `SUPER_ADMIN_EMAIL` is still set.
- No, forged or expired token → 401 "Sign in first."

### 6.8 OpenAPI

The contract gains five paths, the schemas `AuthResponse`, `Me`, `OtpRequest`, `OtpVerifyRequest`, `RefreshRequest` and `Role`, and a security scheme `bearerAuth` (HTTP bearer, JWT) used by `/v1/auth/logout` and `/v1/me`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-011-parent-sign-in
   pnpm install --frozen-lockfile
   ```
3. Add `nodemailer` (5.1). Commit `server/package.json` and `pnpm-lock.yaml`: `CARD-011: add nodemailer`.
4. Create 5.2 to 5.4. Run `pnpm --filter @screentime/schemas test` (`Tests  7 passed (7)`). Commit: `CARD-011: add sign-in schemas`.
5. Change `schema.ts` (5.5) and generate the migration (5.6); compare the SQL. Commit the schema and the three drizzle files: `CARD-011: allow super admin sessions without a family`.
6. Create or replace 5.7 to 5.14. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-011: add sign-in routes and GET /v1/me`.
7. Create or replace the tests 5.15 to 5.20. Commit: `CARD-011: add sign-in tests`.
8. Run `pnpm contract` (5.21) and compare. Commit: `CARD-011: regenerate the API contract`.
9. Replace 5.22 to 5.24 and change 5.25. Commit: `CARD-011: add sign-in settings to Compose and CI`.
10. Run the acceptance checks in section 8.
11. Push and open the PR (section 10).
12. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret or SMTP key in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  7 passed (7)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/config.test.ts (7 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (3 tests)`, `test/health.test.ts (2 tests)`, so `Tests  26 passed | 27 skipped (53)`.
- [ ] `server/drizzle/0003_super_admin_sessions.sql` matches 5.6 and `contract/openapi.json` matches 5.21 exactly. Running `pnpm contract` again leaves `git status --short contract` empty.
- [ ] The database tests pass against PostgreSQL 18. Use a local `deploy/.env` with throwaway values (this replaces any `deploy/.env` you have; it is git-ignored):
  ```powershell
  Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
  $env:TEST_DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime_test"
  pnpm --filter @screentime/server test
  Remove-Item Env:TEST_DATABASE_URL
  ```
  Output: `test/auth.test.ts (15 tests)`, `test/db.test.ts (12 tests)` and `Tests  53 passed (53)`.
- [ ] Sign-in works on the real stack (the `db` container from the previous check is still running):
  ```powershell
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
  Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/request -ContentType 'application/json' -Body '{"email":"admin@example.com"}'
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "sign-in code"
  ```
  The log shows `SMTP is not configured: sign-in codes are written to this log instead of emailed` and `SMTP not configured: sign-in code for admin@example.com is <6 digits>`. Put those 6 digits in place of `123456`:
  ```powershell
  $r = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"admin@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $r.me | ConvertTo-Json -Compress
  (Invoke-RestMethod http://localhost:8080/v1/me -Headers @{ Authorization = "Bearer $($r.accessToken)" }) | ConvertTo-Json -Compress
  ```
  Both lines print `{"parent":null,"family":null,"roles":["superadmin"]}`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 28 files (in any order):
  ```
  .github/workflows/typescript.yml
  contract/openapi.json
  deploy/.env.example
  deploy/README.md
  deploy/docker-compose.yml
  packages/schemas/src/auth.ts
  packages/schemas/src/index.ts
  packages/schemas/test/auth.test.ts
  pnpm-lock.yaml
  server/drizzle/0003_super_admin_sessions.sql
  server/drizzle/meta/0003_snapshot.json
  server/drizzle/meta/_journal.json
  server/package.json
  server/src/app.ts
  server/src/auth/rate-limit.ts
  server/src/auth/routes.ts
  server/src/auth/tokens.ts
  server/src/config.ts
  server/src/db/schema.ts
  server/src/index.ts
  server/src/mailer.ts
  server/test/auth.test.ts
  server/test/config.test.ts
  server/test/errors.test.ts
  server/test/health.test.ts
  server/test/openapi.test.ts
  server/test/tokens.test.ts
  server/vitest.config.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/auth.test.ts` | Emails are validated; the code must be exactly 6 digits; `client` is `web` or `android`; `clientLabel` is not empty. |
| `server/test/config.test.ts` | Defaults; `PORT`; missing `DATABASE_URL`; missing or short `JWT_SECRET`; `SUPER_ADMIN_EMAIL` lower-cased; empty values count as unset; SMTP only with user, password and sender. |
| `server/test/tokens.test.ts` | Codes are 6 digits; code hashes depend on email and secret; refresh tokens are 43 characters with a 64-hex hash; access tokens round-trip (parent and super admin) and fail with another secret, when expired, or when garbage; the rate limiter counts per key and resets after the window. |
| `server/test/health.test.ts`, `errors.test.ts` | as before, using `createApp`. |
| `server/test/openapi.test.ts` | The contract has the new paths, the `bearerAuth` scheme on logout and me, and the new schemas; the committed file is up to date. |
| `server/test/auth.test.ts` | Against a real database, with a fake mailer: a code is mailed to a parent (email case ignored); unknown and disabled emails get 204 and no mail; bad email 422; sign-in returns tokens and `me`, and the access token works on `GET /v1/me`; wrong, reused and expired codes fail; 5 wrong attempts burn a code; 5 codes per email per hour, then 429 (rows stored even for unknown emails); 20 requests per IP per hour, then 429; refresh rotates (the old token fails, the new one works); a session idle 91 days fails; logout kills the refresh token; `GET /v1/me` refuses no, garbage and forged tokens; the super admin who is not a parent signs in and refreshes; a parent whose email is `SUPER_ADMIN_EMAIL` gets both roles; a parent disabled after sign-in is refused by `GET /v1/me` and refresh. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 9). Message format: `CARD-011: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-011-parent-sign-in`
5. Open a PR into `main` titled `CARD-011: Parent sign-in`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-011-parent-sign-in --title "CARD-011: Parent sign-in" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-011-parent-sign-in.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] 0003 migration and openapi.json match the card; pnpm contract is stable
   - [x] database tests — output: `Tests  53 passed (53)`
   - [x] sign-in on the real stack — output: `{"parent":null,"family":null,"roles":["superadmin"]}`
   - [x] deploy/.env not tracked
   - [x] only expected files changed — output: 28 files

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

- **`JWT_SECRET is not set`** or **`must be at least 32 characters`** when the server starts: set it in `deploy/.env` (Compose) or `$env:JWT_SECRET` (dev server). Do not lower the limit.
- **Compose says `set JWT_SECRET in deploy/.env`**: same fix.
- **`openapi.test.ts` fails with a diff**: run `pnpm contract`. If the new file still differs from 5.21, one of 5.2, 5.3, 5.11 or 5.12 does not match the card. Do not edit `openapi.json` by hand.
- **drizzle-kit asks a question**: you are not starting from a clean `main`, or `schema.ts` differs from 5.5. Press Ctrl+C and fix it.
- **`auth.test.ts` fails with 429** in a test that did not expect it: `beforeEach` in 5.20 must delete `otp_codes` and build a new app. Do not raise the limits.
- **`ERR_PNPM_IGNORED_BUILDS`** or a prompt about build scripts: stop and report it; do not change `pnpm-workspace.yaml`.
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-011. Please review and merge if it is good.

CARD: CARD-011 Parent sign-in
PR: <full PR URL>
Branch: bob/card-011-parent-sign-in
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
