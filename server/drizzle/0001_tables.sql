CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"form" text NOT NULL,
	"pool" text NOT NULL,
	"name" text NOT NULL,
	"has_cellular" boolean DEFAULT false NOT NULL,
	"model" text,
	"os_version" text,
	"app_version" text,
	"machine_id" text,
	"windows_user_sid" text,
	"windows_user_name" text,
	"token_hash" text NOT NULL,
	"fcm_token" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "devices_platform" CHECK ("devices"."platform" in ('android', 'windows')),
	CONSTRAINT "devices_form" CHECK ("devices"."form" in ('phone', 'tablet', 'pc')),
	CONSTRAINT "devices_pool" CHECK ("devices"."pool" in ('screens', 'phone'))
);
--> statement-breakpoint
CREATE TABLE "enrolment_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"form" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"device_id" uuid,
	CONSTRAINT "enrolment_codes_form" CHECK ("enrolment_codes"."form" in ('phone', 'tablet', 'pc')),
	CONSTRAINT "enrolment_codes_code_format" CHECK ("enrolment_codes"."code" ~ '^[0-9]{6}$')
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid,
	"device_id" uuid,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"pool" text NOT NULL,
	"minutes" integer NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"request_id" uuid,
	"note" text,
	CONSTRAINT "grants_pool" CHECK ("grants"."pool" in ('screens', 'phone')),
	CONSTRAINT "grants_minutes_nonzero" CHECK ("grants"."minutes" <> 0)
);
--> statement-breakpoint
CREATE TABLE "kid_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"label" text NOT NULL,
	"phone_e164" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kid_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"body" text NOT NULL,
	"preset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kid_messages_body_length" CHECK (char_length("kid_messages"."body") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "kids" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"avatar_color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "kids_avatar_color" CHECK ("kids"."avatar_color" in ('#0F766E', '#7C3AED', '#DB2777', '#2563EB', '#EA580C', '#16A34A', '#CA8A04', '#475569'))
);
--> statement-breakpoint
CREATE TABLE "message_presets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"text" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "message_presets_text_length" CHECK (char_length("message_presets"."text") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"family_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "notification_prefs_parent_id_kind_pk" PRIMARY KEY("parent_id","kind")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_mode_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"method" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"duration_min" integer,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	CONSTRAINT "parent_mode_sessions_method" CHECK ("parent_mode_sessions"."method" in ('push', 'code', 'remote')),
	CONSTRAINT "parent_mode_sessions_duration" CHECK ("parent_mode_sessions"."duration_min" is null or "parent_mode_sessions"."duration_min" in (2, 5, 15, 60))
);
--> statement-breakpoint
CREATE TABLE "parent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"parent_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"client" text NOT NULL,
	"client_label" text NOT NULL,
	"fcm_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "parent_sessions_client" CHECK ("parent_sessions"."client" in ('web', 'android'))
);
--> statement-breakpoint
CREATE TABLE "parents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"phone_e164" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "parents_email_lower" CHECK ("parents"."email" = lower("parents"."email"))
);
--> statement-breakpoint
CREATE TABLE "schedule_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"warn1_min" integer DEFAULT 15 NOT NULL,
	"warn2_min" integer DEFAULT 5 NOT NULL,
	"days" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_versions_warnings" CHECK ("schedule_versions"."warn1_min" > "schedule_versions"."warn2_min" and "schedule_versions"."warn2_min" >= 1 and "schedule_versions"."warn1_min" <= 60),
	CONSTRAINT "schedule_versions_days" CHECK (jsonb_typeof("schedule_versions"."days") = 'array' and jsonb_array_length("schedule_versions"."days") = 7)
);
--> statement-breakpoint
CREATE TABLE "sos_acks" (
	"family_id" uuid NOT NULL,
	"sos_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sos_acks_sos_id_parent_id_pk" PRIMARY KEY("sos_id","parent_id")
);
--> statement-breakpoint
CREATE TABLE "sos_incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"auto_stop_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by_kind" text,
	"ended_by_parent" uuid,
	CONSTRAINT "sos_incidents_ended_by_kind" CHECK ("sos_incidents"."ended_by_kind" is null or "sos_incidents"."ended_by_kind" in ('kid', 'parent', 'auto'))
);
--> statement-breakpoint
CREATE TABLE "sos_locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"sos_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" double precision,
	"battery_pct" smallint,
	"via" text NOT NULL,
	CONSTRAINT "sos_locations_via" CHECK ("sos_locations"."via" in ('data', 'sms'))
);
--> statement-breakpoint
CREATE TABLE "time_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"pool" text NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"grant_id" uuid,
	CONSTRAINT "time_requests_pool" CHECK ("time_requests"."pool" in ('screens', 'phone')),
	CONSTRAINT "time_requests_minutes" CHECK ("time_requests"."minutes" in (15, 30, 60)),
	CONSTRAINT "time_requests_reason_length" CHECK (char_length("time_requests"."reason") <= 160),
	CONSTRAINT "time_requests_status" CHECK ("time_requests"."status" in ('pending', 'approved', 'denied', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "usage_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"pool" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"recorded_offline" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_segments_pool" CHECK ("usage_segments"."pool" in ('screens', 'phone')),
	CONSTRAINT "usage_segments_order" CHECK ("usage_segments"."ended_at" is null or "usage_segments"."ended_at" >= "usage_segments"."started_at")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment_codes" ADD CONSTRAINT "enrolment_codes_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment_codes" ADD CONSTRAINT "enrolment_codes_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment_codes" ADD CONSTRAINT "enrolment_codes_created_by_parents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment_codes" ADD CONSTRAINT "enrolment_codes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_created_by_parents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_request_id_time_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."time_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_contacts" ADD CONSTRAINT "kid_contacts_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_contacts" ADD CONSTRAINT "kid_contacts_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_messages" ADD CONSTRAINT "kid_messages_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_messages" ADD CONSTRAINT "kid_messages_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_messages" ADD CONSTRAINT "kid_messages_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_messages" ADD CONSTRAINT "kid_messages_preset_id_message_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."message_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kids" ADD CONSTRAINT "kids_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_presets" ADD CONSTRAINT "message_presets_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_mode_sessions" ADD CONSTRAINT "parent_mode_sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_mode_sessions" ADD CONSTRAINT "parent_mode_sessions_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_mode_sessions" ADD CONSTRAINT "parent_mode_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_mode_sessions" ADD CONSTRAINT "parent_mode_sessions_approved_by_parents_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_mode_sessions" ADD CONSTRAINT "parent_mode_sessions_ended_by_parents_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_sessions" ADD CONSTRAINT "parent_sessions_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_sessions" ADD CONSTRAINT "parent_sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parents" ADD CONSTRAINT "parents_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_created_by_parents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_acks" ADD CONSTRAINT "sos_acks_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_acks" ADD CONSTRAINT "sos_acks_sos_id_sos_incidents_id_fk" FOREIGN KEY ("sos_id") REFERENCES "public"."sos_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_acks" ADD CONSTRAINT "sos_acks_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_ended_by_parent_parents_id_fk" FOREIGN KEY ("ended_by_parent") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_locations" ADD CONSTRAINT "sos_locations_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_locations" ADD CONSTRAINT "sos_locations_sos_id_sos_incidents_id_fk" FOREIGN KEY ("sos_id") REFERENCES "public"."sos_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_requests" ADD CONSTRAINT "time_requests_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_requests" ADD CONSTRAINT "time_requests_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_requests" ADD CONSTRAINT "time_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_requests" ADD CONSTRAINT "time_requests_resolved_by_parents_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_segments" ADD CONSTRAINT "usage_segments_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_segments" ADD CONSTRAINT "usage_segments_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_segments" ADD CONSTRAINT "usage_segments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_hash_key" ON "devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "enrolment_codes_code_idx" ON "enrolment_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "events_family_at_idx" ON "events" USING btree ("family_id","at");--> statement-breakpoint
CREATE INDEX "grants_kid_pool_day_idx" ON "grants" USING btree ("kid_id","pool","day");--> statement-breakpoint
CREATE INDEX "otp_codes_email_idx" ON "otp_codes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "parent_sessions_refresh_token_hash_key" ON "parent_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "parents_email_key" ON "parents" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_versions_kid_version_key" ON "schedule_versions" USING btree ("kid_id","version");--> statement-breakpoint
CREATE INDEX "sos_locations_sos_at_idx" ON "sos_locations" USING btree ("sos_id","at");--> statement-breakpoint
CREATE INDEX "time_requests_kid_status_idx" ON "time_requests" USING btree ("kid_id","status");--> statement-breakpoint
CREATE INDEX "usage_segments_kid_pool_started_idx" ON "usage_segments" USING btree ("kid_id","pool","started_at");