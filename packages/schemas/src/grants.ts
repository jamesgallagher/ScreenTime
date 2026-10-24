import { z } from 'zod';
import { Pool } from './devices.js';

/** A local date, YYYY-MM-DD. */
export const LocalDate = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'Use YYYY-MM-DD.')
  .meta({ id: 'LocalDate' });

/** A time adjustment for one kid, one pool, one day (docs/SPEC.md §6.1 grants). */
export const Grant = z
  .object({
    id: z.uuid(),
    pool: Pool,
    /** Positive adds time, negative takes it away. */
    minutes: z.int(),
    /** The family's local date the grant counts for. */
    day: LocalDate,
    createdAt: z.iso.datetime(),
    /** Display name of the parent who made it. */
    byName: z.string(),
    note: z.string().nullable(),
    /** Set when the grant answers a kid's time request. */
    requestId: z.uuid().nullable(),
  })
  .meta({ id: 'Grant' });

export type Grant = z.infer<typeof Grant>;

/** Body of POST /v1/kids/{kidId}/grants. The app makes the id, so sending it again is safe. */
export const GrantCreate = z
  .object({
    id: z.uuid(),
    pool: Pool,
    /** From the 15-minute roller: a non-zero multiple of 15, at most a day either way. */
    minutes: z
      .int()
      .min(-1440)
      .max(1440)
      .refine((m) => m !== 0 && m % 15 === 0, 'minutes must be a non-zero multiple of 15.'),
    note: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .meta({ id: 'GrantCreate' });

export type GrantCreate = z.infer<typeof GrantCreate>;

/** Body of POST /v1/kids/{kidId}/lock-now. The server works out how many minutes to take away. */
export const LockNow = z
  .object({
    id: z.uuid(),
    pool: Pool,
  })
  .meta({ id: 'LockNow' });

export type LockNow = z.infer<typeof LockNow>;
