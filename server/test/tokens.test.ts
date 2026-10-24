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
