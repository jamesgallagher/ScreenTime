CREATE TABLE "site_titles" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"sec" integer NOT NULL,
	"package" text NOT NULL,
	"title" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_titles_device_id_at_package_pk" PRIMARY KEY("device_id","at","package")
);
--> statement-breakpoint
ALTER TABLE "site_titles" ADD CONSTRAINT "site_titles_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_titles" ADD CONSTRAINT "site_titles_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_titles" ADD CONSTRAINT "site_titles_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_titles_kid_at_idx" ON "site_titles" USING btree ("kid_id","at");--> statement-breakpoint
CREATE INDEX "site_titles_at_idx" ON "site_titles" USING btree ("at");--> statement-breakpoint
ALTER TABLE site_titles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY family_isolation ON site_titles
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);