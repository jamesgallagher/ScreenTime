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
