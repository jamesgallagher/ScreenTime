import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createRoute, z } from '@hono/zod-openapi';
import { eq, sql } from 'drizzle-orm';
import { AppUpdateAnswer, AppUpdateCheck, AppUpdateOffer } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { withFamily } from '../db/family.js';
import { devices, events } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { disconnectDevices, notifyParents } from '../notify/dispatch.js';
import { deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

/** `kid.json` in the releases folder, written by `android/publish-kid.ps1` after the APK is in place. */
const KidRelease = AppUpdateOffer.extend({
  file: z.string().regex(/^[A-Za-z0-9._-]+\.apk$/),
  /** Only these devices, to try a version on one device first. Left out: every Android device. */
  deviceIds: z.array(z.uuid()).optional(),
});

type KidRelease = z.infer<typeof KidRelease>;

/** The published release, or null when there is none or `kid.json` is not valid (which is logged). */
async function readRelease(dir: string | null): Promise<KidRelease | null> {
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

const checkRoute = createRoute({
  method: 'post',
  path: '/v1/device/app-update/check',
  tags: ['device'],
  summary: 'Report the app version and ask for a newer one',
  description: 'Stores the version for the parents to see. `offer` is null when there is nothing newer, and always on a device that is not Android.',
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

/** Self-update of the kid app and its removal (docs/SPEC.md §12.1). */
export function registerAppUpdateRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(checkRoute, async (c) => {
    const { deviceId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const [device] = await withFamily(db, familyId, (tx) =>
      tx.update(devices).set({ appVersion: body.versionName }).where(eq(devices.id, deviceId)).returning({ platform: devices.platform }),
    );
    const release = await readRelease(config.releasesDir);
    if (
      device?.platform !== 'android' ||
      !release ||
      release.versionCode <= body.versionCode ||
      (release.deviceIds && !release.deviceIds.includes(deviceId))
    ) {
      return c.json({ offer: null }, 200);
    }
    const { versionCode, versionName, sha256, sizeBytes } = release;
    return c.json({ offer: { versionCode, versionName, sha256, sizeBytes } }, 200);
  });

  // Plain bytes, so it is not in the contract: the kid app fetches it with its own HTTP call.
  app.get('/v1/device/app-update/apk', async (c) => {
    const { deviceId } = await requireDevice(c, db);
    const release = await readRelease(config.releasesDir);
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
}
