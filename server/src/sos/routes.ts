import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, gt, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import {
  Sos,
  type SosAck,
  SosDetail,
  SosLocation,
  SosLocationsUpload,
  type SosMessage,
  SosStart,
  type SosStatus,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, families, kids, parents, sosAcks, sosIncidents, sosLocations } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { notifyParents, sendToDevices } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const IdParam = z.object({ id: z.uuid() });
const SosQuery = z.object({
  active: z.enum(['true', 'false']).optional(),
  kidId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** An SOS stops by itself this long after it starts; each extend adds the same again (docs/SPEC.md §15). */
const RUN_FOR = sql`interval '2 hours'`;
/** FCM keeps trying to reach the phone for this long. */
const PHONE_TTL_SEC = 7200;

const startRoute = createRoute({
  method: 'post',
  path: '/v1/device/sos',
  tags: ['device'],
  summary: 'Start an SOS',
  description:
    'Phones only. Every parent app gets a critical push and every parent an email. While the kid has an active SOS → 409. Sending the same `id` again returns the stored SOS with 200.',
  security: deviceBearer,
  request: { body: jsonBody(SosStart) },
  responses: {
    201: jsonResponse('The parents are being told.', Sos),
    200: jsonResponse('Already stored with this id.', Sos),
    ...errorResponses(401, 409, 422),
  },
});

const locationsRoute = createRoute({
  method: 'post',
  path: '/v1/device/sos/{id}/locations',
  tags: ['device'],
  summary: 'Add positions to an SOS',
  description: 'Also after it ended, for positions that were queued. A position with the same `at` as a stored one is skipped.',
  security: deviceBearer,
  request: { params: IdParam, body: jsonBody(SosLocationsUpload) },
  responses: { 204: { description: 'Stored.' }, ...errorResponses(401, 404, 422) },
});

const deviceEndRoute = createRoute({
  method: 'post',
  path: '/v1/device/sos/{id}/end',
  tags: ['device'],
  summary: '"I\'m safe": end an SOS',
  description: 'An SOS that has already ended is fine too.',
  security: deviceBearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Ended.' }, ...errorResponses(401, 404, 422) },
});

const listRoute = createRoute({
  method: 'get',
  path: '/v1/sos',
  tags: ['sos'],
  summary: 'SOS alerts',
  description: 'Newest first, archived kids included. `active=true` gives only the ones still on. `limit` defaults to 50.',
  security: bearer,
  request: { query: SosQuery },
  responses: { 200: jsonResponse('The SOS alerts.', z.array(Sos)), ...errorResponses(401, 403, 422) },
});

const getRoute = createRoute({
  method: 'get',
  path: '/v1/sos/{id}',
  tags: ['sos'],
  summary: 'One SOS with every position',
  description: 'Parent apps read this every 30 seconds while the SOS screen is open.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The SOS.', SosDetail), ...errorResponses(401, 403, 404, 422) },
});

const ackRoute = createRoute({
  method: 'post',
  path: '/v1/sos/{id}/ack',
  tags: ['sos'],
  summary: '"I\'m on it"',
  description: 'The phone shows "Dad has seen your SOS". Tapping it again changes nothing. An SOS that has ended → 409.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The SOS.', Sos), ...errorResponses(401, 403, 404, 409, 422) },
});

const extendRoute = createRoute({
  method: 'post',
  path: '/v1/sos/{id}/extend',
  tags: ['sos'],
  summary: 'Keep an SOS on for 2 more hours',
  description: 'Moves `autoStopAt` 2 hours later. An SOS that has ended → 409.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The SOS.', Sos), ...errorResponses(401, 403, 404, 409, 422) },
});

const endRoute = createRoute({
  method: 'post',
  path: '/v1/sos/{id}/end',
  tags: ['sos'],
  summary: 'End an SOS',
  description: 'An SOS that has already ended → 409.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The SOS.', Sos), ...errorResponses(401, 403, 404, 409, 422) },
});

const sosNotFound = () => new ApiError('not_found', 'No such SOS in your family.');
const sosEnded = () => new ApiError('conflict', 'This SOS has ended.');

/** Not ended, and not past its auto stop, by the database clock. */
const isActive = and(isNull(sosIncidents.endedAt), gt(sosIncidents.autoStopAt, sql`now()`));
const statusSql = sql<SosStatus>`case when ${sosIncidents.endedAt} is null and ${sosIncidents.autoStopAt} > now()
  then 'active' else 'ended' end`;

function toLocation(l: typeof sosLocations.$inferSelect): SosLocation {
  return {
    at: l.at.toISOString(),
    lat: l.lat,
    lng: l.lng,
    accuracyM: l.accuracyM,
    batteryPct: l.batteryPct,
    via: l.via as SosLocation['via'],
  };
}

/** SOS alerts with names, newest position and acks, newest first. */
async function selectIncidents(tx: FamilyTx, where: SQL | undefined, limit?: number): Promise<Sos[]> {
  const query = tx
    .select({
      sos: sosIncidents,
      status: statusSql,
      kidName: kids.name,
      deviceName: devices.name,
      endedByName: parents.displayName,
    })
    .from(sosIncidents)
    .innerJoin(kids, eq(kids.id, sosIncidents.kidId))
    .innerJoin(devices, eq(devices.id, sosIncidents.deviceId))
    .leftJoin(parents, eq(parents.id, sosIncidents.endedByParent))
    .where(where)
    .orderBy(desc(sosIncidents.startedAt), desc(sosIncidents.id));
  const rows = await (limit === undefined ? query : query.limit(limit));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.sos.id);
  const last = await tx
    .selectDistinctOn([sosLocations.sosId])
    .from(sosLocations)
    .where(inArray(sosLocations.sosId, ids))
    .orderBy(sosLocations.sosId, desc(sosLocations.at), desc(sosLocations.id));
  const acks = await tx
    .select({ sosId: sosAcks.sosId, parentId: sosAcks.parentId, byName: parents.displayName, at: sosAcks.at })
    .from(sosAcks)
    .innerJoin(parents, eq(parents.id, sosAcks.parentId))
    .where(inArray(sosAcks.sosId, ids))
    .orderBy(asc(sosAcks.at), asc(parents.displayName));
  return rows.map(({ sos: s, status, kidName, deviceName, endedByName }): Sos => {
    const location = last.find((l) => l.sosId === s.id);
    return {
      id: s.id,
      kidId: s.kidId,
      kidName,
      deviceId: s.deviceId,
      deviceName,
      status,
      startedAt: s.startedAt.toISOString(),
      autoStopAt: s.autoStopAt.toISOString(),
      // Nobody ended an SOS that ran out: it ended at its auto stop.
      endedAt: s.endedAt?.toISOString() ?? (status === 'ended' ? s.autoStopAt.toISOString() : null),
      endedBy: (s.endedByKind as Sos['endedBy']) ?? (status === 'ended' ? 'auto' : null),
      endedByName,
      lastLocation: location ? toLocation(location) : null,
      acks: acks
        .filter((a) => a.sosId === s.id)
        .map((a): SosAck => ({ parentId: a.parentId, byName: a.byName, at: a.at.toISOString() })),
    };
  });
}

async function selectIncident(tx: FamilyTx, id: string) {
  const [sos] = await selectIncidents(tx, eq(sosIncidents.id, id));
  return sos ?? null;
}

/** The family's SOS with this id, or 404. */
async function findIncident(tx: FamilyTx, id: string) {
  const sos = await selectIncident(tx, id);
  if (!sos) throw sosNotFound();
  return sos;
}

/** This device's SOS with this id, or 404 (another device's SOS is not its business). */
async function ownIncident(tx: FamilyTx, id: string, deviceId: string) {
  const [row] = await tx.select({ deviceId: sosIncidents.deviceId }).from(sosIncidents).where(eq(sosIncidents.id, id));
  if (!row || row.deviceId !== deviceId) throw new ApiError('not_found', 'No such SOS on this device.');
}

async function writeEvent(tx: FamilyTx, familyId: string, sos: Sos, kind: string, payload: Record<string, unknown>) {
  const [event] = await tx
    .insert(events)
    .values({ familyId, kidId: sos.kidId, deviceId: sos.deviceId, kind, at: sql`now()`, payload })
    .returning({ id: events.id });
  if (!event) throw new Error('event insert returned nothing');
  return event.id;
}

async function parentName(tx: FamilyTx, parentId: string) {
  const [row] = await tx.select({ name: parents.displayName }).from(parents).where(eq(parents.id, parentId));
  if (!row) throw new Error('parent vanished after requireFamilyParent');
  return row.name;
}

/** "3:04 pm" in the family's time zone. */
function clockTime(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(
    new Date(iso),
  );
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`;
}

/** The text of the SOS email backup (docs/SPEC.md §15 step 3). */
export function sosEmail(sos: Sos, timeZone: string) {
  const loc = sos.lastLocation;
  const where = loc
    ? `Location: https://maps.google.com/?q=${loc.lat},${loc.lng}${loc.accuracyM === null ? '' : ` (±${Math.round(loc.accuracyM)} m)`}.`
    : 'Location: not known yet.';
  const battery = loc?.batteryPct == null ? '' : ` Battery ${loc.batteryPct}%.`;
  return {
    subject: `SOS from ${sos.kidName}`,
    text: `${sos.kidName} pressed SOS at ${clockTime(sos.startedAt, timeZone)}.\n${where}${battery}\n\nOpen the ScreenTime app to see where ${sos.kidName} is and to answer.\n`,
  };
}

/**
 * SOS (docs/SPEC.md §15, Q31): the phone has already texted the parents; the server adds a critical push and an
 * email, keeps the positions, and passes "I'm on it", extend and end between parents and the phone.
 */
export function registerSosRoutes(app: Router, deps: AppDeps) {
  const { db, config, mailer } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  /** Emails every enabled parent. A failed email is logged: the push and the phone's SMS went too. */
  async function emailParents(familyId: string, sos: Sos) {
    if (!mailer.sendAlert) return;
    const { to, timezone } = await withFamily(db, familyId, async (tx) => {
      const [family] = await tx.select({ timezone: families.timezone }).from(families).where(eq(families.id, familyId));
      const rows = await tx.select({ email: parents.email }).from(parents).where(isNull(parents.disabledAt));
      return { to: rows.map((r) => r.email), timezone: family?.timezone ?? 'UTC' };
    });
    const { subject, text } = sosEmail(sos, timezone);
    for (const email of to) {
      try {
        await mailer.sendAlert(email, subject, text);
      } catch (err) {
        console.error('SOS email failed', err);
      }
    }
  }

  /** Tells the phone that raised the SOS, at high priority. */
  async function tellPhone(familyId: string, sos: Sos, type: string, data: SosMessage) {
    await sendToDevices(
      deps,
      familyId,
      { deviceId: sos.deviceId },
      { v: 1, type, at: new Date().toISOString(), data },
      { high: true, ttlSec: PHONE_TTL_SEC },
    );
  }

  app.openapi(startRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      const [stored] = await tx.select({ deviceId: sosIncidents.deviceId }).from(sosIncidents).where(eq(sosIncidents.id, body.id));
      if (stored) {
        if (stored.deviceId !== deviceId) throw new ApiError('conflict', 'That SOS id is already used.');
        return { sos: await findIncident(tx, body.id), eventId: null };
      }
      const [device] = await tx.select({ form: devices.form }).from(devices).where(eq(devices.id, deviceId));
      if (!device) throw new Error('device vanished after requireDevice');
      if (device.form !== 'phone') throw new ApiError('conflict', 'SOS is only on phones.');
      const [active] = await tx
        .select({ id: sosIncidents.id })
        .from(sosIncidents)
        .where(and(eq(sosIncidents.kidId, kidId), isActive));
      if (active) throw new ApiError('conflict', 'An SOS is already on.');

      const start = sql`least(${body.startedAt}::timestamptz, now())`;
      await tx
        .insert(sosIncidents)
        .values({ id: body.id, familyId, kidId, deviceId, startedAt: start, autoStopAt: sql`${start} + ${RUN_FOR}` });
      const loc = body.location;
      if (loc) {
        await tx.insert(sosLocations).values({
          familyId,
          sosId: body.id,
          at: new Date(loc.at),
          lat: loc.lat,
          lng: loc.lng,
          accuracyM: loc.accuracyM ?? null,
          batteryPct: loc.batteryPct ?? null,
          via: loc.via,
        });
      }
      const sos = await findIncident(tx, body.id);
      const eventId = await writeEvent(tx, familyId, sos, 'sos.started', {
        sosId: sos.id,
        startedAt: sos.startedAt,
        location: sos.lastLocation,
      });
      return { sos, eventId };
    });
    if (!result.eventId) return c.json(result.sos, 200);
    await notifyParents(deps, familyId, [result.eventId]);
    await emailParents(familyId, result.sos);
    return c.json(result.sos, 201);
  });

  app.openapi(locationsRoute, async (c) => {
    const { deviceId, familyId } = await requireDevice(c, db);
    const { id } = c.req.valid('param');
    const { locations } = c.req.valid('json');
    await withFamily(db, familyId, async (tx) => {
      await ownIncident(tx, id, deviceId);
      // A phone that retries an upload sends the same positions again.
      const have = await tx
        .select({ at: sosLocations.at })
        .from(sosLocations)
        .where(and(eq(sosLocations.sosId, id), inArray(sosLocations.at, locations.map((l) => new Date(l.at)))));
      const seen = new Set(have.map((h) => h.at.getTime()));
      const fresh = locations.filter((l) => {
        const t = new Date(l.at).getTime();
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      });
      if (fresh.length === 0) return;
      await tx.insert(sosLocations).values(
        fresh.map((l) => ({
          familyId,
          sosId: id,
          at: new Date(l.at),
          lat: l.lat,
          lng: l.lng,
          accuracyM: l.accuracyM ?? null,
          batteryPct: l.batteryPct ?? null,
          via: l.via,
        })),
      );
    });
    return c.body(null, 204);
  });

  app.openapi(deviceEndRoute, async (c) => {
    const { deviceId, familyId } = await requireDevice(c, db);
    const { id } = c.req.valid('param');
    const eventId = await withFamily(db, familyId, async (tx) => {
      await ownIncident(tx, id, deviceId);
      const [ended] = await tx
        .update(sosIncidents)
        .set({ endedAt: sql`now()`, endedByKind: 'kid' })
        .where(and(eq(sosIncidents.id, id), isActive))
        .returning({ id: sosIncidents.id });
      if (!ended) return null;
      return writeEvent(tx, familyId, await findIncident(tx, id), 'sos.ended', { sosId: id, endedBy: 'kid', byName: null });
    });
    if (eventId) await notifyParents(deps, familyId, [eventId]);
    return c.body(null, 204);
  });

  app.openapi(listRoute, async (c) => {
    const { familyId } = await caller(c);
    const { active, kidId, limit } = c.req.valid('query');
    const rows = await withFamily(db, familyId, (tx) =>
      selectIncidents(
        tx,
        and(
          active === 'true' ? isActive : undefined,
          active === 'false' ? sql`not (${isActive})` : undefined,
          kidId ? eq(sosIncidents.kidId, kidId) : undefined,
        ),
        limit,
      ),
    );
    return c.json(rows, 200);
  });

  app.openapi(getRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const detail = await withFamily(db, familyId, async (tx) => {
      const sos = await findIncident(tx, id);
      const rows = await tx
        .select()
        .from(sosLocations)
        .where(eq(sosLocations.sosId, id))
        .orderBy(asc(sosLocations.at), asc(sosLocations.id));
      return { ...sos, locations: rows.map(toLocation) };
    });
    return c.json(detail, 200);
  });

  app.openapi(ackRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    const result = await withFamily(db, familyId, async (tx) => {
      const before = await findIncident(tx, id);
      if (before.status === 'ended') throw sosEnded();
      const [added] = await tx
        .insert(sosAcks)
        .values({ familyId, sosId: id, parentId })
        .onConflictDoNothing()
        .returning({ at: sosAcks.at });
      const sos = await findIncident(tx, id);
      if (!added) return { sos, eventId: null, byName: '' };
      const byName = await parentName(tx, parentId);
      return { sos, eventId: await writeEvent(tx, familyId, sos, 'sos.acked', { sosId: id, byName }), byName };
    });
    if (result.eventId) {
      // The other parent knows someone is on it; the phone shows "Dad has seen your SOS".
      await notifyParents(deps, familyId, [result.eventId]);
      await tellPhone(familyId, result.sos, 'sos_ack', { sosId: id, byName: result.byName });
    }
    return c.json(result.sos, 200);
  });

  app.openapi(extendRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    const result = await withFamily(db, familyId, async (tx) => {
      await findIncident(tx, id);
      const [moved] = await tx
        .update(sosIncidents)
        .set({ autoStopAt: sql`${sosIncidents.autoStopAt} + ${RUN_FOR}` })
        .where(and(eq(sosIncidents.id, id), isActive))
        .returning({ id: sosIncidents.id });
      if (!moved) throw sosEnded();
      const sos = await findIncident(tx, id);
      const byName = await parentName(tx, parentId);
      const eventId = await writeEvent(tx, familyId, sos, 'sos.extended', { sosId: id, autoStopAt: sos.autoStopAt, byName });
      return { sos, eventId, byName };
    });
    await notifyParents(deps, familyId, [result.eventId]);
    await tellPhone(familyId, result.sos, 'sos_extended', { sosId: id, byName: result.byName, autoStopAt: result.sos.autoStopAt });
    return c.json(result.sos, 200);
  });

  app.openapi(endRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    const result = await withFamily(db, familyId, async (tx) => {
      await findIncident(tx, id);
      // Two parents ending at once: the second waits for the first one's row lock, then matches nothing.
      const [ended] = await tx
        .update(sosIncidents)
        .set({ endedAt: sql`now()`, endedByKind: 'parent', endedByParent: parentId })
        .where(and(eq(sosIncidents.id, id), isActive))
        .returning({ id: sosIncidents.id });
      if (!ended) throw sosEnded();
      const sos = await findIncident(tx, id);
      const byName = sos.endedByName ?? (await parentName(tx, parentId));
      const eventId = await writeEvent(tx, familyId, sos, 'sos.ended', { sosId: id, endedBy: 'parent', byName });
      return { sos, eventId, byName };
    });
    await notifyParents(deps, familyId, [result.eventId]);
    await tellPhone(familyId, result.sos, 'sos_ended', { sosId: id, byName: result.byName });
    return c.json(result.sos, 200);
  });
}
