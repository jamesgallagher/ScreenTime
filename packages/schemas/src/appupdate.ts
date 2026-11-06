import { z } from 'zod';

/** Body of POST /v1/device/app-update/check: what the kid app runs now (docs/SPEC.md §12.1). */
export const AppUpdateCheck = z
  .object({
    versionCode: z.number().int().min(1),
    versionName: z.string().trim().min(1).max(40),
  })
  .meta({ id: 'AppUpdateCheck' });

export type AppUpdateCheck = z.infer<typeof AppUpdateCheck>;

/** A newer kid app for this device. The device checks `sha256` and `sizeBytes` before it installs. */
export const AppUpdateOffer = z
  .object({
    versionCode: z.number().int().min(1),
    versionName: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().min(1),
  })
  .meta({ id: 'AppUpdateOffer' });

export type AppUpdateOffer = z.infer<typeof AppUpdateOffer>;

/** Answer of POST /v1/device/app-update/check. `offer` is null when there is nothing newer. */
export const AppUpdateAnswer = z.object({ offer: AppUpdateOffer.nullable() }).meta({ id: 'AppUpdateAnswer' });

export type AppUpdateAnswer = z.infer<typeof AppUpdateAnswer>;
