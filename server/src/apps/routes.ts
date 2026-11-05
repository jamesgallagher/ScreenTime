import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type AppRuleMode, AppRulePut, AppRuleSaved, DeviceAppsPut, DeviceAppUsageUpload, KidApps, KidAppSettings, type KidApp } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { withFamily } from '../db/family.js';
import { appRules, appUsageDaily, deviceApps, devices, events, families, kids, parents } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { findKid } from '../kids/routes.js';
import { notifyParents, stateChanged } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { familyDay } from '../sync/day.js';

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

const postUsageRoute = createRoute({
  method: 'post',
  path: '/v1/device/app-usage',
  tags: ['device'],
  summary: "Send the device's seconds per app per day",
  description: 'A repeat or an older upload never lowers a value. Android only.',
  security: deviceBearer,
  request: { body: jsonBody(DeviceAppUsageUpload) },
  responses: { 204: { description: 'Stored.' }, ...errorResponses(401, 409, 422) },
});

const putRuleRoute = createRoute({
  method: 'put',
  path: '/v1/kids/{kidId}/apps/{package}/rule',
  tags: ['kids'],
  summary: 'Allow, block or limit an app for a kid',
  description:
    'Answering a waiting app also writes `app.answered`. An app on none of the kid\'s devices gets 404, and one that cannot be blocked gets 409.',
  security: bearer,
  request: { params: z.object({ kidId: z.uuid(), package: z.string().min(1).max(255) }), body: jsonBody(AppRulePut) },
  responses: { 200: jsonResponse('The rule.', AppRuleSaved), ...errorResponses(401, 403, 404, 409, 422) },
});

const putSettingsRoute = createRoute({
  method: 'put',
  path: '/v1/kids/{kidId}/app-settings',
  tags: ['kids'],
  summary: 'Turn new app approval on or off for a kid',
  description: 'Apps already waiting keep waiting for an answer.',
  security: bearer,
  request: { params: z.object({ kidId: z.uuid() }), body: jsonBody(KidAppSettings) },
  responses: { 204: { description: 'Saved.' }, ...errorResponses(401, 403, 404, 422) },
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
    let held = false;
    const eventIds = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId));
      if (!device) throw new Error('device vanished after requireDevice');
      if (device.platform !== 'android') throw new ApiError('conflict', 'Apps are only on Android devices.');
      const known = await tx.select().from(deviceApps).where(eq(deviceApps.deviceId, deviceId));
      const byPackage = new Map(known.map((row) => [row.package, row]));
      // The device's first list: what is already there raises nothing.
      const baseline = known.length === 0;
      const [kid] = await tx.select({ newAppApproval: kids.newAppApproval }).from(kids).where(eq(kids.id, kidId));
      const rules = await tx.select({ package: appRules.package }).from(appRules).where(eq(appRules.kidId, kidId));
      const ruled = new Set(rules.map((r) => r.package));
      const toWrite: { kind: string; at: Date; payload: Record<string, unknown> }[] = [];

      for (const a of body.apps) {
        const row = byPackage.get(a.package);
        const installedAt = notFuture(new Date(a.installedAt), now);
        const seenFirstUse = a.firstUsedAt ? notFuture(new Date(a.firstUsedAt), now) : null;
        const firstUsedAt = earliest(row?.firstUsedAt ?? null, seenFirstUse);
        const payload = { package: a.package, label: a.label, source: a.source, deviceName: device.name };
        if (!baseline && (!row || row.removedAt)) {
          // With approval on and no rule yet, the new app waits for a parent (docs/SPEC.md §12.4, Q37).
          const hold = kid?.newAppApproval === true && !ruled.has(a.package);
          if (hold) {
            await tx.insert(appRules).values({ familyId, kidId, package: a.package, mode: 'held' }).onConflictDoNothing();
            ruled.add(a.package);
            held = true;
          }
          toWrite.push({ kind: hold ? 'app.approval' : 'app.installed', at: installedAt, payload });
        }
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
    if (held) await stateChanged(deps, familyId, { kidId });
    return c.body(null, 204);
  });

  app.openapi(postUsageRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const { days } = c.req.valid('json');
    const limitedSent = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx.select({ platform: devices.platform }).from(devices).where(eq(devices.id, deviceId));
      if (device?.platform !== 'android') throw new ApiError('conflict', 'Apps are only on Android devices.');
      const sent = new Set<string>();
      for (const { day, apps } of days) {
        for (const a of apps) {
          sent.add(a.package);
          await tx
            .insert(appUsageDaily)
            .values({ familyId, kidId, deviceId, package: a.package, day, seconds: a.seconds })
            .onConflictDoUpdate({
              target: [appUsageDaily.deviceId, appUsageDaily.package, appUsageDaily.day],
              set: { seconds: sql`greatest(${appUsageDaily.seconds}, excluded.seconds)` },
            });
        }
      }
      if (sent.size === 0) return false;
      const limited = await tx
        .select({ package: appRules.package })
        .from(appRules)
        .where(and(eq(appRules.kidId, kidId), eq(appRules.mode, 'limit'), inArray(appRules.package, [...sent])));
      return limited.length > 0;
    });
    // The other devices count this at their next sync; a live channel that is open hears now. No push: it would be often.
    if (limitedSent) await stateChanged(deps, familyId, { kidId }, false);
    return c.body(null, 204);
  });

  app.openapi(putRuleRoute, async (c) => {
    const { familyId, parentId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { kidId, package: pkg } = c.req.valid('param');
    const { mode, dailyMinutes } = c.req.valid('json');
    const eventIds = await withFamily(db, familyId, async (tx) => {
      if (!(await findKid(tx, kidId))) throw new ApiError('not_found', 'No such kid in your family.');
      const rows = await tx
        .select({ label: deviceApps.label, blockable: deviceApps.blockable })
        .from(deviceApps)
        .innerJoin(devices, eq(devices.id, deviceApps.deviceId))
        .where(and(eq(deviceApps.kidId, kidId), eq(deviceApps.package, pkg), isNull(devices.revokedAt)));
      if (rows.length === 0) throw new ApiError('not_found', 'That app is not on any of this kid\'s devices.');
      if (rows.some((r) => !r.blockable)) throw new ApiError('conflict', 'That app cannot be blocked.');
      const [before] = await tx.select({ mode: appRules.mode }).from(appRules).where(and(eq(appRules.kidId, kidId), eq(appRules.package, pkg)));
      const values = { mode, dailyMinutes, updatedAt: new Date(), updatedBy: parentId };
      await tx
        .insert(appRules)
        .values({ familyId, kidId, package: pkg, ...values })
        .onConflictDoUpdate({ target: [appRules.kidId, appRules.package], set: values });
      if (before?.mode !== 'held') return [];
      const [parent] = await tx.select({ name: parents.displayName }).from(parents).where(eq(parents.id, parentId));
      const stored = await tx
        .insert(events)
        .values({
          familyId,
          kidId,
          kind: 'app.answered',
          at: new Date(),
          payload: { package: pkg, label: rows[0]?.label, approved: mode !== 'blocked', byName: parent?.name ?? null },
        })
        .returning({ id: events.id });
      return stored.map((e) => e.id);
    });
    await notifyParents(deps, familyId, eventIds);
    await stateChanged(deps, familyId, { kidId });
    return c.json({ mode, dailyMinutes }, 200);
  });

  app.openapi(putSettingsRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { kidId } = c.req.valid('param');
    const { newAppApproval } = c.req.valid('json');
    await withFamily(db, familyId, async (tx) => {
      if (!(await findKid(tx, kidId))) throw new ApiError('not_found', 'No such kid.');
      await tx.update(kids).set({ newAppApproval }).where(eq(kids.id, kidId));
    });
    await stateChanged(deps, familyId, { kidId });
    return c.body(null, 204);
  });

  app.openapi(getKidAppsRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { kidId } = c.req.valid('param');
    const { kid, rows, rules, usage } = await withFamily(db, familyId, async (tx) => {
      const kid = await findKid(tx, kidId);
      if (!kid) throw new ApiError('not_found', 'No such kid.');
      const rows = await tx
        .select({ app: deviceApps, deviceName: devices.name })
        .from(deviceApps)
        .innerJoin(devices, eq(devices.id, deviceApps.deviceId))
        .where(and(eq(deviceApps.kidId, kidId), isNull(devices.revokedAt)))
        .orderBy(asc(deviceApps.label), asc(devices.name));
      const rules = await tx.select().from(appRules).where(eq(appRules.kidId, kidId));
      const [family] = await tx.select({ timezone: families.timezone }).from(families);
      const day = await familyDay(tx, family?.timezone ?? 'UTC');
      const usage = await tx
        .select({ package: appUsageDaily.package, seconds: sql<number>`sum(${appUsageDaily.seconds})::int` })
        .from(appUsageDaily)
        .where(and(eq(appUsageDaily.kidId, kidId), eq(appUsageDaily.day, day.date)))
        .groupBy(appUsageDaily.package);
      return { kid, rows, rules, usage };
    });
    const ruleOf = new Map(rules.map((r) => [r.package, { mode: r.mode as AppRuleMode, dailyMinutes: r.dailyMinutes }]));
    const secondsOf = new Map(usage.map((u) => [u.package, u.seconds]));
    const apps = new Map<string, KidApp>();
    for (const { app: row, deviceName } of rows) {
      const entry = apps.get(row.package) ?? {
        package: row.package,
        label: row.label,
        source: row.source as KidApp['source'],
        blockable: true,
        todaySeconds: secondsOf.get(row.package) ?? 0,
        rule: ruleOf.get(row.package) ?? null,
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
    return c.json({ newAppApproval: kid.newAppApproval, apps: [...apps.values()] }, 200);
  });
}
