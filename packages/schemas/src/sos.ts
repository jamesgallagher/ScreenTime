import { z } from 'zod';

/** One position from the phone during an SOS (docs/SPEC.md §15). `via` says how it reached the parents first. */
export const SosLocationIn = z
  .object({
    at: z.iso.datetime({ offset: true }),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** Radius in metres. */
    accuracyM: z.number().min(0).max(100000).nullable().optional(),
    batteryPct: z.int().min(0).max(100).nullable().optional(),
    via: z.enum(['data', 'sms']),
  })
  .meta({ id: 'SosLocationIn' });

export type SosLocationIn = z.infer<typeof SosLocationIn>;

/** Body of POST /v1/device/sos. The phone makes the id; `startedAt` is when the countdown finished. */
export const SosStart = z
  .object({
    id: z.uuid(),
    startedAt: z.iso.datetime({ offset: true }),
    /** The position sent in the first SMS, when the phone had one. */
    location: SosLocationIn.nullable().optional(),
  })
  .meta({ id: 'SosStart' });

export type SosStart = z.infer<typeof SosStart>;

/** Body of POST /v1/device/sos/{id}/locations: every 30 s over data, or what the phone queued. */
export const SosLocationsUpload = z
  .object({ locations: z.array(SosLocationIn).min(1).max(100) })
  .meta({ id: 'SosLocationsUpload' });

export type SosLocationsUpload = z.infer<typeof SosLocationsUpload>;

export const SosLocation = z
  .object({
    at: z.iso.datetime(),
    lat: z.number(),
    lng: z.number(),
    accuracyM: z.number().nullable(),
    batteryPct: z.int().nullable(),
    via: z.enum(['data', 'sms']),
  })
  .meta({ id: 'SosLocation' });

export type SosLocation = z.infer<typeof SosLocation>;

/** A parent who tapped "I'm on it". */
export const SosAck = z
  .object({ parentId: z.uuid(), byName: z.string(), at: z.iso.datetime() })
  .meta({ id: 'SosAck' });

export type SosAck = z.infer<typeof SosAck>;

/** An SOS is active until the kid or a parent ends it, or until `autoStopAt` passes. */
export const SosStatus = z.enum(['active', 'ended']).meta({ id: 'SosStatus' });
export type SosStatus = z.infer<typeof SosStatus>;

export const Sos = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    kidName: z.string(),
    deviceId: z.uuid(),
    deviceName: z.string(),
    status: SosStatus,
    startedAt: z.iso.datetime(),
    /** Two hours after the start, plus two hours for each extend. */
    autoStopAt: z.iso.datetime(),
    /** null while active. `autoStopAt` when it stopped by itself. */
    endedAt: z.iso.datetime().nullable(),
    endedBy: z.enum(['kid', 'parent', 'auto']).nullable(),
    endedByName: z.string().nullable(),
    /** The newest position, by its `at`. */
    lastLocation: SosLocation.nullable(),
    /** Oldest first. */
    acks: z.array(SosAck),
  })
  .meta({ id: 'Sos' });

export type Sos = z.infer<typeof Sos>;

/** GET /v1/sos/{id}: the SOS and every position, oldest first. */
export const SosDetail = Sos.extend({ locations: z.array(SosLocation) }).meta({ id: 'SosDetail' });

export type SosDetail = z.infer<typeof SosDetail>;

/** Data of the `sos_ack`, `sos_extended` and `sos_ended` messages to the phone (docs/SPEC.md §10). */
export const SosMessage = z
  .object({
    sosId: z.uuid(),
    byName: z.string(),
    /** Set on `sos_extended`. */
    autoStopAt: z.iso.datetime().optional(),
  })
  .meta({ id: 'SosMessage' });

export type SosMessage = z.infer<typeof SosMessage>;
