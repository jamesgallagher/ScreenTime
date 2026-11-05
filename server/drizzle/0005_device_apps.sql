CREATE TABLE "device_apps" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"package" text NOT NULL,
	"label" text NOT NULL,
	"source" text NOT NULL,
	"installer" text,
	"blockable" boolean NOT NULL,
	"installed_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"first_used_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"baseline" boolean NOT NULL,
	CONSTRAINT "device_apps_device_id_package_pk" PRIMARY KEY("device_id","package")
);
--> statement-breakpoint
ALTER TABLE "device_apps" ADD CONSTRAINT "device_apps_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_apps" ADD CONSTRAINT "device_apps_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_apps" ADD CONSTRAINT "device_apps_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_apps_kid_idx" ON "device_apps" USING btree ("kid_id");
--> statement-breakpoint
ALTER TABLE device_apps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON device_apps
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);