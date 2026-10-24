# CARD-012: Family settings and super admin

| Field | Value |
|---|---|
| Card | CARD-012 |
| Title | Family settings and super admin |
| Size | M |
| Depends on | CARD-011 (merged to `main`) |
| Spec sections | docs/SPEC.md §6.1, §6.2, §9.2 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-012-family-and-admin` |
| PR title | `CARD-012: Family settings and super admin` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`, where `deps` holds the database, the settings and the mailer. Request and response shapes are Zod schemas in `packages/schemas` (package `@screentime/schemas`), and `pnpm contract` writes the generated OpenAPI document to `contract/openapi.json`, which is committed; `server/test/openapi.test.ts` fails if it is out of date. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`.

CARD-011 added sign-in: a parent gets a short-lived access token (a JWT with `sub` = parent id, `fam` = family id, `roles`) and sends it as `Authorization: Bearer <token>`. The super admin (the one email in the `SUPER_ADMIN_EMAIL` setting) gets the `superadmin` role, and may have no parent or family at all.

Family data is protected by row-level security: a request for one family runs its queries through `withFamily(db, familyId, fn)` from `server/src/db/family.ts`, which only sees that family's rows. The plain `db` connection owns the tables and sees everything; only sign-in and the super admin routes use it directly.

This card adds the first real management routes:

1. **Family settings** for a signed-in parent: read and change the family (name, time zone, emergency number); list, add, edit and remove parents; read and replace the message presets kids can send with one tap; read and rotate the parent-code secret (used later for offline parent-mode codes).
2. **Super admin routes** `/v1/admin/*`: list every family, create a family with its first parent, add a parent to any family, disable a family.
3. Shared helpers that later cards reuse: `server/src/openapi.ts` (OpenAPI response helpers), `server/src/auth/guards.ts` (who is calling), `server/src/db/errors.ts`, and `server/test/helpers.ts` (test app, tokens, HTTP client).
4. A small migration: when a message preset is deleted, old kid messages keep their text and their `preset_id` becomes null, instead of the delete failing.

Kids, schedules and the always-callable contact list come in the next card (CARD-012b).

## 2. Goal

A parent can manage their family's settings, parents and message presets through the API, and the super admin can create, list and disable families, all tested against PostgreSQL 18 in CI, with the OpenAPI contract describing the 14 new operations.

## 3. Out of scope

Do **not** do any of these in this card:

- No kids, schedules or contacts routes (CARD-012b). No devices or enrolment (CARD-013). No `/v1/me/push-token` or `/v1/me/notification-prefs` (CARD-016).
- No email is sent when a parent is added. They just sign in with their email.
- No web or Android UI.
- No new npm packages. `pnpm-lock.yaml` and every `package.json` stay unchanged.
- Do not change `server/src/router.ts`, `server/src/errors.ts`, `server/src/config.ts`, `server/src/mailer.ts`, `server/src/index.ts`, `server/src/auth/tokens.ts`, `server/src/auth/rate-limit.ts`, `server/src/db/client.ts`, `server/src/db/family.ts`, `server/src/db/migrate.ts`, `server/test/auth.test.ts`, `server/test/db.test.ts`, the other existing tests, `packages/engine`, `deploy/`, `.github/`, `android/`, `windows/` or `web/`.
- Do not edit `server/drizzle/0000` to `0003` or their snapshots. Do not edit generated files in `server/drizzle/meta/` by hand.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key or any other password.

## 4. Tech and versions

Nothing new. Everything is unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, Zod ^4.6, hono ^4.13.13, @hono/zod-openapi ^1.6.3, drizzle-orm ^0.45.4, drizzle-kit ^0.31.11, PostgreSQL 18.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some test names contain an apostrophe and so use double quotes (`it("returns only the caller's family", ...)`): keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/family.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/family.test.ts` | create (5.3) |
| `server/src/db/schema.ts` | change one line (5.4) |
| `server/drizzle/0004_preset_delete_set_null.sql` | **generated** (5.5) |
| `server/drizzle/meta/0004_snapshot.json` | **generated** (5.5) |
| `server/drizzle/meta/_journal.json` | **updated** by drizzle-kit (5.5) |
| `server/src/openapi.ts` | create (5.6) |
| `server/src/db/errors.ts` | create (5.7) |
| `server/src/auth/guards.ts` | create (5.8) |
| `server/src/auth/routes.ts` | replace (5.9) |
| `server/src/family/secret.ts` | create (5.10) |
| `server/src/family/routes.ts` | create (5.11) |
| `server/src/admin/routes.ts` | create (5.12) |
| `server/src/app.ts` | replace (5.13) |
| `server/scripts/seed-dev.ts` | replace (5.14) |
| `server/test/helpers.ts` | create (5.15) |
| `server/test/family.test.ts` | create (5.16) |
| `server/test/admin.test.ts` | create (5.17) |
| `server/test/openapi.test.ts` | replace (5.18) |
| `contract/openapi.json` | **generated** by `pnpm contract` (5.19) |

That is 21 files.

### 5.1 `packages/schemas/src/family.ts`

The shapes for the family and admin routes. `TimeZone` accepts only names that Node's `Intl` knows (for example `Australia/Sydney`). `ParentCodeSecret` is 32 base32 characters.

```ts
import { z } from 'zod';

/** True for an IANA time zone this runtime knows, for example `Australia/Sydney`. */
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZone = z.string().min(1).max(64).refine(isTimeZone, 'Unknown time zone.');

/** International phone number, for example `+61412345678`. */
export const PhoneE164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'Use international format, for example +61412345678.');

/** Short number the kid's phone may always call, for example `000`. */
export const EmergencyNumber = z.string().regex(/^[0-9]{2,6}$/);

export const Family = z
  .object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
    emergencyNumber: z.string(),
  })
  .meta({ id: 'Family' });

export type Family = z.infer<typeof Family>;

/** Body of PATCH /v1/family. Send only the fields to change. */
export const FamilyPatch = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: TimeZone.optional(),
    emergencyNumber: EmergencyNumber.optional(),
  })
  .meta({ id: 'FamilyPatch' });

export type FamilyPatch = z.infer<typeof FamilyPatch>;

export const Parent = z
  .object({
    id: z.uuid(),
    email: z.email(),
    displayName: z.string(),
    phoneE164: z.string().nullable(),
  })
  .meta({ id: 'Parent' });

export type Parent = z.infer<typeof Parent>;

/** Body of POST /v1/family/parents and POST /v1/admin/families/{id}/parents. */
export const ParentCreate = z
  .object({
    email: z.email().max(254),
    /** What kids see, for example "Mum" or "Dad". */
    displayName: z.string().trim().min(1).max(40),
    phoneE164: PhoneE164.nullable().optional(),
  })
  .meta({ id: 'ParentCreate' });

export type ParentCreate = z.infer<typeof ParentCreate>;

/** Body of PATCH /v1/family/parents/{id}. The email cannot change. */
export const ParentPatch = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    phoneE164: PhoneE164.nullable().optional(),
  })
  .meta({ id: 'ParentPatch' });

export type ParentPatch = z.infer<typeof ParentPatch>;

export const MessagePreset = z
  .object({
    id: z.uuid(),
    text: z.string(),
  })
  .meta({ id: 'MessagePreset' });

export type MessagePreset = z.infer<typeof MessagePreset>;

/** Body of PUT /v1/family/message-presets: the whole list, in display order. */
export const MessagePresetsPut = z
  .object({
    presets: z
      .array(z.object({ text: z.string().trim().min(1).max(160) }))
      .max(10),
  })
  .meta({ id: 'MessagePresetsPut' });

export type MessagePresetsPut = z.infer<typeof MessagePresetsPut>;

/** Response of GET /v1/family/parent-code: the base32 secret for offline parent-mode codes (SPEC §12.3). */
export const ParentCodeSecret = z
  .object({
    secret: z.string().regex(/^[A-Z2-7]{32}$/),
  })
  .meta({ id: 'ParentCodeSecret' });

export type ParentCodeSecret = z.infer<typeof ParentCodeSecret>;

/** A family as the super admin sees it (GET /v1/admin/families). */
export const AdminFamily = z
  .object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
    createdAt: z.iso.datetime(),
    disabledAt: z.iso.datetime().nullable(),
    parentCount: z.number().int().nonnegative(),
  })
  .meta({ id: 'AdminFamily' });

export type AdminFamily = z.infer<typeof AdminFamily>;

/** Body of POST /v1/admin/families. */
export const AdminFamilyCreate = z
  .object({
    name: z.string().trim().min(1).max(100),
    timezone: TimeZone,
    emergencyNumber: EmergencyNumber.optional(),
    firstParent: ParentCreate,
  })
  .meta({ id: 'AdminFamilyCreate' });

export type AdminFamilyCreate = z.infer<typeof AdminFamilyCreate>;

/** Response of POST /v1/admin/families. */
export const AdminFamilyCreated = z
  .object({
    family: Family,
    parent: Parent,
  })
  .meta({ id: 'AdminFamilyCreated' });

export type AdminFamilyCreated = z.infer<typeof AdminFamilyCreated>;
```

### 5.2 `packages/schemas/src/index.ts`

Replace the whole file.

```ts
export { AuthResponse, Me, OtpRequest, OtpVerifyRequest, RefreshRequest, Role } from './auth.js';
export { ErrorCode, ErrorResponse } from './errors.js';
export {
  AdminFamily,
  AdminFamilyCreate,
  AdminFamilyCreated,
  EmergencyNumber,
  Family,
  FamilyPatch,
  MessagePreset,
  MessagePresetsPut,
  Parent,
  ParentCodeSecret,
  ParentCreate,
  ParentPatch,
  PhoneE164,
  TimeZone,
} from './family.js';
export { HealthResponse } from './health.js';
```

### 5.3 `packages/schemas/test/family.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { FamilyPatch, MessagePresetsPut, ParentCreate } from '../src/index.js';

describe('family schemas', () => {
  it('accepts IANA time zones only', () => {
    expect(FamilyPatch.safeParse({ timezone: 'Australia/Sydney' }).success).toBe(true);
    expect(FamilyPatch.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('accepts short emergency numbers only', () => {
    expect(FamilyPatch.safeParse({ emergencyNumber: '000' }).success).toBe(true);
    expect(FamilyPatch.safeParse({ emergencyNumber: '0' }).success).toBe(false);
    expect(FamilyPatch.safeParse({ emergencyNumber: '+61000' }).success).toBe(false);
  });

  it('needs international phone numbers and a trimmed display name', () => {
    const ok = { email: 'dad@example.com', displayName: ' Dad ', phoneE164: '+61412345678' };
    expect(ParentCreate.parse(ok).displayName).toBe('Dad');
    expect(ParentCreate.safeParse({ ...ok, phoneE164: '0412 345 678' }).success).toBe(false);
    expect(ParentCreate.safeParse({ ...ok, displayName: '   ' }).success).toBe(false);
  });

  it('allows up to 10 presets of 1 to 160 characters', () => {
    const preset = { text: 'Can I have more time?' };
    expect(MessagePresetsPut.safeParse({ presets: Array(10).fill(preset) }).success).toBe(true);
    expect(MessagePresetsPut.safeParse({ presets: Array(11).fill(preset) }).success).toBe(false);
    expect(MessagePresetsPut.safeParse({ presets: [{ text: 'x'.repeat(161) }] }).success).toBe(false);
    expect(MessagePresetsPut.safeParse({ presets: [{ text: ' ' }] }).success).toBe(false);
  });
});
```

### 5.4 `server/src/db/schema.ts`

Only one line changes, in the `kidMessages` table. Find this line:

```ts
    presetId: uuid('preset_id').references(() => messagePresets.id),
```

and replace it with exactly these two lines. Change nothing else in the file.

```ts
    // Parents replace the preset list whenever they like; old messages keep their text and lose the link.
    presetId: uuid('preset_id').references(() => messagePresets.id, { onDelete: 'set null' }),
```

### 5.5 `server/drizzle/0004_preset_delete_set_null.sql` (generated)

Do **not** write this by hand. After 5.4, run from the repo root:

```powershell
pnpm --filter @screentime/server db:generate --name preset_delete_set_null
```

It prints `Your SQL migration file ➜ drizzle/0004_preset_delete_set_null.sql` (or with a backslash) and creates `server/drizzle/0004_preset_delete_set_null.sql` and `server/drizzle/meta/0004_snapshot.json`, and adds a fifth entry (`"tag": "0004_preset_delete_set_null"`) to `server/drizzle/meta/_journal.json`. If the number is not `0004`, you did not start from the latest `main`: delete the generated files and start again from step 2. The SQL file must contain exactly this:

```sql
ALTER TABLE "kid_messages" DROP CONSTRAINT "kid_messages_preset_id_message_presets_id_fk";
--> statement-breakpoint
ALTER TABLE "kid_messages" ADD CONSTRAINT "kid_messages_preset_id_message_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."message_presets"("id") ON DELETE set null ON UPDATE no action;
```

Running `pnpm --filter @screentime/server db:generate` again must print `No schema changes, nothing to migrate`.

### 5.6 `server/src/openapi.ts`

Helpers for route definitions, so every route describes its errors the same way. Later cards use them too.

```ts
import { ErrorResponse } from '@screentime/schemas';

const ERROR_TEXT = {
  401: 'Not signed in, or the code or token is wrong or expired.',
  403: 'Signed in, but not allowed to do this.',
  404: 'Not found.',
  409: 'Conflicts with existing data.',
  422: 'The request is not valid.',
  429: 'Too many attempts. Try again later.',
} as const;

type ErrorStatus = keyof typeof ERROR_TEXT;

/** OpenAPI `responses` entries for error statuses, all with the standard error body (docs/SPEC.md §9). */
export function errorResponses(...statuses: ErrorStatus[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      { description: ERROR_TEXT[status], content: { 'application/json': { schema: ErrorResponse } } },
    ]),
  );
}

/** A required JSON request body. */
export function jsonBody<T>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

/** A JSON response. */
export function jsonResponse<T>(description: string, schema: T) {
  return { description, content: { 'application/json': { schema } } };
}

/** Routes that need an access token. */
export const bearer = [{ bearerAuth: [] }];
```

### 5.7 `server/src/db/errors.ts`

```ts
/** True when PostgreSQL refused a row because of a unique constraint (code 23505). Drizzle wraps the error. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined);
  return code(err) === '23505' || (typeof err === 'object' && err !== null && 'cause' in err && code(err.cause) === '23505');
}
```

### 5.8 `server/src/auth/guards.ts`

Who is calling. `requireParent` moves here from `server/src/auth/routes.ts` (it is unchanged). `requireFamilyParent` is what every family route uses: it also checks in the database that the parent and the family are still enabled, so a removed parent is locked out at once instead of when the access token expires. `requireSuperAdmin` is for `/v1/admin/*`.

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Db } from '../db/client.js';
import { withFamily } from '../db/family.js';
import { families, parents } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { type ParentAuth, verifyAccessToken } from './tokens.js';

/** Reads the Bearer access token. Throws 401 if it is missing, forged or expired. */
export async function requireParent(c: Context, jwtSecret: string): Promise<ParentAuth> {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const auth = token ? await verifyAccessToken(jwtSecret, token) : null;
  if (!auth) throw new ApiError('unauthorized', 'Sign in first.');
  return auth;
}

/**
 * A parent in a family, still enabled, in a family that is still enabled. Throws 401 without a valid
 * token or once the parent or family is disabled (no waiting for the token to expire), and 403 for a
 * super admin who is not a parent.
 */
export async function requireFamilyParent(c: Context, db: Db, jwtSecret: string) {
  const auth = await requireParent(c, jwtSecret);
  const { parentId, familyId } = auth;
  if (!parentId || !familyId) throw new ApiError('forbidden', 'This needs a parent account.');
  const [active] = await withFamily(db, familyId, (tx) =>
    tx
      .select({ id: parents.id })
      .from(parents)
      .innerJoin(families, eq(families.id, parents.familyId))
      .where(and(eq(parents.id, parentId), isNull(parents.disabledAt), isNull(families.disabledAt))),
  );
  if (!active) throw new ApiError('unauthorized', 'Sign in again.');
  return { ...auth, parentId, familyId };
}

/** The super admin. Throws 401 without a valid token, 403 for anyone else. */
export async function requireSuperAdmin(c: Context, jwtSecret: string, superAdminEmail: string | null) {
  const auth = await requireParent(c, jwtSecret);
  // The role is in the token; the setting is checked too, so removing SUPER_ADMIN_EMAIL takes effect at once.
  if (!auth.roles.includes('superadmin') || !superAdminEmail) {
    throw new ApiError('forbidden', 'This needs the super admin.');
  }
  return auth;
}
```

### 5.9 `server/src/auth/routes.ts`

Replace the whole file. The only changes from `main`: the local helpers `errors`, `ERROR_TEXT` and `json` are replaced by the shared ones from 5.6, and `requireParent` is imported from 5.8 instead of being defined here. The behaviour is the same. (The 422 description in the contract becomes "The request is not valid.", which matches the real 422 message.)

```ts
import { createRoute } from '@hono/zod-openapi';
import { getConnInfo } from '@hono/node-server/conninfo';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { AuthResponse, Me, OtpRequest, OtpVerifyRequest, RefreshRequest, type Role } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { withFamily } from '../db/family.js';
import { families, otpCodes, parentSessions, parents } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { bearer, errorResponses, jsonBody } from '../openapi.js';
import type { createRouter } from '../router.js';
import { requireParent } from './guards.js';
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
} from './tokens.js';

type Router = ReturnType<typeof createRouter>;

/** docs/SPEC.md §11.1: codes expire after 10 minutes, 5 attempts per code, 5 codes per email per hour. */
const CODE_TTL = sql`now() + interval '10 minutes'`;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
/** Refresh tokens slide: a session unused for 90 days is dead. */
const SESSION_IDLE_LIMIT = sql`now() - interval '90 days'`;

const otpRequestRoute = createRoute({
  method: 'post',
  path: '/v1/auth/otp/request',
  tags: ['auth'],
  summary: 'Email a sign-in code',
  description: 'Always answers 204, whether or not the email belongs to a parent.',
  request: { body: jsonBody(OtpRequest) },
  responses: { 204: { description: 'Code sent if the email can sign in.' }, ...errorResponses(422, 429) },
});

const otpVerifyRoute = createRoute({
  method: 'post',
  path: '/v1/auth/otp/verify',
  tags: ['auth'],
  summary: 'Sign in with an emailed code',
  request: { body: jsonBody(OtpVerifyRequest) },
  responses: {
    200: { description: 'Signed in.', content: { 'application/json': { schema: AuthResponse } } },
    ...errorResponses(401, 422, 429),
  },
});

const refreshRoute = createRoute({
  method: 'post',
  path: '/v1/auth/refresh',
  tags: ['auth'],
  summary: 'Swap a refresh token for a new token pair',
  description: 'The refresh token rotates: the old one stops working.',
  request: { body: jsonBody(RefreshRequest) },
  responses: {
    200: { description: 'New tokens.', content: { 'application/json': { schema: AuthResponse } } },
    ...errorResponses(401, 422),
  },
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/v1/auth/logout',
  tags: ['auth'],
  summary: 'Sign out this session',
  security: bearer,
  responses: { 204: { description: 'Signed out.' }, ...errorResponses(401) },
});

const meRoute = createRoute({
  method: 'get',
  path: '/v1/me',
  tags: ['parent'],
  summary: 'The signed-in parent, family and roles',
  security: bearer,
  responses: {
    200: { description: 'The caller.', content: { 'application/json': { schema: Me } } },
    ...errorResponses(401),
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

### 5.10 `server/src/family/secret.ts`

The parent-code secret generator and the five default message presets (SPEC §6.1). The seed script (5.14) and the super admin's "create family" (5.12) both use them.

```ts
import { randomBytes } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, as authenticator apps expect. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** A new parent-code secret: 20 random bytes as 32 base32 characters (docs/SPEC.md §6.1 families). */
export function newParentCodeSecret(): string {
  return base32(randomBytes(20));
}

/** The message presets every new family starts with (docs/SPEC.md §6.1 message_presets). */
export const DEFAULT_MESSAGE_PRESETS = [
  'Can I have more time?',
  "I'm done, you can lock it",
  'Can you call me?',
  "I'm on my way home",
  'I need help with homework',
];
```

### 5.11 `server/src/family/routes.ts`

The ten family operations. Every database statement runs inside `withFamily`.

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  Family,
  FamilyPatch,
  MessagePreset,
  MessagePresetsPut,
  Parent,
  ParentCodeSecret,
  ParentCreate,
  ParentPatch,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { isUniqueViolation } from '../db/errors.js';
import { withFamily } from '../db/family.js';
import { families, messagePresets, parentSessions, parents } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { bearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { newParentCodeSecret } from './secret.js';

type Router = ReturnType<typeof createRouter>;

const IdParam = z.object({ id: z.uuid() });

export function toFamily(row: typeof families.$inferSelect): Family {
  return { id: row.id, name: row.name, timezone: row.timezone, emergencyNumber: row.emergencyNumber };
}

export function toParent(row: typeof parents.$inferSelect): Parent {
  return { id: row.id, email: row.email, displayName: row.displayName, phoneE164: row.phoneE164 };
}

export const emailTaken = () => new ApiError('conflict', 'That email already belongs to a parent.');
const parentNotFound = () => new ApiError('not_found', 'No such parent in your family.');

const getFamilyRoute = createRoute({
  method: 'get',
  path: '/v1/family',
  tags: ['family'],
  summary: 'The family of the signed-in parent',
  security: bearer,
  responses: { 200: jsonResponse('The family.', Family), ...errorResponses(401, 403) },
});

const patchFamilyRoute = createRoute({
  method: 'patch',
  path: '/v1/family',
  tags: ['family'],
  summary: 'Change the family name, time zone or emergency number',
  security: bearer,
  request: { body: jsonBody(FamilyPatch) },
  responses: { 200: jsonResponse('The changed family.', Family), ...errorResponses(401, 403, 422) },
});

const listParentsRoute = createRoute({
  method: 'get',
  path: '/v1/family/parents',
  tags: ['family'],
  summary: 'Parents in the family',
  description: 'Removed (disabled) parents are left out.',
  security: bearer,
  responses: { 200: jsonResponse('The parents, oldest first.', z.array(Parent)), ...errorResponses(401, 403) },
});

const addParentRoute = createRoute({
  method: 'post',
  path: '/v1/family/parents',
  tags: ['family'],
  summary: 'Add a parent',
  description: 'They sign in with their email; no invitation is sent.',
  security: bearer,
  request: { body: jsonBody(ParentCreate) },
  responses: { 201: jsonResponse('The new parent.', Parent), ...errorResponses(401, 403, 409, 422) },
});

const patchParentRoute = createRoute({
  method: 'patch',
  path: '/v1/family/parents/{id}',
  tags: ['family'],
  summary: 'Change the name or phone of a parent',
  security: bearer,
  request: { params: IdParam, body: jsonBody(ParentPatch) },
  responses: { 200: jsonResponse('The changed parent.', Parent), ...errorResponses(401, 403, 404, 422) },
});

const removeParentRoute = createRoute({
  method: 'delete',
  path: '/v1/family/parents/{id}',
  tags: ['family'],
  summary: 'Remove a parent',
  description: 'Disables the parent and signs out all their sessions. You cannot remove yourself.',
  security: bearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Removed.' }, ...errorResponses(401, 403, 404, 409, 422) },
});

const getPresetsRoute = createRoute({
  method: 'get',
  path: '/v1/family/message-presets',
  tags: ['family'],
  summary: 'Messages kids can send with one tap',
  security: bearer,
  responses: { 200: jsonResponse('The presets, in order.', z.array(MessagePreset)), ...errorResponses(401, 403) },
});

const putPresetsRoute = createRoute({
  method: 'put',
  path: '/v1/family/message-presets',
  tags: ['family'],
  summary: 'Replace the whole preset list',
  security: bearer,
  request: { body: jsonBody(MessagePresetsPut) },
  responses: { 200: jsonResponse('The new presets, in order.', z.array(MessagePreset)), ...errorResponses(401, 403, 422) },
});

const getParentCodeRoute = createRoute({
  method: 'get',
  path: '/v1/family/parent-code',
  tags: ['family'],
  summary: 'Secret for offline parent-mode codes',
  description: 'The parent app caches it to show rotating codes when a kid device is offline.',
  security: bearer,
  responses: { 200: jsonResponse('The secret.', ParentCodeSecret), ...errorResponses(401, 403) },
});

const rotateParentCodeRoute = createRoute({
  method: 'post',
  path: '/v1/family/parent-code/rotate',
  tags: ['family'],
  summary: 'Replace the parent-code secret',
  description: 'Old codes stop working once devices sync.',
  security: bearer,
  responses: { 200: jsonResponse('The new secret.', ParentCodeSecret), ...errorResponses(401, 403) },
});

/**
 * Family settings, parents, message presets and the parent-code secret (docs/SPEC.md §9.2).
 * Every query runs inside `withFamily`, so row-level security limits it to the caller's family.
 * Statements that are not limited by an id also name the family, as a second guard.
 */
export function registerFamilyRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  /** The family row, read through row-level security. */
  async function readFamily(familyId: string) {
    const [row] = await withFamily(db, familyId, (tx) => tx.select().from(families).where(eq(families.id, familyId)));
    if (!row) throw new ApiError('unauthorized', 'Sign in again.');
    return row;
  }

  app.openapi(getFamilyRoute, async (c) => {
    const { familyId } = await caller(c);
    return c.json(toFamily(await readFamily(familyId)), 200);
  });

  app.openapi(patchFamilyRoute, async (c) => {
    const { familyId } = await caller(c);
    const patch = c.req.valid('json');
    const [row] = await withFamily(db, familyId, (tx) =>
      Object.keys(patch).length === 0
        ? tx.select().from(families).where(eq(families.id, familyId))
        : tx.update(families).set(patch).where(eq(families.id, familyId)).returning(),
    );
    if (!row) throw new ApiError('unauthorized', 'Sign in again.');
    return c.json(toFamily(row), 200);
  });

  app.openapi(listParentsRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(parents).where(isNull(parents.disabledAt)).orderBy(asc(parents.createdAt), asc(parents.id)),
    );
    return c.json(rows.map(toParent), 200);
  });

  app.openapi(addParentRoute, async (c) => {
    const { familyId } = await caller(c);
    const body = c.req.valid('json');
    try {
      const [row] = await withFamily(db, familyId, (tx) =>
        tx
          .insert(parents)
          .values({
            familyId,
            email: body.email.toLowerCase(),
            displayName: body.displayName,
            phoneE164: body.phoneE164 ?? null,
          })
          .returning(),
      );
      if (!row) throw new Error('parent insert returned nothing');
      return c.json(toParent(row), 201);
    } catch (err) {
      // Emails are unique across all families, so this can also be a parent of another family.
      if (isUniqueViolation(err)) throw emailTaken();
      throw err;
    }
  });

  app.openapi(patchParentRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const [row] = await withFamily(db, familyId, (tx) => {
      const where = and(eq(parents.id, id), isNull(parents.disabledAt));
      return Object.keys(patch).length === 0
        ? tx.select().from(parents).where(where)
        : tx.update(parents).set(patch).where(where).returning();
    });
    if (!row) throw parentNotFound();
    return c.json(toParent(row), 200);
  });

  app.openapi(removeParentRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    if (id === parentId) throw new ApiError('conflict', 'You cannot remove yourself. Ask another parent.');
    await withFamily(db, familyId, async (tx) => {
      const [removed] = await tx
        .update(parents)
        .set({ disabledAt: sql`now()` })
        .where(and(eq(parents.id, id), isNull(parents.disabledAt)))
        .returning({ id: parents.id });
      if (!removed) throw parentNotFound();
      await tx
        .update(parentSessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(parentSessions.parentId, id), isNull(parentSessions.revokedAt)));
    });
    return c.body(null, 204);
  });

  app.openapi(getPresetsRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(messagePresets).orderBy(asc(messagePresets.sort), asc(messagePresets.id)),
    );
    return c.json(rows.map(({ id, text }) => ({ id, text })), 200);
  });

  app.openapi(putPresetsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { presets } = c.req.valid('json');
    const rows = await withFamily(db, familyId, async (tx) => {
      // Old kid messages keep their text: their preset_id becomes null (ON DELETE SET NULL).
      await tx.delete(messagePresets).where(eq(messagePresets.familyId, familyId));
      if (presets.length === 0) return [];
      return tx
        .insert(messagePresets)
        .values(presets.map((p, sort) => ({ familyId, text: p.text, sort })))
        .returning();
    });
    rows.sort((a, b) => a.sort - b.sort);
    return c.json(rows.map(({ id, text }) => ({ id, text })), 200);
  });

  app.openapi(getParentCodeRoute, async (c) => {
    const { familyId } = await caller(c);
    return c.json({ secret: (await readFamily(familyId)).parentCodeSecret }, 200);
  });

  app.openapi(rotateParentCodeRoute, async (c) => {
    const { familyId } = await caller(c);
    const [row] = await withFamily(db, familyId, (tx) =>
      tx.update(families).set({ parentCodeSecret: newParentCodeSecret() }).where(eq(families.id, familyId)).returning(),
    );
    if (!row) throw new ApiError('unauthorized', 'Sign in again.');
    return c.json({ secret: row.parentCodeSecret }, 200);
  });
}
```

### 5.12 `server/src/admin/routes.ts`

The four super admin operations. They use `db` directly (no `withFamily`) because they work across families.

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { AdminFamily, AdminFamilyCreate, AdminFamilyCreated, Parent, ParentCreate } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireSuperAdmin } from '../auth/guards.js';
import { isUniqueViolation } from '../db/errors.js';
import { families, messagePresets, parentSessions, parents } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { DEFAULT_MESSAGE_PRESETS, newParentCodeSecret } from '../family/secret.js';
import { emailTaken, toFamily, toParent } from '../family/routes.js';
import { bearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const IdParam = z.object({ id: z.uuid() });

const listFamiliesRoute = createRoute({
  method: 'get',
  path: '/v1/admin/families',
  tags: ['admin'],
  summary: 'Every family on this server',
  security: bearer,
  responses: { 200: jsonResponse('The families, oldest first.', z.array(AdminFamily)), ...errorResponses(401, 403) },
});

const createFamilyRoute = createRoute({
  method: 'post',
  path: '/v1/admin/families',
  tags: ['admin'],
  summary: 'Create a family with its first parent',
  description: 'Also creates the default message presets and a parent-code secret.',
  security: bearer,
  request: { body: jsonBody(AdminFamilyCreate) },
  responses: {
    201: jsonResponse('The new family and parent.', AdminFamilyCreated),
    ...errorResponses(401, 403, 409, 422),
  },
});

const addParentRoute = createRoute({
  method: 'post',
  path: '/v1/admin/families/{id}/parents',
  tags: ['admin'],
  summary: 'Add a parent to any family',
  security: bearer,
  request: { params: IdParam, body: jsonBody(ParentCreate) },
  responses: { 201: jsonResponse('The new parent.', Parent), ...errorResponses(401, 403, 404, 409, 422) },
});

const disableFamilyRoute = createRoute({
  method: 'post',
  path: '/v1/admin/families/{id}/disable',
  tags: ['admin'],
  summary: 'Disable a family',
  description: 'Its parents can no longer sign in, and every parent session is signed out.',
  security: bearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Disabled.' }, ...errorResponses(401, 403, 404, 422) },
});

/**
 * Super admin routes (docs/SPEC.md §6.2). These work across families, so they use the
 * table owner connection directly, without `withFamily`.
 */
export function registerAdminRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const admin = (c: Parameters<typeof requireSuperAdmin>[0]) =>
    requireSuperAdmin(c, config.jwtSecret, config.superAdminEmail);
  const familyNotFound = () => new ApiError('not_found', 'No such family.');

  app.openapi(listFamiliesRoute, async (c) => {
    await admin(c);
    const rows = await db
      .select({ family: families, parentCount: count(parents.id) })
      .from(families)
      .leftJoin(parents, and(eq(parents.familyId, families.id), isNull(parents.disabledAt)))
      .groupBy(families.id)
      .orderBy(asc(families.createdAt), asc(families.id));
    return c.json(
      rows.map(({ family, parentCount }) => ({
        id: family.id,
        name: family.name,
        timezone: family.timezone,
        createdAt: family.createdAt.toISOString(),
        disabledAt: family.disabledAt?.toISOString() ?? null,
        parentCount,
      })),
      200,
    );
  });

  app.openapi(createFamilyRoute, async (c) => {
    await admin(c);
    const body = c.req.valid('json');
    try {
      const created = await db.transaction(async (tx) => {
        const [family] = await tx
          .insert(families)
          .values({
            name: body.name,
            timezone: body.timezone,
            ...(body.emergencyNumber ? { emergencyNumber: body.emergencyNumber } : {}),
            parentCodeSecret: newParentCodeSecret(),
          })
          .returning();
        if (!family) throw new Error('family insert returned nothing');
        const [parent] = await tx
          .insert(parents)
          .values({
            familyId: family.id,
            email: body.firstParent.email.toLowerCase(),
            displayName: body.firstParent.displayName,
            phoneE164: body.firstParent.phoneE164 ?? null,
          })
          .returning();
        if (!parent) throw new Error('parent insert returned nothing');
        await tx
          .insert(messagePresets)
          .values(DEFAULT_MESSAGE_PRESETS.map((text, sort) => ({ familyId: family.id, text, sort })));
        return { family: toFamily(family), parent: toParent(parent) };
      });
      return c.json(created, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw emailTaken();
      throw err;
    }
  });

  app.openapi(addParentRoute, async (c) => {
    await admin(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [family] = await db.select({ id: families.id }).from(families).where(eq(families.id, id));
    if (!family) throw familyNotFound();
    try {
      const [row] = await db
        .insert(parents)
        .values({
          familyId: id,
          email: body.email.toLowerCase(),
          displayName: body.displayName,
          phoneE164: body.phoneE164 ?? null,
        })
        .returning();
      if (!row) throw new Error('parent insert returned nothing');
      return c.json(toParent(row), 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw emailTaken();
      throw err;
    }
  });

  app.openapi(disableFamilyRoute, async (c) => {
    await admin(c);
    const { id } = c.req.valid('param');
    await db.transaction(async (tx) => {
      const [family] = await tx
        .update(families)
        .set({ disabledAt: sql`coalesce(${families.disabledAt}, now())` })
        .where(eq(families.id, id))
        .returning({ id: families.id });
      if (!family) throw familyNotFound();
      await tx
        .update(parentSessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(parentSessions.familyId, id), isNull(parentSessions.revokedAt)));
    });
    return c.body(null, 204);
  });
}
```

### 5.13 `server/src/app.ts`

Replace the whole file. New: it registers the family and admin routes.

```ts
import { createRoute } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { ErrorResponse, HealthResponse } from '@screentime/schemas';
import { registerAdminRoutes } from './admin/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { registerFamilyRoutes } from './family/routes.js';
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
  registerFamilyRoutes(app, deps);
  registerAdminRoutes(app, deps);

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

### 5.14 `server/scripts/seed-dev.ts`

Replace the whole file. The only change: the presets and the secret generator now come from 5.10 instead of being defined in the script.

```ts
// Fills an empty development database with one family, so later cards have data to work with.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts you@example.com
// Never run this against the production database.
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { families, kids, messagePresets, parents, scheduleVersions } from '../src/db/schema.js';
import { DEFAULT_MESSAGE_PRESETS, newParentCodeSecret } from '../src/family/secret.js';

/** ISO weekday 1 = Monday ... 7 = Sunday (docs/SPEC.md §6.1 schedule_versions). */
function week() {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
      ? { weekday, screensMin: 120, phoneMin: 90, wake: '07:00', bedtime: '20:30' }
      : { weekday, screensMin: 180, phoneMin: 120, wake: '08:00', bedtime: '21:00' },
  );
}

const databaseUrl = process.env.DATABASE_URL;
const email = process.argv[2]?.trim().toLowerCase();
if (!databaseUrl || !email) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/seed-dev.ts <parent-email>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  await runMigrations(db);
  const existing = await db.select().from(parents).where(eq(parents.email, email));
  if (existing.length > 0) {
    console.error(`A parent with email ${email} already exists. Nothing changed.`);
    process.exitCode = 1;
  } else {
    await db.transaction(async (tx) => {
      const [family] = await tx
        .insert(families)
        .values({ name: 'Dev family', timezone: 'Australia/Sydney', parentCodeSecret: newParentCodeSecret() })
        .returning();
      if (!family) throw new Error('family insert returned nothing');
      const [parent] = await tx
        .insert(parents)
        .values({ familyId: family.id, email, displayName: 'Dad' })
        .returning();
      if (!parent) throw new Error('parent insert returned nothing');
      const kidRows = await tx
        .insert(kids)
        .values([
          { familyId: family.id, name: 'Alex', avatarColor: '#0F766E' },
          { familyId: family.id, name: 'Sam', avatarColor: '#7C3AED' },
        ])
        .returning();
      await tx.insert(scheduleVersions).values(
        kidRows.map((kid) => ({ familyId: family.id, kidId: kid.id, version: 1, days: week(), createdBy: parent.id })),
      );
      await tx
        .insert(messagePresets)
        .values(DEFAULT_MESSAGE_PRESETS.map((text, sort) => ({ familyId: family.id, text, sort })));
      console.log(`Seeded family ${family.id} with parent ${email} and kids Alex and Sam.`);
    });
  }
} finally {
  await pool.end();
}
```

### 5.15 `server/test/helpers.ts`

Shared test helpers. The file name does not end in `.test.ts`, so Vitest does not run it as a test file.

```ts
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
```

### 5.16 `server/test/family.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { devices, families, kidMessages, kids, messagePresets, parentSessions, parents } from '../src/db/schema.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('family routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const api = client({ db, config: testConfig(url ?? '', 'boss@example.com'), mailer });

  let familyA = '';
  let familyB = '';
  let mum = { id: '', token: '' };
  let dad = { id: '', token: '' };
  let bea = { id: '', token: '' };

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    familyA = a?.id ?? '';
    familyB = b?.id ?? '';
    const rows = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: familyA, email: 'old@example.com', displayName: 'Old', disabledAt: new Date() },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    const login = async (i: number, familyId: string) => {
      const id = rows[i]?.id ?? '';
      return { id, token: await tokenFor({ parentId: id, familyId }) };
    };
    mum = await login(0, familyA);
    dad = await login(1, familyA);
    bea = await login(3, familyB);
    await db.insert(messagePresets).values([
      { familyId: familyA, text: 'Can I have more time?', sort: 0 },
      { familyId: familyA, text: 'Can you call me?', sort: 1 },
      { familyId: familyB, text: 'Family B preset', sort: 0 },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('access', () => {
    it('needs a token', async () => {
      expect((await api.get('/v1/family', null)).status).toBe(401);
    });

    it('refuses a super admin who is not a parent with 403', async () => {
      const admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
      const res = await api.get('/v1/family', admin);
      expect(res.status).toBe(403);
      expect(res.body.error).toEqual({ code: 'forbidden', message: 'This needs a parent account.' });
    });

    it('refuses a token whose parent no longer exists', async () => {
      const ghost = await tokenFor({ parentId: randomUUID(), familyId: familyA });
      expect((await api.get('/v1/family', ghost)).status).toBe(401);
    });
  });

  describe('GET and PATCH /v1/family', () => {
    it("returns only the caller's family", async () => {
      expect((await api.get('/v1/family', mum.token)).body).toEqual({
        id: familyA,
        name: 'Family A',
        timezone: 'Australia/Sydney',
        emergencyNumber: '000',
      });
      expect((await api.get('/v1/family', bea.token)).body.name).toBe('Family B');
    });

    it('changes only the fields sent', async () => {
      const res = await api.patch('/v1/family', mum.token, { name: '  The As ', timezone: 'Australia/Brisbane' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'The As', timezone: 'Australia/Brisbane', emergencyNumber: '000' });
      expect((await api.patch('/v1/family', mum.token, {})).body.name).toBe('The As');
      expect((await api.get('/v1/family', bea.token)).body.name).toBe('Family B');
    });

    it('rejects an unknown time zone or a bad emergency number', async () => {
      expect((await api.patch('/v1/family', mum.token, { timezone: 'Mars/Olympus' })).status).toBe(422);
      expect((await api.patch('/v1/family', mum.token, { emergencyNumber: 'help' })).status).toBe(422);
    });
  });

  describe('parents', () => {
    it("lists the family's enabled parents, oldest first", async () => {
      const res = await api.get('/v1/family/parents', mum.token);
      expect(res.status).toBe(200);
      expect(res.body.map((p: { displayName: string }) => p.displayName)).toEqual(['Mum', 'Dad']);
    });

    it('adds a parent with a lower-case email', async () => {
      const res = await api.post('/v1/family/parents', mum.token, {
        email: 'Gran@Example.com',
        displayName: 'Gran',
        phoneE164: '+61400000001',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: 'gran@example.com', displayName: 'Gran', phoneE164: '+61400000001' });
    });

    it('refuses an email that any family already uses', async () => {
      const res = await api.post('/v1/family/parents', mum.token, { email: 'bea@example.com', displayName: 'Copy' });
      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({ code: 'conflict', message: 'That email already belongs to a parent.' });
    });

    it("edits a parent of the family, and cannot see other families' parents", async () => {
      const res = await api.patch(`/v1/family/parents/${dad.id}`, mum.token, { phoneE164: '+61400000002' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ displayName: 'Dad', phoneE164: '+61400000002' });
      expect((await api.patch(`/v1/family/parents/${dad.id}`, mum.token, { phoneE164: null })).body.phoneE164).toBeNull();
      expect((await api.patch(`/v1/family/parents/${dad.id}`, mum.token, { phoneE164: '0400' })).status).toBe(422);
      expect((await api.patch(`/v1/family/parents/${bea.id}`, mum.token, { displayName: 'Hacked' })).status).toBe(404);
      expect((await api.patch('/v1/family/parents/not-a-uuid', mum.token, { displayName: 'X' })).status).toBe(422);
    });

    it("cannot remove yourself or another family's parent", async () => {
      expect((await api.del(`/v1/family/parents/${mum.id}`, mum.token)).status).toBe(409);
      expect((await api.del(`/v1/family/parents/${bea.id}`, mum.token)).status).toBe(404);
    });

    it('removes a parent: disabled, signed out everywhere, and refused at once', async () => {
      await db.insert(parentSessions).values({
        parentId: dad.id,
        familyId: familyA,
        refreshTokenHash: 'dad-session',
        client: 'android',
        clientLabel: 'Dad phone',
      });
      expect((await api.del(`/v1/family/parents/${dad.id}`, mum.token)).status).toBe(204);
      const [session] = await db.select().from(parentSessions).where(eq(parentSessions.parentId, dad.id));
      expect(session?.revokedAt).toBeInstanceOf(Date);
      expect((await api.get('/v1/family', dad.token)).status).toBe(401);
      const names = (await api.get('/v1/family/parents', mum.token)).body.map((p: { displayName: string }) => p.displayName);
      expect(names).toEqual(['Mum', 'Gran']);
      expect((await api.del(`/v1/family/parents/${dad.id}`, mum.token)).status).toBe(404);
    });
  });

  describe('message presets', () => {
    it("lists the family's presets in order", async () => {
      const res = await api.get('/v1/family/message-presets', mum.token);
      expect(res.status).toBe(200);
      expect(res.body.map((p: { text: string }) => p.text)).toEqual(['Can I have more time?', 'Can you call me?']);
    });

    it('replaces the whole list, keeping old kid messages', async () => {
      const [kid] = await db.insert(kids).values({ familyId: familyA, name: 'Alex', avatarColor: '#0F766E' }).returning();
      const [device] = await db
        .insert(devices)
        .values({
          familyId: familyA,
          kidId: kid?.id ?? '',
          platform: 'android',
          form: 'phone',
          pool: 'phone',
          name: 'Pixel 7',
          tokenHash: 'device-token',
        })
        .returning();
      const before = (await api.get('/v1/family/message-presets', mum.token)).body;
      const messageId = randomUUID();
      await db.insert(kidMessages).values({
        id: messageId,
        familyId: familyA,
        kidId: kid?.id ?? '',
        deviceId: device?.id ?? '',
        body: 'Can you call me?',
        presetId: before[1].id,
      });

      const res = await api.put('/v1/family/message-presets', mum.token, {
        presets: [{ text: ' Pick me up please ' }, { text: 'Can I have more time?' }],
      });
      expect(res.status).toBe(200);
      expect(res.body.map((p: { text: string }) => p.text)).toEqual(['Pick me up please', 'Can I have more time?']);
      expect((await api.get('/v1/family/message-presets', mum.token)).body).toEqual(res.body);

      const [message] = await db.select().from(kidMessages).where(eq(kidMessages.id, messageId));
      expect(message?.body).toBe('Can you call me?');
      expect(message?.presetId).toBeNull();
      const others = (await api.get('/v1/family/message-presets', bea.token)).body;
      expect(others.map((p: { text: string }) => p.text)).toEqual(['Family B preset']);
    });

    it('accepts an empty list and refuses more than 10', async () => {
      expect((await api.put('/v1/family/message-presets', mum.token, { presets: [] })).body).toEqual([]);
      const eleven = { presets: Array.from({ length: 11 }, (_, i) => ({ text: `Preset ${i}` })) };
      expect((await api.put('/v1/family/message-presets', mum.token, eleven)).status).toBe(422);
    });
  });

  describe('parent-code secret', () => {
    it('returns the secret and rotates it', async () => {
      expect((await api.get('/v1/family/parent-code', mum.token)).body).toEqual({ secret: 'A'.repeat(32) });
      const rotated = await api.post('/v1/family/parent-code/rotate', mum.token);
      expect(rotated.status).toBe(200);
      expect(rotated.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(rotated.body.secret).not.toBe('A'.repeat(32));
      expect((await api.get('/v1/family/parent-code', mum.token)).body).toEqual(rotated.body);
      expect((await api.get('/v1/family/parent-code', bea.token)).body).toEqual({ secret: 'B'.repeat(32) });
    });
  });

  it('refuses every parent of a disabled family', async () => {
    await db.execute(sql`update families set disabled_at = now() where id = ${familyB}`);
    expect((await api.get('/v1/family', bea.token)).status).toBe(401);
  });
});
```

### 5.17 `server/test/admin.test.ts`

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { families, messagePresets, parentSessions, parents } from '../src/db/schema.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('super admin routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const api = client({ db, config: testConfig(url ?? '', 'boss@example.com'), mailer });
  let admin = '';

  const newFamily = {
    name: 'The Gallaghers',
    timezone: 'Australia/Sydney',
    firstParent: { email: 'James@Example.com', displayName: 'Dad', phoneE164: '+61400000003' },
  };

  beforeAll(async () => {
    await resetDatabase(db, pool);
    admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('refuses anyone but the super admin', async () => {
    expect((await api.get('/v1/admin/families', null)).status).toBe(401);
    const parent = await tokenFor({ parentId: null, familyId: null }, ['parent']);
    const res = await api.get('/v1/admin/families', parent);
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({ code: 'forbidden', message: 'This needs the super admin.' });
  });

  it('refuses a super admin token once SUPER_ADMIN_EMAIL is removed', async () => {
    const noAdmin = client({ db, config: testConfig(url ?? '', null), mailer });
    expect((await noAdmin.get('/v1/admin/families', admin)).status).toBe(403);
  });

  it('creates a family with its first parent, default presets and a secret', async () => {
    const res = await api.post('/v1/admin/families', admin, newFamily);
    expect(res.status).toBe(201);
    expect(res.body.family).toMatchObject({ name: 'The Gallaghers', timezone: 'Australia/Sydney', emergencyNumber: '000' });
    expect(res.body.parent).toMatchObject({ email: 'james@example.com', displayName: 'Dad', phoneE164: '+61400000003' });

    const familyId = res.body.family.id;
    const [family] = await db.select().from(families).where(eq(families.id, familyId));
    expect(family?.parentCodeSecret).toMatch(/^[A-Z2-7]{32}$/);
    const presets = await db.select().from(messagePresets).where(eq(messagePresets.familyId, familyId));
    expect(presets.sort((a, b) => a.sort - b.sort).map((p) => p.text)).toEqual([
      'Can I have more time?',
      "I'm done, you can lock it",
      'Can you call me?',
      "I'm on my way home",
      'I need help with homework',
    ]);
  });

  it("creates nothing when the first parent's email is taken", async () => {
    const before = await db.select().from(families);
    const res = await api.post('/v1/admin/families', admin, { ...newFamily, name: 'Copy' });
    expect(res.status).toBe(409);
    expect(await db.select().from(families)).toHaveLength(before.length);
  });

  it('rejects a bad time zone', async () => {
    expect((await api.post('/v1/admin/families', admin, { ...newFamily, timezone: 'Sydney' })).status).toBe(422);
  });

  it('adds a parent to a family, and 404s for an unknown family', async () => {
    const [family] = await db.select().from(families);
    const res = await api.post(`/v1/admin/families/${family?.id}/parents`, admin, {
      email: 'mum@example.com',
      displayName: 'Mum',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'mum@example.com', displayName: 'Mum', phoneE164: null });
    const unknown = await api.post('/v1/admin/families/00000000-0000-7000-8000-000000000000/parents', admin, {
      email: 'x@example.com',
      displayName: 'X',
    });
    expect(unknown.status).toBe(404);
  });

  it('lists every family with its parent count', async () => {
    await api.post('/v1/admin/families', admin, {
      name: 'Second',
      timezone: 'Europe/London',
      emergencyNumber: '999',
      firstParent: { email: 'second@example.com', displayName: 'Pat' },
    });
    const res = await api.get('/v1/admin/families', admin);
    expect(res.status).toBe(200);
    expect(res.body.map((f: { name: string; parentCount: number }) => [f.name, f.parentCount])).toEqual([
      ['The Gallaghers', 2],
      ['Second', 1],
    ]);
    expect(res.body[0].disabledAt).toBeNull();
  });

  it('disables a family: its parents are signed out and refused', async () => {
    const [family] = await db.select().from(families).where(eq(families.name, 'Second'));
    const [pat] = await db.select().from(parents).where(eq(parents.email, 'second@example.com'));
    await db.insert(parentSessions).values({
      parentId: pat?.id ?? '',
      familyId: family?.id ?? '',
      refreshTokenHash: 'pat-session',
      client: 'web',
      clientLabel: 'Browser',
    });
    const patToken = await tokenFor({ parentId: pat?.id ?? '', familyId: family?.id ?? '' });
    expect((await api.get('/v1/family', patToken)).status).toBe(200);

    expect((await api.post(`/v1/admin/families/${family?.id}/disable`, admin)).status).toBe(204);
    expect((await api.get('/v1/family', patToken)).status).toBe(401);
    const [session] = await db.select().from(parentSessions).where(eq(parentSessions.refreshTokenHash, 'pat-session'));
    expect(session?.revokedAt).toBeInstanceOf(Date);
    const list = (await api.get('/v1/admin/families', admin)).body;
    expect(list[1].disabledAt).toEqual(expect.any(String));
    expect((await api.post('/v1/admin/families/00000000-0000-7000-8000-000000000000/disable', admin)).status).toBe(404);
  });
});
```

### 5.18 `server/test/openapi.test.ts`

Replace the whole file. New: the third test, for the family and admin routes.

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

  it('describes the family and super admin routes, all behind bearer auth', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch' | 'put' | 'delete']> = [
      ['/v1/family', 'get'],
      ['/v1/family', 'patch'],
      ['/v1/family/parents', 'get'],
      ['/v1/family/parents', 'post'],
      ['/v1/family/parents/{id}', 'patch'],
      ['/v1/family/parents/{id}', 'delete'],
      ['/v1/family/message-presets', 'get'],
      ['/v1/family/message-presets', 'put'],
      ['/v1/family/parent-code', 'get'],
      ['/v1/family/parent-code/rotate', 'post'],
      ['/v1/admin/families', 'get'],
      ['/v1/admin/families', 'post'],
      ['/v1/admin/families/{id}/parents', 'post'],
      ['/v1/admin/families/{id}/disable', 'post'],
    ];
    for (const [path, method] of routes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'AdminFamily',
        'AdminFamilyCreate',
        'AdminFamilyCreated',
        'Family',
        'FamilyPatch',
        'MessagePreset',
        'MessagePresetsPut',
        'Parent',
        'ParentCodeSecret',
        'ParentCreate',
        'ParentPatch',
      ]),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.19 `contract/openapi.json` (generated)

Do **not** write this by hand. After all the files above, run from the repo root:

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
      },
      "Family": {
        "type": "object",
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
      "FamilyPatch": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "timezone": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "emergencyNumber": {
            "type": "string",
            "pattern": "^[0-9]{2,6}$"
          }
        }
      },
      "Parent": {
        "type": "object",
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
      "ParentCreate": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 254,
            "format": "email"
          },
          "displayName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "phoneE164": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\+[1-9][0-9]{6,14}$"
          }
        },
        "required": [
          "email",
          "displayName"
        ]
      },
      "ParentPatch": {
        "type": "object",
        "properties": {
          "displayName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "phoneE164": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\+[1-9][0-9]{6,14}$"
          }
        }
      },
      "MessagePreset": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "text"
        ]
      },
      "MessagePresetsPut": {
        "type": "object",
        "properties": {
          "presets": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "text": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160
                }
              },
              "required": [
                "text"
              ]
            },
            "maxItems": 10
          }
        },
        "required": [
          "presets"
        ]
      },
      "ParentCodeSecret": {
        "type": "object",
        "properties": {
          "secret": {
            "type": "string",
            "pattern": "^[A-Z2-7]{32}$"
          }
        },
        "required": [
          "secret"
        ]
      },
      "AdminFamily": {
        "type": "object",
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
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "disabledAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "parentCount": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "id",
          "name",
          "timezone",
          "createdAt",
          "disabledAt",
          "parentCount"
        ]
      },
      "AdminFamilyCreated": {
        "type": "object",
        "properties": {
          "family": {
            "$ref": "#/components/schemas/Family"
          },
          "parent": {
            "$ref": "#/components/schemas/Parent"
          }
        },
        "required": [
          "family",
          "parent"
        ]
      },
      "AdminFamilyCreate": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "timezone": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "emergencyNumber": {
            "type": "string",
            "pattern": "^[0-9]{2,6}$"
          },
          "firstParent": {
            "$ref": "#/components/schemas/ParentCreate"
          }
        },
        "required": [
          "name",
          "timezone",
          "firstParent"
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
            "description": "The request is not valid.",
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
            "description": "The request is not valid.",
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
            "description": "The request is not valid.",
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
    },
    "/v1/family": {
      "get": {
        "tags": [
          "family"
        ],
        "summary": "The family of the signed-in parent",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The family.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Family"
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "patch": {
        "tags": [
          "family"
        ],
        "summary": "Change the family name, time zone or emergency number",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/FamilyPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The changed family.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Family"
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
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
    "/v1/family/parents": {
      "get": {
        "tags": [
          "family"
        ],
        "summary": "Parents in the family",
        "description": "Removed (disabled) parents are left out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The parents, oldest first.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Parent"
                  }
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "family"
        ],
        "summary": "Add a parent",
        "description": "They sign in with their email; no invitation is sent.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ParentCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The new parent.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Parent"
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
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
    "/v1/family/parents/{id}": {
      "patch": {
        "tags": [
          "family"
        ],
        "summary": "Change the name or phone of a parent",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ParentPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The changed parent.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Parent"
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "delete": {
        "tags": [
          "family"
        ],
        "summary": "Remove a parent",
        "description": "Disables the parent and signs out all their sessions. You cannot remove yourself.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Removed."
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
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
    "/v1/family/message-presets": {
      "get": {
        "tags": [
          "family"
        ],
        "summary": "Messages kids can send with one tap",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The presets, in order.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/MessagePreset"
                  }
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "put": {
        "tags": [
          "family"
        ],
        "summary": "Replace the whole preset list",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/MessagePresetsPut"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The new presets, in order.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/MessagePreset"
                  }
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
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
    "/v1/family/parent-code": {
      "get": {
        "tags": [
          "family"
        ],
        "summary": "Secret for offline parent-mode codes",
        "description": "The parent app caches it to show rotating codes when a kid device is offline.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The secret.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentCodeSecret"
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
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
    "/v1/family/parent-code/rotate": {
      "post": {
        "tags": [
          "family"
        ],
        "summary": "Replace the parent-code secret",
        "description": "Old codes stop working once devices sync.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The new secret.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentCodeSecret"
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
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
    "/v1/admin/families": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Every family on this server",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The families, oldest first.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/AdminFamily"
                  }
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Create a family with its first parent",
        "description": "Also creates the default message presets and a parent-code secret.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/AdminFamilyCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The new family and parent.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/AdminFamilyCreated"
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
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
    "/v1/admin/families/{id}/parents": {
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Add a parent to any family",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ParentCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The new parent.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Parent"
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
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
    "/v1/admin/families/{id}/disable": {
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Disable a family",
        "description": "Its parents can no longer sign in, and every parent session is signed out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Disabled."
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
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
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

## 6. Detailed spec

### 6.1 Who may call what

| Caller | Family routes `/v1/family...` | Admin routes `/v1/admin/...` |
|---|---|---|
| No token, a garbage token, a forged or expired token | 401 `Sign in first.` | 401 `Sign in first.` |
| Super admin who is not a parent | 403 `This needs a parent account.` | allowed |
| Parent | allowed, for their own family only | 403 `This needs the super admin.` |
| Parent who is also the super admin | allowed | allowed |
| Parent who was removed, or whose family was disabled, with a token that has not expired yet | 401 `Sign in again.` | (403 unless super admin) |
| A token with the `superadmin` role after `SUPER_ADMIN_EMAIL` was removed from the settings | as a parent | 403 `This needs the super admin.` |

### 6.2 Family routes (Bearer access token of a parent)

| Operation | Request | Answer | Errors |
|---|---|---|---|
| `GET /v1/family` | | 200 `Family` `{ id, name, timezone, emergencyNumber }` | |
| `PATCH /v1/family` | `FamilyPatch`: any of `name` (trimmed, 1 to 100), `timezone` (IANA), `emergencyNumber` (2 to 6 digits). An empty object changes nothing. | 200 `Family` | 422 |
| `GET /v1/family/parents` | | 200 list of `Parent` `{ id, email, displayName, phoneE164 }`, oldest first; removed parents are left out | |
| `POST /v1/family/parents` | `ParentCreate`: `email`, `displayName` (trimmed, 1 to 40), `phoneE164` (optional, `+` and 7 to 15 digits, or null). The email is stored in lower case. | 201 `Parent` | 409 `That email already belongs to a parent.` (in any family), 422 |
| `PATCH /v1/family/parents/{id}` | `ParentPatch`: any of `displayName`, `phoneE164` | 200 `Parent` | 404 `No such parent in your family.` (also for removed parents and other families' parents), 422 |
| `DELETE /v1/family/parents/{id}` | | 204. Sets `disabled_at` and revokes all the parent's sessions. | 409 `You cannot remove yourself. Ask another parent.`, 404, 422 (id not a UUID) |
| `GET /v1/family/message-presets` | | 200 list of `MessagePreset` `{ id, text }`, in order | |
| `PUT /v1/family/message-presets` | `MessagePresetsPut`: `{ presets: [{ text }] }`, 0 to 10 presets, each trimmed 1 to 160 characters | 200 the new list, in the order given. The old presets are deleted (old kid messages keep their text, `preset_id` becomes null). | 422 |
| `GET /v1/family/parent-code` | | 200 `{ secret }` (32 base32 characters) | |
| `POST /v1/family/parent-code/rotate` | | 200 `{ secret }`, a new one | |

All of them can also answer 401 and 403 (6.1).

### 6.3 Admin routes (Bearer access token of the super admin)

| Operation | Request | Answer | Errors |
|---|---|---|---|
| `GET /v1/admin/families` | | 200 list of `AdminFamily` `{ id, name, timezone, createdAt, disabledAt, parentCount }`, oldest first. `parentCount` counts enabled parents only. | |
| `POST /v1/admin/families` | `AdminFamilyCreate`: `name`, `timezone`, `emergencyNumber` (optional, default `000`), `firstParent` (`ParentCreate`) | 201 `{ family, parent }`. In one transaction: the family with a new parent-code secret, the first parent, the five default presets. | 409 if the email is taken (nothing is created), 422 |
| `POST /v1/admin/families/{id}/parents` | `ParentCreate` | 201 `Parent` | 404 `No such family.`, 409, 422 |
| `POST /v1/admin/families/{id}/disable` | | 204. Sets `disabled_at` (keeps the first time if called twice) and revokes every parent session in the family. | 404, 422 |

All of them can also answer 401 and 403 (6.1).

### 6.4 OpenAPI

Every new operation has `security: [{ bearerAuth: [] }]` and lists its error responses. New named schemas: `AdminFamily`, `AdminFamilyCreate`, `AdminFamilyCreated`, `Family`, `FamilyPatch`, `MessagePreset`, `MessagePresetsPut`, `Parent`, `ParentCodeSecret`, `ParentCreate`, `ParentPatch`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-012-family-and-admin
   pnpm install --frozen-lockfile
   ```
   `git log -1 --oneline` must show the CARD-012 card merge (the commit that added `docs/cards/CARD-012-family-and-admin.md`). If `docs/cards/CARD-012-family-and-admin.md` does not exist, you did not pull: run `git fetch origin` and `git pull origin main` again.
3. Create 5.1 to 5.3. Run `pnpm --filter @screentime/schemas test` (`Tests  11 passed (11)`). Commit: `CARD-012: add family and admin schemas`.
4. Change `schema.ts` (5.4) and generate the migration (5.5); compare the SQL. Commit the schema and the three drizzle files: `CARD-012: keep kid messages when a preset is deleted`.
5. Create or replace 5.6 to 5.14. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-012: add family and super admin routes`.
6. Create or replace the tests 5.15 to 5.18. Commit: `CARD-012: add family and admin tests`.
7. Run `pnpm contract` (5.19) and compare. Commit: `CARD-012: regenerate the API contract`.
8. Run the acceptance checks in section 8.
9. Push and open the PR (section 10).
10. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret or SMTP key in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  11 passed (11)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/admin.test.ts (8 tests | 8 skipped)`, `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/family.test.ts (17 tests | 17 skipped)`, `test/config.test.ts (7 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (4 tests)`, `test/health.test.ts (2 tests)`, so `Tests  27 passed | 52 skipped (79)`.
- [ ] `server/drizzle/0004_preset_delete_set_null.sql` matches 5.5 and `contract/openapi.json` matches 5.19 exactly. Running `pnpm contract` again leaves `git status --short contract` empty, and `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate`.
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
  Output: `test/admin.test.ts (8 tests)`, `test/auth.test.ts (15 tests)`, `test/db.test.ts (12 tests)`, `test/family.test.ts (17 tests)` and `Tests  79 passed (79)`.
- [ ] The routes work on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
  ```powershell
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
  Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/request -ContentType 'application/json' -Body '{"email":"admin@example.com"}'
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "sign-in code for admin"
  ```
  Put the 6 digits from the last log line in place of `123456`, then create a family and list the families:
  ```powershell
  $a = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"admin@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ah = @{ Authorization = "Bearer $($a.accessToken)" }
  $f = Invoke-RestMethod -Method Post http://localhost:8080/v1/admin/families -Headers $ah -ContentType 'application/json' -Body '{"name":"Test family","timezone":"Australia/Sydney","firstParent":{"email":"Parent@Example.com","displayName":"Dad"}}'
  "$($f.family.name) / $($f.parent.email) / $($f.family.emergencyNumber)"
  Invoke-RestMethod http://localhost:8080/v1/admin/families -Headers $ah | ForEach-Object { "$($_.name): $($_.parentCount)" }
  ```
  The two outputs are `Test family / parent@example.com / 000` and `Test family: 1`. Now sign in as that parent:
  ```powershell
  Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/request -ContentType 'application/json' -Body '{"email":"parent@example.com"}'
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "sign-in code for parent"
  ```
  Put those 6 digits in place of `123456`:
  ```powershell
  $p = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"parent@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ph = @{ Authorization = "Bearer $($p.accessToken)" }
  (Invoke-RestMethod http://localhost:8080/v1/family -Headers $ph).name
  (Invoke-RestMethod http://localhost:8080/v1/family/message-presets -Headers $ph).Count
  try { Invoke-RestMethod http://localhost:8080/v1/admin/families -Headers $ph } catch { $_.Exception.Response.StatusCode.value__ }
  ```
  The three outputs are `Test family`, `5` and `403`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 21 files (in any order):
  ```
  contract/openapi.json
  packages/schemas/src/family.ts
  packages/schemas/src/index.ts
  packages/schemas/test/family.test.ts
  server/drizzle/0004_preset_delete_set_null.sql
  server/drizzle/meta/0004_snapshot.json
  server/drizzle/meta/_journal.json
  server/scripts/seed-dev.ts
  server/src/admin/routes.ts
  server/src/app.ts
  server/src/auth/guards.ts
  server/src/auth/routes.ts
  server/src/db/errors.ts
  server/src/db/schema.ts
  server/src/family/routes.ts
  server/src/family/secret.ts
  server/src/openapi.ts
  server/test/admin.test.ts
  server/test/family.test.ts
  server/test/helpers.ts
  server/test/openapi.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/family.test.ts` | Time zones must be real IANA names; emergency numbers are 2 to 6 digits; phone numbers must be E.164 and display names are trimmed; at most 10 presets of 1 to 160 characters. |
| `server/test/family.test.ts` | Against a real database: no token 401, super admin without a family 403, a removed parent 401; read and change the family (an empty patch changes nothing; a bad time zone is 422; other families are not touched); list parents (removed ones left out, oldest first); add a parent (email lower-cased, 201; a taken email 409, even from another family); edit a parent (404 for another family's parent); remove a parent (204, their sessions are revoked, they get 401; removing yourself is 409, another family's parent 404); presets in order; replacing presets keeps an old kid message with `presetId` null; 0 presets allowed, 11 is 422; the parent-code secret rotates; a disabled family gets 401. |
| `server/test/admin.test.ts` | No token 401, a parent 403, a super admin token after `SUPER_ADMIN_EMAIL` is removed 403; create a family (201, default `000`, five presets, a 32-character secret); a taken first-parent email gives 409 and creates no family; a bad time zone 422; add a parent to a family (201) and to an unknown family (404); list families with `parentCount`; disable a family (204, its sessions are revoked, its parents get 401). |
| `server/test/openapi.test.ts` | As before, plus: all 14 new operations exist with bearer auth, and the 11 new schemas are named; the committed file is up to date. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 7). Message format: `CARD-012: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-012-family-and-admin`
5. Open a PR into `main` titled `CARD-012: Family settings and super admin`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-012-family-and-admin --title "CARD-012: Family settings and super admin" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-012-family-and-admin.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] 0004 migration and openapi.json match the card; pnpm contract and db:generate are stable
   - [x] database tests — output: `Tests  79 passed (79)`
   - [x] routes on the real stack — output: `Test family / parent@example.com / 000`, `Test family: 1`, `Test family`, `5`, `403`
   - [x] deploy/.env not tracked
   - [x] only expected files changed — output: 21 files

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

- **The generated migration is not numbered `0004`**, or drizzle-kit asks a question: you are not on the latest `main`, or `schema.ts` differs from 5.4. Press Ctrl+C, delete what it generated, and start again from step 2.
- **`openapi.test.ts` fails with a diff**: run `pnpm contract`. If the new file still differs from 5.19, one of 5.1, 5.2, 5.6, 5.9, 5.11, 5.12 or 5.13 does not match the card. Do not edit `openapi.json` by hand.
- **A family or admin test fails with 401 where it expected 200**: `server/test/helpers.ts` must match 5.15 exactly (it signs test tokens with `TEST_SECRET`, which `testConfig` also uses).
- **TypeScript complains about a test name** (`',' expected`): an apostrophe inside a single-quoted string. Copy the line again from the card; those names use double quotes.
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-012. Please review and merge if it is good.

CARD: CARD-012 Family settings and super admin
PR: <full PR URL>
Branch: bob/card-012-family-and-admin
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
