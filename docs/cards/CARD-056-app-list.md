# CARD-056: App list and install and first-use alerts

| Field | Value |
|---|---|
| Card | CARD-056 |
| Title | App list and install and first-use alerts |
| Size | L |
| Depends on | CARD-039, CARD-042, CARD-043b and the CARD-056 front end (PR #154), all merged to `main` |
| Spec sections | docs/SPEC.md §12.4, §6.1, §9.2, §9.3, §12.1, §13, §16.4, §16.5, Q34 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-056-app-list` |
| PR title | `CARD-056: App list and install and first-use alerts` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first (rules 8, 9 and 10 especially).

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM: section 8.1 checks for mangled characters (`§` saved as `Â§`).

A parent wants to know when an app is installed on a kid's Android device, and the first time each app is opened there, so pre-installed apps show up too. Android only: Windows has none of this.

Claude has **already rehearsed this whole card** with the code below, and every step of section 8 passed (section 8.3 has the output). Copy the code exactly. The tests are the contract and must pass unchanged.

The screens are done and merged (PR #154): the web Apps tab, the parent app's Apps page and the inbox words, with fake data behind a seam. **Rule 10 of `AGENTS.md` applies:** do not change those screens. The only front-end changes you make are the seams listed in section 5.3, and those are exact.

## 2. Goal

The kid app sends its app list and first uses to the server; the server stores them and writes `app.installed` and `app.first_used` events, which parents see in the inbox and as pushes; the Apps pages show real data. `pnpm test`, `.\gradlew.bat assembleDebug test` and `pwsh -File docs\cards\CARD-056-run.ps1` all pass, and CI is green.

## 3. Out of scope

- No blocking, no rules, no `app_rules` table, no new app approval (CARD-057). `newAppApproval` is always `false` in this card.
- No per-app minutes, no `app_usage_daily` (CARD-058). `todaySeconds` is always `0`.
- No usage access tamper check (CARD-058). No change to `Policies.kt`.
- Nothing on Windows, apart from the generated client that `pnpm contract` rewrites. Do not edit generated files by hand.
- No app icons. No new library.
- Never run on a real phone, never install a release build, never commit secrets (`deploy/.env`, tokens, keys, `google-services.json`, `local.properties`).

## 4. Tech

The project's existing stack, with nothing new: TypeScript, Hono, Zod, Drizzle, Vitest; Kotlin with JUnit 6. The Android permissions `QUERY_ALL_PACKAGES` and `PACKAGE_USAGE_STATS` are fine here because the app is not on the Play Store.

Traps Claude hit in the rehearsal, so you need not:

- `package` is a Kotlin keyword. The generated field is `` `package` ``, with backticks.
- `installer` and `firstUsedAt` are `.nullable()`, **not** `.nullable().optional()`: the Kotlin generator turns optional into `Opt<String>`, which does not fit.
- Postgres `jsonb` reorders keys, so a payload's `package` is not first. That is why `dev-apps.ts` prints it in its own column.
- Without usage access the list still works and first use is not seen. Setup gives usage access with adb, because Device Owner cannot grant it.

## 5. Files

### 5.1 Create these, exactly

#### `packages/schemas/src/apps.ts`

```typescript
import { z } from 'zod';

/** How an app got onto an Android device (docs/SPEC.md §12.4). */
export const AppSource = z.enum(['preinstalled', 'play', 'other']).meta({ id: 'AppSource' });

export type AppSource = z.infer<typeof AppSource>;

/** One app with a launcher icon, as the device sees it. */
export const DeviceAppIn = z
  .object({
    package: z.string().min(1).max(255),
    label: z.string().min(1).max(80),
    source: AppSource,
    /** The package that installed it, if Android knows. */
    installer: z.string().max(255).nullable(),
    /** False for what the device never blocks: Settings, the launcher, the phone and messaging apps. */
    blockable: z.boolean(),
    installedAt: z.iso.datetime({ offset: true }),
    /** The first time the device saw it opened. */
    firstUsedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'DeviceAppIn' });

export type DeviceAppIn = z.infer<typeof DeviceAppIn>;

/** Body of PUT /v1/device/apps: the device's whole list. */
export const DeviceAppsPut = z
  .object({ apps: z.array(DeviceAppIn).min(1).max(500) })
  .refine((body) => new Set(body.apps.map((a) => a.package)).size === body.apps.length, {
    message: 'Each package may appear only once.',
  })
  .meta({ id: 'DeviceAppsPut' });

export type DeviceAppsPut = z.infer<typeof DeviceAppsPut>;

/** One of the kid's devices an app is or was on. */
export const KidAppDevice = z
  .object({
    deviceId: z.uuid(),
    deviceName: z.string(),
    installedAt: z.iso.datetime(),
    firstUsedAt: z.iso.datetime().nullable(),
    removedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'KidAppDevice' });

export type KidAppDevice = z.infer<typeof KidAppDevice>;

/** One app across the kid's Android devices. */
export const KidApp = z
  .object({
    package: z.string(),
    label: z.string(),
    source: AppSource,
    blockable: z.boolean(),
    /** 0 until app time is counted (CARD-058). */
    todaySeconds: z.int(),
    devices: z.array(KidAppDevice),
  })
  .meta({ id: 'KidApp' });

export type KidApp = z.infer<typeof KidApp>;

/** GET /v1/kids/{kidId}/apps. */
export const KidApps = z
  .object({
    /** Always false until new app approval exists (CARD-057). */
    newAppApproval: z.boolean(),
    apps: z.array(KidApp),
  })
  .meta({ id: 'KidApps' });

export type KidApps = z.infer<typeof KidApps>;
```

#### `server/src/apps/routes.ts`

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DeviceAppsPut, KidApps, type KidApp } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { withFamily } from '../db/family.js';
import { deviceApps, devices, events } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { findKid } from '../kids/routes.js';
import { notifyParents } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const putDeviceAppsRoute = createRoute({
  method: 'put',
  path: '/v1/device/apps',
  tags: ['device'],
  summary: "Send the device's whole app list",
  description:
    'The first list is the baseline and raises nothing. After that a new app writes `app.installed`, and a first `firstUsedAt` writes `app.first_used`. An app left out is marked removed. Android only.',
  security: deviceBearer,
  request: { body: jsonBody(DeviceAppsPut) },
  responses: { 204: { description: 'Stored.' }, ...errorResponses(401, 409, 422) },
});

const getKidAppsRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}/apps',
  tags: ['kids'],
  summary: "A kid's apps across their Android devices",
  security: bearer,
  request: { params: z.object({ kidId: z.uuid() }) },
  responses: { 200: jsonResponse('The apps.', KidApps), ...errorResponses(401, 403, 404, 422) },
});

/** A device clock can be ahead; nothing is stored as happening in the future. */
function notFuture(at: Date, now: Date): Date {
  return at < now ? at : now;
}

/** Earlier than [other], or [other] when there is nothing to compare. */
function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/** The app list, and install and first-use alerts (docs/SPEC.md §12.4, Q34). Android only. */
export function registerAppRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(putDeviceAppsRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const now = new Date();
    const eventIds = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId));
      if (!device) throw new Error('device vanished after requireDevice');
      if (device.platform !== 'android') throw new ApiError('conflict', 'Apps are only on Android devices.');
      const known = await tx.select().from(deviceApps).where(eq(deviceApps.deviceId, deviceId));
      const byPackage = new Map(known.map((row) => [row.package, row]));
      // The device's first list: what is already there raises nothing.
      const baseline = known.length === 0;
      const toWrite: { kind: string; at: Date; payload: Record<string, unknown> }[] = [];

      for (const a of body.apps) {
        const row = byPackage.get(a.package);
        const installedAt = notFuture(new Date(a.installedAt), now);
        const seenFirstUse = a.firstUsedAt ? notFuture(new Date(a.firstUsedAt), now) : null;
        const firstUsedAt = earliest(row?.firstUsedAt ?? null, seenFirstUse);
        const payload = { package: a.package, label: a.label, source: a.source, deviceName: device.name };
        if (!baseline && (!row || row.removedAt)) toWrite.push({ kind: 'app.installed', at: installedAt, payload });
        if (!baseline && seenFirstUse && !row?.firstUsedAt) {
          toWrite.push({
            kind: 'app.first_used',
            at: seenFirstUse,
            payload: { package: a.package, label: a.label, deviceName: device.name },
          });
        }
        const values = {
          label: a.label,
          source: a.source,
          installer: a.installer,
          blockable: a.blockable,
          installedAt,
          firstUsedAt,
          removedAt: null,
        };
        await tx
          .insert(deviceApps)
          .values({ familyId, kidId, deviceId, package: a.package, baseline, firstSeenAt: now, ...values })
          .onConflictDoUpdate({ target: [deviceApps.deviceId, deviceApps.package], set: values });
      }

      const sent = new Set(body.apps.map((a) => a.package));
      for (const row of known) {
        if (sent.has(row.package) || row.removedAt) continue;
        await tx
          .update(deviceApps)
          .set({ removedAt: now })
          .where(and(eq(deviceApps.deviceId, deviceId), eq(deviceApps.package, row.package)));
      }

      if (toWrite.length === 0) return [];
      const stored = await tx
        .insert(events)
        .values(toWrite.map((e) => ({ familyId, kidId, deviceId, ...e })))
        .returning({ id: events.id });
      return stored.map((e) => e.id);
    });
    await notifyParents(deps, familyId, eventIds);
    return c.body(null, 204);
  });

  app.openapi(getKidAppsRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { kidId } = c.req.valid('param');
    const rows = await withFamily(db, familyId, async (tx) => {
      const kid = await findKid(tx, kidId);
      if (!kid) throw new ApiError('not_found', 'No such kid.');
      return tx
        .select({ app: deviceApps, deviceName: devices.name })
        .from(deviceApps)
        .innerJoin(devices, eq(devices.id, deviceApps.deviceId))
        .where(and(eq(deviceApps.kidId, kidId), isNull(devices.revokedAt)))
        .orderBy(asc(deviceApps.label), asc(devices.name));
    });
    const apps = new Map<string, KidApp>();
    for (const { app: row, deviceName } of rows) {
      const entry = apps.get(row.package) ?? {
        package: row.package,
        label: row.label,
        source: row.source as KidApp['source'],
        blockable: true,
        todaySeconds: 0,
        devices: [],
      };
      // A phone's Settings may be listed where a tablet's is not: it can be blocked only if every device can.
      entry.blockable = entry.blockable && row.blockable;
      entry.devices.push({
        deviceId: row.deviceId,
        deviceName,
        installedAt: row.installedAt.toISOString(),
        firstUsedAt: row.firstUsedAt?.toISOString() ?? null,
        removedAt: row.removedAt?.toISOString() ?? null,
      });
      apps.set(row.package, entry);
    }
    return c.json({ newAppApproval: false, apps: [...apps.values()] }, 200);
  });
}
```

#### `server/scripts/dev-apps.ts`

```typescript
// Shows what the server has for a kid's apps, and the app events, from the development database.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/dev-apps.ts Alex
// Never run this against the production database.
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { deviceApps, events, kids } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
if (!databaseUrl || !kidName) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-apps.ts <kid name>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db.select().from(kids).where(sql`lower(${kids.name}) = lower(${kidName})`).limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}`);
  const apps = await db.select().from(deviceApps).where(eq(deviceApps.kidId, kid.id)).orderBy(asc(deviceApps.package));
  console.log(`apps: ${apps.length}`);
  for (const a of apps) {
    console.log(
      `${a.package} | ${a.label} | ${a.source} | installer=${a.installer} | blockable=${a.blockable} | baseline=${a.baseline} | used=${a.firstUsedAt?.toISOString() ?? '-'} | removed=${a.removedAt?.toISOString() ?? '-'}`,
    );
  }
  const list = await db
    .select()
    .from(events)
    .where(and(eq(events.kidId, kid.id), like(events.kind, 'app.%')))
    .orderBy(desc(events.createdAt));
  console.log(`events: ${list.length}`);
  for (const e of list) console.log(`${e.kind} | ${(e.payload as { package?: string }).package} | ${JSON.stringify(e.payload)}`);
} finally {
  await pool.end();
}
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/apps/Apps.kt`

```kotlin
package au.screentime.kid.apps

import au.screentime.core.model.api.AppSource
import au.screentime.core.model.api.DeviceAppIn
import au.screentime.core.model.api.DeviceAppsPut
import java.time.Instant

/** What Android says about one app with a launcher icon. */
data class InstalledApp(
    val packageName: String,
    val label: String,
    val isSystem: Boolean,
    val installer: String?,
    val installedAtMs: Long,
)

/** A resumed activity from Android's usage events. */
data class Resume(val packageName: String, val atMs: Long)

const val PLAY_STORE = "com.android.vending"

/** Never blocked whatever the snapshot says (docs/SPEC.md §12.4). Android does not protect Play services itself. */
val NEVER_BLOCKED = setOf("com.google.android.gms", "com.google.android.gsf", "com.android.settings")

/** A system app stays pre-installed even after an update from the Play Store. */
fun appSource(isSystem: Boolean, installer: String?): AppSource = when {
    isSystem -> AppSource.PREINSTALLED
    installer == PLAY_STORE -> AppSource.PLAY
    else -> AppSource.OTHER
}

/** The server's limit is 80 characters, and an app with no name still needs one. */
fun appLabel(label: String, packageName: String): String = label.trim().ifEmpty { packageName }.take(80)

/**
 * [known] with the first use of every package in [resumes] that it does not have yet. The earliest resume wins. Apps
 * in [ignored] (the launcher) are never reported.
 */
fun withFirstUses(known: Map<String, Long>, resumes: List<Resume>, ignored: Set<String>): Map<String, Long> {
    val out = known.toMutableMap()
    for (r in resumes) {
        if (r.packageName in ignored || r.packageName in known) continue
        val seen = out[r.packageName]
        if (seen == null || r.atMs < seen) out[r.packageName] = r.atMs
    }
    return out
}

private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

/**
 * The body of `PUT /v1/device/apps`, in package order so the same list always looks the same: the service only sends
 * it when it changed. Null when there is nothing to send (the server wants at least one app).
 */
fun appListBody(apps: List<InstalledApp>, firstUses: Map<String, Long>, protected: Set<String>): DeviceAppsPut? {
    if (apps.isEmpty()) return null
    return DeviceAppsPut(
        apps.distinctBy { it.packageName }.sortedBy { it.packageName }.map { a ->
            DeviceAppIn(
                `package` = a.packageName,
                label = appLabel(a.label, a.packageName),
                source = appSource(a.isSystem, a.installer),
                installer = a.installer?.take(255),
                blockable = a.packageName !in protected && a.packageName !in NEVER_BLOCKED,
                installedAt = iso(a.installedAtMs),
                firstUsedAt = firstUses[a.packageName]?.let(::iso),
            )
        },
    )
}
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/apps/AppWatcher.kt`

```kotlin
package au.screentime.kid.apps

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Process
import android.provider.Telephony
import android.telecom.TelecomManager
import android.util.Log
import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceAppsPut
import kotlinx.coroutines.CancellationException

/**
 * The app list and first use (docs/SPEC.md §12.4). Only the service uses it, one call at a time. What the device knows
 * is kept in SharedPreferences, so a restart neither forgets a first use nor sends an unchanged list again.
 */
class AppWatcher(context: Context, private val api: ApiClient, private val now: () -> Long = System::currentTimeMillis) {
    private val context = context.applicationContext
    private val pm = this.context.packageManager
    private val prefs = this.context.getSharedPreferences("apps", Context.MODE_PRIVATE)
    private val firstUsePrefs = this.context.getSharedPreferences("apps_first_use", Context.MODE_PRIVATE)
    private var warned = false

    /** Reads new usage events. Sends the list if an app was used for the first time. */
    suspend fun tick() {
        if (readUsage()) send()
    }

    /** Looks at the installed apps and sends the list if anything changed, or if the last send failed. False when it could not reach the server. */
    suspend fun send(): Boolean {
        readUsage()
        val body = appListBody(installed(), firstUses(), protectedPackages()) ?: return true
        val text = ApiJson.encodeToString(DeviceAppsPut.serializer(), body)
        if (text == prefs.getString(SENT, null)) return true
        try {
            api.putDeviceApps(body)
            Log.i(TAG, "apps: sent ${body.apps.size}")
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            // Refused now, refused next time: the list goes again when it changes.
            Log.w(TAG, "apps: refused (${e.status})")
        } catch (e: Exception) {
            // No connection: the next sync tries again.
            Log.i(TAG, "apps: not sent")
            return false
        }
        prefs.edit().putString(SENT, text).commit()
        return true
    }

    /** True when an app was used for the first time. */
    private fun readUsage(): Boolean {
        if (!hasUsageAccess()) {
            if (!warned) Log.w(TAG, "apps: no usage access, so first use is not seen")
            warned = true
            return false
        }
        warned = false
        val to = now()
        val from = prefs.getLong(READ_TO, to - HISTORY_MS)
        val known = firstUses()
        val updated = withFirstUses(known, resumes(from, to), ignored())
        prefs.edit().putLong(READ_TO, to).commit()
        val added = updated - known.keys
        if (added.isEmpty()) return false
        firstUsePrefs.edit().apply { added.forEach { (pkg, at) -> putLong(pkg, at) } }.commit()
        return true
    }

    private fun firstUses(): Map<String, Long> =
        firstUsePrefs.all.mapNotNull { (pkg, at) -> (at as? Long)?.let { pkg to it } }.toMap()

    private fun hasUsageAccess(): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }

    private fun resumes(from: Long, to: Long): List<Resume> {
        val events = context.getSystemService(UsageStatsManager::class.java).queryEvents(from, to)
        val event = UsageEvents.Event()
        val out = mutableListOf<Resume>()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) out += Resume(event.packageName, event.timeStamp)
        }
        return out
    }

    /** Every app with a launcher icon, except this one. */
    private fun installed(): List<InstalledApp> {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val packages = pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
            .map { it.activityInfo.packageName }
            .toSet() - context.packageName
        return packages.mapNotNull { name ->
            try {
                val info = pm.getPackageInfo(name, PackageManager.PackageInfoFlags.of(0))
                val app = info.applicationInfo ?: return@mapNotNull null
                InstalledApp(
                    packageName = name,
                    label = app.loadLabel(pm).toString(),
                    isSystem = app.flags and ApplicationInfo.FLAG_SYSTEM != 0,
                    installer = pm.getInstallSourceInfo(name).installingPackageName,
                    installedAtMs = info.firstInstallTime,
                )
            } catch (e: PackageManager.NameNotFoundException) {
                // Removed just now.
                null
            }
        }
    }

    private fun homePackage(): String? {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return pm.resolveActivity(home, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()))?.activityInfo?.packageName
    }

    private fun ignored(): Set<String> = setOfNotNull(homePackage(), context.packageName)

    /** The apps of this device the kid must keep: the launcher, and the phone and messaging apps SOS and calls need. */
    private fun protectedPackages(): Set<String> {
        val telecom = context.getSystemService(TelecomManager::class.java)
        return setOfNotNull(
            homePackage(),
            telecom?.defaultDialerPackage,
            telecom?.systemDialerPackage,
            Telephony.Sms.getDefaultSmsPackage(context),
            context.packageName,
        )
    }

    private companion object {
        const val TAG = "KidService"
        const val SENT = "sent"
        const val READ_TO = "readTo"

        /** The first read looks this far back, so apps already in use raise no alert. */
        const val HISTORY_MS = 7 * 24 * 60 * 60 * 1000L
    }
}
```

### 5.2 The tests: create these, exactly

#### `server/test/apps.test.ts`

```typescript
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { deviceApps, devices, events, families, kids, parentSessions, parents } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('apps', () => {
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

  let family = '';
  let otherFamily = '';
  let dad = '';
  let otherDad = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const tablet = { id: '', token: '' };
  const pc = { id: '', token: '' };

  const INSTALLED = '2026-11-03T06:00:00.000Z';

  function app(pkg: string, over: Record<string, unknown> = {}) {
    return { package: pkg, label: pkg.toUpperCase(), source: 'play', installer: null, blockable: true, installedAt: INSTALLED, firstUsedAt: null, ...over };
  }

  const put = (device: { token: string }, apps: unknown[]) => api.put('/v1/device/apps', device.token, { apps });

  async function kinds() {
    const rows = await db.select().from(events).where(eq(events.familyId, family));
    return rows.filter((e) => e.kind.startsWith('app.')).map((e) => ({ kind: e.kind, payload: e.payload, deviceId: e.deviceId, at: e.at }));
  }

  async function addDevice(familyId: string, kidId: string, platform: 'android' | 'windows', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
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

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
  });

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
    otherFamily = b.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    const [q] = await db.insert(parents).values({ familyId: otherFamily, email: 'bea@example.com', displayName: 'Bea' }).returning();
    if (!p || !q) throw new Error('no parent');
    dad = await signIn(family, p.id, 'dad-phone');
    otherDad = await signIn(otherFamily, q.id, 'bea-phone');
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    Object.assign(phone, await addDevice(family, kid, 'android', 'Pixel 7'));
    Object.assign(tablet, await addDevice(family, kid, 'android', 'XPPen'));
    Object.assign(pc, await addDevice(family, kid, 'windows', 'Alex on PC'));
  });

  it('takes the first list as a baseline: stored, with no event and no push', async () => {
    const res = await put(phone, [app('a.game'), app('b.used', { firstUsedAt: '2026-11-01T00:00:00Z', source: 'preinstalled' })]);
    expect(res.status).toBe(204);
    expect(await kinds()).toEqual([]);
    expect(sent).toEqual([]);
    const rows = await db.select().from(deviceApps).where(eq(deviceApps.deviceId, phone.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.baseline)).toBe(true);
    expect(rows.find((r) => r.package === 'b.used')?.firstUsedAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('writes app.installed and pushes it for an app new to the device', async () => {
    await put(phone, [app('a.game')]);
    await put(phone, [app('a.game'), app('b.game', { label: 'Block Blast' })]);
    const list = await kinds();
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe('app.installed');
    expect(list[0]?.deviceId).toBe(phone.id);
    expect(list[0]?.at.toISOString()).toBe(INSTALLED);
    expect(list[0]?.payload).toEqual({ package: 'b.game', label: 'Block Blast', source: 'play', deviceName: 'Pixel 7' });
    expect(sent.map((m) => m.token)).toEqual(['dad-phone']);
    const rows = await db.select().from(deviceApps).where(eq(deviceApps.package, 'b.game'));
    expect(rows[0]?.baseline).toBe(false);
  });

  it('writes app.first_used once, also for a pre-installed app of the baseline', async () => {
    await put(phone, [app('a.game', { source: 'preinstalled' })]);
    await put(phone, [app('a.game', { source: 'preinstalled', firstUsedAt: '2026-11-04T01:00:00Z' })]);
    await put(phone, [app('a.game', { source: 'preinstalled', firstUsedAt: '2026-11-04T01:00:00Z' })]);
    const list = await kinds();
    expect(list.map((e) => e.kind)).toEqual(['app.first_used']);
    expect(list[0]?.at.toISOString()).toBe('2026-11-04T01:00:00.000Z');
    expect(list[0]?.payload).toEqual({ package: 'a.game', label: 'A.GAME', deviceName: 'Pixel 7' });
  });

  it('writes both when a new app arrives already opened', async () => {
    await put(phone, [app('a.game')]);
    await put(phone, [app('a.game'), app('b.game', { firstUsedAt: '2026-11-04T01:00:00Z' })]);
    expect((await kinds()).map((e) => e.kind).sort()).toEqual(['app.first_used', 'app.installed']);
  });

  it('marks a missing app removed without an event, and alerts when it comes back, but not first use again', async () => {
    await put(phone, [app('a.game'), app('b.game', { firstUsedAt: '2026-11-01T00:00:00Z' })]);
    await put(phone, [app('a.game')]);
    expect(await kinds()).toEqual([]);
    const gone = await db.select().from(deviceApps).where(eq(deviceApps.package, 'b.game'));
    expect(gone[0]?.removedAt).not.toBeNull();

    await put(phone, [app('a.game'), app('b.game', { firstUsedAt: '2026-11-06T00:00:00Z', installedAt: '2026-11-05T00:00:00Z' })]);
    expect((await kinds()).map((e) => e.kind)).toEqual(['app.installed']);
    const back = await db.select().from(deviceApps).where(eq(deviceApps.package, 'b.game'));
    expect(back[0]?.removedAt).toBeNull();
    expect(back[0]?.firstUsedAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(back[0]?.installedAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });

  it('stores nothing as happening in the future', async () => {
    await put(phone, [app('a.game')]);
    await put(phone, [app('a.game'), app('b.game', { installedAt: '2099-01-01T00:00:00Z' })]);
    const list = await kinds();
    expect(list[0]?.at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('refuses a PC, a bad list and a missing token', async () => {
    expect((await put(pc, [app('a.game')])).status).toBe(409);
    expect((await put(phone, [])).status).toBe(422);
    expect((await put(phone, [app('a.game'), app('a.game')])).status).toBe(422);
    expect((await put(phone, [app('a.game', { source: 'pirate' })])).status).toBe(422);
    expect((await api.put('/v1/device/apps', null, { apps: [app('a.game')] })).status).toBe(401);
  });

  it('lists an app once across devices, for parents of the family only', async () => {
    await put(phone, [app('a.game', { firstUsedAt: '2026-11-04T01:00:00Z' }), app('com.android.settings', { blockable: false, source: 'preinstalled' })]);
    await put(tablet, [app('a.game')]);
    const res = await api.get(`/v1/kids/${kid}/apps`, dad);
    expect(res.status).toBe(200);
    const body = res.body as {
      newAppApproval: boolean;
      apps: { package: string; blockable: boolean; todaySeconds: number; devices: { deviceName: string; firstUsedAt: string | null }[] }[];
    };
    expect(body.newAppApproval).toBe(false);
    expect(body.apps.map((a) => a.package)).toEqual(['a.game', 'com.android.settings']);
    expect(body.apps[0]?.devices.map((d) => [d.deviceName, d.firstUsedAt])).toEqual([
      ['Pixel 7', '2026-11-04T01:00:00.000Z'],
      ['XPPen', null],
    ]);
    expect(body.apps[0]?.todaySeconds).toBe(0);
    expect(body.apps[1]?.blockable).toBe(false);
    expect((await api.get(`/v1/kids/${kid}/apps`, otherDad)).status).toBe(404);
    expect((await api.get(`/v1/kids/${randomUUID()}/apps`, dad)).status).toBe(404);
    expect((await api.get(`/v1/kids/${kid}/apps`, null)).status).toBe(401);
  });

  it('leaves out a revoked device', async () => {
    await put(phone, [app('a.game')]);
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, phone.id));
    const res = await api.get(`/v1/kids/${kid}/apps`, dad);
    expect((res.body as { apps: unknown[] }).apps).toEqual([]);
  });

  it('respects a muted kind: stored, not pushed', async () => {
    const muted = await api.put('/v1/me/notification-prefs', dad, [{ kind: 'app.installed', enabled: false }]);
    expect(muted.status).toBe(200);
    await put(phone, [app('a.game')]);
    await put(phone, [app('a.game'), app('b.game')]);
    expect((await kinds()).map((e) => e.kind)).toEqual(['app.installed']);
    expect(sent).toEqual([]);
  });
});
```

#### `android/app-kid/src/test/kotlin/au/screentime/kid/apps/AppsTest.kt`

```kotlin
package au.screentime.kid.apps

import au.screentime.core.model.api.AppSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The pure part of the app list and first use (docs/SPEC.md §12.4). */
class AppsTest {
    private fun app(name: String, label: String = name, isSystem: Boolean = false, installer: String? = null, at: Long = 0) =
        InstalledApp(name, label, isSystem, installer, at)

    @Test
    fun aSystemAppIsPreinstalledEvenWhenPlayUpdatedIt() {
        assertEquals(AppSource.PREINSTALLED, appSource(isSystem = true, installer = null))
        assertEquals(AppSource.PREINSTALLED, appSource(isSystem = true, installer = "com.android.vending"))
    }

    @Test
    fun anotherAppComesFromPlayOrSomewhereElse() {
        assertEquals(AppSource.PLAY, appSource(isSystem = false, installer = "com.android.vending"))
        assertEquals(AppSource.OTHER, appSource(isSystem = false, installer = null))
        assertEquals(AppSource.OTHER, appSource(isSystem = false, installer = "com.android.shell"))
    }

    @Test
    fun aLabelIsNeverEmptyOrTooLong() {
        assertEquals("Game", appLabel("  Game ", "a.b"))
        assertEquals("a.b", appLabel("   ", "a.b"))
        assertEquals(80, appLabel("x".repeat(200), "a.b").length)
    }

    @Test
    fun firstUseIsTheEarliestResumeAndNeverMoves() {
        val out = withFirstUses(
            known = mapOf("old" to 5L),
            resumes = listOf(Resume("new", 30), Resume("new", 20), Resume("old", 1), Resume("other", 40)),
            ignored = emptySet(),
        )
        assertEquals(mapOf("old" to 5L, "new" to 20L, "other" to 40L), out)
    }

    @Test
    fun theLauncherIsNeverReported() {
        assertEquals(emptyMap<String, Long>(), withFirstUses(emptyMap(), listOf(Resume("launcher", 1)), setOf("launcher")))
    }

    @Test
    fun theBodyIsInPackageOrderSoTheSameListLooksTheSame() {
        val a = appListBody(listOf(app("b"), app("a")), emptyMap(), emptySet())
        val b = appListBody(listOf(app("a"), app("b")), emptyMap(), emptySet())
        assertEquals(a, b)
        assertEquals(listOf("a", "b"), a?.apps?.map { it.`package` })
    }

    @Test
    fun theBodyCarriesTimesAsUtc() {
        val body = appListBody(listOf(app("a", at = 1_793_000_000_000)), mapOf("a" to 1_793_000_060_000), emptySet())
        assertEquals("2026-10-26T07:33:20Z", body?.apps?.single()?.installedAt)
        assertEquals("2026-10-26T07:34:20Z", body?.apps?.single()?.firstUsedAt)
        assertNull(appListBody(listOf(app("b")), mapOf("a" to 1L), emptySet())?.apps?.single()?.firstUsedAt)
    }

    @Test
    fun whatTheDeviceNeedsCannotBeBlocked() {
        val names = listOf("a.game", "com.google.android.gms", "com.android.settings", "the.launcher")
        val body = appListBody(names.map { app(it) }, emptyMap(), setOf("the.launcher"))!!
        val blockable = body.apps.associate { it.`package` to it.blockable }
        assertTrue(blockable.getValue("a.game"))
        assertFalse(blockable.getValue("com.google.android.gms"))
        assertFalse(blockable.getValue("com.android.settings"))
        assertFalse(blockable.getValue("the.launcher"))
    }

    @Test
    fun nothingToSendWhenThereAreNoApps() {
        assertNull(appListBody(emptyList(), emptyMap(), emptySet()))
    }
}
```

### 5.3 Change these, exactly as in each diff

Lines with `+` are added and lines with `-` are removed. The surrounding lines show where.

#### `packages/schemas/src/index.ts`

```diff
@@ -96,2 +96,3 @@ export {
   SosStatus,
 } from './sos.js';
+export { AppSource, DeviceAppIn, DeviceAppsPut, KidApp, KidAppDevice, KidApps } from './apps.js';
```

#### `packages/schemas/src/notify.ts`

```diff
@@ -15,4 +15,6 @@ export const NotificationKind = z
     'kid_message',
     'overspend',
+    'app.installed',
+    'app.first_used',
     'device.offline',
     'device.enrolled',
```

#### `server/src/app.ts`

```diff
@@ -22,4 +22,5 @@ import { createRouter } from './router.js';
 import { registerSosRoutes } from './sos/routes.js';
 import { registerSyncRoutes } from './sync/routes.js';
+import { registerAppRoutes } from './apps/routes.js';
 import { registerTamperRoutes } from './tamper/routes.js';
 import { registerWeb } from './web.js';
@@ -96,4 +97,5 @@ export function createApp(appDeps: AppDeps) {
   registerParentModeRoutes(app, deps);
   registerTamperRoutes(app, deps);
+  registerAppRoutes(app, deps);
   registerSosRoutes(app, deps);
   registerNotifyRoutes(app, deps);
```

#### `server/src/notify/routes.ts`

```diff
@@ -98,4 +98,6 @@ const KIND_NAME: Record<NotificationKind, string> = {
   kid_message: 'Messages',
   overspend: 'Offline overspend',
+  'app.installed': 'New apps',
+  'app.first_used': 'Apps used for the first time',
   'device.offline': 'Device offline',
   'device.enrolled': 'Device added',
```

#### `server/src/db/schema.ts`

```diff
@@ -425,2 +425,27 @@ export const events = pgTable(
   (t) => [index('events_family_at_idx').on(t.familyId, t.at)],
 );
+
+/** The apps of one Android device (docs/SPEC.md §12.4). */
+export const deviceApps = pgTable(
+  'device_apps',
+  {
+    familyId: familyId(),
+    kidId: uuid('kid_id')
+      .notNull()
+      .references(() => kids.id),
+    deviceId: uuid('device_id')
+      .notNull()
+      .references(() => devices.id),
+    package: text('package').notNull(),
+    label: text('label').notNull(),
+    source: text('source').notNull(),
+    installer: text('installer'),
+    blockable: boolean('blockable').notNull(),
+    installedAt: ts('installed_at').notNull(),
+    firstSeenAt: ts('first_seen_at').notNull(),
+    firstUsedAt: ts('first_used_at'),
+    removedAt: ts('removed_at'),
+    baseline: boolean('baseline').notNull(),
+  },
+  (t) => [primaryKey({ columns: [t.deviceId, t.package] }), index('device_apps_kid_idx').on(t.kidId)],
+);
```

#### `server/test/csharp-client.test.ts`

```diff
@@ -17,5 +17,5 @@ describe('C# API client', () => {
 
   it('has one method for every device operation and none for the parent ones', () => {
-    expect(client.match(/^ {4}public Task/gm)).toHaveLength(14);
+    expect(client.match(/^ {4}public Task/gm)).toHaveLength(15);
     expect(client).toContain(
       '    public Task<EnrolResponse> PostEnrolAsync(EnrolRequest body, CancellationToken cancellationToken = default) =>\n' +
```

#### `server/test/db.test.ts`

```diff
@@ -33,4 +33,5 @@ describe.skipIf(!url)('database', () => {
     );
     expect(result.rows.map((r) => r.table_name).sort()).toEqual([
+      'device_apps',
       'devices',
       'enrolment_codes',
```

#### `server/test/notify.test.ts`

```diff
@@ -185,5 +185,5 @@ describe.skipIf(!url)('notifications', () => {
       const res = await api.get('/v1/me/notification-prefs', dad);
       expect(res.status).toBe(200);
-      expect(res.body).toHaveLength(10);
+      expect(res.body).toHaveLength(12);
       expect(res.body.every((p: { enabled: boolean }) => p.enabled)).toBe(true);
       expect(res.body.filter((p: { essential: boolean }) => p.essential).map((p: { kind: string }) => p.kind)).toEqual([
```

#### `android/app-kid/src/main/AndroidManifest.xml`

```diff
@@ -3,4 +3,10 @@
 
     <uses-permission android:name="android.permission.INTERNET" />
+    <!--
+        The app list and first use (docs/SPEC.md §12.4). Device Owner cannot grant usage access, so setup gives it
+        with adb. The app is not on the Play Store, so its rules on these two do not apply.
+    -->
+    <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" />
+    <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" />
     <!-- Scanning the enrolment QR code. Device Owner grants it, so the kid is never asked (docs/SPEC.md §12.1). -->
     <uses-permission android:name="android.permission.CAMERA" />
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

```diff
@@ -49,4 +49,5 @@ import au.screentime.kid.sync.Syncer
 import au.screentime.kid.sync.TrustedClock
 import au.screentime.kid.tamper.CaughtActivity
+import au.screentime.kid.apps.AppWatcher
 import au.screentime.kid.tamper.TamperApi
 import au.screentime.kid.tamper.TamperStore
@@ -102,4 +103,5 @@ class KidService : Service() {
     private lateinit var tamper: TamperStore
     private var tamperApi: TamperApi? = null
+    private var apps: AppWatcher? = null
     private var kidName = ""
     private var engine: HttpClientEngine? = null
@@ -157,4 +159,14 @@ class KidService : Service() {
     }
 
+    /** An app was installed or removed (docs/SPEC.md §12.4). A reinstall that replaces it is not news. */
+    private val packages = object : BroadcastReceiver() {
+        override fun onReceive(context: Context, intent: Intent) {
+            if (intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)) return
+            Log.i(TAG, "apps: ${intent.action} ${intent.data?.schemeSpecificPart}")
+            // No connection: the network callback syncs when it is back, and the sync sends the list.
+            scope.launch { if (apps?.send() == false) lastSyncOk = false }
+        }
+    }
+
     private val network = object : ConnectivityManager.NetworkCallback() {
         override fun onAvailable(network: Network) {
@@ -195,4 +207,5 @@ class KidService : Service() {
         tamper = TamperStore(this)
         tamperApi = TamperApi(client)
+        apps = AppWatcher(this, client)
         kidName = enrolment.kidName
         sos.resume()
@@ -213,4 +226,10 @@ class KidService : Service() {
         }
         registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED)
+        val packageFilter = IntentFilter().apply {
+            addAction(Intent.ACTION_PACKAGE_ADDED)
+            addAction(Intent.ACTION_PACKAGE_REMOVED)
+            addDataScheme("package")
+        }
+        registerReceiver(packages, packageFilter, Context.RECEIVER_NOT_EXPORTED)
         getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(network)
         started = true
@@ -232,5 +251,6 @@ class KidService : Service() {
                 val untilNext = (nextCheckAt - clock.nowMs()).coerceIn(SECOND, MINUTE)
                 val normal = when {
-                    inUse() || (paused && screenOn()) -> untilNext
+                    inUse() -> minOf(untilNext, APP_TICK_MS)
+                    paused && screenOn() -> untilNext
                     blocked && screenOn() -> if (live?.connected == true) untilNext else minOf(untilNext, BLOCKED_POLL)
                     else -> MINUTE
@@ -245,4 +265,5 @@ class KidService : Service() {
                 when {
                     inUse() -> {
+                        apps?.tick()
                         recorder.tick(clock.nowMs())
                         if (SystemClock.elapsedRealtime() - lastSyncElapsed >= 5 * MINUTE) sync() else report()
@@ -297,4 +318,5 @@ class KidService : Service() {
         if (started) {
             unregisterReceiver(screen)
+            unregisterReceiver(packages)
             getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(network)
         }
@@ -447,4 +469,5 @@ class KidService : Service() {
             if (sos.pending) sos.tick()
             sendTamper()
+            apps?.send()
             val ok = syncer.sync()
             lastSyncElapsed = SystemClock.elapsedRealtime()
@@ -545,4 +568,7 @@ class KidService : Service() {
         private const val BLOCKED_POLL = 30_000L
 
+        /** How often usage events are read while in use: a first use shows within this (docs/SPEC.md §12.4). */
+        private const val APP_TICK_MS = 30_000L
+
         /** Sent segments are kept this long, then forgotten (docs/SPEC.md §8.3, offline buffer). */
         private const val KEEP_DAYS = 30L
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/push/Push.kt`

```diff
@@ -36,5 +36,5 @@ fun channelFor(kind: String): String = when {
     kind.startsWith("sos.") -> CHANNEL_CRITICAL
     kind.startsWith("tamper.") || kind.startsWith("parent_mode.") -> CHANNEL_ALERTS
-    kind == "time_request" || kind == "kid_message" -> CHANNEL_REQUESTS
+    kind == "time_request" || kind == "kid_message" || kind.startsWith("app.") -> CHANNEL_REQUESTS
     else -> CHANNEL_INFO
 }
```

#### `android/app-parent/src/test/kotlin/au/screentime/parent/push/PushTest.kt`

```diff
@@ -44,4 +44,6 @@ class PushTest {
         assertEquals("info", channelFor("device.enrolled"))
         assertEquals("info", channelFor("overspend"))
+        assertEquals("requests", channelFor("app.installed"))
+        assertEquals("requests", channelFor("app.first_used"))
     }
```

The seams of the front end. These are the only changes you make to Claude's files:

#### `android/app-parent/src/main/kotlin/au/screentime/parent/kids/Apps.kt`

```diff
@@ -83,17 +83,14 @@ fun sortApps(apps: List<KidApp>): List<KidApp> {
 }
 
-/** Fake data behind [KidsViewModel.apps] until CARD-056 connects the server. */
-internal fun fakeKidApps(): List<KidApp> {
-    fun device(installedAt: String, firstUsedAt: String?, removedAt: String? = null, name: String = "Pixel 7") =
-        KidAppDevice(name, installedAt, firstUsedAt, removedAt)
-    return listOf(
-        KidApp("com.example.blockblast", "Block Blast", AppSource.PLAY, 2700, listOf(device("2026-11-03T06:12:00Z", "2026-11-03T06:14:00Z"))),
-        KidApp("com.example.subwayrun", "Subway Run", AppSource.PLAY, 0, listOf(device("2026-11-03T06:02:00Z", null))),
-        KidApp("com.example.oldgame", "Word Stack", AppSource.OTHER, 0, listOf(device("2026-10-20T03:00:00Z", "2026-10-20T03:10:00Z", "2026-11-01T03:00:00Z"))),
-        KidApp(
-            "com.google.android.youtube", "YouTube", AppSource.PREINSTALLED, 720,
-            listOf(device("2026-01-10T00:00:00Z", "2026-10-28T07:30:00Z"), device("2026-01-11T00:00:00Z", "2026-10-30T07:30:00Z", name = "XPPen tablet")),
-        ),
-        KidApp("com.google.android.apps.bard", "Gemini", AppSource.PREINSTALLED, 0, listOf(device("2026-01-10T00:00:00Z", null))),
-    )
-}
+/** The page's row for what the server sends. */
+fun appRow(app: au.screentime.core.model.api.KidApp): KidApp = KidApp(
+    packageName = app.`package`,
+    label = app.label,
+    source = when (app.source) {
+        au.screentime.core.model.api.AppSource.PREINSTALLED -> AppSource.PREINSTALLED
+        au.screentime.core.model.api.AppSource.PLAY -> AppSource.PLAY
+        au.screentime.core.model.api.AppSource.OTHER -> AppSource.OTHER
+    },
+    todaySeconds = app.todaySeconds,
+    devices = app.devices.map { KidAppDevice(it.deviceName, it.installedAt, it.firstUsedAt, it.removedAt) },
+)
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidsViewModel.kt`

```diff
@@ -119,6 +119,17 @@ class KidsViewModel(app: Application) : AndroidViewModel(app) {
     }
 
-    /** The seam for the Apps page: CARD-056 replaces this body with `GET /v1/kids/{kidId}/apps`. Fake data until then. */
-    suspend fun apps(kidId: String): Result<List<KidApp>> = Result.success(fakeKidApps())
+    /** A kid's apps for the Apps page; a failure is a [Result.failure] with the exception. */
+    suspend fun apps(kidId: String): Result<List<KidApp>> {
+        val deferred = viewModelScope.async {
+            try {
+                Result.success(session.call { getKidsApps(kidId) }.apps.map(::appRow))
+            } catch (e: CancellationException) {
+                throw e
+            } catch (e: Exception) {
+                Result.failure(e)
+            }
+        }
+        return deferred.await()
+    }
 
     /** Load a kid's always-callable numbers; a failure is a [Result.failure] with the exception. */
```

#### `web/src/lib/apps.ts`

```diff
@@ -1,63 +1,11 @@
+import type { KidApp, KidAppDevice, KidApps } from '@screentime/schemas';
+import { api } from '@/lib/auth';
 import { formatDuration } from '@/lib/format';
 
-/** How an app got onto the device (docs/SPEC.md §12.4). */
-export type AppSource = 'preinstalled' | 'play' | 'other';
+export type { KidApp, KidAppDevice, KidApps };
 
-export interface KidAppDevice {
-  deviceId: string;
-  deviceName: string;
-  installedAt: string;
-  firstUsedAt: string | null;
-  removedAt: string | null;
-}
-
-export interface KidApp {
-  package: string;
-  label: string;
-  source: AppSource;
-  blockable: boolean;
-  todaySeconds: number;
-  devices: KidAppDevice[];
-}
-
-export interface KidApps {
-  newAppApproval: boolean;
-  apps: KidApp[];
-}
-
-/** The seam: CARD-056 replaces this body with `GET /v1/kids/{kidId}/apps`. Fake data until then. */
-export async function fetchKidApps(_kidId: string): Promise<KidApps> {
-  // Never show made-up apps in a production build.
-  if (!import.meta.env.DEV) return { newAppApproval: false, apps: [] };
-  const device = (installedAt: string, firstUsedAt: string | null, removedAt: string | null = null): KidAppDevice => ({
-    deviceId: 'fake-phone',
-    deviceName: 'Pixel 7',
-    installedAt,
-    firstUsedAt,
-    removedAt,
-  });
-  const app = (pkg: string, label: string, source: AppSource, todaySeconds: number, d: KidAppDevice[]): KidApp => ({
-    package: pkg,
-    label,
-    source,
-    blockable: true,
-    todaySeconds,
-    devices: d,
-  });
-  return {
-    newAppApproval: false,
-    apps: [
-      app('com.example.blockblast', 'Block Blast', 'play', 2700, [device('2026-11-03T06:12:00Z', '2026-11-03T06:14:00Z')]),
-      app('com.example.subwayrun', 'Subway Run', 'play', 0, [device('2026-11-03T06:02:00Z', null)]),
-      app('com.example.oldgame', 'Word Stack', 'other', 0, [
-        device('2026-10-20T03:00:00Z', '2026-10-20T03:10:00Z', '2026-11-01T03:00:00Z'),
-      ]),
-      app('com.google.android.youtube', 'YouTube', 'preinstalled', 720, [
-        device('2026-01-10T00:00:00Z', '2026-10-28T07:30:00Z'),
-        { ...device('2026-01-11T00:00:00Z', '2026-10-30T07:30:00Z'), deviceId: 'fake-tablet', deviceName: 'XPPen tablet' },
-      ]),
-      app('com.google.android.apps.bard', 'Gemini', 'preinstalled', 0, [device('2026-01-10T00:00:00Z', null)]),
-    ],
-  };
+/** GET /v1/kids/{kidId}/apps (docs/SPEC.md §12.4). */
+export function fetchKidApps(kidId: string): Promise<KidApps> {
+  return api.get<KidApps>(`/v1/kids/${kidId}/apps`);
 }
```

#### `web/src/lib/settings.ts`

```diff
@@ -2,5 +2,5 @@ import type { NotificationKind } from '@screentime/schemas';
 
 /** What each notification switch means, in the words of docs/SPEC.md §13. The server sends the order. */
-export const NOTIFICATION_TEXT: Record<NotificationKind | 'app.installed' | 'app.first_used', { title: string; detail: string }> = {
+export const NOTIFICATION_TEXT: Record<NotificationKind, { title: string; detail: string }> = {
   sos: { title: 'SOS', detail: 'When a kid presses SOS on their phone, and every update after.' },
   'parent_mode.request': { title: 'Parent mode requests', detail: 'When a kid asks a parent to unlock a device.' },
```

### 5.4 The migration

After the `server/src/db/schema.ts` change, generate it from the repo root:

```powershell
pnpm --filter @screentime/schemas build
pnpm --filter @screentime/server exec drizzle-kit generate --name device_apps
```

That makes `server/drizzle/0005_device_apps.sql`, `server/drizzle/meta/0005_snapshot.json` and a new line in `server/drizzle/meta/_journal.json`. drizzle-kit does not write row-level security, so add these lines to the end of `0005_device_apps.sql`:

```sql
--> statement-breakpoint
ALTER TABLE device_apps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON device_apps
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
```

### 5.5 The generated files

After the schema and route changes, run `pnpm contract` from the repo root. It rewrites `contract/openapi.json`, `android/core-model/.../ApiClient.kt` and `ApiModels.kt`, and `windows/src/ScreenTime.Core/Api/ApiClient.g.cs` and `ApiModels.g.cs`. Commit them as they come, and never edit them by hand.

### 5.6 The guide

In `docs/guides/android-provisioning.md`, in the block that has `dpm set-device-owner`, add this line straight after it:

```powershell
& $adb shell cmd appops set au.screentime.kid GET_USAGE_STATS allow
```

and add this sentence after the sentence that starts "`-t` is needed": "The last command gives the app usage access, which Device Owner cannot grant: it is how the app sees the first use of each app."

### 5.7 The run script

`docs/cards/CARD-056-run.ps1` is already in the repo. Do not change it. Do not copy it anywhere.

## 6. Detailed spec

This is what the code above does, for your review and for the PR. `docs/SPEC.md` §12.4 is the full version.

- **The list** is every app with a launcher icon, except the kid app itself. `source` is `preinstalled` for a system app, `play` when the installer is `com.android.vending`, else `other`. `blockable` is false for the launcher, the phone apps, the default SMS app, Settings and Play services.
- **The device sends** the whole list with `PUT /v1/device/apps`: when an app is added or removed (a reinstall that replaces it does not count), at every sync, and when an app is used for the first time. An unchanged list is not sent. No connection: it is sent again at the next sync, which runs as soon as the network is back.
- **First use:** while in use the service reads Android's usage events at least every 30 s. Its first read looks back 7 days, so apps already in use raise nothing.
- **The server:** the first list of a device is the baseline and writes nothing. After that a package new to the device, or back after being removed, writes `app.installed` with payload `{ package, label, source, deviceName }`. A first `firstUsedAt` writes `app.first_used` with payload `{ package, label, deviceName }`, once per device, even after a reinstall. A missing package gets `removed_at`, with no event. A PC gets 409.
- **Parents:** `GET /v1/kids/{kidId}/apps` lists each app once, across the kid's devices that are not revoked. `app.installed` and `app.first_used` are informational notification kinds a parent can mute, on the `requests` channel.

## 7. Steps

1. Start the branch (section 10).
2. Create the files of 5.1 and 5.2, and make the changes of 5.3.
3. Do 5.4, then 5.5, then 5.6.
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
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
cd ..
git grep -l 'Â' -- packages server/src server/scripts server/test android/app-kid/src android/app-parent/src web/src
```

- [ ] `pnpm typecheck` and `pnpm build` pass. An error that `screentime_test` already exists is fine.
- [ ] `pnpm test` passes. The server's `test/apps.test.ts` shows 10 tests passed, and in the rehearsal the server had 238 passed and the web 60.
- [ ] `.\gradlew.bat assembleDebug test` says `BUILD SUCCESSFUL`, with `AppsTest` of the kid app at 9 tests. Check with `Select-String 'tests="' android\app-kid\build\test-results\testDebugUnitTest\TEST-au.screentime.kid.apps.AppsTest.xml`.
- [ ] The last `git grep` prints nothing. If it prints a file, you saved it in the wrong encoding: save it again as UTF-8 without a BOM.

### 8.2 On the emulator

Close what you can first: **the emulator froze on Claude's PC when memory ran out** (`adb` then hangs with no error). If that happens, stop the run with Ctrl+C, close other programs, and run it again. A rerun starts clean. Say so under Deviations.

From the repo root, in `pwsh`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
pwsh -File docs\cards\CARD-056-run.ps1 2>&1 | Tee-Object -FilePath ..\temp\card056-out.txt
```

It takes about 6 minutes. It **wipes the emulator and the development database, and replaces `deploy\.env` with throwaway values**. It needs the debug APKs from 8.1.

- [ ] The last line is `--- Finished with 0 failed.`, and no line starts with `FAIL`.
- [ ] Paste **all** of `..\temp\card056-out.txt` into the handback. A summary counts as `NOT RUN`.
- [ ] `..\temp\card056-apps.png` shows the real apps, and `..\temp\card056-inbox.png` shows "Alex installed ST Parent". Say what you see in each.

Not tested on the emulator, because it has no Google account: a real Play Store install, which should show "From Play Store". Do not try to sign in to Google. James tries this on a real device in the rollout.

### 8.3 What Claude saw

The same steps with the same code, in full. Times and ids will differ.

```text
--- 1. A wiped emulator
PASS no Screen Time app on the emulator
--- 2. A fresh server
Seeded family 01a1a955-f4bb-7fc1-be55-7e24e4bb34d8 with parent dad@example.com and kids Alex and Sam.
--- 3. Install, Device Owner, usage access. Clock is used before enrolment.
Success
  Device Owner on try 1
GET_USAGE_STATS: allow
--- 4. Enrol: the first list is a silent baseline
  seen after 1 s: com.android.settings
PASS the list reached the server
  apps: 20
  com.android.chrome | Chrome | preinstalled | installer=null | blockable=true | baseline=true | used=- | removed=-
  com.android.settings | Settings | preinstalled | installer=null | blockable=false | baseline=true | used=- | removed=-
  com.google.android.deskclock | Clock | preinstalled | installer=null | blockable=true | baseline=true | used=2026-11-05T01:32:28.884Z | removed=-
  com.google.android.dialer | Phone | preinstalled | installer=null | blockable=false | baseline=true | used=- | removed=-
  events: 0
PASS no events from the baseline
PASS Clock was already used, so it never alerts
PASS Chrome is pre-installed and never opened
PASS Settings cannot be blocked
PASS our own app is not on the list
--- 5. A new app raises app.installed
Success
  seen after 1 s: app.installed | au.screentime.parent |
PASS installed event
  au.screentime.parent | ST Parent | other | installer=null | blockable=true | baseline=false | used=- | removed=-
  events: 1
  app.installed | au.screentime.parent | {"label":"ST Parent","source":"other","package":"au.screentime.parent","deviceName":"Google sdk_gphone64_x86_64"}
PASS source is other, not baseline
  11-05 12:32:44.869  4908  5281 I KidService: apps: sent 20
  11-05 12:32:52.472  4908  4908 I KidService: apps: android.intent.action.PACKAGE_ADDED au.screentime.parent
  11-05 12:32:52.618  4908  5284 I KidService: apps: sent 21
--- 6. First use: the new app, then a pre-installed one
  seen after 18 s: app.first_used | au.screentime.parent |
PASS first use of the new app
  seen after 24 s: app.first_used | com.google.android.calendar |
PASS first use of a pre-installed app
  events: 3
  app.first_used | com.google.android.calendar | {"label":"Calendar","package":"com.google.android.calendar","deviceName":"Google sdk_gphone64_x86_64"}
  app.first_used | au.screentime.parent | {"label":"ST Parent","package":"au.screentime.parent","deviceName":"Google sdk_gphone64_x86_64"}
  app.installed | au.screentime.parent | {"label":"ST Parent","source":"other","package":"au.screentime.parent","deviceName":"Google sdk_gphone64_x86_64"}
PASS Clock raised nothing
PASS the launcher raised nothing
--- 7. An update of an app is not news
Success
PASS no new event
--- 8. Removed, then back
Success
  au.screentime.parent | ST Parent | other | installer=null | blockable=true | baseline=false | used=2026-11-05T01:32:57.306Z | removed=2026-11-05T01:34:42.582Z
PASS marked removed, with no event
Success
PASS back: a second app.installed
PASS back: first use stays one
PASS back: not removed
--- 9. Installed while the service was down
Success
Success
Success
Warning: Activity not started, its current task has been brought to the front
  au.screentime.parent | ST Parent | other | installer=null | blockable=true | baseline=false | used=2026-11-05T01:32:57.306Z | removed=2026-11-05T01:34:59.924Z
PASS the restart noticed it is gone
Success
Warning: Activity not started, intent has been delivered to currently running top-most instance.
PASS the restart noticed it is back
--- 10. No connection: sent when the network is back
Success
  11-05 12:35:28.864  4908  4908 I KidService: apps: android.intent.action.PACKAGE_REMOVED au.screentime.parent
  11-05 12:35:28.915  4908  5281 I KidService: apps: not sent
PASS offline: the server has not heard
  after 4 s: au.screentime.parent | ST Parent | other | installer=null | blockable=true | baseline=false | used=2026-11-05T01:32:57.306Z | removed=2026-11-05T01:35:36.430Z
PASS online: the server heard
--- 11. The parent app shows it
Success
  Alex's apps | S | ST Parent | Installed another way · 5 Nov on Google sdk_gphone64_x86_64 | First used 5 Nov | C | Calendar | Came with Google sdk_gphone64_x86_64 | First used 5 Nov | C | Camera | Came with Google sdk_gphone64_x86_64 | Never opened | C | Chrome | Came with Google sdk_gphone64_x86_64 | Never opened | C | Clock | Came with Google sdk_gphone64_x86_64 | First used 5 Nov | C | Contacts | Came with Google sdk_gphone64_x86_64 | Never opened | D | Drive | Came with Google sdk_gphone64_x86_64 | Never opened | F | Files | Came with Google sdk_gphone64_x86_64 | Never opened | Today | Inbox | Kids | Settings
PASS the page lists real apps
  Inbox | History | Today | 📱 | Alex installed ST Parent | Installed another way on Google sdk_gphone64_x86_64 | 12:35 pm | 📱 | Alex installed ST Parent | Installed another way on Google sdk_gphone64_x86_64 | 12:35 pm | 📱 | Alex installed ST Parent | Installed another way on Google sdk_gphone64_x86_64 | 12:34 pm | 📱 | Alex opened Calendar for the first time | On Google sdk_gphone64_x86_64 | 12:33 pm | 📱 | Alex opened ST Parent for the first time | On Google sdk_gphone64_x86_64 | 12:32 pm | 📱 | Alex installed ST Parent | Installed another way on Google sdk_gphone64_x86_64 | 12:32 pm | 📱 | Google sdk_gphone64_x86_64 was added for Alex | 12:32 pm | Today | Inbox | Kids | Settings
PASS the inbox has the words
--- Finished with 0 failed.
```

### 8.4 CI

- [ ] On the PR, **build and test**, **typecheck and test** and **docker compose smoke test** are all green.

## 9. Tests

- `server/test/apps.test.ts` (10 tests): the baseline is silent; `app.installed` and its push; `app.first_used` once, also for a baseline app; both together; removed and back; nothing in the future; a PC, a bad list and no token refused; one row per app across devices and family isolation; a revoked device left out; a muted kind stored but not pushed.
- `android/app-kid/.../apps/AppsTest.kt` (9 tests): source, label, first use, the launcher, body order, times in UTC, what cannot be blocked, an empty list.
- `web/test/apps.test.ts` and `android/app-parent/.../kids/AppsTest.kt` are already in the repo from PR #154 and must pass unchanged.
- `PushTest.kt` gains the `requests` channel for the app kinds. `csharp-client.test.ts`, `db.test.ts` and `notify.test.ts` change only by the counts and the table name in 5.3.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-056-app-list
   ```
2. Commit in small logical commits. Message format: `CARD-056: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-056-app-list`
5. Open a PR into `main` titled `CARD-056: App list and install and first-use alerts` with this body, written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-056-app-list.md

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
Claude, here is Bob's handback for CARD-056. Please review and merge if it is good.

CARD: CARD-056 App list and install and first-use alerts
PR: <full PR URL>
Branch: bob/card-056-app-list
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- pnpm typecheck -> <key lines, or NOT RUN: reason>
- pnpm test -> <test counts per package, or NOT RUN: reason>
- .\gradlew.bat assembleDebug test -> <result and the AppsTest line, or NOT RUN: reason>
- git grep for mangled characters -> <output, or NOT RUN: reason>
- pwsh -File docs\cards\CARD-056-run.ps1 -> <ALL of ..\temp\card056-out.txt, or NOT RUN: reason>
- The two screenshots -> <what each one shows, or NOT RUN: reason>
- CI -> <the three checks and their results, or NOT RUN: reason>

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
