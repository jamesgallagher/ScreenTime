CREATE TABLE "bedtime_extensions" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"day" date NOT NULL,
	"bedtime" text NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bedtime_extensions_kid_id_day_pk" PRIMARY KEY("kid_id","day")
);
--> statement-breakpoint
ALTER TABLE "bedtime_extensions" ADD CONSTRAINT "bedtime_extensions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bedtime_extensions" ADD CONSTRAINT "bedtime_extensions_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bedtime_extensions" ADD CONSTRAINT "bedtime_extensions_created_by_parents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE bedtime_extensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON bedtime_extensions
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);