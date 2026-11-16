import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const GENSHIN = { id: 'genshin', label: 'Genshin Impact', exePath: 'C:\\Program Files\\Epic Games\\GenshinImpact\\games\\Genshin Impact game\\GenshinImpact.exe' };
const STARRAIL = { id: 'starrail', label: 'Honkai: Star Rail', exePath: 'D:\\Games\\Star Rail Games\\StarRail.exe' };

type Game = { id: string; label: string; exePath: string; source: string; shortcut: boolean; removedAt: string | null };

describe.skipIf(!url)('games on a PC', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });

  let dad = '';
  let otherDad = '';
  let kid = '';
  let family = '';
  const pc = { id: '', token: '' };
  const otherPc = { id: '', token: '' };
  const phone = { id: '', token: '' };

  const report = (device: { token: string }, games: unknown[]) => api.put('/v1/device/games', device.token, { games });
  const list = async (device: { id: string }, token = dad) => (await api.get(`/v1/devices/${device.id}/games`, token)).body.games as Game[];
  const shortcut = (device: { id: string }, game: string, on = true, token = dad) =>
    api.put(`/v1/devices/${device.id}/games/${game}/shortcut`, token, { shortcut: on });
  const add = (device: { id: string }, label: string, exePath: string, token = dad) =>
    api.post(`/v1/devices/${device.id}/games`, token, { label, exePath });
  const state = async (device: { token: string }) => (await api.get('/v1/device/state', device.token)).body;
  const onDesktop = async (device: { token: string }) => ((await state(device)).games as { id: string }[]).map((g) => g.id);

  async function addDevice(platform: 'android' | 'windows', form: string, name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({ familyId: family, kidId: kid, platform, form, pool: form === 'phone' ? 'phone' : 'screens', name, tokenHash: hashDeviceToken(token) })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function signIn(familyId: string, parentId: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'web', clientLabel: 'Web' })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    const [b] = await db.insert(families).values({ name: 'B', timezone: 'Australia/Sydney', parentCodeSecret: 'B'.repeat(32) }).returning();
    if (!a || !b) throw new Error('no family');
    family = a.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    const [q] = await db.insert(parents).values({ familyId: b.id, email: 'bea@example.com', displayName: 'Bea' }).returning();
    if (!p || !q) throw new Error('no parent');
    dad = await signIn(family, p.id);
    otherDad = await signIn(b.id, q.id);
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(pc, await addDevice('windows', 'pc', 'Alex on NUC'));
    Object.assign(otherPc, await addDevice('windows', 'pc', 'Alex on Desktop'));
    Object.assign(phone, await addDevice('android', 'phone', 'Pixel 7'));
  });

  it('lists what the PC found, with shortcuts off, per PC account', async () => {
    expect(await list(pc)).toEqual([]);
    expect((await report(pc, [STARRAIL, GENSHIN])).status).toBe(204);
    expect(await list(pc)).toEqual([
      { ...GENSHIN, source: 'found', shortcut: false, removedAt: null },
      { ...STARRAIL, source: 'found', shortcut: false, removedAt: null },
    ]);
    expect(await list(otherPc)).toEqual([]);
    expect(await onDesktop(pc)).toEqual([]);
  });

  it('puts a game in the snapshot when its shortcut is on, and takes it out again', async () => {
    await report(pc, [GENSHIN, STARRAIL]);
    const before = (await state(pc)).stateVersion;
    expect((await shortcut(pc, 'genshin')).status).toBe(204);
    const snapshot = await state(pc);
    expect(snapshot.games).toEqual([GENSHIN]);
    expect(snapshot.stateVersion).not.toBe(before);
    expect(await onDesktop(otherPc)).toEqual([]);
    expect((await list(pc)).map((g) => [g.id, g.shortcut])).toEqual([
      ['genshin', true],
      ['starrail', false],
    ]);
    expect((await shortcut(pc, 'genshin', false)).status).toBe(204);
    expect((await state(pc)).stateVersion).toBe(before);
  });

  it('drops a game the PC no longer finds, and brings it back with its shortcut', async () => {
    await report(pc, [GENSHIN, STARRAIL]);
    await shortcut(pc, 'genshin');
    await report(pc, [STARRAIL]);
    expect(await onDesktop(pc)).toEqual([]);
    const gone = (await list(pc)).find((g) => g.id === 'genshin');
    expect(gone?.removedAt).not.toBeNull();
    expect(gone?.shortcut).toBe(true);
    // Off is always fine; on needs the game to be there.
    expect((await shortcut(pc, 'starrail')).status).toBe(204);
    expect((await shortcut(pc, 'genshin', false)).status).toBe(204);
    expect((await shortcut(pc, 'genshin')).status).toBe(409);
    await pool.query("update device_games set shortcut = true where game = 'genshin'");
    await report(pc, [{ ...GENSHIN, exePath: 'E:\\Moved\\GenshinImpact.exe' }, STARRAIL]);
    expect((await state(pc)).games).toEqual([{ ...GENSHIN, exePath: 'E:\\Moved\\GenshinImpact.exe' }, STARRAIL]);
  });

  it('takes an empty list: every found game is gone', async () => {
    await report(pc, [GENSHIN]);
    await shortcut(pc, 'genshin');
    expect((await report(pc, [])).status).toBe(204);
    expect(await onDesktop(pc)).toEqual([]);
    expect((await list(pc))[0]?.removedAt).not.toBeNull();
  });

  it('adds a program by its path, with its shortcut on, and removes it', async () => {
    await report(pc, [GENSHIN]);
    const added = await add(pc, '  Minecraft  ', 'D:\\Games\\Minecraft\\Launcher.exe');
    expect(added.status).toBe(201);
    const game = added.body as Game;
    expect(game).toMatchObject({ label: 'Minecraft', exePath: 'D:\\Games\\Minecraft\\Launcher.exe', source: 'custom', shortcut: true, removedAt: null });
    expect(game.id).toMatch(/^custom-[0-9a-f-]{36}$/);
    expect((await state(pc)).games).toEqual([{ id: game.id, label: 'Minecraft', exePath: 'D:\\Games\\Minecraft\\Launcher.exe' }]);
    // The PC's own list never touches it.
    await report(pc, []);
    expect(await onDesktop(pc)).toEqual([game.id]);
    expect((await shortcut(pc, game.id, false)).status).toBe(204);
    expect(await onDesktop(pc)).toEqual([]);
    expect((await api.del(`/v1/devices/${pc.id}/games/${game.id}`, dad)).status).toBe(204);
    expect((await list(pc)).map((g) => g.id)).toEqual(['genshin']);
    expect((await api.del(`/v1/devices/${pc.id}/games/${game.id}`, dad)).status).toBe(404);
  });

  it('refuses a bad path, a repeat, and removing a found game', async () => {
    await report(pc, [GENSHIN]);
    for (const bad of ['Games\\Thing.exe', 'C:/Games/Thing.exe', '\\\\server\\share\\Thing.exe', 'C:\\Games\\Thing', 'C:\\Games\\Thing.exe --fast', 'C:\\Ga"mes\\Thing.exe', 'C:\\Games\\D:\\Thing.exe']) {
      expect((await add(pc, 'Thing', bad)).status, bad).toBe(422);
    }
    expect((await add(pc, '', 'C:\\Games\\Thing.exe')).status).toBe(422);
    expect((await add(pc, 'x'.repeat(61), 'C:\\Games\\Thing.exe')).status).toBe(422);
    expect((await add(pc, 'Thing', 'C:\\Games\\Thing.exe')).status).toBe(201);
    expect((await add(pc, 'Thing again', 'c:\\games\\THING.EXE')).status).toBe(409);
    expect((await add(pc, 'Genshin by hand', GENSHIN.exePath)).status).toBe(409);
    expect((await api.del(`/v1/devices/${pc.id}/games/genshin`, dad)).status).toBe(409);
  });

  it('stops at 20 added programs', async () => {
    for (let i = 0; i < 20; i++) expect((await add(pc, `Game ${i}`, `C:\\Games\\${i}\\Game.exe`)).status).toBe(201);
    expect((await add(pc, 'One more', 'C:\\Games\\more\\Game.exe')).status).toBe(409);
  });

  it('refuses what a PC may not send', async () => {
    expect((await report(pc, [GENSHIN, GENSHIN])).status).toBe(422);
    expect((await report(pc, [{ ...GENSHIN, id: 'custom-1' }])).status).toBe(422);
    expect((await report(pc, [{ ...GENSHIN, id: 'Genshin' }])).status).toBe(422);
    expect((await report(pc, [{ ...GENSHIN, exePath: 'GenshinImpact.exe' }])).status).toBe(422);
    expect((await api.put('/v1/device/games', null, { games: [] })).status).toBe(401);
    expect((await api.put('/v1/device/games', dad, { games: [] })).status).toBe(401);
  });

  it('is for Windows only: an Android device gets 409 and an empty list in its snapshot', async () => {
    expect((await report(phone, [GENSHIN])).status).toBe(409);
    expect((await api.get(`/v1/devices/${phone.id}/games`, dad)).status).toBe(409);
    expect((await add(phone, 'Thing', 'C:\\Games\\Thing.exe')).status).toBe(409);
    expect((await state(phone)).games).toEqual([]);
  });

  it('keeps other families and removed devices out', async () => {
    await report(pc, [GENSHIN]);
    expect((await api.get(`/v1/devices/${pc.id}/games`, otherDad)).status).toBe(404);
    expect((await shortcut(pc, 'genshin', true, otherDad)).status).toBe(404);
    expect((await add(pc, 'Thing', 'C:\\Games\\Thing.exe', otherDad)).status).toBe(404);
    expect((await api.get(`/v1/devices/${pc.id}/games`, null)).status).toBe(401);
    expect((await shortcut(pc, 'nothere')).status).toBe(404);
    expect((await api.put(`/v1/devices/${pc.id}/games/genshin/shortcut`, dad, { shortcut: 'yes' })).status).toBe(422);
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, pc.id));
    expect((await api.get(`/v1/devices/${pc.id}/games`, dad)).status).toBe(404);
  });

  it('tells only that PC when a shortcut changes, and not when the PC repeats its list', async () => {
    const calls: unknown[] = [];
    const hub = { send: (ids: Iterable<string>) => void calls.push([...ids]), close() {} };
    const live = client({ db, config: testConfig(url ?? ''), mailer, pusher, hub: hub as never });
    await live.put('/v1/device/games', pc.token, { games: [GENSHIN] });
    expect(calls).toEqual([]);
    await live.put(`/v1/devices/${pc.id}/games/genshin/shortcut`, dad, { shortcut: true });
    expect(calls).toEqual([[pc.id]]);
    await live.put('/v1/device/games', pc.token, { games: [GENSHIN] });
    expect(calls).toHaveLength(1);
    await live.put('/v1/device/games', pc.token, { games: [] });
    expect(calls).toEqual([[pc.id], [pc.id]]);
  });
});
