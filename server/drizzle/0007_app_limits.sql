CREATE TABLE "app_usage_daily" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"package" text NOT NULL,
	"day" date NOT NULL,
	"seconds" integer NOT NULL,
	CONSTRAINT "app_usage_daily_device_id_package_day_pk" PRIMARY KEY("device_id","package","day")
);
--> statement-breakpoint
ALTER TABLE "app_rules" DROP CONSTRAINT "app_rules_mode";--> statement-breakpoint
ALTER TABLE "app_rules" ADD COLUMN "daily_minutes" integer;--> statement-breakpoint
ALTER TABLE "app_usage_daily" ADD CONSTRAINT "app_usage_daily_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_usage_daily" ADD CONSTRAINT "app_usage_daily_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_usage_daily" ADD CONSTRAINT "app_usage_daily_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_usage_daily_kid_day_idx" ON "app_usage_daily" USING btree ("kid_id","day");--> statement-breakpoint
ALTER TABLE "app_rules" ADD CONSTRAINT "app_rules_mode" CHECK ("app_rules"."mode" in ('allowed', 'held', 'blocked', 'limit'));--> statement-breakpoint
ALTER TABLE app_usage_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY family_isolation ON app_usage_daily
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);