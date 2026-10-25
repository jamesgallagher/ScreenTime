import { z } from 'zod';

/**
 * What a parent can be notified about (docs/SPEC.md §13). One kind can cover several event kinds:
 * `sos` is every `sos.*` event, `tamper` every `tamper.*` event, and `grant.by_other_parent` is a
 * `grant.added` event made by another parent.
 */
export const NotificationKind = z
  .enum([
    'sos',
    'tamper',
    'parent_mode.request',
    'parent_mode.used',
    'time_request',
    'kid_message',
    'overspend',
    'device.offline',
    'device.enrolled',
    'grant.by_other_parent',
  ])
  .meta({ id: 'NotificationKind' });

export type NotificationKind = z.infer<typeof NotificationKind>;

/** Kinds that cannot be turned off: SOS and every request that waits for a parent's answer. */
export const ESSENTIAL_KINDS: readonly NotificationKind[] = ['sos', 'parent_mode.request', 'time_request'];

export const NotificationPref = z
  .object({
    kind: NotificationKind,
    enabled: z.boolean(),
    /** Always on; `enabled` is then always true. */
    essential: z.boolean(),
  })
  .meta({ id: 'NotificationPref' });

export type NotificationPref = z.infer<typeof NotificationPref>;

/** Body of PUT /v1/me/notification-prefs. Kinds left out keep their setting. */
export const NotificationPrefsPut = z
  .array(z.object({ kind: NotificationKind, enabled: z.boolean() }))
  .min(1)
  .max(NotificationKind.options.length)
  .refine((prefs) => new Set(prefs.map((p) => p.kind)).size === prefs.length, { message: 'Each kind may appear only once.' })
  .meta({ id: 'NotificationPrefsPut' });

export type NotificationPrefsPut = z.infer<typeof NotificationPrefsPut>;

/** Body of PUT /v1/me/push-token and PUT /v1/device/push-token. null stops pushes to this app. */
export const PushTokenPut = z
  .object({ fcmToken: z.string().min(1).max(4096).nullable() })
  .meta({ id: 'PushTokenPut' });

export type PushTokenPut = z.infer<typeof PushTokenPut>;

/** One entry of the event history (docs/SPEC.md §6.1 events, §13). */
export const EventItem = z
  .object({
    id: z.uuid(),
    /** The event kind, for example `grant.added`, `overspend` or `sos.started`. */
    kind: z.string(),
    at: z.iso.datetime(),
    kidId: z.uuid().nullable(),
    kidName: z.string().nullable(),
    deviceId: z.uuid().nullable(),
    deviceName: z.string().nullable(),
    /** What happened. Its fields depend on `kind`. */
    payload: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'EventItem' });

export type EventItem = z.infer<typeof EventItem>;

/** GET /v1/events. */
export const EventPage = z
  .object({
    /** Newest first. */
    events: z.array(EventItem),
    /** Pass as `before` to get the next, older page. null on the last page. */
    nextBefore: z.uuid().nullable(),
  })
  .meta({ id: 'EventPage' });

export type EventPage = z.infer<typeof EventPage>;

/**
 * Every push and WebSocket message (docs/SPEC.md §10). For FCM the whole envelope is one string data field
 * `msg`. To parents `type` is the notification kind and `data` the EventItem; to kid devices `type` is a
 * device message such as `grant_added`.
 */
export const Envelope = z
  .object({
    v: z.literal(1),
    type: z.string(),
    at: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'Envelope' });

export type Envelope = z.infer<typeof Envelope>;
