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
