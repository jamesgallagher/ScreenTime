import type { KidApp as ServerApp, KidAppDevice, KidApps as ServerApps } from '@screentime/schemas';
import { api } from '@/lib/auth';
import { formatDuration } from '@/lib/format';

export type { KidAppDevice };

/** A parent's rule for an app (docs/SPEC.md §12.4). `held` is written by the server while a new app waits. */
export type AppRuleMode = 'allowed' | 'held' | 'blocked';

export type KidApp = ServerApp & { rule: { mode: AppRuleMode } | null };

export interface KidApps {
  newAppApproval: boolean;
  apps: KidApp[];
}

/** The seam: CARD-057 replaces this, and the three functions below, with the server. */
export const APP_RULES_READY = import.meta.env.DEV;
const fakeRules = new Map<string, AppRuleMode>();
let fakeApproval = false;

/** GET /v1/kids/{kidId}/apps (docs/SPEC.md §12.4). */
export async function fetchKidApps(kidId: string): Promise<KidApps> {
  const server = await api.get<ServerApps>(`/v1/kids/${kidId}/apps`);
  return {
    newAppApproval: fakeApproval,
    apps: server.apps.map((a) => {
      const mode = fakeRules.get(a.package);
      return { ...a, rule: mode ? { mode } : null };
    }),
  };
}

export async function saveAppRule(_kidId: string, pkg: string, mode: 'allowed' | 'blocked'): Promise<void> {
  fakeRules.set(pkg, mode);
}

export async function saveNewAppApproval(_kidId: string, on: boolean): Promise<void> {
  fakeApproval = on;
}

/** What the row's control shows: nothing to choose, waiting for an answer, or the choice. */
export type AppChoice = 'fixed' | 'waiting' | 'allowed' | 'blocked';

export function appChoice(app: KidApp): AppChoice {
  if (!app.blockable) return 'fixed';
  if (app.rule?.mode === 'held') return 'waiting';
  return app.rule?.mode === 'blocked' ? 'blocked' : 'allowed';
}

/** Gone from every device. */
export function isRemoved(app: KidApp): boolean {
  return app.devices.every((d) => d.removedAt !== null);
}

/** Where it is now, or everywhere it was when it is gone from every device. */
function liveDevices(app: KidApp): KidAppDevice[] {
  return isRemoved(app) ? app.devices : app.devices.filter((d) => d.removedAt === null);
}

function earliest(times: string[]): string | null {
  return times.reduce<string | null>((first, t) => (first === null || t < first ? t : first), null);
}

/** "3 Nov" in the family time zone. */
export function shortDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone, day: 'numeric', month: 'short' }).format(new Date(instant));
}

function deviceNames(app: KidApp): string {
  const names = liveDevices(app).map((d) => d.deviceName);
  return names.length <= 1 ? (names[0] ?? 'a device') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * "From Play Store · 3 Nov on Pixel 7", "Installed another way · 3 Nov on Pixel 7", "Came with Pixel 7 and
 * XPPen tablet". A pre-installed app's date is the phone's, so it is left out.
 */
export function installedLine(app: KidApp, timeZone: string): string {
  if (app.source === 'preinstalled') return `Came with ${deviceNames(app)}`;
  const installed = earliest(liveDevices(app).map((d) => d.installedAt));
  const date = installed ? `${shortDate(installed, timeZone)} on ` : 'on ';
  return `${app.source === 'play' ? 'From Play Store' : 'Installed another way'} · ${date}${deviceNames(app)}`;
}

/** "First used 4 Nov" or "Never opened": the earliest on any of the kid's devices. */
export function firstUsedLine(app: KidApp, timeZone: string): string {
  const first = earliest(app.devices.flatMap((d) => (d.firstUsedAt ? [d.firstUsedAt] : [])));
  return first ? `First used ${shortDate(first, timeZone)}` : 'Never opened';
}

/** "Today 12m", or null before it has been used today. */
export function todayLine(app: KidApp): string | null {
  return app.todaySeconds >= 60 ? `Today ${formatDuration(app.todaySeconds)}` : null;
}

function latestInstall(app: KidApp): string {
  return app.devices.reduce((latest, d) => (d.installedAt > latest ? d.installedAt : latest), '');
}

/**
 * The page's order (docs/SPEC.md §16.4): apps waiting for an answer, then installed apps newest first, then pre-installed ones by name, then
 * removed apps by name, so what the kid just added is at the top.
 */
export function sortApps(apps: KidApp[]): KidApp[] {
  const group = (a: KidApp) => (isRemoved(a) ? 3 : appChoice(a) === 'waiting' ? 0 : a.source === 'preinstalled' ? 2 : 1);
  return [...apps].sort((a, b) => {
    if (group(a) !== group(b)) return group(a) - group(b);
    if (group(a) <= 1) {
      const byDate = latestInstall(b).localeCompare(latestInstall(a));
      if (byDate !== 0) return byDate;
    }
    return a.label.localeCompare(b.label, 'en-AU', { sensitivity: 'base' });
  });
}
