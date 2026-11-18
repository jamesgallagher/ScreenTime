import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createRoute, z } from '@hono/zod-openapi';
import { eq, sql } from 'drizzle-orm';
import { AppUpdateAnswer, AppUpdateCheck, AppUpdateOffer } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { withFamily } from '../db/family.js';
import { devices, events, parentSessions } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { disconnectDevices, notifyParents } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

/** `kid.json` in the releases folder, written by `android/publish-kid.ps1` after the APK is in place. */
const KidRelease = AppUpdateOffer.extend({
  file: z.string().regex(/^[A-Za-z0-9._-]+\.apk$/),
  /** Only these devices, to try a version on one device first. Left out: every Android device. */
  deviceIds: z.array(z.uuid()).optional(),
});

type KidRelease = z.infer<typeof KidRelease>;

/** `windows.json` in the releases folder, written by `deploy/publish-downloads.ps1 -Windows` after the MSI is in place. */
const WindowsRelease = AppUpdateOffer.extend({
  file: z.string().regex(/^[A-Za-z0-9._-]+\.msi$/),
  /** Only these devices, to try a version on one PC first. Left out: every Windows device. */
  deviceIds: z.array(z.uuid()).optional(),
});

type WindowsRelease = z.infer<typeof WindowsRelease>;

/** The published release, or null when there is none or `kid.json` is not valid (which is logged). */
async function readKidRelease(dir: string | null): Promise<KidRelease | null> {
  if (!dir) return null;
  let text: string;
  try {
    text = await readFile(join(dir, 'kid.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    return KidRelease.parse(JSON.parse(text));
  } catch (err) {
    console.error('kid.json is not valid', err);
    return null;
  }
}

/** The published release, or null when there is none or `windows.json` is not valid (which is logged). */
async function readWindowsRelease(dir: string | null): Promise<WindowsRelease | null> {
  if (!dir) return null;
  let text: string;
  try {
    text = await readFile(join(dir, 'windows.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    return WindowsRelease.parse(JSON.parse(text));
  } catch (err) {
    console.error('windows.json is not valid', err);
    return null;
  }
}

/** `parent.json` in the releases folder, written by `deploy/publish-downloads.ps1 -Parent` after the APK is in place. */
const ParentRelease = AppUpdateOffer.extend({
  file: z.string().regex(/^[A-Za-z0-9._-]+\.apk$/),
  /** Only these parents, to try a version on one phone first. Left out: every Android parent. */
  parentIds: z.array(z.uuid()).optional(),
});

type ParentRelease = z.infer<typeof ParentRelease>;

/** The published parent release, or null when there is none or `parent.json` is not valid (which is logged). */
async function readParentRelease(dir: string | null): Promise<ParentRelease | null> {
  if (!dir) return null;
  let text: string;
  try {
    text = await readFile(join(dir, 'parent.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    return ParentRelease.parse(JSON.parse(text));
  } catch (err) {
    console.error('parent.json is not valid', err);
    return null;
  }
}

/** Whether [release] is offered to [caller] by the rules of §12.7, ignoring the version comparison. */
function parentReleaseFor(release: ParentRelease, client: string, parentId: string | null): boolean {
  if (client !== 'android') return false;
  if (release.parentIds && (!parentId || !release.parentIds.includes(parentId))) return false;
  return true;
}

const checkRoute = createRoute({
  method: 'post',
  path: '/v1/device/app-update/check',
  tags: ['device'],
  summary: 'Report the app version and ask for a newer one',
  description: 'Stores the version for the parents to see. `offer` is null when there is nothing newer.',
  security: deviceBearer,
  request: { body: jsonBody(AppUpdateCheck) },
  responses: {
    200: jsonResponse('A newer version for this device, or none.', AppUpdateAnswer),
    ...errorResponses(401, 422),
  },
});

const removedRoute = createRoute({
  method: 'post',
  path: '/v1/device/removed',
  tags: ['device'],
  summary: 'Screen Time is being taken off this device',
  description: 'After a right parent code on the device. Revokes the device and tells the parents.',
  security: deviceBearer,
  responses: { 204: { description: 'Revoked.' }, ...errorResponses(401) },
});

const parentCheckRoute = createRoute({
  method: 'post',
  path: '/v1/me/app-update/check',
  tags: ['parent'],
  summary: 'Report the parent app version and ask for a newer one',
  description: 'Stores the version for the server to keep. `offer` is null when there is nothing newer for this phone.',
  security: bearer,
  request: { body: jsonBody(AppUpdateCheck) },
  responses: {
    200: jsonResponse('A newer version for this phone, or none.', AppUpdateAnswer),
    ...errorResponses(401, 422),
  },
});

/** Self-update of the kid app, the PC, and their removal (docs/SPEC.md §12.1, §12.2). */
export function registerAppUpdateRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(checkRoute, async (c) => {
    const { deviceId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const [device] = await withFamily(db, familyId, (tx) =>
      tx.update(devices).set({ appVersion: body.versionName }).where(eq(devices.id, deviceId)).returning({ platform: devices.platform }),
    );
    const platform = device?.platform;
    if (platform === 'android') {
      const release = await readKidRelease(config.releasesDir);
      if (
        !release ||
        release.versionCode <= body.versionCode ||
        (release.deviceIds && !release.deviceIds.includes(deviceId))
      ) {
        return c.json({ offer: null }, 200);
      }
      const { versionCode, versionName, sha256, sizeBytes } = release;
      return c.json({ offer: { versionCode, versionName, sha256, sizeBytes } }, 200);
    }
    if (platform === 'windows') {
      const release = await readWindowsRelease(config.releasesDir);
      if (
        !release ||
        release.versionCode <= body.versionCode ||
        (release.deviceIds && !release.deviceIds.includes(deviceId))
      ) {
        return c.json({ offer: null }, 200);
      }
      const { versionCode, versionName, sha256, sizeBytes } = release;
      return c.json({ offer: { versionCode, versionName, sha256, sizeBytes } }, 200);
    }
    return c.json({ offer: null }, 200);
  });

  // Plain bytes, so it is not in the contract: the kid app fetches it with its own HTTP call.
  app.get('/v1/device/app-update/apk', async (c) => {
    const { deviceId } = await requireDevice(c, db);
    const release = await readKidRelease(config.releasesDir);
    if (!release || (release.deviceIds && !release.deviceIds.includes(deviceId))) {
      throw new ApiError('not_found', 'No update for this device.');
    }
    const path = join(config.releasesDir ?? '', release.file);
    const size = await stat(path).then(
      (s) => s.size,
      () => null,
    );
    if (size === null) throw new ApiError('not_found', 'No update for this device.');
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': String(size) },
    });
  });

  // Plain bytes, so it is not in the contract: the Windows service fetches it with its own HTTP call.
  app.get('/v1/device/app-update/msi', async (c) => {
    const { deviceId, familyId } = await requireDevice(c, db);
    const [device] = await withFamily(db, familyId, (tx) =>
      tx.select({ platform: devices.platform }).from(devices).where(eq(devices.id, deviceId)),
    );
    if (device?.platform !== 'windows') throw new ApiError('not_found', 'No update for this device.');
    const release = await readWindowsRelease(config.releasesDir);
    if (!release || (release.deviceIds && !release.deviceIds.includes(deviceId))) {
      throw new ApiError('not_found', 'No update for this device.');
    }
    const path = join(config.releasesDir ?? '', release.file);
    const size = await stat(path).then(
      (s) => s.size,
      () => null,
    );
    if (size === null) throw new ApiError('not_found', 'No update for this device.');
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { 'Content-Type': 'application/x-msi', 'Content-Length': String(size) },
    });
  });

  app.openapi(removedRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const eventId = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx
        .update(devices)
        .set({ revokedAt: sql`now()`, fcmToken: null })
        .where(eq(devices.id, deviceId))
        .returning({ name: devices.name });
      const [event] = await tx
        .insert(events)
        .values({ familyId, kidId, deviceId, kind: 'device.removed', at: sql`now()`, payload: { deviceName: device?.name ?? null } })
        .returning({ id: events.id });
      return event?.id;
    });
    disconnectDevices(deps, [deviceId]);
    if (eventId) void notifyParents(deps, familyId, [eventId]);
    return c.body(null, 204);
  });

  // Self-update of the parent app (docs/SPEC.md §12.7): the app checks and downloads by itself, and installs on a tap.
  app.openapi(parentCheckRoute, async (c) => {
    const auth = await requireFamilyParent(c, db, config.jwtSecret);
    const body = c.req.valid('json');
    const [session] = await withFamily(db, auth.familyId!, (tx) =>
      tx.update(parentSessions).set({ appVersion: body.versionName }).where(eq(parentSessions.id, auth.sessionId)).returning({ client: parentSessions.client }),
    );
    const client = session?.client;
    const release = await readParentRelease(config.releasesDir);
    if (
      !release ||
      release.versionCode <= body.versionCode ||
      !parentReleaseFor(release, client ?? '', auth.parentId)
    ) {
      return c.json({ offer: null }, 200);
    }
    const { versionCode, versionName, sha256, sizeBytes } = release;
    return c.json({ offer: { versionCode, versionName, sha256, sizeBytes } }, 200);
  });

  // Plain bytes, so it is not in the contract: the parent app fetches it with its own HTTP call.
  app.get('/v1/me/app-update/apk', async (c) => {
    const auth = await requireFamilyParent(c, db, config.jwtSecret);
    const [session] = await withFamily(db, auth.familyId!, (tx) =>
      tx.select({ client: parentSessions.client }).from(parentSessions).where(eq(parentSessions.id, auth.sessionId)),
    );
    const release = await readParentRelease(config.releasesDir);
    if (!release || !parentReleaseFor(release, session?.client ?? '', auth.parentId)) {
      throw new ApiError('not_found', 'No update for this phone.');
    }
    const path = join(config.releasesDir ?? '', release.file);
    const size = await stat(path).then(
      (s) => s.size,
      () => null,
    );
    if (size === null) throw new ApiError('not_found', 'No update for this phone.');
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': String(size) },
    });
  });
}
