import { z } from 'zod';

/** What can be downloaded from the family's server (docs/SPEC.md §12.5): the kid app, the parent app and the PC installer. */
export const DownloadApp = z.enum(['kid', 'parent', 'windows']).meta({ id: 'DownloadApp' });

export type DownloadApp = z.infer<typeof DownloadApp>;

/** The latest published file of one app. `url` is relative to the server. */
export const DownloadFile = z
  .object({
    versionName: z.string(),
    sizeBytes: z.number().int().min(1),
    fileName: z.string(),
    url: z.string(),
  })
  .meta({ id: 'DownloadFile' });

export type DownloadFile = z.infer<typeof DownloadFile>;

/** GET /v1/downloads: the latest of each, or null when none has been published. No sign-in needed. */
export const Downloads = z
  .object({
    kid: DownloadFile.nullable(),
    parent: DownloadFile.nullable(),
    windows: DownloadFile.nullable(),
  })
  .meta({ id: 'Downloads' });

export type Downloads = z.infer<typeof Downloads>;
