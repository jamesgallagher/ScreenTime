CREATE TABLE "app_rules" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"package" text NOT NULL,
	"mode" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "app_rules_kid_id_package_pk" PRIMARY KEY("kid_id","package"),
	CONSTRAINT "app_rules_mode" CHECK ("app_rules"."mode" in ('allowed', 'held', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "kids" ADD COLUMN "new_app_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_rules" ADD CONSTRAINT "app_rules_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_rules" ADD CONSTRAINT "app_rules_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_rules" ADD CONSTRAINT "app_rules_updated_by_parents_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE app_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON app_rules
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);