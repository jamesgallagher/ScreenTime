import { z } from 'zod';

/** How long parent mode lasts: 2, 5 or 15 minutes, an hour, or null for "Until I end it" (Q15). */
export const ParentModeDuration = z
  .union([z.literal(2), z.literal(5), z.literal(15), z.literal(60)])
  .nullable()
  .meta({ id: 'ParentModeDuration' });

export type ParentModeDuration = z.infer<typeof ParentModeDuration>;

/**
 * Where a parent-mode session stands. A push request waits 10 minutes for a parent (`pending`), then
 * `expired`; a newer request from the same device also expires it. `denied` when a parent said no.
 */
export const ParentModeStatus = z
  .enum(['pending', 'active', 'ended', 'denied', 'expired'])
  .meta({ id: 'ParentModeStatus' });

export type ParentModeStatus = z.infer<typeof ParentModeStatus>;

/** One parent-mode session (docs/SPEC.md §6.1 parent_mode_sessions, §12.3). */
export const ParentModeSession = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    kidName: z.string(),
    deviceId: z.uuid(),
    deviceName: z.string(),
    /** `push`: the kid asked and a parent approved. `code`: started on the device with the parent code. `remote`: started from the parent app. */
    method: z.enum(['push', 'code', 'remote']),
    status: ParentModeStatus,
    requestedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    /** null while pending, and for "Until I end it". */
    endsAt: z.iso.datetime().nullable(),
    endedAt: z.iso.datetime().nullable(),
    durationMin: ParentModeDuration,
    /** The parent who approved or started it; null for the parent code. */
    approvedByName: z.string().nullable(),
    /** The parent who ended or denied it; null when the device ended it or the time ran out. */
    endedByName: z.string().nullable(),
  })
  .meta({ id: 'ParentModeSession' });

export type ParentModeSession = z.infer<typeof ParentModeSession>;

/** Body of POST /v1/device/parent-mode-requests ("I'm the parent"). The device makes the id. */
export const ParentModeRequestCreate = z.object({ id: z.uuid() }).meta({ id: 'ParentModeRequestCreate' });

export type ParentModeRequestCreate = z.infer<typeof ParentModeRequestCreate>;

/** Body of POST /v1/parent-mode-requests/{id}/approve and POST /v1/devices/{id}/parent-mode. */
export const ParentModeStart = z.object({ durationMin: ParentModeDuration }).meta({ id: 'ParentModeStart' });

export type ParentModeStart = z.infer<typeof ParentModeStart>;

/** Body of POST /v1/device/parent-mode: parent mode the device started after a correct parent code. */
export const ParentModeByCode = z
  .object({
    id: z.uuid(),
    durationMin: ParentModeDuration,
    /** When it started on the device. It may be in the past if the device was offline. */
    startedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'ParentModeByCode' });

export type ParentModeByCode = z.infer<typeof ParentModeByCode>;

/** Data of the `parent_mode` message to a kid device (docs/SPEC.md §10). */
export const ParentModeMessage = z
  .object({
    active: z.boolean(),
    endsAt: z.iso.datetime().nullable(),
    /** The parent who started, ended or denied it. */
    byName: z.string().nullable(),
    /** Set when this answers the device's request, so the "Hand to a parent" screen can close. */
    requestId: z.uuid().nullable(),
  })
  .meta({ id: 'ParentModeMessage' });

export type ParentModeMessage = z.infer<typeof ParentModeMessage>;
