import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Database schema: docs/SPEC.md §6.1.
 * Every table except `otp_codes` has `family_id` and row-level security (see drizzle/0002_rls.sql).
 * Server-generated ids default to `uuidv7()`. Ids that devices or apps generate offline have no default.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const familyId = () =>
  uuid('family_id')
    .notNull()
    .references(() => families.id);

const POOLS = sql`('screens', 'phone')`;
const FORMS = sql`('phone', 'tablet', 'pc')`;

export const families = pgTable('families', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  emergencyNumber: text('emergency_number').notNull().default('000'),
  parentCodeSecret: text('parent_code_secret').notNull(),
  createdAt: createdAt(),
  disabledAt: ts('disabled_at'),
});

export const parents = pgTable(
  'parents',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    phoneE164: text('phone_e164'),
    createdAt: createdAt(),
    disabledAt: ts('disabled_at'),
  },
  (t) => [
    uniqueIndex('parents_email_key').on(t.email),
    check('parents_email_lower', sql`${t.email} = lower(${t.email})`),
  ],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: ts('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_email_idx').on(t.email)],
);

export const parentSessions = pgTable(
  'parent_sessions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    // Both null for a super admin who is not a parent (docs/SPEC.md §6.2).
    parentId: uuid('parent_id').references(() => parents.id),
    familyId: uuid('family_id').references(() => families.id),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    client: text('client').notNull(),
    clientLabel: text('client_label').notNull(),
    fcmToken: text('fcm_token'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('parent_sessions_refresh_token_hash_key').on(t.refreshTokenHash),
    check('parent_sessions_client', sql`${t.client} in ('web', 'android')`),
    check('parent_sessions_parent_family', sql`(${t.parentId} is null) = (${t.familyId} is null)`),
  ],
);

export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    familyId: familyId(),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.id),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull(),
  },
  (t) => [primaryKey({ columns: [t.parentId, t.kind] })],
);

export const kids = pgTable(
  'kids',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    name: text('name').notNull(),
    avatarColor: text('avatar_color').notNull(),
    createdAt: createdAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    check(
      'kids_avatar_color',
      sql`${t.avatarColor} in ('#0F766E', '#7C3AED', '#DB2777', '#2563EB', '#EA580C', '#16A34A', '#CA8A04', '#475569')`,
    ),
  ],
);

export const kidContacts = pgTable('kid_contacts', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  familyId: familyId(),
  kidId: uuid('kid_id')
    .notNull()
    .references(() => kids.id),
  label: text('label').notNull(),
  phoneE164: text('phone_e164').notNull(),
  sort: integer('sort').notNull().default(0),
});

export const messagePresets = pgTable(
  'message_presets',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    text: text('text').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [check('message_presets_text_length', sql`char_length(${t.text}) between 1 and 160`)],
);

export const scheduleVersions = pgTable(
  'schedule_versions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    version: integer('version').notNull(),
    warn1Min: integer('warn1_min').notNull().default(15),
    warn2Min: integer('warn2_min').notNull().default(5),
    days: jsonb('days').notNull(),
    createdBy: uuid('created_by').references(() => parents.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('schedule_versions_kid_version_key').on(t.kidId, t.version),
    check('schedule_versions_warnings', sql`${t.warn1Min} > ${t.warn2Min} and ${t.warn2Min} >= 1 and ${t.warn1Min} <= 60`),
    check('schedule_versions_days', sql`jsonb_typeof(${t.days}) = 'array' and jsonb_array_length(${t.days}) = 7`),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    platform: text('platform').notNull(),
    form: text('form').notNull(),
    pool: text('pool').notNull(),
    name: text('name').notNull(),
    hasCellular: boolean('has_cellular').notNull().default(false),
    model: text('model'),
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    machineId: text('machine_id'),
    windowsUserSid: text('windows_user_sid'),
    windowsUserName: text('windows_user_name'),
    tokenHash: text('token_hash').notNull(),
    fcmToken: text('fcm_token'),
    enrolledAt: ts('enrolled_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('devices_token_hash_key').on(t.tokenHash),
    check('devices_platform', sql`${t.platform} in ('android', 'windows')`),
    check('devices_form', sql`${t.form} in ${FORMS}`),
    check('devices_pool', sql`${t.pool} in ${POOLS}`),
  ],
);

export const enrolmentCodes = pgTable(
  'enrolment_codes',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    form: text('form').notNull(),
    code: text('code').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => parents.id),
    createdAt: createdAt(),
    consumedAt: ts('consumed_at'),
    deviceId: uuid('device_id').references(() => devices.id),
  },
  (t) => [
    index('enrolment_codes_code_idx').on(t.code),
    check('enrolment_codes_form', sql`${t.form} in ${FORMS}`),
    check('enrolment_codes_code_format', sql`${t.code} ~ '^[0-9]{6}$'`),
  ],
);

export const timeRequests = pgTable(
  'time_requests',
  {
    id: uuid('id').primaryKey(),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    pool: text('pool').notNull(),
    minutes: integer('minutes').notNull(),
    reason: text('reason'),
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    resolvedBy: uuid('resolved_by').references(() => parents.id),
    resolvedAt: ts('resolved_at'),
    grantId: uuid('grant_id'),
  },
  (t) => [
    index('time_requests_kid_status_idx').on(t.kidId, t.status),
    check('time_requests_pool', sql`${t.pool} in ${POOLS}`),
    check('time_requests_minutes', sql`${t.minutes} in (15, 30, 60)`),
    check('time_requests_reason_length', sql`char_length(${t.reason}) <= 160`),
    check('time_requests_status', sql`${t.status} in ('pending', 'approved', 'denied', 'expired')`),
  ],
);

export const grants = pgTable(
  'grants',
  {
    id: uuid('id').primaryKey(),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    pool: text('pool').notNull(),
    minutes: integer('minutes').notNull(),
    day: date('day').notNull(),
    createdAt: createdAt(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => parents.id),
    requestId: uuid('request_id').references(() => timeRequests.id),
    note: text('note'),
  },
  (t) => [
    index('grants_kid_pool_day_idx').on(t.kidId, t.pool, t.day),
    check('grants_pool', sql`${t.pool} in ${POOLS}`),
    check('grants_minutes_nonzero', sql`${t.minutes} <> 0`),
  ],
);

export const usageSegments = pgTable(
  'usage_segments',
  {
    id: uuid('id').primaryKey(),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    pool: text('pool').notNull(),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
    recordedOffline: boolean('recorded_offline').notNull().default(false),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [
    index('usage_segments_kid_pool_started_idx').on(t.kidId, t.pool, t.startedAt),
    check('usage_segments_pool', sql`${t.pool} in ${POOLS}`),
    check('usage_segments_order', sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const kidMessages = pgTable(
  'kid_messages',
  {
    id: uuid('id').primaryKey(),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    body: text('body').notNull(),
    // Parents replace the preset list whenever they like; old messages keep their text and lose the link.
    presetId: uuid('preset_id').references(() => messagePresets.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [check('kid_messages_body_length', sql`char_length(${t.body}) between 1 and 160`)],
);

export const parentModeSessions = pgTable(
  'parent_mode_sessions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    method: text('method').notNull(),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    approvedBy: uuid('approved_by').references(() => parents.id),
    durationMin: integer('duration_min'),
    startedAt: ts('started_at'),
    endsAt: ts('ends_at'),
    endedAt: ts('ended_at'),
    endedBy: uuid('ended_by').references(() => parents.id),
  },
  (t) => [
    check('parent_mode_sessions_method', sql`${t.method} in ('push', 'code', 'remote')`),
    check('parent_mode_sessions_duration', sql`${t.durationMin} is null or ${t.durationMin} in (2, 5, 15, 60)`),
  ],
);

export const sosIncidents = pgTable(
  'sos_incidents',
  {
    id: uuid('id').primaryKey(),
    familyId: familyId(),
    kidId: uuid('kid_id')
      .notNull()
      .references(() => kids.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    startedAt: ts('started_at').notNull(),
    autoStopAt: ts('auto_stop_at').notNull(),
    endedAt: ts('ended_at'),
    endedByKind: text('ended_by_kind'),
    endedByParent: uuid('ended_by_parent').references(() => parents.id),
  },
  (t) => [
    check('sos_incidents_ended_by_kind', sql`${t.endedByKind} is null or ${t.endedByKind} in ('kid', 'parent', 'auto')`),
  ],
);

export const sosLocations = pgTable(
  'sos_locations',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    sosId: uuid('sos_id')
      .notNull()
      .references(() => sosIncidents.id),
    at: ts('at').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracyM: doublePrecision('accuracy_m'),
    batteryPct: smallint('battery_pct'),
    via: text('via').notNull(),
  },
  (t) => [
    index('sos_locations_sos_at_idx').on(t.sosId, t.at),
    check('sos_locations_via', sql`${t.via} in ('data', 'sms')`),
  ],
);

export const sosAcks = pgTable(
  'sos_acks',
  {
    familyId: familyId(),
    sosId: uuid('sos_id')
      .notNull()
      .references(() => sosIncidents.id),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.id),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sosId, t.parentId] })],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: familyId(),
    kidId: uuid('kid_id').references(() => kids.id),
    deviceId: uuid('device_id').references(() => devices.id),
    kind: text('kind').notNull(),
    at: ts('at').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('events_family_at_idx').on(t.familyId, t.at)],
);
