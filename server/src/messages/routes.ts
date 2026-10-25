import { createRoute, z } from '@hono/zod-openapi';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import { KidMessage, KidMessageCreate, MessagePage } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, kidMessages, kids, messagePresets } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { notifyParents } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const MessagesQuery = z.object({
  kidId: z.uuid().optional(),
  /** `nextBefore` of the previous page. */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const sendMessageRoute = createRoute({
  method: 'post',
  path: '/v1/device/messages',
  tags: ['device'],
  summary: 'Send a message to the parents',
  description: 'Sending the same `id` again returns the stored message with 200.',
  security: deviceBearer,
  request: { body: jsonBody(KidMessageCreate) },
  responses: {
    201: jsonResponse('Sent to the parents.', KidMessage),
    200: jsonResponse('Already stored with this id.', KidMessage),
    ...errorResponses(401, 409, 422),
  },
});

const listMessagesRoute = createRoute({
  method: 'get',
  path: '/v1/messages',
  tags: ['messages'],
  summary: 'Messages from the kids',
  description:
    'Newest first, archived kids included. `limit` defaults to 50. For the next page pass `nextBefore` as `before`.',
  security: bearer,
  request: { query: MessagesQuery },
  responses: { 200: jsonResponse('One page of messages.', MessagePage), ...errorResponses(401, 403, 422) },
});

/** Messages with kid and device names, newest first. */
async function selectMessages(tx: FamilyTx, where: SQL | undefined, limit?: number) {
  const query = tx
    .select({ message: kidMessages, kidName: kids.name, deviceName: devices.name })
    .from(kidMessages)
    .innerJoin(kids, eq(kids.id, kidMessages.kidId))
    .innerJoin(devices, eq(devices.id, kidMessages.deviceId))
    .where(where)
    .orderBy(sql`${kidMessages.createdAt} desc`, sql`${kidMessages.id} desc`);
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map(
    ({ message: m, kidName, deviceName }): KidMessage => ({
      id: m.id,
      kidId: m.kidId,
      kidName,
      deviceId: m.deviceId,
      deviceName,
      body: m.body,
      presetId: m.presetId,
      createdAt: m.createdAt.toISOString(),
    }),
  );
}

/** Kid messages to the parents (docs/SPEC.md §9.2, §9.3, Q29). */
export function registerMessageRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(sendMessageRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      const [stored] = await tx.select({ deviceId: kidMessages.deviceId }).from(kidMessages).where(eq(kidMessages.id, body.id));
      if (stored) {
        if (stored.deviceId !== deviceId) throw new ApiError('conflict', 'That message id is already used.');
        const [message] = await selectMessages(tx, eq(kidMessages.id, body.id));
        return { message, eventId: null };
      }
      // Parents may have changed the presets since the device last synced: the text is what counts.
      let presetId: string | null = null;
      if (body.presetId) {
        const [preset] = await tx
          .select({ id: messagePresets.id })
          .from(messagePresets)
          .where(eq(messagePresets.id, body.presetId));
        presetId = preset?.id ?? null;
      }
      const [row] = await tx
        .insert(kidMessages)
        .values({ id: body.id, familyId, kidId, deviceId, body: body.body, presetId })
        .returning({ createdAt: kidMessages.createdAt });
      if (!row) throw new Error('message insert returned nothing');
      const [event] = await tx
        .insert(events)
        .values({
          familyId,
          kidId,
          deviceId,
          kind: 'kid_message',
          at: row.createdAt,
          payload: { messageId: body.id, body: body.body },
        })
        .returning({ id: events.id });
      if (!event) throw new Error('event insert returned nothing');
      const [message] = await selectMessages(tx, eq(kidMessages.id, body.id));
      return { message, eventId: event.id };
    });
    if (!result.message) throw new Error('message vanished after insert');
    if (!result.eventId) return c.json(result.message, 200);
    await notifyParents(deps, familyId, [result.eventId]);
    return c.json(result.message, 201);
  });

  app.openapi(listMessagesRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { kidId, before, limit } = c.req.valid('query');
    const rows = await withFamily(db, familyId, (tx) =>
      selectMessages(
        tx,
        and(
          kidId ? eq(kidMessages.kidId, kidId) : undefined,
          before
            ? sql`(${kidMessages.createdAt}, ${kidMessages.id}) < (select m.created_at, m.id from ${kidMessages} m where m.id = ${before})`
            : undefined,
        ),
        limit + 1,
      ),
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return c.json({ messages: page, nextBefore: rows.length > limit && last ? last.id : null }, 200);
  });
}
