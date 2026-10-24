# CARD-013: Device enrolment

| Field | Value |
|---|---|
| Card | CARD-013 |
| Title | Device enrolment |
| Size | M |
| Depends on | CARD-012b (merged to `main`) |
| Spec sections | docs/SPEC.md §9.1, §9.2, §9.3, §11.2, §11.3 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-013-device-enrolment` |
| PR title | `CARD-013: Device enrolment` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Request and response shapes are Zod schemas in `packages/schemas` (package `@screentime/schemas`), and `pnpm contract` writes the generated OpenAPI document to `contract/openapi.json`, which is committed; `server/test/openapi.test.ts` fails if it is out of date. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`.

Parents already sign in (CARD-011), manage the family (CARD-012) and manage kids (CARD-012b). Parent routes use `requireFamilyParent` (`server/src/auth/guards.ts`) and run their queries through `withFamily` (`server/src/db/family.ts`), which limits them to the caller's family by row-level security. The tables `devices`, `enrolment_codes` and `events` already exist (CARD-010).

This card connects kid devices to the server (SPEC §11.3):

1. A parent asks for an **enrolment code** for a kid and a form (phone, tablet or PC). The server answers with a 6-digit code, valid for 10 minutes, and a QR payload `screentime://enrol?host=<host>&code=<code>`.
2. The kid device sends the code to `POST /v1/enrol`, with no sign-in. The server checks the code, creates the device row and returns an opaque **device token** (32 random bytes). Only the token's SHA-256 hash is stored, as with refresh tokens.
3. From then on the device sends `Authorization: Bearer <deviceToken>`. `requireDevice` (new) checks it. The first device route is `GET /v1/device/me`. The full device API comes in later cards.
4. Parents can list, rename, move to another pool, and revoke devices. A revoked device's token stops working at once. Archiving a kid now also revokes their devices.

No database migration is needed.

## 2. Goal

A parent can make an enrolment code, a kid device can enrol with it and prove who it is with its token, and parents can manage devices. All of it is tested against PostgreSQL 18 in CI, and the OpenAPI contract describes the 6 new operations and the `deviceAuth` security scheme.

## 3. Out of scope

Do **not** do any of these in this card:

- No device state snapshot, usage upload, events upload or WebSocket (CARD-014 and later).
- No push notifications. The `device.enrolled` event is written to the `events` table only.
- No Android or Windows app code, and no QR image: the server only returns the payload text.
- No new npm packages. `pnpm-lock.yaml` and every `package.json` stay unchanged.
- No database migration. Do not change `server/src/db/schema.ts` or anything in `server/drizzle/`.
- Do not change any file that is not listed in section 5. In particular, leave `server/src/auth/guards.ts`, `server/src/auth/tokens.ts`, `server/src/auth/rate-limit.ts`, `server/src/family/`, `server/src/admin/`, `server/src/db/`, `server/test/helpers.ts` and the other existing tests as they are.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key, a device token or any other secret.

## 4. Tech and versions

Nothing new. Everything is unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, Zod ^4.6, hono ^4.13.13, @hono/zod-openapi ^1.6.3, drizzle-orm ^0.45.4, PostgreSQL 18.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some test names contain an apostrophe and so use double quotes (`it("revokes a kid's devices when the kid is archived", ...)`): keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/devices.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/devices.test.ts` | create (5.3) |
| `server/src/auth/client-ip.ts` | create (5.4) |
| `server/src/auth/routes.ts` | replace (5.5) |
| `server/src/openapi.ts` | replace (5.6) |
| `server/src/devices/token.ts` | create (5.7) |
| `server/src/devices/auth.ts` | create (5.8) |
| `server/src/devices/routes.ts` | create (5.9) |
| `server/src/kids/routes.ts` | replace (5.10) |
| `server/src/app.ts` | replace (5.11) |
| `server/test/devices.test.ts` | create (5.12) |
| `server/test/openapi.test.ts` | replace (5.13) |
| `contract/openapi.json` | **generated** by `pnpm contract` (5.14) |

That is 14 files.

### 5.1 `packages/schemas/src/devices.ts`

The shapes for the device routes. `EnrolRequest` has no `form`: the code decides it. On Windows, `machineId`, `windowsUserSid` and `windowsUserName` are required, because a Windows device row is one PC plus one Windows account (SPEC §6.1).

```ts
import { z } from 'zod';

export const Platform = z.enum(['android', 'windows']).meta({ id: 'Platform' });
export type Platform = z.infer<typeof Platform>;

/** What the parent picked under "Add device". Decides the pool: phone → phone, tablet and pc → screens. */
export const DeviceForm = z.enum(['phone', 'tablet', 'pc']).meta({ id: 'DeviceForm' });
export type DeviceForm = z.infer<typeof DeviceForm>;

export const Pool = z.enum(['screens', 'phone']).meta({ id: 'Pool' });
export type Pool = z.infer<typeof Pool>;

/** A kid device as parents see it. */
export const Device = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    platform: Platform,
    form: DeviceForm,
    pool: Pool,
    name: z.string(),
    hasCellular: z.boolean(),
    model: z.string().nullable(),
    osVersion: z.string().nullable(),
    appVersion: z.string().nullable(),
    windowsUserName: z.string().nullable(),
    enrolledAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Device' });

export type Device = z.infer<typeof Device>;

/** Body of PATCH /v1/devices/{id}. Send only the fields to change. */
export const DevicePatch = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    pool: Pool.optional(),
  })
  .meta({ id: 'DevicePatch' });

export type DevicePatch = z.infer<typeof DevicePatch>;

/** Body of POST /v1/kids/{kidId}/enrolment-codes. */
export const EnrolmentCodeCreate = z.object({ form: DeviceForm }).meta({ id: 'EnrolmentCodeCreate' });
export type EnrolmentCodeCreate = z.infer<typeof EnrolmentCodeCreate>;

export const EnrolmentCode = z
  .object({
    code: z.string().regex(/^[0-9]{6}$/),
    /** `screentime://enrol?host=<host>&code=<code>`, shown as a QR code. */
    qrPayload: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'EnrolmentCode' });

export type EnrolmentCode = z.infer<typeof EnrolmentCode>;

/** Body of POST /v1/enrol, sent by the kid device. The code decides the kid and the form. */
export const EnrolRequest = z
  .object({
    code: z.string().regex(/^[0-9]{6}$/, 'The code is 6 digits.'),
    platform: Platform,
    hasCellular: z.boolean(),
    model: z.string().trim().min(1).max(100),
    osVersion: z.string().trim().min(1).max(100),
    appVersion: z.string().trim().min(1).max(40),
    /** Windows only: machine GUID, the kid account's SID and its user name (one device row per account). */
    machineId: z.string().trim().min(1).max(100).optional(),
    windowsUserSid: z.string().trim().min(1).max(100).optional(),
    windowsUserName: z.string().trim().min(1).max(100).optional(),
  })
  .refine((r) => r.platform !== 'windows' || (r.machineId && r.windowsUserSid && r.windowsUserName), {
    message: 'Windows needs machineId, windowsUserSid and windowsUserName.',
    path: ['windowsUserSid'],
  })
  .meta({ id: 'EnrolRequest' });

export type EnrolRequest = z.infer<typeof EnrolRequest>;

export const EnrolResponse = z
  .object({
    deviceId: z.uuid(),
    /** Opaque. Send as `Authorization: Bearer <deviceToken>` on every device call. Shown once. */
    deviceToken: z.string(),
    kid: z.object({ id: z.uuid(), name: z.string() }),
    family: z.object({ name: z.string(), timezone: z.string() }),
  })
  .meta({ id: 'EnrolResponse' });

export type EnrolResponse = z.infer<typeof EnrolResponse>;

/** GET /v1/device/me: the calling device, so an app can check it is still enrolled. */
export const DeviceMe = z
  .object({
    device: z.object({
      id: z.uuid(),
      name: z.string(),
      form: DeviceForm,
      pool: Pool,
      hasCellular: z.boolean(),
    }),
    kid: z.object({ id: z.uuid(), name: z.string() }),
    family: z.object({ timezone: z.string(), emergencyNumber: z.string() }),
  })
  .meta({ id: 'DeviceMe' });

export type DeviceMe = z.infer<typeof DeviceMe>;
```

### 5.2 `packages/schemas/src/index.ts`

Replace the whole file. New: the exports from `devices.ts`.

```ts
export { AuthResponse, Me, OtpRequest, OtpVerifyRequest, RefreshRequest, Role } from './auth.js';
export { ErrorCode, ErrorResponse } from './errors.js';
export {
  Device,
  DeviceForm,
  DeviceMe,
  DevicePatch,
  EnrolmentCode,
  EnrolmentCodeCreate,
  EnrolRequest,
  EnrolResponse,
  Platform,
  Pool,
} from './devices.js';
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
export {
  AvatarColor,
  Kid,
  KidContact,
  KidContactsPut,
  KidCreate,
  KidPatch,
  Schedule,
  ScheduleDay,
  ScheduleInput,
} from './kids.js';
```

### 5.3 `packages/schemas/test/devices.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { DevicePatch, EnrolRequest } from '../src/index.js';

const android = {
  code: '012345',
  platform: 'android',
  hasCellular: true,
  model: 'Pixel 7',
  osVersion: 'Android 14',
  appVersion: '0.1.0',
};

describe('device schemas', () => {
  it('needs a 6-digit code', () => {
    expect(EnrolRequest.safeParse(android).success).toBe(true);
    expect(EnrolRequest.safeParse({ ...android, code: '12345' }).success).toBe(false);
    expect(EnrolRequest.safeParse({ ...android, code: '12345a' }).success).toBe(false);
  });

  it('needs the account details on Windows only', () => {
    const windows = { ...android, platform: 'windows', hasCellular: false, model: 'Dell XPS 13', osVersion: 'Windows 11' };
    expect(EnrolRequest.safeParse(windows).success).toBe(false);
    const account = { machineId: 'machine-guid', windowsUserSid: 'S-1-5-21-1-2-3-1001', windowsUserName: 'alex' };
    expect(EnrolRequest.safeParse({ ...windows, ...account }).success).toBe(true);
  });

  it('allows renaming and moving a device to another pool', () => {
    expect(DevicePatch.parse({ name: ' Alex phone ' }).name).toBe('Alex phone');
    expect(DevicePatch.safeParse({ pool: 'screens' }).success).toBe(true);
    expect(DevicePatch.safeParse({ pool: 'tv' }).success).toBe(false);
  });
});
```

### 5.4 `server/src/auth/client-ip.ts`

The caller's IP, used by the rate limits. It moves here from `server/src/auth/routes.ts` (unchanged) so the enrolment route can use it too.

```ts
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/** The caller's IP: Cloudflare's header in production, the socket address otherwise. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header('cf-connecting-ip');
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
```

### 5.5 `server/src/auth/routes.ts`

Replace the whole file. The only changes from `main`: the `clientIp` function and the two imports it needed (`getConnInfo` and `Context`) are gone, and `clientIp` is imported from 5.4. The behaviour is the same.

```ts
import { createRoute } from '@hono/zod-openapi';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuthResponse, Me, OtpRequest, OtpVerifyRequest, RefreshRequest, type Role } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { withFamily } from '../db/family.js';
import { families, otpCodes, parentSessions, parents } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { bearer, errorResponses, jsonBody } from '../openapi.js';
import type { createRouter } from '../router.js';
import { clientIp } from './client-ip.js';
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

### 5.6 `server/src/openapi.ts`

Replace the whole file. New: `deviceBearer`, the OpenAPI `security` value for device routes (last three lines).

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

/** Routes for kid devices: the device token from enrolment. */
export const deviceBearer = [{ deviceAuth: [] }];
```

### 5.7 `server/src/devices/token.ts`

```ts
import { createHash, randomBytes, randomInt } from 'node:crypto';

/** An opaque device token: 32 random bytes, base64url (docs/SPEC.md §11.2). Only its hash is stored. */
export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A random 6-digit enrolment code, with leading zeros. */
export function newEnrolmentCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
```

### 5.8 `server/src/devices/auth.ts`

`requireDevice` is the device counterpart of `requireParent`. It finds the device by the hash of its token in one statement, which also updates `last_seen_at`. It refuses a revoked device, an archived kid and a disabled family.

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Db } from '../db/client.js';
import { devices, families, kids } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { hashDeviceToken } from './token.js';

export interface DeviceAuth {
  deviceId: string;
  kidId: string;
  familyId: string;
}

/**
 * The calling kid device, from its Bearer device token. Throws 401 if the token is missing or
 * unknown, or once the device is revoked, its kid archived or its family disabled. Updates
 * `last_seen_at`. Uses the owner connection: the family is not known until the token is looked up.
 */
export async function requireDevice(c: Context, db: Db): Promise<DeviceAuth> {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) throw new ApiError('unauthorized', 'This device is not enrolled.');
  const [device] = await db
    .update(devices)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(devices.tokenHash, hashDeviceToken(token)),
        isNull(devices.revokedAt),
        sql`exists (select 1 from ${kids} where ${kids.id} = ${devices.kidId} and ${kids.archivedAt} is null)`,
        sql`exists (select 1 from ${families} where ${families.id} = ${devices.familyId} and ${families.disabledAt} is null)`,
      ),
    )
    .returning({ deviceId: devices.id, kidId: devices.kidId, familyId: devices.familyId });
  if (!device) throw new ApiError('unauthorized', 'This device is not enrolled.');
  return device;
}
```

### 5.9 `server/src/devices/routes.ts`

The six device operations (6.2 to 6.4). `POST /v1/enrol` runs in one transaction on the owner connection, because the family is only known once the code is found. It locks the code row (`FOR UPDATE`) so two devices cannot use one code at the same moment.

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  Device,
  type DeviceForm,
  DeviceMe,
  DevicePatch,
  EnrolmentCode,
  EnrolmentCodeCreate,
  EnrolRequest,
  EnrolResponse,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { clientIp } from '../auth/client-ip.js';
import { requireFamilyParent } from '../auth/guards.js';
import { RateLimiter } from '../auth/rate-limit.js';
import { withFamily } from '../db/family.js';
import { devices, enrolmentCodes, events, families, kids } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { findKid } from '../kids/routes.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { requireDevice } from './auth.js';
import { hashDeviceToken, newDeviceToken, newEnrolmentCode } from './token.js';

type Router = ReturnType<typeof createRouter>;

/** Enrolment codes work for 10 minutes (docs/SPEC.md §11.3). */
const CODE_TTL = sql`now() + interval '10 minutes'`;

/** Which platform each form runs on. */
const PLATFORM_OF: Record<DeviceForm, 'android' | 'windows'> = { phone: 'android', tablet: 'android', pc: 'windows' };
const FORM_TEXT: Record<DeviceForm, string> = { phone: 'an Android phone', tablet: 'an Android tablet', pc: 'a Windows PC' };

const IdParam = z.object({ id: z.uuid() });
const KidParam = z.object({ kidId: z.uuid() });

function toDevice(row: typeof devices.$inferSelect): Device {
  return {
    id: row.id,
    kidId: row.kidId,
    platform: row.platform as Device['platform'],
    form: row.form as Device['form'],
    pool: row.pool as Device['pool'],
    name: row.name,
    hasCellular: row.hasCellular,
    model: row.model,
    osVersion: row.osVersion,
    appVersion: row.appVersion,
    windowsUserName: row.windowsUserName,
    enrolledAt: row.enrolledAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

const deviceNotFound = () => new ApiError('not_found', 'No such device in your family.');

const createCodeRoute = createRoute({
  method: 'post',
  path: '/v1/kids/{kidId}/enrolment-codes',
  tags: ['devices'],
  summary: 'Make a code to add a device for a kid',
  description: 'The code works once, for 10 minutes. Show it in large digits and as a QR code of `qrPayload`.',
  security: bearer,
  request: { params: KidParam, body: jsonBody(EnrolmentCodeCreate) },
  responses: { 201: jsonResponse('The code.', EnrolmentCode), ...errorResponses(401, 403, 404, 422) },
});

const listDevicesRoute = createRoute({
  method: 'get',
  path: '/v1/devices',
  tags: ['devices'],
  summary: 'Devices in the family',
  description: 'Revoked devices are left out.',
  security: bearer,
  responses: { 200: jsonResponse('The devices, oldest first.', z.array(Device)), ...errorResponses(401, 403) },
});

const patchDeviceRoute = createRoute({
  method: 'patch',
  path: '/v1/devices/{id}',
  tags: ['devices'],
  summary: 'Rename a device or move it to another pool',
  security: bearer,
  request: { params: IdParam, body: jsonBody(DevicePatch) },
  responses: { 200: jsonResponse('The changed device.', Device), ...errorResponses(401, 403, 404, 422) },
});

const revokeDeviceRoute = createRoute({
  method: 'delete',
  path: '/v1/devices/{id}',
  tags: ['devices'],
  summary: 'Revoke a device',
  description: 'Its token stops working at once. Its history stays.',
  security: bearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Revoked.' }, ...errorResponses(401, 403, 404, 422) },
});

const enrolRoute = createRoute({
  method: 'post',
  path: '/v1/enrol',
  tags: ['devices'],
  summary: 'Enrol a kid device with a code',
  description: 'Called by the kid device. No sign-in: the code is the proof.',
  request: { body: jsonBody(EnrolRequest) },
  responses: {
    201: jsonResponse('Enrolled. Keep the device token safe; it is not shown again.', EnrolResponse),
    ...errorResponses(401, 409, 422, 429),
  },
});

const deviceMeRoute = createRoute({
  method: 'get',
  path: '/v1/device/me',
  tags: ['device'],
  summary: 'The calling device, its kid and family',
  description: 'A 401 means the device was revoked and must be enrolled again.',
  security: deviceBearer,
  responses: { 200: jsonResponse('This device.', DeviceMe), ...errorResponses(401) },
});

/**
 * Enrolment codes, enrolment and device management (docs/SPEC.md §9, §11.2, §11.3).
 * Parent routes run inside `withFamily`. Enrolment has no family yet, so it uses the owner connection.
 */
export function registerDeviceRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);
  // A wrong code matches no row, so guesses are limited per IP instead of per code.
  const enrolsPerIp = new RateLimiter(10, 15 * 60 * 1000);

  /** A code that no unexpired, unused code in any family already has. */
  async function freeCode() {
    for (let i = 0; i < 10; i++) {
      const code = newEnrolmentCode();
      const [taken] = await db
        .select({ id: enrolmentCodes.id })
        .from(enrolmentCodes)
        .where(and(eq(enrolmentCodes.code, code), isNull(enrolmentCodes.consumedAt), gt(enrolmentCodes.expiresAt, sql`now()`)));
      if (!taken) return code;
    }
    throw new Error('no free enrolment code after 10 tries');
  }

  app.openapi(createCodeRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const { form } = c.req.valid('json');
    const code = await freeCode();
    const row = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const [saved] = await tx
        .insert(enrolmentCodes)
        .values({ familyId, kidId, form, code, expiresAt: CODE_TTL, createdBy: parentId })
        .returning();
      if (!saved) throw new Error('enrolment code insert returned nothing');
      return saved;
    });
    // The host the parent app used is the one the kid device can reach (the public hostname in production).
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    const qrPayload = `screentime://enrol?host=${encodeURIComponent(host)}&code=${code}`;
    return c.json({ code, qrPayload, expiresAt: row.expiresAt.toISOString() }, 201);
  });

  app.openapi(listDevicesRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(devices).where(isNull(devices.revokedAt)).orderBy(asc(devices.enrolledAt), asc(devices.id)),
    );
    return c.json(rows.map(toDevice), 200);
  });

  app.openapi(patchDeviceRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const [row] = await withFamily(db, familyId, (tx) => {
      const where = and(eq(devices.id, id), isNull(devices.revokedAt));
      return Object.keys(patch).length === 0
        ? tx.select().from(devices).where(where)
        : tx.update(devices).set(patch).where(where).returning();
    });
    if (!row) throw deviceNotFound();
    return c.json(toDevice(row), 200);
  });

  app.openapi(revokeDeviceRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const [revoked] = await withFamily(db, familyId, (tx) =>
      tx
        .update(devices)
        .set({ revokedAt: sql`now()`, fcmToken: null })
        .where(and(eq(devices.id, id), isNull(devices.revokedAt)))
        .returning({ id: devices.id }),
    );
    if (!revoked) throw deviceNotFound();
    return c.body(null, 204);
  });

  app.openapi(enrolRoute, async (c) => {
    if (!enrolsPerIp.hit(clientIp(c))) throw new ApiError('rate_limited', 'Too many enrolment attempts. Try again later.');
    const body = c.req.valid('json');
    const wrongCode = () => new ApiError('unauthorized', 'That code is wrong or has expired. Ask a parent for a new one.');
    const deviceToken = newDeviceToken();
    const result = await db.transaction(async (tx) => {
      // Lock the code so two devices cannot use it at the same moment.
      const [found] = await tx
        .select({ code: enrolmentCodes, kid: kids, family: families })
        .from(enrolmentCodes)
        .innerJoin(kids, eq(kids.id, enrolmentCodes.kidId))
        .innerJoin(families, eq(families.id, enrolmentCodes.familyId))
        .where(
          and(
            eq(enrolmentCodes.code, body.code),
            isNull(enrolmentCodes.consumedAt),
            gt(enrolmentCodes.expiresAt, sql`now()`),
            isNull(kids.archivedAt),
            isNull(families.disabledAt),
          ),
        )
        .orderBy(desc(enrolmentCodes.createdAt))
        .limit(1)
        .for('update', { of: enrolmentCodes });
      if (!found) throw wrongCode();
      const { code, kid, family } = found;
      const form = code.form as DeviceForm;
      if (PLATFORM_OF[form] !== body.platform) throw new ApiError('conflict', `This code is for ${FORM_TEXT[form]}.`);

      if (body.platform === 'windows') {
        // Installing again on the same PC account replaces the old device row.
        await tx
          .update(devices)
          .set({ revokedAt: sql`now()`, fcmToken: null })
          .where(
            and(
              eq(devices.familyId, family.id),
              eq(devices.machineId, body.machineId ?? ''),
              eq(devices.windowsUserSid, body.windowsUserSid ?? ''),
              isNull(devices.revokedAt),
            ),
          );
      }
      const name = (body.platform === 'windows' ? `${body.windowsUserName} on ${body.model}` : body.model).slice(0, 40);
      const [device] = await tx
        .insert(devices)
        .values({
          familyId: family.id,
          kidId: kid.id,
          platform: body.platform,
          form,
          pool: form === 'phone' ? 'phone' : 'screens',
          name,
          hasCellular: body.hasCellular,
          model: body.model,
          osVersion: body.osVersion,
          appVersion: body.appVersion,
          machineId: body.machineId ?? null,
          windowsUserSid: body.windowsUserSid ?? null,
          windowsUserName: body.windowsUserName ?? null,
          tokenHash: hashDeviceToken(deviceToken),
          lastSeenAt: sql`now()`,
        })
        .returning();
      if (!device) throw new Error('device insert returned nothing');
      await tx
        .update(enrolmentCodes)
        .set({ consumedAt: sql`now()`, deviceId: device.id })
        .where(eq(enrolmentCodes.id, code.id));
      // Every notification kind is written to events (docs/SPEC.md §13); the push comes with notifications.
      await tx.insert(events).values({
        familyId: family.id,
        kidId: kid.id,
        deviceId: device.id,
        kind: 'device.enrolled',
        at: sql`now()`,
        payload: { name, form, platform: body.platform },
      });
      return {
        deviceId: device.id,
        deviceToken,
        kid: { id: kid.id, name: kid.name },
        family: { name: family.name, timezone: family.timezone },
      };
    });
    return c.json(result, 201);
  });

  app.openapi(deviceMeRoute, async (c) => {
    const { deviceId } = await requireDevice(c, db);
    const [row] = await db
      .select({ device: devices, kid: kids, family: families })
      .from(devices)
      .innerJoin(kids, eq(kids.id, devices.kidId))
      .innerJoin(families, eq(families.id, devices.familyId))
      .where(eq(devices.id, deviceId));
    if (!row) throw new ApiError('unauthorized', 'This device is not enrolled.');
    const { device, kid, family } = row;
    return c.json(
      {
        device: {
          id: device.id,
          name: device.name,
          form: device.form as DeviceForm,
          pool: device.pool as Device['pool'],
          hasCellular: device.hasCellular,
        },
        kid: { id: kid.id, name: kid.name },
        family: { timezone: family.timezone, emergencyNumber: family.emergencyNumber },
      },
      200,
    );
  });
}
```

### 5.10 `server/src/kids/routes.ts`

Replace the whole file. The only changes from `main`: `findKid` is exported (the enrolment-code route uses it), `devices` is imported, and archiving a kid also revokes the kid's devices (the route description says so too).

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  Kid,
  KidContact,
  KidContactsPut,
  KidCreate,
  KidPatch,
  Schedule,
  type ScheduleDay,
  ScheduleInput,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { isUniqueViolation } from '../db/errors.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, kidContacts, kids, scheduleVersions } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { bearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { DEFAULT_WARN1_MIN, DEFAULT_WARN2_MIN, defaultWeek } from './schedule.js';

type Router = ReturnType<typeof createRouter>;

const KidParam = z.object({ kidId: z.uuid() });

function toKid(row: typeof kids.$inferSelect): Kid {
  return { id: row.id, name: row.name, avatarColor: row.avatarColor as Kid['avatarColor'] };
}

function toSchedule(row: typeof scheduleVersions.$inferSelect): Schedule {
  // jsonb does not keep key order, so each day is rebuilt in the order of the contract.
  const days = (row.days as ScheduleDay[]).map(({ weekday, screensMin, phoneMin, wake, bedtime }) => ({
    weekday,
    screensMin,
    phoneMin,
    wake,
    bedtime,
  }));
  return { version: row.version, warn1Min: row.warn1Min, warn2Min: row.warn2Min, days };
}

const kidNotFound = () => new ApiError('not_found', 'No such kid in your family.');

/** The kid, if it is in the caller's family and not archived. Row-level security hides other families. */
export async function findKid(tx: FamilyTx, kidId: string) {
  const [row] = await tx
    .select()
    .from(kids)
    .where(and(eq(kids.id, kidId), isNull(kids.archivedAt)));
  if (!row) throw kidNotFound();
  return row;
}

const listKidsRoute = createRoute({
  method: 'get',
  path: '/v1/kids',
  tags: ['kids'],
  summary: 'Kids in the family',
  description: 'Archived kids are left out.',
  security: bearer,
  responses: { 200: jsonResponse('The kids, oldest first.', z.array(Kid)), ...errorResponses(401, 403) },
});

const createKidRoute = createRoute({
  method: 'post',
  path: '/v1/kids',
  tags: ['kids'],
  summary: 'Add a kid',
  description: 'The kid starts with the default schedule (version 1) and no contacts.',
  security: bearer,
  request: { body: jsonBody(KidCreate) },
  responses: { 201: jsonResponse('The new kid.', Kid), ...errorResponses(401, 403, 422) },
});

const getKidRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}',
  tags: ['kids'],
  summary: 'One kid',
  security: bearer,
  request: { params: KidParam },
  responses: { 200: jsonResponse('The kid.', Kid), ...errorResponses(401, 403, 404, 422) },
});

const patchKidRoute = createRoute({
  method: 'patch',
  path: '/v1/kids/{kidId}',
  tags: ['kids'],
  summary: 'Change the name or colour of a kid',
  security: bearer,
  request: { params: KidParam, body: jsonBody(KidPatch) },
  responses: { 200: jsonResponse('The changed kid.', Kid), ...errorResponses(401, 403, 404, 422) },
});

const archiveKidRoute = createRoute({
  method: 'delete',
  path: '/v1/kids/{kidId}',
  tags: ['kids'],
  summary: 'Archive a kid',
  description: 'The kid disappears from lists and their devices are revoked; their history stays.',
  security: bearer,
  request: { params: KidParam },
  responses: { 204: { description: 'Archived.' }, ...errorResponses(401, 403, 404, 422) },
});

const getScheduleRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}/schedule',
  tags: ['kids'],
  summary: 'The current schedule of a kid',
  security: bearer,
  request: { params: KidParam },
  responses: { 200: jsonResponse('The highest schedule version.', Schedule), ...errorResponses(401, 403, 404, 422) },
});

const putScheduleRoute = createRoute({
  method: 'put',
  path: '/v1/kids/{kidId}/schedule',
  tags: ['kids'],
  summary: 'Save a new schedule version',
  description: 'Old versions are kept. Devices pick up the new one on their next sync.',
  security: bearer,
  request: { params: KidParam, body: jsonBody(ScheduleInput) },
  responses: { 200: jsonResponse('The new schedule.', Schedule), ...errorResponses(401, 403, 404, 409, 422) },
});

const getContactsRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}/contacts',
  tags: ['kids'],
  summary: 'The always-callable list of a kid',
  description: 'Parents with a phone number are always callable too; they are not in this list.',
  security: bearer,
  request: { params: KidParam },
  responses: { 200: jsonResponse('The contacts, in order.', z.array(KidContact)), ...errorResponses(401, 403, 404, 422) },
});

const putContactsRoute = createRoute({
  method: 'put',
  path: '/v1/kids/{kidId}/contacts',
  tags: ['kids'],
  summary: 'Replace the whole contact list',
  security: bearer,
  request: { params: KidParam, body: jsonBody(KidContactsPut) },
  responses: { 200: jsonResponse('The new contacts, in order.', z.array(KidContact)), ...errorResponses(401, 403, 404, 422) },
});

/**
 * Kids, their schedules and their always-callable contacts (docs/SPEC.md §9.2).
 * Every query runs inside `withFamily`, so row-level security limits it to the caller's family.
 */
export function registerKidRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  app.openapi(listKidsRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(kids).where(isNull(kids.archivedAt)).orderBy(asc(kids.createdAt), asc(kids.id)),
    );
    return c.json(rows.map(toKid), 200);
  });

  app.openapi(createKidRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const body = c.req.valid('json');
    const row = await withFamily(db, familyId, async (tx) => {
      const [kid] = await tx.insert(kids).values({ familyId, name: body.name, avatarColor: body.avatarColor }).returning();
      if (!kid) throw new Error('kid insert returned nothing');
      await tx.insert(scheduleVersions).values({
        familyId,
        kidId: kid.id,
        version: 1,
        warn1Min: DEFAULT_WARN1_MIN,
        warn2Min: DEFAULT_WARN2_MIN,
        days: defaultWeek(),
        createdBy: parentId,
      });
      return kid;
    });
    return c.json(toKid(row), 201);
  });

  app.openapi(getKidRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    return c.json(toKid(await withFamily(db, familyId, (tx) => findKid(tx, kidId))), 200);
  });

  app.openapi(patchKidRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const patch = c.req.valid('json');
    const row = await withFamily(db, familyId, async (tx) => {
      if (Object.keys(patch).length === 0) return findKid(tx, kidId);
      const [kid] = await tx
        .update(kids)
        .set(patch)
        .where(and(eq(kids.id, kidId), isNull(kids.archivedAt)))
        .returning();
      if (!kid) throw kidNotFound();
      return kid;
    });
    return c.json(toKid(row), 200);
  });

  app.openapi(archiveKidRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    await withFamily(db, familyId, async (tx) => {
      const [archived] = await tx
        .update(kids)
        .set({ archivedAt: sql`now()` })
        .where(and(eq(kids.id, kidId), isNull(kids.archivedAt)))
        .returning({ id: kids.id });
      if (!archived) throw kidNotFound();
      await tx
        .update(devices)
        .set({ revokedAt: sql`now()`, fcmToken: null })
        .where(and(eq(devices.kidId, kidId), isNull(devices.revokedAt)));
    });
    return c.body(null, 204);
  });

  app.openapi(getScheduleRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const row = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const [latest] = await tx
        .select()
        .from(scheduleVersions)
        .where(eq(scheduleVersions.kidId, kidId))
        .orderBy(desc(scheduleVersions.version))
        .limit(1);
      if (!latest) throw new ApiError('not_found', 'This kid has no schedule yet.');
      return latest;
    });
    return c.json(toSchedule(row), 200);
  });

  app.openapi(putScheduleRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const input = c.req.valid('json');
    try {
      const row = await withFamily(db, familyId, async (tx) => {
        await findKid(tx, kidId);
        const [current] = await tx
          .select({ version: sql<number>`coalesce(max(${scheduleVersions.version}), 0)` })
          .from(scheduleVersions)
          .where(eq(scheduleVersions.kidId, kidId));
        const [saved] = await tx
          .insert(scheduleVersions)
          .values({ familyId, kidId, version: (current?.version ?? 0) + 1, ...input, createdBy: parentId })
          .returning();
        if (!saved) throw new Error('schedule insert returned nothing');
        return saved;
      });
      return c.json(toSchedule(row), 200);
    } catch (err) {
      // Two parents saved at the same moment and both took the same version number.
      if (isUniqueViolation(err)) throw new ApiError('conflict', 'The schedule was changed at the same time. Try again.');
      throw err;
    }
  });

  app.openapi(getContactsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const rows = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      return tx
        .select()
        .from(kidContacts)
        .where(eq(kidContacts.kidId, kidId))
        .orderBy(asc(kidContacts.sort), asc(kidContacts.id));
    });
    return c.json(rows.map(({ id, label, phoneE164 }) => ({ id, label, phoneE164 })), 200);
  });

  app.openapi(putContactsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const { contacts } = c.req.valid('json');
    const rows = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      await tx.delete(kidContacts).where(and(eq(kidContacts.familyId, familyId), eq(kidContacts.kidId, kidId)));
      if (contacts.length === 0) return [];
      return tx
        .insert(kidContacts)
        .values(contacts.map((contact, sort) => ({ familyId, kidId, ...contact, sort })))
        .returning();
    });
    rows.sort((a, b) => a.sort - b.sort);
    return c.json(rows.map(({ id, label, phoneE164 }) => ({ id, label, phoneE164 })), 200);
  });
}
```

### 5.11 `server/src/app.ts`

Replace the whole file. New: the `deviceAuth` security scheme and the device routes.

```ts
import { createRoute } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { ErrorResponse, HealthResponse } from '@screentime/schemas';
import { registerAdminRoutes } from './admin/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { registerDeviceRoutes } from './devices/routes.js';
import { registerFamilyRoutes } from './family/routes.js';
import { registerKidRoutes } from './kids/routes.js';
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

### 5.12 `server/test/devices.test.ts`

Each test gets a new app (`beforeEach`), so the per-IP enrolment limit starts from zero in every test.

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { devices, enrolmentCodes, events, families, kids, parents } from '../src/db/schema.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const phone = { platform: 'android', hasCellular: true, model: 'Pixel 7', osVersion: 'Android 14', appVersion: '0.1.0' };
const pc = {
  platform: 'windows',
  hasCellular: false,
  model: 'Dell XPS 13',
  osVersion: 'Windows 11 Pro',
  appVersion: '0.1.0',
  machineId: 'machine-guid-1',
  windowsUserSid: 'S-1-5-21-1-2-3-1001',
  windowsUserName: 'alex',
};

describe.skipIf(!url)('device routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const deps = { db, config: testConfig(url ?? ''), mailer };
  // A new app for each test, so the per-IP enrolment limit starts again.
  let api = client(deps);

  let familyA = '';
  let familyB = '';
  let mum = '';
  let bea = '';
  let alex = '';
  let ben = '';

  /** A fresh code for a kid, made by a parent. */
  async function code(token: string, kidId: string, form: string) {
    const res = await api.post(`/v1/kids/${kidId}/enrolment-codes`, token, { form });
    expect(res.status).toBe(201);
    return res.body.code as string;
  }

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
    const [p1, p2] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mum = await tokenFor({ parentId: p1?.id ?? '', familyId: familyA });
    bea = await tokenFor({ parentId: p2?.id ?? '', familyId: familyB });
    const [k1, k2] = await db
      .insert(kids)
      .values([
        { familyId: familyA, name: 'Alex', avatarColor: '#0F766E' },
        { familyId: familyB, name: 'Ben', avatarColor: '#2563EB' },
      ])
      .returning();
    alex = k1?.id ?? '';
    ben = k2?.id ?? '';
  });

  beforeEach(() => {
    api = client(deps);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('enrolment codes', () => {
    it('makes a 6-digit code with a QR payload, valid for 10 minutes', async () => {
      const res = await api.post(`/v1/kids/${alex}/enrolment-codes`, mum, { form: 'phone' });
      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(/^[0-9]{6}$/);
      expect(res.body.qrPayload).toBe(`screentime://enrol?host=localhost&code=${res.body.code}`);
      const minutes = (Date.parse(res.body.expiresAt) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(9);
      expect(minutes).toBeLessThanOrEqual(10);
    });

    it("needs a parent, a known form, and a kid of the caller's family", async () => {
      expect((await api.post(`/v1/kids/${alex}/enrolment-codes`, null, { form: 'phone' })).status).toBe(401);
      expect((await api.post(`/v1/kids/${alex}/enrolment-codes`, mum, { form: 'tv' })).status).toBe(422);
      expect((await api.post(`/v1/kids/${ben}/enrolment-codes`, mum, { form: 'phone' })).status).toBe(404);
    });
  });

  describe('POST /v1/enrol', () => {
    it('enrols a phone once, records the event and lists the device', async () => {
      const c = await code(mum, alex, 'phone');
      const res = await api.post('/v1/enrol', null, { code: c, ...phone });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        deviceId: expect.any(String),
        deviceToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        kid: { id: alex, name: 'Alex' },
        family: { name: 'Family A', timezone: 'Australia/Sydney' },
      });
      const [used] = await db.select().from(enrolmentCodes).where(eq(enrolmentCodes.code, c));
      expect(used?.consumedAt).toBeInstanceOf(Date);
      expect(used?.deviceId).toBe(res.body.deviceId);
      const [event] = await db.select().from(events).where(eq(events.deviceId, res.body.deviceId));
      expect(event).toMatchObject({ kind: 'device.enrolled', kidId: alex, payload: { name: 'Pixel 7', form: 'phone' } });

      const again = await api.post('/v1/enrol', null, { code: c, ...phone });
      expect(again.status).toBe(401);
      expect(again.body.error.message).toBe('That code is wrong or has expired. Ask a parent for a new one.');

      const listed = (await api.get('/v1/devices', mum)).body;
      expect(listed).toEqual([
        expect.objectContaining({ id: res.body.deviceId, kidId: alex, form: 'phone', pool: 'phone', name: 'Pixel 7' }),
      ]);
      expect(listed[0].lastSeenAt).not.toBeNull();
      expect((await api.get('/v1/devices', bea)).body).toEqual([]);
    });

    it('refuses an expired code', async () => {
      const c = await code(mum, alex, 'tablet');
      await db.execute(sql`update enrolment_codes set expires_at = now() - interval '1 second' where code = ${c}`);
      expect((await api.post('/v1/enrol', null, { code: c, ...phone })).status).toBe(401);
    });

    it('refuses a code made for another kind of device, and keeps the code', async () => {
      const c = await code(mum, alex, 'pc');
      const wrong = await api.post('/v1/enrol', null, { code: c, ...phone });
      expect(wrong.status).toBe(409);
      expect(wrong.body.error.message).toBe('This code is for a Windows PC.');
      const right = await api.post('/v1/enrol', null, { code: c, ...pc });
      expect(right.status).toBe(201);
      const [row] = await db.select().from(devices).where(eq(devices.id, right.body.deviceId));
      expect(row).toMatchObject({ form: 'pc', pool: 'screens', name: 'alex on Dell XPS 13', windowsUserSid: pc.windowsUserSid });
    });

    it('replaces the old device when the same PC account enrols again', async () => {
      const before = (await api.get('/v1/devices', mum)).body.filter((d: { form: string }) => d.form === 'pc');
      expect(before).toHaveLength(1);
      const res = await api.post('/v1/enrol', null, { code: await code(mum, alex, 'pc'), ...pc });
      expect(res.status).toBe(201);
      const after = (await api.get('/v1/devices', mum)).body.filter((d: { form: string }) => d.form === 'pc');
      expect(after.map((d: { id: string }) => d.id)).toEqual([res.body.deviceId]);
    });

    it('limits attempts per IP', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await api.post('/v1/enrol', null, { code: '000000', ...phone })).status).toBe(401);
      }
      expect((await api.post('/v1/enrol', null, { code: '000000', ...phone })).status).toBe(429);
    });
  });

  describe('device token', () => {
    it('identifies the device on GET /v1/device/me', async () => {
      const { deviceToken, deviceId } = (await api.post('/v1/enrol', null, { code: await code(mum, alex, 'phone'), ...phone }))
        .body;
      const res = await api.get('/v1/device/me', deviceToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        device: { id: deviceId, name: 'Pixel 7', form: 'phone', pool: 'phone', hasCellular: true },
        kid: { id: alex, name: 'Alex' },
        family: { timezone: 'Australia/Sydney', emergencyNumber: '000' },
      });
      expect((await api.get('/v1/device/me', null)).status).toBe(401);
      expect((await api.get('/v1/device/me', 'not-a-token')).status).toBe(401);
      expect((await api.get('/v1/device/me', mum)).status).toBe(401);
    });
  });

  describe('managing devices', () => {
    it("renames a device and moves its pool, but not another family's", async () => {
      const { deviceId } = (await api.post('/v1/enrol', null, { code: await code(mum, alex, 'tablet'), ...phone })).body;
      const res = await api.patch(`/v1/devices/${deviceId}`, mum, { name: ' Drawing pad ', pool: 'phone' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: deviceId, name: 'Drawing pad', form: 'tablet', pool: 'phone' });
      expect((await api.patch(`/v1/devices/${deviceId}`, mum, {})).body).toEqual(res.body);
      expect((await api.patch(`/v1/devices/${deviceId}`, bea, { name: 'Mine' })).status).toBe(404);
    });

    it('revokes a device: its token stops working at once', async () => {
      const { deviceToken, deviceId } = (await api.post('/v1/enrol', null, { code: await code(mum, alex, 'phone'), ...phone }))
        .body;
      expect((await api.del(`/v1/devices/${deviceId}`, bea)).status).toBe(404);
      expect((await api.del(`/v1/devices/${deviceId}`, mum)).status).toBe(204);
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(401);
      expect((await api.get('/v1/devices', mum)).body.map((d: { id: string }) => d.id)).not.toContain(deviceId);
      expect((await api.del(`/v1/devices/${deviceId}`, mum)).status).toBe(404);
      expect((await api.patch(`/v1/devices/${deviceId}`, mum, { name: 'Back' })).status).toBe(404);
    });

    it("revokes a kid's devices when the kid is archived", async () => {
      const [sam] = await db.insert(kids).values({ familyId: familyA, name: 'Sam', avatarColor: '#7C3AED' }).returning();
      const samId = sam?.id ?? '';
      const { deviceToken } = (await api.post('/v1/enrol', null, { code: await code(mum, samId, 'phone'), ...phone })).body;
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(200);
      expect((await api.del(`/v1/kids/${samId}`, mum)).status).toBe(204);
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(401);
      const rows = await db.select().from(devices).where(eq(devices.kidId, samId));
      expect(rows.every((d) => d.revokedAt instanceof Date)).toBe(true);
    });

    it('refuses the devices of a disabled family', async () => {
      const { deviceToken } = (await api.post('/v1/enrol', null, { code: await code(bea, ben, 'phone'), ...phone })).body;
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(200);
      await db.execute(sql`update families set disabled_at = now() where id = ${familyB}`);
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(401);
    });
  });
});
```

### 5.13 `server/test/openapi.test.ts`

Replace the whole file. New: the fifth test, for enrolment and the device routes.

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

  it('describes the kid routes, all behind bearer auth', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch' | 'put' | 'delete']> = [
      ['/v1/kids', 'get'],
      ['/v1/kids', 'post'],
      ['/v1/kids/{kidId}', 'get'],
      ['/v1/kids/{kidId}', 'patch'],
      ['/v1/kids/{kidId}', 'delete'],
      ['/v1/kids/{kidId}/schedule', 'get'],
      ['/v1/kids/{kidId}/schedule', 'put'],
      ['/v1/kids/{kidId}/contacts', 'get'],
      ['/v1/kids/{kidId}/contacts', 'put'],
    ];
    for (const [path, method] of routes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'AvatarColor',
        'Kid',
        'KidContact',
        'KidContactsPut',
        'KidCreate',
        'KidPatch',
        'Schedule',
        'ScheduleDay',
        'ScheduleInput',
      ]),
    );
  });

  it('describes enrolment and the device routes, each with the right auth', () => {
    const parentRoutes: Array<[string, 'get' | 'post' | 'patch' | 'delete']> = [
      ['/v1/kids/{kidId}/enrolment-codes', 'post'],
      ['/v1/devices', 'get'],
      ['/v1/devices/{id}', 'patch'],
      ['/v1/devices/{id}', 'delete'],
    ];
    for (const [path, method] of parentRoutes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(doc.paths?.['/v1/enrol']?.post).toBeDefined();
    expect(doc.paths?.['/v1/enrol']?.post?.security).toBeUndefined();
    expect(doc.paths?.['/v1/device/me']?.get?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.components?.securitySchemes?.deviceAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'Device',
        'DeviceForm',
        'DeviceMe',
        'DevicePatch',
        'EnrolmentCode',
        'EnrolmentCodeCreate',
        'EnrolRequest',
        'EnrolResponse',
        'Platform',
        'Pool',
      ]),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.14 `contract/openapi.json` (generated)

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
      },
      "deviceAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "The opaque device token from POST /v1/enrol."
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
      "Kid": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "avatarColor": {
            "$ref": "#/components/schemas/AvatarColor"
          }
        },
        "required": [
          "id",
          "name",
          "avatarColor"
        ]
      },
      "AvatarColor": {
        "type": "string",
        "enum": [
          "#0F766E",
          "#7C3AED",
          "#DB2777",
          "#2563EB",
          "#EA580C",
          "#16A34A",
          "#CA8A04",
          "#475569"
        ]
      },
      "KidCreate": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "avatarColor": {
            "$ref": "#/components/schemas/AvatarColor"
          }
        },
        "required": [
          "name",
          "avatarColor"
        ]
      },
      "KidPatch": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "avatarColor": {
            "$ref": "#/components/schemas/AvatarColor"
          }
        }
      },
      "Schedule": {
        "type": "object",
        "properties": {
          "version": {
            "type": "integer"
          },
          "warn1Min": {
            "type": "integer"
          },
          "warn2Min": {
            "type": "integer"
          },
          "days": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ScheduleDay"
            }
          }
        },
        "required": [
          "version",
          "warn1Min",
          "warn2Min",
          "days"
        ]
      },
      "ScheduleDay": {
        "type": "object",
        "properties": {
          "weekday": {
            "type": "integer",
            "minimum": 1,
            "maximum": 7
          },
          "screensMin": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1440
          },
          "phoneMin": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1440
          },
          "wake": {
            "type": "string",
            "pattern": "^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"
          },
          "bedtime": {
            "type": "string",
            "pattern": "^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"
          }
        },
        "required": [
          "weekday",
          "screensMin",
          "phoneMin",
          "wake",
          "bedtime"
        ]
      },
      "ScheduleInput": {
        "type": "object",
        "properties": {
          "warn1Min": {
            "type": "integer",
            "minimum": 2,
            "maximum": 60
          },
          "warn2Min": {
            "type": "integer",
            "minimum": 1,
            "maximum": 59
          },
          "days": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ScheduleDay"
            }
          }
        },
        "required": [
          "warn1Min",
          "warn2Min",
          "days"
        ]
      },
      "KidContact": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "label": {
            "type": "string"
          },
          "phoneE164": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "label",
          "phoneE164"
        ]
      },
      "KidContactsPut": {
        "type": "object",
        "properties": {
          "contacts": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "label": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 40
                },
                "phoneE164": {
                  "type": "string",
                  "pattern": "^\\+[1-9][0-9]{6,14}$"
                }
              },
              "required": [
                "label",
                "phoneE164"
              ]
            },
            "maxItems": 10
          }
        },
        "required": [
          "contacts"
        ]
      },
      "EnrolmentCode": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^[0-9]{6}$"
          },
          "qrPayload": {
            "type": "string"
          },
          "expiresAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "code",
          "qrPayload",
          "expiresAt"
        ]
      },
      "EnrolmentCodeCreate": {
        "type": "object",
        "properties": {
          "form": {
            "$ref": "#/components/schemas/DeviceForm"
          }
        },
        "required": [
          "form"
        ]
      },
      "DeviceForm": {
        "type": "string",
        "enum": [
          "phone",
          "tablet",
          "pc"
        ]
      },
      "Device": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "kidId": {
            "type": "string",
            "format": "uuid"
          },
          "platform": {
            "$ref": "#/components/schemas/Platform"
          },
          "form": {
            "$ref": "#/components/schemas/DeviceForm"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "name": {
            "type": "string"
          },
          "hasCellular": {
            "type": "boolean"
          },
          "model": {
            "type": [
              "string",
              "null"
            ]
          },
          "osVersion": {
            "type": [
              "string",
              "null"
            ]
          },
          "appVersion": {
            "type": [
              "string",
              "null"
            ]
          },
          "windowsUserName": {
            "type": [
              "string",
              "null"
            ]
          },
          "enrolledAt": {
            "type": "string",
            "format": "date-time"
          },
          "lastSeenAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "kidId",
          "platform",
          "form",
          "pool",
          "name",
          "hasCellular",
          "model",
          "osVersion",
          "appVersion",
          "windowsUserName",
          "enrolledAt",
          "lastSeenAt"
        ]
      },
      "Platform": {
        "type": "string",
        "enum": [
          "android",
          "windows"
        ]
      },
      "Pool": {
        "type": "string",
        "enum": [
          "screens",
          "phone"
        ]
      },
      "DevicePatch": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          }
        }
      },
      "EnrolResponse": {
        "type": "object",
        "properties": {
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceToken": {
            "type": "string"
          },
          "kid": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "name"
            ]
          },
          "family": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "timezone": {
                "type": "string"
              }
            },
            "required": [
              "name",
              "timezone"
            ]
          }
        },
        "required": [
          "deviceId",
          "deviceToken",
          "kid",
          "family"
        ]
      },
      "EnrolRequest": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^[0-9]{6}$"
          },
          "platform": {
            "$ref": "#/components/schemas/Platform"
          },
          "hasCellular": {
            "type": "boolean"
          },
          "model": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "osVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "appVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "machineId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "windowsUserSid": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "windowsUserName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "code",
          "platform",
          "hasCellular",
          "model",
          "osVersion",
          "appVersion"
        ]
      },
      "DeviceMe": {
        "type": "object",
        "properties": {
          "device": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              },
              "form": {
                "$ref": "#/components/schemas/DeviceForm"
              },
              "pool": {
                "$ref": "#/components/schemas/Pool"
              },
              "hasCellular": {
                "type": "boolean"
              }
            },
            "required": [
              "id",
              "name",
              "form",
              "pool",
              "hasCellular"
            ]
          },
          "kid": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "name"
            ]
          },
          "family": {
            "type": "object",
            "properties": {
              "timezone": {
                "type": "string"
              },
              "emergencyNumber": {
                "type": "string"
              }
            },
            "required": [
              "timezone",
              "emergencyNumber"
            ]
          }
        },
        "required": [
          "device",
          "kid",
          "family"
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
    "/v1/kids": {
      "get": {
        "tags": [
          "kids"
        ],
        "summary": "Kids in the family",
        "description": "Archived kids are left out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The kids, oldest first.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Kid"
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
          "kids"
        ],
        "summary": "Add a kid",
        "description": "The kid starts with the default schedule (version 1) and no contacts.",
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
                "$ref": "#/components/schemas/KidCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The new kid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Kid"
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
    "/v1/kids/{kidId}": {
      "get": {
        "tags": [
          "kids"
        ],
        "summary": "One kid",
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
            "name": "kidId",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "The kid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Kid"
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
      "patch": {
        "tags": [
          "kids"
        ],
        "summary": "Change the name or colour of a kid",
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
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/KidPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The changed kid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Kid"
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
          "kids"
        ],
        "summary": "Archive a kid",
        "description": "The kid disappears from lists and their devices are revoked; their history stays.",
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
            "name": "kidId",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Archived."
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
    },
    "/v1/kids/{kidId}/schedule": {
      "get": {
        "tags": [
          "kids"
        ],
        "summary": "The current schedule of a kid",
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
            "name": "kidId",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "The highest schedule version.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Schedule"
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
      "put": {
        "tags": [
          "kids"
        ],
        "summary": "Save a new schedule version",
        "description": "Old versions are kept. Devices pick up the new one on their next sync.",
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
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ScheduleInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The new schedule.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Schedule"
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
    "/v1/kids/{kidId}/contacts": {
      "get": {
        "tags": [
          "kids"
        ],
        "summary": "The always-callable list of a kid",
        "description": "Parents with a phone number are always callable too; they are not in this list.",
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
            "name": "kidId",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "The contacts, in order.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/KidContact"
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
      "put": {
        "tags": [
          "kids"
        ],
        "summary": "Replace the whole contact list",
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
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/KidContactsPut"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The new contacts, in order.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/KidContact"
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
    },
    "/v1/kids/{kidId}/enrolment-codes": {
      "post": {
        "tags": [
          "devices"
        ],
        "summary": "Make a code to add a device for a kid",
        "description": "The code works once, for 10 minutes. Show it in large digits and as a QR code of `qrPayload`.",
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
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/EnrolmentCodeCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The code.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/EnrolmentCode"
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
      }
    },
    "/v1/devices": {
      "get": {
        "tags": [
          "devices"
        ],
        "summary": "Devices in the family",
        "description": "Revoked devices are left out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The devices, oldest first.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Device"
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
      }
    },
    "/v1/devices/{id}": {
      "patch": {
        "tags": [
          "devices"
        ],
        "summary": "Rename a device or move it to another pool",
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
                "$ref": "#/components/schemas/DevicePatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The changed device.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Device"
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
          "devices"
        ],
        "summary": "Revoke a device",
        "description": "Its token stops working at once. Its history stays.",
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
            "description": "Revoked."
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
    },
    "/v1/enrol": {
      "post": {
        "tags": [
          "devices"
        ],
        "summary": "Enrol a kid device with a code",
        "description": "Called by the kid device. No sign-in: the code is the proof.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/EnrolRequest"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Enrolled. Keep the device token safe; it is not shown again.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/EnrolResponse"
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
    "/v1/device/me": {
      "get": {
        "tags": [
          "device"
        ],
        "summary": "The calling device, its kid and family",
        "description": "A 401 means the device was revoked and must be enrolled again.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "This device.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DeviceMe"
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

### 6.1 Two kinds of caller

- **Parent routes** (6.2, 6.3) need a parent's Bearer access token, exactly like the family routes: 401 without a valid token, 403 for a super admin who is not a parent. OpenAPI security `bearerAuth`.
- **Device routes** (6.5) need a Bearer device token. Missing, unknown or revoked token, archived kid or disabled family: 401 `This device is not enrolled.` OpenAPI security `deviceAuth`. A parent's access token is not a device token (401).
- **`POST /v1/enrol`** (6.4) needs no token. The code is the proof.

### 6.2 `POST /v1/kids/{kidId}/enrolment-codes` (parent)

| Request | Answer | Errors |
|---|---|---|
| `{ form }`: `phone`, `tablet` or `pc` | 201 `{ code, qrPayload, expiresAt }`. `code` is 6 digits (leading zeros allowed), not shared with any other unused, unexpired code. `expiresAt` is 10 minutes from now. `qrPayload` is `screentime://enrol?host=<host>&code=<code>`, where `<host>` is the request's `Host` header, URL-encoded (`localhost:8080` becomes `localhost%3A8080`). | 404 `No such kid in your family.`, 422 |

### 6.3 Devices (parent)

| Operation | Request | Answer | Errors |
|---|---|---|---|
| `GET /v1/devices` | | 200 list of `Device`, oldest first; revoked devices are left out | |
| `PATCH /v1/devices/{id}` | `DevicePatch`: any of `name` (trimmed, 1 to 40), `pool` (`screens` or `phone`). An empty object changes nothing. | 200 `Device` | 404 `No such device in your family.` (also revoked ones), 422 |
| `DELETE /v1/devices/{id}` | | 204. Sets `revoked_at` and clears `fcm_token`. The token stops working at once. | 404, 422 |

Archiving a kid (`DELETE /v1/kids/{kidId}`) also revokes every device of that kid.

### 6.4 `POST /v1/enrol` (kid device, no token)

Request `EnrolRequest`: `code`, `platform`, `hasCellular`, `model`, `osVersion`, `appVersion`, and on Windows also `machineId`, `windowsUserSid`, `windowsUserName`.

1. Rate limit: 10 calls per IP per 15 minutes, counting every call. The 11th is 429 `Too many enrolment attempts. Try again later.`
2. Find the newest code with that value that is unused, unexpired, for a kid that is not archived, in a family that is not disabled. None: 401 `That code is wrong or has expired. Ask a parent for a new one.`
3. The code's form must fit the platform: `phone` and `tablet` need `android`, `pc` needs `windows`. Otherwise 409 `This code is for an Android phone.` / `an Android tablet.` / `a Windows PC.` The code stays usable.
4. Windows only: revoke any active device in the family with the same `machineId` and `windowsUserSid` (installing again replaces the old row).
5. Create the device: `form` from the code, `pool` `phone` for a phone and `screens` otherwise, `name` = `model` (Windows: `<windowsUserName> on <model>`), cut to 40 characters, `last_seen_at` now, `token_hash` = SHA-256 of the new token.
6. Mark the code used (`consumed_at`, `device_id`).
7. Write an `events` row: `kind` `device.enrolled`, the kid and device, `payload` `{ name, form, platform }`.
8. Answer 201 `{ deviceId, deviceToken, kid: { id, name }, family: { name, timezone } }`.

Steps 2 to 7 run in one transaction.

### 6.5 `GET /v1/device/me` (device token)

200 `{ device: { id, name, form, pool, hasCellular }, kid: { id, name }, family: { timezone, emergencyNumber } }`. Every successful device call updates `last_seen_at`.

### 6.6 OpenAPI

New security scheme `deviceAuth` (HTTP bearer). New named schemas: `Device`, `DeviceForm`, `DeviceMe`, `DevicePatch`, `EnrolmentCode`, `EnrolmentCodeCreate`, `EnrolRequest`, `EnrolResponse`, `Platform`, `Pool`. `POST /v1/enrol` has no `security`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-013-device-enrolment
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-013-device-enrolment.md` must exist after the pull. If it does not, you did not pull: run `git fetch origin` and `git pull origin main` again.
3. Create 5.1 to 5.3. Run `pnpm --filter @screentime/schemas test` (`Tests  18 passed (18)`). Commit: `CARD-013: add device schemas`.
4. Create or replace 5.4 to 5.11. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-013: add enrolment and device routes`.
5. Create or replace the tests 5.12 and 5.13. Commit: `CARD-013: add device tests`.
6. Run `pnpm contract` (5.14) and compare. Commit: `CARD-013: regenerate the API contract`.
7. Run the acceptance checks in section 8.
8. Push and open the PR (section 10).
9. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
10. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  18 passed (18)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/admin.test.ts (8 tests | 8 skipped)`, `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/devices.test.ts (12 tests | 12 skipped)`, `test/family.test.ts (17 tests | 17 skipped)`, `test/kids.test.ts (10 tests | 10 skipped)`, `test/config.test.ts (7 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (6 tests)`, `test/health.test.ts (2 tests)`, so `Tests  29 passed | 74 skipped (103)`.
- [ ] `contract/openapi.json` matches 5.14 exactly. Running `pnpm contract` again leaves `git status --short contract` empty. `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate`.
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
  Output: `test/devices.test.ts (12 tests)`, `test/kids.test.ts (10 tests)` and `Tests  103 passed (103)`.
- [ ] Enrolment works on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
  ```powershell
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
  Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/request -ContentType 'application/json' -Body '{"email":"admin@example.com"}'
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "sign-in code for admin"
  ```
  Put the 6 digits from the last log line in place of `123456`, then create a family:
  ```powershell
  $a = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"admin@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ah = @{ Authorization = "Bearer $($a.accessToken)" }
  Invoke-RestMethod -Method Post http://localhost:8080/v1/admin/families -Headers $ah -ContentType 'application/json' -Body '{"name":"Test family","timezone":"Australia/Sydney","firstParent":{"email":"parent@example.com","displayName":"Dad"}}' | Out-Null
  Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/request -ContentType 'application/json' -Body '{"email":"parent@example.com"}'
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "sign-in code for parent"
  ```
  Put those 6 digits in place of `123456`, then add a kid, make a code, enrol a "phone" with it, and check the device:
  ```powershell
  $p = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"parent@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ph = @{ Authorization = "Bearer $($p.accessToken)" }
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  $c = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/enrolment-codes" -Headers $ph -ContentType 'application/json' -Body '{"form":"phone"}'
  $c.qrPayload -replace '[0-9]{6}$', 'NNNNNN'
  $e = Invoke-RestMethod -Method Post http://localhost:8080/v1/enrol -ContentType 'application/json' -Body "{`"code`":`"$($c.code)`",`"platform`":`"android`",`"hasCellular`":true,`"model`":`"Pixel 7`",`"osVersion`":`"Android 14`",`"appVersion`":`"0.1.0`"}"
  $dh = @{ Authorization = "Bearer $($e.deviceToken)" }
  $m = Invoke-RestMethod http://localhost:8080/v1/device/me -Headers $dh
  "$($m.device.name) $($m.device.pool) $($m.kid.name)"
  Invoke-RestMethod http://localhost:8080/v1/devices -Headers $ph | ForEach-Object { "$($_.name): $($_.form)" }
  Invoke-RestMethod -Method Delete "http://localhost:8080/v1/devices/$($e.deviceId)" -Headers $ph
  try { Invoke-RestMethod http://localhost:8080/v1/device/me -Headers $dh } catch { $_.Exception.Response.StatusCode.value__ }
  ```
  The four outputs are `screentime://enrol?host=localhost%3A8080&code=NNNNNN`, `Pixel 7 phone Alex`, `Pixel 7: phone` and `401`. (The `-replace` hides the code so the line is always the same. Do not paste the device token anywhere.)
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 14 files (in any order):
  ```
  contract/openapi.json
  packages/schemas/src/devices.ts
  packages/schemas/src/index.ts
  packages/schemas/test/devices.test.ts
  server/src/app.ts
  server/src/auth/client-ip.ts
  server/src/auth/routes.ts
  server/src/devices/auth.ts
  server/src/devices/routes.ts
  server/src/devices/token.ts
  server/src/kids/routes.ts
  server/src/openapi.ts
  server/test/devices.test.ts
  server/test/openapi.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/devices.test.ts` | The enrolment code is exactly 6 digits; the Windows account fields are required on Windows only; device names are trimmed and the pool is `screens` or `phone`. |
| `server/test/devices.test.ts` | Against a real database: a code is 6 digits with the right QR payload and expires in 10 minutes; codes need a parent, a known form and a kid of the caller's family; enrolling a phone returns a 43-character token, the kid and family, marks the code used, writes a `device.enrolled` event and lists the device for that family only; a used or expired code is 401; a PC code on Android is 409 and still works for Windows (name `alex on Dell XPS 13`, pool `screens`); the same PC account enrolling again replaces the old device; the 11th enrol call from one IP is 429; `GET /v1/device/me` answers for a device token and refuses none, garbage and a parent token; rename and pool change work, not for another family; revoking stops the token at once; archiving a kid revokes their devices; a disabled family's devices are refused. |
| `server/test/openapi.test.ts` | As before, plus: the parent device routes use `bearerAuth`, `/v1/device/me` uses `deviceAuth`, `/v1/enrol` has no security, and the 10 new schemas are named; the committed file is up to date. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 6). Message format: `CARD-013: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-013-device-enrolment`
5. Open a PR into `main` titled `CARD-013: Device enrolment`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-013-device-enrolment --title "CARD-013: Device enrolment" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-013-device-enrolment.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] openapi.json matches the card; pnpm contract is stable; db:generate finds no changes
   - [x] database tests — output: `Tests  103 passed (103)`
   - [x] enrolment on the real stack — output: `screentime://enrol?host=localhost%3A8080&code=NNNNNN`, `Pixel 7 phone Alex`, `Pixel 7: phone`, `401`
   - [x] deploy/.env not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 14 files

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

- **`Module '"@screentime/schemas"' has no exported member 'Device'`** in the server: run `pnpm build` (the server uses the built schemas package), and check that 5.2 matches the card.
- **`openapi.test.ts` fails with a diff**: run `pnpm contract`. If the new file still differs from 5.14, one of 5.1, 5.2, 5.6, 5.9, 5.10 or 5.11 does not match the card. Do not edit `openapi.json` by hand.
- **`devices.test.ts` fails with 429** where it expected 401 or 201: `beforeEach` in 5.12 must make a new app. Do not raise the limit.
- **TypeScript complains about a test name** (`',' expected`): an apostrophe inside a single-quoted string. Copy the line again from the card; those names use double quotes.
- **Different test data**: do not change values in the tests (names, numbers, codes), even when another value would also pass. The card's values are what Claude checks against. If you think one is wrong, say so under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-013. Please review and merge if it is good.

CARD: CARD-013 Device enrolment
PR: <full PR URL>
Branch: bob/card-013-device-enrolment
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
