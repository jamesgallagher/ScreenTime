import { z } from 'zod';

/** How an app got onto an Android device (docs/SPEC.md §12.4). */
export const AppSource = z.enum(['preinstalled', 'play', 'other']).meta({ id: 'AppSource' });

export type AppSource = z.infer<typeof AppSource>;

/** One app with a launcher icon, as the device sees it. */
export const DeviceAppIn = z
  .object({
    package: z.string().min(1).max(255),
    label: z.string().min(1).max(80),
    source: AppSource,
    /** The package that installed it, if Android knows. */
    installer: z.string().max(255).nullable(),
    /** False for what the device never blocks: Settings, the launcher, the phone and messaging apps. */
    blockable: z.boolean(),
    installedAt: z.iso.datetime({ offset: true }),
    /** The first time the device saw it opened. */
    firstUsedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'DeviceAppIn' });

export type DeviceAppIn = z.infer<typeof DeviceAppIn>;

/** Body of PUT /v1/device/apps: the device's whole list. */
export const DeviceAppsPut = z
  .object({ apps: z.array(DeviceAppIn).min(1).max(500) })
  .refine((body) => new Set(body.apps.map((a) => a.package)).size === body.apps.length, {
    message: 'Each package may appear only once.',
  })
  .meta({ id: 'DeviceAppsPut' });

export type DeviceAppsPut = z.infer<typeof DeviceAppsPut>;

/** One of the kid's devices an app is or was on. */
export const KidAppDevice = z
  .object({
    deviceId: z.uuid(),
    deviceName: z.string(),
    installedAt: z.iso.datetime(),
    firstUsedAt: z.iso.datetime().nullable(),
    removedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'KidAppDevice' });

export type KidAppDevice = z.infer<typeof KidAppDevice>;

/** One app across the kid's Android devices. */
export const KidApp = z
  .object({
    package: z.string(),
    label: z.string(),
    source: AppSource,
    blockable: z.boolean(),
    /** 0 until app time is counted (CARD-058). */
    todaySeconds: z.int(),
    devices: z.array(KidAppDevice),
  })
  .meta({ id: 'KidApp' });

export type KidApp = z.infer<typeof KidApp>;

/** GET /v1/kids/{kidId}/apps. */
export const KidApps = z
  .object({
    /** Always false until new app approval exists (CARD-057). */
    newAppApproval: z.boolean(),
    apps: z.array(KidApp),
  })
  .meta({ id: 'KidApps' });

export type KidApps = z.infer<typeof KidApps>;
