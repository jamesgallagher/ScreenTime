import { and, asc, eq, inArray, isNotNull, isNull, ne, type SQL, sql } from 'drizzle-orm';
import { ESSENTIAL_KINDS, type Envelope, type EventItem, NotificationKind, type Pool } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, grants, kids, notificationPrefs, parentSessions, parents } from '../db/schema.js';
import { CLOSE_REVOKED } from '../live/hub.js';
import type { PushMessage, Pusher } from '../push.js';

/** The notification kind of an event kind (docs/SPEC.md §13), or null for events that never notify. */
export function notificationKindOf(eventKind: string): NotificationKind | null {
  if (eventKind === 'grant.added') return 'grant.by_other_parent';
  if (eventKind.startsWith('sos.')) return 'sos';
  if (eventKind.startsWith('tamper.')) return 'tamper';
  const parsed = NotificationKind.safeParse(eventKind);
  return parsed.success ? parsed.data : null;
}

/** Events as the history shows them, with kid and device names. `where` picks the rows. */
export async function selectEvents(tx: FamilyTx, where: SQL | undefined, limit?: number) {
  const query = tx
    .select({
      id: events.id,
      kind: events.kind,
      at: events.at,
      kidId: events.kidId,
      kidName: kids.name,
      deviceId: events.deviceId,
      deviceName: devices.name,
      payload: events.payload,
    })
    .from(events)
    .leftJoin(kids, eq(kids.id, events.kidId))
    .leftJoin(devices, eq(devices.id, events.deviceId))
    .where(where)
    .orderBy(sql`${events.at} desc`, sql`${events.id} desc`);
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map(
    (r): EventItem => ({ ...r, at: r.at.toISOString(), payload: (r.payload ?? {}) as Record<string, unknown> }),
  );
}

/** Sends the messages and forgets every token FCM says is dead, so it is not tried again. */
async function sendAndForgetDead(db: Db, pusher: Pusher, familyId: string, messages: PushMessage[]) {
  if (messages.length === 0) return;
  const dead = await pusher.send(messages);
  if (dead.length === 0) return;
  await withFamily(db, familyId, async (tx) => {
    await tx.update(parentSessions).set({ fcmToken: null }).where(inArray(parentSessions.fcmToken, dead));
    await tx.update(devices).set({ fcmToken: null }).where(inArray(devices.fcmToken, dead));
  });
}

/**
 * Pushes committed events to the parents' Android apps (docs/SPEC.md §13). Call it after the transaction
 * that wrote the events has committed. Every signed-in parent app with a push token gets each event,
 * except kinds the parent turned off (essential kinds cannot be), and except their own time changes.
 * A push that fails is logged and dropped: the event is in the history either way.
 */
export async function notifyParents(deps: AppDeps, familyId: string, eventIds: string[]) {
  const { db, pusher } = deps;
  if (!pusher || eventIds.length === 0) return;
  try {
    const messages = await withFamily(db, familyId, async (tx) => {
      const items = await selectEvents(tx, inArray(events.id, eventIds));
      // The parent who made a grant does not need to hear about it.
      const authors = await tx
        .select({ eventId: events.id, parentId: grants.createdBy })
        .from(events)
        .innerJoin(grants, sql`${grants.id}::text = ${events.payload} ->> 'grantId'`)
        .where(and(inArray(events.id, eventIds), eq(events.kind, 'grant.added')));
      const sessions = await tx
        .select({ parentId: parentSessions.parentId, token: parentSessions.fcmToken })
        .from(parentSessions)
        .innerJoin(parents, eq(parents.id, parentSessions.parentId))
        .where(and(isNull(parentSessions.revokedAt), isNotNull(parentSessions.fcmToken), isNull(parents.disabledAt)))
        .orderBy(asc(parentSessions.createdAt));
      const muted = await tx
        .select({ parentId: notificationPrefs.parentId, kind: notificationPrefs.kind })
        .from(notificationPrefs)
        .where(eq(notificationPrefs.enabled, false));

      const out: PushMessage[] = [];
      for (const item of items) {
        const kind = notificationKindOf(item.kind);
        if (!kind) continue;
        const essential = ESSENTIAL_KINDS.includes(kind);
        const author = authors.find((a) => a.eventId === item.id)?.parentId;
        const msg: Envelope = { v: 1, type: kind, at: item.at, data: item };
        for (const session of sessions) {
          if (!session.token || session.parentId === author) continue;
          if (!essential && muted.some((m) => m.parentId === session.parentId && m.kind === kind)) continue;
          out.push({ token: session.token, msg, high: essential });
        }
      }
      return out;
    });
    await sendAndForgetDead(db, pusher, familyId, messages);
  } catch (err) {
    console.error('push to parents failed', err);
  }
}

/** Which of a family's devices a message is for. Every field left out matches all. */
export interface DeviceTarget {
  kidId?: string;
  pool?: Pool;
  deviceId?: string;
  /** Leave this device out, for example the one whose upload caused the change. */
  exceptDeviceId?: string;
}

/** How to send by FCM as well: priority, and how long FCM keeps trying. */
export interface FcmOptions {
  high: boolean;
  ttlSec: number;
}

/**
 * Sends one message to a family's kid devices that are not revoked (docs/SPEC.md §8.3, §10): by WebSocket
 * to every one connected now, and, when `fcm` is given, by FCM to the Android ones with a push token.
 * Call it after the change has committed. Failures are logged: devices also pick changes up on sync.
 */
export async function sendToDevices(
  deps: AppDeps,
  familyId: string,
  target: DeviceTarget,
  msg: Envelope,
  fcm: FcmOptions | null,
) {
  const { db, pusher, hub } = deps;
  try {
    const rows = await withFamily(db, familyId, (tx) =>
      tx
        .select({ id: devices.id, platform: devices.platform, token: devices.fcmToken })
        .from(devices)
        .where(
          and(
            isNull(devices.revokedAt),
            target.kidId ? eq(devices.kidId, target.kidId) : undefined,
            target.pool ? eq(devices.pool, target.pool) : undefined,
            target.deviceId ? eq(devices.id, target.deviceId) : undefined,
            target.exceptDeviceId ? ne(devices.id, target.exceptDeviceId) : undefined,
          ),
        )
        .orderBy(asc(devices.enrolledAt)),
    );
    hub?.send(
      rows.map((r) => r.id),
      msg,
    );
    if (!fcm || !pusher) return;
    const messages = rows.flatMap((r) =>
      r.platform === 'android' && r.token ? [{ token: r.token, msg, high: fcm.high, ttlSec: fcm.ttlSec }] : [],
    );
    await sendAndForgetDead(db, pusher, familyId, messages);
  } catch (err) {
    console.error('push to kid devices failed', err);
  }
}

/** FCM keeps a `state_changed` for a day: by then the device has synced anyway. */
const STATE_CHANGED_TTL_SEC = 24 * 3600;

/**
 * Tells devices that their state snapshot changed, so they fetch it now (`state_changed`, docs/SPEC.md §10).
 * By WebSocket, and by FCM at normal priority unless `fcm` is false (usage uploads, which come every minute).
 */
export async function stateChanged(deps: AppDeps, familyId: string, target: DeviceTarget, fcm = true) {
  const msg: Envelope = { v: 1, type: 'state_changed', at: new Date().toISOString(), data: {} };
  await sendToDevices(deps, familyId, target, msg, fcm ? { high: false, ttlSec: STATE_CHANGED_TTL_SEC } : null);
}

/** Closes the WebSockets of devices that were just revoked. They get 401 if they try again. */
export function disconnectDevices(deps: AppDeps, deviceIds: string[]) {
  deps.hub?.close(deviceIds, CLOSE_REVOKED, 'This device is not enrolled.');
}
