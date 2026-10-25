# CARD-022: Web app skeleton and sign-in

| Field | Value |
|---|---|
| Card | CARD-022 |
| Title | Web app skeleton and sign-in |
| Size | M |
| Depends on | CARD-021 (merged to `main`) |
| Spec sections | docs/SPEC.md §11.1, §16.1, §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-022-web-skeleton` |
| PR title | `CARD-022: Web app skeleton and sign-in` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. Parents sign in with an emailed 6-digit code (`POST /v1/auth/otp/request`, then `POST /v1/auth/otp/verify`) and get an access token (15 minutes) and a refresh token (90 days, rotated by `POST /v1/auth/refresh`). Request and response shapes are Zod schemas in `packages/schemas`; `contract/openapi.json` is generated from them with `pnpm contract` and committed.

This card starts the **parent web app** in `web/` (package `@screentime/web`). It is a single-page app: React 19, Vite, TanStack Router and Query, Tailwind CSS v4 and shadcn/ui-style components. In development Vite serves it on http://localhost:5173 and passes `/v1/*` and `/health` to the API on http://localhost:8080, so the browser only ever talks to one origin. (In production the server will serve the built files itself: CARD-027.)

**Already on `main` (Claude added it with this card):** `web` in `pnpm-workspace.yaml`, a `web/package.json` with the dependencies but no scripts yet, and the matching `pnpm-lock.yaml`. You only run `pnpm install --frozen-lockfile` after pulling. You replace `web/package.json` with the version in 5.7, which adds the scripts; the dependencies stay the same, so the lockfile does not change.

Two parts:

1. **Server: the web app's refresh token goes in a cookie** (SPEC §11.1 item 4). Page scripts must never see the refresh token. When `client` is `web`, sign-in and refresh put it in an `st_refresh` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/v1/auth`, 90 days) and leave it out of the JSON body. Refresh takes `{}` and reads the cookie. Sign out clears the cookie. Android is unchanged.
2. **Web: the skeleton.** Design tokens (light and dark follow the operating system), the Inter font, the components later cards build on, a small API client (access token in memory, one refresh on a 401), sign-in (email, then six code boxes), and the layout shell (sidebar from 1024 px, top bar with a menu sheet below) with placeholder pages for Today, Inbox, Kids, Settings and Admin. Later cards (023 to 026) fill the pages in.

## 2. Goal

`pnpm dev:web` serves a web app where a parent or the super admin signs in with an emailed code, stays signed in across reloads through the HttpOnly cookie, moves between the placeholder pages in the layout of SPEC §16.5, and signs out. Server and web logic are covered by tests.

## 3. Out of scope

Do **not** do any of these in this card:

- No real page content: Today, Inbox, Kids, Settings and Admin are placeholders ("Coming soon"). No SOS banner, no event polling.
- No serving of the web build by the server, no Dockerfile change (CARD-027).
- No browser end-to-end tests and no jsdom: the web tests are plain Vitest tests of the logic in `web/src/lib`.
- No new npm packages and no lockfile change: they are already on `main`. `pnpm-lock.yaml` and `pnpm-workspace.yaml` stay unchanged. Do not run the shadcn CLI (`npx shadcn ...`): the components are in section 5.
- No database migration. Do not change `server/src/db/` or anything in `server/drizzle/`.
- Do not change any file that is not listed in section 5. `docs/SPEC.md`, `docs/BUILD-PLAN.md`, `AGENTS.md` and `web/README.md` were already updated by Claude.
- Never commit `deploy/.env`, `web/dist/`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, hono ^4.13.13 (its `hono/cookie` helpers set and read the cookie), PostgreSQL 18. New to the code, all already in the lockfile on `main`:

| Package | Version | Used for |
|---|---|---|
| `react`, `react-dom` | ^19.3.1 | UI |
| `vite` | ^7.3.7 | dev server and build |
| `@vitejs/plugin-react` | ^5.2.0 | JSX and fast refresh |
| `tailwindcss`, `@tailwindcss/vite` | ^4.3.3 | styling; tokens live in `web/src/index.css` (no `tailwind.config.js` in v4) |
| `@tanstack/react-router` | ^1.170.46 | routes, defined in code in `web/src/router.tsx` (no route generator) |
| `@tanstack/react-query` | ^5.104.5 | data fetching in later cards; the provider is set up now |
| `radix-ui` | ^1.8.1 | `Slot` (button `asChild`) and `Dialog` (the menu sheet) |
| `input-otp` | ^1.5.0 | the six code boxes |
| `class-variance-authority`, `clsx`, `tailwind-merge` | ^0.7.1, ^2.1.1, ^3.7.0 | component class names (`cn`) |
| `lucide-react` | ^1.61.0 | icons (SPEC §16.1) |
| `@fontsource-variable/inter` | ^5.3.0 | the Inter font, self-hosted |

The web app imports only **types** from `@screentime/schemas` (`import type`), so no Zod code ends up in the browser. Imports inside `web/src` use the `@/` alias for `web/src/` (set in `web/tsconfig.json` and `web/vite.config.ts`) and have no file extension: this differs from the `.js` rule in `AGENTS.md`, which is for the Node packages.

Docker Desktop must be running for the database tests and the real-stack check (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Some strings contain an apostrophe inside double quotes (for example `"Can't reach ScreenTime..."`) or inside JSX text (`We'll email you`): keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/auth.ts` | replace (5.1) |
| `packages/schemas/test/auth.test.ts` | replace (5.2) |
| `server/src/auth/routes.ts` | replace (5.3) |
| `server/test/auth.test.ts` | replace (5.4) |
| `contract/openapi.json` | replace (5.5) |
| `package.json` | replace (5.6) |
| `web/package.json` | replace (5.7) |
| `web/tsconfig.json` | create (5.8) |
| `web/vite.config.ts` | create (5.9) |
| `web/index.html` | create (5.10) |
| `web/components.json` | create (5.11) |
| `web/public/favicon.svg` | create (5.12) |
| `web/src/index.css` | create (5.13) |
| `web/src/main.tsx` | create (5.14) |
| `web/src/router.tsx` | create (5.15) |
| `web/src/lib/utils.ts` | create (5.16) |
| `web/src/lib/format.ts` | create (5.17) |
| `web/src/lib/api.ts` | create (5.18) |
| `web/src/lib/auth.tsx` | create (5.19) |
| `web/src/components/ui/button.tsx` | create (5.20) |
| `web/src/components/ui/input.tsx` | create (5.21) |
| `web/src/components/ui/label.tsx` | create (5.22) |
| `web/src/components/ui/card.tsx` | create (5.23) |
| `web/src/components/ui/sheet.tsx` | create (5.24) |
| `web/src/components/ui/input-otp.tsx` | create (5.25) |
| `web/src/components/brand.tsx` | create (5.26) |
| `web/src/components/page-header.tsx` | create (5.27) |
| `web/src/components/app-shell.tsx` | create (5.28) |
| `web/src/pages/sign-in.tsx` | create (5.29) |
| `web/src/pages/coming-soon.tsx` | create (5.30) |
| `web/src/pages/not-found.tsx` | create (5.31) |
| `web/test/format.test.ts` | create (5.32) |
| `web/test/api.test.ts` | create (5.33) |

That is 33 files.

### 5.1 `packages/schemas/src/auth.ts`

The same as before, except `RefreshRequest.refreshToken` and `AuthResponse.refreshToken` are now optional, with comments saying why.

```typescript
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

/** Body of POST /v1/auth/refresh. The web app sends `{}`: its refresh token is in the `st_refresh` cookie. */
export const RefreshRequest = z
  .object({
    refreshToken: z.string().min(1).max(200).optional(),
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
    /** Android only. A web session gets it in the `st_refresh` cookie instead (HttpOnly, docs/SPEC.md §11.1). */
    refreshToken: z.string().optional(),
    /** Seconds until the access token expires. */
    expiresIn: z.number().int().positive(),
    me: Me,
  })
  .meta({ id: 'AuthResponse' });

export type AuthResponse = z.infer<typeof AuthResponse>;
```

### 5.2 `packages/schemas/test/auth.test.ts`

The same as before plus one test at the end.

```typescript
import { describe, expect, it } from 'vitest';
import { AuthResponse, OtpRequest, OtpVerifyRequest, RefreshRequest } from '../src/index.js';

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

  it('lets the web app leave out the refresh token: it travels in a cookie', () => {
    expect(RefreshRequest.safeParse({}).success).toBe(true);
    expect(RefreshRequest.safeParse({ refreshToken: 'abc' }).success).toBe(true);
    expect(RefreshRequest.safeParse({ refreshToken: '' }).success).toBe(false);
    const me = { parent: null, family: null, roles: ['superadmin'] };
    expect(AuthResponse.safeParse({ accessToken: 'a', expiresIn: 900, me }).success).toBe(true);
    expect(AuthResponse.safeParse({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, me }).success).toBe(true);
  });
});
```

### 5.3 `server/src/auth/routes.ts`

The same as before, except: imports from `hono` and `hono/cookie`, four cookie constants and the `Client` type, longer descriptions on the refresh and logout routes, `issueTokens` takes the request context and the client and sets the cookie for `web`, refresh reads the token from the body or the cookie, and logout deletes the cookie.

```typescript
import { createRoute } from '@hono/zod-openapi';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
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
/** Web sessions keep the refresh token in this cookie, out of reach of page scripts (docs/SPEC.md §11.1). */
const REFRESH_COOKIE = 'st_refresh';
const REFRESH_COOKIE_PATH = '/v1/auth';
const REFRESH_COOKIE_MAX_AGE_SEC = 90 * 24 * 60 * 60;
type Client = 'web' | 'android';

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
  description:
    'The refresh token rotates: the old one stops working. The web app sends `{}` and its `st_refresh` cookie instead of the token.',
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
  description: 'Also clears the `st_refresh` cookie of the web app.',
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

  /** Android gets the refresh token in the body; the web app gets it as an HttpOnly cookie and never sees it. */
  async function issueTokens(c: Context, client: Client, sessionId: string, refreshToken: string, user: SignInUser) {
    const auth: ParentAuth = { sessionId, parentId: user.parentId, familyId: user.familyId, roles: user.roles };
    const accessToken = await signAccessToken(config.jwtSecret, auth);
    if (client === 'android') return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SEC, me: user.me };
    setCookie(c, REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE_SEC,
    });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SEC, me: user.me };
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
    return c.json(await issueTokens(c, body.client, session.id, refreshToken, user), 200);
  });

  app.openapi(refreshRoute, async (c) => {
    const token = c.req.valid('json').refreshToken ?? getCookie(c, REFRESH_COOKIE);
    if (!token) throw signInAgain();
    const oldHash = hashRefreshToken(token);
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
    return c.json(await issueTokens(c, session.client as Client, session.id, refreshToken, user), 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const auth = await requireParent(c, config.jwtSecret);
    await db
      .update(parentSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(parentSessions.id, auth.sessionId), isNull(parentSessions.revokedAt)));
    deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, secure: true });
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

### 5.4 `server/test/auth.test.ts`

The same as before plus one test, before `refuses a refresh token after 90 days without use`. The regular expressions contain `\/`: copy them exactly.

```typescript
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

  it('keeps the refresh token of a web session in an HttpOnly cookie, rotated on refresh and cleared on logout', async () => {
    const refreshWith = (cookie: string | null) =>
      app.request('/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: '{}',
      });
    const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const code = await requestCode('mum@example.com');
    const res = await post('/v1/auth/otp/verify', { email: 'mum@example.com', code, client: 'web', clientLabel: 'Browser' });
    expect(res.status).toBe(200);
    const auth = AuthResponse.parse(await res.json());
    expect(auth.refreshToken).toBeUndefined();
    expect(auth.me.parent?.email).toBe('mum@example.com');
    expect(res.headers.get('set-cookie')).toMatch(
      /^st_refresh=[A-Za-z0-9_-]{43}; Max-Age=7776000; Path=\/v1\/auth; HttpOnly; Secure; SameSite=Strict$/,
    );
    const first = cookieOf(res);

    const again = await refreshWith(first);
    expect(again.status).toBe(200);
    const renewed = AuthResponse.parse(await again.json());
    expect(renewed.refreshToken).toBeUndefined();
    expect(renewed.me).toEqual(auth.me);
    const second = cookieOf(again);
    expect(second).toMatch(/^st_refresh=[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);

    expect((await refreshWith(first)).status).toBe(401);
    expect((await refreshWith(null)).status).toBe(401);

    const out = await app.request('/v1/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${renewed.accessToken}` },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/^st_refresh=; Max-Age=0; Path=\/v1\/auth; Secure/);
    expect((await refreshWith(second)).status).toBe(401);
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

### 5.5 `contract/openapi.json`

Generated by `pnpm contract` from 5.1 and 5.3. After you copy 5.1 and 5.3, `pnpm contract` must produce exactly this file; if it does not, one of them differs from the card. The changes: `refreshToken` is no longer required in `AuthResponse` and `RefreshRequest`, and the refresh and logout routes have new descriptions.

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
        }
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
      "DeviceState": {
        "type": "object",
        "properties": {
          "serverTime": {
            "type": "string",
            "format": "date-time"
          },
          "stateVersion": {
            "type": "string"
          },
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
              },
              "parentCodeSecret": {
                "type": "string"
              }
            },
            "required": [
              "timezone",
              "emergencyNumber",
              "parentCodeSecret"
            ]
          },
          "parents": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
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
                "displayName",
                "phoneE164"
              ]
            }
          },
          "contacts": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "label": {
                  "type": "string"
                },
                "phoneE164": {
                  "type": "string"
                }
              },
              "required": [
                "label",
                "phoneE164"
              ]
            }
          },
          "messagePresets": {
            "type": "array",
            "items": {
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
            }
          },
          "schedule": {
            "$ref": "#/components/schemas/Schedule"
          },
          "today": {
            "type": "object",
            "properties": {
              "date": {
                "type": "string"
              },
              "grants": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/StateGrant"
                }
              },
              "poolSegments": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/PoolSegment"
                }
              }
            },
            "required": [
              "date",
              "grants",
              "poolSegments"
            ]
          },
          "parentMode": {
            "type": "object",
            "properties": {
              "active": {
                "type": "boolean"
              },
              "endsAt": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date-time"
              },
              "byName": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "active",
              "endsAt",
              "byName"
            ]
          },
          "pendingRequest": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "minutes": {
                "type": "integer"
              },
              "createdAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "id",
              "minutes",
              "createdAt"
            ]
          },
          "activeSos": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "startedAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "id",
              "startedAt"
            ]
          }
        },
        "required": [
          "serverTime",
          "stateVersion",
          "device",
          "kid",
          "family",
          "parents",
          "contacts",
          "messagePresets",
          "schedule",
          "today",
          "parentMode",
          "pendingRequest",
          "activeSos"
        ]
      },
      "StateGrant": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "minutes": {
            "type": "integer"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "byName": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "minutes",
          "createdAt",
          "byName"
        ]
      },
      "PoolSegment": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "deviceId",
          "startedAt",
          "endedAt"
        ]
      },
      "UsageReceipt": {
        "type": "object",
        "properties": {
          "received": {
            "type": "integer"
          }
        },
        "required": [
          "received"
        ]
      },
      "UsageUpload": {
        "type": "object",
        "properties": {
          "segments": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/UsageSegmentIn"
            },
            "minItems": 1,
            "maxItems": 500
          }
        },
        "required": [
          "segments"
        ]
      },
      "UsageSegmentIn": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "recordedOffline": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "startedAt",
          "endedAt",
          "recordedOffline"
        ]
      },
      "Today": {
        "type": "object",
        "properties": {
          "serverTime": {
            "type": "string",
            "format": "date-time"
          },
          "date": {
            "type": "string"
          },
          "kids": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TodayKid"
            }
          }
        },
        "required": [
          "serverTime",
          "date",
          "kids"
        ]
      },
      "TodayKid": {
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
          },
          "pools": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TodayPool"
            }
          }
        },
        "required": [
          "id",
          "name",
          "avatarColor",
          "pools"
        ]
      },
      "TodayPool": {
        "type": "object",
        "properties": {
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "allowanceMin": {
            "type": "integer"
          },
          "grantedMin": {
            "type": "integer"
          },
          "usedSec": {
            "type": "integer"
          },
          "remainingSec": {
            "type": "integer"
          },
          "locked": {
            "type": "boolean"
          },
          "lockReason": {
            "$ref": "#/components/schemas/LockReason"
          },
          "nextLockAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "overspendSec": {
            "type": "integer"
          },
          "devices": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TodayDevice"
            }
          }
        },
        "required": [
          "pool",
          "allowanceMin",
          "grantedMin",
          "usedSec",
          "remainingSec",
          "locked",
          "lockReason",
          "nextLockAt",
          "overspendSec",
          "devices"
        ]
      },
      "LockReason": {
        "type": [
          "string",
          "null"
        ],
        "enum": [
          "out_of_time",
          "bedtime",
          "before_wake",
          null
        ]
      },
      "TodayDevice": {
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
          "inUse": {
            "type": "boolean"
          },
          "lastSeenAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "parentMode": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "endsAt": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date-time"
              },
              "byName": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "endsAt",
              "byName"
            ]
          }
        },
        "required": [
          "id",
          "name",
          "form",
          "inUse",
          "lastSeenAt",
          "parentMode"
        ]
      },
      "Grant": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "minutes": {
            "type": "integer"
          },
          "day": {
            "$ref": "#/components/schemas/LocalDate"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "byName": {
            "type": "string"
          },
          "note": {
            "type": [
              "string",
              "null"
            ]
          },
          "requestId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          }
        },
        "required": [
          "id",
          "pool",
          "minutes",
          "day",
          "createdAt",
          "byName",
          "note",
          "requestId"
        ]
      },
      "LocalDate": {
        "type": "string",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
      },
      "GrantCreate": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "minutes": {
            "type": "integer",
            "minimum": -1440,
            "maximum": 1440
          },
          "note": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1,
            "maxLength": 160
          }
        },
        "required": [
          "id",
          "pool",
          "minutes"
        ]
      },
      "LockNow": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          }
        },
        "required": [
          "id",
          "pool"
        ]
      },
      "TimeRequest": {
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
          "kidName": {
            "type": "string"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceName": {
            "type": "string"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "minutes": {
            "type": "integer"
          },
          "reason": {
            "type": [
              "string",
              "null"
            ]
          },
          "status": {
            "$ref": "#/components/schemas/TimeRequestStatus"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "resolvedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "resolvedByName": {
            "type": [
              "string",
              "null"
            ]
          },
          "grantId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "grantedMinutes": {
            "type": [
              "integer",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "pool",
          "minutes",
          "reason",
          "status",
          "createdAt",
          "resolvedAt",
          "resolvedByName",
          "grantId",
          "grantedMinutes"
        ]
      },
      "TimeRequestStatus": {
        "type": "string",
        "enum": [
          "pending",
          "approved",
          "denied",
          "expired"
        ]
      },
      "TimeRequestCreate": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "minutes": {
            "anyOf": [
              {
                "type": "number",
                "enum": [
                  15
                ]
              },
              {
                "type": "number",
                "enum": [
                  30
                ]
              },
              {
                "type": "number",
                "enum": [
                  60
                ]
              }
            ]
          },
          "reason": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1,
            "maxLength": 160
          }
        },
        "required": [
          "id",
          "minutes"
        ]
      },
      "TimeRequestApprove": {
        "type": "object",
        "properties": {
          "minutes": {
            "type": "integer",
            "minimum": 15,
            "maximum": 1440
          }
        }
      },
      "KidMessage": {
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
          "kidName": {
            "type": "string"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceName": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "presetId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "body",
          "presetId",
          "createdAt"
        ]
      },
      "KidMessageCreate": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "body": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "presetId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          }
        },
        "required": [
          "id",
          "body"
        ]
      },
      "MessagePage": {
        "type": "object",
        "properties": {
          "messages": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/KidMessage"
            }
          },
          "nextBefore": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          }
        },
        "required": [
          "messages",
          "nextBefore"
        ]
      },
      "ParentModeSession": {
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
          "kidName": {
            "type": "string"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceName": {
            "type": "string"
          },
          "method": {
            "type": "string",
            "enum": [
              "push",
              "code",
              "remote"
            ]
          },
          "status": {
            "$ref": "#/components/schemas/ParentModeStatus"
          },
          "requestedAt": {
            "type": "string",
            "format": "date-time"
          },
          "startedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "endsAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "durationMin": {
            "$ref": "#/components/schemas/ParentModeDuration"
          },
          "approvedByName": {
            "type": [
              "string",
              "null"
            ]
          },
          "endedByName": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "method",
          "status",
          "requestedAt",
          "startedAt",
          "endsAt",
          "endedAt",
          "durationMin",
          "approvedByName",
          "endedByName"
        ]
      },
      "ParentModeStatus": {
        "type": "string",
        "enum": [
          "pending",
          "active",
          "ended",
          "denied",
          "expired"
        ]
      },
      "ParentModeDuration": {
        "anyOf": [
          {
            "type": "number",
            "enum": [
              2
            ]
          },
          {
            "type": "number",
            "enum": [
              5
            ]
          },
          {
            "type": "number",
            "enum": [
              15
            ]
          },
          {
            "type": "number",
            "enum": [
              60
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "ParentModeRequestCreate": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "id"
        ]
      },
      "ParentModeByCode": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "durationMin": {
            "$ref": "#/components/schemas/ParentModeDuration"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "durationMin",
          "startedAt"
        ]
      },
      "ParentModeStart": {
        "type": "object",
        "properties": {
          "durationMin": {
            "$ref": "#/components/schemas/ParentModeDuration"
          }
        },
        "required": [
          "durationMin"
        ]
      },
      "DeviceEventUpload": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/DeviceEventIn"
            },
            "minItems": 1,
            "maxItems": 50
          }
        },
        "required": [
          "events"
        ]
      },
      "DeviceEventIn": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "kind": {
            "$ref": "#/components/schemas/DeviceEventKind"
          },
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "payload": {
            "type": "object",
            "additionalProperties": {
              "anyOf": [
                {
                  "type": "string",
                  "maxLength": 200
                },
                {
                  "type": "number"
                },
                {
                  "type": "boolean"
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "required": [
          "id",
          "kind",
          "at"
        ]
      },
      "DeviceEventKind": {
        "type": "string",
        "enum": [
          "tamper.clock",
          "tamper.timezone",
          "tamper.tray_killed",
          "tamper.policy",
          "tamper.call_blocked"
        ]
      },
      "Sos": {
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
          "kidName": {
            "type": "string"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceName": {
            "type": "string"
          },
          "status": {
            "$ref": "#/components/schemas/SosStatus"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "autoStopAt": {
            "type": "string",
            "format": "date-time"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "endedBy": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "kid",
              "parent",
              "auto",
              null
            ]
          },
          "endedByName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastLocation": {
            "$ref": "#/components/schemas/SosLocation"
          },
          "acks": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SosAck"
            }
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "status",
          "startedAt",
          "autoStopAt",
          "endedAt",
          "endedBy",
          "endedByName",
          "lastLocation",
          "acks"
        ]
      },
      "SosStatus": {
        "type": "string",
        "enum": [
          "active",
          "ended"
        ]
      },
      "SosLocation": {
        "type": [
          "object",
          "null"
        ],
        "properties": {
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "lat": {
            "type": "number"
          },
          "lng": {
            "type": "number"
          },
          "accuracyM": {
            "type": [
              "number",
              "null"
            ]
          },
          "batteryPct": {
            "type": [
              "integer",
              "null"
            ]
          },
          "via": {
            "type": "string",
            "enum": [
              "data",
              "sms"
            ]
          }
        },
        "required": [
          "at",
          "lat",
          "lng",
          "accuracyM",
          "batteryPct",
          "via"
        ]
      },
      "SosAck": {
        "type": "object",
        "properties": {
          "parentId": {
            "type": "string",
            "format": "uuid"
          },
          "byName": {
            "type": "string"
          },
          "at": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "parentId",
          "byName",
          "at"
        ]
      },
      "SosStart": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "location": {
            "$ref": "#/components/schemas/SosLocationIn"
          }
        },
        "required": [
          "id",
          "startedAt"
        ]
      },
      "SosLocationIn": {
        "type": [
          "object",
          "null"
        ],
        "properties": {
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "lat": {
            "type": "number",
            "minimum": -90,
            "maximum": 90
          },
          "lng": {
            "type": "number",
            "minimum": -180,
            "maximum": 180
          },
          "accuracyM": {
            "type": [
              "number",
              "null"
            ],
            "minimum": 0,
            "maximum": 100000
          },
          "batteryPct": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 100
          },
          "via": {
            "type": "string",
            "enum": [
              "data",
              "sms"
            ]
          }
        },
        "required": [
          "at",
          "lat",
          "lng",
          "via"
        ]
      },
      "SosLocationsUpload": {
        "type": "object",
        "properties": {
          "locations": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SosLocationIn"
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "required": [
          "locations"
        ]
      },
      "SosDetail": {
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
          "kidName": {
            "type": "string"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceName": {
            "type": "string"
          },
          "status": {
            "$ref": "#/components/schemas/SosStatus"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "autoStopAt": {
            "type": "string",
            "format": "date-time"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "endedBy": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "kid",
              "parent",
              "auto",
              null
            ]
          },
          "endedByName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastLocation": {
            "$ref": "#/components/schemas/SosLocation"
          },
          "acks": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SosAck"
            }
          },
          "locations": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SosLocation"
            }
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "status",
          "startedAt",
          "autoStopAt",
          "endedAt",
          "endedBy",
          "endedByName",
          "lastLocation",
          "acks",
          "locations"
        ]
      },
      "PushTokenPut": {
        "type": "object",
        "properties": {
          "fcmToken": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1,
            "maxLength": 4096
          }
        },
        "required": [
          "fcmToken"
        ]
      },
      "NotificationPref": {
        "type": "object",
        "properties": {
          "kind": {
            "$ref": "#/components/schemas/NotificationKind"
          },
          "enabled": {
            "type": "boolean"
          },
          "essential": {
            "type": "boolean"
          }
        },
        "required": [
          "kind",
          "enabled",
          "essential"
        ]
      },
      "NotificationKind": {
        "type": "string",
        "enum": [
          "sos",
          "tamper",
          "parent_mode.request",
          "parent_mode.used",
          "time_request",
          "kid_message",
          "overspend",
          "device.offline",
          "device.enrolled",
          "grant.by_other_parent"
        ]
      },
      "NotificationPrefsPut": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "kind": {
              "$ref": "#/components/schemas/NotificationKind"
            },
            "enabled": {
              "type": "boolean"
            }
          },
          "required": [
            "kind",
            "enabled"
          ]
        },
        "minItems": 1,
        "maxItems": 10
      },
      "EventPage": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/EventItem"
            }
          },
          "nextBefore": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          }
        },
        "required": [
          "events",
          "nextBefore"
        ]
      },
      "EventItem": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "kind": {
            "type": "string"
          },
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "kidId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "kidName": {
            "type": [
              "string",
              "null"
            ]
          },
          "deviceId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "deviceName": {
            "type": [
              "string",
              "null"
            ]
          },
          "payload": {
            "type": "object",
            "additionalProperties": {}
          }
        },
        "required": [
          "id",
          "kind",
          "at",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "payload"
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
        "description": "The refresh token rotates: the old one stops working. The web app sends `{}` and its `st_refresh` cookie instead of the token.",
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
        "description": "Also clears the `st_refresh` cookie of the web app.",
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
    "/v1/device/state": {
      "get": {
        "tags": [
          "device"
        ],
        "summary": "Everything this device needs to enforce",
        "description": "Send the last `stateVersion` as `If-None-Match` to get 304 when nothing changed. A 304 has no body; use its `Date` header as the server time.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The snapshot.",
            "headers": {
              "ETag": {
                "description": "The `stateVersion` in quotes.",
                "schema": {
                  "type": "string"
                }
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DeviceState"
                }
              }
            }
          },
          "304": {
            "description": "Nothing changed since the `stateVersion` sent in `If-None-Match`."
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
    "/v1/device/usage": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Upload usage segments",
        "description": "Safe to send again. A segment sent again keeps its first `startedAt` and the latest `endedAt`; once closed it never reopens.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/UsageUpload"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Stored.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/UsageReceipt"
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
    "/v1/today": {
      "get": {
        "tags": [
          "parent"
        ],
        "summary": "Used and remaining time today for every kid and pool",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The dashboard.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Today"
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
    "/v1/kids/{kidId}/grants": {
      "get": {
        "tags": [
          "grants"
        ],
        "summary": "A kid's time adjustments for one day",
        "description": "Both pools, oldest first. `day` is the family-local date; today when left out.",
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
          },
          {
            "schema": {
              "$ref": "#/components/schemas/LocalDate"
            },
            "required": false,
            "name": "day",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "The grants.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Grant"
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
      "post": {
        "tags": [
          "grants"
        ],
        "summary": "Add or remove time for today",
        "description": "Counts for today only. Sending the same `id` again returns the stored grant with 200 and changes nothing.",
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
                "$ref": "#/components/schemas/GrantCreate"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Grant"
                }
              }
            }
          },
          "201": {
            "description": "Stored.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Grant"
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
    "/v1/kids/{kidId}/lock-now": {
      "post": {
        "tags": [
          "grants"
        ],
        "summary": "Lock a pool now",
        "description": "Takes away the time left in the pool, rounded up to a whole minute, as a negative grant. Sending the same `id` again returns the stored grant with 200.",
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
                "$ref": "#/components/schemas/LockNow"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Grant"
                }
              }
            }
          },
          "201": {
            "description": "Locked.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Grant"
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
    "/v1/device/time-requests": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Ask for more time",
        "description": "For this device's pool, today. One request per kid and pool can wait at a time (409 while one is pending). Sending the same `id` again returns the stored request with 200.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/TimeRequestCreate"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TimeRequest"
                }
              }
            }
          },
          "201": {
            "description": "Sent to the parents.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TimeRequest"
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
          }
        }
      }
    },
    "/v1/requests": {
      "get": {
        "tags": [
          "requests"
        ],
        "summary": "Kids' time requests",
        "description": "Newest first. Archived kids are left out. `limit` defaults to 50.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "$ref": "#/components/schemas/TimeRequestStatus"
            },
            "required": false,
            "name": "status",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "kidId",
            "in": "query"
          },
          {
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            },
            "required": false,
            "name": "limit",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "The requests.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/TimeRequest"
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
    "/v1/requests/{id}/approve": {
      "post": {
        "tags": [
          "requests"
        ],
        "summary": "Say yes to a time request",
        "description": "Adds a grant for today in the pool of the request: `minutes`, or what the kid asked for when left out. A request that was already answered or has expired gives 409.",
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
                "$ref": "#/components/schemas/TimeRequestApprove"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The answered request.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TimeRequest"
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
    "/v1/requests/{id}/deny": {
      "post": {
        "tags": [
          "requests"
        ],
        "summary": "Say no to a time request",
        "description": "A request that was already answered or has expired gives 409.",
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
          "200": {
            "description": "The answered request.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TimeRequest"
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
    "/v1/device/messages": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Send a message to the parents",
        "description": "Sending the same `id` again returns the stored message with 200.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/KidMessageCreate"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/KidMessage"
                }
              }
            }
          },
          "201": {
            "description": "Sent to the parents.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/KidMessage"
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
          }
        }
      }
    },
    "/v1/messages": {
      "get": {
        "tags": [
          "messages"
        ],
        "summary": "Messages from the kids",
        "description": "Newest first, archived kids included. `limit` defaults to 50. For the next page pass `nextBefore` as `before`.",
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
            "required": false,
            "name": "kidId",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "before",
            "in": "query"
          },
          {
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            },
            "required": false,
            "name": "limit",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "One page of messages.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MessagePage"
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
    "/v1/device/parent-mode-requests": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "\"I'm the parent\": ask the parents to approve parent mode",
        "description": "Waits 10 minutes for an answer. A newer request from the same device replaces an older one. Parent mode already on → 409. Sending the same `id` again returns the stored request with 200.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ParentModeRequestCreate"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
                }
              }
            }
          },
          "201": {
            "description": "Sent to the parents.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
          }
        }
      }
    },
    "/v1/device/parent-mode": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Report parent mode started with the parent code",
        "description": "The device checked the code and started parent mode itself, maybe while offline. A `startedAt` in the future counts as now. Ends any other parent mode on this device. Sending the same `id` again returns the stored session with 200.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ParentModeByCode"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
                }
              }
            }
          },
          "201": {
            "description": "Stored.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
          }
        }
      }
    },
    "/v1/device/parent-mode/end": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "End parent mode on this device (\"End now\")",
        "description": "Nothing to end is fine too.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "responses": {
          "204": {
            "description": "Ended."
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
    "/v1/parent-mode-requests/{id}/approve": {
      "post": {
        "tags": [
          "parent mode"
        ],
        "summary": "Approve a parent-mode request",
        "description": "Starts parent mode on the device that asked. Already answered or expired → 409.",
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
                "$ref": "#/components/schemas/ParentModeStart"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Parent mode is on.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
    "/v1/parent-mode-requests/{id}/deny": {
      "post": {
        "tags": [
          "parent mode"
        ],
        "summary": "Deny a parent-mode request",
        "description": "Already answered or expired → 409.",
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
          "200": {
            "description": "Denied.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
    "/v1/devices/{id}/parent-mode": {
      "post": {
        "tags": [
          "parent mode"
        ],
        "summary": "Start parent mode on a device from the parent app",
        "description": "Ends any other parent mode on the device first.",
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
                "$ref": "#/components/schemas/ParentModeStart"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Parent mode is on.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
          "parent mode"
        ],
        "summary": "End parent mode on a device from the parent app",
        "description": "Nothing to end is fine too.",
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
            "description": "Ended."
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
    "/v1/device/events": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Report tamper attempts",
        "description": "Every event is stored in the history. Parents get one push per kind per upload, for the latest one. An `id` that is already stored is skipped, so sending a queue again is safe.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/DeviceEventUpload"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Stored."
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
    "/v1/device/sos": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Start an SOS",
        "description": "Phones only. Every parent app gets a critical push and every parent an email. While the kid has an active SOS → 409. Sending the same `id` again returns the stored SOS with 200.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SosStart"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
                }
              }
            }
          },
          "201": {
            "description": "The parents are being told.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
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
          }
        }
      }
    },
    "/v1/device/sos/{id}/locations": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Add positions to an SOS",
        "description": "Also after it ended, for positions that were queued. A position with the same `at` as a stored one is skipped.",
        "security": [
          {
            "deviceAuth": []
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
                "$ref": "#/components/schemas/SosLocationsUpload"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Stored."
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
    "/v1/device/sos/{id}/end": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "\"I'm safe\": end an SOS",
        "description": "An SOS that has already ended is fine too.",
        "security": [
          {
            "deviceAuth": []
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
            "description": "Ended."
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
    "/v1/sos": {
      "get": {
        "tags": [
          "sos"
        ],
        "summary": "SOS alerts",
        "description": "Newest first, archived kids included. `active=true` gives only the ones still on. `limit` defaults to 50.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "enum": [
                "true",
                "false"
              ]
            },
            "required": false,
            "name": "active",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "kidId",
            "in": "query"
          },
          {
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            },
            "required": false,
            "name": "limit",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "The SOS alerts.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Sos"
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
    "/v1/sos/{id}": {
      "get": {
        "tags": [
          "sos"
        ],
        "summary": "One SOS with every position",
        "description": "Parent apps read this every 30 seconds while the SOS screen is open.",
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
          "200": {
            "description": "The SOS.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SosDetail"
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
    "/v1/sos/{id}/ack": {
      "post": {
        "tags": [
          "sos"
        ],
        "summary": "\"I'm on it\"",
        "description": "The phone shows \"Dad has seen your SOS\". Tapping it again changes nothing. An SOS that has ended → 409.",
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
          "200": {
            "description": "The SOS.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
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
    "/v1/sos/{id}/extend": {
      "post": {
        "tags": [
          "sos"
        ],
        "summary": "Keep an SOS on for 2 more hours",
        "description": "Moves `autoStopAt` 2 hours later. An SOS that has ended → 409.",
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
          "200": {
            "description": "The SOS.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
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
    "/v1/sos/{id}/end": {
      "post": {
        "tags": [
          "sos"
        ],
        "summary": "End an SOS",
        "description": "An SOS that has already ended → 409.",
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
          "200": {
            "description": "The SOS.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
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
    "/v1/me/push-token": {
      "put": {
        "tags": [
          "notifications"
        ],
        "summary": "Set this parent app's push token",
        "description": "For the session of the access token. null stops pushes to this app. Signing out also stops them.",
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
                "$ref": "#/components/schemas/PushTokenPut"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Saved."
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
    "/v1/me/notification-prefs": {
      "get": {
        "tags": [
          "notifications"
        ],
        "summary": "Which notifications this parent gets",
        "description": "Every kind, in a fixed order. Essential kinds are always on.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The settings.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/NotificationPref"
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
          "notifications"
        ],
        "summary": "Turn notification kinds on or off",
        "description": "Kinds left out keep their setting. Turning off an essential kind is refused (422). Muting only stops the push: the history still shows every event.",
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
                "$ref": "#/components/schemas/NotificationPrefsPut"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Every kind after the change.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/NotificationPref"
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
    "/v1/device/push-token": {
      "put": {
        "tags": [
          "device"
        ],
        "summary": "Set this kid device's push token",
        "description": "Android only. null stops pushes to this device.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PushTokenPut"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Saved."
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
    "/v1/events": {
      "get": {
        "tags": [
          "notifications"
        ],
        "summary": "The event history",
        "description": "Newest first, every kind (muted ones too), archived kids included. `limit` defaults to 50. For the next page pass `nextBefore` as `before`.",
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
            "required": false,
            "name": "kidId",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "maxLength": 64,
              "pattern": "^[a-z_]+(\\.[a-z_]+)*$"
            },
            "required": false,
            "name": "kind",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "before",
            "in": "query"
          },
          {
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            },
            "required": false,
            "name": "limit",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "One page of events.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/EventPage"
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

### 5.6 `package.json` (repo root)

The same as before plus the `dev:web` script.

```json
{
  "name": "screentime",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.22.0",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm build && pnpm -r test",
    "dev:server": "pnpm --filter @screentime/schemas build && pnpm --filter @screentime/server dev",
    "dev:web": "pnpm --filter @screentime/schemas build && pnpm --filter @screentime/web dev",
    "contract": "pnpm --filter @screentime/schemas build && pnpm --filter @screentime/server contract"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  }
}
```

### 5.7 `web/package.json`

The version on `main` plus `scripts`. The dependencies are unchanged.

```json
{
  "name": "@screentime/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "@fontsource-variable/inter": "^5.3.0",
    "@screentime/schemas": "workspace:*",
    "@tanstack/react-query": "^5.104.5",
    "@tanstack/react-router": "^1.170.46",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "input-otp": "^1.5.0",
    "lucide-react": "^1.61.0",
    "radix-ui": "^1.8.1",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "tailwind-merge": "^3.7.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@types/node": "^24.0.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^5.2.0",
    "tailwindcss": "^4.3.3",
    "typescript": "^5.9.0",
    "vite": "^7.3.7",
    "vitest": "^3.2.0"
  }
}
```

### 5.8 `web/tsconfig.json`

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "declaration": false,
    "sourceMap": false,
    "types": ["vite/client", "node"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

### 5.9 `web/vite.config.ts`

The dev server (port 5173) and `vite preview` (port 4173) pass `/v1` (including WebSockets) and `/health` to the API on port 8080. The `test` block is for Vitest.

```typescript
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** The API in development (`pnpm dev:server` or the Docker stack). The browser only talks to this page's origin. */
const api = 'http://localhost:8080';
const proxy = { '/v1': { target: api, ws: true }, '/health': api };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
```

### 5.10 `web/index.html`

```html
<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#0F766E" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>ScreenTime</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 5.11 `web/components.json`

The shadcn/ui settings, so later cards can add more components the same way. Nothing reads it in this card.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "stone",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils",
    "hooks": "@/hooks"
  }
}
```

### 5.12 `web/public/favicon.svg`

A white clock on a teal rounded square.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#0F766E"/>
  <circle cx="16" cy="16" r="9" fill="none" stroke="#FFFFFF" stroke-width="2.5"/>
  <path d="M16 11v5l3.5 2.5" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 5.13 `web/src/index.css`

The design tokens of SPEC §16.1 as CSS variables (lower-case hex), swapped for the dark values when the operating system is in dark mode, and mapped to Tailwind colours: `bg-primary`, `text-on-primary`, `bg-background`, `bg-surface`, `bg-surface-variant`, `text-on-surface`, `text-muted`, `border-outline`, `text-warning`, `text-critical`, `text-danger`.

```css
@import 'tailwindcss';
@import '@fontsource-variable/inter';

/* Design tokens: docs/SPEC.md §16.1. Light and dark follow the operating system. */
:root {
  color-scheme: light dark;
  --primary: #0f766e;
  --on-primary: #ffffff;
  --background: #f7f7f5;
  --surface: #ffffff;
  --surface-variant: #efefeb;
  --on-surface: #1c1917;
  --muted: #57534e;
  --outline: #d6d3d1;
  --warning: #d97706;
  --critical: #ea580c;
  --danger: #dc2626;
}

@media (prefers-color-scheme: dark) {
  :root {
    --primary: #2dd4bf;
    --on-primary: #042f2e;
    --background: #0c0a09;
    --surface: #1c1917;
    --surface-variant: #292524;
    --on-surface: #f5f5f4;
    --muted: #a8a29e;
    --outline: #44403c;
    --warning: #fbbf24;
    --critical: #fb923c;
    --danger: #f87171;
  }
}

@theme inline {
  --color-primary: var(--primary);
  --color-on-primary: var(--on-primary);
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-variant: var(--surface-variant);
  --color-on-surface: var(--on-surface);
  --color-muted: var(--muted);
  --color-outline: var(--outline);
  --color-warning: var(--warning);
  --color-critical: var(--critical);
  --color-danger: var(--danger);
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
}

@layer base {
  body {
    background-color: var(--background);
    color: var(--on-surface);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
}
```

### 5.14 `web/src/main.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { AuthProvider } from '@/lib/auth';
import { router } from '@/router';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

### 5.15 `web/src/router.tsx`

All routes. `/sign-in` stands alone; every other page sits inside `SignedInLayout`, which shows a spinner while the first refresh runs, sends a signed-out visitor to `/sign-in`, sends a super admin who has no family to `/admin`, and wraps the page in the app shell. `/admin` is for the super admin only; others go to `/`.

```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth';
import { ComingSoon } from '@/pages/coming-soon';
import { NotFoundPage } from '@/pages/not-found';
import { SignInPage } from '@/pages/sign-in';

function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-muted" aria-label="Loading">
      <Loader2 className="size-8 animate-spin" />
    </div>
  );
}

/** Every page but sign-in: signed-out visitors go to /sign-in; a super admin with no family only has /admin. */
function SignedInLayout() {
  const auth = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (auth.status === 'loading') return <FullScreenSpinner />;
  if (auth.status === 'signedOut') return <Navigate to="/sign-in" />;
  if (!auth.me.family && path !== '/admin') return <Navigate to="/admin" />;
  return (
    <AppShell me={auth.me}>
      <Outlet />
    </AppShell>
  );
}

function AdminOnly() {
  const auth = useAuth();
  if (auth.status !== 'signedIn' || !auth.me.roles.includes('superadmin')) return <Navigate to="/" />;
  return <ComingSoon title="Admin" description="Families on this server." />;
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundPage });

const signInRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sign-in', component: SignInPage });

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: SignedInLayout });

const todayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: () => <ComingSoon title="Today" description="Time used and left for each kid." />,
});
const inboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/inbox',
  component: () => <ComingSoon title="Inbox" description="Requests, messages and events." />,
});
const kidsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/kids',
  component: () => <ComingSoon title="Kids" description="Schedules, devices and contacts." />,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: () => <ComingSoon title="Settings" description="Notifications, presets, parents and the parent code." />,
});
const adminRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin', component: AdminOnly });

const routeTree = rootRoute.addChildren([
  signInRoute,
  appRoute.addChildren([todayRoute, inboxRoute, kidsRoute, settingsRoute, adminRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

### 5.16 `web/src/lib/utils.ts`

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names; a later Tailwind class wins over an earlier one of the same kind. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 5.17 `web/src/lib/format.ts`

Durations and times of day as SPEC §16.1 writes them. Later cards use these on every page.

```typescript
/** "1h 05m", "45m", "less than a minute" (docs/SPEC.md §16.1). Seconds are rounded down to whole minutes. */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes === 0) return 'less than a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest}m` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/** An instant as a time of day in the family time zone, 12-hour: "8:30 pm" (docs/SPEC.md §16.1). */
export function formatTimeOfDay(instant: Date | string, timeZone: string): string {
  const text = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(
    new Date(instant),
  );
  // Browsers differ in the space before "pm" (a narrow no-break space in newer ones) and its case.
  return text.replace(/\s+/g, ' ').toLowerCase();
}
```

### 5.18 `web/src/lib/api.ts`

The API client. See 6.2.

```typescript
import type { AuthResponse } from '@screentime/schemas';

/** An error answer from the API (`{ "error": { "code", "message" } }`), or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
type AuthListener = (auth: AuthResponse | null) => void;

const JSON_HEADERS = { 'content-type': 'application/json' };

async function errorOf(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body.error ?? {};
    if (typeof code === 'string' && typeof message === 'string') return new ApiError(res.status, code, message);
  } catch {
    // Not JSON: fall through.
  }
  return new ApiError(res.status, 'http_error', `Something went wrong (${res.status}). Try again.`);
}

/**
 * The parent web app's client for /v1 on its own origin (docs/SPEC.md §11.1). The access token lives in
 * memory only. The refresh token is the HttpOnly `st_refresh` cookie: the browser sends it to /v1/auth by
 * itself and page scripts never see it. A 401 refreshes once and retries; concurrent callers share one refresh.
 */
export class Api {
  private accessToken: string | null = null;
  private refreshing: Promise<AuthResponse | null> | null = null;
  private readonly listeners = new Set<AuthListener>();
  private readonly fetchFn: Fetch;

  constructor(fetchFn?: Fetch) {
    this.fetchFn = fetchFn ?? ((input, init) => fetch(input, init));
  }

  /** Called with the new sign-in after every sign-in and refresh, and with null when signed out. */
  onAuthChange(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setAuth(auth: AuthResponse | null) {
    this.accessToken = auth?.accessToken ?? null;
    for (const listener of this.listeners) listener(auth);
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(path, init);
    } catch {
      throw new ApiError(0, 'network', "Can't reach ScreenTime. Check your connection and try again.");
    }
  }

  /** Emails a sign-in code. Answers the same whether or not the email can sign in. */
  async requestCode(email: string): Promise<void> {
    const res = await this.send('/v1/auth/otp/request', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw await errorOf(res);
  }

  async verifyCode(email: string, code: string): Promise<AuthResponse> {
    const res = await this.send('/v1/auth/otp/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, code, client: 'web', clientLabel: 'Web browser' }),
    });
    if (!res.ok) throw await errorOf(res);
    const auth = (await res.json()) as AuthResponse;
    this.setAuth(auth);
    return auth;
  }

  /** Uses the cookie to get a new access token. Null (and signed out) when the session is gone. */
  refresh(): Promise<AuthResponse | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<AuthResponse | null> {
    const res = await this.send('/v1/auth/refresh', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    if (res.status === 401) {
      this.setAuth(null);
      return null;
    }
    if (!res.ok) throw await errorOf(res);
    const auth = (await res.json()) as AuthResponse;
    this.setAuth(auth);
    return auth;
  }

  /** Ends the session on the server (which also clears the cookie). Signed out here even if that fails. */
  async signOut(): Promise<void> {
    try {
      if (this.accessToken) {
        await this.send('/v1/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${this.accessToken}` } });
      }
    } catch {
      // Signed out locally anyway.
    }
    this.setAuth(null);
  }

  /** A signed-in call. Resolves to the parsed JSON body, or undefined for 204. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.accessToken && !(await this.refresh())) throw new ApiError(401, 'unauthorized', 'Sign in again.');
    let res = await this.call(method, path, body);
    if (res.status === 401) {
      if (!(await this.refresh())) throw new ApiError(401, 'unauthorized', 'Sign in again.');
      res = await this.call(method, path, body);
    }
    if (!res.ok) throw await errorOf(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private call(method: string, path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.accessToken ?? ''}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return this.send(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
```

### 5.19 `web/src/lib/auth.tsx`

The page's one `Api` and the sign-in state for React.

```tsx
import type { Me } from '@screentime/schemas';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { Api } from '@/lib/api';

export type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: Me };

/** The one API client of the page. */
export const api = new Api();

const AuthContext = createContext<AuthState>({ status: 'loading' });

/** On load, tries the refresh cookie once: a parent who signed in before goes straight in. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const stop = api.onAuthChange((auth) => setState(auth ? { status: 'signedIn', me: auth.me } : { status: 'signedOut' }));
    api.refresh().catch(() => setState({ status: 'signedOut' }));
    return stop;
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
```

### 5.20 `web/src/components/ui/button.tsx`

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-on-primary hover:bg-primary/90',
        outline: 'border border-outline bg-surface hover:bg-surface-variant',
        ghost: 'hover:bg-surface-variant',
        link: 'text-primary underline-offset-4 hover:underline',
        danger: 'bg-danger text-white hover:bg-danger/90',
      },
      size: {
        default: 'h-12 px-6',
        sm: 'h-9 px-4',
        icon: 'size-12',
      },
    },
    // A link button is as small as its text, whatever the size.
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/** shadcn/ui button themed with the tokens of docs/SPEC.md §16.1: pill shaped, 48 px high. */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
```

### 5.21 `web/src/components/ui/input.tsx`

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-12 w-full min-w-0 rounded-xl border border-outline bg-surface px-4 text-base outline-none transition-colors placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
```

### 5.22 `web/src/components/ui/label.tsx`

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('text-sm font-medium', className)} {...props} />;
}
```

### 5.23 `web/src/components/ui/card.tsx`

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A surface with a 16 px radius (docs/SPEC.md §16.1). */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="card" className={cn('rounded-2xl border border-outline bg-surface shadow-sm', className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1.5 p-6 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 data-slot="card-title" className={cn('text-lg font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-sm text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-6', className)} {...props} />;
}
```

### 5.24 `web/src/components/ui/sheet.tsx`

```tsx
import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A panel that slides in from the left: the navigation menu below 1024 px (docs/SPEC.md §16.5). */
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export function SheetContent({ className, children, ...props }: ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay data-slot="sheet-overlay" className="fixed inset-0 z-50 bg-black/40" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        aria-describedby={undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-outline bg-surface shadow-xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn('font-semibold', className)} {...props} />;
}
```

### 5.25 `web/src/components/ui/input-otp.tsx`

```tsx
import { OTPInput, OTPInputContext } from 'input-otp';
import { type ComponentProps, useContext } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui one-time-code input: one box per digit. */
export function InputOTP({ className, containerClassName, ...props }: ComponentProps<typeof OTPInput>) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn('flex items-center has-disabled:opacity-50', containerClassName)}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  );
}

export function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-otp-group" className={cn('flex items-center gap-2', className)} {...props} />;
}

export function InputOTPSlot({ index, className, ...props }: ComponentProps<'div'> & { index: number }) {
  const slot = useContext(OTPInputContext)?.slots[index];
  return (
    <div
      data-slot="input-otp-slot"
      data-active={slot?.isActive ?? false}
      className={cn(
        'relative flex h-12 w-10 items-center justify-center rounded-xl border border-outline bg-surface text-xl font-semibold tabular-nums transition-colors sm:h-14 sm:w-12 sm:text-2xl data-[active=true]:border-primary data-[active=true]:ring-2 data-[active=true]:ring-primary/30',
        className,
      )}
      {...props}
    >
      {slot?.char}
      {slot?.hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-px animate-pulse bg-on-surface" />
        </div>
      )}
    </div>
  );
}
```

### 5.26 `web/src/components/brand.tsx`

```tsx
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The app mark: a clock on a teal rounded square, then the name. */
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-on-primary">
        <Clock className="size-5" strokeWidth={2.5} />
      </span>
      <span className="text-lg font-semibold tracking-tight">ScreenTime</span>
    </div>
  );
}
```

### 5.27 `web/src/components/page-header.tsx`

```tsx
import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
```

### 5.28 `web/src/components/app-shell.tsx`

```tsx
import type { Me } from '@screentime/schemas';
import { Link } from '@tanstack/react-router';
import { Inbox, LogOut, Menu, Settings, Shield, Sun, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { api } from '@/lib/auth';

const FAMILY_LINKS = [
  { to: '/', label: 'Today', icon: Sun },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/kids', label: 'Kids', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;
const ADMIN_LINK = { to: '/admin', label: 'Admin', icon: Shield } as const;

/** Today, Inbox, Kids, Settings for a parent; Admin for the super admin (a super admin with no family sees only Admin). */
export function navLinks(me: Me) {
  const family = me.family ? FAMILY_LINKS : [];
  return me.roles.includes('superadmin') ? [...family, ADMIN_LINK] : [...family];
}

function NavList({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {navLinks(me).map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          activeOptions={{ exact: to === '/' }}
          className="flex h-11 items-center gap-3 rounded-full px-4 text-sm font-medium text-muted transition-colors hover:bg-surface-variant hover:text-on-surface data-[status=active]:bg-primary/10 data-[status=active]:text-primary"
        >
          <Icon className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Account({ me }: { me: Me }) {
  return (
    <div className="flex items-center gap-3 border-t border-outline pt-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{me.parent?.displayName ?? 'Super admin'}</p>
        <p className="truncate text-xs text-muted">{me.parent?.email ?? me.family?.name ?? ''}</p>
      </div>
      <Button variant="ghost" size="icon" className="size-10" aria-label="Sign out" onClick={() => void api.signOut()}>
        <LogOut />
      </Button>
    </div>
  );
}

/**
 * docs/SPEC.md §16.5: a 240 px sidebar from 1024 px up; below that a top bar whose menu button opens the
 * same links in a sheet. Page content is at most 1100 px wide.
 */
export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-6 border-r border-outline bg-surface p-4 lg:flex">
        <Brand className="px-2 pt-2" />
        <div className="flex-1">
          <NavList me={me} />
        </div>
        <Account me={me} />
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-outline bg-surface px-2 lg:hidden">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent className="gap-6 p-4">
            <SheetTitle asChild>
              <div>
                <Brand className="px-2 pt-2" />
              </div>
            </SheetTitle>
            <div className="flex-1">
              <NavList me={me} onNavigate={() => setMenuOpen(false)} />
            </div>
            <Account me={me} />
          </SheetContent>
        </Sheet>
        <Brand />
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-4 py-6 lg:px-8 lg:py-10">{children}</main>
    </div>
  );
}
```

### 5.29 `web/src/pages/sign-in.tsx`

```tsx
import { Navigate } from '@tanstack/react-router';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { api, useAuth } from '@/lib/auth';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/** docs/SPEC.md §11.1 and §16.5: email, then the 6-digit code from the email. */
export function SignInPage() {
  const auth = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  if (auth.status === 'signedIn') return <Navigate to="/" />;

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.requestCode(email.trim());
      setCode('');
      setStep('code');
      if (step === 'code') {
        setNotice('We sent a new code.');
        codeInput.current?.focus();
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.verifyCode(email.trim(), value);
    } catch (err) {
      setError(messageOf(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Brand />
      <Card className="w-full max-w-sm">
        {step === 'email' ? (
          <>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>We'll email you a 6-digit code.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={sendCode}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={error ? true : undefined}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy || email.trim() === ''}>
                  {busy && <Loader2 className="animate-spin" />}
                  Send code
                </Button>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                Enter the 6-digit code we sent to <span className="font-medium text-on-surface">{email.trim()}</span>.
                It works for 10 minutes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <InputOTP
                ref={codeInput}
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={setCode}
                onComplete={(value: string) => void verify(value)}
                aria-label="Sign-in code"
                containerClassName="justify-center"
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error && (
                <p role="alert" className="text-center text-sm text-danger">
                  {error}
                </p>
              )}
              {notice && <p className="text-center text-sm text-muted">{notice}</p>}
              <Button disabled={busy || code.length !== 6} onClick={() => void verify(code)}>
                {busy && <Loader2 className="animate-spin" />}
                Sign in
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button
                  variant="link"
                  disabled={busy}
                  onClick={() => {
                    setStep('email');
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Use a different email
                </Button>
                <Button variant="link" disabled={busy} onClick={() => void sendCode()}>
                  Send a new code
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
```

### 5.30 `web/src/pages/coming-soon.tsx`

```tsx
import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';

/** Stands in for a page a later card builds (docs/BUILD-PLAN.md, CARD-023 to 026). */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
            <Construction className="size-6" />
          </span>
          <p className="font-medium">Coming soon</p>
          <p className="max-w-sm text-sm text-muted">This page is not built yet.</p>
        </CardContent>
      </Card>
    </>
  );
}
```

### 5.31 `web/src/pages/not-found.tsx`

```tsx
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-5xl font-semibold text-muted">404</p>
      <p className="font-medium">That page doesn't exist.</p>
      <Button asChild variant="outline">
        <Link to="/">Go to Today</Link>
      </Button>
    </div>
  );
}
```

### 5.32 `web/test/format.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { formatDuration, formatTimeOfDay } from '@/lib/format';

describe('formatDuration', () => {
  it('writes hours and minutes the way docs/SPEC.md §16.1 shows them', () => {
    expect(formatDuration(0)).toBe('less than a minute');
    expect(formatDuration(59)).toBe('less than a minute');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(45 * 60 + 59)).toBe('45m');
    expect(formatDuration(60 * 60)).toBe('1h 00m');
    expect(formatDuration(72 * 60)).toBe('1h 12m');
    expect(formatDuration(8 * 3600 + 5 * 60)).toBe('8h 05m');
  });

  it('treats a negative amount as nothing left', () => {
    expect(formatDuration(-300)).toBe('less than a minute');
  });
});

describe('formatTimeOfDay', () => {
  it('shows 12-hour times with am and pm in the family time zone', () => {
    // Sydney is UTC+11 in late October (daylight saving).
    expect(formatTimeOfDay('2026-10-25T09:30:00Z', 'Australia/Sydney')).toBe('8:30 pm');
    expect(formatTimeOfDay('2026-10-25T13:00:00Z', 'Australia/Sydney')).toBe('12:00 am');
    expect(formatTimeOfDay(new Date('2026-10-25T01:05:00Z'), 'Australia/Perth')).toBe('9:05 am');
  });
});
```

### 5.33 `web/test/api.test.ts`

```typescript
import type { AuthResponse } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { Api, ApiError } from '@/lib/api';

interface Call {
  path: string;
  method: string;
  authorization: string | null;
  body: string | null;
}

const me: AuthResponse['me'] = {
  parent: { id: '11111111-1111-4111-8111-111111111111', email: 'dad@example.com', displayName: 'Dad', phoneE164: null },
  family: { id: '22222222-2222-4222-8222-222222222222', name: 'Gallaghers', timezone: 'Australia/Sydney', emergencyNumber: '000' },
  roles: ['parent'],
};
const auth = (accessToken: string): AuthResponse => ({ accessToken, expiresIn: 900, me });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unauthorized = () => json(401, { error: { code: 'unauthorized', message: 'Sign in again.' } });

/** A fake server: `answer` decides each response; every call is recorded. */
function fakeFetch(answer: (call: Call, calls: Call[]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const call = {
      path,
      method: init.method ?? 'GET',
      authorization: headers.get('authorization'),
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(call);
    return answer(call, calls);
  };
  return { calls, fetchFn };
}

describe('Api', () => {
  it('signs in as the web client and sends the access token on later calls', async () => {
    const { calls, fetchFn } = fakeFetch((call) => {
      if (call.path === '/v1/auth/otp/verify') return json(200, auth('token-1'));
      return json(200, { kids: [] });
    });
    const api = new Api(fetchFn);
    const seen: (AuthResponse | null)[] = [];
    api.onAuthChange((a) => seen.push(a));

    await api.verifyCode('dad@example.com', '123456');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      email: 'dad@example.com',
      code: '123456',
      client: 'web',
      clientLabel: 'Web browser',
    });
    expect(seen).toEqual([auth('token-1')]);

    expect(await api.get('/v1/kids')).toEqual({ kids: [] });
    expect(calls[1]).toEqual({ path: '/v1/kids', method: 'GET', authorization: 'Bearer token-1', body: null });
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    const { calls, fetchFn } = fakeFetch((call) => {
      if (call.path === '/v1/auth/otp/verify') return json(200, auth('old'));
      if (call.path === '/v1/auth/refresh') return json(200, auth('new'));
      return call.authorization === 'Bearer new' ? json(200, { ok: true }) : unauthorized();
    });
    const api = new Api(fetchFn);
    await api.verifyCode('dad@example.com', '123456');

    expect(await api.post('/v1/things', { a: 1 })).toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.path} ${c.authorization ?? '-'}`)).toEqual([
      'POST /v1/auth/otp/verify -',
      'POST /v1/things Bearer old',
      'POST /v1/auth/refresh -',
      'POST /v1/things Bearer new',
    ]);
    expect(calls[2]?.body).toBe('{}');
    expect(calls[3]?.body).toBe('{"a":1}');
  });

  it('shares one refresh between calls made together before any sign-in', async () => {
    const { calls, fetchFn } = fakeFetch(async (call) => {
      if (call.path === '/v1/auth/refresh') {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(200, auth('from-cookie'));
      }
      return json(200, { path: call.path });
    });
    const api = new Api(fetchFn);

    const results = await Promise.all([api.get('/v1/a'), api.get('/v1/b'), api.refresh()]);
    expect(results[0]).toEqual({ path: '/v1/a' });
    expect(results[1]).toEqual({ path: '/v1/b' });
    expect(results[2]).toEqual(auth('from-cookie'));
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('signs out when the refresh cookie no longer works', async () => {
    const { calls, fetchFn } = fakeFetch(() => unauthorized());
    const api = new Api(fetchFn);
    const seen: (AuthResponse | null)[] = [];
    api.onAuthChange((a) => seen.push(a));

    expect(await api.refresh()).toBeNull();
    await expect(api.get('/v1/kids')).rejects.toEqual(new ApiError(401, 'unauthorized', 'Sign in again.'));
    expect(seen).toEqual([null, null]);
    expect(calls.map((c) => c.path)).toEqual(['/v1/auth/refresh', '/v1/auth/refresh']);
  });

  it('turns error answers and network failures into ApiError', async () => {
    const api = new Api(async (path) => {
      if (path === '/v1/auth/otp/request') {
        return json(429, { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' } });
      }
      if (path === '/v1/auth/otp/verify') return new Response('Bad gateway', { status: 502 });
      throw new TypeError('Failed to fetch');
    });

    const limited = await api.requestCode('dad@example.com').catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(ApiError);
    expect(limited).toMatchObject({ status: 429, code: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' });
    await expect(api.verifyCode('dad@example.com', '123456')).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
      message: 'Something went wrong (502). Try again.',
    });
    await expect(api.refresh()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('signs out on the server and locally, even when the server call fails', async () => {
    const { calls, fetchFn } = fakeFetch((call) => {
      if (call.path === '/v1/auth/otp/verify') return json(200, auth('token-1'));
      throw new TypeError('Failed to fetch');
    });
    const api = new Api(fetchFn);
    const seen: (AuthResponse | null)[] = [];
    await api.verifyCode('dad@example.com', '123456');
    api.onAuthChange((a) => seen.push(a));

    await api.signOut();
    expect(calls[1]).toEqual({ path: '/v1/auth/logout', method: 'POST', authorization: 'Bearer token-1', body: null });
    expect(seen).toEqual([null]);
  });
});
```

## 6. Detailed spec

### 6.1 The refresh cookie (server)

- `POST /v1/auth/otp/verify` with `client: "web"`: the answer has `accessToken`, `expiresIn` and `me` but **no** `refreshToken`, and the header `Set-Cookie: st_refresh=<token>; Max-Age=7776000; Path=/v1/auth; HttpOnly; Secure; SameSite=Strict`. With `client: "android"` nothing changes: the token is in the body and no cookie is set.
- `POST /v1/auth/refresh` takes `{ "refreshToken": "..." }` (Android) or `{}` plus the cookie (web). The token still rotates. Whether the new token goes in the body or a new cookie depends on the session's stored `client`, not on how the old one arrived. No token at all gives 401 `Sign in again.`
- `POST /v1/auth/logout` also answers `Set-Cookie: st_refresh=; Max-Age=0; Path=/v1/auth; Secure`, which deletes the cookie.
- Browsers accept a `Secure` cookie on http://localhost, so this works in development without HTTPS. `SameSite=Strict` plus the `/v1/auth` path means other sites cannot make the browser use it, and other API calls do not carry it.

### 6.2 The API client (`web/src/lib/api.ts`)

- The access token is kept in memory only (a reload loses it; the cookie brings it back).
- `request(method, path, body?)` sends `Authorization: Bearer <access token>`. With no token yet it refreshes first. On a 401 it refreshes once and retries once; if the refresh fails, the user is signed out and it throws `ApiError(401, 'unauthorized', 'Sign in again.')`.
- Calls made at the same moment share one refresh (one `POST /v1/auth/refresh`), because each refresh rotates the token and a second one with the old cookie would fail.
- Error answers become `ApiError(status, code, message)` with the server's own message (they are written for people). A non-JSON error gives `http_error` and `Something went wrong (<status>). Try again.`; a failed fetch gives status 0, `network` and `Can't reach ScreenTime. Check your connection and try again.`
- `onAuthChange` tells React about every sign-in, refresh and sign out.

### 6.3 What the pages look like

Tokens from SPEC §16.1; Inter everywhere; light or dark from the operating system.

**Sign in** (`/sign-in`): a centred column on the `background` colour. At the top the brand (32 px teal rounded square with a white clock icon, then "ScreenTime" in 18 px semibold). Below it a white `surface` card, 384 px wide at most, 16 px radius, 1 px `outline` border:

- Step 1: title "Sign in", muted line "We'll email you a 6-digit code.", an "Email" label, a 48 px high rounded email input, then a full-width teal pill button "Send code" (disabled while the email is empty).
- Step 2: title "Check your email", muted text "Enter the 6-digit code we sent to **<email>**. It works for 10 minutes.", then six code boxes in a row (48 × 56 px on wide screens, 40 × 48 px on phones, so they fit on a 360 px screen), focused at once. Typing the sixth digit signs in; the "Sign in" button does the same. Under the button, two text links: "Use a different email" on the left, "Send a new code" on the right. A wrong code shows the server's message in `danger` red under the boxes and empties them; a new code shows "We sent a new code." in muted text.
- While a request runs, the button shows a spinning loader icon and is disabled.

**Signed in, 1024 px and wider:** a 240 px `surface` sidebar on the left with a right border: the brand at the top; the links Today (sun icon), Inbox, Kids, Settings, and Admin (shield icon) for the super admin; each link a 44 px pill, the current one in teal text on a light teal background; at the bottom, above a line, the parent's name and email and a sign-out icon button. The page content is to the right, at most 1100 px wide.

**Signed in, below 1024 px:** a 56 px `surface` top bar with a menu button (three lines) and the brand. The menu button opens a sheet from the left with the same brand, links and account section over a dimmed page; choosing a link closes it.

**Placeholder pages:** a heading (24 px semibold) and a muted one-line description, then a card with a round grey icon, "Coming soon" and "This page is not built yet." A super admin who is not a parent only has Admin. Unknown addresses show "404" and a "Go to Today" button.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-022-web-skeleton
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-022-web-skeleton.md`, `web/package.json` and `server/src/jobs/sweep.ts` (CARD-021) must exist. If not, you did not pull, or CARD-021 is not merged yet: run `git fetch origin` and `git pull origin main` again, and if `server/src/jobs/sweep.ts` is still missing, stop and ask James.
3. Replace 5.1 to 5.4. Run `pnpm build`, `pnpm typecheck` and `pnpm contract`, then check `contract/openapi.json` is now exactly 5.5 (`git diff contract` shows only the changes listed in 5.5). Commit: `CARD-022: keep the web refresh token in an HttpOnly cookie`.
4. Replace 5.6 and 5.7, create 5.8 to 5.31. Run `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm typecheck`. Commit: `CARD-022: add the web app skeleton`.
5. Create 5.32 and 5.33. Commit: `CARD-022: add web tests`.
6. Run the acceptance checks in section 8.
7. Push and open the PR (section 10).
8. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
9. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and `git status --short pnpm-lock.yaml` is empty. `pnpm build` ends the web part with `✓ built in` and writes `web/dist/index.html` (git-ignored). Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  36 passed (36)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `web`: `test/format.test.ts (3 tests)`, `test/api.test.ts (6 tests)`, `Tests  9 passed (9)`.
  - `server`: `test/auth.test.ts (16 tests | 16 skipped)`, and every other file as before, so `Tests  41 passed | 171 skipped (212)`.
- [ ] `pnpm contract` leaves `git status --short contract` empty (after your commit of 5.5). `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate`.
- [ ] The database tests pass against PostgreSQL 18. Use a local `deploy/.env` with throwaway values (this replaces any `deploy/.env` you have; it is git-ignored):
  ```powershell
  Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
  $env:TEST_DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime_test"
  pnpm --filter @screentime/server test
  pnpm --filter @screentime/server test
  Remove-Item Env:TEST_DATABASE_URL
  ```
  Both runs: `test/auth.test.ts (16 tests)` and `Tests  212 passed (212)`.
- [ ] Sign-in works through the web dev server (the `db` container from the previous check is still running). Start the API: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait`. Open a **second** PowerShell window in the repo folder, run `pnpm dev:web` there and leave it running (it prints `Local:   http://localhost:5173/`). Back in the first window, check the page is served and ask for a code through port 5173:
  ```powershell
  (Invoke-WebRequest http://localhost:5173/sign-in -UseBasicParsing).Content -match '<div id="root"></div>'
  Invoke-RestMethod -Method Post http://localhost:5173/v1/auth/otp/request -ContentType 'application/json' -Body '{"email":"admin@example.com"}'
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "sign-in code for admin"
  ```
  The first line prints `True`. Put the 6 digits from the last log line in place of `123456`, then sign in as the web client, look at the cookie, and refresh with it:
  ```powershell
  $r = Invoke-WebRequest -Method Post http://localhost:5173/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"admin@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}' -UseBasicParsing
  $set = @($r.Headers['Set-Cookie'])[0]
  $set -replace '=[A-Za-z0-9_-]{43};', '=<token>;'
  ($r.Content | ConvertFrom-Json).PSObject.Properties.Name -join ','
  $cookie = @{ Cookie = ($set -split ';')[0] }
  $r2 = Invoke-WebRequest -Method Post http://localhost:5173/v1/auth/refresh -ContentType 'application/json' -Body '{}' -Headers $cookie -UseBasicParsing
  "$($r2.StatusCode) $((($r2.Content | ConvertFrom-Json).me.roles) -join ',') $((@($r2.Headers['Set-Cookie'])[0] -split ';')[0] -ne $cookie.Cookie)"
  ```
  The outputs are `st_refresh=<token>; Max-Age=7776000; Path=/v1/auth; HttpOnly; Secure; SameSite=Strict`, then `accessToken,expiresIn,me` (no `refreshToken`), then `200 superadmin True` (`True`: the refresh gave a new cookie). Stop `pnpm dev:web` with Ctrl+C.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env` or anything in `web/dist/`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about two minutes; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 33 files (in any order):
  ```
  contract/openapi.json
  package.json
  packages/schemas/src/auth.ts
  packages/schemas/test/auth.test.ts
  server/src/auth/routes.ts
  server/test/auth.test.ts
  web/components.json
  web/index.html
  web/package.json
  web/public/favicon.svg
  web/src/components/app-shell.tsx
  web/src/components/brand.tsx
  web/src/components/page-header.tsx
  web/src/components/ui/button.tsx
  web/src/components/ui/card.tsx
  web/src/components/ui/input-otp.tsx
  web/src/components/ui/input.tsx
  web/src/components/ui/label.tsx
  web/src/components/ui/sheet.tsx
  web/src/index.css
  web/src/lib/api.ts
  web/src/lib/auth.tsx
  web/src/lib/format.ts
  web/src/lib/utils.ts
  web/src/main.tsx
  web/src/pages/coming-soon.tsx
  web/src/pages/not-found.tsx
  web/src/pages/sign-in.tsx
  web/src/router.tsx
  web/test/api.test.ts
  web/test/format.test.ts
  web/tsconfig.json
  web/vite.config.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/auth.test.ts` | New: `RefreshRequest` accepts `{}` and a token but not an empty string; `AuthResponse` is valid with and without `refreshToken`. |
| `server/test/auth.test.ts` | New: a web sign-in has no `refreshToken` in the body and sets the `st_refresh` cookie with exactly the attributes of 6.1; refreshing with the cookie and `{}` works and gives a different cookie; the old cookie and no cookie both get 401; logout deletes the cookie and the last one stops working. The other 15 tests are unchanged. |
| `web/test/format.test.ts` | `formatDuration`: `less than a minute`, `1m`, `45m`, `1h 00m`, `1h 12m`, `8h 05m`, and negative amounts. `formatTimeOfDay`: `8:30 pm` and `12:00 am` in Sydney, `9:05 am` in Perth. |
| `web/test/api.test.ts` | With a fake `fetch`: sign-in sends `client: 'web'` and later calls carry the access token; a 401 refreshes once (body `{}`) and retries with the new token; calls made together before any sign-in share one refresh; a dead cookie signs out and throws `Sign in again.`; error bodies, non-JSON errors and network failures become `ApiError`; sign out calls logout with the token and signs out locally even when that fails. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 5). Message format: `CARD-022: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-022-web-skeleton`
5. Open a PR into `main` titled `CARD-022: Web app skeleton and sign-in`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-022-web-skeleton --title "CARD-022: Web app skeleton and sign-in" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-022-web-skeleton.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract matches; db:generate finds no changes
   - [x] database tests, twice — output: `Tests  212 passed (212)` both times
   - [x] sign-in through the web dev server — output: `True`, the cookie line, `accessToken,expiresIn,me`, `200 superadmin True`
   - [x] deploy/.env and web/dist not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 33 files

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

- **`server/src/jobs/sweep.ts` does not exist**: CARD-021 is not on your `main` yet. Stop and ask James.
- **`pnpm install --frozen-lockfile` fails or wants to change `pnpm-lock.yaml`**: you changed a dependency in `web/package.json` or the root `package.json`. Compare them with 5.6 and 5.7. Do not run plain `pnpm install` and do not commit a lockfile change.
- **`pnpm contract` changes `contract/openapi.json` after you copied 5.5**: 5.1 or 5.3 differs from the card. Find it with `git diff`; do not commit a contract that differs from 5.5.
- **`Port 5173 is in use`**: another `pnpm dev:web` is still running. Close it and try again.
- **The refresh step answers 401**: you used a code that was already used, or the cookie line was not copied. Ask for a new code and run both blocks again once. If it fails twice, report it.
- **`formatTimeOfDay` gives `8:30 PM` or a different space**: the code lower-cases and normalises spaces on purpose; check 5.17 is exact. If the test still fails, report the actual output.
- **Blank lines and formatting**: copy them exactly too. In CARD-016 and CARD-018 a changed quote and a deleted blank line were not reported. Every difference from the card, however small, is a deviation: list it under "Deviations".
- **Different test data**: do not change values in the tests (names, emails, times, tokens), even when another value would also pass. If you think one is wrong, say so under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-022. Please review and merge if it is good.

CARD: CARD-022 Web app skeleton and sign-in
PR: <full PR URL>
Branch: bob/card-022-web-skeleton
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
