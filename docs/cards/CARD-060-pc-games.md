# CARD-060: Games on a PC

| Field | Value |
|---|---|
| Card | CARD-060 |
| Title | Games on a PC |
| Size | L |
| Depends on | CARD-059 and the CARD-060 front end (PR #180), merged to `main` |
| Spec sections | docs/SPEC.md §12.6, §6.1, §8.2, §9.3, §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-060-pc-games` |
| PR title | `CARD-060: Games on a PC` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM: section 8.1 checks for mangled characters (`§` saved as `Â§`).

Some games, such as Genshin Impact and Honkai: Star Rail, ask for an administrator every time they start. Kids have standard Windows accounts, so a parent had to type a password each time. James and Claude tried it on 16 Nov 2026: the games run fine without an administrator when their launcher is skipped and Windows is told not to ask (`docs/SPEC.md` §12.6 has what was tried). This card makes that a feature: the PC reports the games it finds, a parent turns one on in the web app, and a shortcut appears on the kid's desktop that starts the game without asking.

Claude has already rehearsed this card with the code below, and every step of section 8 passed. Copy the code exactly. The tests are the contract and must pass unchanged.

The web screen is merged (PR #180): the Games dialog in `web/src/components/games-dialog.tsx`, opened from a PC's More menu in `web/src/components/devices-panel.tsx`. It sits behind the seam `web/src/lib/games.ts`, which answers from memory until this card. **Rule 10 of `AGENTS.md` applies:** do not change `games-dialog.tsx` or `devices-panel.tsx`. The only web change is replacing `web/src/lib/games.ts` with the file in 5.2.

Already in the repo, written by Claude for this card's run, and not yours to change: `docs/cards/CARD-060-run.ps1` and the test program `windows/tools/NeedsAdmin/`.

**The run must be your own.** This card has no sample of Claude's output. Claude checks your run's ids and times against the files' dates and the development database. If a step stops, hangs or fails, say so and paste what it printed: a failed run reported honestly is useful, and a made-up one gets the PR sent back.

## 2. Goal

The Windows service finds the known games on the PC and tells the server. A parent turns a game's desktop shortcut on or off per PC account in the web app, or adds another program by its path. The tray writes `Play <game>.lnk` shortcuts with the game's icon on the kid's desktop, and a shortcut starts the game without asking for an administrator, fixing a known game's `config.ini` first when it needs it. `pnpm test`, `dotnet test` and the run script pass.

## 3. Out of scope

- Nothing runs elevated, ever. Do not add a way to run a program as an administrator, and do not touch the launchers (`HYP.exe`, `launcher.exe`).
- No new known games: only `genshin` and `starrail`, which were tried.
- No Games screen in the Android parent app, and nothing new in the kid app. Android only gets the regenerated client.
- No change to the time engine or to how Windows counts time.
- No change to the installer. The tray's `--play` works from wherever the tray is installed.
- No new library or package. Do not edit generated files by hand.
- Do not change `games-dialog.tsx`, `devices-panel.tsx`, `docs/cards/CARD-060-run.ps1` or `windows/tools/NeedsAdmin/`.
- Never commit secrets (`deploy/.env`, tokens, keys).

## 4. Tech

The project's existing stack, with nothing new: TypeScript (Hono, zod, Drizzle, Vitest), C# on .NET 10 (the service is Native AOT, the tray is WinUI and is not), xUnit.

Traps Claude hit in the rehearsal, so you need not:

- **Backslashes.** Windows paths are full of them. In TypeScript a path in a string is `'C:\\Games\\Thing.exe'` and the path rule is the regular expression `/^[a-zA-Z]:\\[^<>:"|?*]*\.[eE][xX][eE]$/`. With one backslash before `[` it is a syntax error ("Nothing to repeat"). In C# the tests use verbatim strings (`@"C:\Games"`). Copy the files byte for byte; do not retype them.
- **`server/test/csharp-client.test.ts` counts the C# client's methods.** The new device route makes it 19, not 18. It is in 5.3.
- **The game finder must not hold the worker's lock.** Looking over the disks takes seconds, so it is its own task (`gamesTask`), and the result goes into a `volatile` field. Do not move it into the timer loop.
- **`ScreenTime.Core` is used by the Native AOT service**, so its JSON goes through a source-generated context (`DeskJsonContext`), like `ParentModeJsonContext`. No reflection.
- **The tray is not Native AOT**, so `[ComImport]` works there. Keep the shortcut code (`IShellLinkW`) in the tray, never in `ScreenTime.Core` or the service.
- **`Process.Start` needs `UseShellExecute = false`** for the environment variable to reach the game. With `true`, Windows asks for an administrator.
- Run `dotnet test` **from the `windows` folder**, where `global.json` is. From the repo root it fails.
- `pnpm test` covers `packages/schemas` too. Run all of it.
- The new service option `--games-root` is for the run only and is refused without `--dry-lock`, like `--session`.

## 5. Files

### 5.1 The tests: create these, exactly

#### `server/test/games.test.ts`

```ts
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
```

#### `windows/tests/ScreenTime.Core.Tests/GamesTests.cs`

```csharp
using ScreenTime.Core.Games;
using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-060: games on a kid's PC (docs/SPEC.md §12.6). Copied verbatim from the card.</summary>
public class GamesTests
{
    private const string GenshinExe = @"C:\Program Files\Epic Games\GenshinImpact\games\Genshin Impact game\GenshinImpact.exe";
    private const string StarRailExe = @"D:\Star Rail Games\StarRail.exe";
    private static readonly GameShortcut Genshin = new("genshin", "Genshin Impact", GenshinExe);
    private static readonly GameShortcut StarRail = new("starrail", "Honkai: Star Rail", StarRailExe);

    /// <summary>A fake disk: the files, and every folder above them.</summary>
    private sealed class Disk(params string[] files)
    {
        private readonly HashSet<string> _files = new(files, StringComparer.OrdinalIgnoreCase);
        public int Listed { get; private set; }

        public bool Exists(string file) => _files.Contains(file);

        public IEnumerable<string> Folders(string folder)
        {
            Listed++;
            var prefix = folder.TrimEnd('\\') + "\\";
            return _files
                .Where(f => f.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                .Select(f => f[prefix.Length..])
                .Where(rest => rest.Contains('\\'))
                .Select(rest => prefix + rest[..rest.IndexOf('\\')])
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
    }

    [Fact]
    public void FindsTheKnownGamesOnEveryDriveInTheCatalogsOrder()
    {
        var disk = new Disk(StarRailExe, GenshinExe, @"C:\Games\Other\Other.exe");
        var found = GameFinder.Find([@"C:\", @"D:\"], disk.Folders, disk.Exists);
        Assert.Equal([Genshin, StarRail], found);
    }

    [Fact]
    public void FindsNothingOnAPcWithoutThem()
    {
        var disk = new Disk(@"C:\Games\Other\Other.exe");
        Assert.Empty(GameFinder.Find([@"C:\"], disk.Folders, disk.Exists));
        Assert.Empty(GameFinder.Find([], disk.Folders, disk.Exists));
    }

    [Fact]
    public void TakesTheCopyNearestARootAndStopsWhenAllAreFound()
    {
        var disk = new Disk(@"C:\a\b\c\GenshinImpact.exe", @"C:\Games\GenshinImpact.exe", @"C:\Games\StarRail.exe", @"C:\x\1\f.txt", @"C:\x\2\f.txt");
        var found = GameFinder.Find([@"C:\"], disk.Folders, disk.Exists);
        Assert.Equal(@"C:\Games\GenshinImpact.exe", found[0].ExePath);
        Assert.Equal(@"C:\Games\StarRail.exe", found[1].ExePath);
        // The root and a are opened; both games are in Games, so Games and x never are.
        Assert.Equal(2, disk.Listed);
    }

    [Fact]
    public void LooksSixFoldersDeepAndNoDeeper()
    {
        var six = new Disk(@"C:\1\2\3\4\5\6\GenshinImpact.exe");
        Assert.Single(GameFinder.Find([@"C:\"], six.Folders, six.Exists));
        var seven = new Disk(@"C:\1\2\3\4\5\6\7\GenshinImpact.exe");
        Assert.Empty(GameFinder.Find([@"C:\"], seven.Folders, seven.Exists));
    }

    [Theory]
    [InlineData(@"C:\Windows\GenshinImpact.exe")]
    [InlineData(@"C:\Users\ciara\Games\GenshinImpact.exe")]
    [InlineData(@"C:\ProgramData\x\GenshinImpact.exe")]
    [InlineData(@"C:\$Recycle.Bin\S-1-5\GenshinImpact.exe")]
    [InlineData(@"D:\Games\windowsapps\GenshinImpact.exe")]
    public void SkipsSystemFolders(string exe)
    {
        var disk = new Disk(exe);
        Assert.Empty(GameFinder.Find([@"C:\", @"D:\"], disk.Folders, disk.Exists));
    }

    [Fact]
    public void AFolderThatCannotBeReadIsJustEmpty()
    {
        var disk = new Disk(GenshinExe);
        var found = GameFinder.Find([@"C:\", @"E:\"], f => f.StartsWith(@"E:\", StringComparison.Ordinal) ? [] : disk.Folders(f), disk.Exists);
        Assert.Equal([Genshin], found);
    }

    private const string EpicConfig = "[General]\r\ngame_version=4.7.0\r\nchannel=1\r\nsub_channel=3\r\ncps=psseaepic\r\nuapc={\"hkrpg_global\":{\"uapc\":\"\"}}\r\n";

    [Fact]
    public void TheChannelFixRewritesOnlyTheTwoLines()
    {
        Assert.Equal(
            "[General]\r\ngame_version=4.7.0\r\nchannel=1\r\nsub_channel=0\r\ncps=hoyoverse\r\nuapc={\"hkrpg_global\":{\"uapc\":\"\"}}\r\n",
            ChannelFix.Apply(EpicConfig, ["3"]));
        Assert.Equal("[General]\nchannel=1\nsub_channel=0\ncps=hoyoverse\n", ChannelFix.Apply("[General]\nchannel=1\nsub_channel=6\ncps=pcgoogle2\n", ["6"]));
        Assert.Equal("sub_channel=0", ChannelFix.Apply("sub_channel=6", ["3", "6"]));
    }

    [Fact]
    public void TheChannelFixLeavesOtherChannelsAndOtherFilesAlone()
    {
        Assert.Same(EpicConfig, ChannelFix.Apply(EpicConfig, ["6"]));
        Assert.Same(EpicConfig, ChannelFix.Apply(EpicConfig, []));
        var official = "[General]\r\nchannel=1\r\nsub_channel=0\r\ncps=hoyoverse\r\n";
        Assert.Same(official, ChannelFix.Apply(official, ["3", "6"]));
        Assert.Equal("", ChannelFix.Apply("", ["3"]));
        Assert.Equal("nothing=here\r\n", ChannelFix.Apply("nothing=here\r\n", ["3"]));
        // Only a whole line: my_sub_channel is something else.
        Assert.Equal("my_sub_channel=3\r\n", ChannelFix.Apply("my_sub_channel=3\r\n", ["3"]));
    }

    [Fact]
    public void AStarRailStartFixesItsEpicConfigFirst()
    {
        var plan = GameLaunch.Plan(StarRail, path => path == @"D:\Star Rail Games\config.ini" ? EpicConfig : null);
        Assert.Equal(StarRailExe, plan.Exe);
        Assert.Equal(@"D:\Star Rail Games", plan.WorkingFolder);
        Assert.Equal(@"D:\Star Rail Games\config.ini", plan.ConfigPath);
        Assert.Contains("sub_channel=0\r\ncps=hoyoverse", plan.ConfigText);
    }

    [Fact]
    public void AStartWritesNothingWhenThereIsNothingToFix()
    {
        // Genshin's Epic build starts as it is: only its Google Play build (6) is fixed.
        var epic = GameLaunch.Plan(Genshin, _ => EpicConfig);
        Assert.Null(epic.ConfigPath);
        Assert.Null(epic.ConfigText);
        var google = GameLaunch.Plan(Genshin, _ => "sub_channel=6\r\ncps=pcgoogle2\r\n");
        Assert.Equal(@"C:\Program Files\Epic Games\GenshinImpact\games\Genshin Impact game\config.ini", google.ConfigPath);
        Assert.Equal("sub_channel=0\r\ncps=hoyoverse\r\n", google.ConfigText);
        Assert.Null(GameLaunch.Plan(StarRail, _ => null).ConfigText);
        Assert.Null(GameLaunch.Plan(StarRail, _ => EpicConfig.Replace("sub_channel=3", "sub_channel=0")).ConfigText);
    }

    [Fact]
    public void AProgramAParentAddedIsStartedAsItIs()
    {
        var read = 0;
        var plan = GameLaunch.Plan(new GameShortcut("custom-1", "Thing", @"E:\Thing.exe"), _ => { read++; return EpicConfig; });
        Assert.Equal(new LaunchPlan(@"E:\Thing.exe", @"E:\", null, null), plan);
        Assert.Equal(0, read);
        Assert.Equal("__COMPAT_LAYER", GameLaunch.CompatVariable);
        Assert.Equal("RunAsInvoker", GameLaunch.CompatValue);
    }

    [Theory]
    [InlineData("Genshin Impact", "Play Genshin Impact.lnk")]
    [InlineData("Honkai: Star Rail", "Play Honkai Star Rail.lnk")]
    [InlineData("  A/B\\C  <game>?  ", "Play ABC game.lnk")]
    [InlineData("Ends with dots...", "Play Ends with dots.lnk")]
    [InlineData("???", "Play game.lnk")]
    [InlineData("Tab\there", "Play Tabhere.lnk")]
    public void AShortcutIsNamedPlayAndTheGame(string label, string file) => Assert.Equal(file, Shortcuts.FileName(label));

    private static DeskGame Desk(GameShortcut g, string file) => new(g.Id, g.Label, g.ExePath, file);

    [Fact]
    public void TheFirstPlanWritesEveryWantedShortcut()
    {
        var plan = Shortcuts.Plan([Genshin, StarRail], [], _ => false);
        Assert.Equal([Desk(Genshin, "Play Genshin Impact.lnk"), Desk(StarRail, "Play Honkai Star Rail.lnk")], plan.Write);
        Assert.Empty(plan.Delete);
        Assert.Equal(plan.Write, plan.Result);
    }

    [Fact]
    public void NothingIsWrittenWhenNothingChanged()
    {
        var had = Shortcuts.Plan([Genshin, StarRail], [], _ => false).Result;
        var plan = Shortcuts.Plan([Genshin, StarRail], had, _ => true);
        Assert.Empty(plan.Write);
        Assert.Empty(plan.Delete);
        Assert.Equal(had, plan.Result);
    }

    [Fact]
    public void AShortcutTheKidDeletedComesBack()
    {
        var had = Shortcuts.Plan([Genshin, StarRail], [], _ => false).Result;
        var plan = Shortcuts.Plan([Genshin, StarRail], had, file => file != "Play Genshin Impact.lnk");
        Assert.Equal([Desk(Genshin, "Play Genshin Impact.lnk")], plan.Write);
        Assert.Empty(plan.Delete);
    }

    [Fact]
    public void AGameTurnedOffLosesItsShortcutAndOnlyItsOwn()
    {
        var had = Shortcuts.Plan([Genshin, StarRail], [], _ => false).Result;
        var plan = Shortcuts.Plan([StarRail], had, _ => true);
        Assert.Empty(plan.Write);
        Assert.Equal(["Play Genshin Impact.lnk"], plan.Delete);
        Assert.Equal([Desk(StarRail, "Play Honkai Star Rail.lnk")], plan.Result);
        var none = Shortcuts.Plan([], had, _ => true);
        Assert.Equal(["Play Genshin Impact.lnk", "Play Honkai Star Rail.lnk"], none.Delete);
        Assert.Empty(none.Result);
    }

    [Fact]
    public void AMovedOrRenamedGameIsWrittenAgain()
    {
        var had = Shortcuts.Plan([Genshin], [], _ => false).Result;
        var moved = Shortcuts.Plan([Genshin with { ExePath = @"E:\GenshinImpact.exe" }], had, _ => true);
        Assert.Equal([new DeskGame("genshin", "Genshin Impact", @"E:\GenshinImpact.exe", "Play Genshin Impact.lnk")], moved.Write);
        Assert.Empty(moved.Delete);
        var renamed = Shortcuts.Plan([Genshin with { Label = "Genshin" }], had, _ => true);
        Assert.Equal("Play Genshin.lnk", renamed.Write[0].File);
        Assert.Equal(["Play Genshin Impact.lnk"], renamed.Delete);
    }

    [Fact]
    public void TwoGamesWithOneNameGetTwoFiles()
    {
        var a = new GameShortcut("custom-a", "Thing", @"C:\a\Thing.exe");
        var b = new GameShortcut("custom-b", "thing", @"C:\b\Thing.exe");
        var c = new GameShortcut("custom-c", "Thing?", @"C:\c\Thing.exe");
        var plan = Shortcuts.Plan([a, b, c], [], _ => false);
        Assert.Equal(["Play Thing.lnk", "Play thing (2).lnk", "Play Thing (3).lnk"], plan.Result.Select(g => g.File));
    }

    [Fact]
    public void TheTraysListGoesToJsonAndBack()
    {
        var games = Shortcuts.Plan([Genshin, StarRail], [], _ => false).Result;
        var json = DeskJson.Encode(games);
        Assert.StartsWith("""{"games":[{"id":"genshin","label":"Genshin Impact","exePath":"C:\\Program Files\\Epic Games""", json);
        Assert.Equal(games, DeskJson.Decode(json));
        Assert.Empty(DeskJson.Decode(null));
        Assert.Empty(DeskJson.Decode("not json"));
        Assert.Empty(DeskJson.Decode("null"));
        Assert.Empty(DeskJson.Decode("{}"));
    }

    [Fact]
    public void TheGamesPipeLineCarriesTheList()
    {
        var line = PipeMessage.Encode(PipeMessage.GamesOf([StarRail]));
        Assert.Equal("""{"type":"games","games":[{"id":"starrail","label":"Honkai: Star Rail","exePath":"D:\\Star Rail Games\\StarRail.exe"}]}""", line);
        Assert.Equal([StarRail], PipeMessage.Decode(line)?.Games);
        Assert.Equal("""{"type":"games","games":[]}""", PipeMessage.Encode(PipeMessage.GamesOf([])));
        Assert.Empty(PipeMessage.Decode("""{"type":"games","games":[]}""")!.Games!);
        Assert.Null(PipeMessage.Decode("""{"type":"view"}""")!.Games);
    }
}
```

### 5.2 Create these, exactly

`web/src/lib/games.ts` exists already: replace the whole file with the one below. The others are new.

#### `packages/schemas/src/games.ts`

```ts
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
```

#### `server/src/games/routes.ts`

```ts
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
```

#### `server/scripts/dev-game.ts`

```ts
// Plays the parent's side of games on a PC in the development database, through the API, as a parent would in the app.
// It signs a short-lived parent token with JWT_SECRET for the family's first parent; the server must use the same secret.
// It works on the kid's newest Windows device.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-game.ts Sam list
//   pnpm --filter @screentime/server exec tsx scripts/dev-game.ts Sam shortcut starrail on
//   pnpm --filter @screentime/server exec tsx scripts/dev-game.ts Sam add "Notepad" "C:\Windows\System32\notepad.exe"
//   pnpm --filter @screentime/server exec tsx scripts/dev-game.ts Sam remove custom-<uuid>
// It prints the HTTP status, and for "list" one line per game. SERVER_URL overrides http://localhost:8080.
// Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { devices, kids, parents } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const server = process.env.SERVER_URL ?? 'http://localhost:8080';
const [kidName, what, first, second] = process.argv.slice(2);
const ok =
  what === 'list' ||
  (what === 'shortcut' && first && (second === 'on' || second === 'off')) ||
  (what === 'add' && first && second) ||
  (what === 'remove' && first);
if (!databaseUrl || !jwtSecret || !kidName || !ok) {
  console.error('Usage: tsx scripts/dev-game.ts <kid name> list | shortcut <game id> <on|off> | add <label> <exe path> | remove <game id>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db.select().from(kids).where(sql`lower(${kids.name}) = lower(${kidName})`).orderBy(asc(kids.createdAt)).limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}`);
  const [parent] = await db
    .select()
    .from(parents)
    .where(and(eq(parents.familyId, kid.familyId), isNull(parents.disabledAt)))
    .orderBy(asc(parents.createdAt))
    .limit(1);
  if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
  const [pc] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.kidId, kid.id), eq(devices.platform, 'windows'), isNull(devices.revokedAt)))
    .orderBy(desc(devices.enrolledAt))
    .limit(1);
  if (!pc) throw new Error(`${kid.name} has no Windows device`);
  const token = await signAccessToken(jwtSecret, { sessionId: randomUUID(), parentId: parent.id, familyId: kid.familyId, roles: ['parent'] });
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${server}/v1/devices/${pc.id}/games${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let response: Response;
  if (what === 'list') {
    response = await call('GET', '');
    if (response.ok) {
      const { games } = (await response.json()) as { games: { id: string; label: string; exePath: string; source: string; shortcut: boolean; removedAt: string | null }[] };
      for (const g of games) console.log(`${g.id} | ${g.label} | ${g.source} | shortcut ${g.shortcut ? 'on' : 'off'} | ${g.removedAt ? 'gone' : g.exePath}`);
    }
  } else if (what === 'shortcut') {
    response = await call('PUT', `/${first}/shortcut`, { shortcut: second === 'on' });
  } else if (what === 'add') {
    response = await call('POST', '', { label: first, exePath: second });
    if (response.ok) console.log(((await response.json()) as { id: string }).id);
  } else {
    response = await call('DELETE', `/${first}`);
  }
  console.log(`${what} ${first ?? ''} ${what === 'add' ? '' : (second ?? '')}`.trim() + `: ${response.status}`);
  process.exitCode = response.ok ? 0 : 1;
} finally {
  await pool.end();
}
```

#### `web/src/lib/games.ts`

```ts
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
```

#### `windows/src/ScreenTime.Core/Games/Games.cs`

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ScreenTime.Core.Games;

/// <summary>
/// A game Screen Time can find on a PC (docs/SPEC.md §12.6). <c>ExeName</c> is the file it looks for.
/// <c>FixSubChannels</c> are the <c>sub_channel</c> values in the game's <c>config.ini</c> that stop it starting without
/// its launcher (3 is the Epic Games build, 6 the Google Play Games build); they are set to the official channel
/// before each start.
/// </summary>
public sealed record KnownGame(string Id, string Label, string ExeName, IReadOnlyList<string> FixSubChannels);

/// <summary>The games Screen Time knows. Only what was tried: see docs/SPEC.md §12.6.</summary>
public static class KnownGames
{
    public static readonly IReadOnlyList<KnownGame> All =
    [
        new("genshin", "Genshin Impact", "GenshinImpact.exe", ["6"]),
        new("starrail", "Honkai: Star Rail", "StarRail.exe", ["3"]),
    ];

    /// <summary>The known game with this id, or null for a program a parent added.</summary>
    public static KnownGame? ById(string id) => All.FirstOrDefault(g => g.Id == id);
}

/// <summary>A game with its shortcut on, as the snapshot and the pipe carry it.</summary>
public sealed record GameShortcut(string Id, string Label, string ExePath);

/// <summary>Looks for the known games in folders, nearest the drive's root first.</summary>
public static class GameFinder
{
    /// <summary>How many folders below a root it looks: <c>C:\Program Files\Epic Games\X\games\X game</c> is 5.</summary>
    public const int MaxDepth = 6;

    /// <summary>It gives up after this many folders, so a huge disk cannot keep it busy.</summary>
    public const int MaxFolders = 200_000;

    private static readonly HashSet<string> Skipped = new(StringComparer.OrdinalIgnoreCase)
    {
        "Windows", "ProgramData", "Users", "Documents and Settings", "$Recycle.Bin", "System Volume Information", "Recovery", "PerfLogs",
        "$WinREAgent", "WindowsApps", "node_modules", ".git",
    };

    /// <summary>
    /// The known games under <paramref name="roots"/>, in <see cref="KnownGames.All"/>'s order. <paramref name="folders"/>
    /// gives a folder's subfolders as full paths (nothing when it cannot be read); <paramref name="fileExists"/> says
    /// whether a file is there. A game in two places is reported where it is nearest a root.
    /// </summary>
    public static IReadOnlyList<GameShortcut> Find(IEnumerable<string> roots, Func<string, IEnumerable<string>> folders, Func<string, bool> fileExists)
    {
        var found = new Dictionary<string, GameShortcut>();
        var queue = new Queue<(string Path, int Depth)>();
        foreach (var root in roots) queue.Enqueue((root, 0));
        var seen = 0;
        while (queue.Count > 0 && found.Count < KnownGames.All.Count && seen < MaxFolders)
        {
            var (folder, depth) = queue.Dequeue();
            seen++;
            foreach (var game in KnownGames.All)
            {
                if (found.ContainsKey(game.Id)) continue;
                var exe = Join(folder, game.ExeName);
                if (fileExists(exe)) found[game.Id] = new GameShortcut(game.Id, game.Label, exe);
            }
            if (found.Count == KnownGames.All.Count) break;
            if (depth >= MaxDepth) continue;
            foreach (var child in folders(folder))
            {
                if (!Skipped.Contains(NameOf(child))) queue.Enqueue((child, depth + 1));
            }
        }
        return KnownGames.All.Where(g => found.ContainsKey(g.Id)).Select(g => found[g.Id]).ToList();
    }

    private static string Join(string folder, string name) => folder.TrimEnd('\\') + "\\" + name;

    private static string NameOf(string folder)
    {
        var trimmed = folder.TrimEnd('\\');
        return trimmed[(trimmed.LastIndexOf('\\') + 1)..];
    }
}

/// <summary>The official channel in a HoYoverse game's <c>config.ini</c> (docs/SPEC.md §12.6).</summary>
public static partial class ChannelFix
{
    [GeneratedRegex(@"^sub_channel=([^\r\n]*)", RegexOptions.Multiline)]
    private static partial Regex SubChannel();

    [GeneratedRegex(@"^cps=[^\r\n]*", RegexOptions.Multiline)]
    private static partial Regex Cps();

    /// <summary>
    /// <paramref name="config"/> with <c>sub_channel=0</c> and <c>cps=hoyoverse</c> when its <c>sub_channel</c> is one of
    /// <paramref name="fromSubChannels"/>; otherwise the same text. Every other line and the line endings are kept.
    /// </summary>
    public static string Apply(string config, IReadOnlyList<string> fromSubChannels)
    {
        var match = SubChannel().Match(config);
        if (!match.Success || !fromSubChannels.Contains(match.Groups[1].Value.Trim())) return config;
        return Cps().Replace(SubChannel().Replace(config, "sub_channel=0", 1), "cps=hoyoverse", 1);
    }
}

/// <summary>
/// How to start a game without an administrator: the exe, its folder, and, when <c>ConfigText</c> is not null, the
/// <c>config.ini</c> to write first.
/// </summary>
public sealed record LaunchPlan(string Exe, string WorkingFolder, string? ConfigPath, string? ConfigText);

public static class GameLaunch
{
    /// <summary>The environment variable that makes Windows start a program without asking for an administrator.</summary>
    public const string CompatVariable = "__COMPAT_LAYER";

    public const string CompatValue = "RunAsInvoker";

    /// <summary>
    /// The plan for <paramref name="game"/>. <paramref name="readText"/> gives a file's text, or null when it is not
    /// there. Only a known game's <c>config.ini</c> is ever changed, and only when it needs it.
    /// </summary>
    public static LaunchPlan Plan(GameShortcut game, Func<string, string?> readText)
    {
        var cut = game.ExePath.LastIndexOf('\\');
        var folder = cut <= 2 ? game.ExePath[..(cut + 1)] : game.ExePath[..cut];
        if (KnownGames.ById(game.Id) is not { FixSubChannels.Count: > 0 } known) return new LaunchPlan(game.ExePath, folder, null, null);
        var configPath = folder.TrimEnd('\\') + "\\config.ini";
        var before = readText(configPath);
        if (before is null) return new LaunchPlan(game.ExePath, folder, null, null);
        var after = ChannelFix.Apply(before, known.FixSubChannels);
        return after == before ? new LaunchPlan(game.ExePath, folder, null, null) : new LaunchPlan(game.ExePath, folder, configPath, after);
    }
}

/// <summary>A shortcut the tray made: the game and the shortcut's file name on the desktop.</summary>
public sealed record DeskGame(string Id, string Label, string ExePath, string File);

/// <summary>
/// What to do on the desktop: shortcuts to write, file names to delete, and what is there afterwards (saved for
/// next time and for <c>--play</c>).
/// </summary>
public sealed record ShortcutPlan(IReadOnlyList<DeskGame> Write, IReadOnlyList<string> Delete, IReadOnlyList<DeskGame> Result);

public static class Shortcuts
{
    private const string Invalid = "\\/:*?\"<>|";

    /// <summary>
    /// "Play Genshin Impact.lnk". The game's own launcher usually has a shortcut with the plain name, which asks for an
    /// administrator; this name never clashes with it.
    /// </summary>
    public static string FileName(string label)
    {
        var clean = new string(label.Where(c => !char.IsControl(c) && !Invalid.Contains(c)).ToArray());
        clean = string.Join(' ', clean.Split(' ', StringSplitOptions.RemoveEmptyEntries)).TrimEnd('.', ' ');
        return $"Play {(clean.Length == 0 ? "game" : clean)}.lnk";
    }

    /// <summary>
    /// The plan that makes the desktop match <paramref name="wanted"/>. <paramref name="had"/> is what the tray made
    /// before; <paramref name="exists"/> says whether a shortcut file is still on the desktop. A shortcut is written
    /// when it is new, changed, or was deleted by the kid; shortcuts of games no longer wanted are deleted. Files the
    /// tray did not make are never deleted.
    /// </summary>
    public static ShortcutPlan Plan(IReadOnlyList<GameShortcut> wanted, IReadOnlyList<DeskGame> had, Func<string, bool> exists)
    {
        var result = new List<DeskGame>();
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var game in wanted)
        {
            var file = FileName(game.Label);
            for (var n = 2; !taken.Add(file); n++) file = $"{FileName(game.Label)[..^4]} ({n}).lnk";
            result.Add(new DeskGame(game.Id, game.Label, game.ExePath, file));
        }
        var write = result.Where(g => !had.Contains(g) || !exists(g.File)).ToList();
        var delete = had.Select(g => g.File).Where(f => !taken.Contains(f)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return new ShortcutPlan(write, delete, result);
    }
}

/// <summary>The tray's list of the shortcuts it made, as JSON in <c>%LOCALAPPDATA%\ScreenTime\games.json</c>.</summary>
public static class DeskJson
{
    public static string Encode(IReadOnlyList<DeskGame> games) => JsonSerializer.Serialize(new DeskFile(games), DeskJsonContext.Default.DeskFile);

    /// <summary>The list back from its JSON; empty when it is null, not JSON, or has no games.</summary>
    public static IReadOnlyList<DeskGame> Decode(string? json)
    {
        if (json is null) return [];
        try
        {
            return JsonSerializer.Deserialize(json, DeskJsonContext.Default.DeskFile)?.Games ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}

internal sealed record DeskFile(IReadOnlyList<DeskGame>? Games);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(DeskFile))]
internal sealed partial class DeskJsonContext : JsonSerializerContext;
```

#### `windows/src/ScreenTime.Service/GameFolders.cs`

```csharp
namespace ScreenTime.Service;

/// <summary>The disk as <see cref="ScreenTime.Core.Games.GameFinder"/> sees it (docs/SPEC.md §12.6).</summary>
internal static partial class Win
{
    /// <summary>The root of every fixed drive that is ready, such as <c>C:\</c> and <c>D:\</c>. Not USB or network drives.</summary>
    internal static IReadOnlyList<string> GameRoots()
    {
        try
        {
            return DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady).Select(d => d.RootDirectory.FullName).ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>A folder's subfolders as full paths, without links to other places; nothing when it cannot be read.</summary>
    internal static IEnumerable<string> SubFolders(string folder)
    {
        try
        {
            var options = new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint };
            return Directory.GetDirectories(folder, "*", options);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }
}
```

#### `windows/src/ScreenTime.Tray/GameDesk.cs`

```csharp
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using ScreenTime.Core.Games;

namespace ScreenTime.Tray;

/// <summary>
/// Games on the kid's desktop (docs/SPEC.md §12.6). <see cref="Apply"/> makes the desktop's "Play …" shortcuts match
/// what the service sent; each shortcut runs this exe with <c>--play &lt;id&gt;</c>, and <see cref="Play"/> starts the
/// game without asking for an administrator. The list of what was made is kept in
/// <c>%LOCALAPPDATA%\ScreenTime\games.json</c>.
/// </summary>
internal static partial class GameDesk
{
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    private static string ListPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTime", "games.json");

    [LibraryImport("user32.dll", EntryPoint = "MessageBoxW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int MessageBox(IntPtr owner, string text, string caption, uint type);

    /// <summary>Writes and deletes shortcuts so the desktop matches <paramref name="wanted"/>. Never throws.</summary>
    public static void Apply(IReadOnlyList<GameShortcut> wanted, Action<string> log)
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var had = DeskJson.Decode(ReadOrNull(ListPath));
            var plan = Shortcuts.Plan(wanted, had, file => File.Exists(Path.Combine(desktop, file)));
            foreach (var file in plan.Delete)
            {
                File.Delete(Path.Combine(desktop, file));
                log($"games: removed {file}");
            }
            foreach (var game in plan.Write)
            {
                ShellLink.Create(
                    Path.Combine(desktop, game.File),
                    target: Environment.ProcessPath!,
                    arguments: $"--play {game.Id}",
                    icon: game.ExePath,
                    description: $"Start {game.Label} without asking for an administrator",
                    workingDirectory: Path.GetDirectoryName(Environment.ProcessPath!)!);
                log($"games: wrote {game.File}");
            }
            if (plan.Write.Count == 0 && plan.Delete.Count == 0 && plan.Result.SequenceEqual(had)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(ListPath)!);
            File.WriteAllText(ListPath, DeskJson.Encode(plan.Result), Utf8);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or COMException)
        {
            log($"games: could not update the desktop ({e.Message})");
        }
    }

    /// <summary>
    /// Starts the game a shortcut names. A known game's <c>config.ini</c> is fixed first when it needs it. When the
    /// game cannot be started, a small message says so.
    /// </summary>
    public static void Play(string id, Action<string> log)
    {
        var game = DeskJson.Decode(ReadOrNull(ListPath)).FirstOrDefault(g => g.Id == id);
        if (game is null)
        {
            log($"play: no game {id}");
            Sorry("That game is not set up on this PC any more.");
            return;
        }
        var plan = GameLaunch.Plan(new GameShortcut(game.Id, game.Label, game.ExePath), ReadOrNull);
        if (plan.ConfigPath is not null && plan.ConfigText is not null)
        {
            try
            {
                File.WriteAllText(plan.ConfigPath, plan.ConfigText, Utf8);
                log($"play: set the official channel in {plan.ConfigPath}");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // The game may still start; if it does not, the kid sees the game's own message.
                log($"play: could not write {plan.ConfigPath} ({e.Message})");
            }
        }
        try
        {
            var start = new ProcessStartInfo(plan.Exe) { UseShellExecute = false, WorkingDirectory = plan.WorkingFolder };
            start.Environment[GameLaunch.CompatVariable] = GameLaunch.CompatValue;
            using var process = Process.Start(start);
            log($"play: started {game.Label} pid {process?.Id}");
        }
        catch (Exception e) when (e is Win32Exception or IOException or InvalidOperationException)
        {
            log($"play: could not start {plan.Exe} ({e.Message})");
            Sorry($"Screen Time could not start {game.Label}. It may have moved or need an update. Ask Mum or Dad.");
        }
    }

    private static void Sorry(string text) => MessageBox(IntPtr.Zero, text, "Screen Time", 0x40);

    private static string? ReadOrNull(string path)
    {
        try
        {
            return File.Exists(path) ? File.ReadAllText(path) : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class CShellLink;

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
internal interface IShellLinkW
{
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int max, IntPtr findData, uint flags);
    void GetIDList(out IntPtr idList);
    void SetIDList(IntPtr idList);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int max);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int max);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int max);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
    void GetHotkey(out short hotkey);
    void SetHotkey(short hotkey);
    void GetShowCmd(out int showCmd);
    void SetShowCmd(int showCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int max, out int icon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int icon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string rel, uint reserved);
    void Resolve(IntPtr hwnd, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
internal interface IPersistFile
{
    void GetClassID(out Guid classId);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
}

/// <summary>Writes a Windows shortcut (.lnk) through the shell's own <c>IShellLinkW</c>.</summary>
internal static class ShellLink
{
    public static void Create(string file, string target, string arguments, string icon, string description, string workingDirectory)
    {
        var link = (IShellLinkW)new CShellLink();
        try
        {
            link.SetPath(target);
            link.SetArguments(arguments);
            link.SetIconLocation(icon, 0);
            link.SetDescription(description);
            link.SetWorkingDirectory(workingDirectory);
            ((IPersistFile)link).Save(file, true);
        }
        finally
        {
            Marshal.FinalReleaseComObject(link);
        }
    }
}
```

### 5.3 Change these, exactly as in each diff

Lines with `+` are added and lines with `-` are removed. The surrounding lines show where.

#### `packages/schemas/src/index.ts`

```diff
@@ -112,3 +112,15 @@ export {
 } from './apps.js';
 export { AppUpdateAnswer, AppUpdateCheck, AppUpdateOffer } from './appupdate.js';
+export {
+  CustomGameIn,
+  DeviceGame,
+  DeviceGames,
+  DeviceGamesPut,
+  ExePath,
+  FoundGameIn,
+  GameId,
+  GameShortcutPut,
+  GameSource,
+  StateGame,
+} from './games.js';
 export { DownloadApp, DownloadFile, Downloads } from './downloads.js';
```

#### `packages/schemas/src/sync.ts`

```diff
@@ -2,4 +2,5 @@ import { z } from 'zod';
 import { AppRuleMode } from './apps.js';
 import { DeviceForm, Pool } from './devices.js';
+import { StateGame } from './games.js';
 import { AvatarColor, Schedule } from './kids.js';
 
@@ -84,4 +85,9 @@ export const DeviceState = z
       alwaysAllowed: z.array(z.string()).optional(),
     }),
+    /**
+     * The games this PC account gets a desktop shortcut for (docs/SPEC.md §12.6). Empty on Android. The server always
+     * sends it; it is optional so a device can still read a snapshot it saved before this field existed.
+     */
+    games: z.array(StateGame).optional(),
   })
   .meta({ id: 'DeviceState' });
```

#### `server/src/db/schema.ts`

```diff
@@ -491,2 +491,27 @@ export const appUsageDaily = pgTable(
   (t) => [primaryKey({ columns: [t.deviceId, t.package, t.day] }), index('app_usage_daily_kid_day_idx').on(t.kidId, t.day)],
 );
+
+/**
+ * A game on one Windows PC account (docs/SPEC.md §12.6): found by the PC (`found`) or typed in by a parent (`custom`).
+ * `shortcut` is the parent's choice to put it on the kid's desktop.
+ */
+export const deviceGames = pgTable(
+  'device_games',
+  {
+    familyId: familyId(),
+    kidId: uuid('kid_id')
+      .notNull()
+      .references(() => kids.id),
+    deviceId: uuid('device_id')
+      .notNull()
+      .references(() => devices.id),
+    game: text('game').notNull(),
+    label: text('label').notNull(),
+    exePath: text('exe_path').notNull(),
+    source: text('source').notNull(),
+    shortcut: boolean('shortcut').notNull().default(false),
+    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
+    removedAt: ts('removed_at'),
+  },
+  (t) => [primaryKey({ columns: [t.deviceId, t.game] }), check('device_games_source', sql`${t.source} in ('found', 'custom')`)],
+);
```

#### `server/src/app.ts`

```diff
@@ -25,4 +25,5 @@ import { registerAppRoutes } from './apps/routes.js';
 import { registerAppUpdateRoutes } from './appupdate/routes.js';
 import { registerDownloadRoutes } from './downloads/routes.js';
+import { registerGameRoutes } from './games/routes.js';
 import { registerTamperRoutes } from './tamper/routes.js';
 import { registerWeb } from './web.js';
@@ -101,4 +102,5 @@ export function createApp(appDeps: AppDeps) {
   registerAppRoutes(app, deps);
   registerAppUpdateRoutes(app, deps);
+  registerGameRoutes(app, deps);
   registerDownloadRoutes(app, deps);
   registerSosRoutes(app, deps);
```

#### `server/src/sync/routes.ts`

```diff
@@ -20,4 +20,5 @@ import {
   appUsageDaily,
   deviceApps,
+  deviceGames,
   devices,
   families,
@@ -202,4 +203,14 @@ export function registerSyncRoutes(app: Router, deps: AppDeps) {
           : [];
 
+      // Games are Windows only (docs/SPEC.md §12.6): the ones a parent turned on and the PC still finds.
+      const games =
+        device.platform === 'windows'
+          ? await tx
+              .select({ id: deviceGames.game, label: deviceGames.label, exePath: deviceGames.exePath })
+              .from(deviceGames)
+              .where(and(eq(deviceGames.deviceId, deviceId), eq(deviceGames.shortcut, true), isNull(deviceGames.removedAt)))
+              .orderBy(asc(deviceGames.game))
+          : [];
+
       const limited = rules.filter((r) => r.mode === 'limit').map((r) => r.package);
       const appUsage =
@@ -250,4 +261,5 @@ export function registerSyncRoutes(app: Router, deps: AppDeps) {
             alwaysAllowed,
           },
+          games,
         },
       };
```

#### `server/test/db.test.ts`

```diff
@@ -36,4 +36,5 @@ describe.skipIf(!url)('database', () => {
       'app_usage_daily',
       'device_apps',
+      'device_games',
       'devices',
       'enrolment_codes',
```

#### `server/test/csharp-client.test.ts`

```diff
@@ -17,5 +17,5 @@ describe('C# API client', () => {
 
   it('has one method for every device operation and none for the parent ones', () => {
-    expect(client.match(/^ {4}public Task/gm)).toHaveLength(18);
+    expect(client.match(/^ {4}public Task/gm)).toHaveLength(19);
     expect(client).toContain(
       '    public Task<EnrolResponse> PostEnrolAsync(EnrolRequest body, CancellationToken cancellationToken = default) =>\n' +
```

#### `windows/src/ScreenTime.Core/Service/PipeMessage.cs`

```diff
@@ -1,4 +1,5 @@
 using System.Text.Json;
 using System.Text.Json.Serialization;
+using ScreenTime.Core.Games;
 using ScreenTime.Core.Tray;
 
@@ -11,5 +12,5 @@ namespace ScreenTime.Core.Service;
 public sealed record PipeMessage(string Type, string? Id = null, string? Text = null, int? Pid = null,
     string? KidName = null, long? RemainingSec = null, [property: JsonPropertyName("locked")] bool? IsLocked = null, bool? Offline = null, TrayStatus? View = null,
-    int? Minutes = null, string? Reason = null, string? PresetId = null, SendResult? Result = null, bool? Approved = null)
+    int? Minutes = null, string? Reason = null, string? PresetId = null, SendResult? Result = null, bool? Approved = null, IReadOnlyList<GameShortcut>? Games = null)
 {
     /// <summary>Lock the PC now (service to tray).</summary>
@@ -65,4 +66,7 @@ public sealed record PipeMessage(string Type, string? Id = null, string? Text =
     public static PipeMessage Caught() => new("caught");
 
+    /// <summary>The games that get a desktop shortcut, after every sync and on hello; empty takes them all away (service to tray).</summary>
+    public static PipeMessage GamesOf(IReadOnlyList<GameShortcut> games) => new("games", Games: games);
+
     /// <summary>One line, no newline at the end.</summary>
     public static string Encode(PipeMessage message) => JsonSerializer.Serialize(message, PipeJsonContext.Default.PipeMessage);
```

#### `windows/src/ScreenTime.Service/Program.cs`

```diff
@@ -69,10 +69,12 @@ switch (command)
             flags.TryGetValue("fake-clock-file", out var fakeClock);
             flags.TryGetValue("fake-timezone-file", out var fakeZone);
-            if ((session is not null || trayOpen is not null || fakeClock is not null || fakeZone is not null) && !dryLock)
+            // Dev only: --games-root <folder> is the only place the game finder looks, instead of every fixed drive (docs/SPEC.md §12.6).
+            flags.TryGetValue("games-root", out var gamesRoot);
+            if ((session is not null || trayOpen is not null || fakeClock is not null || fakeZone is not null || gamesRoot is not null) && !dryLock)
             {
-                Console.Error.WriteLine("--session, --tray-open, --fake-clock-file and --fake-timezone-file are for testing and need --dry-lock.");
+                Console.Error.WriteLine("--session, --tray-open, --fake-clock-file, --fake-timezone-file and --games-root are for testing and need --dry-lock.");
                 return 2;
             }
-            builder.Services.AddSingleton(new ServiceOptions(dataFolder, secure, trayExe, dryLock, WindowsServiceHelpers.IsWindowsService(), session, trayOpen, fakeClock, fakeZone));
+            builder.Services.AddSingleton(new ServiceOptions(dataFolder, secure, trayExe, dryLock, WindowsServiceHelpers.IsWindowsService(), session, trayOpen, fakeClock, fakeZone, gamesRoot));
             if (WindowsServiceHelpers.IsWindowsService())
             {
```

#### `windows/src/ScreenTime.Service/Worker.cs`

```diff
@@ -3,4 +3,5 @@ using System.Text;
 using System.Threading.Channels;
 using ScreenTime.Core.Api;
+using ScreenTime.Core.Games;
 using ScreenTime.Core.Service;
 using ScreenTime.Core.Store;
@@ -16,8 +17,8 @@ namespace ScreenTime.Service;
 /// The service's options: the data folder, whether it is the secure default, the tray exe (null: no tray), dry-lock
 /// (log instead of locking or disconnecting) and whether it runs as a Windows service. <c>Session</c> and <c>TrayOpen</c>
-/// are for test runs (<c>--session</c>, <c>--tray-open</c>). <c>FakeClockFile</c> and <c>FakeTimezoneFile</c> are for test runs too.
+/// are for test runs (<c>--session</c>, <c>--tray-open</c>). <c>FakeClockFile</c>, <c>FakeTimezoneFile</c> and <c>GamesRoot</c> are for test runs too.
 /// </summary>
 public sealed record ServiceOptions(string DataFolder, bool SecureFolder, string? TrayExe, bool DryLock, bool AsService, uint? Session = null,
-    string? TrayOpen = null, string? FakeClockFile = null, string? FakeTimezoneFile = null);
+    string? TrayOpen = null, string? FakeClockFile = null, string? FakeTimezoneFile = null, string? GamesRoot = null);
 
 /// <summary>
@@ -55,4 +56,10 @@ public sealed class Worker(SessionEvents events, ServiceOptions options, ILogger
     private readonly HashSet<string> _versionSent = new();
 
+    /// <summary>The known games on this PC (docs/SPEC.md §12.6); null until the first look has finished.</summary>
+    private volatile IReadOnlyList<GameShortcut>? _foundGames;
+
+    /// <summary>What the server was last told this PC has, per account, so it is only told again when that changes.</summary>
+    private readonly Dictionary<string, string> _gamesSent = new();
+
     private sealed class KidSession(uint sessionId, string sid, TrayHost tray, CancellationTokenSource cts)
     {
@@ -220,5 +227,21 @@ public sealed class Worker(SessionEvents events, ServiceOptions options, ILogger
         });
 
-        await Task.WhenAll(eventsTask, timerTask, lockTask, syncTask);
+        // Looking over the disks takes seconds, so it runs beside the loops and never holds their lock.
+        var gamesTask = Task.Run(async () =>
+        {
+            try
+            {
+                while (!stoppingToken.IsCancellationRequested)
+                {
+                    var found = GameFinder.Find(options.GamesRoot is { } root ? [root] : Win.GameRoots(), Win.SubFolders, File.Exists);
+                    _foundGames = found;
+                    logger.LogInformation("games: found {Count} ({Games})", found.Count, string.Join(", ", found.Select(g => g.ExePath)));
+                    await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
+                }
+            }
+            catch (OperationCanceledException) { }
+        });
+
+        await Task.WhenAll(eventsTask, timerTask, lockTask, syncTask, gamesTask);
 
         foreach (var s in _sessions.Values) s.Cts.Cancel();
@@ -451,4 +474,5 @@ public sealed class Worker(SessionEvents events, ServiceOptions options, ILogger
                     logger.LogInformation("tray {Session}: hello pid {Pid}", sessionId, m.Pid);
                     if (View(s.Sid, _clock.NowMs()) is { } view) await SendView(s, view);
+                    await SendGames(s);
                     // A tray killed three times was dead when it was caught: it hears it now.
                     if (s.CaughtPending)
@@ -711,4 +735,5 @@ public sealed class Worker(SessionEvents events, ServiceOptions options, ILogger
         await ReportParentMode(sid, api, ct);
         await ReportEvents(sid, api, ct);
+        await ReportGames(sid, api, ct);
         var synced = await syncer.SyncAsync(ct);
         if (synced && !_versionSent.Contains(sid)) await ReportVersion(sid, api, ct);
@@ -734,8 +759,41 @@ public sealed class Worker(SessionEvents events, ServiceOptions options, ILogger
                 await SendView(s, view);
                 foreach (var text in toasts) await SendToast(s, text);
+                await SendGames(s);
             }
         }
     }
 
+    /// <summary>
+    /// Tells the server which known games this PC has (docs/SPEC.md §12.6), once per account, and again only when the
+    /// list changes. Nothing is sent before the first look has finished.
+    /// </summary>
+    private async Task ReportGames(string sid, ApiClient api, CancellationToken ct)
+    {
+        if (_foundGames is not { } found) return;
+        var key = string.Join("|", found.Select(g => g.Id + "=" + g.ExePath));
+        if (_gamesSent.GetValueOrDefault(sid) == key) return;
+        try
+        {
+            await api.PutDeviceGamesAsync(new DeviceGamesPut(found.Select(g => new FoundGameIn(g.Id, g.Label, g.ExePath)).ToList()), ct);
+            _gamesSent[sid] = key;
+            logger.LogInformation("{Kid}: told the server {Count} games", KidName(sid), found.Count);
+        }
+        catch (OperationCanceledException) when (ct.IsCancellationRequested)
+        {
+            throw;
+        }
+        catch (Exception e)
+        {
+            logger.LogWarning("{Kid}: could not report the games ({Message})", KidName(sid), e.Message);
+        }
+    }
+
+    /// <summary>Sends the session's tray the games that get a desktop shortcut, from the saved snapshot; none before the first sync.</summary>
+    private async Task SendGames(KidSession s)
+    {
+        var games = _store.LoadState(s.Sid)?.State.Games ?? [];
+        await s.Tray.SendAsync(PipeMessage.GamesOf(games.Select(g => new GameShortcut(g.Id, g.Label, g.ExePath)).ToList()));
+    }
+
     /// <summary>
     /// Tells the server this PC's app version once per account and start, for the parents' Devices panel. Before this
```

#### `windows/src/ScreenTime.Tray/TrayPipe.cs`

```diff
@@ -91,4 +91,7 @@ internal sealed partial class TrayPipe(string pipeName, bool dryLock, TrayModel
                             model.ParentModeNo(message.Text ?? "");
                             break;
+                        case "games":
+                            GameDesk.Apply(message.Games ?? [], log);
+                            break;
                         case "status":
                             log($"status: {message.RemainingSec / 60} min left, locked {message.IsLocked}, offline {message.Offline}");
```

#### `windows/src/ScreenTime.Tray/App.xaml.cs`

```diff
@@ -11,4 +11,5 @@ namespace ScreenTime.Tray;
 /// without the service; <c>--open [ask|message|parent]</c> also opens the flyout at once, on that panel, and keeps it open
 /// (for screenshots and test runs). <c>--setup [--demo]</c> shows the setup window instead (docs/SPEC.md §12.2).
+/// <c>--play &lt;id&gt;</c> starts a game from its desktop shortcut and ends (docs/SPEC.md §12.6).
 /// </summary>
 public partial class App : Application
@@ -29,4 +30,12 @@ public partial class App : Application
         var argv = Environment.GetCommandLineArgs();
         var demoAt = Array.IndexOf(argv, "--demo");
+        // --play <id>: a desktop shortcut starts a game without asking for an administrator (docs/SPEC.md §12.6), then this ends.
+        var playAt = Array.IndexOf(argv, "--play");
+        if (playAt >= 0)
+        {
+            if (playAt + 1 < argv.Length) GameDesk.Play(argv[playAt + 1], TrayLog.Write);
+            Exit();
+            return;
+        }
         // --setup: the setup window after the MSI (docs/SPEC.md §12.2), not the tray. With --demo, a fake backend.
         if (Array.IndexOf(argv, "--setup") >= 0)
```

### 5.4 The migration

After the `server/src/db/schema.ts` change, generate it from the repo root:

```powershell
pnpm --filter @screentime/schemas build
pnpm --filter @screentime/server exec drizzle-kit generate --name device_games
```

That makes `server/drizzle/0009_device_games.sql`, `server/drizzle/meta/0009_snapshot.json` and a new line in `server/drizzle/meta/_journal.json`. drizzle-kit does not write row-level security, so add these lines to the end of `0009_device_games.sql`:

```sql
--> statement-breakpoint
ALTER TABLE device_games ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON device_games
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
```

The whole file is then:

```sql
CREATE TABLE "device_games" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"game" text NOT NULL,
	"label" text NOT NULL,
	"exe_path" text NOT NULL,
	"source" text NOT NULL,
	"shortcut" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "device_games_device_id_game_pk" PRIMARY KEY("device_id","game"),
	CONSTRAINT "device_games_source" CHECK ("device_games"."source" in ('found', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "device_games" ADD CONSTRAINT "device_games_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_games" ADD CONSTRAINT "device_games_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_games" ADD CONSTRAINT "device_games_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE device_games ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON device_games
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

```

### 5.5 The generated files

After the schema and route changes, run `pnpm contract` from the repo root. It rewrites `contract/openapi.json`, `android/core-model/.../ApiClient.kt` and `ApiModels.kt`, and `windows/src/ScreenTime.Core/Api/ApiClient.g.cs` and `ApiModels.g.cs`. Commit them as they come, and never edit them by hand. The C# client gains `PutDeviceGamesAsync`, and `DeviceState` gains `Games`; the Windows code in 5.2 and 5.3 needs both, so run this before building the Windows solution.

## 6. Detailed spec

This is what the code above does, for your review and for the PR. `docs/SPEC.md` §12.6 is the full version.

- **Finding games.** The service looks over every fixed drive at start and every 6 hours, in its own task: nearest the root first, at most 6 folders deep, skipping system folders. It knows `genshin` (`GenshinImpact.exe`) and `starrail` (`StarRail.exe`). It sends the list with `PUT /v1/device/games` once per account, and again only when it changes.
- **The server.** `device_games` has one row per PC account and game. A found game left out of a later list gets `removed_at` and leaves the snapshot, but keeps its `shortcut`. A parent can add a program by its path (`custom-<uuid>`, shortcut on, at most 20). The parent routes are `GET /v1/devices/{deviceId}/games`, `PUT …/games/{gameId}/shortcut`, `POST …/games` and `DELETE …/games/{gameId}`. An Android device gets 409 everywhere, and an empty `games` in its snapshot.
- **The snapshot** carries `games: [{ id, label, exePath }]`: the games with their shortcut on that the PC still finds. Every parent change, and a PC list that changes such a game, sends `state_changed` to that device only.
- **The tray** gets the list as a `games` pipe line after every sync and when it connects. It makes the desktop match: `Play <label>.lnk` per game, with the game's icon, running `ScreenTime.Tray.exe --play <id>`. A deleted shortcut comes back; one no longer wanted is removed. It only deletes shortcuts it made (`%LOCALAPPDATA%\ScreenTime\games.json`).
- **Starting.** `--play <id>` starts the exe in its own folder with `__COMPAT_LAYER=RunAsInvoker`, then ends. For a known game it first sets `sub_channel=0` and `cps=hoyoverse` in `config.ini` when `sub_channel` is 6 (Genshin) or 3 (Star Rail). A program a parent added is started as it is.
- **The web app** already has the dialog; this card makes `web/src/lib/games.ts` call the routes.

## 7. Steps

1. Start the branch (section 10).
2. Create the files of 5.1 and 5.2, and make the changes of 5.3.
3. Do 5.4, then 5.5.
4. Run section 8.1 until it passes.
5. Run section 8.2 and keep all its output.
6. Push, open the PR, wait for CI, and send the handback (sections 10 and 12).

## 8. Acceptance criteria

### 8.1 Build and tests

From the repo root, in `pwsh`:

```powershell
pnpm install --frozen-lockfile
pnpm contract
git status --short contract
pnpm build
pnpm typecheck
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
docker exec screentime-db-1 psql -U screentime -d postgres -c "create database screentime_test"
$pw = (Select-String -Path deploy\.env -Pattern '^POSTGRES_PASSWORD=(.*)').Matches[0].Groups[1].Value
$env:TEST_DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime_test"
pnpm test
Remove-Item Env:TEST_DATABASE_URL
cd windows
dotnet test
dotnet build src\ScreenTime.Service -c Release
dotnet build src\ScreenTime.Tray -c Release
& src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe --games-root x; "exit $LASTEXITCODE"
cd ..\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git grep -l 'Â' -- packages server/src server/scripts server/test web/src windows/src windows/tests
git diff --stat main -- web/src/components docs/cards/CARD-060-run.ps1 windows/tools
```

- [ ] `pnpm typecheck` and `pnpm build` pass. An error that `screentime_test` already exists is fine.
- [ ] `pnpm test` passes. In the rehearsal: engine 27, schemas 36, web 80, server 292, with 11 in `test/games.test.ts`.
- [ ] `dotnet test` says `Test run summary: Passed!`. In the rehearsal: 329.
- [ ] Both Release builds say `0 Error(s)`, and the `--games-root x` line prints `--session, --tray-open, --fake-clock-file, --fake-timezone-file and --games-root are for testing and need --dry-lock.` and `exit 2`.
- [ ] `.\gradlew.bat assembleDebug test` says `BUILD SUCCESSFUL`.
- [ ] `git grep` prints nothing. If it prints a file, you saved it in the wrong encoding: save it again as UTF-8 without a BOM.
- [ ] The last `git diff --stat` prints nothing: the dialog, the run script and the test program are unchanged.

### 8.2 On this PC

The run uses your own Windows account as the kid, with the service in dry-lock mode, so nothing is ever locked. It puts shortcuts named `Play ….lnk` on your desktop for a few seconds and removes them. It only looks for games in `C:\Users\james\OpenCode\Testing\temp\c060\games`, so the real games on the PC are not touched. It needs the Release builds from 8.1.

From the repo root, in `pwsh`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pwsh -File docs\cards\CARD-060-run.ps1 2>&1 | Tee-Object -FilePath ..\temp\card060-bob-out.txt
```

The first lines **wipe the development database and replace `deploy\.env` with throwaway values**. The script takes about a minute.

- [ ] The last line is `=== done: 0 failed`, and no line starts with `FAILED`. In the rehearsal: 9 `ok:` lines.
- [ ] Paste **all** of `..\temp\card060-bob-out.txt` into the handback. A summary counts as `NOT RUN`.
- [ ] The line after `=== 5` starts with `ran elevated=False` and ends with `layer=RunAsInvoker`: the fake game demands an administrator in its manifest and ran without one.
- [ ] After the run, `Get-ChildItem ([Environment]::GetFolderPath('DesktopDirectory')) -Filter 'Play *.lnk'` prints nothing, and `Get-Process ScreenTime.*` prints nothing.

If the script stops with "There are already 'Play *.lnk' shortcuts on the desktop", it has changed nothing: tell James and write `NOT RUN`.

Not tested in the run: the real games (James tries them on the kids' PCs), the look over real drives (the tests cover the rules), a game that disappears between two looks (the server tests cover it), and the message box when a game cannot be started.

### 8.3 CI

- [ ] On the PR, every check is green.

## 9. Tests

- `server/test/games.test.ts` (11 tests): the list per PC account; a shortcut on and off in the snapshot and its version; a game that is gone and comes back, also moved; an empty list; adding and removing a program; bad paths, repeats and removing a found game; the limit of 20; what a PC may not send; Windows only; other families and removed devices; who is told when.
- `windows/tests/ScreenTime.Core.Tests/GamesTests.cs`: the finder (order, nearest copy, depth, skipped folders, unreadable folders), the channel fix, the start plan, shortcut file names, the desktop plan (first time, no change, deleted, turned off, moved, renamed, same name twice), the tray's JSON and the `games` pipe line.
- `web/test/games.test.ts` is already in the repo from PR #180 and must pass unchanged.
- The other test files in 5.3 change only as shown.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-060-pc-games
   ```
2. Commit in small logical commits. Message format: `CARD-060: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-060-pc-games`
5. Open a PR into `main` titled `CARD-060: Games on a PC` with this body, written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-060-pc-games.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] criterion 1 — output: `...`
   - [x] criterion 2 — output: `...`

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- The run of section 8.2 is pasted **whole**: every line of `card060-bob-out.txt`. A step without its pasted output counts as `NOT RUN`.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace, and every workaround you used in the run (a restart, a retry, an extra command) with why you needed it. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-060. Please review and merge if it is good.

CARD: CARD-060 Games on a PC
PR: <full PR URL>
Branch: bob/card-060-pc-games
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

The run (all of card060-bob-out.txt):
<paste it>

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
