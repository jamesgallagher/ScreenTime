import { z } from 'zod';

/**
 * Games on a kid's Windows PC (docs/SPEC.md §12.6). Some games ask for an administrator at every start but run without
 * one when their launcher is skipped; the PC starts them that way from a desktop shortcut a parent turns on.
 */

/** A game's id on one PC account: `genshin`, `starrail`, or `custom-<uuid>` for a program a parent added. */
export const GameId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .meta({ id: 'GameId' });

export type GameId = z.infer<typeof GameId>;

/** A full Windows path to an .exe on a drive, such as `D:\Games\Thing\Thing.exe`. */
export const ExePath = z
  .string()
  .min(8)
  .max(260)
  .regex(/^[a-zA-Z]:\\[^<>:"|?*]*\.[eE][xX][eE]$/)
  .meta({ id: 'ExePath' });

export type ExePath = z.infer<typeof ExePath>;

/** One game the PC found, as the PC sends it. */
export const FoundGameIn = z.object({ id: GameId, label: z.string().min(1).max(60), exePath: ExePath }).meta({ id: 'FoundGameIn' });

export type FoundGameIn = z.infer<typeof FoundGameIn>;

/** Body of PUT /v1/device/games: every known game the PC finds now. May be empty. */
export const DeviceGamesPut = z
  .object({ games: z.array(FoundGameIn).max(50) })
  .refine((body) => new Set(body.games.map((g) => g.id)).size === body.games.length, { message: 'Each game may appear only once.' })
  .refine((body) => body.games.every((g) => !g.id.startsWith('custom-')), { message: 'A PC cannot report a custom game.' })
  .meta({ id: 'DeviceGamesPut' });

export type DeviceGamesPut = z.infer<typeof DeviceGamesPut>;

/** Where a game came from: the PC found it, or a parent typed its path. */
export const GameSource = z.enum(['found', 'custom']).meta({ id: 'GameSource' });

export type GameSource = z.infer<typeof GameSource>;

/** One game on one PC account, as parents see it. */
export const DeviceGame = z
  .object({
    id: GameId,
    label: z.string(),
    exePath: z.string(),
    source: GameSource,
    /** A parent wants a shortcut for it on the kid's desktop. */
    shortcut: z.boolean(),
    /** Set when the PC no longer finds it. Always null for a custom game. */
    removedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'DeviceGame' });

export type DeviceGame = z.infer<typeof DeviceGame>;

/** Answer of GET /v1/devices/{deviceId}/games. */
export const DeviceGames = z.object({ games: z.array(DeviceGame) }).meta({ id: 'DeviceGames' });

export type DeviceGames = z.infer<typeof DeviceGames>;

/** Body of PUT /v1/devices/{deviceId}/games/{gameId}/shortcut. */
export const GameShortcutPut = z.object({ shortcut: z.boolean() }).meta({ id: 'GameShortcutPut' });

export type GameShortcutPut = z.infer<typeof GameShortcutPut>;

/** Body of POST /v1/devices/{deviceId}/games: a program the PC does not know. Its shortcut starts on. */
export const CustomGameIn = z.object({ label: z.string().trim().min(1).max(60), exePath: ExePath }).meta({ id: 'CustomGameIn' });

export type CustomGameIn = z.infer<typeof CustomGameIn>;

/** One game the PC makes a desktop shortcut for (in the device state snapshot). */
export const StateGame = z.object({ id: GameId, label: z.string(), exePath: z.string() }).meta({ id: 'StateGame' });

export type StateGame = z.infer<typeof StateGame>;
