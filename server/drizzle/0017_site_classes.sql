CREATE TABLE "site_classes" (
	"site" text PRIMARY KEY NOT NULL,
	"kind" text,
	"category" text,
	"owner" text,
	"label" text,
	"confidence" real,
	"family_dns_blocked" boolean DEFAULT false NOT NULL,
	"model" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"classified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_overrides" (
	"family_id" uuid NOT NULL,
	"site" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"parent_id" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_overrides_family_id_site_pk" PRIMARY KEY("family_id","site")
);
--> statement-breakpoint
ALTER TABLE "site_daily" ADD COLUMN "minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_lookups" ADD COLUMN "site" text;--> statement-breakpoint
ALTER TABLE "site_overrides" ADD CONSTRAINT "site_overrides_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_overrides" ADD CONSTRAINT "site_overrides_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE site_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON site_overrides
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
