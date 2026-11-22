import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppUpdateOffer } from '@screentime/schemas';

/** `kid.json` in the releases folder, written by `android/publish-kid.ps1` after the APK is in place. */
const KidRelease = AppUpdateOffer.extend({
  file: z.string().regex(/^[A-Za-z0-9._-]+\.apk$/),
  /** Only these devices, to try a version on one device first. Left out: every Android device. */
  deviceIds: z.array(z.uuid()).optional(),
});

export type KidRelease = z.infer<typeof KidRelease>;

/** `windows.json` in the releases folder, written by `deploy/publish-downloads.ps1 -Windows` after the MSI is in place. */
const WindowsRelease = AppUpdateOffer.extend({
  file: z.string().regex(/^[A-Za-z0-9._-]+\.msi$/),
  /** Only these devices, to try a version on one PC first. Left out: every Windows device. */
  deviceIds: z.array(z.uuid()).optional(),
});

export type WindowsRelease = z.infer<typeof WindowsRelease>;

/** The published release, or null when there is none or `kid.json` is not valid (which is logged). */
export async function readKidRelease(dir: string | null): Promise<KidRelease | null> {
  if (!dir) return null;
  let text: string;
  try {
    text = await readFile(join(dir, 'kid.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    return KidRelease.parse(JSON.parse(text));
  } catch (err) {
    console.error('kid.json is not valid', err);
    return null;
  }
}

/** The published release, or null when there is none or `windows.json` is not valid (which is logged). */
export async function readWindowsRelease(dir: string | null): Promise<WindowsRelease | null> {
  if (!dir) return null;
  let text: string;
  try {
    text = await readFile(join(dir, 'windows.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    return WindowsRelease.parse(JSON.parse(text));
  } catch (err) {
    console.error('windows.json is not valid', err);
    return null;
  }
}

/**
 * The offer for a device, using the same rules as the check route: nothing when the device never reported its
 * version code; platform decides kid.json or windows.json; null when the release is missing, invalid, not newer,
 * or restricted to other devices. The offer without `file` or `deviceIds` so it can be stored and sent safely.
 */
export async function offerFor(
  releasesDir: string | null,
  platform: string,
  deviceId: string,
  currentCode: number | null,
): Promise<{ versionCode: number; versionName: string; sha256: string; sizeBytes: number } | null> {
  if (currentCode === null) return null;
  if (platform === 'android') {
    const release = await readKidRelease(releasesDir);
    if (!release) return null;
    if (release.versionCode <= currentCode) return null;
    if (release.deviceIds && !release.deviceIds.includes(deviceId)) return null;
    const { versionCode, versionName, sha256, sizeBytes } = release;
    return { versionCode, versionName, sha256, sizeBytes };
  }
  if (platform === 'windows') {
    const release = await readWindowsRelease(releasesDir);
    if (!release) return null;
    if (release.versionCode <= currentCode) return null;
    if (release.deviceIds && !release.deviceIds.includes(deviceId)) return null;
    const { versionCode, versionName, sha256, sizeBytes } = release;
    return { versionCode, versionName, sha256, sizeBytes };
  }
  return null;
}

/**
 * The published release's versionName when its versionCode matches the requested code, else null. Used by the
 * devices list to name a requested version when the release is still there.
 */
export async function releaseVersionName(
  releasesDir: string | null,
  platform: string,
  versionCode: number,
): Promise<string | null> {
  if (platform === 'android') {
    const release = await readKidRelease(releasesDir);
    if (release && release.versionCode === versionCode) return release.versionName;
    return null;
  }
  if (platform === 'windows') {
    const release = await readWindowsRelease(releasesDir);
    if (release && release.versionCode === versionCode) return release.versionName;
    return null;
  }
  return null;
}
