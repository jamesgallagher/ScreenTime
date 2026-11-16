/**
 * Games on a kid's PC (docs/SPEC.md §12.6): the PC reports the games it finds, and a parent chooses which get a
 * desktop shortcut that starts the game without asking for an administrator.
 *
 * This file is the seam between the dialog and the server.
 */
import type { DeviceGame, DeviceGames } from '@screentime/schemas';
import { api } from '@/lib/auth';

export type { DeviceGame, DeviceGames };

export const MAX_GAME_LABEL = 60;
export const MAX_EXE_PATH = 260;

/** GET /v1/devices/{deviceId}/games. */
export function fetchDeviceGames(deviceId: string): Promise<DeviceGames> {
  return api.get<DeviceGames>(`/v1/devices/${deviceId}/games`);
}

/** PUT /v1/devices/{deviceId}/games/{gameId}/shortcut. */
export async function saveGameShortcut(deviceId: string, gameId: string, on: boolean): Promise<void> {
  await api.put(`/v1/devices/${deviceId}/games/${encodeURIComponent(gameId)}/shortcut`, { shortcut: on });
}

/** POST /v1/devices/{deviceId}/games: a program the PC does not know, with its shortcut on. */
export function addCustomGame(deviceId: string, label: string, exePath: string): Promise<DeviceGame> {
  return api.post<DeviceGame>(`/v1/devices/${deviceId}/games`, { label, exePath });
}

/** DELETE /v1/devices/{deviceId}/games/{gameId}: custom games only. */
export async function removeCustomGame(deviceId: string, gameId: string): Promise<void> {
  await api.delete(`/v1/devices/${deviceId}/games/${encodeURIComponent(gameId)}`);
}

/**
 * What is wrong with a typed path to a program, or null when it will do: a full Windows path to an .exe, such as
 * `D:\Games\Thing\Thing.exe`. The same rule as the server's.
 */
export function exePathError(path: string): string | null {
  const p = path.trim();
  if (p === '') return 'Type the full path to the program.';
  if (p.length > MAX_EXE_PATH) return `Keep the path under ${MAX_EXE_PATH} characters.`;
  if (!/^[a-zA-Z]:\\/.test(p)) return 'Start with the drive, like C:\\Games\\Thing\\Thing.exe.';
  if (/[<>"|?*]/.test(p) || p.slice(2).includes(':')) return "A path can't have < > \" | ? * or a second colon.";
  if (!/\.exe$/i.test(p)) return 'The path must end in .exe.';
  return null;
}

/** A typed path as it is saved: trimmed, without the quotes "Copy as path" adds. */
export function cleanExePath(path: string): string {
  return path.trim().replace(/^"(.*)"$/, '$1').trim();
}

/** The small line under a game's name. */
export function gameLine(game: DeviceGame): string {
  if (game.removedAt !== null) return 'Not on this PC any more';
  return game.exePath;
}

/** Games still on the PC first, by name; then the ones that are gone. */
export function sortGames(games: DeviceGame[]): DeviceGame[] {
  return [...games].sort((a, b) => {
    const gone = Number(a.removedAt !== null) - Number(b.removedAt !== null);
    if (gone !== 0) return gone;
    return a.label.localeCompare(b.label, 'en-AU', { sensitivity: 'base' });
  });
}
