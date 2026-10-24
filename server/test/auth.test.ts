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
