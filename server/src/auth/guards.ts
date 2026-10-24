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
