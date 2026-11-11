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

/** A parent's rule for an app (docs/SPEC.md §12.4). `held` is written by the server while a new app waits. */
export const AppRuleMode = z.enum(['allowed', 'held', 'blocked', 'limit']).meta({ id: 'AppRuleMode' });

export type AppRuleMode = z.infer<typeof AppRuleMode>;

/**
 * Body of PUT /v1/kids/{kidId}/apps/{package}/rule. A parent cannot hold an app. `dailyMinutes` is 5 to 480 in steps
 * of 5 for `limit`, and null otherwise.
 */
export const AppRulePut = z
  .object({ mode: z.enum(['allowed', 'blocked', 'limit']), dailyMinutes: z.int().nullable() })
  .refine((r) => (r.mode === 'limit' ? r.dailyMinutes !== null && r.dailyMinutes >= 5 && r.dailyMinutes <= 480 && r.dailyMinutes % 5 === 0 : r.dailyMinutes === null), {
    message: 'A limit needs 5 to 480 minutes in steps of 5, and only a limit has minutes.',
  })
  .meta({ id: 'AppRulePut' });

export type AppRulePut = z.infer<typeof AppRulePut>;

export const KidAppRule = z.object({ mode: AppRuleMode, dailyMinutes: z.int().nullable() });

/** Answer of PUT /v1/kids/{kidId}/apps/{package}/rule. */
export const AppRuleSaved = z.object({ mode: AppRuleMode, dailyMinutes: z.int().nullable() }).meta({ id: 'AppRuleSaved' });

export type KidAppRule = z.infer<typeof KidAppRule>;

/** Body of PUT /v1/devices/{deviceId}/apps/{package}/always-allowed (docs/SPEC.md §12.4). */
export const AlwaysAllowedPut = z.object({ alwaysAllowed: z.boolean() }).meta({ id: 'AlwaysAllowedPut' });

export type AlwaysAllowedPut = z.infer<typeof AlwaysAllowedPut>;

/** Body of PUT /v1/kids/{kidId}/app-settings. */
export const KidAppSettings = z.object({ newAppApproval: z.boolean() }).meta({ id: 'KidAppSettings' });

export type KidAppSettings = z.infer<typeof KidAppSettings>;

/** Body of POST /v1/device/app-usage: seconds per app per local day. A repeat or an older upload never lowers a value. */
export const DeviceAppUsageUpload = z
  .object({
    days: z
      .array(
        z.object({
          day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          apps: z.array(z.object({ package: z.string().min(1).max(255), seconds: z.int().min(0).max(86400) })).max(500),
        }),
      )
      .min(1)
      .max(8),
  })
  .meta({ id: 'DeviceAppUsageUpload' });

export type DeviceAppUsageUpload = z.infer<typeof DeviceAppUsageUpload>;

/** One of the kid's devices an app is or was on. */
export const KidAppDevice = z
  .object({
    deviceId: z.uuid(),
    deviceName: z.string(),
    installedAt: z.iso.datetime(),
    firstUsedAt: z.iso.datetime().nullable(),
    removedAt: z.iso.datetime().nullable(),
    /** Runs on this device when its time is up, but not from bedtime to wake-up. A block or a used-up limit still wins. */
    alwaysAllowed: z.boolean(),
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
    /** Today's seconds across the kid's devices. */
    todaySeconds: z.int(),
    /** Null means allowed. */
    rule: KidAppRule.nullable(),
    devices: z.array(KidAppDevice),
  })
  .meta({ id: 'KidApp' });

export type KidApp = z.infer<typeof KidApp>;

/** GET /v1/kids/{kidId}/apps. */
export const KidApps = z
  .object({
    newAppApproval: z.boolean(),
    apps: z.array(KidApp),
  })
  .meta({ id: 'KidApps' });

export type KidApps = z.infer<typeof KidApps>;
