import { createHash } from 'node:crypto';
import { createRoute } from '@hono/zod-openapi';
import { and, asc, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import {
  type AvatarColor,
  type DeviceForm,
  DeviceState,
  type Pool,
  Today,
  UsageReceipt,
  type UsageSegmentIn,
  UsageUpload,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { withFamily } from '../db/family.js';
import {
  devices,
  families,
  grants,
  kidContacts,
  kids,
  messagePresets,
  parentModeSessions,
  parents,
  scheduleVersions,
  sosIncidents,
  timeRequests,
  usageSegments,
} from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { toSchedule } from '../kids/routes.js';
import { notifyParents, stateChanged } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { activeParentModes, dayGrants, daySegments, familyDay, poolStatus } from './day.js';
import { recordOverspend } from './overspend.js';

type Router = ReturnType<typeof createRouter>;

const POOLS: Pool[] = ['screens', 'phone'];

const stateRoute = createRoute({
  method: 'get',
  path: '/v1/device/state',
  tags: ['device'],
  summary: 'Everything this device needs to enforce',
  description:
    'Send the last `stateVersion` as `If-None-Match` to get 304 when nothing changed. A 304 has no body; use its `Date` header as the server time.',
  security: deviceBearer,
  responses: {
    200: {
      ...jsonResponse('The snapshot.', DeviceState),
      headers: { ETag: { description: 'The `stateVersion` in quotes.', schema: { type: 'string' } } },
    },
    304: { description: 'Nothing changed since the `stateVersion` sent in `If-None-Match`.' },
    ...errorResponses(401),
  },
});

const usageRoute = createRoute({
  method: 'post',
  path: '/v1/device/usage',
  tags: ['device'],
  summary: 'Upload usage segments',
  description:
    'Safe to send again. A segment sent again keeps its first `startedAt` and the latest `endedAt`; once closed it never reopens.',
  security: deviceBearer,
  request: { body: jsonBody(UsageUpload) },
  responses: { 200: jsonResponse('Stored.', UsageReceipt), ...errorResponses(401, 422) },
});

const todayRoute = createRoute({
  method: 'get',
  path: '/v1/today',
  tags: ['parent'],
  summary: 'Used and remaining time today for every kid and pool',
  security: bearer,
  responses: { 200: jsonResponse('The dashboard.', Today), ...errorResponses(401, 403) },
});

/** True if the `If-None-Match` header names this version. Proxies may weaken the tag to `W/"..."`. */
function matchesVersion(header: string | undefined, version: string) {
  if (!header) return false;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '').replace(/"/g, '') === version);
}

/** The later of two end times. An open end (null) only wins when both are open: a closed segment never reopens. */
function laterEnd(a: string | null, b: string | null) {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Joins repeats of one segment id in a single upload, by the same rule the database applies. */
function mergeRepeats(segments: UsageSegmentIn[]) {
  const byId = new Map<string, UsageSegmentIn>();
  for (const s of segments) {
    const prev = byId.get(s.id);
    if (!prev) {
      byId.set(s.id, s);
      continue;
    }
    byId.set(s.id, {
      ...prev,
      endedAt: laterEnd(prev.endedAt, s.endedAt),
      recordedOffline: prev.recordedOffline || s.recordedOffline,
    });
  }
  return [...byId.values()];
}

/** The device state snapshot, usage upload and the parent dashboard (docs/SPEC.md §8, §9.2, §9.3). */
export function registerSyncRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(stateRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const state = await withFamily(db, familyId, async (tx) => {
      const [row] = await tx
        .select({ device: devices, kid: kids, family: families })
        .from(devices)
        .innerJoin(kids, eq(kids.id, devices.kidId))
        .innerJoin(families, eq(families.id, devices.familyId))
        .where(eq(devices.id, deviceId));
      if (!row) throw new Error('device vanished after requireDevice');
      const { device, kid, family } = row;
      const pool = device.pool as Pool;
      const day = await familyDay(tx, family.timezone);

      const [schedule] = await tx
        .select()
        .from(scheduleVersions)
        .where(eq(scheduleVersions.kidId, kidId))
        .orderBy(desc(scheduleVersions.version))
        .limit(1);
      if (!schedule) throw new Error(`kid ${kidId} has no schedule`);
      const familyParents = await tx
        .select({ id: parents.id, displayName: parents.displayName, phoneE164: parents.phoneE164 })
        .from(parents)
        .where(isNull(parents.disabledAt))
        .orderBy(asc(parents.createdAt), asc(parents.id));
      const contacts = await tx
        .select({ label: kidContacts.label, phoneE164: kidContacts.phoneE164 })
        .from(kidContacts)
        .where(eq(kidContacts.kidId, kidId))
        .orderBy(asc(kidContacts.sort), asc(kidContacts.id));
      const presets = await tx
        .select({ id: messagePresets.id, text: messagePresets.text })
        .from(messagePresets)
        .orderBy(asc(messagePresets.sort), asc(messagePresets.id));
      const poolGrants = await dayGrants(tx, day, and(eq(grants.kidId, kidId), eq(grants.pool, pool)));
      const poolSegments = await daySegments(tx, day, and(eq(usageSegments.kidId, kidId), eq(usageSegments.pool, pool)));
      const [parentMode] = await activeParentModes(tx, eq(parentModeSessions.deviceId, deviceId));
      const [pending] = await tx
        .select({ id: timeRequests.id, minutes: timeRequests.minutes, createdAt: timeRequests.createdAt })
        .from(timeRequests)
        .where(
          and(
            eq(timeRequests.kidId, kidId),
            eq(timeRequests.pool, pool),
            eq(timeRequests.status, 'pending'),
            gte(timeRequests.createdAt, day.dayStart),
          ),
        )
        .orderBy(desc(timeRequests.createdAt))
        .limit(1);
      const [sos] = await tx
        .select({ id: sosIncidents.id, startedAt: sosIncidents.startedAt })
        .from(sosIncidents)
        .where(and(eq(sosIncidents.kidId, kidId), isNull(sosIncidents.endedAt), gt(sosIncidents.autoStopAt, sql`now()`)))
        .orderBy(desc(sosIncidents.startedAt))
        .limit(1);

      return {
        serverTime: day.now.toISOString(),
        content: {
          device: { id: device.id, name: device.name, form: device.form as DeviceForm, pool, hasCellular: device.hasCellular },
          kid: { id: kid.id, name: kid.name },
          family: { timezone: family.timezone, emergencyNumber: family.emergencyNumber, parentCodeSecret: family.parentCodeSecret },
          parents: familyParents,
          contacts,
          messagePresets: presets,
          schedule: toSchedule(schedule),
          today: {
            date: day.date,
            grants: poolGrants.map((g) => ({ id: g.id, minutes: g.minutes, createdAt: g.createdAt.toISOString(), byName: g.byName })),
            poolSegments: poolSegments.map((s) => ({
              id: s.id,
              deviceId: s.deviceId,
              startedAt: s.startedAt.toISOString(),
              endedAt: s.endedAt?.toISOString() ?? null,
            })),
          },
          parentMode: parentMode
            ? { active: true, endsAt: parentMode.endsAt?.toISOString() ?? null, byName: parentMode.byName }
            : { active: false, endsAt: null, byName: null },
          pendingRequest: pending ? { id: pending.id, minutes: pending.minutes, createdAt: pending.createdAt.toISOString() } : null,
          activeSos: sos ? { id: sos.id, startedAt: sos.startedAt.toISOString() } : null,
        },
      };
    });

    // The version covers everything except the clock, so it only changes when the device must act.
    const stateVersion = createHash('sha256').update(JSON.stringify(state.content)).digest('hex').slice(0, 32);
    c.header('ETag', `"${stateVersion}"`);
    if (matchesVersion(c.req.header('if-none-match'), stateVersion)) return c.body(null, 304);
    return c.json({ serverTime: state.serverTime, stateVersion, ...state.content }, 200);
  });

  app.openapi(usageRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const segments = mergeRepeats(c.req.valid('json').segments);
    const stored = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx.select({ pool: devices.pool }).from(devices).where(eq(devices.id, deviceId));
      if (!device) throw new Error('device vanished after requireDevice');
      const rows = await tx
        .insert(usageSegments)
        .values(
          segments.map((s) => ({
            id: s.id,
            familyId,
            kidId,
            deviceId,
            // A segment stays in the pool the device had when the segment first arrived.
            pool: device.pool,
            startedAt: new Date(s.startedAt),
            endedAt: s.endedAt === null ? null : new Date(s.endedAt),
            recordedOffline: s.recordedOffline,
          })),
        )
        .onConflictDoUpdate({
          target: usageSegments.id,
          set: {
            endedAt: sql`case
              when ${usageSegments.endedAt} is null then excluded.ended_at
              when excluded.ended_at is null then ${usageSegments.endedAt}
              else greatest(${usageSegments.endedAt}, excluded.ended_at) end`,
            recordedOffline: sql`${usageSegments.recordedOffline} or excluded.recorded_offline`,
            receivedAt: sql`now()`,
          },
          // Another device's segment with the same id is left alone.
          setWhere: sql`${usageSegments.deviceId} = excluded.device_id`,
        })
        .returning({ id: usageSegments.id });
      const storedIds = new Set(rows.map((r) => r.id));
      const offline = segments.some((s) => s.recordedOffline && storedIds.has(s.id));
      return {
        received: rows.length,
        pool: device.pool as Pool,
        overspendEventId: offline ? await recordOverspend(tx, kidId, deviceId) : null,
      };
    });
    if (stored.overspendEventId) await notifyParents(deps, familyId, [stored.overspendEventId]);
    // The kid's other devices in this pool count these segments too. WebSocket only: this comes every minute.
    if (stored.received > 0) {
      await stateChanged(deps, familyId, { kidId, pool: stored.pool, exceptDeviceId: deviceId }, false);
    }
    return c.json({ received: stored.received }, 200);
  });

  app.openapi(todayRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const today = await withFamily(db, familyId, async (tx) => {
      const [family] = await tx.select().from(families).where(eq(families.id, familyId));
      if (!family) throw new Error('family vanished after requireFamilyParent');
      const day = await familyDay(tx, family.timezone);
      const kidRows = await tx.select().from(kids).where(isNull(kids.archivedAt)).orderBy(asc(kids.createdAt), asc(kids.id));
      const schedules = await tx
        .selectDistinctOn([scheduleVersions.kidId])
        .from(scheduleVersions)
        .orderBy(scheduleVersions.kidId, desc(scheduleVersions.version));
      const deviceRows = await tx
        .select()
        .from(devices)
        .where(isNull(devices.revokedAt))
        .orderBy(asc(devices.enrolledAt), asc(devices.id));
      const allGrants = await dayGrants(tx, day);
      const allSegments = await daySegments(tx, day);
      const modes = await activeParentModes(tx);

      return {
        serverTime: day.now.toISOString(),
        date: day.date,
        kids: kidRows.map((kid) => {
          const scheduleRow = schedules.find((s) => s.kidId === kid.id);
          if (!scheduleRow) throw new Error(`kid ${kid.id} has no schedule`);
          const schedule = toSchedule(scheduleRow);
          return {
            id: kid.id,
            name: kid.name,
            avatarColor: kid.avatarColor as AvatarColor,
            pools: POOLS.map((pool) => {
              const poolGrants = allGrants.filter((g) => g.kidId === kid.id && g.pool === pool);
              const poolSegments = allSegments.filter((s) => s.kidId === kid.id && s.pool === pool);
              const status = poolStatus(family.timezone, day, schedule, pool, poolGrants, poolSegments);
              return {
                pool,
                allowanceMin: status.allowanceMin,
                grantedMin: poolGrants.reduce((sum, g) => sum + g.minutes, 0),
                usedSec: status.usedSec,
                remainingSec: status.remainingSec,
                locked: status.locked,
                lockReason: status.lockReason,
                nextLockAt: status.nextLockAt,
                overspendSec: status.overspendSec,
                devices: deviceRows
                  .filter((d) => d.kidId === kid.id && d.pool === pool)
                  .map((d) => {
                    const mode = modes.find((m) => m.deviceId === d.id);
                    return {
                      id: d.id,
                      name: d.name,
                      form: d.form as DeviceForm,
                      inUse: poolSegments.some((s) => s.deviceId === d.id && s.endedAt === null),
                      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
                      parentMode: mode ? { endsAt: mode.endsAt?.toISOString() ?? null, byName: mode.byName } : null,
                    };
                  }),
              };
            }),
          };
        }),
      };
    });
    return c.json(today, 200);
  });
}
