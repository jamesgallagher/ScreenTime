import { z } from 'zod';

/** Tamper events a kid device can report (docs/SPEC.md §14). `tamper.offline_usage` is the server's own. */
export const DeviceEventKind = z
  .enum(['tamper.clock', 'tamper.timezone', 'tamper.tray_killed', 'tamper.policy', 'tamper.call_blocked'])
  .meta({ id: 'DeviceEventKind' });

export type DeviceEventKind = z.infer<typeof DeviceEventKind>;

/** What the device saw, as up to 10 plain values, for example `{ from: "Australia/Sydney", to: "UTC" }`. */
const DeviceEventPayload = z
  .record(z.string().min(1).max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
  .refine((p) => Object.keys(p).length <= 10, 'payload can have at most 10 fields.');

/** One tamper event. The device makes the id, so sending it again stores nothing new. */
export const DeviceEventIn = z
  .object({
    id: z.uuid(),
    kind: DeviceEventKind,
    /** When it happened, by the device's trusted time. A time after the server's now is stored as now. */
    at: z.iso.datetime({ offset: true }),
    payload: DeviceEventPayload.optional(),
  })
  .meta({ id: 'DeviceEventIn' });

export type DeviceEventIn = z.infer<typeof DeviceEventIn>;

/** Body of POST /v1/device/events. A device that was offline sends what it queued, oldest first. */
export const DeviceEventUpload = z
  .object({ events: z.array(DeviceEventIn).min(1).max(50) })
  .meta({ id: 'DeviceEventUpload' });

export type DeviceEventUpload = z.infer<typeof DeviceEventUpload>;
