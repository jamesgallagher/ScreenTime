import { z } from 'zod';
import { PhoneE164 } from './family.js';

/** The 8 kid avatar colours (docs/SPEC.md §16.1). */
export const AvatarColor = z
  .enum(['#0F766E', '#7C3AED', '#DB2777', '#2563EB', '#EA580C', '#16A34A', '#CA8A04', '#475569'])
  .meta({ id: 'AvatarColor' });

export type AvatarColor = z.infer<typeof AvatarColor>;

export const Kid = z
  .object({
    id: z.uuid(),
    name: z.string(),
    avatarColor: AvatarColor,
  })
  .meta({ id: 'Kid' });

export type Kid = z.infer<typeof Kid>;

/** Body of POST /v1/kids. The kid starts with the default schedule. */
export const KidCreate = z
  .object({
    name: z.string().trim().min(1).max(40),
    avatarColor: AvatarColor,
  })
  .meta({ id: 'KidCreate' });

export type KidCreate = z.infer<typeof KidCreate>;

/** Body of PATCH /v1/kids/{kidId}. Send only the fields to change. */
export const KidPatch = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    avatarColor: AvatarColor.optional(),
  })
  .meta({ id: 'KidPatch' });

export type KidPatch = z.infer<typeof KidPatch>;

/** Local time `HH:MM`, 24-hour. `24:00` means the end of the day. */
const LocalTime = z.string().regex(/^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/, 'Use HH:MM, 00:00 to 24:00.');

/** Whole minutes in a day, 0 to 1440. */
const DayMinutes = z.number().int().min(0).max(1440);

export const ScheduleDay = z
  .object({
    weekday: z.number().int().min(1).max(7),
    screensMin: DayMinutes,
    phoneMin: DayMinutes,
    wake: LocalTime,
    bedtime: LocalTime,
  })
  // Both are zero-padded HH:MM, so comparing the strings compares the times.
  .refine((day) => day.wake < day.bedtime, { message: 'Wake-up must be before bedtime.', path: ['bedtime'] })
  .meta({ id: 'ScheduleDay' });

export type ScheduleDay = z.infer<typeof ScheduleDay>;

/** Body of PUT /v1/kids/{kidId}/schedule (docs/SPEC.md §6.1 schedule_versions). */
export const ScheduleInput = z
  .object({
    warn1Min: z.number().int().min(2).max(60),
    warn2Min: z.number().int().min(1).max(59),
    days: z
      .array(ScheduleDay)
      .length(7)
      .refine((days) => days.every((day, i) => day.weekday === i + 1), {
        message: 'Days must be Monday (1) to Sunday (7), in order.',
      }),
  })
  .refine((s) => s.warn1Min > s.warn2Min, {
    message: 'The first warning must come before the second.',
    path: ['warn2Min'],
  })
  .meta({ id: 'ScheduleInput' });

export type ScheduleInput = z.infer<typeof ScheduleInput>;

export const Schedule = z
  .object({
    version: z.number().int(),
    warn1Min: z.number().int(),
    warn2Min: z.number().int(),
    days: z.array(ScheduleDay),
  })
  .meta({ id: 'Schedule' });

export type Schedule = z.infer<typeof Schedule>;

export const KidContact = z
  .object({
    id: z.uuid(),
    label: z.string(),
    phoneE164: z.string(),
  })
  .meta({ id: 'KidContact' });

export type KidContact = z.infer<typeof KidContact>;

/** Body of PUT /v1/kids/{kidId}/contacts. Replaces the whole list, in this order. */
export const KidContactsPut = z
  .object({
    contacts: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(40),
          phoneE164: PhoneE164,
        }),
      )
      .max(10),
  })
  .meta({ id: 'KidContactsPut' });

export type KidContactsPut = z.infer<typeof KidContactsPut>;
