/**
 * Games on a kid's PC (docs/SPEC.md §12.6): the PC reports the games it finds, and a parent chooses which get a
 * desktop shortcut that starts the game without asking for an administrator.
 *
 * This file is the seam between the dialog and the server. Until CARD-060 it answers from a list kept in memory, so
 * the dialog can be built and tried on its own.
 */

/** One game on one PC account. `found` games come from the PC; `custom` ones were typed in by a parent. */
export type DeviceGame = {
  id: string;
  label: string;
  exePath: string;
  source: 'found' | 'custom';
  /** A parent wants a shortcut for it on the kid's desktop. */
  shortcut: boolean;
  /** Set when the PC no longer finds it. Always null for a custom game. */
  removedAt: string | null;
};

export type DeviceGames = { games: DeviceGame[] };

export const MAX_GAME_LABEL = 60;
export const MAX_EXE_PATH = 260;

const fake = new Map<string, DeviceGame[]>();

function fakeGames(deviceId: string): DeviceGame[] {
  let games = fake.get(deviceId);
  if (!games) {
    games = [
      {
        id: 'genshin',
        label: 'Genshin Impact',
        exePath: 'C:\\Program Files\\Epic Games\\GenshinImpact\\games\\Genshin Impact game\\GenshinImpact.exe',
        source: 'found',
        shortcut: true,
        removedAt: null,
      },
      {
        id: 'starrail',
        label: 'Honkai: Star Rail',
        exePath: 'C:\\Program Files\\Epic Games\\HonkaiStarRail\\games\\Star Rail Games\\StarRail.exe',
        source: 'found',
        shortcut: false,
        removedAt: null,
      },
    ];
    fake.set(deviceId, games);
  }
  return games;
}

/** GET /v1/devices/{deviceId}/games. */
export async function fetchDeviceGames(deviceId: string): Promise<DeviceGames> {
  return { games: fakeGames(deviceId).map((g) => ({ ...g })) };
}

/** PUT /v1/devices/{deviceId}/games/{gameId}/shortcut. */
export async function saveGameShortcut(deviceId: string, gameId: string, on: boolean): Promise<void> {
  const game = fakeGames(deviceId).find((g) => g.id === gameId);
  if (game) game.shortcut = on;
}

/** POST /v1/devices/{deviceId}/games: a program the PC does not know, with its shortcut on. */
export async function addCustomGame(deviceId: string, label: string, exePath: string): Promise<DeviceGame> {
  const game: DeviceGame = { id: `custom-${crypto.randomUUID()}`, label, exePath, source: 'custom', shortcut: true, removedAt: null };
  fakeGames(deviceId).push(game);
  return { ...game };
}

/** DELETE /v1/devices/{deviceId}/games/{gameId}: custom games only. */
export async function removeCustomGame(deviceId: string, gameId: string): Promise<void> {
  fake.set(
    deviceId,
    fakeGames(deviceId).filter((g) => g.id !== gameId),
  );
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
