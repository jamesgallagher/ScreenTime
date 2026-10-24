import { z } from 'zod';

/** True for an IANA time zone this runtime knows, for example `Australia/Sydney`. */
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZone = z.string().min(1).max(64).refine(isTimeZone, 'Unknown time zone.');

/** International phone number, for example `+61412345678`. */
export const PhoneE164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'Use international format, for example +61412345678.');

/** Short number the kid's phone may always call, for example `000`. */
export const EmergencyNumber = z.string().regex(/^[0-9]{2,6}$/);

export const Family = z
  .object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
    emergencyNumber: z.string(),
  })
  .meta({ id: 'Family' });

export type Family = z.infer<typeof Family>;

/** Body of PATCH /v1/family. Send only the fields to change. */
export const FamilyPatch = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: TimeZone.optional(),
    emergencyNumber: EmergencyNumber.optional(),
  })
  .meta({ id: 'FamilyPatch' });

export type FamilyPatch = z.infer<typeof FamilyPatch>;

export const Parent = z
  .object({
    id: z.uuid(),
    email: z.email(),
    displayName: z.string(),
    phoneE164: z.string().nullable(),
  })
  .meta({ id: 'Parent' });

export type Parent = z.infer<typeof Parent>;

/** Body of POST /v1/family/parents and POST /v1/admin/families/{id}/parents. */
export const ParentCreate = z
  .object({
    email: z.email().max(254),
    /** What kids see, for example "Mum" or "Dad". */
    displayName: z.string().trim().min(1).max(40),
    phoneE164: PhoneE164.nullable().optional(),
  })
  .meta({ id: 'ParentCreate' });

export type ParentCreate = z.infer<typeof ParentCreate>;

/** Body of PATCH /v1/family/parents/{id}. The email cannot change. */
export const ParentPatch = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    phoneE164: PhoneE164.nullable().optional(),
  })
  .meta({ id: 'ParentPatch' });

export type ParentPatch = z.infer<typeof ParentPatch>;

export const MessagePreset = z
  .object({
    id: z.uuid(),
    text: z.string(),
  })
  .meta({ id: 'MessagePreset' });

export type MessagePreset = z.infer<typeof MessagePreset>;

/** Body of PUT /v1/family/message-presets: the whole list, in display order. */
export const MessagePresetsPut = z
  .object({
    presets: z
      .array(z.object({ text: z.string().trim().min(1).max(160) }))
      .max(10),
  })
  .meta({ id: 'MessagePresetsPut' });

export type MessagePresetsPut = z.infer<typeof MessagePresetsPut>;

/** Response of GET /v1/family/parent-code: the base32 secret for offline parent-mode codes (SPEC §12.3). */
export const ParentCodeSecret = z
  .object({
    secret: z.string().regex(/^[A-Z2-7]{32}$/),
  })
  .meta({ id: 'ParentCodeSecret' });

export type ParentCodeSecret = z.infer<typeof ParentCodeSecret>;

/** A family as the super admin sees it (GET /v1/admin/families). */
export const AdminFamily = z
  .object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
    createdAt: z.iso.datetime(),
    disabledAt: z.iso.datetime().nullable(),
    parentCount: z.number().int().nonnegative(),
  })
  .meta({ id: 'AdminFamily' });

export type AdminFamily = z.infer<typeof AdminFamily>;

/** Body of POST /v1/admin/families. */
export const AdminFamilyCreate = z
  .object({
    name: z.string().trim().min(1).max(100),
    timezone: TimeZone,
    emergencyNumber: EmergencyNumber.optional(),
    firstParent: ParentCreate,
  })
  .meta({ id: 'AdminFamilyCreate' });

export type AdminFamilyCreate = z.infer<typeof AdminFamilyCreate>;

/** Response of POST /v1/admin/families. */
export const AdminFamilyCreated = z
  .object({
    family: Family,
    parent: Parent,
  })
  .meta({ id: 'AdminFamilyCreated' });

export type AdminFamilyCreated = z.infer<typeof AdminFamilyCreated>;
