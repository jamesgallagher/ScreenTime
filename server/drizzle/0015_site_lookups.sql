CREATE TABLE "site_daily" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"day" date NOT NULL,
	"site" text NOT NULL,
	"package" text NOT NULL,
	"lookups" integer NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_daily_device_id_day_site_package_pk" PRIMARY KEY("device_id","day","site","package")
);
--> statement-breakpoint
CREATE TABLE "site_lookups" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"host" text NOT NULL,
	"package" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_lookups_device_id_at_host_package_pk" PRIMARY KEY("device_id","at","host","package")
);
--> statement-breakpoint
ALTER TABLE "site_daily" ADD CONSTRAINT "site_daily_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_daily" ADD CONSTRAINT "site_daily_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_daily" ADD CONSTRAINT "site_daily_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_lookups" ADD CONSTRAINT "site_lookups_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_lookups" ADD CONSTRAINT "site_lookups_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_lookups" ADD CONSTRAINT "site_lookups_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_daily_kid_day_idx" ON "site_daily" USING btree ("kid_id","day");--> statement-breakpoint
CREATE INDEX "site_lookups_kid_at_idx" ON "site_lookups" USING btree ("kid_id","at");--> statement-breakpoint
CREATE INDEX "site_lookups_at_idx" ON "site_lookups" USING btree ("at");--> statement-breakpoint
ALTER TABLE site_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY family_isolation ON site_daily
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE site_lookups ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY family_isolation ON site_lookups
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);