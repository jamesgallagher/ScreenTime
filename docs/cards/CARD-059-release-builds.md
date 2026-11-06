# CARD-059: Release builds, self-update and removal

| Field | Value |
|---|---|
| Card | CARD-059 |
| Title | Release builds, self-update and removal |
| Size | L |
| Depends on | CARD-058, merged to `main` |
| Spec sections | docs/SPEC.md §12.1, §8, §13 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-059-release-builds` |
| PR title | `CARD-059: Release builds, self-update and removal` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first (rules 8, 9 and 10 especially).

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM: section 8.1 checks for mangled characters (`§` saved as `Â§`).

A release build of the kid app has USB debugging off and cannot be uninstalled, so until now there was no way to update or remove it. James decided on 6 Nov 2026 that the app updates itself from the family's server, that a parent can remove it on the device with the parent code, and that Factory Reset Protection stays out for now. CARD-054 (the guides) describes this, so this card comes first.

Claude has already rehearsed this card with the code below, and every step of section 8 passed. Copy the code exactly. The tests are the contract and must pass unchanged. There is no separate front-end PR: the small screen changes are in the diffs below, and rule 10 of `AGENTS.md` means you make those exact changes and no others.

**The run must be your own.** This card has no sample of Claude's output. Claude checks your run's ids and times against the file's date and the development database. If a step stops, hangs or fails, say so and paste what it printed: a failed run reported honestly is fine, and a run that did not happen is not.

## 2. Goal

The kid app checks the server for a newer version, downloads it, and installs it itself when the screen is off. A version can go to one device first. In parent mode, with the parent code, Screen Time can be removed from the device. A release build can be signed. `pnpm test`, `.\gradlew.bat assembleDebug test`, the Windows tests and `pwsh -File docs\cards\CARD-059-run.ps1` all pass, and CI is green.

## 3. Out of scope

- Factory Reset Protection: not built, and the spec now says so.
- The guides (`docs/guides/`): CARD-054.
- Publishing to the real server: never run `publish-kid.ps1` without `-To`. It would copy to James's production server.
- No Windows change except the regenerated client. Self-update is Android only, and only the kid app.
- No new library. Do not edit generated files by hand.
- Never run on a real phone, never commit secrets (`deploy/.env`, tokens, keys, keystores, `keystore.properties`, `google-services.json`, `local.properties`). The keystore in 8.1 is a throwaway outside the repo.

## 4. Tech

The project's existing stack, with nothing new.

Traps Claude hit in the rehearsal, so you need not:

- **A debug build is test-only, and Android refuses to update a test-only app silently** (`INSTALL_FAILED_TEST_ONLY`). The run script builds with `-PkidTestOnly=false`. Plain debug builds stay test-only, so `adb shell dpm remove-active-admin` still works for developers.
- PowerShell splits dotted arguments to native programs: `-PkidVersionName=0.1.1` must be quoted. If that build fails unnoticed, the old APK gets published as the new one. The script stops if a build fails.
- Without Device Owner, Android refuses the service's foreground type and the app crashes, which also hides the uninstall question. So the service does not start without it.
- Asking Android to uninstall needs `REQUEST_DELETE_PACKAGES`. Without it, Android ignores the request and says nothing.
- The emulator's only network is metered, so a debug build ignores metered networks. `AppUpdaterTest` covers the rule itself.
- **The adb server and the Gradle daemon keep a pipe open after a script ends**, so a run can look hung. The script stops them. If a run has printed `--- Finished` and the window does not return, say so under Deviations.
- The server test counts in `server/test/csharp-client.test.ts` and `server/test/notify.test.ts` change: see the diffs.
- Run `dotnet test` **from the `windows` folder**, where `global.json` is.

## 5. Files

### 5.1 The tests: create these, exactly

#### `server/test/app-update.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { devices, events, families, kids, parentSessions, parents } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('app updates and removal', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const releases = mkdtempSync(join(tmpdir(), 'screentime-releases-'));
  const deps = { db, config: { ...testConfig(url ?? ''), releasesDir: releases }, mailer, pusher };
  const api = client(deps);
  const app = createApp(deps);

  let family = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const pc = { id: '', token: '' };

  async function addDevice(platform: 'android' | 'windows', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: family,
        kidId: kid,
        platform,
        form: platform === 'android' ? 'phone' : 'pc',
        pool: platform === 'android' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  const offer = { versionCode: 5, versionName: '1.4.0', sha256: 'a'.repeat(64), sizeBytes: 5 };
  const publish = (over: Record<string, unknown> = {}) => {
    writeFileSync(join(releases, 'kid-5.apk'), 'hello');
    writeFileSync(join(releases, 'kid.json'), JSON.stringify({ ...offer, file: 'kid-5.apk', ...over }));
  };
  const check = (versionCode: number, token = phone.token) =>
    api.post('/v1/device/app-update/check', token, { versionCode, versionName: `v${versionCode}` });
  const apk = (token: string) => app.request('/v1/device/app-update/apk', { headers: { authorization: `Bearer ${token}` } });

  afterAll(async () => {
    rmSync(releases, { recursive: true, force: true });
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    rmSync(join(releases, 'kid.json'), { force: true });
    rmSync(join(releases, 'kid-5.apk'), { force: true });
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    if (!a) throw new Error('no family');
    family = a.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    if (!p) throw new Error('no parent');
    await db.insert(parentSessions).values({ familyId: family, parentId: p.id, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken: 'dad-phone' });
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    Object.assign(phone, await addDevice('android', 'Pixel 7'));
    Object.assign(pc, await addDevice('windows', 'Alex on PC'));
  });

  it('offers nothing when nothing is published, and stores the version', async () => {
    const res = await check(1);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ offer: null });
    const [row] = await db.select().from(devices).where(eq(devices.id, phone.id));
    expect(row?.appVersion).toBe('v1');
  });

  it('offers a newer version, without the file name or the device list', async () => {
    publish();
    const res = await check(4);
    expect(res.body).toEqual({ offer });
  });

  it('offers nothing for the same or an older version', async () => {
    publish();
    expect((await check(5)).body).toEqual({ offer: null });
    expect((await check(6)).body).toEqual({ offer: null });
  });

  it('offers nothing to a device that is not Android', async () => {
    publish();
    expect((await check(1, pc.token)).body).toEqual({ offer: null });
  });

  it('offers a version for chosen devices only to them', async () => {
    publish({ deviceIds: [randomUUID()] });
    expect((await check(1)).body).toEqual({ offer: null });
    publish({ deviceIds: [phone.id] });
    expect((await check(1)).body).toEqual({ offer });
  });

  it('offers nothing when kid.json is not valid', async () => {
    writeFileSync(join(releases, 'kid.json'), '{ not json');
    expect((await check(1)).body).toEqual({ offer: null });
    publish({ file: '../secrets.apk' });
    expect((await check(1)).body).toEqual({ offer: null });
  });

  it('needs a device token', async () => {
    expect((await api.post('/v1/device/app-update/check', null, { versionCode: 1, versionName: 'x' })).status).toBe(401);
    expect((await app.request('/v1/device/app-update/apk')).status).toBe(401);
    expect((await api.post('/v1/device/removed', null)).status).toBe(401);
  });

  it('serves the file to a device it is for, and to no other', async () => {
    publish({ deviceIds: [phone.id] });
    const res = await apk(phone.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('5');
    expect(await res.text()).toBe('hello');
    expect((await apk(pc.token)).status).toBe(404);
  });

  it('says 404 when kid.json names a file that is not there', async () => {
    publish();
    rmSync(join(releases, 'kid-5.apk'));
    expect((await apk(phone.token)).status).toBe(404);
  });

  it('revokes a removed device and tells the parents', async () => {
    const res = await api.post('/v1/device/removed', phone.token);
    expect(res.status).toBe(204);
    const [row] = await db.select().from(devices).where(eq(devices.id, phone.id));
    expect(row?.revokedAt).not.toBeNull();
    const rows = await db.select().from(events).where(eq(events.kind, 'device.removed'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceId).toBe(phone.id);
    expect(rows[0]?.payload).toEqual({ deviceName: 'Pixel 7' });
    expect((await check(1)).status).toBe(401);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.token).toBe('dad-phone');
  });
});
```

#### `android/app-kid/src/test/kotlin/au/screentime/kid/update/AppUpdaterTest.kt`

```kotlin
package au.screentime.kid.update

import au.screentime.core.model.api.AppUpdateOffer
import java.io.ByteArrayInputStream
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** When the kid app updates itself (docs/SPEC.md §12.1). */
class AppUpdaterTest {
    private val offer = AppUpdateOffer(versionCode = 5, versionName = "1.4.0", sha256 = "x", sizeBytes = 5)

    private fun step(
        offer: AppUpdateOffer? = this.offer,
        currentCode: Int = 4,
        downloaded: Boolean = false,
        metered: Boolean = false,
        screenOn: Boolean = false,
        sosActive: Boolean = false,
    ) = nextUpdateStep(offer, currentCode, downloaded, metered, screenOn, sosActive)

    @Test
    fun noOfferMeansNothing() {
        assertEquals(UpdateStep.NOTHING, step(offer = null))
    }

    @Test
    fun theSameOrAnOlderVersionMeansNothing() {
        assertEquals(UpdateStep.NOTHING, step(currentCode = 5, downloaded = true))
        assertEquals(UpdateStep.NOTHING, step(currentCode = 6, downloaded = true))
    }

    @Test
    fun aNewVersionDownloadsOnANetworkThatIsNotMetered() {
        assertEquals(UpdateStep.DOWNLOAD, step())
    }

    @Test
    fun aDownloadWaitsForANetworkThatIsNotMetered() {
        assertEquals(UpdateStep.NOTHING, step(metered = true))
    }

    @Test
    fun aDownloadDoesNotWaitForTheScreen() {
        assertEquals(UpdateStep.DOWNLOAD, step(screenOn = true))
    }

    @Test
    fun aDownloadedVersionInstallsWithTheScreenOff() {
        assertEquals(UpdateStep.INSTALL, step(downloaded = true))
    }

    @Test
    fun aDownloadedVersionInstallsEvenOnAMeteredNetwork() {
        assertEquals(UpdateStep.INSTALL, step(downloaded = true, metered = true))
    }

    @Test
    fun anInstallWaitsForTheScreenToGoOff() {
        assertEquals(UpdateStep.NOTHING, step(downloaded = true, screenOn = true))
    }

    @Test
    fun anInstallWaitsForAnSosToEnd() {
        assertEquals(UpdateStep.NOTHING, step(downloaded = true, sosActive = true))
    }

    @Test
    fun theFirstCheckIsDueAtOnceThenEveryInterval() {
        assertTrue(checkDue(null, 1_000, 60_000))
        assertFalse(checkDue(1_000, 60_999, 60_000))
        assertTrue(checkDue(1_000, 61_000, 60_000))
    }

    // SHA-256 of "hello".
    private val hello = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

    @Test
    fun aFileMatchesItsSizeAndHash() {
        assertTrue(matchesOffer(ByteArrayInputStream("hello".toByteArray()), 5, hello))
    }

    @Test
    fun aWrongSizeOrHashDoesNotMatch() {
        assertFalse(matchesOffer(ByteArrayInputStream("hello".toByteArray()), 6, hello))
        assertFalse(matchesOffer(ByteArrayInputStream("jello".toByteArray()), 5, hello))
    }
}
```

### 5.2 New code: create these, exactly

#### `packages/schemas/src/appupdate.ts`

```ts
import { z } from 'zod';

/** Body of POST /v1/device/app-update/check: what the kid app runs now (docs/SPEC.md §12.1). */
export const AppUpdateCheck = z
  .object({
    versionCode: z.number().int().min(1),
    versionName: z.string().trim().min(1).max(40),
  })
  .meta({ id: 'AppUpdateCheck' });

export type AppUpdateCheck = z.infer<typeof AppUpdateCheck>;

/** A newer kid app for this device. The device checks `sha256` and `sizeBytes` before it installs. */
export const AppUpdateOffer = z
  .object({
    versionCode: z.number().int().min(1),
    versionName: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().min(1),
  })
  .meta({ id: 'AppUpdateOffer' });

export type AppUpdateOffer = z.infer<typeof AppUpdateOffer>;

/** Answer of POST /v1/device/app-update/check. `offer` is null when there is nothing newer. */
export const AppUpdateAnswer = z.object({ offer: AppUpdateOffer.nullable() }).meta({ id: 'AppUpdateAnswer' });

export type AppUpdateAnswer = z.infer<typeof AppUpdateAnswer>;
```

#### `server/src/appupdate/routes.ts`

```ts
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createRoute, z } from '@hono/zod-openapi';
import { eq, sql } from 'drizzle-orm';
import { AppUpdateAnswer, AppUpdateCheck, AppUpdateOffer } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { withFamily } from '../db/family.js';
import { devices, events } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { disconnectDevices, notifyParents } from '../notify/dispatch.js';
import { deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

/** `kid.json` in the releases folder, written by `android/publish-kid.ps1` after the APK is in place. */
const KidRelease = AppUpdateOffer.extend({
  file: z.string().regex(/^[A-Za-z0-9._-]+\.apk$/),
  /** Only these devices, to try a version on one device first. Left out: every Android device. */
  deviceIds: z.array(z.uuid()).optional(),
});

type KidRelease = z.infer<typeof KidRelease>;

/** The published release, or null when there is none or `kid.json` is not valid (which is logged). */
async function readRelease(dir: string | null): Promise<KidRelease | null> {
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

const checkRoute = createRoute({
  method: 'post',
  path: '/v1/device/app-update/check',
  tags: ['device'],
  summary: 'Report the app version and ask for a newer one',
  description: 'Stores the version for the parents to see. `offer` is null when there is nothing newer, and always on a device that is not Android.',
  security: deviceBearer,
  request: { body: jsonBody(AppUpdateCheck) },
  responses: {
    200: jsonResponse('A newer version for this device, or none.', AppUpdateAnswer),
    ...errorResponses(401, 422),
  },
});

const removedRoute = createRoute({
  method: 'post',
  path: '/v1/device/removed',
  tags: ['device'],
  summary: 'Screen Time is being taken off this device',
  description: 'After a right parent code on the device. Revokes the device and tells the parents.',
  security: deviceBearer,
  responses: { 204: { description: 'Revoked.' }, ...errorResponses(401) },
});

/** Self-update of the kid app and its removal (docs/SPEC.md §12.1). */
export function registerAppUpdateRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(checkRoute, async (c) => {
    const { deviceId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const [device] = await withFamily(db, familyId, (tx) =>
      tx.update(devices).set({ appVersion: body.versionName }).where(eq(devices.id, deviceId)).returning({ platform: devices.platform }),
    );
    const release = await readRelease(config.releasesDir);
    if (
      device?.platform !== 'android' ||
      !release ||
      release.versionCode <= body.versionCode ||
      (release.deviceIds && !release.deviceIds.includes(deviceId))
    ) {
      return c.json({ offer: null }, 200);
    }
    const { versionCode, versionName, sha256, sizeBytes } = release;
    return c.json({ offer: { versionCode, versionName, sha256, sizeBytes } }, 200);
  });

  // Plain bytes, so it is not in the contract: the kid app fetches it with its own HTTP call.
  app.get('/v1/device/app-update/apk', async (c) => {
    const { deviceId } = await requireDevice(c, db);
    const release = await readRelease(config.releasesDir);
    if (!release || (release.deviceIds && !release.deviceIds.includes(deviceId))) {
      throw new ApiError('not_found', 'No update for this device.');
    }
    const path = join(config.releasesDir ?? '', release.file);
    const size = await stat(path).then(
      (s) => s.size,
      () => null,
    );
    if (size === null) throw new ApiError('not_found', 'No update for this device.');
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': String(size) },
    });
  });

  app.openapi(removedRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const eventId = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx
        .update(devices)
        .set({ revokedAt: sql`now()`, fcmToken: null })
        .where(eq(devices.id, deviceId))
        .returning({ name: devices.name });
      const [event] = await tx
        .insert(events)
        .values({ familyId, kidId, deviceId, kind: 'device.removed', at: sql`now()`, payload: { deviceName: device?.name ?? null } })
        .returning({ id: events.id });
      return event?.id;
    });
    disconnectDevices(deps, [deviceId]);
    if (eventId) void notifyParents(deps, familyId, [eventId]);
    return c.body(null, 204);
  });
}
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/update/AppUpdater.kt`

```kotlin
package au.screentime.kid.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.ConnectivityManager
import android.os.SystemClock
import android.util.Log
import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.AppUpdateCheck
import au.screentime.core.model.api.AppUpdateOffer
import au.screentime.kid.BuildConfig
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val TAG = "KidService"

/** What the updater should do next (docs/SPEC.md §12.1). Everything else about updating is Android's. */
enum class UpdateStep { NOTHING, DOWNLOAD, INSTALL }

/**
 * [offer] is what the server last offered, [downloaded] whether its file is here and checked. A download waits for a
 * network that is not metered; an install waits for the screen to be off and no SOS, so it never interrupts the kid.
 */
fun nextUpdateStep(
    offer: AppUpdateOffer?,
    currentCode: Int,
    downloaded: Boolean,
    metered: Boolean,
    screenOn: Boolean,
    sosActive: Boolean,
): UpdateStep = when {
    offer == null || offer.versionCode <= currentCode -> UpdateStep.NOTHING
    !downloaded -> if (metered) UpdateStep.NOTHING else UpdateStep.DOWNLOAD
    screenOn || sosActive -> UpdateStep.NOTHING
    else -> UpdateStep.INSTALL
}

/** Whether a check is due: the first since the service started, then every [everyMs]. */
fun checkDue(lastCheckElapsed: Long?, nowElapsed: Long, everyMs: Long): Boolean =
    lastCheckElapsed == null || nowElapsed - lastCheckElapsed >= everyMs

/** Whether [stream] is what the offer said: its size and SHA-256 (lower-case hex). */
fun matchesOffer(stream: InputStream, sizeBytes: Long, sha256: String): Boolean {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
        val read = stream.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
        total += read
    }
    return total == sizeBytes && digest.digest().joinToString("") { "%02x".format(it) } == sha256
}

/**
 * Keeps the kid app up to date from the family's server (docs/SPEC.md §12.1). As Device Owner the app installs without
 * asking. Android itself refuses a file not signed with the same key, or an older version.
 */
class AppUpdater(
    private val context: Context,
    private val api: ApiClient,
    private val serverUrl: String,
    private val token: () -> String?,
) {
    private var lastCheck: Long? = null
    private var lastInstall: Long? = null
    private var offer: AppUpdateOffer? = null

    private fun fileFor(o: AppUpdateOffer) = File(File(context.cacheDir, "update"), "kid-${o.versionCode}.apk")

    /** Called after each sync. Failures are logged and tried again later. */
    suspend fun tick(screenOn: Boolean, sosActive: Boolean) {
        try {
            val now = SystemClock.elapsedRealtime()
            if (checkDue(lastCheck, now, CHECK_EVERY_MS)) {
                offer = api.postDeviceAppUpdateCheck(AppUpdateCheck(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)).offer
                lastCheck = now
                offer?.let { Log.i(TAG, "update: offered ${it.versionName} (${it.versionCode})") }
            }
            val o = offer
            val file = o?.let { fileFor(it) }
            // The emulator's only network is metered, so a debug build ignores it. Tests cover the rule itself.
            val metered = !BuildConfig.DEBUG && context.getSystemService(ConnectivityManager::class.java).isActiveNetworkMetered
            when (nextUpdateStep(o, BuildConfig.VERSION_CODE, file?.exists() == true, metered, screenOn, sosActive)) {
                UpdateStep.NOTHING -> Unit
                UpdateStep.DOWNLOAD -> download(o!!, file!!)
                UpdateStep.INSTALL -> if (lastInstall == null || now - lastInstall!! >= CHECK_EVERY_MS) {
                    lastInstall = now
                    install(file!!)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "update: failed: $e")
        }
    }

    /** Fetches the file; it only gets its real name once its size and hash are right. */
    private suspend fun download(o: AppUpdateOffer, file: File) = withContext(Dispatchers.IO) {
        file.parentFile?.deleteRecursively()
        file.parentFile?.mkdirs()
        val part = File(file.parentFile, "part")
        val connection = URL("${serverUrl.trimEnd('/')}/v1/device/app-update/apk").openConnection() as HttpURLConnection
        connection.setRequestProperty("Authorization", "Bearer ${token()}")
        connection.connectTimeout = 30_000
        connection.readTimeout = 60_000
        try {
            if (connection.responseCode != 200) {
                Log.w(TAG, "update: download said ${connection.responseCode}")
                return@withContext
            }
            connection.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
        } finally {
            connection.disconnect()
        }
        if (part.inputStream().use { matchesOffer(it, o.sizeBytes.toLong(), o.sha256) }) {
            part.renameTo(file)
            Log.i(TAG, "update: downloaded ${o.versionName}")
        } else {
            part.delete()
            Log.w(TAG, "update: the file does not match the offer")
        }
    }

    private suspend fun install(file: File) = withContext(Dispatchers.IO) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("kid.apk", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val done = PendingIntent.getBroadcast(
                context,
                id,
                Intent(context, UpdateResultReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            Log.i(TAG, "update: installing")
            session.commit(done.intentSender)
        }
    }

    private companion object {
        /** Debug builds check every minute, so a run does not wait. */
        val CHECK_EVERY_MS = if (BuildConfig.DEBUG) 60_000L else 6 * 60 * 60_000L
    }
}

/** Android's answer to an install. A good install stops the app first, so this mostly hears about failures. */
class UpdateResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        Log.i(TAG, "update: install said $status $message")
    }
}
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/update/Removal.kt`

```kotlin
package au.screentime.kid.update

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import au.screentime.core.model.api.ApiClient
import au.screentime.kid.admin.KidDeviceAdminReceiver
import au.screentime.kid.admin.Policies
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.service.KidService
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.cancellation.CancellationException

private const val TAG = "KidService"

/**
 * Takes Screen Time off this device, after a right parent code (docs/SPEC.md §12.1): tells the server if it can,
 * frees every blocked app, gives up Device Owner, and opens Android's own uninstall question. Offline it still works:
 * the device just stays listed until a parent removes it.
 */
suspend fun removeFromDevice(context: Context, api: ApiClient) {
    val told = withTimeoutOrNull(5_000) {
        try {
            api.postDeviceRemoved()
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "remove: could not tell the server: $e")
            false
        }
    }
    Log.i(TAG, "remove: server told: ${told == true}")
    context.stopService(Intent(context, KidService::class.java))

    val dpm = context.getSystemService(DevicePolicyManager::class.java)
    val admin = KidDeviceAdminReceiver.component(context)
    if (dpm.isDeviceOwnerApp(context.packageName)) {
        val pm = context.packageManager
        val all = pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(PackageManager.MATCH_UNINSTALLED_PACKAGES.toLong()))
            .map { it.packageName }
        dpm.setPackagesSuspended(admin, all.toTypedArray(), false)
        for (name in all) {
            if (dpm.isApplicationHidden(admin, name)) dpm.setApplicationHidden(admin, name, false)
        }
        Policies.clear(context)
        dpm.clearDeviceOwnerApp(context.packageName)
        Log.i(TAG, "remove: no longer Device Owner")
    }
    EnrolmentStore(context).clear()
    context.startActivity(
        Intent(Intent.ACTION_DELETE, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    // Nothing is left to show here. If the parent cancels Android's question, opening the app shows the setup screen.
    (context as? Activity)?.finishAffinity()
}
```

#### `android/publish-kid.ps1`

```powershell
# Publishes the kid app, so devices update themselves from the server (docs/SPEC.md §12.1).
# Raise kidVersionCode and kidVersionName in android/gradle.properties first, then from the repo root:
#   pwsh -File android\publish-kid.ps1                       every device, on the real server
#   pwsh -File android\publish-kid.ps1 -DeviceId <id>        one device first
#   pwsh -File android\publish-kid.ps1 -To deploy\releases   a folder, the development server's
# -Apk, -VersionCode and -VersionName publish a file that is already built (runs on the emulator use a debug build).
param(
    [string]$To,
    [string]$Ssh = 'root@192.168.0.148',
    [string]$SshDir = '/mnt/user/appdata/screentime/releases',
    [string]$DeviceId,
    [string]$Apk,
    [int]$VersionCode,
    [string]$VersionName
)
$ErrorActionPreference = 'Stop'
$android = $PSScriptRoot

if (-not $Apk) {
    $props = Get-Content "$android\gradle.properties"
    $VersionCode = [int](($props | Select-String '^kidVersionCode=(\d+)').Matches[0].Groups[1].Value)
    $VersionName = ($props | Select-String '^kidVersionName=(.+)$').Matches[0].Groups[1].Value
    if (-not (Test-Path "$android\keystore.properties")) { throw 'No android\keystore.properties: a release build would not be signed.' }
    Push-Location $android
    try { .\gradlew.bat :app-kid:assembleRelease --quiet } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'The build failed.' }
    $Apk = "$android\app-kid\build\outputs\apk\release\app-kid-release.apk"
}
if (-not (Test-Path $Apk)) { throw "No file at $Apk" }

$file = "kid-$VersionCode.apk"
$release = [ordered]@{
    versionCode = $VersionCode
    versionName = $VersionName
    sha256      = (Get-FileHash $Apk -Algorithm SHA256).Hash.ToLowerInvariant()
    sizeBytes   = (Get-Item $Apk).Length
    file        = $file
}
if ($DeviceId) { $release.deviceIds = @($DeviceId) }
$json = $release | ConvertTo-Json -Compress
$temp = "$Apk.json"
[IO.File]::WriteAllText($temp, $json)

# The file first, kid.json last: a device never sees an offer for a file that is not there yet.
if ($To) {
    New-Item -ItemType Directory -Force $To | Out-Null
    Copy-Item $Apk (Join-Path $To $file) -Force
    Move-Item $temp (Join-Path $To 'kid.json') -Force
} else {
    & ssh $Ssh "mkdir -p '$SshDir'"
    & scp -q $Apk "${Ssh}:$SshDir/$file"
    & scp -q $temp "${Ssh}:$SshDir/kid.json.new"
    & ssh $Ssh "mv '$SshDir/kid.json.new' '$SshDir/kid.json'"
    Remove-Item $temp
}
Write-Output "Published $VersionName ($VersionCode), $($release.sizeBytes) bytes$(if ($DeviceId) { " for device $DeviceId" })"
```

### 5.3 The run script

`docs/cards/CARD-059-run.ps1` is already in the repo. Do not change it. Do not copy it anywhere.

### 5.4 Change these, exactly as in each diff

Lines with `+` are added and lines with `-` are removed. The surrounding lines show where.

#### `.gitignore`

```diff
@@ -46,3 +46,7 @@ windows/**/obj/
 
 # The installer build (windows/installer/build-msi.ps1)
 windows/out/
+
+# Release signing and published APKs (docs/guides/android-provisioning.md)
+android/keystore.properties
+deploy/releases/
```

#### `android/app-kid/build.gradle.kts`

```diff
@@ -1,3 +1,5 @@
+import java.util.Properties
+
 plugins {
     alias(libs.plugins.android.application)
     alias(libs.plugins.kotlin.compose)
@@ -31,19 +33,36 @@ android {
         applicationId = "au.screentime.kid"
         minSdk = 34
         targetSdk = 36
-        versionCode = 1
-        versionName = "0.1.0"
+        versionCode = (findProperty("kidVersionCode") as String).toInt()
+        versionName = findProperty("kidVersionName") as String
         for (name in listOf("FIREBASE_APP_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID")) {
             buildConfigField("String", name, "\"${firebase[name].orEmpty()}\"")
         }
     }
 
+    // The release key lives outside the repo (docs/guides/android-provisioning.md). Without the file a release build stays unsigned.
+    val signing = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { f ->
+        Properties().apply { f.inputStream().use { load(it) } }
+    }
+    signingConfigs {
+        if (signing != null) {
+            create("release") {
+                storeFile = file(signing.getProperty("storeFile"))
+                storePassword = signing.getProperty("storePassword")
+                keyAlias = signing.getProperty("keyAlias")
+                keyPassword = signing.getProperty("keyPassword")
+            }
+        }
+    }
+
     buildTypes {
         debug {
             // The Android emulator reaches the developer's PC at 10.0.2.2 (`pnpm dev:server` or docker compose).
             buildConfigField("String", "DEFAULT_SERVER", "\"http://10.0.2.2:8080\"")
+            manifestPlaceholders["kidTestOnly"] = findProperty("kidTestOnly") ?: "true"
         }
         release {
+            if (signing != null) signingConfig = signingConfigs.getByName("release")
             buildConfigField("String", "DEFAULT_SERVER", "\"https://screentime.gallagherhome.au\"")
         }
     }
```

#### `android/app-kid/src/debug/AndroidManifest.xml`

```diff
@@ -1,12 +1,13 @@
 <?xml version="1.0" encoding="utf-8"?>
 <!--
     Debug builds only. testOnly lets `adb shell dpm remove-active-admin` take the app off as Device Owner,
-    and the network config allows http:// to a server on the developer's PC (10.0.2.2 from the emulator).
+    but Android then refuses a silent self-update, so a run that proves updating builds with -PkidTestOnly=false.
+    The network config allows http:// to a server on the developer's PC (10.0.2.2 from the emulator).
 -->
 <manifest xmlns:android="http://schemas.android.com/apk/res/android">
 
     <application
         android:networkSecurityConfig="@xml/network_security_config"
-        android:testOnly="true" />
+        android:testOnly="${kidTestOnly}" />
 
 </manifest>
```

#### `android/app-kid/src/main/AndroidManifest.xml`

```diff
@@ -10,6 +10,9 @@
     <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" />
     <!-- Scanning the enrolment QR code. Device Owner grants it, so the kid is never asked (docs/SPEC.md §12.1). -->
     <uses-permission android:name="android.permission.CAMERA" />
+    <!-- Self-update (docs/SPEC.md §12.1). As Device Owner the install asks nobody. -->
+    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
+    <uses-permission android:name="android.permission.REQUEST_DELETE_PACKAGES" />
     <uses-feature android:name="android.hardware.camera" android:required="false" />
     <!-- The always-on service (docs/SPEC.md §12.1). systemExempted is allowed because the app is Device Owner. -->
     <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
@@ -90,6 +93,10 @@
             android:excludeFromRecents="true"
             android:taskAffinity="au.screentime.kid.block" />
 
+        <receiver
+            android:name=".update.UpdateResultReceiver"
+            android:exported="false" />
+
         <service
             android:name=".service.KidService"
             android:exported="false"
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt`

```diff
@@ -81,6 +81,19 @@ object Policies {
         }
     }
 
+    /** Takes off everything [apply] put on, before the app gives up Device Owner (docs/SPEC.md §12.1). */
+    @Synchronized
+    fun clear(context: Context) {
+        val dpm = context.getSystemService(DevicePolicyManager::class.java)
+        val admin = KidDeviceAdminReceiver.component(context)
+        for (restriction in RESTRICTIONS + UserManager.DISALLOW_DEBUGGING_FEATURES) {
+            dpm.clearUserRestriction(admin, restriction)
+        }
+        dpm.setUninstallBlocked(admin, context.packageName, false)
+        dpm.setLockTaskPackages(admin, emptyArray())
+        dpm.setShortSupportMessage(admin, null)
+    }
+
     /**
      * The policies that were on after the last [apply] and found off before this one, since the service last asked;
      * empty when none. Asking forgets them.
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentModeSheet.kt`

```diff
@@ -32,6 +32,7 @@ import androidx.compose.runtime.collectAsState
 import androidx.compose.runtime.getValue
 import androidx.compose.runtime.mutableStateOf
 import androidx.compose.runtime.remember
+import androidx.compose.runtime.rememberCoroutineScope
 import androidx.compose.runtime.setValue
 import androidx.compose.ui.Alignment
 import androidx.compose.ui.Modifier
@@ -55,7 +56,9 @@ import au.screentime.kid.live.ParentModeNews
 import au.screentime.kid.service.KidService
 import au.screentime.kid.status.KidStatus
 import au.screentime.kid.status.StatusHub
+import au.screentime.kid.update.removeFromDevice
 import java.util.UUID
+import kotlinx.coroutines.launch
 
 private enum class Step { WAITING, CODE, HOW_LONG }
 
@@ -245,5 +248,66 @@ fun ParentModeBanner(status: KidStatus, modifier: Modifier = Modifier) {
         ) {
             Text("End now", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
         }
+        Spacer(Modifier.height(8.dp))
+        var removing by remember { mutableStateOf(false) }
+        TextButton(onClick = { removing = true }, modifier = Modifier.fillMaxWidth()) {
+            Text("Remove Screen Time", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
+        }
+        if (removing) RemoveSheet(status.parentCodeSecret) { removing = false }
+    }
+}
+
+/**
+ * **Remove Screen Time** (docs/SPEC.md §12.1). The parent code is asked here even when parent mode is already on,
+ * because a parent can turn parent mode on from far away with the kid holding the device.
+ */
+@OptIn(ExperimentalMaterial3Api::class)
+@Composable
+private fun RemoveSheet(secret: String, onDone: () -> Unit) {
+    val context = LocalContext.current
+    val scope = rememberCoroutineScope()
+    var sure by remember { mutableStateOf(false) }
+    var working by remember { mutableStateOf(false) }
+    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
+    ModalBottomSheet(onDismissRequest = onDone, sheetState = sheetState) {
+        Column(
+            modifier = Modifier
+                .fillMaxWidth()
+                .imePadding()
+                .verticalScroll(rememberScrollState())
+                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
+        ) {
+            when {
+                working -> {
+                    SheetTitle("Removing…")
+                    Spacer(Modifier.height(16.dp))
+                    CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
+                }
+                !sure -> {
+                    SheetTitle("Remove Screen Time?")
+                    Spacer(Modifier.height(8.dp))
+                    Text(
+                        text = "This device will have no limits and no SOS. Your family's history stays. To use Screen Time here again you need the computer setup.",
+                        style = MaterialTheme.typography.bodyLarge,
+                        color = MaterialTheme.colorScheme.onSurfaceVariant,
+                    )
+                    Spacer(Modifier.height(24.dp))
+                    FilledTonalButton(
+                        onClick = { sure = true },
+                        modifier = Modifier
+                            .fillMaxWidth()
+                            .height(56.dp),
+                    ) {
+                        Text("Remove it", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
+                    }
+                    Spacer(Modifier.height(8.dp))
+                    TextButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Keep it") }
+                }
+                else -> CodeEntry(secret) {
+                    working = true
+                    scope.launch { withApi(context, Unit) { removeFromDevice(context, it) } }
+                }
+            }
+        }
     }
 }
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

```diff
@@ -46,6 +46,7 @@ import au.screentime.kid.status.WarningTracker
 import au.screentime.kid.status.kidStatus
 import au.screentime.kid.status.nextCheckAtMs
 import au.screentime.kid.sync.Syncer
+import au.screentime.kid.update.AppUpdater
 import au.screentime.kid.sync.TrustedClock
 import au.screentime.kid.tamper.CaughtActivity
 import au.screentime.kid.apps.AppWatcher
@@ -96,6 +97,7 @@ class KidService : Service() {
     private lateinit var segments: RoomSegmentStore
     private lateinit var states: FileStateStore
     private lateinit var syncer: Syncer
+    private var updater: AppUpdater? = null
     private lateinit var notifier: Notifier
     private lateinit var parentStore: ParentModeStore
     private var parentApi: ParentModeApi? = null
@@ -180,6 +182,11 @@ class KidService : Service() {
 
     override fun onCreate() {
         super.onCreate()
+        // Without Device Owner (Screen Time was just removed) Android refuses this kind of foreground service.
+        if (!Policies.isDeviceOwner(this)) {
+            stopSelf()
+            return
+        }
         // A service started with startForegroundService must call startForeground first, even if it stops at once.
         notifier = Notifier(this)
         startForeground(Notifier.STATUS_ID, notifier.starting(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
@@ -210,6 +217,7 @@ class KidService : Service() {
         tamper = TamperStore(this)
         tamperApi = TamperApi(client)
         apps = AppWatcher(this, client)
+        updater = AppUpdater(this, client, enrolment.serverUrl, token = { enrolment.deviceToken })
         kidName = enrolment.kidName
         sos.resume()
         syncer = Syncer(client, segments, states, clock, log = { Log.w(TAG, it) })
@@ -476,6 +484,7 @@ class KidService : Service() {
             val ok = syncer.sync()
             lastSyncElapsed = SystemClock.elapsedRealtime()
             lastSyncOk = ok
+            if (ok) updater?.tick(screenOn(), sos.pending)
             if (ok) {
                 segments.prune(clock.nowMs() - KEEP_DAYS * 24 * 60 * MINUTE)
             } else {
@@ -603,6 +612,7 @@ class KidService : Service() {
         private const val ACTION_CALL_BLOCKED = "au.screentime.kid.action.CALL_BLOCKED"
 
         fun start(context: Context) {
+            if (!Policies.isDeviceOwner(context)) return
             context.startForegroundService(Intent(context, KidService::class.java))
         }
 
@@ -613,6 +623,7 @@ class KidService : Service() {
 
         /** A push frame, handed to the service like a WebSocket frame (docs/SPEC.md §10, CARD-034b). */
         fun push(context: Context, frame: String) {
+            if (!Policies.isDeviceOwner(context)) return
             context.startForegroundService(
                 Intent(context, KidService::class.java).setAction(ACTION_PUSH).putExtra(EXTRA_FRAME, frame),
             )
@@ -620,6 +631,7 @@ class KidService : Service() {
 
         /** The FCM token changed: send it to the server (docs/SPEC.md §10, CARD-034b). */
         fun newToken(context: Context) {
+            if (!Policies.isDeviceOwner(context)) return
             context.startForegroundService(Intent(context, KidService::class.java).setAction(ACTION_PUSH_TOKEN))
         }
 
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/inbox/Inbox.kt`

```diff
@@ -140,6 +140,7 @@ fun eventView(e: EventItem, zone: ZoneId): EventView {
             EventView("$byOrParent $what ${text(p, "label") ?: "an app"} for $kid", null, EventTone.INFO)
         }
         "app.first_used" -> EventView("$kid opened ${text(p, "label") ?: "an app"} for the first time", "On $device", EventTone.INFO)
+        "device.removed" -> EventView("Screen Time was removed from $device", "With the parent code, on the device", EventTone.ALERT)
         "device.enrolled" -> EventView("${text(p, "name") ?: device} was added for $kid", null, EventTone.INFO)
         else -> if (e.kind.startsWith("tamper.")) {
             val what = when (e.kind) {
```

#### `android/gradle.properties`

```diff
@@ -1,3 +1,7 @@
 org.gradle.jvmargs=-Xmx4g -Dfile.encoding=UTF-8
 org.gradle.caching=true
 kotlin.code.style=official
+
+# The kid app's version. Raise kidVersionCode for every release: devices only install a higher number.
+kidVersionCode=1
+kidVersionName=0.1.0
```

#### `deploy/docker-compose.yml`

```diff
@@ -39,6 +39,9 @@ services:
       SMTP_FROM: ${SMTP_FROM:-}
       SMTP_FROM_NAME: ${SMTP_FROM_NAME:-}
       FIREBASE_SERVICE_ACCOUNT_JSON: ${FIREBASE_SERVICE_ACCOUNT_JSON:-}
+      RELEASES_DIR: /releases
+    volumes:
+      - ./releases:/releases:ro
     ports:
       - "8080:8080"
     depends_on:
```

#### `deploy/unraid/docker-compose.yml`

```diff
@@ -36,6 +36,9 @@ services:
       SMTP_FROM: ${SMTP_FROM:-}
       SMTP_FROM_NAME: ${SMTP_FROM_NAME:-}
       FIREBASE_SERVICE_ACCOUNT_JSON: ${FIREBASE_SERVICE_ACCOUNT_JSON:-}
+      RELEASES_DIR: /releases
+    volumes:
+      - /mnt/user/appdata/screentime/releases:/releases:ro
     ports:
       # Bridge networking, published on Unraid's port 8086: the tunnel route sends screentime.gallagherhome.au to
       # http://192.168.0.148:8086. Port 8080 on Unraid belongs to qBittorrent.
```

#### `packages/schemas/src/index.ts`

```diff
@@ -109,3 +109,4 @@ export {
   KidApps,
   KidAppSettings,
 } from './apps.js';
+export { AppUpdateAnswer, AppUpdateCheck, AppUpdateOffer } from './appupdate.js';
```

#### `packages/schemas/src/notify.ts`

```diff
@@ -19,6 +19,7 @@ export const NotificationKind = z
     'app.first_used',
     'device.offline',
     'device.enrolled',
+    'device.removed',
     'grant.by_other_parent',
   ])
   .meta({ id: 'NotificationKind' });
```

#### `server/src/app.ts`

```diff
@@ -22,6 +22,7 @@ import { createRouter } from './router.js';
 import { registerSosRoutes } from './sos/routes.js';
 import { registerSyncRoutes } from './sync/routes.js';
 import { registerAppRoutes } from './apps/routes.js';
+import { registerAppUpdateRoutes } from './appupdate/routes.js';
 import { registerTamperRoutes } from './tamper/routes.js';
 import { registerWeb } from './web.js';
 
@@ -97,6 +98,7 @@ export function createApp(appDeps: AppDeps) {
   registerParentModeRoutes(app, deps);
   registerTamperRoutes(app, deps);
   registerAppRoutes(app, deps);
+  registerAppUpdateRoutes(app, deps);
   registerSosRoutes(app, deps);
   registerNotifyRoutes(app, deps);
   registerAdminRoutes(app, deps);
```

#### `server/src/config.ts`

```diff
@@ -20,6 +20,8 @@ export interface Config {
   firebaseServiceAccountJson: string | null;
   /** The folder with the built web app (`web/dist`). Null when WEB_DIR is unset: the server is the API only. */
   webDir: string | null;
+  /** The folder with `kid.json` and the kid app's APK. Null when RELEASES_DIR is unset: no self-updates. */
+  releasesDir: string | null;
 }
 
 /** Reads settings from environment variables. Throws if a required one is missing. Empty values count as unset. */
@@ -58,6 +60,7 @@ export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
         : null,
     firebaseServiceAccountJson: firebase,
     webDir: env.WEB_DIR?.trim() || null,
+    releasesDir: env.RELEASES_DIR?.trim() || null,
   };
 }
 
```

#### `server/src/notify/routes.ts`

```diff
@@ -102,6 +102,7 @@ const KIND_NAME: Record<NotificationKind, string> = {
   'app.first_used': 'Apps used for the first time',
   'device.offline': 'Device offline',
   'device.enrolled': 'Device added',
+  'device.removed': 'Screen Time removed',
   'grant.by_other_parent': 'Time changed by another parent',
 };
 
```

#### `server/test/config.test.ts`

```diff
@@ -14,6 +14,7 @@ describe('loadConfig', () => {
       smtp: null,
       firebaseServiceAccountJson: null,
       webDir: null,
+      releasesDir: null,
     });
   });
 
```

#### `server/test/csharp-client.test.ts`

```diff
@@ -16,7 +16,7 @@ describe('C# API client', () => {
   });
 
   it('has one method for every device operation and none for the parent ones', () => {
-    expect(client.match(/^ {4}public Task/gm)).toHaveLength(16);
+    expect(client.match(/^ {4}public Task/gm)).toHaveLength(18);
     expect(client).toContain(
       '    public Task<EnrolResponse> PostEnrolAsync(EnrolRequest body, CancellationToken cancellationToken = default) =>\n' +
         '        SendAsync(HttpMethod.Post, "v1/enrol", auth: false, body, ApiJsonContext.Default.EnrolRequest, ApiJsonContext.Default.EnrolResponse, cancellationToken);\n',
```

#### `server/test/helpers.ts`

```diff
@@ -10,7 +10,7 @@ import { runMigrations } from '../src/db/migrate.js';
 export const TEST_SECRET = 'test-secret-that-is-at-least-32-chars';
 
 export function testConfig(databaseUrl: string, superAdminEmail: string | null = null): Config {
-  return { port: 0, databaseUrl, jwtSecret: TEST_SECRET, superAdminEmail, smtp: null, firebaseServiceAccountJson: null, webDir: null };
+  return { port: 0, databaseUrl, jwtSecret: TEST_SECRET, superAdminEmail, smtp: null, firebaseServiceAccountJson: null, webDir: null, releasesDir: null };
 }
 
 /** Empties the test database and applies every migration. Only for TEST_DATABASE_URL. */
```

#### `server/test/notify.test.ts`

```diff
@@ -184,7 +184,7 @@ describe.skipIf(!url)('notifications', () => {
     it('lists every kind, all on, with the essential ones marked', async () => {
       const res = await api.get('/v1/me/notification-prefs', dad);
       expect(res.status).toBe(200);
-      expect(res.body).toHaveLength(13);
+      expect(res.body).toHaveLength(14);
       expect(res.body.every((p: { enabled: boolean }) => p.enabled)).toBe(true);
       expect(res.body.filter((p: { essential: boolean }) => p.essential).map((p: { kind: string }) => p.kind)).toEqual([
         'sos',
```

#### `web/src/components/devices-panel.tsx`

```diff
@@ -190,7 +190,8 @@ function DeviceRow({
   const parentMode = live?.parentMode ?? null;
   // The model is left out while it is still the name (a device's first name is its model).
   const model = device.model && !device.name.includes(device.model) ? device.model : null;
-  const facts = [`${POOL_NAMES[device.pool]} time`, model, device.osVersion].filter(Boolean).join(' · ');
+  const version = device.appVersion ? `Version ${device.appVersion}` : null;
+  const facts = [`${POOL_NAMES[device.pool]} time`, model, device.osVersion, version].filter(Boolean).join(' · ');
 
   return (
     <div className="flex items-center gap-4 border-t border-outline py-4 last:pb-0">
```

#### `web/src/lib/inbox.ts`

```diff
@@ -141,6 +141,8 @@ export function eventView(event: EventItem, timeZone: string): EventView {
       };
     case 'app.first_used':
       return { text: `${kid} opened ${str(p, 'label') ?? 'an app'} for the first time`, detail: `On ${device}`, tone: 'info' };
+    case 'device.removed':
+      return { text: `Screen Time was removed from ${device}`, detail: 'With the parent code, on the device', tone: 'alert' };
     case 'device.enrolled':
       return { text: `${str(p, 'name') ?? device} was added for ${kid}`, detail: null, tone: 'info' };
     default:
```

#### `web/src/lib/settings.ts`

```diff
@@ -17,6 +17,7 @@ export const NOTIFICATION_TEXT: Record<NotificationKind, { title: string; detail
   'app.installed': { title: 'New apps', detail: 'When an app is installed on an Android device.' },
   'app.first_used': { title: 'Apps used for the first time', detail: 'When an app is opened for the first time on an Android device.' },
   'device.enrolled': { title: 'Device added', detail: 'When a new device is added for a kid.' },
+  'device.removed': { title: 'Screen Time removed', detail: 'When Screen Time is taken off a device with the parent code.' },
   'grant.by_other_parent': { title: 'Time changed by another parent', detail: 'When another parent adds or takes away time.' },
 };
 
```

### 5.5 The generated files

After the schema and route changes, run `pnpm contract` from the repo root. It rewrites `contract/openapi.json`, `android/core-model/.../ApiClient.kt` and `ApiModels.kt`, and `windows/src/ScreenTime.Core/Api/ApiClient.g.cs` and `ApiModels.g.cs`. Commit them as they come, and never edit them by hand.

There is no migration: `devices.app_version` already exists.

## 6. Detailed spec

This is what the code above does, for your review and for the PR. `docs/SPEC.md` §12.1 is the full version.

- **Publishing:** `android/publish-kid.ps1` puts `kid-<code>.apk` then `kid.json` in the releases folder (`RELEASES_DIR`). `-DeviceId` limits it to one device.
- **The check:** `POST /v1/device/app-update/check` stores the version and answers `{ offer }`, null unless this Android device is listed and the version is newer. `GET /v1/device/app-update/apk` serves the bytes and is not in the contract.
- **On the device:** after a sync, every 6 hours (every minute in debug), it checks; it downloads on a network that is not metered, checks size and SHA-256, and installs when the screen is off and no SOS is running.
- **Remove:** in parent mode, **Remove Screen Time**, **Remove it**, then the parent code, always. `POST /v1/device/removed` revokes the device and writes `device.removed`. Then the app frees blocked apps, clears its policies, gives up Device Owner, forgets its enrolment and opens Android's uninstall question.
- **Parents** see "Screen Time was removed from <device>" in the inbox, and the app version on the devices panel.
- **Signing:** `android/keystore.properties` (git-ignored) signs a release build. Without it the release build is unsigned.

## 7. Steps

1. Start the branch (section 10).
2. Create the files of 5.1 and 5.2, and make the changes of 5.4.
3. Do 5.5.
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
dotnet test tests\ScreenTime.Core.Tests
cd ..\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git grep -l 'Â' -- packages server/src server/scripts server/test android/app-kid/src android/app-parent/src web/src windows/tests
```

- [ ] `pnpm typecheck` and `pnpm build` pass. An error that `screentime_test` already exists is fine.
- [ ] `pnpm test` passes. In the rehearsal: engine 27, schemas 36, web 69, server 268, with 10 in `test/app-update.test.ts`.
- [ ] `dotnet test` says `Test run summary: Passed!`. In the rehearsal: 270.
- [ ] `.\gradlew.bat assembleDebug test` says `BUILD SUCCESSFUL`, with `AppUpdaterTest` at 12 tests. Check with `Select-String 'tests="' android\app-kid\build\test-results\testDebugUnitTest\TEST-au.screentime.kid.update.AppUpdaterTest.xml`.
- [ ] The last `git grep` prints nothing. If it prints a file, you saved it in the wrong encoding: save it again as UTF-8 without a BOM.

Then a signed release build, with a throwaway key outside the repo:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$store = (Join-Path (Split-Path (Get-Location)) 'temp\card059-test.keystore')
Remove-Item $store -Force -ErrorAction SilentlyContinue
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $store -storepass throwaway-only -keypass throwaway-only -alias kid -keyalg RSA -keysize 2048 -validity 365 -dname 'CN=Throwaway'
Set-Content android\keystore.properties "storeFile=$($store.Replace('\','/'))`nstorePassword=throwaway-only`nkeyAlias=kid`nkeyPassword=throwaway-only"
cd android
.\gradlew.bat :app-kid:assembleRelease
.\gradlew.bat --stop
cd ..
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs android\app-kid\build\outputs\apk\release\app-kid-release.apk
Remove-Item android\keystore.properties
git status --short | Select-String keystore
```

- [ ] `apksigner` prints a signer line with `CN=Throwaway`.
- [ ] The last line prints nothing: neither file is seen by git.
- [ ] Do not install this release build. Claude proved installing one in the rehearsal.

### 8.2 On the emulator

Close what you can first, and stop any emulator still running: **the emulator freezes when the PC runs out of memory** (`adb` then hangs with no error), and timing checks can fail when it is merely slow. If that happens, stop the run with Ctrl+C, close other programs, and run it again. A rerun starts clean. Say so under Deviations, with the failures you saw.

From the repo root, in `pwsh`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
pwsh -File docs\cards\CARD-059-run.ps1 2>&1 | Tee-Object -FilePath ..\temp\card059-bob-out.txt
```

It takes about 10 minutes. It **wipes the emulator and the development database, and replaces `deploy\.env` with throwaway values**. It builds its own APKs and creates `deploy\releases`, which git ignores. It stops the emulator at the end.

- [ ] The last line is `--- Finished with 0 failed.`, and no line starts with `FAIL`. In the rehearsal: 24 `PASS` lines.
- [ ] Paste **all** of `..\temp\card059-bob-out.txt` into the handback. A summary counts as `NOT RUN`.
- [ ] Say what you see in `..\temp\card059-remove.png` (the Remove question) and `..\temp\card059-uninstall.png` (Android's uninstall question). If one does not exist, write `NOT RUN`.

Not tested on the emulator: the 6-hour check, a network that is not metered, a real server over https, and a real device. Do not try to sign in to Google.

### 8.3 CI

- [ ] On the PR, every check is green.

## 9. Tests

- `server/test/app-update.test.ts` (10 tests): nothing published and the stored version; an offer without the file name or device list; the same or older version; a PC; chosen devices; a bad `kid.json`; no token; serving the file only to its device; a missing file; a removed device revoked and the parents told.
- `android/app-kid/.../update/AppUpdaterTest.kt` (12 tests): when to download and install, waiting for the screen, an SOS and the network, when a check is due, and size and hash matching.
- The other test files in 5.4 change only as shown.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-059-release-builds
   ```
2. Commit in small logical commits. Message format: `CARD-059: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-059-release-builds`
5. Open a PR into `main` titled `CARD-059: Release builds, self-update and removal` with this body, written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-059-release-builds.md

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
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace, and every workaround (a restart, a retry). If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-059. Please review and merge if it is good.

CARD: CARD-059 Release builds, self-update and removal
PR: <full PR URL>
Branch: bob/card-059-release-builds
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- pnpm typecheck -> <key lines, or NOT RUN: reason>
- pnpm test -> <test counts per package, or NOT RUN: reason>
- dotnet test (from windows) -> <summary, or NOT RUN: reason>
- .\gradlew.bat assembleDebug test -> <result and the AppUpdaterTest line, or NOT RUN: reason>
- git grep for mangled characters -> <output, or NOT RUN: reason>
- signed release build and apksigner -> <the signer line, or NOT RUN: reason>
- pwsh -File docs\cards\CARD-059-run.ps1 -> <ALL of ..\temp\card059-bob-out.txt, or NOT RUN: reason>
- The two screenshots -> <what each one shows, or NOT RUN: reason>
- CI -> <every check and its result, or NOT RUN: reason>

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
