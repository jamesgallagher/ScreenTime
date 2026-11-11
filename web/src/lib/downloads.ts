import type { DownloadFile, Downloads } from '@screentime/schemas';

export type { DownloadFile, Downloads };

/** What the visitor is on, for the download page at /app (docs/SPEC.md §12.5). */
export type Platform = 'android-phone' | 'android-tablet' | 'windows' | 'other';

/**
 * From the browser's user agent: Android with "Mobile" is a phone and without it a tablet (Chrome's own rule);
 * "Windows NT" is a PC. Anything else, an iPhone or a Mac for example, gets everything.
 */
export function detectPlatform(userAgent: string): Platform {
  if (/Android/i.test(userAgent)) return /Mobile/i.test(userAgent) ? 'android-phone' : 'android-tablet';
  if (/Windows NT/i.test(userAgent)) return 'windows';
  return 'other';
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  'android-phone': 'Android phone',
  'android-tablet': 'Android tablet',
  windows: 'Windows PC',
  other: 'Another device',
};

/** Which downloads a platform sees, most useful first. */
export function downloadsFor(platform: Platform): ('parent' | 'kid' | 'windows')[] {
  switch (platform) {
    case 'android-phone':
    case 'android-tablet':
      return ['parent', 'kid'];
    case 'windows':
      return ['windows', 'parent', 'kid'];
    case 'other':
      return ['parent', 'windows', 'kid'];
  }
}

/** "32 MB", "640 KB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** GET /v1/downloads: public, so no sign-in token. */
export async function fetchDownloads(): Promise<Downloads> {
  const res = await fetch('/v1/downloads', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`The server said ${res.status}`);
  return (await res.json()) as Downloads;
}
