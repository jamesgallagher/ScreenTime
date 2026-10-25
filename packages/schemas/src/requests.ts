import { z } from 'zod';
import { Pool } from './devices.js';
import { StateGrant } from './sync.js';

/** What happened to a time request. A pending request expires at the family's local midnight. */
export const TimeRequestStatus = z.enum(['pending', 'approved', 'denied', 'expired']).meta({ id: 'TimeRequestStatus' });
export type TimeRequestStatus = z.infer<typeof TimeRequestStatus>;

/** Body of POST /v1/device/time-requests: the kid's "Ask for more time" (Q25). The device makes the id. */
export const TimeRequestCreate = z
  .object({
    id: z.uuid(),
    minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    reason: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .meta({ id: 'TimeRequestCreate' });

export type TimeRequestCreate = z.infer<typeof TimeRequestCreate>;

/** A kid's time request, as parents and the asking device see it. */
export const TimeRequest = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    kidName: z.string(),
    deviceId: z.uuid(),
    deviceName: z.string(),
    /** The pool of the device that asked. */
    pool: Pool,
    /** What the kid asked for. */
    minutes: z.int(),
    reason: z.string().nullable(),
    status: TimeRequestStatus,
    createdAt: z.iso.datetime(),
    /** When a parent said yes or no. null while pending, and for expired requests. */
    resolvedAt: z.iso.datetime().nullable(),
    resolvedByName: z.string().nullable(),
    /** The grant made by a yes. */
    grantId: z.uuid().nullable(),
    /** Minutes the yes gave, which may differ from `minutes`. null unless approved. */
    grantedMinutes: z.int().nullable(),
  })
  .meta({ id: 'TimeRequest' });

export type TimeRequest = z.infer<typeof TimeRequest>;

/** Body of POST /v1/requests/{id}/approve. Leave `minutes` out to give what the kid asked for. */
export const TimeRequestApprove = z
  .object({
    minutes: z
      .int()
      .min(15)
      .max(1440)
      .refine((m) => m % 15 === 0, 'minutes must be a multiple of 15.')
      .optional(),
  })
  .meta({ id: 'TimeRequestApprove' });

export type TimeRequestApprove = z.infer<typeof TimeRequestApprove>;

/** Data of the `request_resolved` message to kid devices (docs/SPEC.md §10). */
export const RequestResolved = z
  .object({
    requestId: z.uuid(),
    approved: z.boolean(),
    /** Minutes given; 0 when the answer was no. */
    minutes: z.int(),
    byName: z.string(),
    /** The new grant when the answer was yes, so the device can count it before it syncs. */
    grant: StateGrant.nullable(),
  })
  .meta({ id: 'RequestResolved' });

export type RequestResolved = z.infer<typeof RequestResolved>;

/** Body of POST /v1/device/messages (Q29). The device makes the id. */
export const KidMessageCreate = z
  .object({
    id: z.uuid(),
    body: z.string().trim().min(1).max(160),
    /** The preset the kid tapped, if any. A preset that no longer exists is stored as null. */
    presetId: z.uuid().nullable().optional(),
  })
  .meta({ id: 'KidMessageCreate' });

export type KidMessageCreate = z.infer<typeof KidMessageCreate>;

export const KidMessage = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    kidName: z.string(),
    deviceId: z.uuid(),
    deviceName: z.string(),
    body: z.string(),
    presetId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'KidMessage' });

export type KidMessage = z.infer<typeof KidMessage>;

/** GET /v1/messages. */
export const MessagePage = z
  .object({
    /** Newest first. */
    messages: z.array(KidMessage),
    /** Pass as `before` to get the next, older page. null on the last page. */
    nextBefore: z.uuid().nullable(),
  })
  .meta({ id: 'MessagePage' });

export type MessagePage = z.infer<typeof MessagePage>;
