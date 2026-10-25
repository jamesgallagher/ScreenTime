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
