import { z } from 'zod';

/** What a signed-in parent may do. `superadmin` comes from the SUPER_ADMIN_EMAIL setting (docs/SPEC.md §6.2). */
export const Role = z.enum(['parent', 'superadmin']).meta({ id: 'Role' });

export type Role = z.infer<typeof Role>;

/** Body of POST /v1/auth/otp/request. */
export const OtpRequest = z
  .object({
    email: z.email().max(254),
  })
  .meta({ id: 'OtpRequest' });

export type OtpRequest = z.infer<typeof OtpRequest>;

/** Body of POST /v1/auth/otp/verify. */
export const OtpVerifyRequest = z
  .object({
    email: z.email().max(254),
    code: z.string().regex(/^[0-9]{6}$/),
    client: z.enum(['web', 'android']),
    clientLabel: z.string().min(1).max(100),
  })
  .meta({ id: 'OtpVerifyRequest' });

export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequest>;

/** Body of POST /v1/auth/refresh. The web app sends `{}`: its refresh token is in the `st_refresh` cookie. */
export const RefreshRequest = z
  .object({
    refreshToken: z.string().min(1).max(200).optional(),
  })
  .meta({ id: 'RefreshRequest' });

export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** The signed-in parent, their family and roles (GET /v1/me). Both are null for a super admin who is not a parent. */
export const Me = z
  .object({
    parent: z
      .object({
        id: z.uuid(),
        email: z.email(),
        displayName: z.string(),
        phoneE164: z.string().nullable(),
      })
      .nullable(),
    family: z
      .object({
        id: z.uuid(),
        name: z.string(),
        timezone: z.string(),
        emergencyNumber: z.string(),
      })
      .nullable(),
    roles: z.array(Role),
  })
  .meta({ id: 'Me' });

export type Me = z.infer<typeof Me>;

/** Response of POST /v1/auth/otp/verify and POST /v1/auth/refresh. */
export const AuthResponse = z
  .object({
    accessToken: z.string(),
    /** Android only. A web session gets it in the `st_refresh` cookie instead (HttpOnly, docs/SPEC.md §11.1). */
    refreshToken: z.string().optional(),
    /** Seconds until the access token expires. */
    expiresIn: z.number().int().positive(),
    me: Me,
  })
  .meta({ id: 'AuthResponse' });

export type AuthResponse = z.infer<typeof AuthResponse>;
