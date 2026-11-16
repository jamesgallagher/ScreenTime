import { randomUUID } from 'node:crypto';
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { CustomGameIn, DeviceGame, DeviceGames, DeviceGamesPut, GameId, GameShortcutPut, type GameSource } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { deviceGames, devices } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { stateChanged } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

/** A PC account may have this many programs added by hand. */
const MAX_CUSTOM_GAMES = 20;

const putDeviceGamesRoute = createRoute({
  method: 'put',
  path: '/v1/device/games',
  tags: ['device'],
  summary: 'Send every known game the PC finds now',
  description:
    'A game left out is marked removed and loses its desktop shortcut until the PC finds it again. Programs a parent added by hand are not touched. Windows only.',
  security: deviceBearer,
  request: { body: jsonBody(DeviceGamesPut) },
  responses: { 204: { description: 'Stored.' }, ...errorResponses(401, 409, 422) },
});

const getGamesRoute = createRoute({
  method: 'get',
  path: '/v1/devices/{deviceId}/games',
  tags: ['devices'],
  summary: "A PC account's games",
  security: bearer,
  request: { params: z.object({ deviceId: z.uuid() }) },
  responses: { 200: jsonResponse('The games.', DeviceGames), ...errorResponses(401, 403, 404, 409, 422) },
});

const putShortcutRoute = createRoute({
  method: 'put',
  path: '/v1/devices/{deviceId}/games/{gameId}/shortcut',
  tags: ['devices'],
  summary: "Put a game's shortcut on the kid's desktop, or take it away",
  description: 'The shortcut starts the game without asking for an administrator. A game the PC no longer finds gets 409 when turned on.',
  security: bearer,
  request: { params: z.object({ deviceId: z.uuid(), gameId: GameId }), body: jsonBody(GameShortcutPut) },
  responses: { 204: { description: 'Saved.' }, ...errorResponses(401, 403, 404, 409, 422) },
});

const postGameRoute = createRoute({
  method: 'post',
  path: '/v1/devices/{deviceId}/games',
  tags: ['devices'],
  summary: 'Add a program by its path, with its shortcut on',
  description: 'For a game the PC does not know. At most 20 per PC account; the same path twice gets 409.',
  security: bearer,
  request: { params: z.object({ deviceId: z.uuid() }), body: jsonBody(CustomGameIn) },
  responses: { 201: jsonResponse('The game.', DeviceGame), ...errorResponses(401, 403, 404, 409, 422) },
});

const deleteGameRoute = createRoute({
  method: 'delete',
  path: '/v1/devices/{deviceId}/games/{gameId}',
  tags: ['devices'],
  summary: 'Remove a program a parent added',
  description: 'A game the PC found cannot be removed (409): turn its shortcut off instead.',
  security: bearer,
  request: { params: z.object({ deviceId: z.uuid(), gameId: GameId }) },
  responses: { 204: { description: 'Removed.' }, ...errorResponses(401, 403, 404, 409, 422) },
});

type GameRow = typeof deviceGames.$inferSelect;

function toGame(row: GameRow): DeviceGame {
  return {
    id: row.game,
    label: row.label,
    exePath: row.exePath,
    source: row.source as GameSource,
    shortcut: row.shortcut,
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}

/** The family's Windows device, or 404 for none and 409 for an Android one. */
async function findPc(tx: FamilyTx, deviceId: string) {
  const [device] = await tx
    .select({ id: devices.id, kidId: devices.kidId, platform: devices.platform })
    .from(devices)
    .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)));
  if (!device) throw new ApiError('not_found', 'No such device in your family.');
  if (device.platform !== 'windows') throw new ApiError('conflict', 'Games are only on Windows PCs.');
  return device;
}

/** Games on a kid's PC and their desktop shortcuts (docs/SPEC.md §12.6). Windows only. */
export function registerGameRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(putDeviceGamesRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const { games } = c.req.valid('json');
    const now = new Date();
    const shortcutsChanged = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx.select({ platform: devices.platform }).from(devices).where(eq(devices.id, deviceId));
      if (device?.platform !== 'windows') throw new ApiError('conflict', 'Games are only on Windows PCs.');
      const known = await tx.select().from(deviceGames).where(and(eq(deviceGames.deviceId, deviceId), eq(deviceGames.source, 'found')));
      const byId = new Map(known.map((row) => [row.game, row]));
      let changed = false;
      for (const g of games) {
        const row = byId.get(g.id);
        // Back again, or moved: a game with its shortcut on changes what the PC must show.
        if (row?.shortcut && (row.removedAt !== null || row.exePath !== g.exePath || row.label !== g.label)) changed = true;
        const values = { label: g.label, exePath: g.exePath, removedAt: null };
        await tx
          .insert(deviceGames)
          .values({ familyId, kidId, deviceId, game: g.id, source: 'found', firstSeenAt: now, ...values })
          .onConflictDoUpdate({ target: [deviceGames.deviceId, deviceGames.game], set: values });
      }
      const sent = new Set(games.map((g) => g.id));
      for (const row of known) {
        if (sent.has(row.game) || row.removedAt !== null) continue;
        if (row.shortcut) changed = true;
        await tx.update(deviceGames).set({ removedAt: now }).where(and(eq(deviceGames.deviceId, deviceId), eq(deviceGames.game, row.game)));
      }
      return changed;
    });
    if (shortcutsChanged) await stateChanged(deps, familyId, { deviceId });
    return c.body(null, 204);
  });

  app.openapi(getGamesRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { deviceId } = c.req.valid('param');
    const rows = await withFamily(db, familyId, async (tx) => {
      await findPc(tx, deviceId);
      return tx.select().from(deviceGames).where(eq(deviceGames.deviceId, deviceId)).orderBy(asc(deviceGames.label), asc(deviceGames.game));
    });
    return c.json({ games: rows.map(toGame) }, 200);
  });

  app.openapi(putShortcutRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { deviceId, gameId } = c.req.valid('param');
    const { shortcut } = c.req.valid('json');
    await withFamily(db, familyId, async (tx) => {
      await findPc(tx, deviceId);
      const [row] = await tx.select().from(deviceGames).where(and(eq(deviceGames.deviceId, deviceId), eq(deviceGames.game, gameId)));
      if (!row) throw new ApiError('not_found', 'That game is not on this PC.');
      if (shortcut && row.removedAt !== null) throw new ApiError('conflict', 'That game is not on this PC any more.');
      await tx.update(deviceGames).set({ shortcut }).where(and(eq(deviceGames.deviceId, deviceId), eq(deviceGames.game, gameId)));
    });
    await stateChanged(deps, familyId, { deviceId });
    return c.body(null, 204);
  });

  app.openapi(postGameRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { deviceId } = c.req.valid('param');
    const { label, exePath } = c.req.valid('json');
    const row = await withFamily(db, familyId, async (tx) => {
      const device = await findPc(tx, deviceId);
      const existing = await tx.select().from(deviceGames).where(eq(deviceGames.deviceId, deviceId));
      // Windows paths do not tell upper from lower case.
      if (existing.some((g) => g.removedAt === null && g.exePath.toLowerCase() === exePath.toLowerCase())) {
        throw new ApiError('conflict', 'That program is already in the list.');
      }
      if (existing.filter((g) => g.source === 'custom').length >= MAX_CUSTOM_GAMES) {
        throw new ApiError('conflict', `A PC can have ${MAX_CUSTOM_GAMES} added programs. Remove one first.`);
      }
      const [stored] = await tx
        .insert(deviceGames)
        .values({ familyId, kidId: device.kidId, deviceId, game: `custom-${randomUUID()}`, label, exePath, source: 'custom', shortcut: true })
        .returning();
      if (!stored) throw new Error('insert returned no row');
      return stored;
    });
    await stateChanged(deps, familyId, { deviceId });
    return c.json(toGame(row), 201);
  });

  app.openapi(deleteGameRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { deviceId, gameId } = c.req.valid('param');
    await withFamily(db, familyId, async (tx) => {
      await findPc(tx, deviceId);
      const [row] = await tx.select().from(deviceGames).where(and(eq(deviceGames.deviceId, deviceId), eq(deviceGames.game, gameId)));
      if (!row) throw new ApiError('not_found', 'That game is not on this PC.');
      if (row.source !== 'custom') throw new ApiError('conflict', 'The PC found that game. Turn its shortcut off instead.');
      await tx.delete(deviceGames).where(and(eq(deviceGames.deviceId, deviceId), eq(deviceGames.game, gameId)));
    });
    await stateChanged(deps, familyId, { deviceId });
    return c.body(null, 204);
  });
}
