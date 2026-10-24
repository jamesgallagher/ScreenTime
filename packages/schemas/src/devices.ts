import { z } from 'zod';

export const Platform = z.enum(['android', 'windows']).meta({ id: 'Platform' });
export type Platform = z.infer<typeof Platform>;

/** What the parent picked under "Add device". Decides the pool: phone → phone, tablet and pc → screens. */
export const DeviceForm = z.enum(['phone', 'tablet', 'pc']).meta({ id: 'DeviceForm' });
export type DeviceForm = z.infer<typeof DeviceForm>;

export const Pool = z.enum(['screens', 'phone']).meta({ id: 'Pool' });
export type Pool = z.infer<typeof Pool>;

/** A kid device as parents see it. */
export const Device = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    platform: Platform,
    form: DeviceForm,
    pool: Pool,
    name: z.string(),
    hasCellular: z.boolean(),
    model: z.string().nullable(),
    osVersion: z.string().nullable(),
    appVersion: z.string().nullable(),
    windowsUserName: z.string().nullable(),
    enrolledAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Device' });

export type Device = z.infer<typeof Device>;

/** Body of PATCH /v1/devices/{id}. Send only the fields to change. */
export const DevicePatch = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    pool: Pool.optional(),
  })
  .meta({ id: 'DevicePatch' });

export type DevicePatch = z.infer<typeof DevicePatch>;

/** Body of POST /v1/kids/{kidId}/enrolment-codes. */
export const EnrolmentCodeCreate = z.object({ form: DeviceForm }).meta({ id: 'EnrolmentCodeCreate' });
export type EnrolmentCodeCreate = z.infer<typeof EnrolmentCodeCreate>;

export const EnrolmentCode = z
  .object({
    code: z.string().regex(/^[0-9]{6}$/),
    /** `screentime://enrol?host=<host>&code=<code>`, shown as a QR code. */
    qrPayload: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'EnrolmentCode' });

export type EnrolmentCode = z.infer<typeof EnrolmentCode>;

/** Body of POST /v1/enrol, sent by the kid device. The code decides the kid and the form. */
export const EnrolRequest = z
  .object({
    code: z.string().regex(/^[0-9]{6}$/, 'The code is 6 digits.'),
    platform: Platform,
    hasCellular: z.boolean(),
    model: z.string().trim().min(1).max(100),
    osVersion: z.string().trim().min(1).max(100),
    appVersion: z.string().trim().min(1).max(40),
    /** Windows only: machine GUID, the kid account's SID and its user name (one device row per account). */
    machineId: z.string().trim().min(1).max(100).optional(),
    windowsUserSid: z.string().trim().min(1).max(100).optional(),
    windowsUserName: z.string().trim().min(1).max(100).optional(),
  })
  .refine((r) => r.platform !== 'windows' || (r.machineId && r.windowsUserSid && r.windowsUserName), {
    message: 'Windows needs machineId, windowsUserSid and windowsUserName.',
    path: ['windowsUserSid'],
  })
  .meta({ id: 'EnrolRequest' });

export type EnrolRequest = z.infer<typeof EnrolRequest>;

export const EnrolResponse = z
  .object({
    deviceId: z.uuid(),
    /** Opaque. Send as `Authorization: Bearer <deviceToken>` on every device call. Shown once. */
    deviceToken: z.string(),
    kid: z.object({ id: z.uuid(), name: z.string() }),
    family: z.object({ name: z.string(), timezone: z.string() }),
  })
  .meta({ id: 'EnrolResponse' });

export type EnrolResponse = z.infer<typeof EnrolResponse>;

/** GET /v1/device/me: the calling device, so an app can check it is still enrolled. */
export const DeviceMe = z
  .object({
    device: z.object({
      id: z.uuid(),
      name: z.string(),
      form: DeviceForm,
      pool: Pool,
      hasCellular: z.boolean(),
    }),
    kid: z.object({ id: z.uuid(), name: z.string() }),
    family: z.object({ timezone: z.string(), emergencyNumber: z.string() }),
  })
  .meta({ id: 'DeviceMe' });

export type DeviceMe = z.infer<typeof DeviceMe>;
