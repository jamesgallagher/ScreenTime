/**
 * Shared devices (docs/SPEC.md §12.8): a device that belongs to no kid, such as Mum's tablet. It is a kid row of
 * kind `shared`, so every kid route works for it; these helpers decide how the pages show it.
 */
import type { AvatarColor, Device, DeviceForm, Kid, Pool } from '@screentime/schemas';
import { api } from '@/lib/auth';
import { POOL_NAMES } from '@/lib/today';

export type KidKind = 'kid' | 'shared';

// ---- The seam: `kind` on Kid and TodayKid, and creating one. The kind comes from the server. ----

/** A kid, a Today kid or the snapshot's kid: `kid` unless it is a shared device. */
export function kindOf(kid: { id: string; kind?: KidKind }): KidKind {
  return kid.kind ?? 'kid';
}

/** POST /v1/kids `{ name, avatarColor, kind: 'shared' }`: the server turns new-app approval on and gives 0 minutes. */
export async function createShared(name: string, avatarColor: AvatarColor): Promise<Kid> {
  return api.post<Kid>('/v1/kids', { name, avatarColor, kind: 'shared' });
}

// ---- Pure helpers. ----

export function isShared(kid: { id: string; kind?: KidKind }): boolean {
  return kindOf(kid) === 'shared';
}

/** Kids first, then shared devices, each keeping the server's order. */
export function splitByKind<T extends { id: string; kind?: KidKind }>(list: T[]): { kids: T[]; shared: T[] } {
  return { kids: list.filter((k) => !isShared(k)), shared: list.filter(isShared) };
}

/** A shared device has one pool, Screens, which the pages call Time. */
export function poolLabel(pool: Pool, shared: boolean): string {
  return shared ? 'Time' : POOL_NAMES[pool];
}

/** The pools a Today card shows: a shared device's Screens pool only. */
export function poolsShown<P extends { pool: Pool }>(kid: { id: string; kind?: KidKind; pools: P[] }): P[] {
  return isShared(kid) ? kid.pools.filter((p) => p.pool === 'screens') : kid.pools;
}

/** The form of a shared device's one device, for its icon; a tablet until it has one. */
export function sharedForm(devices: Device[] | undefined, kidId: string): DeviceForm {
  return devices?.find((d) => d.kidId === kidId)?.form ?? 'tablet';
}

/** The line under a shared device on the Kids page. */
export function sharedSubtitle(devices: Device[] | undefined, kidId: string): string {
  const device = devices?.find((d) => d.kidId === kidId);
  if (!devices) return ' ';
  return device ? device.name : 'No device connected yet';
}
