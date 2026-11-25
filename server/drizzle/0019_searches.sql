CREATE TABLE "searches" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"engine" text NOT NULL,
	"query" text NOT NULL,
	"package" text NOT NULL,
	"private" boolean,
	"source" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "searches_device_id_at_package_pk" PRIMARY KEY("device_id","at","package"),
	CONSTRAINT "searches_count" CHECK ("searches"."count" between 1 and 1000),
	CONSTRAINT "searches_engine" CHECK ("searches"."engine" in ('google', 'bing', 'duckduckgo', 'youtube')),
	CONSTRAINT "searches_query" CHECK (char_length("searches"."query") between 1 and 200),
	CONSTRAINT "searches_source" CHECK ("searches"."source" in ('android', 'title')),
	CONSTRAINT "searches_last_at" CHECK ("searches"."last_at" >= "searches"."at")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "search_capture" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "search_capture_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "searches_kid_at_idx" ON "searches" USING btree ("kid_id","at");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_search_capture" CHECK ("devices"."search_capture" is null or "devices"."search_capture" in ('on', 'off'));--> statement-breakpoint
ALTER TABLE searches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON searches
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
