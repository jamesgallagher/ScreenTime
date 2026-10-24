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
