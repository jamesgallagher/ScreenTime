import { z } from 'zod';
import { DeviceForm, Pool } from './devices.js';
import { AvatarColor, Schedule } from './kids.js';

/** Why a pool is locked (docs/SPEC.md §7.3). */
export const LockReason = z.enum(['out_of_time', 'bedtime', 'before_wake']).meta({ id: 'LockReason' });
export type LockReason = z.infer<typeof LockReason>;

/** A grant as devices see it. `minutes` is negative for a removal or "lock now". */
export const StateGrant = z
  .object({
    id: z.uuid(),
    minutes: z.int(),
    createdAt: z.iso.datetime(),
    byName: z.string(),
  })
  .meta({ id: 'StateGrant' });

export type StateGrant = z.infer<typeof StateGrant>;

/**
 * A usage segment of any device in the pool. `endedAt` null means still in use. An open segment of a
 * device that has not been heard from for 10 minutes is shown as ending when it was last seen.
 */
export const PoolSegment = z
  .object({
    id: z.uuid(),
    deviceId: z.uuid(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'PoolSegment' });

export type PoolSegment = z.infer<typeof PoolSegment>;

/** GET /v1/device/state: everything a kid device needs to enforce today and the rest of the week (docs/SPEC.md §8.2). */
export const DeviceState = z
  .object({
    serverTime: z.iso.datetime(),
    /** Changes whenever anything below changes. Also sent as the ETag. */
    stateVersion: z.string(),
    device: z.object({
      id: z.uuid(),
      name: z.string(),
      form: DeviceForm,
      pool: Pool,
      hasCellular: z.boolean(),
    }),
    kid: z.object({ id: z.uuid(), name: z.string() }),
    family: z.object({ timezone: z.string(), emergencyNumber: z.string(), parentCodeSecret: z.string() }),
    /** Every parent of the family, oldest first. Only those with a phone number can be called. */
    parents: z.array(z.object({ id: z.uuid(), displayName: z.string(), phoneE164: z.string().nullable() })),
    contacts: z.array(z.object({ label: z.string(), phoneE164: z.string() })),
    messagePresets: z.array(z.object({ id: z.uuid(), text: z.string() })),
    schedule: Schedule,
    today: z.object({
      /** The family's local date, YYYY-MM-DD. */
      date: z.string(),
      /** Grants for this kid and this device's pool today, oldest first. */
      grants: z.array(StateGrant),
      /** Segments of every device in this pool (this one too) that overlap today, oldest first. */
      poolSegments: z.array(PoolSegment),
    }),
    parentMode: z.object({
      active: z.boolean(),
      endsAt: z.iso.datetime().nullable(),
      byName: z.string().nullable(),
    }),
    /** The kid's pending "ask for more time" for this pool today, if any. */
    pendingRequest: z.object({ id: z.uuid(), minutes: z.int(), createdAt: z.iso.datetime() }).nullable(),
    activeSos: z.object({ id: z.uuid(), startedAt: z.iso.datetime() }).nullable(),
  })
  .meta({ id: 'DeviceState' });

export type DeviceState = z.infer<typeof DeviceState>;

/** One usage segment as a device sends it. The device makes the id, so sending it again is safe. */
export const UsageSegmentIn = z
  .object({
    id: z.uuid(),
    startedAt: z.iso.datetime({ offset: true }),
    /** null while the segment is still open. Send it again with the end time when it closes. */
    endedAt: z.iso.datetime({ offset: true }).nullable(),
    /** The device had no contact with the server while recording. */
    recordedOffline: z.boolean(),
  })
  .refine((s) => s.endedAt === null || Date.parse(s.endedAt) >= Date.parse(s.startedAt), {
    message: 'endedAt must not be before startedAt.',
    path: ['endedAt'],
  })
  .meta({ id: 'UsageSegmentIn' });

export type UsageSegmentIn = z.infer<typeof UsageSegmentIn>;

/** Body of POST /v1/device/usage. */
export const UsageUpload = z
  .object({ segments: z.array(UsageSegmentIn).min(1).max(500) })
  .meta({ id: 'UsageUpload' });

export type UsageUpload = z.infer<typeof UsageUpload>;

export const UsageReceipt = z
  .object({
    /** Segments stored or updated. A segment id that belongs to another device is ignored. */
    received: z.int(),
  })
  .meta({ id: 'UsageReceipt' });

export type UsageReceipt = z.infer<typeof UsageReceipt>;

/** A device on the parent dashboard. */
export const TodayDevice = z
  .object({
    id: z.uuid(),
    name: z.string(),
    form: DeviceForm,
    /** The device has an open usage segment. */
    inUse: z.boolean(),
    lastSeenAt: z.iso.datetime().nullable(),
    /** Set while parent mode is on for this device. `endsAt` null means until a parent ends it. */
    parentMode: z.object({ endsAt: z.iso.datetime().nullable(), byName: z.string().nullable() }).nullable(),
  })
  .meta({ id: 'TodayDevice' });

export type TodayDevice = z.infer<typeof TodayDevice>;

/** One pool of one kid today, worked out by the time engine (docs/SPEC.md §7). */
export const TodayPool = z
  .object({
    pool: Pool,
    /** Today's allowance from the schedule. */
    allowanceMin: z.int(),
    /** Sum of today's grants; negative when more was taken away than added. */
    grantedMin: z.int(),
    usedSec: z.int(),
    remainingSec: z.int(),
    locked: z.boolean(),
    lockReason: LockReason.nullable(),
    nextLockAt: z.iso.datetime().nullable(),
    overspendSec: z.int(),
    /** The kid's devices in this pool, oldest first. */
    devices: z.array(TodayDevice),
  })
  .meta({ id: 'TodayPool' });

export type TodayPool = z.infer<typeof TodayPool>;

export const TodayKid = z
  .object({
    id: z.uuid(),
    name: z.string(),
    avatarColor: AvatarColor,
    /** Always both pools, Screens first. */
    pools: z.array(TodayPool),
  })
  .meta({ id: 'TodayKid' });

export type TodayKid = z.infer<typeof TodayKid>;

/** GET /v1/today: the parent dashboard. */
export const Today = z
  .object({
    serverTime: z.iso.datetime(),
    /** The family's local date, YYYY-MM-DD. */
    date: z.string(),
    /** Kids oldest first; archived kids are left out. */
    kids: z.array(TodayKid),
  })
  .meta({ id: 'Today' });

export type Today = z.infer<typeof Today>;
