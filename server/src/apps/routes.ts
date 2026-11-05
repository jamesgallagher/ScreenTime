import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DeviceAppsPut, KidApps, type KidApp } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { withFamily } from '../db/family.js';
import { deviceApps, devices, events } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { findKid } from '../kids/routes.js';
import { notifyParents } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const putDeviceAppsRoute = createRoute({
  method: 'put',
  path: '/v1/device/apps',
  tags: ['device'],
  summary: "Send the device's whole app list",
  description:
    'The first list is the baseline and raises nothing. After that a new app writes `app.installed`, and a first `firstUsedAt` writes `app.first_used`. An app left out is marked removed. Android only.',
  security: deviceBearer,
  request: { body: jsonBody(DeviceAppsPut) },
  responses: { 204: { description: 'Stored.' }, ...errorResponses(401, 409, 422) },
});

const getKidAppsRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}/apps',
  tags: ['kids'],
  summary: "A kid's apps across their Android devices",
  security: bearer,
  request: { params: z.object({ kidId: z.uuid() }) },
  responses: { 200: jsonResponse('The apps.', KidApps), ...errorResponses(401, 403, 404, 422) },
});

/** A device clock can be ahead; nothing is stored as happening in the future. */
function notFuture(at: Date, now: Date): Date {
  return at < now ? at : now;
}

/** Earlier than [other], or [other] when there is nothing to compare. */
function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/** The app list, and install and first-use alerts (docs/SPEC.md §12.4, Q34). Android only. */
export function registerAppRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(putDeviceAppsRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const now = new Date();
    const eventIds = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId));
      if (!device) throw new Error('device vanished after requireDevice');
      if (device.platform !== 'android') throw new ApiError('conflict', 'Apps are only on Android devices.');
      const known = await tx.select().from(deviceApps).where(eq(deviceApps.deviceId, deviceId));
      const byPackage = new Map(known.map((row) => [row.package, row]));
      // The device's first list: what is already there raises nothing.
      const baseline = known.length === 0;
      const toWrite: { kind: string; at: Date; payload: Record<string, unknown> }[] = [];

      for (const a of body.apps) {
        const row = byPackage.get(a.package);
        const installedAt = notFuture(new Date(a.installedAt), now);
        const seenFirstUse = a.firstUsedAt ? notFuture(new Date(a.firstUsedAt), now) : null;
        const firstUsedAt = earliest(row?.firstUsedAt ?? null, seenFirstUse);
        const payload = { package: a.package, label: a.label, source: a.source, deviceName: device.name };
        if (!baseline && (!row || row.removedAt)) toWrite.push({ kind: 'app.installed', at: installedAt, payload });
        if (!baseline && seenFirstUse && !row?.firstUsedAt) {
          toWrite.push({
            kind: 'app.first_used',
            at: seenFirstUse,
            payload: { package: a.package, label: a.label, deviceName: device.name },
          });
        }
        const values = {
          label: a.label,
          source: a.source,
          installer: a.installer,
          blockable: a.blockable,
          installedAt,
          firstUsedAt,
          removedAt: null,
        };
        await tx
          .insert(deviceApps)
          .values({ familyId, kidId, deviceId, package: a.package, baseline, firstSeenAt: now, ...values })
          .onConflictDoUpdate({ target: [deviceApps.deviceId, deviceApps.package], set: values });
      }

      const sent = new Set(body.apps.map((a) => a.package));
      for (const row of known) {
        if (sent.has(row.package) || row.removedAt) continue;
        await tx
          .update(deviceApps)
          .set({ removedAt: now })
          .where(and(eq(deviceApps.deviceId, deviceId), eq(deviceApps.package, row.package)));
      }

      if (toWrite.length === 0) return [];
      const stored = await tx
        .insert(events)
        .values(toWrite.map((e) => ({ familyId, kidId, deviceId, ...e })))
        .returning({ id: events.id });
      return stored.map((e) => e.id);
    });
    await notifyParents(deps, familyId, eventIds);
    return c.body(null, 204);
  });

  app.openapi(getKidAppsRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { kidId } = c.req.valid('param');
    const rows = await withFamily(db, familyId, async (tx) => {
      const kid = await findKid(tx, kidId);
      if (!kid) throw new ApiError('not_found', 'No such kid.');
      return tx
        .select({ app: deviceApps, deviceName: devices.name })
        .from(deviceApps)
        .innerJoin(devices, eq(devices.id, deviceApps.deviceId))
        .where(and(eq(deviceApps.kidId, kidId), isNull(devices.revokedAt)))
        .orderBy(asc(deviceApps.label), asc(devices.name));
    });
    const apps = new Map<string, KidApp>();
    for (const { app: row, deviceName } of rows) {
      const entry = apps.get(row.package) ?? {
        package: row.package,
        label: row.label,
        source: row.source as KidApp['source'],
        blockable: true,
        todaySeconds: 0,
        devices: [],
      };
      // A phone's Settings may be listed where a tablet's is not: it can be blocked only if every device can.
      entry.blockable = entry.blockable && row.blockable;
      entry.devices.push({
        deviceId: row.deviceId,
        deviceName,
        installedAt: row.installedAt.toISOString(),
        firstUsedAt: row.firstUsedAt?.toISOString() ?? null,
        removedAt: row.removedAt?.toISOString() ?? null,
      });
      apps.set(row.package, entry);
    }
    return c.json({ newAppApproval: false, apps: [...apps.values()] }, 200);
  });
}
