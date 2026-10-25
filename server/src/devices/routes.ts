import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  Device,
  type DeviceForm,
  DeviceMe,
  DevicePatch,
  EnrolmentCode,
  EnrolmentCodeCreate,
  EnrolRequest,
  EnrolResponse,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { clientIp } from '../auth/client-ip.js';
import { requireFamilyParent } from '../auth/guards.js';
import { RateLimiter } from '../auth/rate-limit.js';
import { withFamily } from '../db/family.js';
import { devices, enrolmentCodes, events, families, kids } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { findKid } from '../kids/routes.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { requireDevice } from './auth.js';
import { hashDeviceToken, newDeviceToken, newEnrolmentCode } from './token.js';

type Router = ReturnType<typeof createRouter>;

/** Enrolment codes work for 10 minutes (docs/SPEC.md §11.3). */
const CODE_TTL = sql`now() + interval '10 minutes'`;

/** Which platform each form runs on. */
const PLATFORM_OF: Record<DeviceForm, 'android' | 'windows'> = { phone: 'android', tablet: 'android', pc: 'windows' };
const FORM_TEXT: Record<DeviceForm, string> = { phone: 'an Android phone', tablet: 'an Android tablet', pc: 'a Windows PC' };

const IdParam = z.object({ id: z.uuid() });
const KidParam = z.object({ kidId: z.uuid() });

function toDevice(row: typeof devices.$inferSelect): Device {
  return {
    id: row.id,
    kidId: row.kidId,
    platform: row.platform as Device['platform'],
    form: row.form as Device['form'],
    pool: row.pool as Device['pool'],
    name: row.name,
    hasCellular: row.hasCellular,
    model: row.model,
    osVersion: row.osVersion,
    appVersion: row.appVersion,
    windowsUserName: row.windowsUserName,
    enrolledAt: row.enrolledAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

const deviceNotFound = () => new ApiError('not_found', 'No such device in your family.');

const createCodeRoute = createRoute({
  method: 'post',
  path: '/v1/kids/{kidId}/enrolment-codes',
  tags: ['devices'],
  summary: 'Make a code to add a device for a kid',
  description: 'The code works once, for 10 minutes. Show it in large digits and as a QR code of `qrPayload`.',
  security: bearer,
  request: { params: KidParam, body: jsonBody(EnrolmentCodeCreate) },
  responses: { 201: jsonResponse('The code.', EnrolmentCode), ...errorResponses(401, 403, 404, 422) },
});

const listDevicesRoute = createRoute({
  method: 'get',
  path: '/v1/devices',
  tags: ['devices'],
  summary: 'Devices in the family',
  description: 'Revoked devices are left out.',
  security: bearer,
  responses: { 200: jsonResponse('The devices, oldest first.', z.array(Device)), ...errorResponses(401, 403) },
});

const patchDeviceRoute = createRoute({
  method: 'patch',
  path: '/v1/devices/{id}',
  tags: ['devices'],
  summary: 'Rename a device or move it to another pool',
  security: bearer,
  request: { params: IdParam, body: jsonBody(DevicePatch) },
  responses: { 200: jsonResponse('The changed device.', Device), ...errorResponses(401, 403, 404, 422) },
});

const revokeDeviceRoute = createRoute({
  method: 'delete',
  path: '/v1/devices/{id}',
  tags: ['devices'],
  summary: 'Revoke a device',
  description: 'Its token stops working at once. Its history stays.',
  security: bearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Revoked.' }, ...errorResponses(401, 403, 404, 422) },
});

const enrolRoute = createRoute({
  method: 'post',
  path: '/v1/enrol',
  tags: ['devices'],
  summary: 'Enrol a kid device with a code',
  description: 'Called by the kid device. No sign-in: the code is the proof.',
  request: { body: jsonBody(EnrolRequest) },
  responses: {
    201: jsonResponse('Enrolled. Keep the device token safe; it is not shown again.', EnrolResponse),
    ...errorResponses(401, 409, 422, 429),
  },
});

const deviceMeRoute = createRoute({
  method: 'get',
  path: '/v1/device/me',
  tags: ['device'],
  summary: 'The calling device, its kid and family',
  description: 'A 401 means the device was revoked and must be enrolled again.',
  security: deviceBearer,
  responses: { 200: jsonResponse('This device.', DeviceMe), ...errorResponses(401) },
});

/**
 * Enrolment codes, enrolment and device management (docs/SPEC.md §9, §11.2, §11.3).
 * Parent routes run inside `withFamily`. Enrolment has no family yet, so it uses the owner connection.
 */
export function registerDeviceRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);
  // A wrong code matches no row, so guesses are limited per IP instead of per code.
  const enrolsPerIp = new RateLimiter(10, 15 * 60 * 1000);

  /** A code that no unexpired, unused code in any family already has. */
  async function freeCode() {
    for (let i = 0; i < 10; i++) {
      const code = newEnrolmentCode();
      const [taken] = await db
        .select({ id: enrolmentCodes.id })
        .from(enrolmentCodes)
        .where(and(eq(enrolmentCodes.code, code), isNull(enrolmentCodes.consumedAt), gt(enrolmentCodes.expiresAt, sql`now()`)));
      if (!taken) return code;
    }
    throw new Error('no free enrolment code after 10 tries');
  }

  app.openapi(createCodeRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const { form } = c.req.valid('json');
    const code = await freeCode();
    const row = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const [saved] = await tx
        .insert(enrolmentCodes)
        .values({ familyId, kidId, form, code, expiresAt: CODE_TTL, createdBy: parentId })
        .returning();
      if (!saved) throw new Error('enrolment code insert returned nothing');
      return saved;
    });
    // The host the parent app used is the one the kid device can reach (the public hostname in production).
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    const qrPayload = `screentime://enrol?host=${encodeURIComponent(host)}&code=${code}`;
    return c.json({ code, qrPayload, expiresAt: row.expiresAt.toISOString() }, 201);
  });

  app.openapi(listDevicesRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(devices).where(isNull(devices.revokedAt)).orderBy(asc(devices.enrolledAt), asc(devices.id)),
    );
    return c.json(rows.map(toDevice), 200);
  });

  app.openapi(patchDeviceRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const [row] = await withFamily(db, familyId, (tx) => {
      const where = and(eq(devices.id, id), isNull(devices.revokedAt));
      return Object.keys(patch).length === 0
        ? tx.select().from(devices).where(where)
        : tx.update(devices).set(patch).where(where).returning();
    });
    if (!row) throw deviceNotFound();
    return c.json(toDevice(row), 200);
  });

  app.openapi(revokeDeviceRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const [revoked] = await withFamily(db, familyId, (tx) =>
      tx
        .update(devices)
        .set({ revokedAt: sql`now()`, fcmToken: null })
        .where(and(eq(devices.id, id), isNull(devices.revokedAt)))
        .returning({ id: devices.id }),
    );
    if (!revoked) throw deviceNotFound();
    return c.body(null, 204);
  });

  app.openapi(enrolRoute, async (c) => {
    if (!enrolsPerIp.hit(clientIp(c))) throw new ApiError('rate_limited', 'Too many enrolment attempts. Try again later.');
    const body = c.req.valid('json');
    const wrongCode = () => new ApiError('unauthorized', 'That code is wrong or has expired. Ask a parent for a new one.');
    const deviceToken = newDeviceToken();
    const result = await db.transaction(async (tx) => {
      // Lock the code so two devices cannot use it at the same moment.
      const [found] = await tx
        .select({ code: enrolmentCodes, kid: kids, family: families })
        .from(enrolmentCodes)
        .innerJoin(kids, eq(kids.id, enrolmentCodes.kidId))
        .innerJoin(families, eq(families.id, enrolmentCodes.familyId))
        .where(
          and(
            eq(enrolmentCodes.code, body.code),
            isNull(enrolmentCodes.consumedAt),
            gt(enrolmentCodes.expiresAt, sql`now()`),
            isNull(kids.archivedAt),
            isNull(families.disabledAt),
          ),
        )
        .orderBy(desc(enrolmentCodes.createdAt))
        .limit(1)
        .for('update', { of: enrolmentCodes });
      if (!found) throw wrongCode();
      const { code, kid, family } = found;
      const form = code.form as DeviceForm;
      if (PLATFORM_OF[form] !== body.platform) throw new ApiError('conflict', `This code is for ${FORM_TEXT[form]}.`);

      if (body.platform === 'windows') {
        // Installing again on the same PC account replaces the old device row.
        await tx
          .update(devices)
          .set({ revokedAt: sql`now()`, fcmToken: null })
          .where(
            and(
              eq(devices.familyId, family.id),
              eq(devices.machineId, body.machineId ?? ''),
              eq(devices.windowsUserSid, body.windowsUserSid ?? ''),
              isNull(devices.revokedAt),
            ),
          );
      }
      const name = (body.platform === 'windows' ? `${body.windowsUserName} on ${body.model}` : body.model).slice(0, 40);
      const [device] = await tx
        .insert(devices)
        .values({
          familyId: family.id,
          kidId: kid.id,
          platform: body.platform,
          form,
          pool: form === 'phone' ? 'phone' : 'screens',
          name,
          hasCellular: body.hasCellular,
          model: body.model,
          osVersion: body.osVersion,
          appVersion: body.appVersion,
          machineId: body.machineId ?? null,
          windowsUserSid: body.windowsUserSid ?? null,
          windowsUserName: body.windowsUserName ?? null,
          tokenHash: hashDeviceToken(deviceToken),
          lastSeenAt: sql`now()`,
        })
        .returning();
      if (!device) throw new Error('device insert returned nothing');
      await tx
        .update(enrolmentCodes)
        .set({ consumedAt: sql`now()`, deviceId: device.id })
        .where(eq(enrolmentCodes.id, code.id));
      // Every notification kind is written to events (docs/SPEC.md §13); the push comes with notifications.
      await tx.insert(events).values({
        familyId: family.id,
        kidId: kid.id,
        deviceId: device.id,
        kind: 'device.enrolled',
        at: sql`now()`,
        payload: { name, form, platform: body.platform },
      });
      return {
        deviceId: device.id,
        deviceToken,
        kid: { id: kid.id, name: kid.name },
        family: { name: family.name, timezone: family.timezone },
      };
    });
    return c.json(result, 201);
  });

  app.openapi(deviceMeRoute, async (c) => {
    const { deviceId } = await requireDevice(c, db);
    const [row] = await db
      .select({ device: devices, kid: kids, family: families })
      .from(devices)
      .innerJoin(kids, eq(kids.id, devices.kidId))
      .innerJoin(families, eq(families.id, devices.familyId))
      .where(eq(devices.id, deviceId));
    if (!row) throw new ApiError('unauthorized', 'This device is not enrolled.');
    const { device, kid, family } = row;
    return c.json(
      {
        device: {
          id: device.id,
          name: device.name,
          form: device.form as DeviceForm,
          pool: device.pool as Device['pool'],
          hasCellular: device.hasCellular,
        },
        kid: { id: kid.id, name: kid.name },
        family: { timezone: family.timezone, emergencyNumber: family.emergencyNumber },
      },
      200,
    );
  });
}
